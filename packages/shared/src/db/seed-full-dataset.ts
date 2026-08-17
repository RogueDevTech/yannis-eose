/**
 * Full realistic dataset seed (current schema, multi-company aware).
 *
 * Builds an end-to-end connected dataset:
 *   1 company (branch_group) → 3 branches → 4 categories → 9 products
 *   → per-branch logistics location + FIFO stock batches + inventory levels
 *   → 13 users (all roles) → 3 campaigns
 *   → ~1000 orders spread across branches, statuses, products, and dates
 *   → cart_orders + follow_up_orders + delivery remittances
 *
 * Idempotent-ish: uses stable UUIDs for reference rows (ON CONFLICT DO NOTHING);
 * orders are additive (safe to run once). Preserves the existing kbshowkb admin.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx packages/shared/src/db/seed-full-dataset.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { uuidv7 } from 'uuidv7';
import { normalizePhoneForHash } from '../currency/african-countries';

config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../../apps/api/.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(DATABASE_URL, { max: 1, ssl: DATABASE_URL.includes('sslmode=require') ? 'require' : false });

const PASSWORD = 'Yannis2026!';
const SALT_ROUNDS = 12;
const TOTAL_ORDERS = 1000;

// Deterministic PRNG (no Math.random reliance for reproducibility across runs)
let _seed = 987654321;
function rand(): number { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]!; }
function randInt(lo: number, hi: number): number { return lo + Math.floor(rand() * (hi - lo + 1)); }

function hashPhone(phone: string): string {
  return createHash('sha256').update(`yannis:phone:${normalizePhoneForHash(phone)}`).digest('hex');
}
function randomPhone(): string { return '080' + String(randInt(10000000, 99999999)); }

// ── Stable reference IDs ──
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCHES = [
  { id: '21111111-1111-4111-8111-111111111111', name: 'Lagos HQ', code: 'LGS' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Abuja Branch', code: 'ABJ' },
  { id: '23333333-3333-4333-8333-333333333333', name: 'Port Harcourt', code: 'PHC' },
];
const CATEGORIES = [
  { id: '31111111-1111-4111-8111-111111111111', name: 'Wellness', brand: 'Yannis' },
  { id: '32222222-2222-4222-8222-222222222222', name: 'Herbal', brand: 'Yannis' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Supplements', brand: 'Yannis' },
  { id: '34444444-4444-4444-8444-444444444444', name: 'Personal Care', brand: 'Yannis' },
];
const PRODUCTS = [
  { id: '41111111-1111-4111-8111-111111111111', name: 'MADHUHARA', cat: 0, price: 25000, cost: 9000 },
  { id: '42222222-2222-4222-8222-222222222222', name: 'ARJUNA', cat: 1, price: 18000, cost: 6500 },
  { id: '43333333-3333-4333-8333-333333333333', name: 'LASUNA', cat: 1, price: 15000, cost: 5000 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'LIV T-550', cat: 2, price: 22000, cost: 8000 },
  { id: '45555555-5555-4555-8555-555555555555', name: 'BCG-35', cat: 2, price: 20000, cost: 7000 },
  { id: '46666666-6666-4666-8666-666666666666', name: 'YASTIMADHU', cat: 0, price: 17000, cost: 6000 },
  { id: '47777777-7777-4777-8777-777777777777', name: 'BRAHMI SHAKTI', cat: 0, price: 19000, cost: 6800 },
  { id: '48888888-8888-4888-8888-888888888888', name: 'LITOX', cat: 3, price: 12000, cost: 4000 },
  { id: '49999999-9999-4999-8999-999999999999', name: 'DIABAL', cat: 2, price: 30000, cost: 11000 },
];

const USERS = [
  { id: uuidv7(), name: 'Tunde Balogun', email: 'hom@yannis.dev', role: 'HEAD_OF_MARKETING', phone: '08031000001' },
  { id: uuidv7(), name: 'Paul Oluwatobi', email: 'mb1@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000002' },
  { id: uuidv7(), name: 'Grace Eze', email: 'mb2@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000003' },
  { id: uuidv7(), name: 'Head of CS', email: 'hocs@yannis.dev', role: 'HEAD_OF_CS', phone: '08031000004' },
  { id: uuidv7(), name: 'Amaka CS', email: 'cs1@yannis.dev', role: 'CS_CLOSER', phone: '08031000005' },
  { id: uuidv7(), name: 'Bola CS', email: 'cs2@yannis.dev', role: 'CS_CLOSER', phone: '08031000006' },
  { id: uuidv7(), name: 'Chidi CS', email: 'cs3@yannis.dev', role: 'CS_CLOSER', phone: '08031000007' },
  { id: uuidv7(), name: 'Finance Officer', email: 'finance@yannis.dev', role: 'FINANCE_OFFICER', phone: '08031000008' },
  { id: uuidv7(), name: 'Head Logistics', email: 'hol@yannis.dev', role: 'HEAD_OF_LOGISTICS', phone: '08031000009' },
  { id: uuidv7(), name: 'Stock Manager', email: 'stock@yannis.dev', role: 'STOCK_MANAGER', phone: '08031000010' },
  { id: uuidv7(), name: 'Branch Admin', email: 'branchadmin@yannis.dev', role: 'BRANCH_ADMIN', phone: '08031000011' },
  { id: uuidv7(), name: 'Auditor', email: 'auditor@yannis.dev', role: 'AUDITOR', phone: '08031000012' },
  { id: uuidv7(), name: 'Admin User', email: 'admin@yannis.dev', role: 'ADMIN', phone: '08031000013' },
];

// Order status distribution (weighted toward the funnel middle + delivered)
const STATUS_WEIGHTS: Array<[string, number]> = [
  ['UNPROCESSED', 8], ['CS_ASSIGNED', 8], ['CS_ENGAGED', 10], ['CONFIRMED', 12],
  ['AGENT_ASSIGNED', 8], ['DISPATCHED', 6], ['IN_TRANSIT', 6],
  ['DELIVERED', 22], ['REMITTED', 10], ['RETURNED', 3], ['DELETED', 3],
];
function weightedStatus(): string {
  const total = STATUS_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [st, w] of STATUS_WEIGHTS) { if ((r -= w) <= 0) return st; }
  return 'CONFIRMED';
}
const POST_CONFIRM = new Set(['CONFIRMED','AGENT_ASSIGNED','DISPATCHED','IN_TRANSIT','DELIVERED','PARTIALLY_DELIVERED','REMITTED','RETURNED']);
const DELIVERED_SET = new Set(['DELIVERED','REMITTED']);

async function main() {
  console.log('Seeding full dataset…');
  const hash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  // 1. Company
  await sql`INSERT INTO branch_groups (id, name) VALUES (${COMPANY_ID}, 'Yannis EOSE') ON CONFLICT (id) DO NOTHING`;

  // 2. Branches
  for (const b of BRANCHES) {
    await sql`INSERT INTO branches (id, name, code, group_id, status)
      VALUES (${b.id}, ${b.name}, ${b.code}, ${COMPANY_ID}, 'ACTIVE') ON CONFLICT (id) DO NOTHING`;
  }

  // 3. Categories
  for (const c of CATEGORIES) {
    await sql`INSERT INTO product_categories (id, name, brand_name, group_id)
      VALUES (${c.id}, ${c.name}, ${c.brand}, ${COMPANY_ID}) ON CONFLICT (id) DO NOTHING`;
  }

  // 4. Products
  for (const p of PRODUCTS) {
    await sql`INSERT INTO products (id, name, base_sale_price, cost_price, category_id, group_id, status)
      VALUES (${p.id}, ${p.name}, ${p.price}, ${p.cost}, ${CATEGORIES[p.cat]!.id}, ${COMPANY_ID}, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING`;
  }

  // 5. Users (all roles) — password Yannis2026!
  for (const u of USERS) {
    await sql`INSERT INTO users (id, name, email, password_hash, role, status, scope_global, primary_branch_id)
      VALUES (${u.id}, ${u.name}, ${u.email}, ${hash}, ${u.role}, 'ACTIVE',
              ${['HEAD_OF_MARKETING','HEAD_OF_CS','HEAD_OF_LOGISTICS','FINANCE_OFFICER','ADMIN','AUDITOR'].includes(u.role)},
              ${pick(BRANCHES).id})
      ON CONFLICT (email) DO NOTHING`;
    // Branch membership
    await sql`INSERT INTO user_branches (user_id, branch_id)
      VALUES (${u.id}, ${pick(BRANCHES).id}) ON CONFLICT DO NOTHING`.catch(() => {});
  }
  // Re-read the ACTUAL ids from the DB by email — on a re-run the users already
  // exist with ids from the first run, so the in-memory uuidv7() ids won't match.
  const dbUsers = await sql<{ id: string; email: string; role: string }[]>`
    SELECT id, email, role FROM users WHERE email = ANY(${USERS.map(u => u.email)})`;
  const idByEmail = new Map(dbUsers.map(u => [u.email, u.id]));
  for (const u of USERS) { const real = idByEmail.get(u.email); if (real) u.id = real; }
  const mbs = USERS.filter(u => u.role === 'MEDIA_BUYER');
  const closers = USERS.filter(u => u.role === 'CS_CLOSER');

  // 6. Logistics provider + one location per branch
  const providerId = '51111111-1111-4111-8111-111111111111';
  await sql`INSERT INTO logistics_providers (id, name, group_id) VALUES (${providerId}, 'Yannis Logistics', ${COMPANY_ID}) ON CONFLICT (id) DO NOTHING`;
  const LOC_UUIDS = [
    '61111111-1111-4111-8111-111111111111',
    '62222222-2222-4222-8222-222222222222',
    '63333333-3333-4333-8333-333333333333',
  ];
  const branchLocation: Record<string, string> = {};
  BRANCHES.forEach((b, idx) => { branchLocation[b.id] = LOC_UUIDS[idx]!; });
  for (let idx = 0; idx < BRANCHES.length; idx++) {
    const b = BRANCHES[idx]!;
    await sql`INSERT INTO logistics_locations (id, provider_id, name, address, branch_id, status)
      VALUES (${LOC_UUIDS[idx]}, ${providerId}, ${b.name + ' Hub'}, ${b.name + ' warehouse'}, ${b.id}, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING`;
  }

  // 7. FIFO stock batches (global per product) + inventory levels per (product, location).
  //    stock_batches has no location column — batches are product-level; location
  //    stock lives in inventory_levels. One batch per product for FIFO landed cost.
  for (const p of PRODUCTS) {
    const factory = p.cost;
    const landing = Math.round(p.cost * 0.15);
    const totalLanded = factory + landing;
    const batchQty = randInt(2000, 6000);
    await sql`INSERT INTO stock_batches (id, product_id, factory_cost, landing_cost, total_landed_cost, quantity, remaining_quantity)
      VALUES (${uuidv7()}, ${p.id}, ${factory}, ${landing}, ${totalLanded}, ${batchQty}, ${batchQty})`.catch(() => {});
  }
  for (const b of BRANCHES) {
    const locId = branchLocation[b.id]!;
    for (const p of PRODUCTS) {
      const qty = randInt(200, 1500);
      await sql`INSERT INTO inventory_levels (id, product_id, location_id, branch_id, stock_count, reserved_count)
        VALUES (${uuidv7()}, ${p.id}, ${locId}, ${b.id}, ${qty}, 0)
        ON CONFLICT DO NOTHING`.catch(() => {});
    }
  }

  // 8. Campaigns (per media buyer) — deterministic id per MB so re-runs reuse.
  const campaigns: string[] = [];
  for (let ci = 0; ci < mbs.length; ci++) {
    const mb = mbs[ci]!;
    const cId = `71111111-1111-4111-8111-00000000000${ci + 1}`;
    await sql`INSERT INTO campaigns (id, name, media_buyer_id, branch_id)
      VALUES (${cId}, ${'Campaign ' + mb.name}, ${mb.id}, ${pick(BRANCHES).id})
      ON CONFLICT (id) DO NOTHING`.catch((e) => console.error('campaign err:', e.message));
    campaigns.push(cId);
  }

  console.log('Reference data seeded. Generating orders…');

  // 9. ~1000 orders spread across branches / statuses / products / dates
  const now = Date.now();
  let created = 0;
  for (let i = 0; i < TOTAL_ORDERS; i++) {
    const branch = pick(BRANCHES);
    const status = weightedStatus();
    const product = pick(PRODUCTS);
    const qty = randInt(1, 3);
    const mb = pick(mbs);
    const closer = pick(closers);
    const daysAgo = randInt(0, 120);
    const createdAt = new Date(now - daysAgo * 86400000);
    const phone = randomPhone();
    const orderId = uuidv7();
    const totalAmount = product.price * qty;
    const landed = POST_CONFIRM.has(status) ? Math.round(product.cost * 1.15) * qty : null;
    const locId = branchLocation[branch.id]!;
    const confirmedAt = POST_CONFIRM.has(status) ? createdAt : null;
    const deliveredAt = DELIVERED_SET.has(status) ? new Date(createdAt.getTime() + 86400000 * randInt(1, 5)) : null;

    await sql`INSERT INTO orders (
      id, status, order_source, branch_id, servicing_branch_id, campaign_id, media_buyer_id, assigned_cs_id,
      logistics_location_id, customer_name, customer_phone, customer_phone_hash, customer_address,
      total_amount, landed_cost, is_follow_up, created_at, confirmed_at, delivered_at
    ) VALUES (
      ${orderId}, ${status}, ${'edge-form'}, ${branch.id}, ${branch.id}, ${pick(campaigns)}, ${mb.id},
      ${status === 'UNPROCESSED' ? null : closer.id}, ${POST_CONFIRM.has(status) ? locId : null},
      ${'Customer ' + i}, ${phone}, ${hashPhone(phone)}, ${'No. ' + randInt(1, 200) + ' ' + branch.name + ' St'},
      ${totalAmount}, ${landed}, false, ${createdAt}, ${confirmedAt}, ${deliveredAt}
    )`.catch((e) => { if (i < 3) console.error('order insert err:', e.message); });

    await sql`INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
      VALUES (${uuidv7()}, ${orderId}, ${product.id}, ${qty}, ${product.price})`.catch((e) => { if (created < 3) console.error('item err:', e.message); });
    created++;
  }
  const [{ n: realOrders }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM orders`;
  console.log(`Attempted ${created} orders; DB now has ${realOrders} orders.`);

  // 10. Cart orders (~120) — separate pipeline.
  // Each cart order descends from a cart_abandonments row (FK
  // cart_orders.source_cart_id → cart_abandonments.id), so seed the parent
  // first. Errors are surfaced, not swallowed: silently catching them made
  // this block report success while inserting nothing.
  let carts = 0;
  let cartFailures = 0;
  for (let i = 0; i < 120; i++) {
    const branch = pick(BRANCHES);
    const product = pick(PRODUCTS);
    const qty = randInt(1, 2);
    const status = pick(['UNPROCESSED', 'CS_ENGAGED', 'CONFIRMED', 'DELIVERED', 'REMITTED']);
    const phone = randomPhone();
    const cartId = uuidv7();
    const abandonmentId = uuidv7();
    const daysAgo = randInt(0, 90);
    const createdAt = new Date(now - daysAgo * 86400000);
    const campaignId = pick(campaigns);
    try {
      await sql`INSERT INTO cart_abandonments (id, campaign_id, media_buyer_id, product_id,
          customer_name, customer_phone, customer_phone_hash, quantity, status, created_at, updated_at)
        VALUES (${abandonmentId}, ${campaignId}, ${pick(mbs).id}, ${product.id},
          ${'Cart Cust ' + i}, ${phone}, ${hashPhone(phone)}, ${qty}, ${'CONVERTED'},
          ${createdAt}, ${createdAt})`;
      await sql`INSERT INTO cart_orders (id, source_cart_id, status, branch_id, servicing_branch_id, media_buyer_id,
          customer_name, customer_phone, customer_phone_hash, total_amount, landed_cost, created_at)
        VALUES (${cartId}, ${abandonmentId}, ${status}, ${branch.id}, ${branch.id}, ${pick(mbs).id},
          ${'Cart Cust ' + i}, ${phone}, ${hashPhone(phone)}, ${product.price * qty},
          ${DELIVERED_SET.has(status) ? Math.round(product.cost * 1.15) * qty : null}, ${createdAt})`;
      await sql`INSERT INTO cart_order_items (id, cart_order_id, product_id, quantity, unit_price)
        VALUES (${uuidv7()}, ${cartId}, ${product.id}, ${qty}, ${product.price})`;
      carts++;
    } catch (err) {
      cartFailures++;
      if (cartFailures === 1) console.warn(`  cart order insert failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`Created ${carts} cart orders${cartFailures ? ` (${cartFailures} failed)` : ''}.`);

  // 11. Follow-up orders (~80)
  let fus = 0;
  let fuFailures = 0;
  for (let i = 0; i < 80; i++) {
    const branch = pick(BRANCHES);
    const product = pick(PRODUCTS);
    const status = pick(['UNPROCESSED', 'CS_ENGAGED', 'CONFIRMED', 'DELIVERED']);
    const phone = randomPhone();
    const fuId = uuidv7();
    const daysAgo = randInt(0, 90);
    try {
      await sql`INSERT INTO follow_up_orders (id, status, branch_id, servicing_branch_id, media_buyer_id,
          customer_name, customer_phone, customer_phone_hash, total_amount, created_at)
        VALUES (${fuId}, ${status}, ${branch.id}, ${branch.id}, ${pick(mbs).id},
          ${'FollowUp Cust ' + i}, ${phone}, ${hashPhone(phone)}, ${product.price},
          ${new Date(now - daysAgo * 86400000)})`;
      fus++;
    } catch (err) {
      fuFailures++;
      if (fuFailures === 1) console.warn(`  follow-up insert failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`Created ${fus} follow-up orders${fuFailures ? ` (${fuFailures} failed)` : ''}.`);

  console.log('\n✅ Full dataset seed complete.');
  await sql.end();
}

main().catch((e) => { console.error('SEED FAILED:', e); process.exit(1); });
