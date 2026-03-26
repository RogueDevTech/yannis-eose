import { Injectable, Inject, Logger } from '@nestjs/common';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { RedisHealthService } from '../database/redis-health.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

const SESSION_PREFIX = 'session:';

@Injectable()
export class SessionStoreService {
  private readonly logger = new Logger(SessionStoreService.name);
  private readonly sessionDbFallbackEnabled =
    (process.env['SESSION_DB_FALLBACK_ENABLED'] ?? 'true') === 'true';

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly redisHealth: RedisHealthService,
  ) {}

  async createSession(token: string, user: SessionUser, ttlSeconds: number): Promise<void> {
    const now = Date.now();
    const expiresAt = new Date(now + ttlSeconds * 1000);
    await this.db.insert(schema.authSessions).values({
      token,
      userId: user.id,
      sessionData: user as unknown as Record<string, unknown>,
      expiresAt,
      revokedAt: null,
    });
    await this.tryRedisSet(token, user, ttlSeconds);
  }

  async getSession(token: string): Promise<SessionUser | null> {
    const redisSession = await this.tryRedisGet(token);
    if (redisSession) return redisSession;
    if (!this.sessionDbFallbackEnabled) return null;

    const [row] = await this.db
      .select({
        sessionData: schema.authSessions.sessionData,
        expiresAt: schema.authSessions.expiresAt,
      })
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.token, token),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row) return null;

    const session = row.sessionData as unknown as SessionUser;
    const ttlSeconds = Math.max(1, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000));
    await this.tryRedisSet(token, session, ttlSeconds);
    return session;
  }

  async touchSession(token: string, ttlSeconds: number): Promise<void> {
    await this.tryRedisExpire(token, ttlSeconds);
    await this.db
      .update(schema.authSessions)
      .set({
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.authSessions.token, token),
          isNull(schema.authSessions.revokedAt),
        ),
      );
  }

  async updateSession(token: string, user: SessionUser, ttlSeconds: number): Promise<void> {
    await this.db
      .update(schema.authSessions)
      .set({
        sessionData: user as unknown as Record<string, unknown>,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.authSessions.token, token),
          isNull(schema.authSessions.revokedAt),
        ),
      );
    await this.tryRedisSet(token, user, ttlSeconds);
  }

  async deleteSession(token: string): Promise<void> {
    await this.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.authSessions.token, token));
    await this.tryRedisDel(token);
  }

  async deleteAllUserSessions(userId: string): Promise<number> {
    const rows = await this.db
      .select({ token: schema.authSessions.token })
      .from(schema.authSessions)
      .where(
        and(
          eq(schema.authSessions.userId, userId),
          isNull(schema.authSessions.revokedAt),
          gt(schema.authSessions.expiresAt, new Date()),
        ),
      );

    if (rows.length === 0) return 0;
    const tokens = rows.map((r) => r.token);
    await this.db
      .update(schema.authSessions)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(inArray(schema.authSessions.token, tokens));

    await Promise.all(tokens.map((token) => this.tryRedisDel(token)));
    return tokens.length;
  }

  private async tryRedisGet(token: string): Promise<SessionUser | null> {
    if (!this.redisHealth.isHealthy()) return null;
    try {
      const sessionData = await this.redis.get(`${SESSION_PREFIX}${token}`);
      return sessionData ? (JSON.parse(sessionData) as SessionUser) : null;
    } catch (error) {
      this.logger.warn(`session_read_fallback token=${token} reason=${(error as Error).message}`);
      return null;
    }
  }

  private async tryRedisSet(token: string, user: SessionUser, ttlSeconds: number): Promise<void> {
    if (!this.redisHealth.isHealthy()) return;
    try {
      await this.redis.setex(`${SESSION_PREFIX}${token}`, ttlSeconds, JSON.stringify(user));
    } catch (error) {
      this.logger.warn(`session_cache_write_failed token=${token} reason=${(error as Error).message}`);
    }
  }

  private async tryRedisExpire(token: string, ttlSeconds: number): Promise<void> {
    if (!this.redisHealth.isHealthy()) return;
    try {
      await this.redis.expire(`${SESSION_PREFIX}${token}`, ttlSeconds);
    } catch (error) {
      this.logger.warn(`session_cache_touch_failed token=${token} reason=${(error as Error).message}`);
    }
  }

  private async tryRedisDel(token: string): Promise<void> {
    if (!this.redisHealth.isHealthy()) return;
    try {
      await this.redis.del(`${SESSION_PREFIX}${token}`);
    } catch (error) {
      this.logger.warn(`session_cache_delete_failed token=${token} reason=${(error as Error).message}`);
    }
  }
}
