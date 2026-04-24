import { Injectable, Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { withActor } from '../common/db/with-actor';

const REDIS_PREFIX = 'yannis:setting:';
const CACHE_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * Get a system setting by key.
   * Checks Redis cache first, falls back to DB, then caches.
   */
  async get(key: string): Promise<Record<string, unknown> | null> {
    // Check Redis cache
    const cached = await this.redis.get(`${REDIS_PREFIX}${key}`);
    if (cached) {
      return JSON.parse(cached) as Record<string, unknown>;
    }

    // Fallback to DB
    const rows = await this.db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, key))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const value = row.value as Record<string, unknown>;

    // Cache in Redis
    await this.redis.set(
      `${REDIS_PREFIX}${key}`,
      JSON.stringify(value),
      'EX',
      CACHE_TTL_SECONDS,
    );

    return value;
  }

  /**
   * Get all system settings.
   */
  async getAll(): Promise<Array<{ key: string; value: Record<string, unknown>; updatedBy: string | null; updatedAt: Date }>> {
    const rows = await this.db
      .select()
      .from(schema.systemSettings);

    return rows.map((row) => ({
      key: row.key,
      value: row.value as Record<string, unknown>,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Upsert a system setting with audit trail.
   */
  async set(key: string, value: Record<string, unknown>, actorId: string): Promise<void> {
    await withActor(this.db, { id: actorId }, async (tx) => {
      // Check if setting exists
      const existing = await tx
        .select()
        .from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, key))
        .limit(1);

      if (existing[0]) {
        await tx
          .update(schema.systemSettings)
          .set({
            value,
            updatedBy: actorId,
            updatedAt: new Date(),
          })
          .where(eq(schema.systemSettings.key, key));
      } else {
        await tx
          .insert(schema.systemSettings)
          .values({
            key,
            value,
            updatedBy: actorId,
          });
      }
    });

    // Invalidate Redis cache
    await this.redis.del(`${REDIS_PREFIX}${key}`);
  }
}
