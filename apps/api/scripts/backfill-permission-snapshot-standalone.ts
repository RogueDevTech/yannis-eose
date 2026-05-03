/**
 * Permission snapshot backfill without Nest (Postgres + Drizzle only).
 * Use when `run-permission-snapshot-backfill` hangs on full app bootstrap (Redis/Trpc/etc.).
 *
 *   pnpm --filter @yannis/api run run-permission-backfill:standalone
 *   pnpm --filter @yannis/api run run-permission-backfill:standalone -- --force
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, isNull, ne, inArray, sql } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { canonicalPermissionCode } from '@yannis/shared';
import { runSqlMigrations } from '../../../packages/shared/src/migrations/run-sql-migrations';
import { PermissionsService } from '../src/permissions/permissions.service';

for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '.env'),
  resolve(process.cwd(), 'apps/api/.env'),
]) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
  }
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url?.trim()) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  const sqlPg = postgres(url, {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 30,
    ssl: { rejectUnauthorized: false },
  });
  const db = drizzle(sqlPg, { schema });

  try {
    await runSqlMigrations({
      db,
      migrationsSearchFrom: resolve(process.cwd(), 'src/database'),
      logger: console,
    });

    if (force) {
      try {
        await db.execute(sql`DELETE FROM _yannis_permission_snapshot_applied WHERE singleton_key = 1`);
        console.warn('[standalone-backfill] --force: cleared completion marker.');
      } catch (err) {
        console.warn(
          '[standalone-backfill] marker delete skipped (table missing until migrations?) — continuing.',
          err instanceof Error ? err.message : err,
        );
      }
    }

    let markerCheck: unknown;
    try {
      markerCheck = await db.execute(sql`SELECT 1 AS ok FROM _yannis_permission_snapshot_applied LIMIT 1`);
    } catch (err) {
      console.error(
        '[standalone-backfill] Marker table missing — run migrations first:',
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
    const asRows = markerCheck as unknown as Array<{ ok?: number }>;
    if (Array.isArray(asRows) && asRows.length > 0) {
      console.warn('[standalone-backfill] Already applied (marker row exists). Use --force to re-stamp.');
      return;
    }

    const permissionsService = new PermissionsService(db);

    console.warn('[standalone-backfill] Running legacy union → user_permissions…');
    const staffRows = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(ne(schema.users.role, 'SUPER_ADMIN'));

    let done = 0;
    for (const u of staffRows) {
      const effective = await permissionsService.getEffectivePermissionsLegacyUnion(u.id);
      const canonUnique = [...new Set([...effective].map((c) => canonicalPermissionCode(c)))];
      await db.transaction(async (tx) => {
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
        console.warn(`[standalone-backfill] Progress: ${done}/${staffRows.length}`);
      }
    }

    await db.execute(sql`INSERT INTO _yannis_permission_snapshot_applied (singleton_key) VALUES (1)`);
    console.warn(`[standalone-backfill] Complete (${done} users).`);
  } finally {
    await sqlPg.end({ timeout: 15 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
