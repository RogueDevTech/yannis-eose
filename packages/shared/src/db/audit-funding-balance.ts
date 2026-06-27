/**
 * Audit a user's funding balance by reconciling all ledger entries.
 *
 * Usage:
 *   AUDIT_USER="Abdurrahman" pnpm --filter @yannis/shared db:audit-funding
 *
 * Environment:
 *   AUDIT_USER  — partial name match (case-insensitive)
 *   AUDIT_UID   — exact user UUID (skips name search)
 *   DATABASE_URL — connection string (reads apps/api/.env then root .env)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../../apps/api/.env') });
config({ path: resolve(__dirname, '../../../../.env') });

import postgres from 'postgres';

async function audit() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });
  const nameQuery = process.env['AUDIT_USER'] ?? '';
  const directUid = process.env['AUDIT_UID'] ?? '';

  // ── 1. Resolve user ──────────────────────────────────────────────
  let uid: string;
  let userName: string;

  if (directUid) {
    const rows = await sql`SELECT id, name, role, status FROM users WHERE id = ${directUid}`;
    if (rows.length === 0) { console.error('User not found by ID:', directUid); await sql.end(); process.exit(1); }
    uid = rows[0]!.id as string;
    userName = rows[0]!.name as string;
    console.log('User:', rows[0]);
  } else if (nameQuery) {
    const rows = await sql`SELECT id, name, role, status FROM users WHERE name ILIKE ${'%' + nameQuery + '%'}`;
    if (rows.length === 0) { console.error('No user matching:', nameQuery); await sql.end(); process.exit(1); }
    if (rows.length > 1) {
      console.log('Multiple matches — pick one with AUDIT_UID:');
      console.table(rows);
      await sql.end();
      process.exit(1);
    }
    uid = rows[0]!.id as string;
    userName = rows[0]!.name as string;
    console.log('User:', rows[0]);
  } else {
    console.error('Set AUDIT_USER="partial name" or AUDIT_UID="uuid"');
    await sql.end();
    process.exit(1);
  }

  console.log('\n========================================');
  console.log(`  Funding Audit: ${userName}`);
  console.log(`  ID: ${uid}`);
  console.log('========================================\n');

  // ── 2. Funding transfers ─────────────────────────────────────────
  const creditsByStatus = await sql`
    SELECT status, count(*)::int as n, coalesce(sum(amount), 0)::numeric as total
    FROM marketing_funding WHERE receiver_id = ${uid}
    GROUP BY status ORDER BY status
  `;
  const debitsByStatus = await sql`
    SELECT status, count(*)::int as n, coalesce(sum(amount), 0)::numeric as total
    FROM marketing_funding WHERE sender_id = ${uid}
    GROUP BY status ORDER BY status
  `;

  console.log('Credits (received) by status:');
  if (creditsByStatus.length === 0) console.log('  (none)');
  else console.table(creditsByStatus);

  console.log('Debits (sent/distributed) by status:');
  if (debitsByStatus.length === 0) console.log('  (none)');
  else console.table(debitsByStatus);

  // ── 3. Ad spend ──────────────────────────────────────────────────
  const adSpendByStatus = await sql`
    SELECT status, count(*)::int as n, coalesce(sum(spend_amount), 0)::numeric as total
    FROM ad_spend_logs WHERE media_buyer_id = ${uid}
    GROUP BY status ORDER BY status
  `;
  console.log('Ad spend by status:');
  if (adSpendByStatus.length === 0) console.log('  (none)');
  else console.table(adSpendByStatus);

  // ── 4. Funding requests ──────────────────────────────────────────
  const requestsByStatus = await sql`
    SELECT status, count(*)::int as n, coalesce(sum(amount), 0)::numeric as total
    FROM marketing_funding_requests WHERE requester_id = ${uid}
    GROUP BY status ORDER BY status
  `;
  console.log('Funding requests by status:');
  if (requestsByStatus.length === 0) console.log('  (none)');
  else console.table(requestsByStatus);

  // ── 5. Balance reconciliation ────────────────────────────────────
  const sumByStatus = (rows: Record<string, unknown>[], status: string) =>
    Number(rows.find((r) => r.status === status)?.total ?? 0);
  const sumAll = (rows: Record<string, unknown>[]) =>
    rows.reduce((acc, r) => acc + Number(r.total ?? 0), 0);

  const creditsCompleted = sumByStatus(creditsByStatus, 'COMPLETED');
  const creditsSent = sumByStatus(creditsByStatus, 'SENT');
  const creditsAll = sumAll(creditsByStatus);

  const debitsCompleted = sumByStatus(debitsByStatus, 'COMPLETED');
  const debitsSent = sumByStatus(debitsByStatus, 'SENT');
  const debitsAll = sumAll(debitsByStatus);

  const adSpendApproved = sumByStatus(adSpendByStatus, 'APPROVED');
  const adSpendPending = sumByStatus(adSpendByStatus, 'PENDING');

  console.log('\n=== BALANCE RECONCILIATION ===');
  console.log(`Credits COMPLETED:  ₦${creditsCompleted.toLocaleString()}`);
  console.log(`Credits SENT:       ₦${creditsSent.toLocaleString()}`);
  console.log(`Credits ALL:        ₦${creditsAll.toLocaleString()}`);
  console.log('');
  console.log(`Debits COMPLETED:   ₦${debitsCompleted.toLocaleString()}`);
  console.log(`Debits SENT:        ₦${debitsSent.toLocaleString()}`);
  console.log(`Debits ALL:         ₦${debitsAll.toLocaleString()}`);
  console.log('');
  console.log(`Ad spend APPROVED:  ₦${adSpendApproved.toLocaleString()}`);
  console.log(`Ad spend PENDING:   ₦${adSpendPending.toLocaleString()}`);
  console.log('');

  // The app balance formula: credits(COMPLETED) - debits(COMPLETED) - adSpend(APPROVED)
  const balanceStrict = creditsCompleted - debitsCompleted - adSpendApproved;
  // Alt: credits(ALL) - debits(ALL) - adSpend(APPROVED)
  const balanceAll = creditsAll - debitsAll - adSpendApproved;

  console.log(`Balance (COMPLETED only):     ₦${balanceStrict.toLocaleString()}`);
  console.log(`Balance (ALL statuses):       ₦${balanceAll.toLocaleString()}`);
  console.log(`Total transactions:           ${sumAll(creditsByStatus.map((r) => ({ total: r.n }))) + sumAll(debitsByStatus.map((r) => ({ total: r.n })))}`);

  // ── 6. Recent transactions ───────────────────────────────────────
  const recent = await sql`
    (SELECT 'CREDIT' as dir, amount::text, status, sent_at as ts,
            (SELECT name FROM users WHERE id = sender_id) as counterparty
     FROM marketing_funding WHERE receiver_id = ${uid})
    UNION ALL
    (SELECT 'DEBIT' as dir, amount::text, status, sent_at as ts,
            (SELECT name FROM users WHERE id = receiver_id) as counterparty
     FROM marketing_funding WHERE sender_id = ${uid})
    ORDER BY ts DESC LIMIT 30
  `;
  console.log('\nRecent 30 transactions:');
  console.table(recent);

  // ── 7. Check for duplicate source_funding_request_id ─────────────
  const dupes = await sql`
    SELECT source_funding_request_id, count(*)::int as n
    FROM marketing_funding
    WHERE (receiver_id = ${uid} OR sender_id = ${uid})
      AND source_funding_request_id IS NOT NULL
    GROUP BY source_funding_request_id
    HAVING count(*) > 1
  `;
  if (dupes.length > 0) {
    console.log('\n⚠️  DUPLICATE source_funding_request_id entries (possible double-credit):');
    console.table(dupes);
  } else {
    console.log('\n✓ No duplicate funding request links found');
  }

  await sql.end();
}

audit().catch((err) => {
  console.error('Audit failed:', err);
  process.exit(1);
});
