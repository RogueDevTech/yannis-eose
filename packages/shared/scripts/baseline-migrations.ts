/**
 * Baseline existing migrations for a database that was set up without drizzle-kit migrate.
 * Run this once, then use `pnpm db:migrate` for future migrations.
 *
 * Usage: npx tsx packages/shared/scripts/baseline-migrations.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import postgres from 'postgres';

config({ path: resolve(__dirname, '../../../.env') });

const MIGRATIONS_DIR = resolve(__dirname, '../drizzle');

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(url);

  try {
    // Read migration files and compute hashes (drizzle uses SHA256 of file content)
    const m0000 = readFileSync(
      resolve(MIGRATIONS_DIR, '0000_redundant_warbound.sql'),
      'utf-8'
    );
    const m0001 = readFileSync(
      resolve(MIGRATIONS_DIR, '0001_cuddly_vivisector.sql'),
      'utf-8'
    );

    const hash0 = sha256(m0000);
    const hash1 = sha256(m0001);

    // Drizzle stores migrations in drizzle.__drizzle_migrations (PostgreSQL default)
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS drizzle;
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      );
    `);

    // Insert baseline records (ignore if already exist)
    await sql.unsafe(`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT $1, 1772373908817
      WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1);
    `, [hash0]);

    await sql.unsafe(`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      SELECT $1, 1772377908454
      WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1);
    `, [hash1]);

    console.log('Baseline complete. Migrations 0000 and 0001 marked as applied.');
    console.log('Run: pnpm db:migrate');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
