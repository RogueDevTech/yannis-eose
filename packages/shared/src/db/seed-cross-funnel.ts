/**
 * Cross-Funnel Attempts Seed — populate `cross_funnel_attempts` with demo rows
 * so the Marketing → Cross-Funnel page is non-empty and the feature can be QA'd.
 *
 * Usage:
 *   pnpm db:seed:cross-funnel                            # 5 rows (default)
 *   CROSS_FUNNEL_COUNT=20 pnpm db:seed:cross-funnel      # custom count
 *   BRANCH_ID=<uuid> pnpm db:seed:cross-funnel           # force all rows to one branch
 *
 * `BRANCH_ID` override exists because the page filters by the viewer's active
 * session branch (SuperAdmin + HoM both narrow to `currentBranchId`). Without
 * the override, each row inherits its winner-order's branch — so a tester
 * pinned to one branch may see zero rows even though the table has data.
 * Pass `BRANCH_ID=<your-active-branch>` to guarantee the rows surface for you.
 *
 * This script is ADDITIVE — it does NOT truncate existing data.
 *
 * Strategy:
 *   1. Pick up to N recent orders that have `media_buyer_id` set (the "winners").
 *   2. For each winner, pick a DIFFERENT media buyer as the runner-up.
 *   3. Insert one `cross_funnel_attempts` row per (winner, product) — phone hash
 *      and customer name are reused from the winner so the row looks real to QA.
 *
 * No `customer_phone` is read or written — `customer_phone_hash` is sufficient
 * for the table (Pillar 2 — never store raw phones outside `orders`).
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../../.env') });

import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';

const CROSS_FUNNEL_COUNT = Math.min(
  100,
  Math.max(1, parseInt(process.env['CROSS_FUNNEL_COUNT'] ?? '5', 10) || 5),
);
const BRANCH_OVERRIDE = process.env['BRANCH_ID']?.trim() || null;

interface OrderRow {
  id: string;
  media_buyer_id: string;
  campaign_id: string | null;
  branch_id: string | null;
  customer_phone_hash: string;
  customer_name: string;
}

interface ItemRow {
  order_id: string;
  product_id: string;
}

async function crossFunnelSeed() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  console.log('========================================');
  console.log('  Cross-Funnel Attempts Seed');
  console.log(`  Adding ${CROSS_FUNNEL_COUNT} demo rows`);
  if (BRANCH_OVERRIDE) {
    console.log(`  Branch override: ${BRANCH_OVERRIDE}`);
  } else {
    console.log('  Branch: inherited from each winner order');
  }
  console.log('========================================\n');

  // Validate the branch override — fail loudly if the UUID isn't a real branch
  // (otherwise the INSERT errors with a confusing FK violation later).
  if (BRANCH_OVERRIDE) {
    const [branch] = await sql<Array<{ id: string; name: string }>>`
      SELECT id, name FROM branches WHERE id = ${BRANCH_OVERRIDE}::uuid LIMIT 1
    `;
    if (!branch) {
      console.error(`BRANCH_ID '${BRANCH_OVERRIDE}' not found in branches table.`);
      await sql.end();
      process.exit(1);
    }
    console.log(`  ✓ Override branch resolved: ${branch.name} (${branch.id})\n`);
  }

  // Actor for the audit triggers — first SuperAdmin in the DB.
  const [superAdmin] = await sql<Array<{ id: string }>>`
    SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY created_at LIMIT 1
  `;
  if (!superAdmin) {
    console.error('No SUPER_ADMIN found. Bootstrap the first user before running this seed.');
    await sql.end();
    process.exit(1);
  }
  await sql`SELECT set_config('yannis.current_user_id', ${superAdmin.id}, true)`;

  // Distinct media buyers — need at least 2 so the runner-up can differ from the winner.
  const mediaBuyers = await sql<Array<{ id: string }>>`
    SELECT id FROM users
    WHERE role = 'MEDIA_BUYER' AND status = 'ACTIVE'
    ORDER BY created_at
  `;
  if (mediaBuyers.length < 2) {
    console.error(
      `Need at least 2 active MEDIA_BUYER users; found ${mediaBuyers.length}. Run db:seed first.`,
    );
    await sql.end();
    process.exit(1);
  }
  console.log(`  Found ${mediaBuyers.length} active media buyers.`);

  // Winners — recent orders attributed to an MB, with a phone hash + customer name.
  // Pull more than we need so we can skip duplicates / orphans gracefully.
  const winners = await sql<OrderRow[]>`
    SELECT
      id,
      media_buyer_id,
      campaign_id,
      branch_id,
      customer_phone_hash,
      customer_name
    FROM orders
    WHERE media_buyer_id IS NOT NULL
      AND customer_phone_hash IS NOT NULL
      AND customer_name IS NOT NULL
      AND deleted_at IS NULL
      AND status NOT IN ('CANCELLED', 'DELETED')
    ORDER BY created_at DESC
    LIMIT ${CROSS_FUNNEL_COUNT * 4}
  `;
  if (winners.length === 0) {
    console.error('No attributed orders found to use as cross-funnel winners. Run db:seed first.');
    await sql.end();
    process.exit(1);
  }

  // Map winner → product IDs (one row per product means we record one attempt per product).
  const winnerIds = winners.map((w) => w.id);
  const items = await sql<ItemRow[]>`
    SELECT order_id, product_id
    FROM order_items
    WHERE order_id IN ${sql(winnerIds)}
  `;
  const productsByOrder: Record<string, string[]> = {};
  for (const it of items) {
    (productsByOrder[it.order_id] ??= []).push(it.product_id);
  }

  // Build the insert payload — one row per (winner, product), capped at COUNT winners.
  // ID is generated app-side (UUIDv7) because `uuidv7Pk()` uses Drizzle's `$defaultFn`
  // which only fires through the Drizzle insert API, not raw SQL.
  type CrossFunnelRow = {
    id: string;
    customerPhoneHash: string;
    customerName: string;
    productId: string;
    mediaBuyerId: string; // runner-up
    campaignId: string | null;
    branchId: string | null;
    originalOrderId: string;
    originalMediaBuyerId: string; // winner's MB
  };
  const rows: CrossFunnelRow[] = [];

  let used = 0;
  for (const winner of winners) {
    if (used >= CROSS_FUNNEL_COUNT) break;
    const products = productsByOrder[winner.id] ?? [];
    if (products.length === 0) continue;

    // Runner-up: pick the first MB that isn't the winner's.
    const runnerUp = mediaBuyers.find((mb) => mb.id !== winner.media_buyer_id);
    if (!runnerUp) continue;

    // One attempt row per product on the winner (mirrors the production write path
    // in OrdersService.recordCrossFunnelAttempt). When BRANCH_OVERRIDE is set we
    // stamp every row with that branch so the page surfaces them for a tester
    // pinned to that branch — otherwise we inherit the winner's branch as prod does.
    for (const productId of products) {
      rows.push({
        id: uuidv7(),
        customerPhoneHash: winner.customer_phone_hash,
        customerName: winner.customer_name,
        productId,
        mediaBuyerId: runnerUp.id,
        campaignId: winner.campaign_id,
        branchId: BRANCH_OVERRIDE ?? winner.branch_id,
        originalOrderId: winner.id,
        originalMediaBuyerId: winner.media_buyer_id,
      });
    }
    used += 1;
  }

  if (rows.length === 0) {
    console.error('No insertable rows produced — likely missing order_items on the candidate winners.');
    await sql.end();
    process.exit(1);
  }

  // Insert one row at a time with parameterized values — simpler than wrestling
  // with jsonb_to_recordset across the postgres.js driver and easier to debug
  // if a single row violates a constraint.
  let insertedCount = 0;
  for (const r of rows) {
    await sql`
      INSERT INTO cross_funnel_attempts (
        id,
        customer_phone_hash,
        customer_name,
        product_id,
        media_buyer_id,
        campaign_id,
        branch_id,
        original_order_id,
        original_media_buyer_id,
        attempted_at,
        created_at
      ) VALUES (
        ${r.id}::uuid,
        ${r.customerPhoneHash},
        ${r.customerName},
        ${r.productId}::uuid,
        ${r.mediaBuyerId}::uuid,
        ${r.campaignId}::uuid,
        ${r.branchId}::uuid,
        ${r.originalOrderId}::uuid,
        ${r.originalMediaBuyerId}::uuid,
        NOW() - (random() * INTERVAL '6 hours'),
        NOW()
      )
    `;
    insertedCount += 1;
  }

  console.log(`\n  ✓ Inserted ${insertedCount} cross_funnel_attempts row(s) across ${used} winner orders.`);
  console.log('  Visit /admin/marketing/cross-funnel as the runner-up MB (or HoM / Admin) to see them.\n');

  await sql.end();
}

crossFunnelSeed().catch((err) => {
  console.error('Cross-funnel seed failed:', err);
  process.exit(1);
});
