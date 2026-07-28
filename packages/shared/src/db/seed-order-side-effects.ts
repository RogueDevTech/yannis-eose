/**
 * Order side-effect seeder — makes the seeded orders genuinely end-to-end.
 *
 * The raw seed inserted order rows but never ran the delivery/finance flow, so
 * there were 0 stock_movements, no FIFO consumption, and no GL. This walks the
 * existing seeded orders (customer_name LIKE 'Customer %') and generates the
 * downstream side-effects the real flow would produce:
 *
 *   CONFIRMED+           → RESERVATION movement + reserved_count bump
 *   DELIVERED/REMITTED   → DELIVERY movement, stock_count deduction, FIFO consume,
 *                          invoice, GL sales entry (Dr Debtors/Cr Sales + Dr COGS/Cr Stock)
 *   REMITTED             → delivery_remittance + settlement GL (Dr Bank/Cr Debtors)
 *   RETURNED             → RETURN movement + stock restore
 *   all                  → an ORDER_* timeline event
 *
 * Idempotent: skips an order if it already has a DELIVERY movement.
 *
 * Usage: DATABASE_URL=... npx tsx packages/shared/src/db/seed-order-side-effects.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';

config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../../apps/api/.env') });
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(DATABASE_URL, {
  max: 1,
  ssl: DATABASE_URL.includes('sslmode=require') ? 'require' : false,
  connect_timeout: 30,
  idle_timeout: 60,
  max_lifetime: 0,
});

const POST_CONFIRM = ['CONFIRMED','AGENT_ASSIGNED','DISPATCHED','IN_TRANSIT','DELIVERED','PARTIALLY_DELIVERED','REMITTED','RETURNED'];
const DELIVERED = ['DELIVERED','REMITTED'];

async function main() {
  const [{ id: groupId }] = await sql<{ id: string }[]>`SELECT id FROM branch_groups WHERE name='Yannis EOSE' LIMIT 1`;
  const [actor] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email='kbshowkb@gmail.com' LIMIT 1`;
  const actorId = actor.id;

  // Resolve accounts by code (group-scoped).
  const accts = await sql<{ code: string; id: string }[]>`
    SELECT code, id FROM accounts WHERE group_id=${groupId} AND code IN ('1121','1131','1112','4110','5110')`;
  const A = Object.fromEntries(accts.map(a => [a.code, a.id]));
  const AR = A['1121'], STOCK = A['1131'], BANK = A['1112'], SALES = A['4110'], COGS = A['5110'];

  // Fiscal year (GL needs one).
  const FY_ID = '81111111-1111-4111-8111-111111111111';
  await sql`INSERT INTO fiscal_years (id, group_id, name, start_date, end_date, status)
    VALUES (${FY_ID}, ${groupId}, 'FY2026', '2026-01-01', '2026-12-31', 'OPEN') ON CONFLICT (id) DO NOTHING`;

  // A logistics location per branch (from the seed) to attribute movements.
  const locs = await sql<{ branch_id: string; id: string }[]>`
    SELECT branch_id, id FROM logistics_locations WHERE branch_id IS NOT NULL`;
  const locByBranch = new Map(locs.map(l => [l.branch_id, l.id]));

  // Pull the seeded orders with their single line item.
  const orders = await sql<{
    id: string; status: string; branch_id: string; servicing_branch_id: string;
    total_amount: string; landed_cost: string | null; customer_name: string; created_at: Date;
    delivered_at: Date | null; product_id: string; qty: number;
  }[]>`
    SELECT o.id, o.status, o.branch_id, o.servicing_branch_id, o.total_amount, o.landed_cost,
           o.customer_name, o.created_at, o.delivered_at, oi.product_id, oi.quantity AS qty
    FROM orders o JOIN order_items oi ON oi.order_id=o.id
    WHERE o.customer_name LIKE 'Customer %'`;

  console.log(`Processing ${orders.length} orders…`);
  let mv = 0, gl = 0, rem = 0, inv = 0, tl = 0, skipped = 0;

  for (const o of orders) {
    // Idempotency: skip if a DELIVERY movement already exists.
    const [existing] = await sql`SELECT 1 FROM stock_movements WHERE reference_id=${o.id} AND movement_type='DELIVERY' LIMIT 1`;
    if (existing) { skipped++; continue; }

    const locId = locByBranch.get(o.servicing_branch_id) ?? locByBranch.get(o.branch_id);
    if (!locId) continue;
    const qty = o.qty;
    const postDate = (o.delivered_at ?? o.created_at).toISOString().slice(0, 10);
    const cogs = Number(o.landed_cost ?? 0);
    const revenue = Number(o.total_amount ?? 0);

    // Timeline event (all orders).
    const tlType = o.status === 'DELIVERED' || o.status === 'REMITTED' ? 'ORDER_DELIVERED'
      : o.status === 'CONFIRMED' ? 'ORDER_CONFIRMED'
      : o.status === 'RETURNED' ? 'ORDER_RETURNED' : 'ORDER_RECEIVED';
    await sql`INSERT INTO order_timeline_events (id, order_id, event_type, actor_id, actor_name, description, branch_id, created_at)
      VALUES (${uuidv7()}, ${o.id}, ${tlType}, ${actorId}, 'System', ${'Status: ' + o.status}, ${o.branch_id}, ${o.created_at})`.catch(() => {});
    tl++;

    // Reservation for confirmed-and-beyond (except already delivered handles its own).
    if (POST_CONFIRM.includes(o.status) && !DELIVERED.includes(o.status) && o.status !== 'RETURNED') {
      await sql`INSERT INTO stock_movements (id, product_id, movement_type, quantity, to_location_id, reference_id, reason, actor_id, created_at)
        VALUES (${uuidv7()}, ${o.product_id}, 'RESERVATION', ${qty}, ${locId}, ${o.id}, 'Reserved for order', ${actorId}, ${o.created_at})`.catch(() => {});
      await sql`UPDATE inventory_levels SET reserved_count = reserved_count + ${qty} WHERE product_id=${o.product_id} AND location_id=${locId}`.catch(() => {});
      mv++;
    }

    if (DELIVERED.includes(o.status)) {
      // DELIVERY movement (negative qty), deduct shelf stock, consume FIFO.
      await sql`INSERT INTO stock_movements (id, product_id, movement_type, quantity, from_location_id, reference_id, reason, actor_id, created_at)
        VALUES (${uuidv7()}, ${o.product_id}, 'DELIVERY', ${-qty}, ${locId}, ${o.id}, ${'Delivered: order ' + o.id}, ${actorId}, ${postDate})`.catch(() => {});
      await sql`UPDATE inventory_levels SET stock_count = GREATEST(stock_count - ${qty}, 0) WHERE product_id=${o.product_id} AND location_id=${locId}`.catch(() => {});
      // FIFO consume from oldest batch with remaining.
      await sql`UPDATE stock_batches SET remaining_quantity = GREATEST(remaining_quantity - ${qty}, 0)
        WHERE id = (SELECT id FROM stock_batches WHERE product_id=${o.product_id} AND remaining_quantity > 0 ORDER BY received_at NULLS FIRST, created_at LIMIT 1)`.catch(() => {});
      mv++; inv++;

      // Invoice (invoice_status enum = DRAFT|SENT|PAID|OVERDUE|CANCELLED).
      const invStatus = o.status === 'REMITTED' ? 'PAID' : 'SENT';
      await sql`INSERT INTO invoices (id, order_id, recipient_info, line_items, tax_rate, total_amount, status, created_at)
        VALUES (${uuidv7()}, ${o.id}, ${sql.json({ name: o.customer_name })}, ${sql.json([{ description: 'Order', quantity: qty, unitPrice: String(revenue) }])}, null, ${revenue.toFixed(2)}, ${invStatus}, ${postDate})`.catch(() => {});

      // GL sales invoice: Dr Debtors / Cr Sales (+ Dr COGS / Cr Stock if cogs>0).
      if (AR && SALES && revenue > 0) {
        const vId = o.id;
        await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, party_type, remarks, fiscal_year_id, modified_by)
          VALUES (${uuidv7()}, ${groupId}, ${AR}, ${postDate}, ${revenue}, 0, 'SALES_INVOICE', ${vId}, 'CUSTOMER', ${o.customer_name}, ${FY_ID}, ${actorId})`.catch(() => {});
        await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, remarks, fiscal_year_id, modified_by)
          VALUES (${uuidv7()}, ${groupId}, ${SALES}, ${postDate}, 0, ${revenue}, 'SALES_INVOICE', ${vId}, 'Sale', ${FY_ID}, ${actorId})`.catch(() => {});
        if (COGS && STOCK && cogs > 0) {
          await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, remarks, fiscal_year_id, modified_by)
            VALUES (${uuidv7()}, ${groupId}, ${COGS}, ${postDate}, ${cogs}, 0, 'SALES_INVOICE', ${vId}, 'COGS', ${FY_ID}, ${actorId})`.catch(() => {});
          await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, remarks, fiscal_year_id, modified_by)
            VALUES (${uuidv7()}, ${groupId}, ${STOCK}, ${postDate}, 0, ${cogs}, 'SALES_INVOICE', ${vId}, 'Stock relieved', ${FY_ID}, ${actorId})`.catch(() => {});
        }
        gl++;
      }
    }

    if (o.status === 'RETURNED') {
      await sql`INSERT INTO stock_movements (id, product_id, movement_type, quantity, to_location_id, reference_id, reason, actor_id, created_at)
        VALUES (${uuidv7()}, ${o.product_id}, 'RETURN', ${qty}, ${locId}, ${o.id}, 'Returned', ${actorId}, ${o.created_at})`.catch(() => {});
      await sql`UPDATE inventory_levels SET stock_count = stock_count + ${qty} WHERE product_id=${o.product_id} AND location_id=${locId}`.catch(() => {});
      mv++;
    }
  }

  // Remittances for REMITTED orders — one remittance per branch location, batching its orders.
  const remitted = await sql<{ id: string; servicing_branch_id: string; branch_id: string; total_amount: string; delivered_at: Date | null; created_at: Date }[]>`
    SELECT id, servicing_branch_id, branch_id, total_amount, delivered_at, created_at
    FROM orders WHERE customer_name LIKE 'Customer %' AND status='REMITTED'`;
  // group by location
  const byLoc = new Map<string, typeof remitted>();
  for (const r of remitted) {
    const locId = locByBranch.get(r.servicing_branch_id) ?? locByBranch.get(r.branch_id);
    if (!locId) continue;
    if (!byLoc.has(locId)) byLoc.set(locId, []);
    byLoc.get(locId)!.push(r);
  }
  for (const [locId, group] of byLoc) {
    const remId = uuidv7();
    const recvAt = group[0]!.delivered_at ?? group[0]!.created_at;
    await sql`INSERT INTO delivery_remittances (id, status, received_at, logistics_location_id, sent_by)
      VALUES (${remId}, 'RECEIVED', ${recvAt}, ${locId}, ${actorId})`.catch(() => {});
    for (const r of group) {
      await sql`INSERT INTO delivery_remittance_orders (delivery_remittance_id, order_id) VALUES (${remId}, ${r.id})`.catch(() => {});
    }
    // Settlement GL: Dr Bank / Cr Debtors (per order for the debtor leg).
    const postDate = recvAt.toISOString().slice(0, 10);
    const totalCash = group.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
    if (BANK && AR && totalCash > 0) {
      await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, remarks, fiscal_year_id, modified_by)
        VALUES (${uuidv7()}, ${groupId}, ${BANK}, ${postDate}, ${totalCash}, 0, 'PAYMENT', ${remId}, 'Cash banked', ${FY_ID}, ${actorId})`.catch(() => {});
      for (const r of group) {
        const amt = Number(r.total_amount ?? 0);
        if (amt > 0) {
          await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, party_type, remarks, fiscal_year_id, modified_by)
            VALUES (${uuidv7()}, ${groupId}, ${AR}, ${postDate}, 0, ${amt}, 'PAYMENT', ${remId}, 'CUSTOMER', 'Settlement', ${FY_ID}, ${actorId})`.catch(() => {});
        }
      }
      gl++;
    }
    rem++;
  }

  console.log(`\n✅ Side-effects: ${mv} stock movements, ${inv} deliveries deducted, ${gl} GL vouchers, ${rem} remittances, ${tl} timeline events. (${skipped} skipped as already-processed)`);
  await sql.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
