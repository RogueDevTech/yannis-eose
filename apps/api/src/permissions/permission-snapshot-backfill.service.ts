import { Injectable, Inject, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { eq, and, isNull, ne, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import { canonicalPermissionCode } from '@yannis/shared';
import { DRIZZLE } from '../database/database.tokens';
import { PermissionsService } from './permissions.service';

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
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env['PERMISSION_SNAPSHOT_BACKFILL'] === 'false') {
      this.logger.log('PERMISSION_SNAPSHOT_BACKFILL=false — skipping permission snapshot backfill.');
      return;
    }

    try {
      const markerCheck = await this.db.execute(
        sql`SELECT 1 AS ok FROM _yannis_permission_snapshot_applied LIMIT 1`,
      );
      const asRows = markerCheck as unknown as Array<{ ok?: number }>;
      if (Array.isArray(asRows) && asRows.length > 0) {
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

    await this.db.execute(sql`INSERT INTO _yannis_permission_snapshot_applied (singleton_key) VALUES (1)`);
    this.logger.log(`Permission snapshot backfill complete (${done} users).`);
  }
}
