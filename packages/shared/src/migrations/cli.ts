/**
 * Deploy / ops CLI: apply pending SQL migrations using the same runner as the API.
 *
 * Usage (from repo root or Docker `/app`):
 *   PGSSLMODE=require DATABASE_URL=... pnpm --filter @yannis/shared exec tsx src/migrations/cli.ts
 *
 * If DATABASE_URL is not exported, loads `.env` from `apps/api/.env` and repo root `.env`
 * (searches upward from cwd) — same convenience as `db:seed-permissions`.
 */
import { existsSync } from 'fs';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

function loadDotenvForMigrateCli(): void {
  let dir = path.resolve(process.cwd());
  for (let depth = 0; depth < 10; depth++) {
    for (const file of [path.join(dir, 'apps', 'api', '.env'), path.join(dir, '.env')]) {
      if (existsSync(file)) {
        loadDotenv({ path: file });
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

loadDotenvForMigrateCli();
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../db/index';
import { resolveMigrationsDirectory, runSqlMigrations } from './run-sql-migrations';

function postgresSslOption(url: string): boolean | { rejectUnauthorized: boolean } {
  if (process.env['PGSSLMODE'] === 'require' || /\bsslmode=require\b/i.test(url)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? process.env['TEST_DATABASE_URL'];
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL (or TEST_DATABASE_URL) is required. Add it to apps/api/.env or the repo root .env, or export it in the shell.',
    );
  }

  const pg = postgres(url, {
    ssl: postgresSslOption(url),
    max: 1,
    connect_timeout: 60,
  });

  const db = drizzle(pg, { schema });

  const migrationsDir = resolveMigrationsDirectory();
  if (!migrationsDir) {
    throw new Error(
      'Could not find packages/shared/drizzle — run from monorepo root or ensure migrations are copied into the image.',
    );
  }

  await runSqlMigrations({
    db,
    logger: console,
    migrationsDir,
  });

  await pg.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
