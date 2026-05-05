/**
 * Revenue Boost Seed — adds profitable delivered orders to flip the P&L positive.
 *
 * Usage:
 *   pnpm db:seed:boost              # Add 200 profitable delivered orders + invoices
 *   BOOST_COUNT=500 pnpm db:seed:boost  # Custom count
 *
 * This script is ADDITIVE — it does NOT truncate existing data.
 * It reads existing users, products, locations, campaigns, and batches,
 * then inserts high-margin delivered/completed orders with proper:
 *   - order_items + batch references
 *   - call logs
 *   - delivery confirmation requests (approved + pending demo rows for HoL QA)
 *   - delivery remittances
 *   - invoices (PAID)
 *   - ad spend entries (low, profitable)
 *
 * Run AFTER your data/bootstrap setup that includes users, products, campaigns, and stock.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../../.env') });

import postgres from 'postgres';
import { randomUUID } from 'crypto';
import { faker } from '@faker-js/faker';

faker.seed(99999);

const BOOST_COUNT = Math.min(
  2000,
  Math.max(50, parseInt(process.env['BOOST_COUNT'] ?? '200', 10) || 200)
);
const PENDING_CONFIRMATION_DEMO_COUNT = 5;
const DISPUTED_REMITTANCE_DEMO_COUNT = 4;

async function boostSeed() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  console.log('========================================');
  console.log('  Revenue Boost Seed');
  console.log(`  Adding ${BOOST_COUNT} profitable orders`);
  console.log('========================================\n');

  // ── Load existing data ──────────────────────────────────────────
  console.log('  Loading existing data...');

  const users = await sql`SELECT id, role, logistics_location_id FROM users WHERE status = 'ACTIVE'`;
  const superAdmin = users.find((u: Record<string, unknown>) => u.role === 'SUPER_ADMIN');
  const csAgents = users.filter((u: Record<string, unknown>) => u.role === 'CS_AGENT');
  const mediaBuyers = users.filter((u: Record<string, unknown>) => u.role === 'MEDIA_BUYER');
  const riders = users.filter((u: Record<string, unknown>) => u.role === 'TPL_RIDER');
  const tplManagers = users.filter((u: Record<string, unknown>) => u.role === 'TPL_MANAGER');
  const financeOfficer = users.find((u: Record<string, unknown>) => u.role === 'FINANCE_OFFICER');
  const headOfLogistics = users.find((u: Record<string, unknown>) => u.role === 'HEAD_OF_LOGISTICS');
  const hrManager = users.find((u: Record<string, unknown>) => u.role === 'HR_MANAGER');

  if (!superAdmin || csAgents.length === 0 || mediaBuyers.length === 0 || riders.length === 0) {
    console.error('Required base data not found (users/roles). Prepare your base data, then run db:seed:boost.');
    await sql.end();
    process.exit(1);
  }

  // Set actor for audit triggers
  await sql`SELECT set_config('yannis.current_user_id', ${superAdmin.id as string}, true)`;

  // Ensure every non-SA user has a branch membership (idempotent backfill).
  // Without this, the login guard added in auth.service.ts would block these users.
  const defaultBranch = await sql`SELECT id FROM branches WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`;
  const defaultBranchId: string = defaultBranch[0]?.id as string ?? null;
  if (defaultBranchId) {
    await sql`
      INSERT INTO user_branches (user_id, branch_id, is_primary)
      SELECT u.id, ${defaultBranchId}, true
      FROM users u
      WHERE u.role != 'SUPER_ADMIN'
        AND NOT EXISTS (
          SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id
        )
      ON CONFLICT DO NOTHING
    `;
    console.log('  User branch memberships ensured.');
  }

  const products = await sql`SELECT id, name, base_sale_price, cost_price FROM products WHERE status = 'ACTIVE'`;
  const locations = await sql`SELECT id, name, provider_id FROM logistics_locations WHERE status = 'ACTIVE'`;
  const campaigns = await sql`SELECT id, media_buyer_id, product_ids FROM campaigns WHERE status = 'ACTIVE'`;
  const batches = await sql`SELECT id, product_id, total_landed_cost FROM stock_batches ORDER BY created_at`;

  if (products.length === 0 || locations.length === 0 || campaigns.length === 0) {
    console.error('No products/locations/campaigns found. Prepare base catalog/logistics/campaigns, then run db:seed:boost.');
    await sql.end();
    process.exit(1);
  }

  // Build lookup maps
  const batchByProduct: Record<string, { id: string; landedCost: number }> = {};
  for (const b of batches) {
    if (!batchByProduct[b.product_id as string]) {
      batchByProduct[b.product_id as string] = {
        id: b.id as string,
        landedCost: parseFloat(b.total_landed_cost as string),
      };
    }
  }

  // Riders by location
  const ridersByLocation: Record<string, string[]> = {};
  for (const r of riders) {
    const loc = r.logistics_location_id as string;
    if (loc) {
      if (!ridersByLocation[loc]) ridersByLocation[loc] = [];
      ridersByLocation[loc]!.push(r.id as string);
    }
  }

  // TPL managers by location
  const tplManagerByLocation: Record<string, string> = {};
  for (const t of tplManagers) {
    const loc = t.logistics_location_id as string;
    if (loc) tplManagerByLocation[loc] = t.id as string;
  }

  // Non-main locations (3PL hubs)
  const mainWarehouse = locations.find((l: Record<string, unknown>) => (l.name as string).includes('Main Warehouse'));
  const tplLocations = locations.filter((l: Record<string, unknown>) => l.id !== mainWarehouse?.id);

  // Product sale prices — use HIGHER prices for profit (premium pricing)
  const productPricing: Record<string, { salePrice: number; landedCost: number; batchId: string }> = {};
  for (const p of products) {
    const batch = batchByProduct[p.id as string];
    const baseSalePrice = parseFloat(p.base_sale_price as string);
    // Use sale prices 3x-5x landed cost for healthy margins
    const landedCost = batch?.landedCost ?? parseFloat(p.cost_price as string);
    const salePrice = Math.max(baseSalePrice, landedCost * 3.5);
    productPricing[p.id as string] = {
      salePrice: Math.round(salePrice / 100) * 100, // round to nearest 100
      landedCost,
      batchId: batch?.id ?? '',
    };
  }

  // Nigerian addresses for realistic data
  const lagosAreas = [
    'Victoria Island', 'Lekki Phase 1', 'Ikoyi', 'Surulere', 'Ikeja GRA',
    'Yaba', 'Maryland', 'Gbagada', 'Magodo', 'Ajah',
    'Apapa', 'Festac', 'Ogba', 'Oshodi', 'Mushin',
    'Anthony', 'Ogudu', 'Bariga', 'Obalende', 'Marina',
  ];

  const abujaAreas = [
    'Maitama', 'Wuse II', 'Garki', 'Asokoro', 'Gwarinpa',
    'Jabi', 'Utako', 'Kubwa', 'Life Camp', 'Lugbe',
  ];

  // ── Create profitable orders ────────────────────────────────────
  console.log(`  Creating ${BOOST_COUNT} profitable delivered orders...`);

  const deliveredOrderInfos: Array<{ orderId: string; riderId: string; locationId: string; totalAmount: number }> = [];
  const pendingConfirmationInfos: Array<{ orderId: string; riderId: string }> = [];
  let totalRevenue = 0;
  let totalLandedCostSum = 0;
  let totalDeliveryFees = 0;

  for (let i = 0; i < BOOST_COUNT; i++) {
    const orderId = randomUUID();

    // Pick product (weighted: more of the high-margin ones)
    const product = faker.helpers.arrayElement(products);
    const productId = product.id as string;
    const pricing = productPricing[productId]!;

    // Quantity 1-3 for bigger ticket sizes
    const quantity = faker.helpers.weightedArrayElement([
      { weight: 50, value: 1 },
      { weight: 30, value: 2 },
      { weight: 15, value: 3 },
      { weight: 5, value: 5 },
    ]);

    // Sale price with slight variation (+/- 10%)
    const unitPrice = Math.round(pricing.salePrice * (0.9 + Math.random() * 0.2));
    const totalAmount = unitPrice * quantity;
    const landedCostPerUnit = pricing.landedCost;
    const totalLandedCost = landedCostPerUnit * quantity;
    const deliveryFee = faker.helpers.arrayElement([1500, 2000, 2500]);

    // Pick campaign and media buyer
    const campaign = faker.helpers.arrayElement(campaigns);
    const mediaBuyerId = campaign.media_buyer_id as string;
    const campaignId = campaign.id as string;

    // Pick CS agent
    const csAgent = faker.helpers.arrayElement(csAgents);
    const csAgentId = csAgent.id as string;

    // Pick 3PL location and rider
    const tplLocation = faker.helpers.arrayElement(tplLocations);
    const locationId = tplLocation.id as string;
    const providerId = tplLocation.provider_id as string;
    const locationRiders = ridersByLocation[locationId] ?? riders.map((r: Record<string, unknown>) => r.id as string);
    const riderId = faker.helpers.arrayElement(locationRiders);

    // Status — heavily skewed towards DELIVERED (finance counts DELIVERED only)
    const status = faker.helpers.weightedArrayElement([
      { weight: 90, value: 'DELIVERED' },
      { weight: 8, value: 'REMITTED' },
      { weight: 2, value: 'IN_TRANSIT' },
    ]);

    // Dates — spread over last 60 days
    const daysAgo = faker.number.int({ min: 1, max: 60 });
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const deliveredAt = status !== 'IN_TRANSIT'
      ? new Date(createdAt.getTime() + faker.number.int({ min: 12, max: 72 }) * 60 * 60 * 1000)
      : null;

    // Preferred delivery date (1-5 days after creation)
    const prefDeliveryDate = new Date(createdAt.getTime() + faker.number.int({ min: 1, max: 5 }) * 24 * 60 * 60 * 1000);

    // Address
    const isAbuja = (tplLocation.name as string).includes('Abuja') || (tplLocation.name as string).includes('Wuse');
    const area = isAbuja
      ? faker.helpers.arrayElement(abujaAreas)
      : faker.helpers.arrayElement(lagosAreas);
    const streetNo = faker.number.int({ min: 1, max: 120 });
    const street = faker.location.street();
    const address = `${streetNo} ${street}, ${area}, ${isAbuja ? 'Abuja' : 'Lagos'}`;

    // Customer
    const customerName = faker.person.fullName();
    const customerPhone = '0' + faker.helpers.arrayElement(['7', '8', '9']) + faker.string.numeric(9);
    const phoneHash = 'hash_boost_' + faker.string.alphanumeric(10);

    const deliveryOtp = faker.string.numeric(4);
    const gpsLat = status !== 'IN_TRANSIT' ? (isAbuja ? '9.0' : '6.4') + faker.string.numeric(4) : null;
    const gpsLng = status !== 'IN_TRANSIT' ? (isAbuja ? '7.4' : '3.4') + faker.string.numeric(4) : null;

    const items = JSON.stringify([{ productId, quantity, unitPrice }]);

    // Insert order
    await sql`
      INSERT INTO orders (
        id, branch_id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
        rider_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_address,
        total_amount, landed_cost, delivery_fee, delivery_otp, delivery_gps_lat, delivery_gps_lng,
        items, created_at, delivered_at, preferred_delivery_date
      ) VALUES (
        ${orderId}, ${defaultBranchId}, ${campaignId}, ${mediaBuyerId}, ${csAgentId},
        ${providerId}, ${locationId}, ${riderId}, ${status},
        ${customerName}, ${phoneHash}, ${customerPhone}, ${address}, ${address},
        ${String(totalAmount)}, ${String(totalLandedCost)}, ${String(deliveryFee)},
        ${deliveryOtp}, ${gpsLat}, ${gpsLng},
        ${items}::jsonb, ${createdAt}, ${deliveredAt}, ${prefDeliveryDate}
      )
    `;

    // Insert order items
    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
      VALUES (gen_random_uuid(), ${orderId}, ${productId}, ${quantity}, ${String(unitPrice)}, ${pricing.batchId || null})
    `;

    // Insert call log (all delivered orders had successful calls)
    await sql`
      INSERT INTO call_logs (id, order_id, agent_id, call_token, call_status, duration_seconds)
      VALUES (gen_random_uuid(), ${orderId}, ${csAgentId}, ${randomUUID()}, 'COMPLETED', ${faker.number.int({ min: 20, max: 180 })})
    `;

    if (status !== 'IN_TRANSIT') {
      deliveredOrderInfos.push({ orderId, riderId, locationId, totalAmount });
      totalRevenue += totalAmount;
      totalLandedCostSum += totalLandedCost;
      totalDeliveryFees += deliveryFee;
    } else {
      pendingConfirmationInfos.push({ orderId, riderId });
    }

    if ((i + 1) % 50 === 0) process.stdout.write(`  Progress: ${i + 1}/${BOOST_COUNT} orders...\r`);
  }
  console.log(`  Created ${BOOST_COUNT} orders.                    `);

  // ── Deterministic pending confirmation demo rows ────────────────
  console.log(`  Adding ${PENDING_CONFIRMATION_DEMO_COUNT} in-transit demo orders with pending confirmations...`);
  for (let i = 0; i < PENDING_CONFIRMATION_DEMO_COUNT; i++) {
    const orderId = randomUUID();
    const product = faker.helpers.arrayElement(products);
    const productId = product.id as string;
    const pricing = productPricing[productId]!;
    const quantity = faker.number.int({ min: 1, max: 2 });
    const unitPrice = Math.round(pricing.salePrice * (0.9 + Math.random() * 0.2));
    const totalAmount = unitPrice * quantity;
    const landedCostPerUnit = pricing.landedCost;
    const totalLandedCost = landedCostPerUnit * quantity;
    const deliveryFee = faker.helpers.arrayElement([1500, 2000, 2500]);

    const campaign = faker.helpers.arrayElement(campaigns);
    const mediaBuyerId = campaign.media_buyer_id as string;
    const campaignId = campaign.id as string;
    const csAgent = faker.helpers.arrayElement(csAgents);
    const csAgentId = csAgent.id as string;

    const tplLocation = faker.helpers.arrayElement(tplLocations);
    const locationId = tplLocation.id as string;
    const providerId = tplLocation.provider_id as string;
    const locationRiders = ridersByLocation[locationId] ?? riders.map((r: Record<string, unknown>) => r.id as string);
    const riderId = faker.helpers.arrayElement(locationRiders);

    const daysAgo = faker.number.int({ min: 1, max: 14 });
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const prefDeliveryDate = new Date(createdAt.getTime() + faker.number.int({ min: 1, max: 3 }) * 24 * 60 * 60 * 1000);
    const isAbuja = (tplLocation.name as string).includes('Abuja') || (tplLocation.name as string).includes('Wuse');
    const area = isAbuja ? faker.helpers.arrayElement(abujaAreas) : faker.helpers.arrayElement(lagosAreas);
    const streetNo = faker.number.int({ min: 1, max: 120 });
    const street = faker.location.street();
    const address = `${streetNo} ${street}, ${area}, ${isAbuja ? 'Abuja' : 'Lagos'}`;
    const customerName = faker.person.fullName();
    const customerPhone = '0' + faker.helpers.arrayElement(['7', '8', '9']) + faker.string.numeric(9);
    const phoneHash = 'hash_boost_pending_' + faker.string.alphanumeric(10);
    const deliveryOtp = faker.string.numeric(4);
    const items = JSON.stringify([{ productId, quantity, unitPrice }]);

    await sql`
      INSERT INTO orders (
        id, branch_id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
        rider_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_address,
        total_amount, landed_cost, delivery_fee, delivery_otp, items, created_at, delivered_at, preferred_delivery_date
      ) VALUES (
        ${orderId}, ${defaultBranchId}, ${campaignId}, ${mediaBuyerId}, ${csAgentId},
        ${providerId}, ${locationId}, ${riderId}, 'IN_TRANSIT',
        ${customerName}, ${phoneHash}, ${customerPhone}, ${address}, ${address},
        ${String(totalAmount)}, ${String(totalLandedCost)}, ${String(deliveryFee)},
        ${deliveryOtp}, ${items}::jsonb, ${createdAt}, ${null}, ${prefDeliveryDate}
      )
    `;

    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
      VALUES (gen_random_uuid(), ${orderId}, ${productId}, ${quantity}, ${String(unitPrice)}, ${pricing.batchId || null})
    `;

    await sql`
      INSERT INTO call_logs (id, order_id, agent_id, call_token, call_status, duration_seconds)
      VALUES (gen_random_uuid(), ${orderId}, ${csAgentId}, ${randomUUID()}, 'COMPLETED', ${faker.number.int({ min: 20, max: 180 })})
    `;

    pendingConfirmationInfos.push({ orderId, riderId });
  }
  console.log(`  Added ${PENDING_CONFIRMATION_DEMO_COUNT} in-transit demo orders.`);

  // ── Delivery confirmation requests ──────────────────────────────
  console.log('  Creating delivery confirmation requests...');
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
      VALUES (gen_random_uuid(), ${info.orderId}, ${info.riderId}, 'APPROVED', ${headOfLogistics?.id ?? superAdmin.id}, NOW() - INTERVAL '1 day', ${payload}::jsonb)
    `;
  }
  for (const info of pendingConfirmationInfos) {
    const payload = JSON.stringify({
      newStatus: 'DELIVERED',
      gpsLat: 6.4541,
      gpsLng: 3.4754,
      deliveredQuantity: 1,
    });
    await sql`
      INSERT INTO delivery_confirmation_requests (id, order_id, requested_by, status, payload)
      VALUES (gen_random_uuid(), ${info.orderId}, ${info.riderId}, 'PENDING', ${payload}::jsonb)
    `;
  }

  // ── Delivery remittances ────────────────────────────────────────
  console.log('  Creating delivery remittances...');
  const remittanceBatchSize = 15;
  const remittanceIds: string[] = [];
  const numRemittances = Math.ceil(deliveredOrderInfos.length / remittanceBatchSize);

  for (let r = 0; r < numRemittances; r++) {
    const loc = tplLocations[r % tplLocations.length]!;
    const locationId = loc.id as string;
    const sentBy = tplManagerByLocation[locationId] ?? tplManagers[0]?.id as string;
    const id = randomUUID();
    remittanceIds.push(id);
    const daysAgo = Math.max(1, numRemittances - r);

    await sql`
      INSERT INTO delivery_remittances (id, logistics_location_id, sent_by, receipt_urls, status, sent_at, received_at, received_by)
      VALUES (
        ${id}, ${locationId}, ${sentBy},
        ${JSON.stringify(['https://storage.example.com/receipts/boost-remit.jpg'])}::jsonb,
        'RECEIVED', NOW() - (${daysAgo + 2} * INTERVAL '1 day'),
        NOW() - (${daysAgo} * INTERVAL '1 day'), ${financeOfficer?.id ?? superAdmin.id}
      )
    `;
  }

  // Link orders to remittances
  for (let i = 0; i < deliveredOrderInfos.length; i++) {
    const orderId = deliveredOrderInfos[i]!.orderId;
    const remittanceId = remittanceIds[Math.floor(i / remittanceBatchSize)]!;
    await sql`
      INSERT INTO delivery_remittance_orders (id, delivery_remittance_id, order_id)
      VALUES (gen_random_uuid(), ${remittanceId}, ${orderId})
    `;
  }

  // ── Disputed remittance demo fixtures (exactly 4 by default) ────────
  // These rows let Finance QA verify disputed-state rendering on /admin/finance/delivery-remittances.
  // We use a recognizable dispute reason prefix and skip if enough fixtures already exist.
  const disputeReasonPrefix = '[SEED] Demo disputed remittance';
  const existingDisputedSeedRows = await sql`
    SELECT id
    FROM delivery_remittances
    WHERE status = 'DISPUTED'
      AND dispute_reason LIKE ${disputeReasonPrefix + '%'}
    ORDER BY sent_at DESC
  `;
  const disputedFixturesToCreate = Math.max(
    0,
    DISPUTED_REMITTANCE_DEMO_COUNT - existingDisputedSeedRows.length,
  );

  if (disputedFixturesToCreate > 0) {
    console.log(`  Creating ${disputedFixturesToCreate} disputed delivery remittance fixture(s)...`);
  }

  for (let i = 0; i < disputedFixturesToCreate; i++) {
    const orderId = randomUUID();
    const product = faker.helpers.arrayElement(products);
    const productId = product.id as string;
    const pricing = productPricing[productId]!;
    const quantity = faker.number.int({ min: 1, max: 2 });
    const unitPrice = Math.round(pricing.salePrice * (0.9 + Math.random() * 0.2));
    const totalAmount = unitPrice * quantity;
    const totalLandedCost = pricing.landedCost * quantity;
    const deliveryFee = faker.helpers.arrayElement([1500, 2000, 2500]);

    const campaign = faker.helpers.arrayElement(campaigns);
    const mediaBuyerId = campaign.media_buyer_id as string;
    const campaignId = campaign.id as string;
    const csAgent = faker.helpers.arrayElement(csAgents);
    const csAgentId = csAgent.id as string;
    const tplLocation = faker.helpers.arrayElement(tplLocations);
    const locationId = tplLocation.id as string;
    const providerId = tplLocation.provider_id as string;
    const locationRiders = ridersByLocation[locationId] ?? riders.map((r: Record<string, unknown>) => r.id as string);
    const riderId = faker.helpers.arrayElement(locationRiders);
    const tplManagerId = tplManagerByLocation[locationId] ?? tplManagers[0]?.id as string;

    const createdAt = new Date(Date.now() - faker.number.int({ min: 2, max: 20 }) * 24 * 60 * 60 * 1000);
    const deliveredAt = new Date(createdAt.getTime() + faker.number.int({ min: 8, max: 30 }) * 60 * 60 * 1000);
    const prefDeliveryDate = new Date(createdAt.getTime() + faker.number.int({ min: 1, max: 4 }) * 24 * 60 * 60 * 1000);
    const customerName = faker.person.fullName();
    const customerPhone = '0' + faker.helpers.arrayElement(['7', '8', '9']) + faker.string.numeric(9);
    const phoneHash = 'hash_boost_disputed_' + faker.string.alphanumeric(10);
    const deliveryOtp = faker.string.numeric(4);
    const items = JSON.stringify([{ productId, quantity, unitPrice }]);
    const address = `${faker.number.int({ min: 1, max: 180 })} ${faker.location.street()}, Lagos`;

    await sql`
      INSERT INTO orders (
        id, branch_id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id, logistics_location_id,
        rider_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_address,
        total_amount, landed_cost, delivery_fee, delivery_otp, items, created_at, delivered_at, preferred_delivery_date
      ) VALUES (
        ${orderId}, ${defaultBranchId}, ${campaignId}, ${mediaBuyerId}, ${csAgentId},
        ${providerId}, ${locationId}, ${riderId}, 'DELIVERED',
        ${customerName}, ${phoneHash}, ${customerPhone}, ${address}, ${address},
        ${String(totalAmount)}, ${String(totalLandedCost)}, ${String(deliveryFee)},
        ${deliveryOtp}, ${items}::jsonb, ${createdAt}, ${deliveredAt}, ${prefDeliveryDate}
      )
    `;

    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
      VALUES (gen_random_uuid(), ${orderId}, ${productId}, ${quantity}, ${String(unitPrice)}, ${pricing.batchId || null})
    `;

    const disputedRemittanceId = randomUUID();
    const disputeReason = `${disputeReasonPrefix} #${existingDisputedSeedRows.length + i + 1}`;
    await sql`
      INSERT INTO delivery_remittances (
        id, logistics_location_id, sent_by, receipt_urls, status, sent_at, received_at, received_by, dispute_reason
      ) VALUES (
        ${disputedRemittanceId}, ${locationId}, ${tplManagerId},
        ${JSON.stringify(['https://storage.example.com/receipts/boost-disputed-remit.jpg'])}::jsonb,
        'DISPUTED', ${deliveredAt}, ${new Date(deliveredAt.getTime() + 2 * 60 * 60 * 1000)},
        ${financeOfficer?.id ?? superAdmin.id}, ${disputeReason}
      )
    `;

    await sql`
      INSERT INTO delivery_remittance_orders (id, delivery_remittance_id, order_id)
      VALUES (gen_random_uuid(), ${disputedRemittanceId}, ${orderId})
    `;
  }

  // ── Invoices (PAID) ─────────────────────────────────────────────
  console.log('  Creating invoices...');
  // Create invoices for ~80% of delivered orders
  const invoiceCount = Math.floor(deliveredOrderInfos.length * 0.8);
  for (let i = 0; i < invoiceCount; i++) {
    const info = deliveredOrderInfos[i]!;
    const taxRate = 0.075;
    const totalWithTax = Math.round(info.totalAmount * (1 + taxRate) * 100) / 100;

    await sql`
      INSERT INTO invoices (id, order_id, recipient_info, line_items, tax_rate, total_amount, status, due_date)
      VALUES (
        gen_random_uuid(), ${info.orderId},
        ${JSON.stringify({ name: faker.person.fullName(), email: faker.internet.email(), address: faker.location.streetAddress() + ', Lagos' })}::jsonb,
        ${JSON.stringify([{ description: 'Product delivery', quantity: 1, unitPrice: info.totalAmount, amount: info.totalAmount }])}::jsonb,
        '0.075', ${String(totalWithTax)}, 'PAID',
        NOW() + INTERVAL '30 days'
      )
    `;
  }

  // ── Low ad spend (profitable — spend ~15-25% of revenue) ───────
  console.log('  Creating lean ad spend entries...');
  const targetAdSpend = totalRevenue * 0.12; // 12% of revenue = profitable ROAS
  const adSpendPerEntry = targetAdSpend / 30; // spread over 30 days
  const uniqueCampaigns = campaigns.slice(0, 10).map((c: Record<string, unknown>) => {
    // product_ids is JSONB — postgres.js auto-parses it into an array
    const pids = Array.isArray(c.product_ids) ? c.product_ids : [];
    return {
      id: c.id as string,
      mediaBuyerId: c.media_buyer_id as string,
      productId: (pids[0] as string) ?? products[0]!.id as string,
    };
  });

  let adSpendInserted = 0;
  for (let day = 0; day < 30; day++) {
    const spendDate = new Date();
    spendDate.setDate(spendDate.getDate() - day);

    // 2-3 entries per day across different campaigns
    const entriesPerDay = faker.number.int({ min: 2, max: 3 });
    for (let e = 0; e < entriesPerDay; e++) {
      const camp = uniqueCampaigns[(day * entriesPerDay + e) % uniqueCampaigns.length]!;
      const spendAmount = Math.round(adSpendPerEntry / entriesPerDay * (0.8 + Math.random() * 0.4));

      await sql`
        INSERT INTO ad_spend_logs (id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date, status, approved_at, approved_by)
        VALUES (
          gen_random_uuid(), ${camp.mediaBuyerId}, ${camp.productId}, ${camp.id},
          ${String(spendAmount)},
          'https://storage.example.com/screenshots/boost-ad.jpg',
          ${spendDate}, 'APPROVED', ${spendDate}, ${(users.find((u: Record<string, unknown>) => u.role === 'HEAD_OF_MARKETING') ?? superAdmin).id as string}
        )
      `;
      adSpendInserted++;
    }
  }

  // ── Extra payout records for delivered orders ───────────────────
  console.log('  Creating performance-based payout records...');
  // Create bonus payouts for top-performing agents
  const topCsAgents = csAgents.slice(0, 5);
  for (const agent of topCsAgents) {
    await sql`
      INSERT INTO payout_records (id, staff_id, period_start, period_end, base_salary, performance_bonus, add_ons_total, deductions_total, total_payout, status)
      VALUES (
        gen_random_uuid(), ${agent.id as string},
        NOW() - INTERVAL '30 days', NOW(),
        '50000.00', '25000.00', '5000.00', '0.00', '80000.00', 'PAID'
      )
    `;
  }

  // Media buyer bonuses
  const topMbs = mediaBuyers.slice(0, 5);
  for (const mb of topMbs) {
    await sql`
      INSERT INTO payout_records (id, staff_id, period_start, period_end, base_salary, performance_bonus, add_ons_total, deductions_total, total_payout, status)
      VALUES (
        gen_random_uuid(), ${mb.id as string},
        NOW() - INTERVAL '30 days', NOW(),
        '40000.00', '30000.00', '10000.00', '0.00', '80000.00', 'PAID'
      )
    `;
  }

  // Rider bonuses
  for (const rider of riders) {
    await sql`
      INSERT INTO payout_records (id, staff_id, period_start, period_end, base_salary, performance_bonus, add_ons_total, deductions_total, total_payout, status)
      VALUES (
        gen_random_uuid(), ${rider.id as string},
        NOW() - INTERVAL '30 days', NOW(),
        '30000.00', '20000.00', '5000.00', '0.00', '55000.00', 'PAID'
      )
    `;
  }

  // ── Positive earnings adjustments ──────────────────────────────
  console.log('  Creating positive earnings adjustments...');
  for (let i = 0; i < Math.min(8, csAgents.length); i++) {
    await sql`
      INSERT INTO earnings_adjustments (id, staff_id, amount, category, reason, approved_by)
      VALUES (gen_random_uuid(), ${csAgents[i]!.id as string}, '3000.00', 'BONUS', 'Performance bonus — high delivery rate', ${hrManager?.id ?? superAdmin.id})
    `;
  }
  for (let i = 0; i < Math.min(5, mediaBuyers.length); i++) {
    await sql`
      INSERT INTO earnings_adjustments (id, staff_id, amount, category, reason, approved_by)
      VALUES (gen_random_uuid(), ${mediaBuyers[i]!.id as string}, '8000.00', 'PERFORMANCE', 'ROAS exceeded 5x target', ${hrManager?.id ?? superAdmin.id})
    `;
  }

  // ── Summary ────────────────────────────────────────────────────
  const totalAdSpend = Math.round(targetAdSpend);
  const commissions = Math.round(deliveredOrderInfos.length * 500 + deliveredOrderInfos.length * 300 + deliveredOrderInfos.length * 800);
  const trueProfit = totalRevenue - totalLandedCostSum - totalAdSpend - totalDeliveryFees - commissions;

  console.log('\n========================================');
  console.log('  Revenue Boost Seed Complete!');
  console.log('========================================');
  console.log(`\n  Orders Created:      ${BOOST_COUNT}`);
  console.log(`  Delivered/Completed: ${deliveredOrderInfos.length}`);
  console.log(`  Invoices:            ${invoiceCount}`);
  console.log(`  Ad Spend Entries:    ${adSpendInserted}`);
  console.log(`\n  Financial Summary (estimated):`);
  console.log(`  Revenue:             ₦${totalRevenue.toLocaleString()}`);
  console.log(`  Landed COGS:        -₦${totalLandedCostSum.toLocaleString()}`);
  console.log(`  Ad Spend:           -₦${totalAdSpend.toLocaleString()}`);
  console.log(`  Delivery Fees:      -₦${totalDeliveryFees.toLocaleString()}`);
  console.log(`  Commissions (est):  -₦${commissions.toLocaleString()}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  True Profit (est):   ₦${trueProfit.toLocaleString()}`);
  console.log(`  Margin:              ${((trueProfit / totalRevenue) * 100).toFixed(1)}%`);
  console.log(`  ROAS:                ${(totalRevenue / totalAdSpend).toFixed(1)}x`);
  console.log('');

  await sql.end();
}

boostSeed().catch((err) => {
  console.error('Boost seed failed:', err);
  process.exit(1);
});
