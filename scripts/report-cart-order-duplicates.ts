import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import postgres from 'postgres';

/**
 * Report: Cross-table duplicates between `orders` (edge-form) and `cart_orders`.
 *
 * Finds cases where the same customer_phone_hash + product_id exists in both
 * the orders table AND cart_orders table — meaning the same lead is being
 * worked in two pipelines simultaneously.
 */
async function main() {
  const sql = postgres(process.env['DATABASE_URL']!, { max: 1 });

  console.log('='.repeat(80));
  console.log('CROSS-TABLE DUPLICATE REPORT: orders ↔ cart_orders');
  console.log('='.repeat(80));
  console.log();

  // ── 1. Total duplicate pairs ──────────────────────────────────────────────
  // Find cart_orders that share the same customer_phone_hash + product_id
  // with an edge-form order, created within 30 days of each other.
  const duplicatePairs = await sql`
    WITH cart_with_products AS (
      SELECT
        co.id AS cart_order_id,
        co.order_number AS cart_order_number,
        co.customer_phone_hash,
        co.customer_name AS cart_customer_name,
        co.status AS cart_status,
        co.total_amount AS cart_total,
        co.created_at AS cart_created_at,
        co.assigned_cs_id AS cart_cs_id,
        co.media_buyer_id AS cart_mb_id,
        co.branch_id AS cart_branch_id,
        co.deleted_at AS cart_deleted_at,
        coi.product_id
      FROM cart_orders co
      JOIN cart_order_items coi ON coi.cart_order_id = co.id
    ),
    orders_with_products AS (
      SELECT
        o.id AS order_id,
        o.order_number,
        o.customer_phone_hash,
        o.customer_name,
        o.status AS order_status,
        o.total_amount AS order_total,
        o.created_at AS order_created_at,
        o.assigned_cs_id AS order_cs_id,
        o.media_buyer_id AS order_mb_id,
        o.branch_id AS order_branch_id,
        o.order_source,
        o.is_follow_up,
        o.deleted_at AS order_deleted_at,
        oi.product_id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.order_source IS NULL OR o.order_source = 'edge-form'
    )
    SELECT
      cwp.cart_order_id,
      cwp.cart_order_number,
      cwp.cart_customer_name,
      cwp.cart_status,
      cwp.cart_total,
      cwp.cart_created_at,
      cwp.cart_deleted_at,
      owp.order_id,
      owp.order_number,
      owp.customer_name AS order_customer_name,
      owp.order_status,
      owp.order_total,
      owp.order_created_at,
      owp.order_deleted_at,
      owp.order_source,
      p.name AS product_name,
      cwp.product_id,
      ABS(EXTRACT(EPOCH FROM (cwp.cart_created_at - owp.order_created_at)) / 3600)::int AS hours_apart,
      CASE WHEN cwp.cart_mb_id = owp.order_mb_id THEN 'Same MB' ELSE 'Different MB' END AS mb_match,
      CASE WHEN cwp.cart_cs_id = owp.order_cs_id THEN 'Same CS' ELSE 'Different CS' END AS cs_match
    FROM cart_with_products cwp
    JOIN orders_with_products owp
      ON owp.customer_phone_hash = cwp.customer_phone_hash
      AND owp.product_id = cwp.product_id
    LEFT JOIN products p ON p.id = cwp.product_id
    ORDER BY cwp.cart_created_at DESC
  `;

  console.log(`TOTAL DUPLICATE PAIRS FOUND: ${duplicatePairs.length}`);
  console.log();

  if (duplicatePairs.length === 0) {
    console.log('No cross-table duplicates found.');
    await sql.end();
    return;
  }

  // ── 2. Summary by status combination ──────────────────────────────────────
  const statusCombos: Record<string, number> = {};
  for (const row of duplicatePairs) {
    const key = `Order: ${row.order_status} | Cart: ${row.cart_status}`;
    statusCombos[key] = (statusCombos[key] || 0) + 1;
  }
  console.log('─'.repeat(80));
  console.log('BREAKDOWN BY STATUS COMBINATION');
  console.log('─'.repeat(80));
  for (const [combo, count] of Object.entries(statusCombos).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${combo}: ${count}`);
  }
  console.log();

  // ── 3. Both active (neither DELETED/CANCELLED) ───────────────────────────
  const terminal = new Set(['DELETED', 'CANCELLED']);
  const bothActive = duplicatePairs.filter(
    (r) => !terminal.has(r.order_status) && !terminal.has(r.cart_status) && !r.order_deleted_at && !r.cart_deleted_at,
  );
  console.log('─'.repeat(80));
  console.log(`BOTH ACTIVE (neither deleted): ${bothActive.length}`);
  console.log('─'.repeat(80));

  // Sub-breakdown: both active by status
  const activeStatusCombos: Record<string, number> = {};
  for (const row of bothActive) {
    const key = `Order: ${row.order_status} | Cart: ${row.cart_status}`;
    activeStatusCombos[key] = (activeStatusCombos[key] || 0) + 1;
  }
  for (const [combo, count] of Object.entries(activeStatusCombos).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${combo}: ${count}`);
  }
  console.log();

  // ── 4. Both DELIVERED — double delivery risk ──────────────────────────────
  const bothDelivered = duplicatePairs.filter(
    (r) =>
      ['DELIVERED', 'REMITTED'].includes(r.order_status) &&
      ['DELIVERED', 'REMITTED'].includes(r.cart_status),
  );
  console.log('─'.repeat(80));
  console.log(`BOTH DELIVERED/REMITTED (double delivery): ${bothDelivered.length}`);
  console.log('─'.repeat(80));
  if (bothDelivered.length > 0) {
    for (const row of bothDelivered.slice(0, 20)) {
      console.log(`  Order #${row.order_number} (${row.order_status}) ↔ Cart #${row.cart_order_number} (${row.cart_status})`);
      console.log(`    Product: ${row.product_name}`);
      console.log(`    Order total: ${row.order_total} | Cart total: ${row.cart_total}`);
      console.log(`    ${row.hours_apart}h apart | ${row.mb_match} | ${row.cs_match}`);
    }
    if (bothDelivered.length > 20) console.log(`  ... and ${bothDelivered.length - 20} more`);
  }
  console.log();

  // ── 5. Time gap analysis ──────────────────────────────────────────────────
  const gaps = { under24h: 0, under7d: 0, under30d: 0, over30d: 0 };
  for (const row of duplicatePairs) {
    const h = Number(row.hours_apart);
    if (h < 24) gaps.under24h++;
    else if (h < 168) gaps.under7d++;
    else if (h < 720) gaps.under30d++;
    else gaps.over30d++;
  }
  console.log('─'.repeat(80));
  console.log('TIME GAP BETWEEN ORDER AND CART ORDER CREATION');
  console.log('─'.repeat(80));
  console.log(`  < 24 hours:  ${gaps.under24h}`);
  console.log(`  1–7 days:    ${gaps.under7d}`);
  console.log(`  7–30 days:   ${gaps.under30d}`);
  console.log(`  > 30 days:   ${gaps.over30d}`);
  console.log();

  // ── 6. MB match analysis ──────────────────────────────────────────────────
  const sameMb = duplicatePairs.filter((r) => r.mb_match === 'Same MB').length;
  const diffMb = duplicatePairs.filter((r) => r.mb_match === 'Different MB').length;
  console.log('─'.repeat(80));
  console.log('MEDIA BUYER MATCH');
  console.log('─'.repeat(80));
  console.log(`  Same MB:      ${sameMb}`);
  console.log(`  Different MB: ${diffMb}`);
  console.log();

  // ── 7. Revenue impact — sum of cart_order totals for both-delivered ───────
  let cartDeliveredRevenue = 0;
  for (const row of bothDelivered) {
    cartDeliveredRevenue += Number(row.cart_total || 0);
  }
  console.log('─'.repeat(80));
  console.log('REVENUE IMPACT (both-delivered cart order totals)');
  console.log('─'.repeat(80));
  console.log(`  Cart orders total (potential double-count): ₦${cartDeliveredRevenue.toLocaleString()}`);
  console.log();

  // ── 8. Sample rows (first 30) ─────────────────────────────────────────────
  console.log('─'.repeat(80));
  console.log('SAMPLE DUPLICATE PAIRS (most recent 30)');
  console.log('─'.repeat(80));
  for (const row of duplicatePairs.slice(0, 30)) {
    const orderDel = row.order_deleted_at ? ' [DEL]' : '';
    const cartDel = row.cart_deleted_at ? ' [DEL]' : '';
    console.log(
      `  Order #${row.order_number} ${row.order_status}${orderDel} (${new Date(row.order_created_at).toLocaleDateString()})` +
      ` ↔ Cart #${row.cart_order_number} ${row.cart_status}${cartDel} (${new Date(row.cart_created_at).toLocaleDateString()})` +
      ` | ${row.product_name} | ${row.hours_apart}h gap | ${row.mb_match}`,
    );
  }
  console.log();

  console.log('='.repeat(80));
  console.log('END OF REPORT');
  console.log('='.repeat(80));

  await sql.end();
}

main().catch((err) => {
  console.error('Report failed:', err);
  process.exit(1);
});
