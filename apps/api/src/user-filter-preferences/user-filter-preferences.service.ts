import { Injectable, Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { CacheService } from '../common/cache/cache.service';
import { withActor } from '../common/db/with-actor';

const CACHE_TTL_SECONDS = 300; // 5 minutes

@Injectable()
export class UserFilterPreferencesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cache: CacheService,
  ) {}

  private cacheKey(userId: string): string {
    return `cache:userFilterPrefs:${userId}`;
  }

  /** Get all filter preferences for a user (cached). */
  async getAllForUser(userId: string): Promise<Record<string, Record<string, string>>> {
    return this.cache.getOrSet(this.cacheKey(userId), CACHE_TTL_SECONDS, async () => {
      const rows = await this.db
        .select({ pageKey: schema.userFilterPreferences.pageKey, filters: schema.userFilterPreferences.filters })
        .from(schema.userFilterPreferences)
        .where(eq(schema.userFilterPreferences.userId, userId));

      const result: Record<string, Record<string, string>> = {};
      for (const row of rows) {
        result[row.pageKey] = row.filters as Record<string, string>;
      }
      return result;
    });
  }

  /** Get preferences for a single page. */
  async getForPage(userId: string, pageKey: string): Promise<Record<string, string> | null> {
    const all = await this.getAllForUser(userId);
    return all[pageKey] ?? null;
  }

  /** Upsert preferences for a single page. */
  async upsert(userId: string, pageKey: string, filters: Record<string, string>): Promise<void> {
    await withActor(this.db, { id: userId }, async (tx) => {
      const [existing] = await tx
        .select({ id: schema.userFilterPreferences.id })
        .from(schema.userFilterPreferences)
        .where(
          and(
            eq(schema.userFilterPreferences.userId, userId),
            eq(schema.userFilterPreferences.pageKey, pageKey),
          ),
        )
        .limit(1);

      if (existing) {
        await tx
          .update(schema.userFilterPreferences)
          .set({ filters, updatedAt: new Date() })
          .where(eq(schema.userFilterPreferences.id, existing.id));
      } else {
        await tx
          .insert(schema.userFilterPreferences)
          .values({ userId, pageKey, filters });
      }
    });

    await this.cache.del(this.cacheKey(userId));
  }

  /** Delete preferences for a single page. */
  async deleteForPage(userId: string, pageKey: string): Promise<void> {
    await withActor(this.db, { id: userId }, async (tx) => {
      await tx
        .delete(schema.userFilterPreferences)
        .where(
          and(
            eq(schema.userFilterPreferences.userId, userId),
            eq(schema.userFilterPreferences.pageKey, pageKey),
          ),
        );
    });

    await this.cache.del(this.cacheKey(userId));
  }
}
