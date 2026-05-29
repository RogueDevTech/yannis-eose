import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/index';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

type AppSchema = typeof schema;

export type MigrationLogger = Pick<Console, 'log' | 'warn' | 'error'>;

/**
 * Journal-free SQL migrations: applies every `packages/shared/drizzle/*.sql` file
 * in lexicographic order, tracked in `_yannis_applied_migrations`.
 *
 * Used by the Nest `MigrationRunnerService` on bootstrap and by the deploy CLI.
 */
export async function runSqlMigrations(options: {
  db: PostgresJsDatabase<AppSchema>;
  logger?: MigrationLogger;
  /** Override migrations directory (tests / custom layouts). */
  migrationsDir?: string | null;
  /** Directory of the caller (e.g. `__dirname` from `MigrationRunnerService`) for path resolution. */
  migrationsSearchFrom?: string;
}): Promise<void> {
  const log = options.logger ?? console;

  const autorunEnabled = process.env['MIGRATIONS_AUTORUN'] !== 'false';
  const adoptionEnabled = process.env['MIGRATIONS_ALLOW_ADOPTION'] === 'true';
  log.log(
    `Migration runner mode: autorun=${autorunEnabled ? 'enabled' : 'disabled'}, adoption=${adoptionEnabled ? 'enabled' : 'disabled'}`,
  );

  if (process.env['MIGRATIONS_AUTORUN'] === 'false') {
    log.warn('MIGRATIONS_AUTORUN=false — skipping auto-migrate. Run them manually.');
    return;
  }

  const migrationsDir =
    options.migrationsDir ??
    resolveMigrationsDirectory(options.migrationsSearchFrom);
  if (!migrationsDir) {
    log.warn('No drizzle migrations directory found — skipping auto-migrate.');
    return;
  }

  const db = options.db;

  await ensureBookkeepingTable(db);

  const allFiles = listSqlFiles(migrationsDir);
  const applied = await loadAppliedSet(db);

  if (applied.size === 0 && (await schemaAlreadyProvisioned(db))) {
    const allowAdoption = process.env['MIGRATIONS_ALLOW_ADOPTION'] === 'true';
    if (!allowAdoption) {
      throw new Error(
        'Refusing implicit migration adoption: DB has schema but _yannis_applied_migrations is empty. ' +
          'Run migrations explicitly, or set MIGRATIONS_ALLOW_ADOPTION=true for a one-time adoption bootstrap.',
      );
    }
    const missingSentinels = await findAdoptionSentinelGaps(db);
    if (missingSentinels.length > 0) {
      throw new Error(
        `Refusing migration-adoption bootstrap: DB has a partial schema but _yannis_applied_migrations is empty. ` +
          `Missing required objects: ${missingSentinels.join(', ')}. ` +
          `Apply migrations manually first, then restart.`,
      );
    }
    log.warn(
      `First boot with auto-migrate, but the database already has the schema. ` +
        `Seeding _yannis_applied_migrations with ${allFiles.length} existing migration(s) ` +
        `so future deploys only run NEW files. Verify the DB matches your repo before relying on this.`,
    );
    await seedAppliedTable(db, allFiles);
    return;
  }

  const pending = allFiles.filter((name) => !applied.has(name));

  if (pending.length === 0) {
    log.log(`Migrations up to date (${applied.size} applied).`);
    return;
  }

  log.log(`Applying ${pending.length} pending migration(s)…`);
  for (const filename of pending) {
    const filepath = path.join(migrationsDir, filename);
    const sqlText = readFileSync(filepath, 'utf8');
    const startedAt = Date.now();

    try {
      // Double-check right before running: if a prior crashed boot already
      // recorded this filename (outside its transaction), skip entirely.
      const alreadyApplied = await db.execute<{ filename: string }>(
        sql`SELECT 1 FROM _yannis_applied_migrations WHERE filename = ${filename} LIMIT 1`,
      );
      if ((alreadyApplied as unknown as unknown[]).length > 0) {
        log.log(`  ↷ ${filename} already recorded — skipping`);
        continue;
      }

      await db.transaction(async (tx) => {
        await tx.execute(sql.raw(sqlText));
        await tx.execute(sql`INSERT INTO _yannis_applied_migrations (filename) VALUES (${filename})`);
      });
      log.log(`  ✓ ${filename} (${Date.now() - startedAt}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`  ✗ ${filename} failed: ${msg}`);
      throw new Error(
        `Migration ${filename} failed: ${msg}. Set MIGRATIONS_AUTORUN=false to bypass and debug manually.`,
      );
    }
  }

  log.log(`Migrations complete (${pending.length} new, ${applied.size + pending.length} total).`);
}

export function resolveMigrationsDirectory(searchFrom?: string): string | null {
  const candidates: string[] = [];
  if (searchFrom) {
    candidates.push(
      path.resolve(searchFrom, '../../../../packages/shared/drizzle'),
      path.resolve(searchFrom, '../../../packages/shared/drizzle'),
    );
  }
  candidates.push(
    path.resolve(process.cwd(), 'packages/shared/drizzle'),
    path.resolve(process.cwd(), '../packages/shared/drizzle'),
    path.resolve(process.cwd(), '../../packages/shared/drizzle'),
  );
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function listSqlFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

async function ensureBookkeepingTable(db: PostgresJsDatabase<AppSchema>): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _yannis_applied_migrations (
      id serial PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Older DB instances may have the table without the UNIQUE constraint on
  // filename (CREATE TABLE IF NOT EXISTS won't alter an existing table).
  // Add it idempotently so ON CONFLICT (filename) works.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS _yannis_applied_migrations_filename_key
    ON _yannis_applied_migrations (filename)
  `);
  // After a DB restore/dump-import the `id` SERIAL sequence is often left
  // behind the table's MAX(id), so the next INSERT collides with an existing
  // row and fails with "duplicate key value violates unique constraint
  // _yannis_applied_migrations_pkey". A dump can also drop the sequence's
  // OWNED BY link, so pg_get_serial_sequence() returns NULL even when the
  // column default still references `_yannis_applied_migrations_id_seq` by
  // name — fall back to that literal name. Resync idempotently every boot.
  await db.execute(sql`
    DO $$
    DECLARE
      seq_name regclass := COALESCE(
        pg_get_serial_sequence('_yannis_applied_migrations', 'id')::regclass,
        to_regclass('_yannis_applied_migrations_id_seq')
      );
      max_id integer;
    BEGIN
      IF seq_name IS NULL THEN RETURN; END IF;
      SELECT MAX(id) INTO max_id FROM _yannis_applied_migrations;
      PERFORM setval(seq_name, GREATEST(COALESCE(max_id, 0), 1), max_id IS NOT NULL);
    END $$;
  `);
}

async function loadAppliedSet(db: PostgresJsDatabase<AppSchema>): Promise<Set<string>> {
  const rows = (await db.execute<{ filename: string }>(
    sql`SELECT filename FROM _yannis_applied_migrations`,
  )) as unknown as Array<{ filename: string }>;
  return new Set(rows.map((r) => r.filename));
}

async function schemaAlreadyProvisioned(db: PostgresJsDatabase<AppSchema>): Promise<boolean> {
  const rows = (await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists
  `)) as unknown as Array<{ exists: boolean }>;
  return rows[0]?.exists === true;
}

async function seedAppliedTable(
  db: PostgresJsDatabase<AppSchema>,
  filenames: string[],
): Promise<void> {
  if (filenames.length === 0) return;
  const values = sql.join(
    filenames.map((name) => sql`(${name})`),
    sql`, `,
  );
  await db.execute(sql`
    INSERT INTO _yannis_applied_migrations (filename) VALUES ${values}
    ON CONFLICT (filename) DO NOTHING
  `);
}

async function findAdoptionSentinelGaps(db: PostgresJsDatabase<AppSchema>): Promise<string[]> {
  const checks = (await db.execute(sql`
    SELECT
      to_regclass('public.branch_teams') IS NOT NULL AS has_branch_teams,
      to_regclass('public.branch_team_members') IS NOT NULL AS has_branch_team_members,
      to_regclass('public.stock_transfer_outcomes') IS NOT NULL AS has_stock_transfer_outcomes,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'stock_transfers'
          AND column_name = 'receiver_notes'
      ) AS has_stock_transfers_receiver_notes,
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'payout_account_name'
      ) AS has_users_payout_account_name
  `)) as unknown as Array<{
    has_branch_teams: boolean;
    has_branch_team_members: boolean;
    has_stock_transfer_outcomes: boolean;
    has_stock_transfers_receiver_notes: boolean;
    has_users_payout_account_name: boolean;
  }>;

  const row = checks[0];
  if (!row) return ['sentinel_check_failed'];

  const missing: string[] = [];
  if (!row.has_branch_teams) missing.push('branch_teams');
  if (!row.has_branch_team_members) missing.push('branch_team_members');
  if (!row.has_stock_transfer_outcomes) missing.push('stock_transfer_outcomes');
  if (!row.has_stock_transfers_receiver_notes) missing.push('stock_transfers.receiver_notes');
  if (!row.has_users_payout_account_name) missing.push('users.payout_account_name');
  return missing;
}
