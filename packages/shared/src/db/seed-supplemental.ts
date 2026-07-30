/**
 * Supplemental seeder — fills the domains no other seed script covers.
 *
 * Run AFTER seed-full-dataset.ts (needs products, locations, branches, users):
 *   npx tsx packages/shared/src/db/seed-supplemental.ts
 *
 * Covers:
 *   inbound shipments (+ lines)      — supplier receipts feeding FIFO
 *   stock transfers                  — warehouse → 3PL, all lifecycle states
 *   transfer remittances             — 3PL returning stock to warehouse
 *   payroll pay roles + batches      — HR module
 *   journal entries                  — GL manual vouchers
 *   expense submissions              — finance approvals queue
 *   fixed assets                     — depreciation register
 *   budgets                          — marketing/department budgets
 *
 * Idempotent: every insert uses stable UUIDs with ON CONFLICT DO NOTHING.
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
});

// Deterministic PRNG so re-runs produce the same shape.
let _seed = 20260730;
function rand(): number { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]!; }
function randInt(lo: number, hi: number): number { return lo + Math.floor(rand() * (hi - lo + 1)); }
function daysAgo(n: number): Date { return new Date(Date.now() - n * 86400000); }

async function main() {
  console.log('Seeding supplemental domains…');

  // ── Context: reuse what the main seed created ──
  const products = await sql<{ id: string; cost_price: string | null }[]>`
    SELECT id, cost_price FROM products WHERE status = 'ACTIVE' LIMIT 20`;
  const warehouses = await sql<{ id: string }[]>`
    SELECT ll.id FROM logistics_locations ll
    JOIN logistics_providers lp ON lp.id = ll.provider_id
    WHERE ll.status = 'ACTIVE' AND lp.kind = 'WAREHOUSE' LIMIT 10`;
  const allLocations = await sql<{ id: string }[]>`
    SELECT id FROM logistics_locations WHERE status = 'ACTIVE' LIMIT 20`;
  const thirdParties = await sql<{ id: string }[]>`
    SELECT ll.id FROM logistics_locations ll
    JOIN logistics_providers lp ON lp.id = ll.provider_id
    WHERE ll.status = 'ACTIVE' AND lp.kind = 'THIRD_PARTY' LIMIT 10`;
  const branches = await sql<{ id: string }[]>`SELECT id FROM branches LIMIT 10`;
  const admin = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE role = 'SUPER_ADMIN' ORDER BY created_at LIMIT 1`;
  const anyUsers = await sql<{ id: string }[]>`SELECT id FROM users LIMIT 20`;

  const actorId = admin[0]?.id ?? anyUsers[0]?.id;
  if (!products.length || !allLocations.length || !actorId) {
    console.error('Missing prerequisites (products / locations / users). Run seed-full-dataset.ts first.');
    process.exit(1);
  }
  // Source warehouses fall back to any location on datasets without a WAREHOUSE provider.
  const sources = warehouses.length ? warehouses : allLocations;
  const dests = thirdParties.length ? thirdParties : allLocations;

  // ── 1. Inbound shipments + lines ──
  // Mix of lifecycle states so the shipments page has something in each tab.
  const SHIPMENT_STATES = ['CREATED', 'IN_TRANSIT', 'ARRIVED', 'VERIFIED', 'CLOSED'] as const;
  let shipmentCount = 0;
  for (let i = 0; i < 15; i++) {
    const status = SHIPMENT_STATES[i % SHIPMENT_STATES.length]!;
    const shipmentId = uuidv7();
    const dest = pick(sources).id;
    const landing = randInt(50_000, 400_000);
    const createdAt = daysAgo(randInt(5, 90));
    const arrived = ['ARRIVED', 'VERIFIED', 'CLOSED'].includes(status);
    const verified = ['VERIFIED', 'CLOSED'].includes(status);

    const inserted = await sql`
      INSERT INTO shipments (
        id, reference_number, label, status, destination_location_id,
        supplier_name, supplier_reference, total_landing_cost,
        expected_arrival_at, arrived_at, verified_at, closed_at,
        verified_by, notes, created_at, updated_at
      ) VALUES (
        ${shipmentId},
        ${1000 + i},
        ${`Supplier batch ${i + 1}`},
        ${status},
        ${dest},
        ${pick(['Guangzhou Trading Co', 'Shenzhen Health Ltd', 'Lagos Import Partners', 'Istanbul Wellness'])},
        ${`PO-${randInt(10000, 99999)}`},
        ${sql`${landing}::numeric`},
        ${daysAgo(randInt(0, 30))},
        ${arrived ? daysAgo(randInt(1, 20)) : null},
        ${verified ? daysAgo(randInt(0, 10)) : null},
        ${status === 'CLOSED' ? daysAgo(randInt(0, 5)) : null},
        ${verified ? actorId : null},
        ${'Seeded supplier shipment.'},
        ${createdAt}, ${createdAt}
      )
      ON CONFLICT (reference_number) DO NOTHING
      RETURNING id`;
    if (!inserted.length) continue; // already seeded on a previous run
    shipmentCount++;

    const lineCount = randInt(2, 4);
    for (let l = 0; l < lineCount; l++) {
      const p = pick(products);
      const expected = randInt(100, 800);
      // Verified shipments record what actually arrived (sometimes short).
      const received = verified ? Math.max(0, expected - (rand() < 0.25 ? randInt(1, 20) : 0)) : null;
      const factory = Math.max(1, Math.round(parseFloat(p.cost_price ?? '1000') || 1000));
      await sql`
        INSERT INTO shipment_lines (
          id, shipment_id, product_id, expected_quantity, received_quantity,
          factory_cost, allocated_landing_cost, variance_reason, created_at, updated_at
        ) VALUES (
          ${uuidv7()}, ${shipmentId}, ${p.id}, ${expected}, ${received},
          ${sql`${factory}::numeric`},
          ${sql`${Math.round(landing / lineCount)}::numeric`},
          ${received !== null && received < expected ? 'Short shipment confirmed with supplier' : null},
          ${createdAt}, ${createdAt}
        )
        ON CONFLICT (id) DO NOTHING`;
    }
  }
  console.log(`  ✓ ${shipmentCount} inbound shipments (with lines)`);

  // ── 2. Stock transfers (warehouse → 3PL), across lifecycle states ──
  const TRANSFER_STATES = ['PENDING', 'IN_TRANSIT', 'RECEIVED', 'DISPUTED', 'CANCELLED', 'REJECTED'] as const;
  let transferCount = 0;
  // No natural unique key on stock_transfers — skip the block entirely if a
  // previous run already populated it, so re-runs don't pile up duplicates.
  const [{ n: existingTransfers }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM stock_transfers`;
  for (let i = 0; existingTransfers === 0 && i < 24; i++) {
    const status = TRANSFER_STATES[i % TRANSFER_STATES.length]!;
    const sent = randInt(20, 300);
    // quantity_received: NULL until verified. DISPUTED = short receipt.
    const receivedQty =
      status === 'RECEIVED' ? sent :
      status === 'DISPUTED' ? Math.max(0, sent - randInt(1, 15)) :
      null;
    const createdAt = daysAgo(randInt(1, 60));
    const from = pick(sources).id;
    let to = pick(dests).id;
    if (to === from) continue; // never self-transfer (validator forbids it)

    const res = await sql`
      INSERT INTO stock_transfers (
        id, product_id, quantity_sent, quantity_received,
        from_location_id, to_location_id, transfer_status,
        shrinkage_reason, initiated_by, approved_by, approved_at,
        rejected_by, rejected_at, rejection_reason,
        created_at, verified_at
      ) VALUES (
        ${uuidv7()}, ${pick(products).id}, ${sent}, ${receivedQty},
        ${from}, ${to}, ${status},
        ${status === 'DISPUTED' ? 'Units damaged in transit' : null},
        ${actorId},
        ${['RECEIVED', 'IN_TRANSIT', 'DISPUTED'].includes(status) ? actorId : null},
        ${['RECEIVED', 'IN_TRANSIT', 'DISPUTED'].includes(status) ? createdAt : null},
        ${status === 'REJECTED' ? actorId : null},
        ${status === 'REJECTED' ? createdAt : null},
        ${status === 'REJECTED' ? 'Source stock needed for a priority order' : null},
        ${createdAt},
        ${receivedQty !== null ? createdAt : null}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id`;
    if (res.length) transferCount++;
  }
  console.log(`  ✓ ${transferCount} stock transfers`);

  // ── 3. Transfer remittances (3PL sends stock back) ──
  let remittanceCount = 0;
  const [{ n: existingRemittances }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM transfer_remittances`;
  for (let i = 0; existingRemittances === 0 && i < 8; i++) {
    const sent = randInt(10, 120);
    const status = pick(['SENT', 'RECEIVED', 'DISPUTED']);
    const from = pick(dests).id;
    const to = pick(sources).id;
    if (from === to) continue;
    const res = await sql`
      INSERT INTO transfer_remittances (
        id, from_location_id, to_location_id, product_id,
        quantity_sent, quantity_received, receipt_url, status,
        sent_at, sent_by, received_at, received_by, shrinkage_reason
      ) VALUES (
        ${uuidv7()}, ${from}, ${to}, ${pick(products).id},
        ${sent},
        ${status === 'SENT' ? null : status === 'DISPUTED' ? sent - randInt(1, 8) : sent},
        ${'https://example.com/receipts/seed-receipt.jpg'},
        ${status},
        ${daysAgo(randInt(1, 40))}, ${actorId},
        ${status === 'SENT' ? null : daysAgo(randInt(0, 10))},
        ${status === 'SENT' ? null : actorId},
        ${status === 'DISPUTED' ? 'Count mismatch on arrival' : null}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id`;
    if (res.length) remittanceCount++;
  }
  console.log(`  ✓ ${remittanceCount} transfer remittances`);

  // ── 4. Payroll pay roles ──
  const PAY_ROLES: Array<{ name: string; cat: string }> = [
    { name: 'CS Closer', cat: 'CS_CLOSER' },
    { name: 'Media Buyer', cat: 'MEDIA_BUYER' },
    { name: 'Head of CS', cat: 'HEAD_OF_CS' },
    { name: 'Logistics Officer', cat: 'LOGISTICS' },
    { name: 'Finance Officer', cat: 'FINANCE_OFFICER' },
    { name: 'Stock Manager', cat: 'STOCK_MANAGER' },
  ];
  let payRoleCount = 0;
  const [{ n: existingPayRoles }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM payroll_pay_roles`;
  for (const r of existingPayRoles === 0 ? PAY_ROLES : []) {
    const res = await sql`
      INSERT INTO payroll_pay_roles (
        id, name, category, reports_to_required,
        per_product_bonus, active, default_tax_status, created_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${r.name}, ${r.cat},
        ${false}, ${false}, ${true},
        ${'STANDARD_PAYE'}, ${daysAgo(120)}, ${daysAgo(120)}
      )
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (res.length) payRoleCount++;
  }
  console.log(`  ✓ ${payRoleCount} payroll pay roles`);

  // ── 5. Payroll batches (one per month, across the approval chain) ──
  const BATCH_STATES = ['DRAFT', 'PENDING_HR', 'PENDING_FINANCE', 'PAID'] as const;
  const DEPTS = ['CS', 'MARKETING', 'LOGISTICS', 'FINANCE'] as const;
  let batchCount = 0;
  const [{ n: existingBatches }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM payroll_batches`;
  if (branches.length && existingBatches === 0) {
    for (let i = 0; i < 8; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const periodMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const staff = randInt(4, 20);
      const res = await sql`
        INSERT INTO payroll_batches (
          id, branch_id, period_month, department, status,
          staff_count, total_amount, include_contractors, created_at, updated_at
        ) VALUES (
          ${uuidv7()}, ${pick(branches).id}, ${periodMonth},
          ${DEPTS[i % DEPTS.length]}, ${BATCH_STATES[i % BATCH_STATES.length]},
          ${staff}, ${sql`${staff * randInt(120_000, 260_000)}::numeric`},
          ${false}, ${daysAgo(i * 30)}, ${daysAgo(i * 30)}
        )
        ON CONFLICT DO NOTHING
        RETURNING id`;
      if (res.length) batchCount++;
    }
  }
  console.log(`  ✓ ${batchCount} payroll batches`);

  // ── 6. Journal entries (manual GL vouchers) ──
  let jeCount = 0;
  for (let i = 0; i < 12; i++) {
    const amount = randInt(20_000, 500_000);
    const res = await sql`
      INSERT INTO journal_entries (
        id, entry_number, posting_date, description,
        total_debit, total_credit, status, approved_by, created_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${100 + i},
        ${daysAgo(randInt(1, 120))},
        ${pick([
          'Month-end accrual', 'Bank charges reclass', 'Depreciation posting',
          'Petty cash reimbursement', 'FX revaluation', 'Prepaid rent amortisation',
        ])},
        ${sql`${amount}::numeric`}, ${sql`${amount}::numeric`},
        ${i % 4 === 0 ? 'DRAFT' : 'POSTED'},
        ${actorId}, ${daysAgo(randInt(1, 120))}, ${daysAgo(randInt(0, 30))}
      )
      ON CONFLICT (entry_number) DO NOTHING
      RETURNING id`;
    if (res.length) jeCount++;
  }
  console.log(`  ✓ ${jeCount} journal entries`);

  // ── 7. Expense submissions (finance approval queue) ──
  let expCount = 0;
  const [{ n: existingExpenses }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM expense_submissions`;
  for (let i = 0; existingExpenses === 0 && i < 18; i++) {
    const res = await sql`
      INSERT INTO expense_submissions (
        id, submitter_id, vendor_name, description, amount,
        status, created_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${pick(anyUsers).id},
        ${pick(['Konga Supplies', 'MTN Nigeria', 'Ikeja Electric', 'Bolt Business', 'Jumia Office'])},
        ${pick(['Office supplies', 'Airtime and data', 'Electricity bill', 'Staff transport', 'Printer toner'])},
        ${sql`${randInt(5_000, 250_000)}::numeric`},
        ${['PENDING', 'APPROVED', 'REJECTED'][i % 3]},
        ${daysAgo(randInt(1, 60))}, ${daysAgo(randInt(0, 20))}
      )
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (res.length) expCount++;
  }
  console.log(`  ✓ ${expCount} expense submissions`);

  // ── 8. Fixed assets ──
  const ASSETS = [
    { name: 'Delivery Van (Toyota Hiace)', cat: 'VEHICLE', cost: 18_000_000 },
    { name: 'Warehouse Forklift', cat: 'EQUIPMENT', cost: 6_500_000 },
    { name: 'Office Laptops (batch of 10)', cat: 'IT_EQUIPMENT', cost: 4_200_000 },
    { name: 'Standby Generator 30kVA', cat: 'EQUIPMENT', cost: 3_800_000 },
    { name: 'Office Furniture', cat: 'FURNITURE', cost: 1_500_000 },
  ];
  let assetCount = 0;
  const [{ n: existingAssets }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM fixed_assets`;
  for (const a of existingAssets === 0 ? ASSETS : []) {
    const accumulated = Math.round(a.cost * (rand() * 0.4));
    const res = await sql`
      INSERT INTO fixed_assets (
        id, asset_name, asset_category, acquisition_date, cost,
        residual_value, useful_life_months, depreciation_method,
        accumulated_depreciation, status, created_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${a.name}, ${a.cat},
        ${daysAgo(randInt(200, 900))}, ${sql`${a.cost}::numeric`},
        ${sql`${Math.round(a.cost * 0.1)}::numeric`}, ${60},
        ${'STRAIGHT_LINE'},
        ${sql`${accumulated}::numeric`}, ${'ACTIVE'},
        ${daysAgo(300)}, ${daysAgo(10)}
      )
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (res.length) assetCount++;
  }
  console.log(`  ✓ ${assetCount} fixed assets`);

  // ── 9. Budgets ──
  let budgetCount = 0;
  const [{ n: existingBudgets }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM budgets`;
  for (let i = 0; existingBudgets === 0 && i < 6; i++) {
    const start = new Date(); start.setMonth(start.getMonth() - i, 1);
    const end = new Date(start); end.setMonth(end.getMonth() + 1); end.setDate(0);
    const res = await sql`
      INSERT INTO budgets (
        id, name, department_or_campaign, total_budget,
        period_start, period_end, created_by, created_at, updated_at
      ) VALUES (
        ${uuidv7()},
        ${`${['Marketing', 'Logistics', 'CS', 'Operations'][i % 4]} budget ${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`},
        ${['MARKETING', 'LOGISTICS', 'CS', 'OPERATIONS'][i % 4]},
        ${sql`${randInt(2_000_000, 12_000_000)}::numeric`},
        ${start}, ${end}, ${actorId},
        ${start}, ${daysAgo(randInt(0, 15))}
      )
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (res.length) budgetCount++;
  }
  console.log(`  ✓ ${budgetCount} budgets`);

  console.log('\n✅ Supplemental seed complete.');
  await sql.end();
}

main().catch((e) => { console.error('SUPPLEMENTAL SEED FAILED:', e); process.exit(1); });
