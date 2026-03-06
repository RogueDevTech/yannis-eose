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

    cartConverted1: randomUUID(),
    cartConverted2: randomUUID(),
    cartConverted3: randomUUID(),
    cartConverted4: randomUUID(),
    cartConverted5: randomUUID(),
    cartConverted6: randomUUID(),
    cartConverted7: randomUUID(),

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
    'cart_abandonments',
    'notifications', 'call_logs', 'order_items', 'order_transfer_requests',
    'delivery_remittance_orders', 'delivery_remittances', 'delivery_confirmation_requests',
    'orders', 'invoices', 'earnings_adjustments', 'payout_records', 'approval_requests',
    'ad_spend_logs', 'marketing_funding', 'marketing_funding_requests', 'campaigns',
    'user_product_assignments', 'budgets', 'settlement_configs', 'commission_plans',
    'transfer_remittances', 'stock_movements', 'stock_transfers', 'inventory_levels',
    'stock_batches', 'offer_templates', 'logistics_locations', 'logistics_providers',
    'email_change_requests', 'users',
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
  }

  // Load existing seed data when not reset so we reuse IDs and avoid duplicates
  type ExistingIds = Partial<ReturnType<typeof buildIds>>;
  let existingIds: ExistingIds = {};
  if (!isReset) {
    const seedEmails = [
      seedAdminEmail, 'kbshowkb+hom@gmail.com', 'kbshowkb+hocs@gmail.com', 'kbshowkb+finance@gmail.com',
      'kbshowkb+hol@gmail.com', 'kbshowkb+warehouse@gmail.com', 'kbshowkb+tpl1@gmail.com', 'kbshowkb+tpl2@gmail.com', 'kbshowkb+hr@gmail.com',
    ];
    const mbEmails = Array.from({ length: MEDIA_BUYER_COUNT }, (_, i) => `kbshowkb+mb${i + 1}@gmail.com`);
    const csEmails = Array.from({ length: CS_AGENT_COUNT }, (_, i) => `kbshowkb+cs${i + 1}@gmail.com`);
    const riderEmails = Array.from({ length: RIDER_COUNT }, (_, i) => `kbshowkb+rider${i + 1}@gmail.com`);
    const allEmails = [...seedEmails, ...mbEmails, ...csEmails, ...riderEmails];
    const userRows = allEmails.length > 0
      ? await sql`SELECT id, email FROM users WHERE email = ANY(${allEmails})`
      : [];
    const emailToId = new Map(userRows.map((r: { id: string; email: string }) => [r.email, r.id]));
    if (emailToId.get(seedAdminEmail)) existingIds.superAdmin = emailToId.get(seedAdminEmail)!;
    if (emailToId.get('kbshowkb+hom@gmail.com')) existingIds.headOfMarketing = emailToId.get('kbshowkb+hom@gmail.com')!;
    if (emailToId.get('kbshowkb+hocs@gmail.com')) existingIds.headOfCs = emailToId.get('kbshowkb+hocs@gmail.com')!;
    if (emailToId.get('kbshowkb+finance@gmail.com')) existingIds.financeOfficer = emailToId.get('kbshowkb+finance@gmail.com')!;
    if (emailToId.get('kbshowkb+hol@gmail.com')) existingIds.headOfLogistics = emailToId.get('kbshowkb+hol@gmail.com')!;
    if (emailToId.get('kbshowkb+warehouse@gmail.com')) existingIds.warehouseManager = emailToId.get('kbshowkb+warehouse@gmail.com')!;
    if (emailToId.get('kbshowkb+tpl1@gmail.com')) existingIds.tplManager1 = emailToId.get('kbshowkb+tpl1@gmail.com')!;
    if (emailToId.get('kbshowkb+tpl2@gmail.com')) existingIds.tplManager2 = emailToId.get('kbshowkb+tpl2@gmail.com')!;
    if (emailToId.get('kbshowkb+hr@gmail.com')) existingIds.hrManager = emailToId.get('kbshowkb+hr@gmail.com')!;
    const mbIds: string[] = [];
    for (let i = 0; i < MEDIA_BUYER_COUNT; i++) {
      mbIds.push(emailToId.get(`kbshowkb+mb${i + 1}@gmail.com`) ?? IDS.mediaBuyerIds[i]!);
    }
    existingIds.mediaBuyerIds = mbIds;
    const csIds: string[] = [];
    for (let i = 0; i < CS_AGENT_COUNT; i++) {
      csIds.push(emailToId.get(`kbshowkb+cs${i + 1}@gmail.com`) ?? IDS.csAgentIds[i]!);
    }
    existingIds.csAgentIds = csIds;
    const rIds: string[] = [];
    for (let i = 0; i < RIDER_COUNT; i++) {
      rIds.push(emailToId.get(`kbshowkb+rider${i + 1}@gmail.com`) ?? IDS.riderIds[i]!);
    }
    existingIds.riderIds = rIds;
    const productNames = ['Amoxicillin 500mg Capsules', 'Metformin 850mg Tablets', 'Ibuprofen 400mg Tablets', 'Omeprazole 20mg Capsules', 'Vitamin C 1000mg Effervescent'];
    const productRows = await sql`SELECT id, name FROM products WHERE name = ANY(${productNames})`;
    const nameToProductId = new Map(productRows.map((r: { id: string; name: string }) => [r.name, r.id]));
    const productKeyToName = ['product1', 'product2', 'product3', 'product4', 'product5'] as const;
    productNames.forEach((name, i) => { const id = nameToProductId.get(name); if (id) (existingIds as Record<string, string>)[productKeyToName[i]!] = id; });
    const locRows = await sql`SELECT id, name FROM logistics_locations WHERE name IN ('SwiftDeliver Lekki Hub', 'GoRide Wuse Hub', 'Main Warehouse Lagos')`;
    locRows.forEach((r: { id: string; name: string }) => {
      if (r.name === 'Main Warehouse Lagos') existingIds.locationMain = r.id;
      else if (r.name === 'SwiftDeliver Lekki Hub') existingIds.location1 = r.id;
      else if (r.name === 'GoRide Wuse Hub') existingIds.location2 = r.id;
    });
    // Merge existing into IDS
    Object.assign(IDS, existingIds);
    if (existingIds.mediaBuyerIds) IDS.mediaBuyerIds = existingIds.mediaBuyerIds;
    if (existingIds.csAgentIds) IDS.csAgentIds = existingIds.csAgentIds;
    if (existingIds.riderIds) IDS.riderIds = existingIds.riderIds;
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
      ON CONFLICT (email) DO NOTHING
    `;
  }

  // Audit: set session variable so temporal/history triggers record an actor
  await sql`SELECT set_config('yannis.current_user_id', ${IDS.superAdmin}, true)`;

  // ══════════════════════════════════════════════════════════════════
  // 2. PRODUCTS (5 pharmaceutical products)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating products...');

  const products = [
    { id: IDS.product1, name: 'Amoxicillin 500mg Capsules', baseSalePrice: '4500.00', costPrice: '1200.00', category: 'Antibiotics', description: 'Broad-spectrum antibiotic, 500mg capsules, 20-pack blister',
      offers: JSON.stringify([{ label: '1 Pack (20 caps)', qty: 1, price: '4500.00' }, { label: '3 Packs (60 caps)', qty: 3, price: '12000.00' }]) },
    { id: IDS.product2, name: 'Metformin 850mg Tablets', baseSalePrice: '6500.00', costPrice: '1800.00', category: 'Antidiabetics', description: 'Oral hypoglycemic agent, 850mg film-coated tablets, 30-pack',
      offers: JSON.stringify([{ label: '1 Pack (30 tabs)', qty: 1, price: '6500.00' }, { label: '2 Packs (60 tabs)', qty: 2, price: '11500.00' }]) },
    { id: IDS.product3, name: 'Ibuprofen 400mg Tablets', baseSalePrice: '3200.00', costPrice: '800.00', category: 'Analgesics', description: 'Non-steroidal anti-inflammatory, 400mg tablets, 24-pack',
      offers: JSON.stringify([{ label: '1 Pack (24 tabs)', qty: 1, price: '3200.00' }]) },
    { id: IDS.product4, name: 'Omeprazole 20mg Capsules', baseSalePrice: '7500.00', costPrice: '2500.00', category: 'Gastrointestinal', description: 'Proton pump inhibitor, 20mg enteric-coated capsules, 28-pack',
      offers: JSON.stringify([{ label: '1 Pack (28 caps)', qty: 1, price: '7500.00' }, { label: '2 Packs (56 caps)', qty: 2, price: '13500.00' }, { label: '3 Packs (84 caps)', qty: 3, price: '19000.00' }]) },
    { id: IDS.product5, name: 'Vitamin C 1000mg Effervescent', baseSalePrice: '3800.00', costPrice: '900.00', category: 'Vitamins & Supplements', description: 'Effervescent vitamin C tablets, 1000mg, 20-tube pack, orange flavor',
      offers: JSON.stringify([{ label: '1 Tube (20 tabs)', qty: 1, price: '3800.00' }, { label: 'Family Pack (5 Tubes)', qty: 5, price: '16000.00' }]) },
  ];

  for (const p of products) {
    await sql`
      INSERT INTO products (id, name, offers, base_sale_price, cost_price, category, description, status)
      VALUES (${p.id}, ${p.name}, ${p.offers}::jsonb, ${p.baseSalePrice}, ${p.costPrice}, ${p.category}, ${p.description}, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING
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
    { id: IDS.batch1p1, productId: IDS.product1, factoryCost: '1200.00', landingCost: '300.00', totalLandedCost: '1500.00', qty: 200, remaining: 150 },
    { id: IDS.batch2p1, productId: IDS.product1, factoryCost: '1350.00', landingCost: '350.00', totalLandedCost: '1700.00', qty: 100, remaining: 100 },
    { id: IDS.batch1p2, productId: IDS.product2, factoryCost: '1800.00', landingCost: '400.00', totalLandedCost: '2200.00', qty: 150, remaining: 120 },
    { id: IDS.batch1p3, productId: IDS.product3, factoryCost: '800.00', landingCost: '200.00', totalLandedCost: '1000.00', qty: 300, remaining: 270 },
    { id: IDS.batch1p4, productId: IDS.product4, factoryCost: '2500.00', landingCost: '600.00', totalLandedCost: '3100.00', qty: 100, remaining: 80 },
    { id: IDS.batch1p5, productId: IDS.product5, factoryCost: '900.00', landingCost: '200.00', totalLandedCost: '1100.00', qty: 250, remaining: 220 },
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
    { productId: IDS.product1, type: 'INTAKE', qty: 200, toLocationId: IDS.locationMain, reason: 'Amoxicillin batch received from manufacturer', actorId: IDS.warehouseManager },
    { productId: IDS.product1, type: 'TRANSFER_OUT', qty: -60, fromLocationId: IDS.locationMain, toLocationId: IDS.location1, reason: 'Transfer to Lekki hub', actorId: IDS.warehouseManager },
    { productId: IDS.product1, type: 'TRANSFER_IN', qty: 60, fromLocationId: IDS.locationMain, toLocationId: IDS.location1, reason: 'Received from main warehouse', actorId: IDS.tplManager1 },
    { productId: IDS.product2, type: 'INTAKE', qty: 150, toLocationId: IDS.locationMain, reason: 'Metformin batch received from manufacturer', actorId: IDS.warehouseManager },
    { productId: IDS.product1, type: 'RESERVATION', qty: -10, fromLocationId: IDS.locationMain, reason: 'Reserved for confirmed orders', actorId: IDS.csAgentIds[0]! },
    { productId: IDS.product3, type: 'INTAKE', qty: 300, toLocationId: IDS.locationMain, reason: 'Ibuprofen full batch intake', actorId: IDS.warehouseManager },
    { productId: IDS.product4, type: 'INTAKE', qty: 100, toLocationId: IDS.locationMain, reason: 'Omeprazole batch intake', actorId: IDS.warehouseManager },
    { productId: IDS.product5, type: 'INTAKE', qty: 250, toLocationId: IDS.locationMain, reason: 'Vitamin C effervescent batch', actorId: IDS.warehouseManager },
  ];

  for (const m of movements) {
    await sql`
      INSERT INTO stock_movements (id, product_id, movement_type, quantity, from_location_id, to_location_id, reason, actor_id)
      VALUES (gen_random_uuid(), ${m.productId}, ${m.type}, ${m.qty}, ${m.fromLocationId ?? null}, ${m.toLocationId ?? null}, ${m.reason}, ${m.actorId})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 7. STOCK TRANSFERS (15–25: main → location1/location2; mix PENDING, IN_TRANSIT, RECEIVED)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating stock transfers...');
  const productIdsForTransfer = [IDS.product1, IDS.product2, IDS.product3, IDS.product4, IDS.product5];
  const transferStatuses: Array<'PENDING' | 'IN_TRANSIT' | 'RECEIVED'> = [
    'PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING',
    'IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT',
    'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED', 'RECEIVED',
  ];
  for (let i = 0; i < 21; i++) {
    const toLocation = i % 2 === 0 ? IDS.location1 : IDS.location2;
    const productId = productIdsForTransfer[i % productIdsForTransfer.length]!;
    const qtySent = 20 + (i % 5) * 15;
    const status = transferStatuses[i]!;
    const quantityReceived = status === 'RECEIVED' ? qtySent - (i % 3 === 0 ? 1 : 0) : null;
    const verifiedAt = status === 'RECEIVED' ? new Date(Date.now() - (i % 10) * 24 * 60 * 60 * 1000) : null;
    const createdAt = new Date(Date.now() - (15 + (i % 20)) * 24 * 60 * 60 * 1000);
    await sql`
      INSERT INTO stock_transfers (id, product_id, quantity_sent, quantity_received, from_location_id, to_location_id, transfer_status, created_at, verified_at)
      VALUES (gen_random_uuid(), ${productId}, ${qtySent}, ${quantityReceived}, ${IDS.locationMain}, ${toLocation}, ${status}, ${createdAt}, ${verifiedAt})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 7b. TRANSFER REMITTANCES (3PL → main warehouse; TPL manager sent_by)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating transfer remittances...');
  const transferRemittanceRows: Array<{ fromLoc: string; toLoc: string; productId: string; qtySent: number; qtyReceived: number | null; status: string; sentBy: string; receivedAt: Date | null; receivedBy: string | null }> = [];
  for (let i = 0; i < 12; i++) {
    const fromLoc = i % 2 === 0 ? IDS.location1 : IDS.location2;
    const sentBy = i % 2 === 0 ? IDS.tplManager1 : IDS.tplManager2;
    const status = i < 4 ? 'SENT' : i < 10 ? 'RECEIVED' : 'DISPUTED';
    transferRemittanceRows.push({
      fromLoc,
      toLoc: IDS.locationMain,
      productId: productIdsForTransfer[i % productIdsForTransfer.length]!,
      qtySent: 10 + (i % 4) * 5,
      qtyReceived: status !== 'SENT' ? 10 + (i % 4) * 5 - (i % 5 === 0 ? 1 : 0) : null,
      status,
      sentBy,
      receivedAt: status !== 'SENT' ? new Date(Date.now() - (5 + i) * 24 * 60 * 60 * 1000) : null,
      receivedBy: status !== 'SENT' ? IDS.headOfLogistics : null,
    });
  }
  for (let idx = 0; idx < transferRemittanceRows.length; idx++) {
    const tr = transferRemittanceRows[idx]!;
    const daysAgo = 10 + idx;
    await sql`
      INSERT INTO transfer_remittances (id, from_location_id, to_location_id, product_id, quantity_sent, quantity_received, receipt_url, status, sent_at, sent_by, received_at, received_by)
      VALUES (
        gen_random_uuid(), ${tr.fromLoc}, ${tr.toLoc}, ${tr.productId}, ${tr.qtySent}, ${tr.qtyReceived},
        'https://storage.example.com/receipts/transfer.jpg', ${tr.status}, NOW() - (${daysAgo} * INTERVAL '1 day'),
        ${tr.sentBy}, ${tr.receivedAt}, ${tr.receivedBy}
      )
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 8. OFFER TEMPLATES
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating offer templates...');

  await sql`
    INSERT INTO offer_templates (id, product_id, name, price, variants, created_by, status)
    VALUES
      (${IDS.offer1}, ${IDS.product1}, 'Amoxicillin Bulk Discount', '3800.00', ${JSON.stringify([{ dosage: '500mg', price: 3800 }, { dosage: '250mg', price: 2500 }])}::jsonb, ${IDS.warehouseManager}, 'ACTIVE'),
      (${IDS.offer2}, ${IDS.product2}, 'Metformin Monthly Supply', '11500.00', null, ${IDS.warehouseManager}, 'ACTIVE'),
      (${IDS.offer3}, ${IDS.product5}, 'Vitamin C Family Pack', '16000.00', null, ${IDS.warehouseManager}, 'ACTIVE')
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
  // 9b. CART ABANDONMENTS — 25 carts: 8 PENDING, 10 ABANDONED, 7 CONVERTED
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating cart abandonments...');

  // Nigerian customer names for carts
  const cartCustomerNames = [
    // 8 PENDING
    'Aisha Mohammed', 'Chinwe Eze', 'Tobiloba Adeniyi', 'Khadija Sule',
    'Obiora Chukwuma', 'Funmilayo Ogun', 'Yakubu Danjuma', 'Nneka Azubuike',
    // 10 ABANDONED
    'Temitope Balogun', 'Ifeanyi Nwosu', 'Rukayat Abiodun', 'Godwin Osagie',
    'Halima Garba', 'Chibueze Okonkwo', 'Lateefat Jimoh', 'Omotola Adesanya',
    'Uche Ikenna', 'Folashade Akindele',
  ];

  // PENDING carts — timestamps within last 4 minutes (recent, visible on CS dashboard)
  const pendingCarts = Array.from({ length: 8 }, (_, i) => ({
    id: randomUUID(),
    campaignId: campaignRows[i % campaignRows.length]!.id,
    mediaBuyerId: campaignRows[i % campaignRows.length]!.mediaBuyerId,
    customerName: cartCustomerNames[i]!,
    customerPhoneHash: `hash_cart_pending_${String(i + 1).padStart(3, '0')}`,
    productId: campaignRows[i % campaignRows.length]!.productIds[0]!,
    offerLabel: i % 2 === 0 ? '1 Pack' : null,
    secondsAgo: 30 + i * 30, // 30s, 60s, 90s, 120s, 150s, 180s, 210s, 240s
  }));

  // ABANDONED carts — 5 within last 24h (for abandonedLast24h stat), 5 older
  const abandonedCarts = Array.from({ length: 10 }, (_, i) => ({
    id: randomUUID(),
    campaignId: campaignRows[(i + 8) % campaignRows.length]!.id,
    mediaBuyerId: campaignRows[(i + 8) % campaignRows.length]!.mediaBuyerId,
    customerName: cartCustomerNames[8 + i]!,
    customerPhoneHash: `hash_cart_abandoned_${String(i + 1).padStart(3, '0')}`,
    productId: campaignRows[(i + 8) % campaignRows.length]!.productIds[0]!,
    offerLabel: i % 3 === 0 ? '1 Pack' : null,
    // First 5: within last 24h (20min to 12h ago). Last 5: 1-7 days ago
    createdMinutesAgo: i < 5 ? 25 + i * 120 : 1440 + i * 1440,
    abandonedMinutesAgo: i < 5 ? 20 + i * 120 : 1435 + i * 1440,
  }));

  // CONVERTED carts — match orders 1-7 by name/phone/campaign
  const convertedCartData = [
    { cartId: IDS.cartConverted1, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!, customerName: 'Blessing Okonkwo', phoneHash: 'hash_08012345001', productId: IDS.product1, orderId: IDS.order1 },
    { cartId: IDS.cartConverted2, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!, customerName: 'Emeka Uche', phoneHash: 'hash_08012345002', productId: IDS.product5, orderId: IDS.order2 },
    { cartId: IDS.cartConverted3, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!, customerName: 'Fatima Abdullahi', phoneHash: 'hash_08012345003', productId: IDS.product1, orderId: IDS.order3 },
    { cartId: IDS.cartConverted4, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!, customerName: 'Chidinma Okafor', phoneHash: 'hash_08012345004', productId: IDS.product2, orderId: IDS.order4 },
    { cartId: IDS.cartConverted5, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!, customerName: 'Adaeze Nnamdi', phoneHash: 'hash_08012345005', productId: IDS.product1, orderId: IDS.order5 },
    { cartId: IDS.cartConverted6, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!, customerName: 'Oluwaseun Balogun', phoneHash: 'hash_08012345006', productId: IDS.product2, orderId: IDS.order6 },
    { cartId: IDS.cartConverted7, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!, customerName: 'Hauwa Ibrahim', phoneHash: 'hash_08012345007', productId: IDS.product5, orderId: IDS.order7 },
  ];

  // Insert PENDING carts
  for (const c of pendingCarts) {
    await sql`
      INSERT INTO cart_abandonments (id, campaign_id, media_buyer_id, customer_name, customer_phone_hash, product_id, offer_label, status, created_at, updated_at)
      VALUES (
        ${c.id}, ${c.campaignId}, ${c.mediaBuyerId}, ${c.customerName}, ${c.customerPhoneHash},
        ${c.productId}, ${c.offerLabel}, 'PENDING',
        NOW() - (${c.secondsAgo} * INTERVAL '1 second'), NOW() - (${c.secondsAgo} * INTERVAL '1 second')
      )
    `;
  }

  // Insert ABANDONED carts
  for (const c of abandonedCarts) {
    await sql`
      INSERT INTO cart_abandonments (id, campaign_id, media_buyer_id, customer_name, customer_phone_hash, product_id, offer_label, status, created_at, updated_at)
      VALUES (
        ${c.id}, ${c.campaignId}, ${c.mediaBuyerId}, ${c.customerName}, ${c.customerPhoneHash},
        ${c.productId}, ${c.offerLabel}, 'ABANDONED',
        NOW() - (${c.createdMinutesAgo} * INTERVAL '1 minute'), NOW() - (${c.abandonedMinutesAgo} * INTERVAL '1 minute')
      )
    `;
  }

  // Insert CONVERTED carts as PENDING initially (will be updated after orders are inserted)
  for (const c of convertedCartData) {
    await sql`
      INSERT INTO cart_abandonments (id, campaign_id, media_buyer_id, customer_name, customer_phone_hash, product_id, status, created_at, updated_at)
      VALUES (
        ${c.cartId}, ${c.campaignId}, ${c.mediaBuyerId}, ${c.customerName}, ${c.phoneHash},
        ${c.productId}, 'PENDING',
        NOW() - INTERVAL '3 seconds', NOW() - INTERVAL '3 seconds'
      )
    `;
  }

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
      totalAmount: '3800.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 3800 }]),
    },
    {
      id: IDS.order2, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!,
      status: 'UNPROCESSED', customerName: 'Emeka Uche', customerPhoneHash: 'hash_08012345002',
      customerAddress: '8 Adeola Odeku, Lekki, Lagos',
      deliveryAddress: '8 Adeola Odeku, Lekki, Lagos',
      totalAmount: '16000.00', items: JSON.stringify([{ productId: IDS.product5, quantity: 5, unitPrice: 3200 }]),
    },
    {
      id: IDS.order3, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[0], status: 'CS_ENGAGED',
      customerName: 'Fatima Abdullahi', customerPhoneHash: 'hash_08012345003',
      customerAddress: '22 Awolowo Road, Ikoyi, Lagos',
      deliveryAddress: '22 Awolowo Road, Ikoyi, Lagos',
      totalAmount: '4500.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 4500 }]),
    },
    {
      id: IDS.order4, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[1], status: 'CONFIRMED',
      customerName: 'Chidinma Okafor', customerPhoneHash: 'hash_08012345004',
      customerAddress: '5 Allen Avenue, Ikeja, Lagos',
      deliveryAddress: '5 Allen Avenue, Ikeja, Lagos',
      totalAmount: '11500.00', items: JSON.stringify([{ productId: IDS.product2, quantity: 2, unitPrice: 5750 }]),
    },
    {
      id: IDS.order5, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[0], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      status: 'ALLOCATED',
      customerName: 'Adaeze Nnamdi', customerPhoneHash: 'hash_08012345005',
      customerAddress: '10 Ajose Adeogun, VI, Lagos',
      deliveryAddress: '10 Ajose Adeogun, VI, Lagos',
      totalAmount: '4500.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 4500 }]),
    },
    {
      id: IDS.order6, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[1], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.riderIds[0], status: 'DISPATCHED', deliveryOtp: '4821',
      customerName: 'Oluwaseun Balogun', customerPhoneHash: 'hash_08012345006',
      customerAddress: '33 Admiralty Way, Lekki Phase 1',
      deliveryAddress: '33 Admiralty Way, Lekki Phase 1',
      totalAmount: '6500.00', items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 6500 }]),
    },
    {
      id: IDS.order7, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!,
      assignedCsId: IDS.csAgentIds[2], logisticsProviderId: IDS.provider2, logisticsLocationId: IDS.location2,
      riderId: IDS.riderIds[2], status: 'IN_TRANSIT', deliveryOtp: '7293',
      customerName: 'Hauwa Ibrahim', customerPhoneHash: 'hash_08012345007',
      customerAddress: '14 Gana Street, Maitama, Abuja',
      deliveryAddress: '14 Gana Street, Maitama, Abuja',
      totalAmount: '3800.00', items: JSON.stringify([{ productId: IDS.product5, quantity: 1, unitPrice: 3800 }]),
    },
    {
      id: IDS.order8, campaignId: campaign1, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[0], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.riderIds[1], status: 'DELIVERED',
      deliveryOtp: '1547', deliveryGpsLat: '6.4541', deliveryGpsLng: '3.4754',
      customerName: 'Grace Okechukwu', customerPhoneHash: 'hash_08012345008',
      customerAddress: '7 Ozumba Mbadiwe, VI, Lagos',
      deliveryAddress: '7 Ozumba Mbadiwe, VI, Lagos',
      totalAmount: '4500.00', landedCost: '1500.00', deliveryFee: '1500.00',
      items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 4500 }]),
      deliveredAt: true,
    },
    {
      id: IDS.order9, campaignId: campaign2, mediaBuyerId: IDS.mediaBuyerIds[0]!,
      assignedCsId: IDS.csAgentIds[1], logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.riderIds[0], status: 'COMPLETED',
      deliveryOtp: '3890', deliveryGpsLat: '6.4312', deliveryGpsLng: '3.4521',
      customerName: 'Samuel Taiwo', customerPhoneHash: 'hash_08012345009',
      customerAddress: '20 Ligali Ayorinde, VI, Lagos',
      deliveryAddress: '20 Ligali Ayorinde, VI, Lagos',
      totalAmount: '6500.00', landedCost: '2200.00', deliveryFee: '1500.00',
      items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 6500 }]),
      deliveredAt: true,
    },
    {
      id: IDS.order10, campaignId: campaign3, mediaBuyerId: IDS.mediaBuyerIds[1]!,
      assignedCsId: IDS.csAgentIds[2], status: 'CANCELLED',
      customerName: 'Mohammed Yusuf', customerPhoneHash: 'hash_08012345010',
      customerAddress: '3 IBB Boulevard, Abuja',
      deliveryAddress: '3 IBB Boulevard, Abuja',
      totalAmount: '7500.00', items: JSON.stringify([{ productId: IDS.product4, quantity: 1, unitPrice: 7500 }]),
    },
  ];

  const deliveredAtBase = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  for (const o of orders) {
    const deliveredAt = (o as { deliveredAt?: boolean }).deliveredAt ? deliveredAtBase : null;
    await sql`
      INSERT INTO orders (
        id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
        rider_id, status, customer_name, customer_phone_hash, customer_address, delivery_address,
        total_amount, landed_cost, delivery_fee, delivery_otp, delivery_gps_lat, delivery_gps_lng,
        items, delivered_at
      ) VALUES (
        ${o.id}, ${o.campaignId}, ${o.mediaBuyerId}, ${o.assignedCsId ?? null},
        ${o.logisticsProviderId ?? null}, ${o.logisticsLocationId ?? null},
        ${o.riderId ?? null}, ${o.status}, ${o.customerName}, ${o.customerPhoneHash},
        ${o.customerAddress}, ${o.deliveryAddress},
        ${o.totalAmount}, ${o.landedCost ?? null}, ${o.deliveryFee ?? null},
        ${o.deliveryOtp ?? null}, ${o.deliveryGpsLat ?? null}, ${o.deliveryGpsLng ?? null},
        ${o.items}::jsonb, ${deliveredAt}
      )
    `;
  }

  // Update converted carts now that orders exist
  for (const c of convertedCartData) {
    await sql`
      UPDATE cart_abandonments
      SET status = 'CONVERTED', converted_order_id = ${c.orderId}, updated_at = NOW()
      WHERE id = ${c.cartId}
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 11. ORDER ITEMS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating order items...');

  const orderItems = [
    { orderId: IDS.order1, productId: IDS.product1, qty: 1, unitPrice: '3800.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order2, productId: IDS.product5, qty: 5, unitPrice: '3200.00', batchId: IDS.batch1p5 },
    { orderId: IDS.order3, productId: IDS.product1, qty: 1, unitPrice: '4500.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order4, productId: IDS.product2, qty: 2, unitPrice: '5750.00', batchId: IDS.batch1p2 },
    { orderId: IDS.order5, productId: IDS.product1, qty: 1, unitPrice: '4500.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order6, productId: IDS.product2, qty: 1, unitPrice: '6500.00', batchId: IDS.batch1p2 },
    { orderId: IDS.order7, productId: IDS.product5, qty: 1, unitPrice: '3800.00', batchId: IDS.batch1p5 },
    { orderId: IDS.order8, productId: IDS.product1, qty: 1, unitPrice: '4500.00', batchId: IDS.batch1p1 },
    { orderId: IDS.order9, productId: IDS.product2, qty: 1, unitPrice: '6500.00', batchId: IDS.batch1p2 },
    { orderId: IDS.order10, productId: IDS.product4, qty: 1, unitPrice: '7500.00', batchId: IDS.batch1p4 },
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
  // 13. MARKETING FUNDING — each media buyer gets substantial money (multiple tranches)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating marketing funding...');

  const fundingTranchesPerMb = [
    [200000, 300000, 250000, 150000],   // MB 1: 900k total
    [250000, 200000, 300000],           // MB 2: 750k
    [300000, 350000, 200000],           // MB 3: 850k
    [150000, 200000, 250000, 200000],   // MB 4: 800k
    [400000, 250000],                   // MB 5: 650k
    [200000, 200000, 200000, 250000],   // MB 6: 850k
    [350000, 300000],                   // MB 7: 650k
    [180000, 220000, 200000, 200000],   // MB 8: 800k
    [250000, 250000, 250000],           // MB 9: 750k
    [300000, 400000],                   // MB 10: 700k
    [200000, 300000, 150000, 250000],   // MB 11: 900k
    [275000, 275000, 200000],           // MB 12: 750k
    [350000, 200000, 300000],           // MB 13: 850k
    [150000, 250000, 200000, 200000],   // MB 14: 800k
    [400000, 300000],                   // MB 15: 700k
    [220000, 230000, 250000],           // MB 16: 700k
    [300000, 250000, 200000],           // MB 17: 750k
    [200000, 400000, 150000],           // MB 18: 750k
    [250000, 250000, 250000, 100000],   // MB 19: 850k
    [350000, 350000],                   // MB 20: 700k
  ];

  for (let i = 0; i < MEDIA_BUYER_COUNT; i++) {
    const tranches = fundingTranchesPerMb[i] ?? [250000, 250000];
    let daysAgo = 45;
    for (const amountNum of tranches) {
      const amount = `${amountNum}.00`;
      daysAgo -= 10 + (i % 5);
      if (daysAgo < 1) daysAgo = 5;
      const verifiedAgo = daysAgo - 1;
      await sql`
        INSERT INTO marketing_funding (id, sender_id, receiver_id, amount, receipt_url, status, sent_at, verified_at)
        VALUES (
          gen_random_uuid(), ${IDS.headOfMarketing}, ${IDS.mediaBuyerIds[i]!},
          ${amount}, 'https://storage.example.com/receipts/funding.jpg', 'COMPLETED',
          NOW() - (${daysAgo} * INTERVAL '1 day'), NOW() - (${verifiedAgo} * INTERVAL '1 day')
        )
      `;
    }
  }
  await sql`
    INSERT INTO marketing_funding (id, sender_id, receiver_id, amount, receipt_url, status, sent_at, verified_at)
    VALUES (gen_random_uuid(), ${IDS.headOfMarketing}, ${IDS.mediaBuyerIds[0]!}, '200000.00', 'https://storage.example.com/receipts/funding-pending.jpg', 'SENT', NOW() - INTERVAL '1 day', null)
  `;

  // ══════════════════════════════════════════════════════════════════
  // 13b. MARKETING FUNDING REQUESTS (Media Buyer requests; HoM resolves)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating marketing funding requests...');
  const fundingRequestStatuses: Array<'PENDING' | 'APPROVED' | 'REJECTED'> = [
    'PENDING', 'PENDING', 'PENDING', 'PENDING', 'PENDING', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'APPROVED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED',
  ];
  for (let i = 0; i < 15; i++) {
    const status = fundingRequestStatuses[i]!;
    const requesterId = IDS.mediaBuyerIds[i % MEDIA_BUYER_COUNT]!;
    const amountNum = 50000 + (i % 5) * 25000;
    const amount = `${amountNum}.00`;
    const daysAgo = 14 - (i % 14);
    const resolvedAt = status !== 'PENDING' ? new Date(Date.now() - (daysAgo - 2) * 24 * 60 * 60 * 1000) : null;
    const resolvedBy = status !== 'PENDING' ? IDS.headOfMarketing : null;
    await sql`
      INSERT INTO marketing_funding_requests (id, requester_id, amount, reason, status, receipt_url, created_at, resolved_at, resolved_by)
      VALUES (
        gen_random_uuid(), ${requesterId}, ${amount}, ${'Additional budget for campaign'}, ${status},
        ${status === 'APPROVED' ? 'https://storage.example.com/receipts/request-receipt.jpg' : null},
        NOW() - (${daysAgo} * INTERVAL '1 day'), ${resolvedAt}, ${resolvedBy}
      )
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // 14. AD SPEND LOGS — each media buyer has spent money (approved), balance = funding - spend
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating ad spend logs...');

  const totalFundingPerMb = fundingTranchesPerMb.map((t) => t.reduce((a, b) => a + b, 0));
  const adSpendEntries: Array<{
    mbId: string;
    productId: string;
    campaignId: string;
    amount: string;
    daysAgo: number;
    status: string;
    approvedBy: string | null;
  }> = [];

  for (let mbIdx = 0; mbIdx < MEDIA_BUYER_COUNT; mbIdx++) {
    const totalFunding = totalFundingPerMb[mbIdx] ?? 750000;
    const targetSpend = Math.floor(totalFunding * (0.35 + (mbIdx % 6) * 0.1));
    const campaignsForMb = campaignRows.filter((c) => c.mediaBuyerId === IDS.mediaBuyerIds[mbIdx]);
    if (campaignsForMb.length === 0) continue;
    let remainingSpend = targetSpend;
    const entriesPerCampaign = 8 + (mbIdx % 5);
    for (let e = 0; e < entriesPerCampaign && remainingSpend > 5000; e++) {
      const campaign = campaignsForMb[e % campaignsForMb.length]!;
      const amountNum = Math.min(
        remainingSpend,
        Math.floor(15000 + Math.random() * 35000)
      );
      remainingSpend -= amountNum;
      adSpendEntries.push({
        mbId: IDS.mediaBuyerIds[mbIdx]!,
        productId: campaign.productIds[0]!,
        campaignId: campaign.id,
        amount: `${amountNum}.00`,
        daysAgo: 1 + (e % 30),
        status: 'APPROVED',
        approvedBy: IDS.headOfMarketing,
      });
    }
  }

  for (const as of adSpendEntries) {
    await sql`
      INSERT INTO ad_spend_logs (id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date, status, approved_at, approved_by)
      VALUES (
        gen_random_uuid(), ${as.mbId}, ${as.productId}, ${as.campaignId}, ${as.amount},
        'https://storage.example.com/screenshots/ads-screenshot.jpg',
        NOW() - (${as.daysAgo} * INTERVAL '1 day'),
        ${as.status}, NOW() - (${as.daysAgo} * INTERVAL '1 day'), ${as.approvedBy}
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
        ${JSON.stringify([{ description: 'Amoxicillin 500mg Capsules', quantity: 1, unitPrice: 4500, amount: 4500 }])}::jsonb,
        '0.075', '4837.50', 'PAID', NOW() + INTERVAL '30 days'),
      (gen_random_uuid(), ${IDS.order9},
        ${JSON.stringify({ name: 'Samuel Taiwo', email: 'samuel@example.com', address: '20 Ligali Ayorinde, VI, Lagos' })}::jsonb,
        ${JSON.stringify([{ description: 'Metformin 850mg Tablets', quantity: 1, unitPrice: 6500, amount: 6500 }])}::jsonb,
        '0.075', '6987.50', 'PAID', NOW() + INTERVAL '30 days')
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
  // 19. BUDGETS (skip if table does not exist)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating budgets...');
  try {
    await sql`
      INSERT INTO budgets (id, name, department_or_campaign, total_budget, period_start, period_end, created_by)
      VALUES
        (${IDS.budget1}, 'Marketing Q1 2026', 'marketing', '2000000.00', '2026-01-01'::timestamp, '2026-03-31'::timestamp, ${IDS.financeOfficer}),
        (${IDS.budget2}, 'Logistics Q1 2026', 'logistics', '800000.00', '2026-01-01'::timestamp, '2026-03-31'::timestamp, ${IDS.financeOfficer})
    `;
  } catch (e) {
    console.log('  Skipping budgets (table may not exist).');
  }

  // ══════════════════════════════════════════════════════════════════
  // 20. APPROVAL REQUESTS (skip if table does not exist)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating approval requests...');
  try {
    await sql`
      INSERT INTO approval_requests (id, type, requester_id, amount, description, status, budget_id)
      VALUES
        (gen_random_uuid(), 'MEDIA_SPEND', ${IDS.headOfMarketing}, '500000.00', 'Additional ad budget for February blitz campaign', 'APPROVED', ${IDS.budget1}),
        (gen_random_uuid(), 'PROCUREMENT', ${IDS.warehouseManager}, '350000.00', 'Emergency restock of Amoxicillin 500mg — supplier minimum order', 'PENDING', null),
        (gen_random_uuid(), 'LOGISTICS_REIMBURSEMENT', ${IDS.headOfLogistics}, '45000.00', 'Fuel reimbursement for Abuja deliveries — January', 'PENDING', ${IDS.budget2})
    `;
  } catch (e) {
    console.log('  Skipping approval_requests (table may not exist).');
  }

  // ══════════════════════════════════════════════════════════════════
  // 21. SETTLEMENT CONFIG (skip if table does not exist)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating settlement config...');
  try {
    await sql`
      INSERT INTO settlement_configs (id, window_type, start_day, created_by)
      VALUES (gen_random_uuid(), 'MONTHLY', 1, ${IDS.hrManager})
    `;
  } catch (e) {
    console.log('  Skipping settlement_configs (table may not exist).');
  }

  // ══════════════════════════════════════════════════════════════════
  // 22. NOTIFICATIONS (sample)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating notifications...');

  const notifications: Array<{ userId: string; type: string; title: string; body: string; data: object }> = [
    { userId: IDS.headOfLogistics, type: 'transfer_pending', title: 'Transfer Pending Verification', body: 'Stock transfer of Omeprazole 20mg Capsules to GoRide Wuse Hub awaiting verification.', data: {} },
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

  const DELIVERED_ORDER_COUNT = 50;
  let heavyOrdersCount = 0;
  if (isHeavy) {
    heavyOrdersCount = await seedHeavy(sql, {
      campaignRows,
      orderCount: SEED_ORDER_COUNT,
      deliveredOrderCount: DELIVERED_ORDER_COUNT,
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
      headOfLogisticsId: IDS.headOfLogistics,
      financeOfficerId: IDS.financeOfficer,
      tplManager1Id: IDS.tplManager1,
      tplManager2Id: IDS.tplManager2,
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
  console.log(`  Cart Abandonments:  25 (8 pending, 10 abandoned, 7 converted)`);
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

const ORDER_STATUSES_OTHER = [
  'IN_TRANSIT', 'IN_TRANSIT', 'DISPATCHED', 'DISPATCHED', 'CONFIRMED', 'CONFIRMED', 'ALLOCATED', 'ALLOCATED',
  'UNPROCESSED', 'UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CANCELLED', 'CANCELLED',
] as const;

async function seedHeavy(
  sql: postgres.Sql,
  opts: {
    campaignRows: Array<{ id: string; mediaBuyerId: string; productIds: string[] }>;
    orderCount: number;
    deliveredOrderCount: number;
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
    headOfLogisticsId: string;
    financeOfficerId: string;
    tplManager1Id: string;
    tplManager2Id: string;
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
  const tplManagerByLocation: Record<string, string> = {
    [opts.location1]: opts.tplManager1Id,
    [opts.location2]: opts.tplManager2Id,
  };

  const BATCH_SIZE = 150;
  let inserted = 0;
  const deliveredOrderInfos: Array<{ orderId: string; riderId: string; locationId: string; createdAt: Date }> = [];

  function makeOrderRow(
    status: string,
    offset: number,
    i: number
  ): {
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
    deliveredAt: Date | null;
  } {
    const orderId = randomUUID();
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
    const deliveredAt =
      status === 'DELIVERED' || status === 'COMPLETED'
        ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000)
        : null;
    return {
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
      deliveredAt,
    };
  }

  // 1) Create exactly deliveredOrderCount DELIVERED/COMPLETED orders (full flow)
  console.log(`\n  [Heavy] Creating ${opts.deliveredOrderCount} delivered orders...`);
  const deliveredStatuses = [...Array(opts.deliveredOrderCount)].map((_, i) => (i % 2 === 0 ? 'DELIVERED' : 'COMPLETED'));
  const orderRows0: ReturnType<typeof makeOrderRow>[] = [];
  const orderItemRows0: Array<{ orderId: string; productId: string; qty: number; unitPrice: string; batchId: string }> = [];
  const callLogRows0: Array<{ orderId: string; agentId: string; status: string; duration: number | null }> = [];
  for (let i = 0; i < opts.deliveredOrderCount; i++) {
    const status = deliveredStatuses[i]!;
    const o = makeOrderRow(status, 0, i);
    orderRows0.push(o);
    const campaign = opts.campaignRows[i % opts.campaignRows.length]!;
    const productId = campaign.productIds[0] ?? opts.productIds[0]!;
    const batchId = opts.batchByProduct[productId] ?? opts.batchByProduct[opts.productIds[0]!]!;
    orderItemRows0.push({ orderId: o.id, productId, qty: 1, unitPrice: o.totalAmount, batchId });
    if (o.assignedCsId) {
      callLogRows0.push({ orderId: o.id, agentId: o.assignedCsId, status: 'COMPLETED', duration: faker.number.int({ min: 15, max: 120 }) });
    }
    if (o.riderId && o.logisticsLocationId) {
      deliveredOrderInfos.push({ orderId: o.id, riderId: o.riderId, locationId: o.logisticsLocationId, createdAt: o.createdAt });
    }
  }
  for (const o of orderRows0) {
    await sql`
      INSERT INTO orders (
        id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
        rider_id, status, customer_name, customer_phone_hash, customer_address, delivery_address,
        total_amount, landed_cost, delivery_fee, delivery_otp, delivery_gps_lat, delivery_gps_lng,
        items, created_at, delivered_at
      ) VALUES (
        ${o.id}, ${o.campaignId}, ${o.mediaBuyerId}, ${o.assignedCsId},
        ${o.logisticsProviderId}, ${o.logisticsLocationId}, ${o.riderId}, ${o.status},
        ${o.customerName}, ${o.customerPhoneHash}, ${o.customerAddress}, ${o.deliveryAddress},
        ${o.totalAmount}, ${o.landedCost}, ${o.deliveryFee}, ${o.deliveryOtp}, ${o.deliveryGpsLat}, ${o.deliveryGpsLng},
        ${o.items}::jsonb, ${o.createdAt}, ${o.deliveredAt}
      )
    `;
  }
  for (const oi of orderItemRows0) {
    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
      VALUES (gen_random_uuid(), ${oi.orderId}, ${oi.productId}, ${oi.qty}, ${oi.unitPrice}, ${oi.batchId})
    `;
  }
  for (const cl of callLogRows0) {
    await sql`
      INSERT INTO call_logs (id, order_id, agent_id, call_token, call_status, duration_seconds)
      VALUES (gen_random_uuid(), ${cl.orderId}, ${cl.agentId}, ${randomUUID()}, ${cl.status}, ${cl.duration})
    `;
  }
  inserted += orderRows0.length;

  // 2) Create remaining orders (other statuses)
  const remaining = opts.orderCount - opts.deliveredOrderCount;
  console.log(`  [Heavy] Creating ${remaining} other orders...`);
  for (let offset = 0; offset < remaining; offset += BATCH_SIZE) {
    const count = Math.min(BATCH_SIZE, remaining - offset);
    const orderRows: ReturnType<typeof makeOrderRow>[] = [];
    const orderItemRows: Array<{ orderId: string; productId: string; qty: number; unitPrice: string; batchId: string }> = [];
    const callLogRows: Array<{ orderId: string; agentId: string; status: string; duration: number | null }> = [];
    for (let i = 0; i < count; i++) {
      const status = faker.helpers.arrayElement(ORDER_STATUSES_OTHER);
      const o = makeOrderRow(status, opts.deliveredOrderCount + offset, i);
      orderRows.push(o);
      const campaign = opts.campaignRows[(opts.deliveredOrderCount + offset + i) % opts.campaignRows.length]!;
      const productId = campaign.productIds[0] ?? opts.productIds[0]!;
      const batchId = opts.batchByProduct[productId] ?? opts.batchByProduct[opts.productIds[0]!]!;
      orderItemRows.push({ orderId: o.id, productId, qty: 1, unitPrice: o.totalAmount, batchId });
      if (o.assignedCsId && status !== 'UNPROCESSED' && status !== 'CANCELLED') {
        callLogRows.push({ orderId: o.id, agentId: o.assignedCsId, status: 'COMPLETED', duration: faker.number.int({ min: 15, max: 120 }) });
      }
    }
    for (const o of orderRows) {
      await sql`
        INSERT INTO orders (
          id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
          rider_id, status, customer_name, customer_phone_hash, customer_address, delivery_address,
          total_amount, landed_cost, delivery_fee, delivery_otp, delivery_gps_lat, delivery_gps_lng,
          items, created_at, delivered_at
        ) VALUES (
          ${o.id}, ${o.campaignId}, ${o.mediaBuyerId}, ${o.assignedCsId},
          ${o.logisticsProviderId}, ${o.logisticsLocationId}, ${o.riderId}, ${o.status},
          ${o.customerName}, ${o.customerPhoneHash}, ${o.customerAddress}, ${o.deliveryAddress},
          ${o.totalAmount}, ${o.landedCost}, ${o.deliveryFee}, ${o.deliveryOtp}, ${o.deliveryGpsLat}, ${o.deliveryGpsLng},
          ${o.items}::jsonb, ${o.createdAt}, ${o.deliveredAt}
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
    if (offset + BATCH_SIZE < remaining) process.stdout.write(`  [Heavy] ${inserted}/${opts.orderCount} orders...\r`);
  }

  // 3) Delivery confirmation requests (one per delivered order)
  console.log('  [Heavy] Creating delivery confirmation requests...');
  for (const info of deliveredOrderInfos) {
    const payload = JSON.stringify({
      newStatus: 'DELIVERED',
      gpsLat: 6.4541,
      gpsLng: 3.4754,
      deliveredQuantity: 1,
      deliveryFeeAddOn: 0,
    });
    await sql`
      INSERT INTO delivery_confirmation_requests (id, order_id, requested_by, status, approved_by, approved_at, payload)
      VALUES (gen_random_uuid(), ${info.orderId}, ${info.riderId}, 'APPROVED', ${opts.headOfLogisticsId}, NOW() - INTERVAL '2 days', ${payload}::jsonb)
    `;
  }

  // 4) Delivery remittances: 10–12 batches; attach 40–45 of the 50 delivered (leave 5–10 eligible)
  console.log('  [Heavy] Creating delivery remittances...');
  const deliveredOrderIds = deliveredOrderInfos.map((x) => x.orderId);
  const ordersToRemit = deliveredOrderIds.slice(0, 45);
  const numRemittances = 12;
  const remittanceIds: string[] = [];
  for (let r = 0; r < numRemittances; r++) {
    const loc = r % 2 === 0 ? opts.location1 : opts.location2;
    const sentBy = tplManagerByLocation[loc]!;
    const id = randomUUID();
    remittanceIds.push(id);
    const status = r < 4 ? 'SENT' : 'RECEIVED';
    const receivedAt = r >= 4 ? new Date(Date.now() - (12 - r) * 24 * 60 * 60 * 1000) : null;
    const receivedBy = r >= 4 ? opts.financeOfficerId : null;
    await sql`
      INSERT INTO delivery_remittances (id, logistics_location_id, sent_by, receipt_urls, status, sent_at, received_at, received_by)
      VALUES (
        ${id}, ${loc}, ${sentBy}, ${JSON.stringify(['https://storage.example.com/receipts/delivery-remit.jpg'])}::jsonb,
        ${status}, NOW() - (${14 - r} * INTERVAL '1 day'), ${receivedAt}, ${receivedBy}
      )
    `;
  }
  for (let i = 0; i < ordersToRemit.length; i++) {
    const orderId = ordersToRemit[i]!;
    const remittanceId = remittanceIds[i % numRemittances]!;
    await sql`
      INSERT INTO delivery_remittance_orders (id, delivery_remittance_id, order_id)
      VALUES (gen_random_uuid(), ${remittanceId}, ${orderId})
    `;
  }

  // 5) RETURNED orders (5–10) for TPL Returns page
  console.log('  [Heavy] Creating RETURNED orders...');
  const returnedCount = 8;
  for (let i = 0; i < returnedCount; i++) {
    const loc = i % 2 === 0 ? opts.location1 : opts.location2;
    const riders = riderIdsByLocation[loc]!;
    const riderId = riders[i % riders.length]!;
    const campaign = opts.campaignRows[i % opts.campaignRows.length]!;
    const productId = campaign.productIds[0] ?? opts.productIds[0]!;
    const batchId = opts.batchByProduct[productId] ?? opts.batchByProduct[opts.productIds[0]!]!;
    const orderId = randomUUID();
    const unitPrice = faker.number.int({ min: 8000, max: 25000 });
    const custName = faker.person.fullName();
    const phoneHash = 'hash_' + faker.string.alphanumeric(12);
    const addr = faker.location.streetAddress() + ', Lagos';
    await sql`
      INSERT INTO orders (
        id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
        rider_id, status, customer_name, customer_phone_hash, customer_address, delivery_address,
        total_amount, items, created_at
      ) VALUES (
        ${orderId}, ${campaign.id}, ${campaign.mediaBuyerId}, ${opts.csAgentIds[i % opts.csAgentIds.length]!},
        ${providerByLocation[loc]!}, ${loc}, ${riderId}, 'RETURNED',
        ${custName}, ${phoneHash}, ${addr}, ${addr},
        ${String(unitPrice)}, ${JSON.stringify([{ productId, quantity: 1, unitPrice }])}::jsonb, NOW() - (${i + 1} * INTERVAL '1 day')
      )
    `;
    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
      VALUES (gen_random_uuid(), ${orderId}, ${productId}, 1, ${String(unitPrice)}, ${batchId})
    `;
    inserted += 1;
  }

  // 6) TPL notifications (transfer:sent, delivery_remittance:received for managers; for riders)
  console.log('  [Heavy] Creating TPL notifications...');
  for (let i = 0; i < 5; i++) {
    await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, read)
      VALUES (gen_random_uuid(), ${opts.tplManager1Id}, 'transfer:sent', ${'Stock transfer incoming'}, ${'Transfer to your location pending verification'}, ${JSON.stringify({ transferId: randomUUID() })}::jsonb, false)
    `;
    await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, read)
      VALUES (gen_random_uuid(), ${opts.tplManager2Id}, 'transfer:sent', ${'Stock transfer incoming'}, ${'Transfer to your location pending verification'}, ${JSON.stringify({ transferId: randomUUID() })}::jsonb, false)
    `;
  }
  await sql`
    INSERT INTO notifications (id, user_id, type, title, body, data, read)
    VALUES (gen_random_uuid(), ${opts.tplManager1Id}, 'delivery_remittance:received', ${'Delivery remittance received'}, ${'Finance marked your remittance as received'}, ${JSON.stringify({ deliveryRemittanceId: remittanceIds[0] })}::jsonb, false)
  `;
  await sql`
    INSERT INTO notifications (id, user_id, type, title, body, data, read)
    VALUES (gen_random_uuid(), ${opts.tplManager2Id}, 'delivery_remittance:received', ${'Delivery remittance received'}, ${'Finance marked your remittance as received'}, ${JSON.stringify({ deliveryRemittanceId: remittanceIds[1] })}::jsonb, false)
  `;
  for (const riderId of opts.riderIds) {
    await sql`
      INSERT INTO notifications (id, user_id, type, title, body, data, read)
      VALUES (gen_random_uuid(), ${riderId}, 'order_assigned', ${'New delivery assigned'}, ${'You have a new delivery'}, '{}'::jsonb, false)
    `;
  }

  console.log(`  [Heavy] ${inserted} orders created.`);

  // Extra ad spend for last 30 days across a subset of campaigns (APPROVED; balance = funding - spend)
  console.log('  [Heavy] Creating ad spend entries...');
  for (const row of opts.campaignRows.slice(0, 20)) {
    for (let d = 0; d < 30; d += 3) {
      const spendDate = new Date();
      spendDate.setDate(spendDate.getDate() - d);
      await sql`
        INSERT INTO ad_spend_logs (id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date, status, approved_at)
        VALUES (
          gen_random_uuid(), ${row.mediaBuyerId}, ${row.productIds[0] ?? opts.productIds[0]!}, ${row.id},
          ${String(faker.number.int({ min: 20000, max: 80000 }))}.00,
          'https://storage.example.com/screenshots/ads.jpg',
          ${spendDate}, 'APPROVED', ${spendDate}
        )
      `;
    }
  }

  // Extra notifications per user (capped for performance)
  console.log('  [Heavy] Creating notifications...');
  const allUserIds = [...opts.csAgentIds, ...opts.mediaBuyerIds, ...opts.riderIds];
  for (const userId of allUserIds) {
    const n = Math.min(5, faker.number.int({ min: 2, max: 6 }));
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
