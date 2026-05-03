/**
 * Seed default CS message templates (org-wide, branch_id = NULL).
 *
 * Same data the API auto-seeds on every boot via
 * `MessageTemplateSeedService` — this CLI is the manual-trigger fallback for
 * environments where the API isn't yet deployed but you want defaults seeded
 * (or for go-to-prod runbooks where you want explicit logging).
 *
 * Idempotent — keys off `name` + `branch_id IS NULL`. Existing rows with the
 * same name are skipped (so HoCS-edited copy is preserved across runs).
 *
 * Usage:
 *   pnpm db:seed-message-templates
 *   DATABASE_URL=... pnpm db:seed-message-templates
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { DEFAULT_MESSAGE_TEMPLATES } from '../src/messaging/template-catalog';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// scripts/ → packages/shared/ → monorepo root
config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1, ssl: { rejectUnauthorized: false } });

  console.log('Seeding default CS message templates…\n');

  try {
    const owners = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1
    `;
    const ownerId = owners[0]?.id;
    if (!ownerId) {
      console.warn('  No SUPER_ADMIN user found yet — seed skipped.');
      console.warn('  Run /auth/setup first, then re-run this script (or just restart the API).');
      return;
    }

    let inserted = 0;
    let existing = 0;
    for (const template of DEFAULT_MESSAGE_TEMPLATES) {
      const found = await sql<{ id: string }[]>`
        SELECT id FROM message_templates
        WHERE name = ${template.name} AND branch_id IS NULL
        LIMIT 1
      `;
      if (found[0]) {
        existing += 1;
        console.log(`  · ${template.name} — already present, skipped`);
        continue;
      }
      await sql`
        INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
        VALUES (
          gen_random_uuid(),
          ${template.name},
          ${template.channel}::message_channel,
          ${template.body},
          ${ownerId}::uuid,
          NULL,
          'ACTIVE'::template_status
        )
      `;
      inserted += 1;
      console.log(`  + ${template.name} (${template.channel})`);
    }

    console.log(
      `\n  Done — ${inserted} new template${inserted === 1 ? '' : 's'} inserted, ${existing} already present.`,
    );
  } catch (err) {
    console.error('\n  Seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
