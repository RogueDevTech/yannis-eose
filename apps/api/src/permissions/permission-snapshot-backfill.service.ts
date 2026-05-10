import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { eq, and, isNull, ne, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { canonicalPermissionCode } from '@yannis/shared';
import { DRIZZLE } from '../database/database.tokens';
import { PermissionsService } from './permissions.service';
import { CacheService } from '../common/cache/cache.service';

/**
 * One-time bootstrap: stamp `user_permissions` from the **legacy** effective formula
 * (template ∪ role_permissions ∪ user rows − revokes) so runtime can switch to
 * snapshot-only `getEffectivePermissions` without locking anyone out.
 *
 * Skips when `_yannis_permission_snapshot_applied` already has a row.
 * Disable with `PERMISSION_SNAPSHOT_BACKFILL=false`.
 */
@Injectable()
export class PermissionSnapshotBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSnapshotBackfillService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly permissionsService: PermissionsService,
    @Optional() private readonly cacheService?: CacheService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env['PERMISSION_SNAPSHOT_BACKFILL'] === 'false') {
      this.logger.log('PERMISSION_SNAPSHOT_BACKFILL=false — skipping permission snapshot backfill.');
      return;
    }

    try {
      // Use COUNT(*) so the result has a stable, scalar shape regardless of
      // how `db.execute` materialises rows (postgres-js sometimes returns a
      // bare array, sometimes wraps in `{ rows: [...] }` depending on the
      // call path). The earlier `SELECT 1 ... LIMIT 1` + `Array.isArray`
      // dance failed silently when the wrapper was present — the check
      // returned false even with the marker row in place, the service ran
      // the backfill again, and the final INSERT blew up on the unique key.
      const markerResult = (await this.db.execute(
        sql`SELECT COUNT(*)::int AS n FROM _yannis_permission_snapshot_applied`,
      )) as unknown;
      const rows = Array.isArray(markerResult)
        ? (markerResult as Array<{ n?: number }>)
        : ((markerResult as { rows?: Array<{ n?: number }> })?.rows ?? []);
      const count = Number(rows[0]?.n ?? 0);
      if (count > 0) {
        return;
      }
    } catch (err) {
      this.logger.warn(
        `Permission snapshot marker check failed (run migrations?): ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    this.logger.log('Running one-time permission snapshot backfill (legacy union → user_permissions)…');

    const [bootstrapSuperAdmin] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, 'SUPER_ADMIN'))
      .limit(1);
    const bootstrapActorId = bootstrapSuperAdmin?.id ?? null;
    if (!bootstrapActorId) {
      this.logger.warn(
        'Permission snapshot backfill: no SUPER_ADMIN row — user_permissions writes will attribute to System in audit.',
      );
    }

    const staffRows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(ne(schema.users.role, 'SUPER_ADMIN'));

    let done = 0;
    for (const u of staffRows) {
      const effective = await this.permissionsService.getEffectivePermissionsLegacyUnion(u.id);
      const canonUnique = [...new Set([...effective].map((c) => canonicalPermissionCode(c)))];
      await this.db.transaction(async (tx) => {
        if (bootstrapActorId) {
          await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${bootstrapActorId}, true)`);
        }
        await tx
          .delete(schema.userPermissions)
          .where(and(eq(schema.userPermissions.userId, u.id), isNull(schema.userPermissions.validTo)));
        if (canonUnique.length === 0) return;
        const permRows = await tx
          .select({ id: schema.permissions.id, code: schema.permissions.code })
          .from(schema.permissions)
          .where(inArray(schema.permissions.code, canonUnique));
        const byCode = new Map(permRows.map((p) => [canonicalPermissionCode(p.code), p.id]));
        const values = canonUnique
          .map((code) => {
            const permissionId = byCode.get(code);
            if (!permissionId) return null;
            return {
              userId: u.id,
              permissionId,
              granted: true as const,
              grantedBy: null as string | null,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);
        if (values.length > 0) {
          await tx.insert(schema.userPermissions).values(values);
        }
      });
      done++;
      if (done % 200 === 0) {
        this.logger.log(`Permission snapshot backfill progress: ${done}/${staffRows.length}`);
      }
    }

    // ON CONFLICT DO NOTHING makes the marker insert idempotent — even if
    // the early-return marker check above ever drifts again, the boot won't
    // crash. Worst case we redo work; never crash.
    await this.db.execute(
      sql`INSERT INTO _yannis_permission_snapshot_applied (singleton_key) VALUES (1) ON CONFLICT (singleton_key) DO NOTHING`,
    );

    // Drop every cached user bundle so any lingering pre-boot cache entries
    // (from a previous deploy that shared the Redis instance) cannot serve
    // stale permissions to a freshly-stamped user. Safe even on a virgin
    // Redis: pattern-DEL is idempotent and the loop is fast.
    if (this.cacheService) {
      await this.cacheService.delPattern('cache:auth:userBundle:*');
    }

    this.logger.log(`Permission snapshot backfill complete (${done} users).`);
  }
}
