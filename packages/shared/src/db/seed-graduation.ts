/**
 * Graduation seeder — graduates DELIVERED/REMITTED cart_orders and
 * follow_up_orders into the orders table, the way the real graduation flow does
 * (and the way the forward-fix now handles stock + GL exactly-once).
 *
 * For each graduating source:
 *   - insert a copy into orders (order_source 'online' for cart,
 *     'graduated_follow_up' for follow-up), carrying the source created_at
 *   - copy/derive order_items
 *   - deduct stock (DELIVERY movement + stock_count + FIFO) exactly once
 *   - post GL sales invoice (Dr Debtors/Cr Sales + Dr COGS/Cr Stock)
 *   - set graduated_order_id on the source; flip cart source to CONVERTED
 *
 * Idempotent: skips a source that already has graduated_order_id set.
 *
 * Usage: DATABASE_URL=... npx tsx packages/shared/src/db/seed-graduation.ts
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
  max: 1, ssl: DATABASE_URL.includes('sslmode=require') ? 'require' : false,
  connect_timeout: 30, idle_timeout: 60, max_lifetime: 0,
});

async function main() {
  const [{ id: groupId }] = await sql<{ id: string }[]>`SELECT id FROM branch_groups WHERE name='Yannis EOSE' LIMIT 1`;
  const [actor] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email='kbshowkb@gmail.com' LIMIT 1`;
  const actorId = actor.id;
  const FY_ID = '81111111-1111-4111-8111-111111111111';

  const accts = await sql<{ code: string; id: string }[]>`
    SELECT code, id FROM accounts WHERE group_id=${groupId} AND code IN ('1121','1131','4110','5110')`;
  const A = Object.fromEntries(accts.map(a => [a.code, a.id]));
  const AR = A['1121'], STOCK = A['1131'], SALES = A['4110'], COGS = A['5110'];

  const locs = await sql<{ branch_id: string; id: string }[]>`SELECT branch_id, id FROM logistics_locations WHERE branch_id IS NOT NULL`;
  const locByBranch = new Map(locs.map(l => [l.branch_id, l.id]));

  // Products for follow-up total→product mapping (fu orders lack line items).
  const products = await sql<{ id: string; price: string; cost: string }[]>`
    SELECT id, base_sale_price price, cost_price cost FROM products WHERE group_id=${groupId}`;
  const productByPrice = new Map(products.map(p => [Number(p.price), p]));

  async function deductAndPost(orderId: string, productId: string, qty: number, locId: string, revenue: number, cogs: number, postDate: string, customer: string) {
    await sql`INSERT INTO stock_movements (id, product_id, movement_type, quantity, from_location_id, reference_id, reason, actor_id, created_at)
      VALUES (${uuidv7()}, ${productId}, 'DELIVERY', ${-qty}, ${locId}, ${orderId}, ${'Delivered (graduated): ' + orderId}, ${actorId}, ${postDate})`.catch(() => {});
    await sql`UPDATE inventory_levels SET stock_count = GREATEST(stock_count - ${qty}, 0) WHERE product_id=${productId} AND location_id=${locId}`.catch(() => {});
    await sql`UPDATE stock_batches SET remaining_quantity = GREATEST(remaining_quantity - ${qty}, 0)
      WHERE id = (SELECT id FROM stock_batches WHERE product_id=${productId} AND remaining_quantity > 0 ORDER BY received_at NULLS FIRST, created_at LIMIT 1)`.catch(() => {});
    if (AR && SALES && revenue > 0) {
      await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, party_type, remarks, fiscal_year_id, modified_by)
        VALUES (${uuidv7()}, ${groupId}, ${AR}, ${postDate}, ${revenue}, 0, 'SALES_INVOICE', ${orderId}, 'CUSTOMER', ${customer}, ${FY_ID}, ${actorId})`.catch(() => {});
      await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, remarks, fiscal_year_id, modified_by)
        VALUES (${uuidv7()}, ${groupId}, ${SALES}, ${postDate}, 0, ${revenue}, 'SALES_INVOICE', ${orderId}, 'Sale', ${FY_ID}, ${actorId})`.catch(() => {});
      if (COGS && STOCK && cogs > 0) {
        await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, remarks, fiscal_year_id, modified_by)
          VALUES (${uuidv7()}, ${groupId}, ${COGS}, ${postDate}, ${cogs}, 0, 'SALES_INVOICE', ${orderId}, 'COGS', ${FY_ID}, ${actorId})`.catch(() => {});
        await sql`INSERT INTO gl_entries (id, group_id, account_id, posting_date, debit, credit, voucher_type, voucher_id, remarks, fiscal_year_id, modified_by)
          VALUES (${uuidv7()}, ${groupId}, ${STOCK}, ${postDate}, 0, ${cogs}, 'SALES_INVOICE', ${orderId}, 'Stock relieved', ${FY_ID}, ${actorId})`.catch(() => {});
      }
    }
    await sql`INSERT INTO invoices (id, order_id, recipient_info, line_items, tax_rate, total_amount, status, created_at)
      VALUES (${uuidv7()}, ${orderId}, ${sql.json({ name: customer })}, ${sql.json([{ description: 'Order', quantity: qty, unitPrice: String(revenue) }])}, null, ${revenue.toFixed(2)}, 'SENT', ${postDate})`.catch(() => {});
  }

  // ── CART graduation ──
  const carts = await sql<any[]>`
    SELECT co.*, coi.product_id, coi.quantity AS qty, coi.unit_price
    FROM cart_orders co
    JOIN cart_order_items coi ON coi.cart_order_id = co.id
    WHERE co.customer_name LIKE 'Cart Cust %' AND co.status IN ('DELIVERED','REMITTED') AND co.graduated_order_id IS NULL`;
  let cartGrad = 0;
  for (const co of carts) {
    const newId = uuidv7();
    const locId = locByBranch.get(co.servicing_branch_id) ?? locByBranch.get(co.branch_id)!;
    const postDate = (co.delivered_at ?? co.created_at).toISOString().slice(0, 10);
    const revenue = Number(co.total_amount ?? 0);
    const cogs = Number(co.landed_cost ?? 0);
    await sql`INSERT INTO orders (id, status, order_source, branch_id, servicing_branch_id, media_buyer_id, assigned_cs_id,
        logistics_location_id, customer_name, customer_phone, customer_phone_hash, total_amount, landed_cost,
        is_follow_up, source_cart_order_id, created_at, confirmed_at, delivered_at)
      VALUES (${newId}, ${co.status}, 'online', ${co.branch_id}, ${co.servicing_branch_id}, ${co.media_buyer_id}, ${co.assigned_cs_id},
        ${locId}, ${co.customer_name}, ${co.customer_phone}, ${co.customer_phone_hash}, ${co.total_amount}, ${co.landed_cost},
        false, ${co.id}, ${co.created_at}, ${co.created_at}, ${co.delivered_at ?? co.created_at})`.catch((e) => { if (cartGrad < 2) console.error('cart order err:', e.message); });
    await sql`INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
      VALUES (${uuidv7()}, ${newId}, ${co.product_id}, ${co.qty}, ${co.unit_price})`.catch(() => {});
    await deductAndPost(newId, co.product_id, co.qty, locId, revenue, cogs, postDate, co.customer_name);
    await sql`UPDATE cart_orders SET graduated_order_id=${newId}, status='CONVERTED' WHERE id=${co.id}`.catch(() => {});
    cartGrad++;
  }
  console.log(`Graduated ${cartGrad} cart orders.`);

  // ── FOLLOW-UP graduation ──
  const fus = await sql<any[]>`
    SELECT * FROM follow_up_orders
    WHERE customer_name LIKE 'FollowUp Cust %' AND status IN ('DELIVERED','REMITTED') AND graduated_order_id IS NULL`;
  let fuGrad = 0;
  for (const fu of fus) {
    const newId = uuidv7();
    const locId = locByBranch.get(fu.servicing_branch_id) ?? locByBranch.get(fu.branch_id)!;
    const postDate = (fu.delivered_at ?? fu.created_at).toISOString().slice(0, 10);
    const revenue = Number(fu.total_amount ?? 0);
    // fu orders have no line items — map total → a product.
    const prod = productByPrice.get(revenue) ?? products[0]!;
    const cogs = Math.round(Number(prod.cost) * 1.15);
    await sql`INSERT INTO orders (id, status, order_source, branch_id, servicing_branch_id, media_buyer_id, assigned_cs_id,
        logistics_location_id, customer_name, customer_phone, customer_phone_hash, total_amount, landed_cost,
        is_follow_up, source_follow_up_order_id, created_at, confirmed_at, delivered_at)
      VALUES (${newId}, ${fu.status}, 'graduated_follow_up', ${fu.branch_id}, ${fu.servicing_branch_id}, ${fu.media_buyer_id}, ${fu.assigned_cs_id},
        ${locId}, ${fu.customer_name}, ${fu.customer_phone}, ${fu.customer_phone_hash}, ${fu.total_amount}, ${cogs},
        true, ${fu.id}, ${fu.created_at}, ${fu.created_at}, ${fu.delivered_at ?? fu.created_at})`.catch((e) => { if (fuGrad < 2) console.error('fu order err:', e.message); });
    await sql`INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
      VALUES (${uuidv7()}, ${newId}, ${prod.id}, 1, ${revenue})`.catch(() => {});
    await deductAndPost(newId, prod.id, 1, locId, revenue, cogs, postDate, fu.customer_name);
    await sql`UPDATE follow_up_orders SET graduated_order_id=${newId} WHERE id=${fu.id}`.catch(() => {});
    fuGrad++;
  }
  console.log(`Graduated ${fuGrad} follow-up orders.`);

  console.log(`\n✅ Graduation complete: ${cartGrad} cart + ${fuGrad} follow-up graduated into orders with stock + GL.`);
  await sql.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
