/**
 * Database seed script — creates realistic development data.
 *
 * Usage:
 *   pnpm db:seed              # Base seed only
 *   pnpm db:seed -- --heavy   # Base + heavy data (orders, ad spend, etc.)
 *   pnpm db:seed -- --reset   # Truncate then full base seed
 *   pnpm db:seed -- --reset --heavy  # Truncate then base + heavy
 *
 * Env: DATABASE_URL required (loads from repo root .env if present). SEED_ORDER_COUNT (default 500, max 2000) for --heavy.
 * All user emails: kbshowkb+<role><index>@gmail.com
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from monorepo root when run from packages/shared
config({ path: resolve(__dirname, '../../../../.env') });

import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { faker } from '@faker-js/faker';

const SALT_ROUNDS = 12;

const argv = process.argv.slice(2);
const isHeavy = argv.includes('--heavy');
const isReset = argv.includes('--reset');
const SEED_ORDER_COUNT = Math.min(
  2000,
  Math.max(100, parseInt(process.env['SEED_ORDER_COUNT'] ?? '500', 10) || 500)
);

const CS_AGENT_COUNT = 12;
const MEDIA_BUYER_COUNT = 20;
const RIDER_COUNT = 5;
const CAMPAIGNS_PER_MB = 3;

// ── Deterministic IDs for foreign key references ────────────────────

function buildIds() {
  const csAgentIds = Array.from({ length: CS_AGENT_COUNT }, () => randomUUID());
  const mediaBuyerIds = Array.from({ length: MEDIA_BUYER_COUNT }, () => randomUUID());
  const riderIds = Array.from({ length: RIDER_COUNT }, () => randomUUID());

  return {
    superAdmin: randomUUID(),
    headOfMarketing: randomUUID(),
    headOfCs: randomUUID(),
    financeOfficer: randomUUID(),
    headOfLogistics: randomUUID(),
    warehouseManager: randomUUID(),
    tplManager1: randomUUID(),
    tplManager2: randomUUID(),
    hrManager: randomUUID(),
    csAgentIds,
    mediaBuyerIds,
    riderIds,

    product1: randomUUID(),
    product2: randomUUID(),
    product3: randomUUID(),
    product4: randomUUID(),
    product5: randomUUID(),

    provider1: randomUUID(),
    provider2: randomUUID(),
    locationMain: randomUUID(),
    location1: randomUUID(),
    location2: randomUUID(),

    batch1p1: randomUUID(),
    batch2p1: randomUUID(),
    batch1p2: randomUUID(),
    batch1p3: randomUUID(),
    batch1p4: randomUUID(),
    batch1p5: randomUUID(),

    offer1: randomUUID(),
    offer2: randomUUID(),
    offer3: randomUUID(),

    campaign1: randomUUID(),
    campaign2: randomUUID(),
    campaign3: randomUUID(),

    order1: randomUUID(),
    order2: randomUUID(),
    order3: randomUUID(),
    order4: randomUUID(),
    order5: randomUUID(),
    order6: randomUUID(),
    order7: randomUUID(),
    order8: randomUUID(),
    order9: randomUUID(),
    order10: randomUUID(),

    csPlan: randomUUID(),
    mbPlan: randomUUID(),
    riderPlan: randomUUID(),

    budget1: randomUUID(),
    budget2: randomUUID(),
  };
}

let IDS: ReturnType<typeof buildIds>;

async function truncateAll(sql: postgres.Sql) {
  const tables = [
    'notifications', 'call_logs', 'order_items', 'order_transfer_requests', 'orders', 'invoices',
    'earnings_adjustments', 'payout_records', 'approval_requests', 'ad_spend_logs', 'marketing_funding',
    'campaigns', 'user_product_assignments', 'budgets', 'settlement_configs', 'commission_plans',
    'stock_movements', 'stock_transfers', 'inventory_levels', 'stock_batches', 'offer_templates',
    'logistics_locations', 'logistics_providers', 'email_change_requests', 'users',
  ];
  for (const table of tables) {
    await sql.unsafe(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`).catch(() => {});
  }
}

async function seed() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  IDS = buildIds();
  const sql = postgres(connectionString, { max: 1 });

  const seedAdminEmail = 'kbshowkb+admin@gmail.com';

  if (isReset) {
    console.log('Resetting database (truncating seed tables)...');
    await truncateAll(sql);
    console.log('Truncate done.\n');
  } else {
    const existing = await sql`SELECT id FROM users WHERE email = ${seedAdminEmail}`;
    if (existing.length > 0) {
      console.log('Seed data already exists. Use --reset to truncate and re-seed, or --heavy to add heavy data only.');
      await sql.end();
      return;
    }
  }

  console.log('Seeding database...\n');

  const password = 'password123';
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  const csNames = ['Tunde Bello', 'Chisom Nwankwo', 'Yemi Alade', 'Blessing Okoro', 'Ibrahim Musa', 'Chioma Eze', 'Oluwaseun Ade', 'Amina Hassan', 'David Okonkwo', 'Ngozi Nwosu', 'Emeka Okafor', 'Fatima Bello'];
  const mbNames = ['Chidi Eze', 'Amara Obi', 'Kunle Adeyemi', 'Zainab Ibrahim', 'Obinna Nnamdi', 'Folake Ogun', 'Yusuf Sani', 'Adaeze Okoli', 'Biola Taiwo', 'Ibrahim Musa', 'Chiamaka Nwosu', 'Tunde Bakare', 'Amina Hassan', 'Emeka Okafor', 'Nneka Eze', 'Seyi Ade', 'Halima Umar', 'Chukwuemeka Obi', 'Funke Ola', 'Oluwaseun Balogun'];

  // ══════════════════════════════════════════════════════════════════
  // 1. USERS — 12 CS agents, 20 media buyers, all emails kbshowkb+...@gmail.com
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating users...');

  const users: Array<{ id: string; name: string; email: string; role: string; capacity: number; locationId: string | null; phone: string }> = [
    { id: IDS.superAdmin, name: 'Adewale Okafor', email: seedAdminEmail, role: 'SUPER_ADMIN', capacity: 100, locationId: null, phone: '08030001111' },
    { id: IDS.headOfMarketing, name: 'Funke Adeyemi', email: 'kbshowkb+hom@gmail.com', role: 'HEAD_OF_MARKETING', capacity: 50, locationId: null, phone: '08030002222' },
    ...IDS.mediaBuyerIds.map((id, i) => ({
      id,
      name: mbNames[i] ?? `Media Buyer ${i + 1}`,
      email: `kbshowkb+mb${i + 1}@gmail.com`,
      role: 'MEDIA_BUYER' as const,
      capacity: 20,
      locationId: null as string | null,
      phone: `0803000${String(i + 3).padStart(4, '0')}`.slice(-11),
    })),
    { id: IDS.headOfCs, name: 'Ngozi Udo', email: 'kbshowkb+hocs@gmail.com', role: 'HEAD_OF_CS', capacity: 50, locationId: null, phone: '08030005555' },
    ...IDS.csAgentIds.map((id, i) => ({
      id,
      name: csNames[i] ?? `CS Agent ${i + 1}`,
      email: `kbshowkb+cs${i + 1}@gmail.com`,
      role: 'CS_AGENT' as const,
      capacity: 10,
      locationId: null as string | null,
      phone: `0803000${String(i + 6).padStart(4, '0')}`.slice(-11),
    })),
    { id: IDS.financeOfficer, name: 'Kemi Johnson', email: 'kbshowkb+finance@gmail.com', role: 'FINANCE_OFFICER', capacity: 50, locationId: null, phone: '08030009999' },
    { id: IDS.headOfLogistics, name: 'Emeka Nwosu', email: 'kbshowkb+hol@gmail.com', role: 'HEAD_OF_LOGISTICS', capacity: 50, locationId: null, phone: '08031001111' },
    { id: IDS.warehouseManager, name: 'Bola Taiwo', email: 'kbshowkb+warehouse@gmail.com', role: 'WAREHOUSE_MANAGER', capacity: 50, locationId: null, phone: '08031002222' },
    { id: IDS.tplManager1, name: 'Ife Akin', email: 'kbshowkb+tpl1@gmail.com', role: 'TPL_MANAGER', capacity: 30, locationId: null, phone: '08031003333' },
    { id: IDS.tplManager2, name: 'Sola Bakare', email: 'kbshowkb+tpl2@gmail.com', role: 'TPL_MANAGER', capacity: 30, locationId: null, phone: '08031004444' },
    ...IDS.riderIds.map((id, i) => ({
      id,
      name: ['Segun Ola', 'Dayo Ige', 'Femi Ogunleye', 'Tosin Ade', 'Bisi Oka'][i] ?? `Rider ${i + 1}`,
      email: `kbshowkb+rider${i + 1}@gmail.com`,
      role: 'TPL_RIDER' as const,
      capacity: 15,
      locationId: null as string | null,
      phone: `0803100${String(i + 5).padStart(4, '0')}`.slice(-11),
    })),
    { id: IDS.hrManager, name: 'Aisha Bello', email: 'kbshowkb+hr@gmail.com', role: 'HR_MANAGER', capacity: 50, locationId: null, phone: '08031008888' },
  ];

  for (const u of users) {
    await sql`
      INSERT INTO users (id, name, email, password_hash, role, status, capacity, phone)
      VALUES (${u.id}, ${u.name}, ${u.email}, ${hash}, ${u.role}, 'ACTIVE', ${u.capacity}, ${u.phone})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 2. PRODUCTS (5 products with realistic Nigerian e-commerce items)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating products...');

  const products = [
    { id: IDS.product1, name: 'Slim Fit Waist Trainer', baseSalePrice: '12500.00', costPrice: '3500.00', category: 'Health & Beauty', description: 'Premium waist trainer, adjustable compression, all sizes',
      offers: JSON.stringify([{ label: 'Buy 1', qty: 1, price: '12500.00' }, { label: 'Buy 2 Get 1 Free', qty: 3, price: '22000.00' }]) },
    { id: IDS.product2, name: 'Portable Blender Pro', baseSalePrice: '18000.00', costPrice: '6000.00', category: 'Kitchen', description: 'USB-C rechargeable blender, 6-blade, 400ml capacity',
      offers: JSON.stringify([{ label: 'Single Unit', qty: 1, price: '18000.00' }, { label: 'Double Pack', qty: 2, price: '30000.00' }]) },
    { id: IDS.product3, name: 'LED Ring Light 10"', baseSalePrice: '8500.00', costPrice: '2800.00', category: 'Electronics', description: '10-inch ring light with tripod stand, 3 color modes',
      offers: JSON.stringify([{ label: 'Standard', qty: 1, price: '8500.00' }]) },
    { id: IDS.product4, name: 'Smart Watch X1', baseSalePrice: '22000.00', costPrice: '8500.00', category: 'Electronics', description: 'Fitness tracker, heart rate, blood pressure, IP68 waterproof',
      offers: JSON.stringify([{ label: 'Buy 1', qty: 1, price: '22000.00' }, { label: 'Buy 1 Get 1 Free', qty: 2, price: '35000.00' }, { label: 'Family Pack (3)', qty: 3, price: '50000.00' }]) },
    { id: IDS.product5, name: 'Hair Growth Oil Bundle', baseSalePrice: '9500.00', costPrice: '2200.00', category: 'Health & Beauty', description: '3-piece set: growth oil, edge control, scalp treatment',
      offers: JSON.stringify([{ label: 'Single Set', qty: 1, price: '9500.00' }, { label: 'Buy 3 Get 2 Free', qty: 5, price: '25000.00' }]) },
  ];

  for (const p of products) {
    await sql`
      INSERT INTO products (id, name, offers, base_sale_price, cost_price, category, description, status)
      VALUES (${p.id}, ${p.name}, ${p.offers}::jsonb, ${p.baseSalePrice}, ${p.costPrice}, ${p.category}, ${p.description}, 'ACTIVE')
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 3. LOGISTICS PROVIDERS & LOCATIONS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating logistics providers & locations...');

  await sql`
    INSERT INTO logistics_providers (id, name, contact_info, coverage_area, rate_card, status)
    VALUES
      (${IDS.provider1}, 'SwiftDeliver Lagos', '08050001111', 'Lagos, Ogun, Oyo', ${'{"zone_1": 1500, "zone_2": 2500, "zone_3": 3500}'}::jsonb, 'ACTIVE'),
      (${IDS.provider2}, 'GoRide Abuja', '08050002222', 'FCT, Nasarawa, Niger', ${'{"zone_1": 2000, "zone_2": 3000, "zone_3": 4000}'}::jsonb, 'ACTIVE')
  `;

  await sql`
    INSERT INTO logistics_locations (id, provider_id, name, address, coordinates, dispatch_locked, status)
    VALUES
      (${IDS.locationMain}, ${IDS.provider1}, 'Main Warehouse Lagos', '12 Industrial Avenue, Ikeja, Lagos', '6.6018,3.3515', false, 'ACTIVE'),
      (${IDS.location1}, ${IDS.provider1}, 'SwiftDeliver Lekki Hub', '45 Admiralty Way, Lekki Phase 1', '6.4541,3.4754', false, 'ACTIVE'),
      (${IDS.location2}, ${IDS.provider2}, 'GoRide Wuse Hub', '22 Aminu Kano Crescent, Wuse II, Abuja', '9.0765,7.4898', false, 'ACTIVE')
  `;

  // Assign TPL managers and riders to locations (riders 1,2,4,5 at location1; rider 3 at location2)
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.tplManager1}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location2} WHERE id = ${IDS.tplManager2}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.riderIds[0]!}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.riderIds[1]!}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location2} WHERE id = ${IDS.riderIds[2]!}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.riderIds[3]!}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.riderIds[4]!}`;

  // ══════════════════════════════════════════════════════════════════
  // 4. STOCK BATCHES (FIFO costing)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating stock batches...');

  const batches = [
    { id: IDS.batch1p1, productId: IDS.product1, factoryCost: '3500.00', landingCost: '800.00', totalLandedCost: '4300.00', qty: 200, remaining: 150 },
    { id: IDS.batch2p1, productId: IDS.product1, factoryCost: '3800.00', landingCost: '900.00', totalLandedCost: '4700.00', qty: 100, remaining: 100 },
    { id: IDS.batch1p2, productId: IDS.product2, factoryCost: '6000.00', landingCost: '1200.00', totalLandedCost: '7200.00', qty: 150, remaining: 120 },
    { id: IDS.batch1p3, productId: IDS.product3, factoryCost: '2800.00', landingCost: '600.00', totalLandedCost: '3400.00', qty: 300, remaining: 270 },
    { id: IDS.batch1p4, productId: IDS.product4, factoryCost: '8500.00', landingCost: '1800.00', totalLandedCost: '10300.00', qty: 100, remaining: 80 },
    { id: IDS.batch1p5, productId: IDS.product5, factoryCost: '2200.00', landingCost: '500.00', totalLandedCost: '2700.00', qty: 250, remaining: 220 },
  ];

  for (const b of batches) {
    await sql`
      INSERT INTO stock_batches (id, product_id, factory_cost, landing_cost, total_landed_cost, quantity, remaining_quantity)
      VALUES (${b.id}, ${b.productId}, ${b.factoryCost}, ${b.landingCost}, ${b.totalLandedCost}, ${b.qty}, ${b.remaining})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 5. INVENTORY LEVELS (stock by location)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating inventory levels...');

  const levels = [
    // Main warehouse
    { productId: IDS.product1, locationId: IDS.locationMain, stock: 150, reserved: 10, status: 'AVAILABLE' },
    { productId: IDS.product2, locationId: IDS.locationMain, stock: 80, reserved: 5, status: 'AVAILABLE' },
    { productId: IDS.product3, locationId: IDS.locationMain, stock: 180, reserved: 8, status: 'AVAILABLE' },
    { productId: IDS.product4, locationId: IDS.locationMain, stock: 50, reserved: 3, status: 'AVAILABLE' },
    { productId: IDS.product5, locationId: IDS.locationMain, stock: 140, reserved: 12, status: 'AVAILABLE' },
    // SwiftDeliver Lekki
    { productId: IDS.product1, locationId: IDS.location1, stock: 60, reserved: 5, status: 'AVAILABLE' },
    { productId: IDS.product2, locationId: IDS.location1, stock: 30, reserved: 2, status: 'AVAILABLE' },
    { productId: IDS.product3, locationId: IDS.location1, stock: 50, reserved: 3, status: 'AVAILABLE' },
    // GoRide Wuse
    { productId: IDS.product1, locationId: IDS.location2, stock: 40, reserved: 3, status: 'AVAILABLE' },
    { productId: IDS.product4, locationId: IDS.location2, stock: 30, reserved: 2, status: 'AVAILABLE' },
    { productId: IDS.product5, locationId: IDS.location2, stock: 80, reserved: 5, status: 'AVAILABLE' },
  ];

  for (const l of levels) {
    await sql`
      INSERT INTO inventory_levels (id, product_id, location_id, stock_count, reserved_count, status)
      VALUES (gen_random_uuid(), ${l.productId}, ${l.locationId}, ${l.stock}, ${l.reserved}, ${l.status})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 6. STOCK MOVEMENTS (recent history)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating stock movements...');

  const movements = [
    { productId: IDS.product1, type: 'INTAKE', qty: 200, toLocationId: IDS.locationMain, reason: 'Batch 1 received from supplier', actorId: IDS.warehouseManager },
    { productId: IDS.product1, type: 'TRANSFER_OUT', qty: -60, fromLocationId: IDS.locationMain, toLocationId: IDS.location1, reason: 'Transfer to Lekki hub', actorId: IDS.warehouseManager },
    { productId: IDS.product1, type: 'TRANSFER_IN', qty: 60, fromLocationId: IDS.locationMain, toLocationId: IDS.location1, reason: 'Received from main warehouse', actorId: IDS.tplManager1 },
    { productId: IDS.product2, type: 'INTAKE', qty: 150, toLocationId: IDS.locationMain, reason: 'Batch received from factory', actorId: IDS.warehouseManager },
    { productId: IDS.product1, type: 'RESERVATION', qty: -10, fromLocationId: IDS.locationMain, reason: 'Reserved for confirmed orders', actorId: IDS.csAgentIds[0]! },
    { productId: IDS.product3, type: 'INTAKE', qty: 300, toLocationId: IDS.locationMain, reason: 'Full batch intake', actorId: IDS.warehouseManager },
    { productId: IDS.product4, type: 'INTAKE', qty: 100, toLocationId: IDS.locationMain, reason: 'Smart watch batch', actorId: IDS.warehouseManager },
    { productId: IDS.product5, type: 'INTAKE', qty: 250, toLocationId: IDS.locationMain, reason: 'Hair product bundle batch', actorId: IDS.warehouseManager },
  ];

  for (const m of movements) {
    await sql`
      INSERT INTO stock_movements (id, product_id, movement_type, quantity, from_location_id, to_location_id, reason, actor_id)
      VALUES (gen_random_uuid(), ${m.productId}, ${m.type}, ${m.qty}, ${m.fromLocationId ?? null}, ${m.toLocationId ?? null}, ${m.reason}, ${m.actorId})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 7. STOCK TRANSFERS (1 completed, 1 pending)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating stock transfers...');

  await sql`
    INSERT INTO stock_transfers (id, product_id, quantity_sent, quantity_received, from_location_id, to_location_id, transfer_status, verified_at)
    VALUES
      (gen_random_uuid(), ${IDS.product1}, 60, 58, ${IDS.locationMain}, ${IDS.location1}, 'RECEIVED', NOW() - INTERVAL '3 days'),
      (gen_random_uuid(), ${IDS.product4}, 30, null, ${IDS.locationMain}, ${IDS.location2}, 'PENDING', null)
  `;

  // ══════════════════════════════════════════════════════════════════
  // 8. OFFER TEMPLATES
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating offer templates...');

  await sql`
    INSERT INTO offer_templates (id, product_id, name, price, variants, created_by, status)
    VALUES
      (${IDS.offer1}, ${IDS.product1}, 'Waist Trainer Flash Sale', '9999.00', ${JSON.stringify([{ size: 'S/M', price: 9999 }, { size: 'L/XL', price: 10999 }])}::jsonb, ${IDS.warehouseManager}, 'ACTIVE'),
      (${IDS.offer2}, ${IDS.product2}, 'Blender Pro Combo', '15500.00', null, ${IDS.warehouseManager}, 'ACTIVE'),
      (${IDS.offer3}, ${IDS.product5}, 'Hair Growth Complete Kit', '8500.00', null, ${IDS.warehouseManager}, 'ACTIVE')
  `;

  // ══════════════════════════════════════════════════════════════════
  // 9. CAMPAIGNS — 3 per media buyer (60 total) for heavy seed distribution
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating campaigns...');

  const offers = [IDS.offer1, IDS.offer2, IDS.offer3] as const;
  const productIdLists = [[IDS.product1], [IDS.product2], [IDS.product5]] as const;
  const campaignRows: Array<{ id: string; mediaBuyerId: string; name: string; productIds: string[]; offerId: string }> = [];

  for (let mb = 0; mb < MEDIA_BUYER_COUNT; mb++) {
    for (let c = 0; c < CAMPAIGNS_PER_MB; c++) {
      const id = randomUUID();
      const offerIdx = (mb * CAMPAIGNS_PER_MB + c) % 3;
      campaignRows.push({
        id,
        mediaBuyerId: IDS.mediaBuyerIds[mb]!,
        name: `Campaign ${mb + 1}-${c + 1}`,
        productIds: [...productIdLists[offerIdx]!],
        offerId: offers[offerIdx]!,
      });
    }
  }

  for (const row of campaignRows) {
    await sql`
      INSERT INTO campaigns (id, media_buyer_id, name, product_ids, offer_template_id, deployment_type, status)
      VALUES (${row.id}, ${row.mediaBuyerId}, ${row.name}, ${JSON.stringify(row.productIds)}::jsonb, ${row.offerId}, 'HOSTED', 'ACTIVE')
    `;
  }

  // Keep first 3 campaigns for base orders (same MBs as before)
  const campaign1 = campaignRows[0]!.id;
  const campaign2 = campaignRows[1]!.id;
  const campaign3 = campaignRows[2]!.id;

  // ══════════════════════════════════════════════════════════════════
  // 10. ORDERS (10 base orders in various states)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating orders...');

  const orders = [
    {
      id: IDS.order1, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      status: 'UNPROCESSED', customerName: 'Blessing Okonkwo', customerPhoneHash: 'hash_08012345001',
      customerAddress: '15 Akin Adesola St, Victoria Island, Lagos',
      deliveryAddress: '15 Akin Adesola St, Victoria Island, Lagos',
      totalAmount: '9999.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 9999 }]),
    },
    {
      id: IDS.order2, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!,
      status: 'UNPROCESSED', customerName: 'Emeka Uche', customerPhoneHash: 'hash_08012345002',
      customerAddress: '8 Adeola Odeku, Lekki, Lagos',
      deliveryAddress: '8 Adeola Odeku, Lekki, Lagos',
      totalAmount: '8500.00', items: JSON.stringify([{ productId: IDS.product5, quantity: 1, unitPrice: 8500 }]),
    },
    {
      id: IDS.order3, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[0], status: 'CS_ENGAGED',
      customerName: 'Fatima Abdullahi', customerPhoneHash: 'hash_08012345003',
      customerAddress: '22 Awolowo Road, Ikoyi, Lagos',
      deliveryAddress: '22 Awolowo Road, Ikoyi, Lagos',
      totalAmount: '10999.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 10999 }]),
    },
    {
      id: IDS.order4, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[1], status: 'CONFIRMED',
      customerName: 'Chidinma Okafor', customerPhoneHash: 'hash_08012345004',
      customerAddress: '5 Allen Avenue, Ikeja, Lagos',
      deliveryAddress: '5 Allen Avenue, Ikeja, Lagos',
      totalAmount: '15500.00', items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 15500 }]),
    },
    {
      id: IDS.order5, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[0], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      status: 'ALLOCATED',
      customerName: 'Adaeze Nnamdi', customerPhoneHash: 'hash_08012345005',
      customerAddress: '10 Ajose Adeogun, VI, Lagos',
      deliveryAddress: '10 Ajose Adeogun, VI, Lagos',
      totalAmount: '9999.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 9999 }]),
    },
    {
      id: IDS.order6, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[1], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.riderIds[0], status: 'DISPATCHED', deliveryOtp: '4821',
      customerName: 'Oluwaseun Balogun', customerPhoneHash: 'hash_08012345006',
      customerAddress: '33 Admiralty Way, Lekki Phase 1',
      deliveryAddress: '33 Admiralty Way, Lekki Phase 1',
      totalAmount: '15500.00', items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 15500 }]),
    },
    {
      id: IDS.order7, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!,
      assignedCsId: IDS.csAgentIds[2], logisticsProviderId: IDS.provider2, logisticsLocationId: IDS.location2,
      riderId: IDS.riderIds[2], status: 'IN_TRANSIT', deliveryOtp: '7293',
      customerName: 'Hauwa Ibrahim', customerPhoneHash: 'hash_08012345007',
      customerAddress: '14 Gana Street, Maitama, Abuja',
      deliveryAddress: '14 Gana Street, Maitama, Abuja',
      totalAmount: '8500.00', items: JSON.stringify([{ productId: IDS.product5, quantity: 1, unitPrice: 8500 }]),
    },
    {
      id: IDS.order8, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[0], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.riderIds[1], status: 'DELIVERED',
      deliveryOtp: '1547', deliveryGpsLat: '6.4541', deliveryGpsLng: '3.4754',
      customerName: 'Grace Okechukwu', customerPhoneHash: 'hash_08012345008',
      customerAddress: '7 Ozumba Mbadiwe, VI, Lagos',
      deliveryAddress: '7 Ozumba Mbadiwe, VI, Lagos',
      totalAmount: '9999.00', landedCost: '4300.00', deliveryFee: '1500.00',
      items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 9999 }]),
    },
    {
      id: IDS.order9, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[1], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.riderIds[0], status: 'COMPLETED',
      deliveryOtp: '3890', deliveryGpsLat: '6.4312', deliveryGpsLng: '3.4521',
      customerName: 'Samuel Taiwo', customerPhoneHash: 'hash_08012345009',
      customerAddress: '20 Ligali Ayorinde, VI, Lagos',
      deliveryAddress: '20 Ligali Ayorinde, VI, Lagos',
      totalAmount: '18000.00', landedCost: '7200.00', deliveryFee: '1500.00',
      items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 18000 }]),
    },
    {
      id: IDS.order10, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!,
      assignedCsId: IDS.csAgentIds[2], status: 'CANCELLED',
      customerName: 'Mohammed Yusuf', customerPhoneHash: 'hash_08012345010',
      customerAddress: '3 IBB Boulevard, Abuja',
      deliveryAddress: '3 IBB Boulevard, Abuja',
      totalAmount: '22000.00', items: JSON.stringify([{ productId: IDS.product4, quantity: 1, unitPrice: 22000 }]),
    },
  ];

  for (const o of orders) {
    await sql`
      INSERT INTO orders (
        id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
        rider_id, status, customer_name, customer_phone_hash, customer_address, delivery_address,
        total_amount, landed_cost, delivery_fee, delivery_otp, delivery_gps_lat, delivery_gps_lng,
        items
      ) VALUES (
        ${o.id}, ${o.campaignId}, ${o.mediaBuyerId}, ${o.assignedCsId ?? null},
        ${o.logisticsProviderId ?? null}, ${o.logisticsLocationId ?? null},
        ${o.riderId ?? null}, ${o.status}, ${o.customerName}, ${o.customerPhoneHash},
        ${o.customerAddress}, ${o.deliveryAddress},
        ${o.totalAmount}, ${o.landedCost ?? null}, ${o.deliveryFee ?? null},
        ${o.deliveryOtp ?? null}, ${o.deliveryGpsLat ?? null}, ${o.deliveryGpsLng ?? null},
        ${o.items}::jsonb
      )
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 11. ORDER ITEMS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating order items...');

  const orderItems = [
    { orderId: IDS.order1, productId: IDS.product1, qty: 1, unitPrice: '9999.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order2, productId: IDS.product5, qty: 1, unitPrice: '8500.00', batchId: IDS.batch1p5 },
    { orderId: IDS.order3, productId: IDS.product1, qty: 1, unitPrice: '10999.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order4, productId: IDS.product2, qty: 1, unitPrice: '15500.00', batchId: IDS.batch1p2 },
    { orderId: IDS.order5, productId: IDS.product1, qty: 1, unitPrice: '9999.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order6, productId: IDS.product2, qty: 1, unitPrice: '15500.00', batchId: IDS.batch1p2 },
    { orderId: IDS.order7, productId: IDS.product5, qty: 1, unitPrice: '8500.00', batchId: IDS.batch1p5 },
    { orderId: IDS.order8, productId: IDS.product1, qty: 1, unitPrice: '9999.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order9, productId: IDS.product2, qty: 1, unitPrice: '18000.00', batchId: IDS.batch1p2 },
    { orderId: IDS.order10, productId: IDS.product4, qty: 1, unitPrice: '22000.00', batchId: IDS.batch1p4 },
  ];

  for (const oi of orderItems) {
    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
      VALUES (gen_random_uuid(), ${oi.orderId}, ${oi.productId}, ${oi.qty}, ${oi.unitPrice}, ${oi.batchId})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 12. CALL LOGS (for CS_ENGAGED and confirmed+ orders)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating call logs...');

  const callLogs = [
    { orderId: IDS.order3, agentId: IDS.csAgentIds[0]!, status: 'IN_PROGRESS', duration: null },
    { orderId: IDS.order4, agentId: IDS.csAgentIds[1]!, status: 'COMPLETED', duration: 45 },
    { orderId: IDS.order5, agentId: IDS.csAgentIds[0]!, status: 'COMPLETED', duration: 32 },
    { orderId: IDS.order8, agentId: IDS.csAgentIds[0]!, status: 'COMPLETED', duration: 28 },
    { orderId: IDS.order9, agentId: IDS.csAgentIds[1]!, status: 'COMPLETED', duration: 55 },
    { orderId: IDS.order10, agentId: IDS.csAgentIds[2]!, status: 'COMPLETED', duration: 18 },
  ];

  for (const cl of callLogs) {
    await sql`
      INSERT INTO call_logs (id, order_id, agent_id, call_token, call_status, duration_seconds)
      VALUES (gen_random_uuid(), ${cl.orderId}, ${cl.agentId}, ${randomUUID()}, ${cl.status}, ${cl.duration})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 13. MARKETING FUNDING
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating marketing funding...');

  for (let i = 0; i < MEDIA_BUYER_COUNT; i++) {
    const daysAgo = 30 - i;
    const amount = `${200000 + i * 10000}.00`;
    await sql`
      INSERT INTO marketing_funding (id, sender_id, receiver_id, amount, receipt_url, status, sent_at, verified_at)
      VALUES (
        gen_random_uuid(), ${IDS.headOfMarketing}, ${IDS.mediaBuyerIds[i]!},
        ${amount}, 'https://storage.example.com/receipts/funding.jpg', 'COMPLETED',
        NOW() - (${daysAgo} * INTERVAL '1 day'), NOW() - (${daysAgo - 1} * INTERVAL '1 day')
      )
    `;
  }
  await sql`
    INSERT INTO marketing_funding (id, sender_id, receiver_id, amount, receipt_url, status, sent_at, verified_at)
    VALUES (gen_random_uuid(), ${IDS.headOfMarketing}, ${IDS.mediaBuyerIds[0]!}, '200000.00', 'https://storage.example.com/receipts/funding-pending.jpg', 'SENT', NOW() - INTERVAL '1 day', null)
  `;

  // ══════════════════════════════════════════════════════════════════
  // 14. AD SPEND LOGS (daily spend entries)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating ad spend logs...');

  const adSpendEntries: Array<{ mbId: string; productId: string; campaignId: string; amount: string; daysAgo: number }> = [];
  for (let i = 0; i < Math.min(20, campaignRows.length); i++) {
    const row = campaignRows[i]!;
    for (let d = 1; d <= 5; d++) {
      adSpendEntries.push({
        mbId: row.mediaBuyerId,
        productId: row.productIds[0]!,
        campaignId: row.id,
        amount: String(25000 + Math.floor(Math.random() * 20000)) + '.00',
        daysAgo: d,
      });
    }
  }

  for (const as of adSpendEntries) {
    await sql`
      INSERT INTO ad_spend_logs (id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date)
      VALUES (
        gen_random_uuid(), ${as.mbId}, ${as.productId}, ${as.campaignId}, ${as.amount},
        'https://storage.example.com/screenshots/ads-screenshot.jpg',
        NOW() - ${`${as.daysAgo} days`}::interval
      )
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 15. INVOICES
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating invoices...');

  await sql`
    INSERT INTO invoices (id, order_id, recipient_info, line_items, tax_rate, total_amount, status, due_date)
    VALUES
      (gen_random_uuid(), ${IDS.order8},
        ${JSON.stringify({ name: 'Grace Okechukwu', email: 'grace@example.com', address: '7 Ozumba Mbadiwe, VI, Lagos' })}::jsonb,
        ${JSON.stringify([{ description: 'Slim Fit Waist Trainer', quantity: 1, unitPrice: 9999, amount: 9999 }])}::jsonb,
        '0.075', '10748.93', 'PAID', NOW() + INTERVAL '30 days'),
      (gen_random_uuid(), ${IDS.order9},
        ${JSON.stringify({ name: 'Samuel Taiwo', email: 'samuel@example.com', address: '20 Ligali Ayorinde, VI, Lagos' })}::jsonb,
        ${JSON.stringify([{ description: 'Portable Blender Pro', quantity: 1, unitPrice: 18000, amount: 18000 }])}::jsonb,
        '0.075', '19350.00', 'PAID', NOW() + INTERVAL '30 days')
  `;

  // ══════════════════════════════════════════════════════════════════
  // 16. COMMISSION PLANS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating commission plans...');

  const csRules = {
    baseSalary: 50000,
    perDeliveredOrder: 500,
    performanceMultipliers: { deliveryRate_90_plus: 1.2, deliveryRate_95_plus: 1.5 },
    thresholds: { minOrdersForBonus: 10, bonusAmount: 5000 },
  };

  const mbRules = {
    baseSalary: 40000,
    perDeliveredOrder: 300,
    performanceMultipliers: { roas_3_plus: 1.3, roas_5_plus: 1.8 },
    thresholds: { minOrdersForBonus: 20, bonusAmount: 10000 },
  };

  const riderRules = {
    baseSalary: 30000,
    perDelivery: 800,
    performanceMultipliers: { onTimeRate_95_plus: 1.2 },
    thresholds: { minDeliveriesForBonus: 50, bonusAmount: 8000 },
  };

  await sql`
    INSERT INTO commission_plans (id, role, plan_name, rules, effective_from, created_by)
    VALUES
      (${IDS.csPlan}, 'CS_AGENT', '2026 Q1 CS Agent Plan', ${JSON.stringify(csRules)}::jsonb, NOW() - INTERVAL '30 days', ${IDS.hrManager}),
      (${IDS.mbPlan}, 'MEDIA_BUYER', '2026 Q1 Media Buyer Plan', ${JSON.stringify(mbRules)}::jsonb, NOW() - INTERVAL '30 days', ${IDS.hrManager}),
      (${IDS.riderPlan}, 'TPL_RIDER', '2026 Q1 Rider Plan', ${JSON.stringify(riderRules)}::jsonb, NOW() - INTERVAL '30 days', ${IDS.hrManager})
  `;

  // Assign commission plans to users
  await sql`UPDATE users SET commission_plan_id = ${IDS.csPlan} WHERE role = 'CS_AGENT'`;
  await sql`UPDATE users SET commission_plan_id = ${IDS.mbPlan} WHERE role = 'MEDIA_BUYER'`;
  await sql`UPDATE users SET commission_plan_id = ${IDS.riderPlan} WHERE role = 'TPL_RIDER'`;

  // ══════════════════════════════════════════════════════════════════
  // 17. PAYOUT RECORDS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating payout records...');

  const payouts: Array<{ staffId: string; base: string; bonus: string; addOns: string; deductions: string; total: string; status: string }> = [];
  for (let i = 0; i < CS_AGENT_COUNT; i++) {
    payouts.push({ staffId: IDS.csAgentIds[i]!, base: '50000.00', bonus: '5000.00', addOns: '0.00', deductions: '0.00', total: '55000.00', status: i % 3 === 0 ? 'APPROVED' : 'PENDING_APPROVAL' });
  }
  for (let i = 0; i < MEDIA_BUYER_COUNT; i++) {
    payouts.push({ staffId: IDS.mediaBuyerIds[i]!, base: '40000.00', bonus: '8000.00', addOns: '0.00', deductions: '0.00', total: '48000.00', status: i % 2 === 0 ? 'PAID' : 'APPROVED' });
  }
  for (let i = 0; i < RIDER_COUNT; i++) {
    payouts.push({ staffId: IDS.riderIds[i]!, base: '30000.00', bonus: '6000.00', addOns: '0.00', deductions: '0.00', total: '36000.00', status: 'APPROVED' });
  }

  for (const p of payouts) {
    await sql`
      INSERT INTO payout_records (id, staff_id, period_start, period_end, base_salary, performance_bonus, add_ons_total, deductions_total, total_payout, status)
      VALUES (
        gen_random_uuid(), ${p.staffId},
        NOW() - INTERVAL '30 days', NOW(),
        ${p.base}, ${p.bonus}, ${p.addOns}, ${p.deductions}, ${p.total}, ${p.status}
      )
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 18. EARNINGS ADJUSTMENTS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating earnings adjustments...');

  await sql`
    INSERT INTO earnings_adjustments (id, staff_id, amount, category, reason, approved_by)
    VALUES
      (gen_random_uuid(), ${IDS.csAgentIds[0]!}, '2000.00', 'BONUS', 'Employee of the month — January 2026', ${IDS.hrManager}),
      (gen_random_uuid(), ${IDS.csAgentIds[1]!}, '-500.00', 'CLAWBACK', 'Order returned: customer rejected delivery', ${IDS.hrManager}),
      (gen_random_uuid(), ${IDS.mediaBuyerIds[0]!}, '5000.00', 'PERFORMANCE', 'Exceeded Q1 ROAS target by 40%', ${IDS.hrManager}),
      (gen_random_uuid(), ${IDS.riderIds[0]!}, '-800.00', 'DEDUCTION', 'Late delivery penalty — 3 orders', ${IDS.hrManager})
  `;

  // ══════════════════════════════════════════════════════════════════
  // 19. BUDGETS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating budgets...');

  await sql`
    INSERT INTO budgets (id, name, department_or_campaign, total_budget, period_start, period_end, created_by)
    VALUES
      (${IDS.budget1}, 'Marketing Q1 2026', 'marketing', '2000000.00', '2026-01-01'::timestamp, '2026-03-31'::timestamp, ${IDS.financeOfficer}),
      (${IDS.budget2}, 'Logistics Q1 2026', 'logistics', '800000.00', '2026-01-01'::timestamp, '2026-03-31'::timestamp, ${IDS.financeOfficer})
  `;

  // ══════════════════════════════════════════════════════════════════
  // 20. APPROVAL REQUESTS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating approval requests...');

  await sql`
    INSERT INTO approval_requests (id, type, requester_id, amount, description, status, budget_id)
    VALUES
      (gen_random_uuid(), 'MEDIA_SPEND', ${IDS.headOfMarketing}, '500000.00', 'Additional ad budget for February blitz campaign', 'APPROVED', ${IDS.budget1}),
      (gen_random_uuid(), 'PROCUREMENT', ${IDS.warehouseManager}, '350000.00', 'Emergency restock of Waist Trainers — supplier minimum order', 'PENDING', null),
      (gen_random_uuid(), 'LOGISTICS_REIMBURSEMENT', ${IDS.headOfLogistics}, '45000.00', 'Fuel reimbursement for Abuja deliveries — January', 'PENDING', ${IDS.budget2})
  `;

  // ══════════════════════════════════════════════════════════════════
  // 21. SETTLEMENT CONFIG
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating settlement config...');

  await sql`
    INSERT INTO settlement_configs (id, window_type, start_day, created_by)
    VALUES (gen_random_uuid(), 'MONTHLY', 1, ${IDS.hrManager})
  `;

  // ══════════════════════════════════════════════════════════════════
  // 22. NOTIFICATIONS (sample)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating notifications...');

  const notifications: Array<{ userId: string; type: string; title: string; body: string; data: object }> = [
    { userId: IDS.headOfLogistics, type: 'transfer_pending', title: 'Transfer Pending Verification', body: 'Stock transfer of Smart Watch X1 to GoRide Wuse Hub awaiting verification.', data: {} },
    { userId: IDS.financeOfficer, type: 'approval_pending', title: 'Approval Request', body: 'Emergency restock request from Warehouse Manager needs review.', data: {} },
    { userId: IDS.superAdmin, type: 'system', title: 'System Ready', body: 'Yannis EOSE seed data loaded successfully.', data: {} },
  ];
  for (let i = 0; i < CS_AGENT_COUNT; i++) {
    notifications.push({ userId: IDS.csAgentIds[i]!, type: 'order_assigned', title: 'New Order Assigned', body: `You have new orders in your queue.`, data: {} });
  }
  for (let i = 0; i < MEDIA_BUYER_COUNT; i++) {
    notifications.push({ userId: IDS.mediaBuyerIds[i]!, type: 'funding_received', title: 'Funding Received', body: 'You received funding from Head of Marketing. Please verify.', data: {} });
  }

  for (const n of notifications) {
    await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, read)
      VALUES (gen_random_uuid(), ${n.userId}, ${n.type}, ${n.title}, ${n.body}, ${JSON.stringify(n.data)}::jsonb, false)
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 23. USER-PRODUCT ASSIGNMENTS (for restricted access users)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating user-product assignments...');

  const assignments: Array<{ userId: string; productId: string }> = [];
  const productIds = [IDS.product1, IDS.product2, IDS.product3, IDS.product4, IDS.product5];
  for (let i = 0; i < MEDIA_BUYER_COUNT; i++) {
    for (const pid of productIds) {
      assignments.push({ userId: IDS.mediaBuyerIds[i]!, productId: pid });
    }
  }

  for (const a of assignments) {
    await sql`
      INSERT INTO user_product_assignments (id, user_id, product_id)
      VALUES (gen_random_uuid(), ${a.userId}, ${a.productId})
    `;
  }

  let heavyOrdersCount = 0;
  if (isHeavy) {
    heavyOrdersCount = await seedHeavy(sql, {
      campaignRows,
      orderCount: SEED_ORDER_COUNT,
      csAgentIds: IDS.csAgentIds,
      mediaBuyerIds: IDS.mediaBuyerIds,
      riderIds: IDS.riderIds,
      location1: IDS.location1,
      location2: IDS.location2,
      provider1: IDS.provider1,
      provider2: IDS.provider2,
      productIds: [IDS.product1, IDS.product2, IDS.product3, IDS.product4, IDS.product5],
      batchByProduct: {
        [IDS.product1]: IDS.batch1p1,
        [IDS.product2]: IDS.batch1p2,
        [IDS.product3]: IDS.batch1p3,
        [IDS.product4]: IDS.batch1p4,
        [IDS.product5]: IDS.batch1p5,
      },
      headOfMarketingId: IDS.headOfMarketing,
      hrManagerId: IDS.hrManager,
    });
  }

  // ══════════════════════════════════════════════════════════════════
  // DONE
  // ══════════════════════════════════════════════════════════════════

  console.log('\n========================================');
  console.log('  Seed complete!');
  console.log('========================================');
  console.log('\n  Login Credentials (all users):');
  console.log(`  Password: ${password}`);
  console.log('\n  User Accounts (emails: kbshowkb+...@gmail.com):');
  console.log('  ─────────────────────────────────────');
  for (const u of users) {
    console.log(`  ${u.role.padEnd(20)} ${u.name.padEnd(22)} ${u.email}`);
  }
  console.log('\n  Data Summary:');
  console.log(`  Users:              ${users.length}`);
  console.log(`  Products:           ${products.length}`);
  console.log(`  Campaigns:          ${campaignRows.length}`);
  console.log(`  Orders (base):     ${orders.length}`);
  if (isHeavy) console.log(`  Orders (heavy):    ${heavyOrdersCount}`);
  console.log(`  Call Logs:          ${callLogs.length}`);
  console.log(`  Ad Spend Entries:   ${adSpendEntries.length}`);
  console.log(`  Payout Records:     ${payouts.length}`);
  console.log(`  Notifications:      ${notifications.length}`);
  console.log('');

  await sql.end();
}

const ORDER_STATUSES_FOR_HEAVY = [
  'DELIVERED', 'DELIVERED', 'DELIVERED', 'COMPLETED', 'COMPLETED', 'COMPLETED',
  'IN_TRANSIT', 'IN_TRANSIT', 'DISPATCHED', 'DISPATCHED',
  'CONFIRMED', 'CONFIRMED', 'ALLOCATED', 'ALLOCATED',
  'UNPROCESSED', 'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED',
  'CANCELLED', 'CANCELLED',
] as const;

async function seedHeavy(
  sql: postgres.Sql,
  opts: {
    campaignRows: Array<{ id: string; mediaBuyerId: string; productIds: string[] }>;
    orderCount: number;
    csAgentIds: string[];
    mediaBuyerIds: string[];
    riderIds: string[];
    location1: string;
    location2: string;
    provider1: string;
    provider2: string;
    productIds: string[];
    batchByProduct: Record<string, string>;
    headOfMarketingId: string;
    hrManagerId: string;
  }
): Promise<number> {
  faker.seed(12345);

  const riderIdsByLocation: Record<string, string[]> = {
    [opts.location1]: [opts.riderIds[0]!, opts.riderIds[1]!, opts.riderIds[3]!, opts.riderIds[4]!],
    [opts.location2]: [opts.riderIds[2]!],
  };
  const providerByLocation: Record<string, string> = {
    [opts.location1]: opts.provider1,
    [opts.location2]: opts.provider2,
  };

  const BATCH_SIZE = 150;
  let inserted = 0;

  console.log(`\n  [Heavy] Creating ${opts.orderCount} orders...`);

  for (let offset = 0; offset < opts.orderCount; offset += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, opts.orderCount - offset);
    const orderRows: Array<{
      id: string;
      campaignId: string;
      mediaBuyerId: string;
      assignedCsId: string | null;
      logisticsProviderId: string | null;
      logisticsLocationId: string | null;
      riderId: string | null;
      status: string;
      customerName: string;
      customerPhoneHash: string;
      customerAddress: string;
      deliveryAddress: string;
      totalAmount: string;
      landedCost: string | null;
      deliveryFee: string | null;
      deliveryOtp: string | null;
      deliveryGpsLat: string | null;
      deliveryGpsLng: string | null;
      items: string;
      createdAt: Date;
    }> = [];
    const orderItemRows: Array<{ orderId: string; productId: string; qty: number; unitPrice: string; batchId: string }> = [];
    const callLogRows: Array<{ orderId: string; agentId: string; status: string; duration: number | null }> = [];

    for (let i = 0; i < count; i++) {
      const orderId = randomUUID();
      const status = faker.helpers.arrayElement(ORDER_STATUSES_FOR_HEAVY);
      const campaign = faker.helpers.arrayElement(opts.campaignRows);
      const productId = campaign.productIds[0] ?? opts.productIds[0]!;
      const batchId = opts.batchByProduct[productId] ?? opts.batchByProduct[opts.productIds[0]!]!;
      const unitPrice = faker.number.int({ min: 8000, max: 25000 });
      const totalAmount = String(unitPrice);

      const needsCs = !['UNPROCESSED', 'CANCELLED'].includes(status);
      const needsRider = ['DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED'].includes(status);
      const csIdx = (offset + i) % opts.csAgentIds.length;
      const assignedCsId = needsCs ? opts.csAgentIds[csIdx]! : null;

      let logisticsLocationId: string | null = null;
      let logisticsProviderId: string | null = null;
      let riderId: string | null = null;
      let deliveryOtp: string | null = null;
      let deliveryGpsLat: string | null = null;
      let deliveryGpsLng: string | null = null;
      let landedCost: string | null = null;
      let deliveryFee: string | null = null;

      if (needsRider) {
        const loc = faker.helpers.arrayElement([opts.location1, opts.location2]);
        const riders = riderIdsByLocation[loc]!;
        riderId = faker.helpers.arrayElement(riders);
        logisticsLocationId = loc;
        logisticsProviderId = providerByLocation[loc]!;
        deliveryOtp = faker.string.numeric(4);
        if (status === 'DELIVERED' || status === 'COMPLETED') {
          deliveryGpsLat = '6.4' + faker.string.numeric(4);
          deliveryGpsLng = '3.4' + faker.string.numeric(4);
          landedCost = String(faker.number.int({ min: 3000, max: 8000 }));
          deliveryFee = '1500.00';
        }
      }

      const createdAt = faker.date.recent({ days: 90 });

      orderRows.push({
        id: orderId,
        campaignId: campaign.id,
        mediaBuyerId: campaign.mediaBuyerId,
        assignedCsId,
        logisticsProviderId,
        logisticsLocationId,
        riderId,
        status,
        customerName: faker.person.fullName(),
        customerPhoneHash: 'hash_' + faker.string.alphanumeric(12),
        customerAddress: faker.location.streetAddress() + ', ' + faker.location.city() + ', Lagos',
        deliveryAddress: faker.location.streetAddress() + ', ' + faker.location.city() + ', Lagos',
        totalAmount,
        landedCost,
        deliveryFee,
        deliveryOtp,
        deliveryGpsLat,
        deliveryGpsLng,
        items: JSON.stringify([{ productId, quantity: 1, unitPrice }]),
        createdAt,
      });

      orderItemRows.push({ orderId, productId, qty: 1, unitPrice: totalAmount, batchId });

      if (assignedCsId && status !== 'UNPROCESSED' && status !== 'CANCELLED') {
        callLogRows.push({
          orderId,
          agentId: assignedCsId,
          status: 'COMPLETED',
          duration: faker.number.int({ min: 15, max: 120 }),
        });
      }
    }

    for (const o of orderRows) {
      await sql`
        INSERT INTO orders (
          id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
          rider_id, status, customer_name, customer_phone_hash, customer_address, delivery_address,
          total_amount, landed_cost, delivery_fee, delivery_otp, delivery_gps_lat, delivery_gps_lng,
          items, created_at
        ) VALUES (
          ${o.id}, ${o.campaignId}, ${o.mediaBuyerId}, ${o.assignedCsId},
          ${o.logisticsProviderId}, ${o.logisticsLocationId}, ${o.riderId}, ${o.status},
          ${o.customerName}, ${o.customerPhoneHash}, ${o.customerAddress}, ${o.deliveryAddress},
          ${o.totalAmount}, ${o.landedCost}, ${o.deliveryFee}, ${o.deliveryOtp}, ${o.deliveryGpsLat}, ${o.deliveryGpsLng},
          ${o.items}::jsonb, ${o.createdAt}
        )
      `;
    }
    for (const oi of orderItemRows) {
      await sql`
        INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
        VALUES (gen_random_uuid(), ${oi.orderId}, ${oi.productId}, ${oi.qty}, ${oi.unitPrice}, ${oi.batchId})
      `;
    }
    for (const cl of callLogRows) {
      await sql`
        INSERT INTO call_logs (id, order_id, agent_id, call_token, call_status, duration_seconds)
        VALUES (gen_random_uuid(), ${cl.orderId}, ${cl.agentId}, ${randomUUID()}, ${cl.status}, ${cl.duration})
      `;
    }

    inserted += orderRows.length;
    if (offset + BATCH_SIZE < opts.orderCount) process.stdout.write(`  [Heavy] ${inserted}/${opts.orderCount} orders...\r`);
  }

  console.log(`  [Heavy] ${inserted} orders created.`);

  // Extra ad spend for last 60 days across campaigns
  console.log('  [Heavy] Creating ad spend entries...');
  for (const row of opts.campaignRows.slice(0, 40)) {
    for (let d = 0; d < 60; d += 2) {
      await sql`
        INSERT INTO ad_spend_logs (id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date)
        VALUES (
          gen_random_uuid(), ${row.mediaBuyerId}, ${row.productIds[0] ?? opts.productIds[0]!}, ${row.id},
          ${String(faker.number.int({ min: 20000, max: 80000 }))}.00,
          'https://storage.example.com/screenshots/ads.jpg',
          NOW() - (${d} * INTERVAL '1 day')
        )
      `;
    }
  }

  // Extra notifications per user
  console.log('  [Heavy] Creating notifications...');
  const allUserIds = [...opts.csAgentIds, ...opts.mediaBuyerIds, ...opts.riderIds];
  for (const userId of allUserIds) {
    const n = faker.number.int({ min: 5, max: 12 });
    for (let i = 0; i < n; i++) {
      await sql`
        INSERT INTO notifications (id, user_id, type, title, body, data, read)
        VALUES (gen_random_uuid(), ${userId}, 'order_assigned', ${faker.lorem.sentence()}, ${faker.lorem.sentence()}, '{}'::jsonb, false)
      `;
    }
  }

  return inserted;
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
