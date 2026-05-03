/**
 * Boots a Nest application context once so lifecycle hooks run:
 * SQL migrations → RBAC seed (soft) → permission snapshot backfill (if `_yannis_permission_snapshot_applied` is empty).
 *
 * Does not start HTTP.
 *
 * Usage (package cwd is `apps/api` when using pnpm filter):
 *   pnpm --filter @yannis/api run run-permission-backfill
 *   pnpm --filter @yannis/api run run-permission-backfill -- --force
 *
 * `--force` deletes the marker row first so every staff user is re-stamped from the legacy union formula.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

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
  if (!process.env['DATABASE_URL']?.trim()) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const force = process.argv.includes('--force');
  if (force) {
    const postgres = (await import('postgres')).default;
    const sqlPg = postgres(process.env['DATABASE_URL'], {
      max: 1,
      idle_timeout: 10,
      connect_timeout: 30,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await sqlPg`DELETE FROM _yannis_permission_snapshot_applied WHERE singleton_key = 1`;
      console.warn('[permission-backfill] --force: cleared completion marker; bootstrap will re-stamp all staff.');
    } catch (err) {
      console.warn(
        '[permission-backfill] --force: marker delete skipped (table missing until migrations?) — continuing.',
        err instanceof Error ? err.message : err,
      );
    } finally {
      await sqlPg.end({ timeout: 10 });
    }
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  await app.close();
  console.warn('[permission-backfill] Finished.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
