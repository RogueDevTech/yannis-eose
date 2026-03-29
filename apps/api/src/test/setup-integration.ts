/**
 * Integration test setup — shared DB and pgClient pointing to yannis_test database.
 *
 * Usage in each integration spec:
 *   import { getDb, getPgClient } from '../test/setup-integration';
 *   beforeEach(async () => { await getPgClient()`BEGIN` });
 *   afterEach(async () => { await getPgClient()`ROLLBACK` });
 */

import { config } from 'dotenv';
import { resolve } from 'path';
// Load apps/api/.env so TEST_DATABASE_URL is available when running vitest from repo root
// __dirname = apps/api/src/test → ../../ = apps/api/
config({ path: resolve(__dirname, '../../.env') });
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';

const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://yannis:yannis_test@localhost:5432/yannis_test';

let pgClientInstance: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

export function getPgClient(): ReturnType<typeof postgres> {
  if (!pgClientInstance) {
    pgClientInstance = postgres(TEST_DB_URL, {
      max: 1,
      onnotice: () => {},
      ssl: TEST_DB_URL.includes('sslmode=require') ? 'require' : false,
    });
  }
  return pgClientInstance;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = drizzle(getPgClient(), { schema });
  }
  return dbInstance as ReturnType<typeof drizzle<typeof schema>>;
}

export async function closeConnections(): Promise<void> {
  if (pgClientInstance) {
    await pgClientInstance.end();
    pgClientInstance = null;
    dbInstance = null;
  }
}

/**
 * Set the session actor for temporal audit trail.
 * Must be called inside a transaction before any write.
 */
export async function setSessionActor(
  pgClient: ReturnType<typeof postgres>,
  userId: string,
  branchId: string | null = null,
): Promise<void> {
  // SET LOCAL does not accept parameterized values ($1) — must use unsafe() to inline the value.
  await pgClient.unsafe(`SET LOCAL "yannis.current_user_id" = '${userId}'`);
  if (branchId) {
    await pgClient.unsafe(`SET LOCAL "yannis.current_branch_id" = '${branchId}'`);
  } else {
    await pgClient.unsafe(`SET LOCAL "yannis.current_branch_id" = ''`);
  }
}
