/**
 * Database seed script — creates realistic development data.
 *
 * Usage: npx tsx packages/shared/src/db/seed.ts
 *
 * Requires DATABASE_URL environment variable.
 * Idempotent: checks for existing data before inserting.
 */

import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const SALT_ROUNDS = 12;

// ── Deterministic IDs for foreign key references ────────────────────

const IDS = {
  // Users
  superAdmin: randomUUID(),
  headOfMarketing: randomUUID(),
  mediaBuyer1: randomUUID(),
  mediaBuyer2: randomUUID(),
  headOfCs: randomUUID(),
  csAgent1: randomUUID(),
  csAgent2: randomUUID(),
  csAgent3: randomUUID(),
  financeOfficer: randomUUID(),
  headOfLogistics: randomUUID(),
  warehouseManager: randomUUID(),
  tplManager1: randomUUID(),
  tplManager2: randomUUID(),
  rider1: randomUUID(),
  rider2: randomUUID(),
  rider3: randomUUID(),
  hrManager: randomUUID(),

  // Products
  product1: randomUUID(),
  product2: randomUUID(),
  product3: randomUUID(),
  product4: randomUUID(),
  product5: randomUUID(),

  // Logistics
  provider1: randomUUID(),
  provider2: randomUUID(),
  locationMain: randomUUID(),
  location1: randomUUID(),
  location2: randomUUID(),

  // Stock batches
  batch1p1: randomUUID(),
  batch2p1: randomUUID(),
  batch1p2: randomUUID(),
  batch1p3: randomUUID(),
  batch1p4: randomUUID(),
  batch1p5: randomUUID(),

  // Offer templates
  offer1: randomUUID(),
  offer2: randomUUID(),
  offer3: randomUUID(),

  // Campaigns
  campaign1: randomUUID(),
  campaign2: randomUUID(),
  campaign3: randomUUID(),

  // Orders
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

  // Commission plans
  csPlan: randomUUID(),
  mbPlan: randomUUID(),
  riderPlan: randomUUID(),

  // Budgets
  budget1: randomUUID(),
  budget2: randomUUID(),
};

