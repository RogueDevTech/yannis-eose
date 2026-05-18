import { Injectable, Inject, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { createHash } from 'crypto';
import { REDIS } from '../../database/database.module';

/**
 * Lightweight Redis query-result cache.
 * Used to wrap expensive read procedures (ceoOverview, notifications.list, etc.)
 * to prevent Postgres saturation under load.
 *
 * Pattern:
 *   const cached = await cache.get<MyType>(key);
 *   if (cached) return cached;
 *   const result = await expensiveQuery();
 *   await cache.set(key, result, ttlSeconds);
 *   return result;
 */
/**
 * Read-through cache kill-switch. Set `READ_THROUGH_CACHE_ENABLED=false` to force
 * every cache read to miss and skip writes — used to benchmark raw endpoint latency
 * without Redis masking the underlying query cost. Does NOT affect Redis-as-state
 * (sessions, dispatch queue, dedup keys, rate limiting).
 *
 * Exported so the few ad-hoc Redis-as-cache callers outside `CacheService`
 * (SettingsService, voip.isEnabled, UserBundleCacheService) can honour the flag
 * with a one-line inline check.
 */
export function isReadThroughCacheEnabled(): boolean {
  const raw = process.env.READ_THROUGH_CACHE_ENABLED;
  if (raw == null) return true;
  const v = raw.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no' && v !== 'off';
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {
    if (!isReadThroughCacheEnabled()) {
      this.logger.warn(
        'READ_THROUGH_CACHE_ENABLED=false — read-through cache disabled. Every getOrSet/get will miss; perf testing mode.',
      );
    }
  }

  /**
   * Stable hash of any JSON-serialisable value — used to build cache keys
   * from complex input objects without length limits.
   */
  static hashInput(input: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(input ?? null))
      .digest('hex')
      .slice(0, 16);
  }

  async get<T>(key: string): Promise<T | null> {
    if (!isReadThroughCacheEnabled()) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`cache.get failed key=${key}: ${err}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!isReadThroughCacheEnabled()) return;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(`cache.set failed key=${key}: ${err}`);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.logger.warn(`cache.del failed key=${key}: ${err}`);
    }
  }

  /**
   * Delete all keys matching a glob pattern (e.g. "cache:orders:list:branch-123:*").
   * Uses SCAN to avoid blocking Redis with KEYS on large keyspaces.
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn(`cache.delPattern failed pattern=${pattern}: ${err}`);
    }
  }

  /**
   * Convenience: get or compute. Runs the factory only on cache miss.
   * All errors in the factory are re-thrown; cache errors are swallowed (fail-open).
   */
  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const result = await factory();
    await this.set(key, result, ttlSeconds);
    return result;
  }
}
