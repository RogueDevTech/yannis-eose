/**
 * Seed RBAC permissions and role_permissions.
 *
 * This CLI is now thin — it just opens a postgres-js connection and delegates
 * to `applyPermissionCatalog` from `../src/rbac/seed-runner.ts`. The same
 * logic runs automatically on every API boot via
 * `apps/api/src/database/permission-seed.service.ts`, so this script is
 * mostly a manual-trigger fallback (e.g. for environments where the API
 * isn't yet deployed but you want the catalog seeded).
 *
 * Usage:
 *   pnpm db:seed-permissions
 *   DATABASE_URL=... pnpm db:seed-permissions
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { applyPermissionCatalog } from '../src/rbac/seed-runner';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ → packages/shared/ → monorepo root
config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  console.log('Syncing RBAC permissions...\n');

  try {
    const result = await applyPermissionCatalog(sql, {
      log: (m: string) => console.log(`  ${m}`),
      warn: (m: string) => console.warn(`  ${m}`),
      error: (m: string) => console.error(`  ${m}`),
    });
    console.log(
      `\n  Permissions: ${result.permsInserted} new / ${result.permsTotal} total`,
    );
    console.log(
      `  Role assignments: ${result.rolePermsRevoked} revoked, ${result.rolePermsInserted} added`,
    );
    if (result.templatesInserted > 0) {
      console.log(`  System role templates: ${result.templatesInserted} new added`);
    }
    console.log(
      `  System template perms: ${result.templatePermsRevoked} revoked, ${result.templatePermsInserted} added`,
    );
    console.log('  Done.\n');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