async function seed() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  // Check if seed data already exists
  const existing = await sql`SELECT id FROM users WHERE email = 'admin@yannis.com'`;
  if (existing.length > 0) {
    console.log('Seed data already exists. To re-seed, truncate tables first.');
    await sql.end();
    return;
  }

  console.log('Seeding database...\n');

  const password = 'password123';
  const hash = await bcrypt.hash(password, SALT_ROUNDS);

  // ══════════════════════════════════════════════════════════════════
  // 1. USERS (17 staff across all roles)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating users...');

  const users = [
    { id: IDS.superAdmin, name: 'Adewale Okafor', email: 'admin@yannis.com', role: 'SUPER_ADMIN', capacity: 100, locationId: null, phone: '08030001111' },
    { id: IDS.headOfMarketing, name: 'Funke Adeyemi', email: 'funke@yannis.com', role: 'HEAD_OF_MARKETING', capacity: 50, locationId: null, phone: '08030002222' },
    { id: IDS.mediaBuyer1, name: 'Chidi Eze', email: 'chidi@yannis.com', role: 'MEDIA_BUYER', capacity: 20, locationId: null, phone: '08030003333' },
    { id: IDS.mediaBuyer2, name: 'Amara Obi', email: 'amara@yannis.com', role: 'MEDIA_BUYER', capacity: 20, locationId: null, phone: '08030004444' },
    { id: IDS.headOfCs, name: 'Ngozi Udo', email: 'ngozi@yannis.com', role: 'HEAD_OF_CS', capacity: 50, locationId: null, phone: '08030005555' },
    { id: IDS.csAgent1, name: 'Tunde Bello', email: 'tunde@yannis.com', role: 'CS_AGENT', capacity: 10, locationId: null, phone: '08030006666' },
    { id: IDS.csAgent2, name: 'Chisom Nwankwo', email: 'chisom@yannis.com', role: 'CS_AGENT', capacity: 10, locationId: null, phone: '08030007777' },
    { id: IDS.csAgent3, name: 'Yemi Alade', email: 'yemi@yannis.com', role: 'CS_AGENT', capacity: 10, locationId: null, phone: '08030008888' },
    { id: IDS.financeOfficer, name: 'Kemi Johnson', email: 'kemi@yannis.com', role: 'FINANCE_OFFICER', capacity: 50, locationId: null, phone: '08030009999' },
    { id: IDS.headOfLogistics, name: 'Emeka Nwosu', email: 'emeka@yannis.com', role: 'HEAD_OF_LOGISTICS', capacity: 50, locationId: null, phone: '08031001111' },
    { id: IDS.warehouseManager, name: 'Bola Taiwo', email: 'bola@yannis.com', role: 'WAREHOUSE_MANAGER', capacity: 50, locationId: null, phone: '08031002222' },
    { id: IDS.tplManager1, name: 'Ife Akin', email: 'ife@yannis.com', role: 'TPL_MANAGER', capacity: 30, locationId: null, phone: '08031003333' },
    { id: IDS.tplManager2, name: 'Sola Bakare', email: 'sola@yannis.com', role: 'TPL_MANAGER', capacity: 30, locationId: null, phone: '08031004444' },
    { id: IDS.rider1, name: 'Segun Ola', email: 'segun@yannis.com', role: 'TPL_RIDER', capacity: 15, locationId: null, phone: '08031005555' },
    { id: IDS.rider2, name: 'Dayo Ige', email: 'dayo@yannis.com', role: 'TPL_RIDER', capacity: 15, locationId: null, phone: '08031006666' },
    { id: IDS.rider3, name: 'Femi Ogunleye', email: 'femi@yannis.com', role: 'TPL_RIDER', capacity: 15, locationId: null, phone: '08031007777' },
    { id: IDS.hrManager, name: 'Aisha Bello', email: 'aisha@yannis.com', role: 'HR_MANAGER', capacity: 50, locationId: null, phone: '08031008888' },
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

  // Assign TPL managers and riders to locations
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.tplManager1}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location2} WHERE id = ${IDS.tplManager2}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.rider1}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location1} WHERE id = ${IDS.rider2}`;
  await sql`UPDATE users SET logistics_location_id = ${IDS.location2} WHERE id = ${IDS.rider3}`;

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
    { productId: IDS.product1, type: 'RESERVATION', qty: -10, fromLocationId: IDS.locationMain, reason: 'Reserved for confirmed orders', actorId: IDS.csAgent1 },
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
  // 9. CAMPAIGNS
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating campaigns...');

  await sql`
    INSERT INTO campaigns (id, media_buyer_id, name, product_ids, offer_template_id, deployment_type, status)
    VALUES
      (${IDS.campaign1}, ${IDS.mediaBuyer1}, 'Q1 Waist Trainer Push', ${JSON.stringify([IDS.product1])}::jsonb, ${IDS.offer1}, 'HOSTED', 'ACTIVE'),
      (${IDS.campaign2}, ${IDS.mediaBuyer1}, 'Blender Pro Launch', ${JSON.stringify([IDS.product2])}::jsonb, ${IDS.offer2}, 'SNIPPET', 'ACTIVE'),
      (${IDS.campaign3}, ${IDS.mediaBuyer2}, 'Hair Growth Campaign', ${JSON.stringify([IDS.product5])}::jsonb, ${IDS.offer3}, 'HOSTED', 'ACTIVE')
  `;

  // ══════════════════════════════════════════════════════════════════
  // 10. ORDERS (10 orders in various states across the lifecycle)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating orders...');

  const orders = [
    // UNPROCESSED — just came in
    {
      id: IDS.order1, campaignId: IDS.campaign1, mediaBuyerId: IDS.mediaBuyer1,
      status: 'UNPROCESSED', customerName: 'Blessing Okonkwo', customerPhoneHash: 'hash_08012345001',
      customerAddress: '15 Akin Adesola St, Victoria Island, Lagos',
      deliveryAddress: '15 Akin Adesola St, Victoria Island, Lagos',
      totalAmount: '9999.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 9999 }]),
    },
    // UNPROCESSED
    {
      id: IDS.order2, campaignId: IDS.campaign3, mediaBuyerId: IDS.mediaBuyer2,
      status: 'UNPROCESSED', customerName: 'Emeka Uche', customerPhoneHash: 'hash_08012345002',
      customerAddress: '8 Adeola Odeku, Lekki, Lagos',
      deliveryAddress: '8 Adeola Odeku, Lekki, Lagos',
      totalAmount: '8500.00', items: JSON.stringify([{ productId: IDS.product5, quantity: 1, unitPrice: 8500 }]),
    },
    // CS_ENGAGED — agent is on a call
    {
      id: IDS.order3, campaignId: IDS.campaign1, mediaBuyerId: IDS.mediaBuyer1,
      assignedCsId: IDS.csAgent1, status: 'CS_ENGAGED',
      customerName: 'Fatima Abdullahi', customerPhoneHash: 'hash_08012345003',
      customerAddress: '22 Awolowo Road, Ikoyi, Lagos',
      deliveryAddress: '22 Awolowo Road, Ikoyi, Lagos',
      totalAmount: '10999.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 10999 }]),
    },
    // CONFIRMED — awaiting allocation
    {
      id: IDS.order4, campaignId: IDS.campaign2, mediaBuyerId: IDS.mediaBuyer1,
      assignedCsId: IDS.csAgent2, status: 'CONFIRMED',
      customerName: 'Chidinma Okafor', customerPhoneHash: 'hash_08012345004',
      customerAddress: '5 Allen Avenue, Ikeja, Lagos',
      deliveryAddress: '5 Allen Avenue, Ikeja, Lagos',
      totalAmount: '15500.00', items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 15500 }]),
    },
    // ALLOCATED — assigned to 3PL
    {
      id: IDS.order5, campaignId: IDS.campaign1, mediaBuyerId: IDS.mediaBuyer1,
      assignedCsId: IDS.csAgent1, logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      status: 'ALLOCATED',
      customerName: 'Adaeze Nnamdi', customerPhoneHash: 'hash_08012345005',
      customerAddress: '10 Ajose Adeogun, VI, Lagos',
      deliveryAddress: '10 Ajose Adeogun, VI, Lagos',
      totalAmount: '9999.00', items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 9999 }]),
    },
    // DISPATCHED — rider has picked up
    {
      id: IDS.order6, campaignId: IDS.campaign2, mediaBuyerId: IDS.mediaBuyer1,
      assignedCsId: IDS.csAgent2, logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.rider1, status: 'DISPATCHED', deliveryOtp: '4821',
      customerName: 'Oluwaseun Balogun', customerPhoneHash: 'hash_08012345006',
      customerAddress: '33 Admiralty Way, Lekki Phase 1',
      deliveryAddress: '33 Admiralty Way, Lekki Phase 1',
      totalAmount: '15500.00', items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 15500 }]),
    },
    // IN_TRANSIT
    {
      id: IDS.order7, campaignId: IDS.campaign3, mediaBuyerId: IDS.mediaBuyer2,
      assignedCsId: IDS.csAgent3, logisticsProviderId: IDS.provider2, logisticsLocationId: IDS.location2,
      riderId: IDS.rider3, status: 'IN_TRANSIT', deliveryOtp: '7293',
      customerName: 'Hauwa Ibrahim', customerPhoneHash: 'hash_08012345007',
      customerAddress: '14 Gana Street, Maitama, Abuja',
      deliveryAddress: '14 Gana Street, Maitama, Abuja',
      totalAmount: '8500.00', items: JSON.stringify([{ productId: IDS.product5, quantity: 1, unitPrice: 8500 }]),
    },
    // DELIVERED
    {
      id: IDS.order8, campaignId: IDS.campaign1, mediaBuyerId: IDS.mediaBuyer1,
      assignedCsId: IDS.csAgent1, logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.rider2, status: 'DELIVERED',
      deliveryOtp: '1547', deliveryGpsLat: '6.4541', deliveryGpsLng: '3.4754',
      customerName: 'Grace Okechukwu', customerPhoneHash: 'hash_08012345008',
      customerAddress: '7 Ozumba Mbadiwe, VI, Lagos',
      deliveryAddress: '7 Ozumba Mbadiwe, VI, Lagos',
      totalAmount: '9999.00', landedCost: '4300.00', deliveryFee: '1500.00',
      items: JSON.stringify([{ productId: IDS.product1, quantity: 1, unitPrice: 9999 }]),
    },
    // COMPLETED
    {
      id: IDS.order9, campaignId: IDS.campaign2, mediaBuyerId: IDS.mediaBuyer1,
      assignedCsId: IDS.csAgent2, logisticsProviderId: IDS.provider1, logisticsLocationId: IDS.location1,
      riderId: IDS.rider1, status: 'COMPLETED',
      deliveryOtp: '3890', deliveryGpsLat: '6.4312', deliveryGpsLng: '3.4521',
      customerName: 'Samuel Taiwo', customerPhoneHash: 'hash_08012345009',
      customerAddress: '20 Ligali Ayorinde, VI, Lagos',
      deliveryAddress: '20 Ligali Ayorinde, VI, Lagos',
      totalAmount: '18000.00', landedCost: '7200.00', deliveryFee: '1500.00',
      items: JSON.stringify([{ productId: IDS.product2, quantity: 1, unitPrice: 18000 }]),
    },
    // CANCELLED
    {
      id: IDS.order10, campaignId: IDS.campaign3, mediaBuyerId: IDS.mediaBuyer2,
      assignedCsId: IDS.csAgent3, status: 'CANCELLED',
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
    { orderId: IDS.order3, agentId: IDS.csAgent1, status: 'IN_PROGRESS', duration: null },
    { orderId: IDS.order4, agentId: IDS.csAgent2, status: 'COMPLETED', duration: 45 },
    { orderId: IDS.order5, agentId: IDS.csAgent1, status: 'COMPLETED', duration: 32 },
    { orderId: IDS.order8, agentId: IDS.csAgent1, status: 'COMPLETED', duration: 28 },
    { orderId: IDS.order9, agentId: IDS.csAgent2, status: 'COMPLETED', duration: 55 },
    { orderId: IDS.order10, agentId: IDS.csAgent3, status: 'COMPLETED', duration: 18 },
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

  await sql`
    INSERT INTO marketing_funding (id, sender_id, receiver_id, amount, receipt_url, status, sent_at, verified_at)
    VALUES
      (gen_random_uuid(), ${IDS.headOfMarketing}, ${IDS.mediaBuyer1}, '500000.00', 'https://storage.example.com/receipts/funding-001.jpg', 'COMPLETED', NOW() - INTERVAL '10 days', NOW() - INTERVAL '9 days'),
      (gen_random_uuid(), ${IDS.headOfMarketing}, ${IDS.mediaBuyer2}, '300000.00', 'https://storage.example.com/receipts/funding-002.jpg', 'COMPLETED', NOW() - INTERVAL '7 days', NOW() - INTERVAL '6 days'),
      (gen_random_uuid(), ${IDS.headOfMarketing}, ${IDS.mediaBuyer1}, '200000.00', 'https://storage.example.com/receipts/funding-003.jpg', 'SENT', NOW() - INTERVAL '1 day', null)
  `;

  // ══════════════════════════════════════════════════════════════════
  // 14. AD SPEND LOGS (daily spend entries)
  // ══════════════════════════════════════════════════════════════════
  console.log('  Creating ad spend logs...');

  const adSpendEntries = [
    { mbId: IDS.mediaBuyer1, productId: IDS.product1, campaignId: IDS.campaign1, amount: '45000.00', daysAgo: 5 },
    { mbId: IDS.mediaBuyer1, productId: IDS.product1, campaignId: IDS.campaign1, amount: '52000.00', daysAgo: 4 },
    { mbId: IDS.mediaBuyer1, productId: IDS.product1, campaignId: IDS.campaign1, amount: '38000.00', daysAgo: 3 },
    { mbId: IDS.mediaBuyer1, productId: IDS.product2, campaignId: IDS.campaign2, amount: '60000.00', daysAgo: 4 },
    { mbId: IDS.mediaBuyer1, productId: IDS.product2, campaignId: IDS.campaign2, amount: '55000.00', daysAgo: 3 },
    { mbId: IDS.mediaBuyer2, productId: IDS.product5, campaignId: IDS.campaign3, amount: '30000.00', daysAgo: 3 },
    { mbId: IDS.mediaBuyer2, productId: IDS.product5, campaignId: IDS.campaign3, amount: '35000.00', daysAgo: 2 },
    { mbId: IDS.mediaBuyer2, productId: IDS.product5, campaignId: IDS.campaign3, amount: '28000.00', daysAgo: 1 },
  ];

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

  const payouts = [
    { staffId: IDS.csAgent1, base: '50000.00', bonus: '5000.00', addOns: '2000.00', deductions: '0.00', total: '57000.00', status: 'APPROVED' },
    { staffId: IDS.csAgent2, base: '50000.00', bonus: '3000.00', addOns: '0.00', deductions: '500.00', total: '52500.00', status: 'PENDING_APPROVAL' },
    { staffId: IDS.mediaBuyer1, base: '40000.00', bonus: '10000.00', addOns: '5000.00', deductions: '0.00', total: '55000.00', status: 'PAID' },
    { staffId: IDS.rider1, base: '30000.00', bonus: '8000.00', addOns: '0.00', deductions: '800.00', total: '37200.00', status: 'APPROVED' },
  ];

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
      (gen_random_uuid(), ${IDS.csAgent1}, '2000.00', 'BONUS', 'Employee of the month — January 2026', ${IDS.hrManager}),
      (gen_random_uuid(), ${IDS.csAgent2}, '-500.00', 'CLAWBACK', 'Order returned: customer rejected delivery', ${IDS.hrManager}),
      (gen_random_uuid(), ${IDS.mediaBuyer1}, '5000.00', 'PERFORMANCE', 'Exceeded Q1 ROAS target by 40%', ${IDS.hrManager}),
      (gen_random_uuid(), ${IDS.rider1}, '-800.00', 'DEDUCTION', 'Late delivery penalty — 3 orders', ${IDS.hrManager})
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

  const notifications = [
    { userId: IDS.csAgent1, type: 'order_assigned', title: 'New Order Assigned', body: 'Order from Fatima Abdullahi has been assigned to you.', data: { orderId: IDS.order3 } },
    { userId: IDS.csAgent2, type: 'order_assigned', title: 'New Order Assigned', body: 'Order from Chidinma Okafor has been assigned to you.', data: { orderId: IDS.order4 } },
    { userId: IDS.headOfLogistics, type: 'transfer_pending', title: 'Transfer Pending Verification', body: 'Stock transfer of Smart Watch X1 to GoRide Wuse Hub awaiting verification.', data: {} },
    { userId: IDS.mediaBuyer1, type: 'funding_received', title: 'Funding Received', body: 'You received ₦500,000 from Head of Marketing. Please verify.', data: {} },
    { userId: IDS.financeOfficer, type: 'approval_pending', title: 'Approval Request', body: 'Emergency restock request from Warehouse Manager needs review.', data: {} },
    { userId: IDS.superAdmin, type: 'system', title: 'System Ready', body: 'Yannis EOSE seed data loaded successfully.', data: {} },
  ];

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

  const assignments = [
    { userId: IDS.mediaBuyer1, productId: IDS.product1 },
    { userId: IDS.mediaBuyer1, productId: IDS.product2 },
    { userId: IDS.mediaBuyer2, productId: IDS.product5 },
    { userId: IDS.mediaBuyer2, productId: IDS.product4 },
  ];

  for (const a of assignments) {
    await sql`
      INSERT INTO user_product_assignments (id, user_id, product_id)
      VALUES (gen_random_uuid(), ${a.userId}, ${a.productId})
    `;
  }

  // ══════════════════════════════════════════════════════════════════
  // DONE
  // ══════════════════════════════════════════════════════════════════

  console.log('\n========================================');
  console.log('  Seed complete!');
  console.log('========================================');
  console.log('\n  Login Credentials (all users):');
  console.log(`  Password: ${password}`);
  console.log('\n  User Accounts:');
  console.log('  ─────────────────────────────────────');
  for (const u of users) {
    console.log(`  ${u.role.padEnd(20)} ${u.name.padEnd(22)} ${u.email}`);
  }
  console.log('\n  Data Summary:');
  console.log(`  Users:              ${users.length}`);
  console.log(`  Products:           ${products.length}`);
  console.log(`  Logistics Providers: 2`);
  console.log(`  Locations:          3`);
  console.log(`  Stock Batches:      ${batches.length}`);
  console.log(`  Inventory Levels:   ${levels.length}`);
  console.log(`  Orders:             ${orders.length}`);
  console.log(`  Call Logs:          ${callLogs.length}`);
  console.log(`  Ad Spend Entries:   ${adSpendEntries.length}`);
  console.log(`  Commission Plans:   3`);
  console.log(`  Payout Records:     ${payouts.length}`);
  console.log(`  Notifications:      ${notifications.length}`);
  console.log('');

  await sql.end();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
