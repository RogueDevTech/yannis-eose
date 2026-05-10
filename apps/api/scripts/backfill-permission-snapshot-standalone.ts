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
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(ne(schema.users.role, 'SUPER_ADMIN'));

    const total = staffRows.length;
    const startedAt = Date.now();
    /** Emit a rolling-rate / ETA line. Frequent enough to feel live, sparse
     *  enough not to flood logs on a slow remote DB (Aiven ~150 ms / row). */
    const PROGRESS_EVERY = total <= 50 ? 5 : total <= 200 ? 10 : total <= 1000 ? 25 : 50;
    /** Heartbeat — even if no user has finished in a while, print elapsed
     *  time every 10 s so the operator knows the script is still running. */
    const HEARTBEAT_MS = 10_000;
    let lastHeartbeatAt = startedAt;
    let lastEmittedAt = startedAt;
    let lastEmittedDone = 0;

    const fmtMs = (ms: number) => {
      const s = Math.round(ms / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}m${r.toString().padStart(2, '0')}s`;
    };
    const printProgress = (done: number, currentLabel?: string) => {
      const now = Date.now();
      const elapsed = now - startedAt;
      const remaining = total - done;
      const overallRate = done > 0 ? done / (elapsed / 1000) : 0;
      // Recent-window rate is more honest than overall when the DB warms up.
      const windowDone = done - lastEmittedDone;
      const windowMs = now - lastEmittedAt;
      const recentRate = windowDone > 0 && windowMs > 0 ? windowDone / (windowMs / 1000) : overallRate;
      const etaSec = recentRate > 0 ? remaining / recentRate : 0;
      const pct = total > 0 ? Math.round((done / total) * 100) : 100;
      const tail = currentLabel ? ` · last: ${currentLabel}` : '';
      console.warn(
        `[standalone-backfill] ${done}/${total} (${pct}%) — elapsed ${fmtMs(elapsed)} · ` +
          `${recentRate.toFixed(1)}/s · ETA ${fmtMs(etaSec * 1000)} · ${remaining} remaining${tail}`,
      );
      lastEmittedAt = now;
      lastEmittedDone = done;
      lastHeartbeatAt = now;
    };

    console.warn(`[standalone-backfill] Roster: ${total} non-SuperAdmin users to re-stamp.`);

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
      const label = u.name ?? u.email ?? u.id;
      if (done % PROGRESS_EVERY === 0 || done === total) {
        printProgress(done, label);
      } else if (Date.now() - lastHeartbeatAt > HEARTBEAT_MS) {
        // No batch boundary recently — emit a heartbeat so the script doesn't
        // look hung when one user's row takes longer than usual.
        printProgress(done, label);
      }
    }

    // Idempotent — same rationale as the boot-time backfill service. Even
    // when --force ran moments earlier and re-stamped the marker, this
    // doesn't error if a parallel boot beat us to it.
    await db.execute(
      sql`INSERT INTO _yannis_permission_snapshot_applied (singleton_key) VALUES (1) ON CONFLICT (singleton_key) DO NOTHING`,
    );
    const totalElapsed = fmtMs(Date.now() - startedAt);
    console.warn(`[standalone-backfill] Complete (${done} users · ${totalElapsed}).`);
  } finally {
    await sqlPg.end({ timeout: 15 });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
