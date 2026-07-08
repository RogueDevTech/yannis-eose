/**
 * Seed 13 users (all major roles), 1 branch, 3 products, 1 campaign,
 * and ~30 orders spread across the pipeline statuses.
 *
 * Usage:
 *   npx tsx packages/shared/src/db/seed-users-orders.ts
 *
 * Safe to re-run — uses ON CONFLICT DO NOTHING on unique constraints.
 * All users share password: Yannis2026!
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { uuidv7 } from 'uuidv7';

config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../../apps/api/.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';
const PASSWORD = 'Yannis2026!';
const SALT_ROUNDS = 12;

function hashPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = '234' + digits.slice(1);
  }
  return createHash('sha256').update(`yannis:phone:${digits}`).digest('hex');
}

interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  phone?: string;
}

const USERS: SeedUser[] = [
  { id: uuidv7(), name: 'Kabir Mohammed', email: 'superadmin@yannis.dev', role: 'SUPER_ADMIN' },
  { id: uuidv7(), name: 'Admin User', email: 'admin@yannis.dev', role: 'ADMIN' },
  { id: uuidv7(), name: 'Branch Admin Lagos', email: 'branchadmin@yannis.dev', role: 'BRANCH_ADMIN' },
  { id: uuidv7(), name: 'Tunde Balogun', email: 'hom@yannis.dev', role: 'HEAD_OF_MARKETING', phone: '08031000001' },
  { id: uuidv7(), name: 'Paul Oluwatobi', email: 'mb@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000002' },
  { id: uuidv7(), name: 'Mary Okunlola', email: 'hocs@yannis.dev', role: 'HEAD_OF_CS', phone: '08031000003' },
  { id: uuidv7(), name: 'Alexandra Ajayi', email: 'closer@yannis.dev', role: 'CS_CLOSER', phone: '08031000004' },
  { id: uuidv7(), name: 'Finance Officer', email: 'finance@yannis.dev', role: 'FINANCE_OFFICER' },
  { id: uuidv7(), name: 'Head of Logistics', email: 'hol@yannis.dev', role: 'HEAD_OF_LOGISTICS' },
  { id: uuidv7(), name: 'Stock Manager', email: 'stockmgr@yannis.dev', role: 'STOCK_MANAGER' },
  { id: uuidv7(), name: 'TPL Manager Bukted', email: 'tplmgr@yannis.dev', role: 'TPL_MANAGER' },
  { id: uuidv7(), name: 'HR Manager', email: 'hr@yannis.dev', role: 'HR_MANAGER' },
  { id: uuidv7(), name: 'Support Agent', email: 'support@yannis.dev', role: 'SUPPORT' },
  // ── 40 additional users across all roles (except TPL) ──
  // SUPER_ADMIN (2 more)
  { id: uuidv7(), name: 'Daniel Ojo', email: 'superadmin2@yannis.dev', role: 'SUPER_ADMIN' },
  { id: uuidv7(), name: 'Chidinma Eze', email: 'superadmin3@yannis.dev', role: 'SUPER_ADMIN' },
  // ADMIN (2 more)
  { id: uuidv7(), name: 'Femi Adebayo', email: 'admin2@yannis.dev', role: 'ADMIN' },
  { id: uuidv7(), name: 'Bisi Akintunde', email: 'admin3@yannis.dev', role: 'ADMIN' },
  // BRANCH_ADMIN (2 more)
  { id: uuidv7(), name: 'Nnamdi Okeke', email: 'branchadmin2@yannis.dev', role: 'BRANCH_ADMIN' },
  { id: uuidv7(), name: 'Aisha Usman', email: 'branchadmin3@yannis.dev', role: 'BRANCH_ADMIN' },
  // HEAD_OF_MARKETING (2 more)
  { id: uuidv7(), name: 'Chioma Nwankwo', email: 'hom2@yannis.dev', role: 'HEAD_OF_MARKETING', phone: '08031000010' },
  { id: uuidv7(), name: 'Emeka Obi', email: 'hom3@yannis.dev', role: 'HEAD_OF_MARKETING', phone: '08031000011' },
  // MEDIA_BUYER (6 more — largest team)
  { id: uuidv7(), name: 'Kemi Adekunle', email: 'mb2@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000012' },
  { id: uuidv7(), name: 'Uche Onyekachi', email: 'mb3@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000013' },
  { id: uuidv7(), name: 'Segun Bello', email: 'mb4@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000014' },
  { id: uuidv7(), name: 'Funmi Oladele', email: 'mb5@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000015' },
  { id: uuidv7(), name: 'Hassan Ibrahim', email: 'mb6@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000016' },
  { id: uuidv7(), name: 'Ngozi Amadi', email: 'mb7@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000017' },
  // HEAD_OF_CS (2 more)
  { id: uuidv7(), name: 'Adeola Martins', email: 'hocs2@yannis.dev', role: 'HEAD_OF_CS', phone: '08031000018' },
  { id: uuidv7(), name: 'Samuel Okoro', email: 'hocs3@yannis.dev', role: 'HEAD_OF_CS', phone: '08031000019' },
  // CS_CLOSER (8 more — largest team)
  { id: uuidv7(), name: 'Ebenezzar Chukwuma', email: 'closer2@yannis.dev', role: 'CS_CLOSER', phone: '08031000020' },
  { id: uuidv7(), name: 'Blessing Igwe', email: 'closer3@yannis.dev', role: 'CS_CLOSER', phone: '08031000021' },
  { id: uuidv7(), name: 'Tunde Fashanu', email: 'closer4@yannis.dev', role: 'CS_CLOSER', phone: '08031000022' },
  { id: uuidv7(), name: 'Mercy Okafor', email: 'closer5@yannis.dev', role: 'CS_CLOSER', phone: '08031000023' },
  { id: uuidv7(), name: 'Ibrahim Danjuma', email: 'closer6@yannis.dev', role: 'CS_CLOSER', phone: '08031000024' },
  { id: uuidv7(), name: 'Yetunde Alao', email: 'closer7@yannis.dev', role: 'CS_CLOSER', phone: '08031000025' },
  { id: uuidv7(), name: 'Chinedu Eze', email: 'closer8@yannis.dev', role: 'CS_CLOSER', phone: '08031000026' },
  { id: uuidv7(), name: 'Abiodun Salami', email: 'closer9@yannis.dev', role: 'CS_CLOSER', phone: '08031000027' },
  // FINANCE_OFFICER (2 more)
  { id: uuidv7(), name: 'Oluwaseun Ajayi', email: 'finance2@yannis.dev', role: 'FINANCE_OFFICER' },
  { id: uuidv7(), name: 'Halima Garba', email: 'finance3@yannis.dev', role: 'FINANCE_OFFICER' },
  // HEAD_OF_LOGISTICS (2 more)
  { id: uuidv7(), name: 'Obinna Nwachukwu', email: 'hol2@yannis.dev', role: 'HEAD_OF_LOGISTICS' },
  { id: uuidv7(), name: 'Maryam Abubakar', email: 'hol3@yannis.dev', role: 'HEAD_OF_LOGISTICS' },
  // STOCK_MANAGER (2 more)
  { id: uuidv7(), name: 'Taiwo Ogunbiyi', email: 'stockmgr2@yannis.dev', role: 'STOCK_MANAGER' },
  { id: uuidv7(), name: 'Amaka Nnaji', email: 'stockmgr3@yannis.dev', role: 'STOCK_MANAGER' },
  // HR_MANAGER (2 more)
  { id: uuidv7(), name: 'Folake Adeleke', email: 'hr2@yannis.dev', role: 'HR_MANAGER' },
  { id: uuidv7(), name: 'Joseph Adebanjo', email: 'hr3@yannis.dev', role: 'HR_MANAGER' },
  // SUPPORT (2 more)
  { id: uuidv7(), name: 'Zainab Oladipo', email: 'support2@yannis.dev', role: 'SUPPORT' },
  { id: uuidv7(), name: 'Victor Udoh', email: 'support3@yannis.dev', role: 'SUPPORT' },
  // ── Extra MEDIA_BUYER (8 more → 15 total) ──
  { id: uuidv7(), name: 'Adaeze Okwu', email: 'mb8@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000030' },
  { id: uuidv7(), name: 'Tosin Bakare', email: 'mb9@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000031' },
  { id: uuidv7(), name: 'Musa Abdulrahman', email: 'mb10@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000032' },
  { id: uuidv7(), name: 'Chiamaka Ogu', email: 'mb11@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000033' },
  { id: uuidv7(), name: 'Olayinka Fadeyi', email: 'mb12@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000034' },
  { id: uuidv7(), name: 'Yakubu Bala', email: 'mb13@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000035' },
  { id: uuidv7(), name: 'Nneka Chiedozie', email: 'mb14@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000036' },
  { id: uuidv7(), name: 'Gbenga Soyinka', email: 'mb15@yannis.dev', role: 'MEDIA_BUYER', phone: '08031000037' },
  // ── Extra CS_CLOSER (7 more → 16 total) ──
  { id: uuidv7(), name: 'Oluchi Nweke', email: 'closer10@yannis.dev', role: 'CS_CLOSER', phone: '08031000040' },
  { id: uuidv7(), name: 'Dare Adewumi', email: 'closer11@yannis.dev', role: 'CS_CLOSER', phone: '08031000041' },
  { id: uuidv7(), name: 'Patience Ogbonna', email: 'closer12@yannis.dev', role: 'CS_CLOSER', phone: '08031000042' },
  { id: uuidv7(), name: 'Mustapha Yusuf', email: 'closer13@yannis.dev', role: 'CS_CLOSER', phone: '08031000043' },
  { id: uuidv7(), name: 'Temitope Akin', email: 'closer14@yannis.dev', role: 'CS_CLOSER', phone: '08031000044' },
  { id: uuidv7(), name: 'Ifeoma Ugochukwu', email: 'closer15@yannis.dev', role: 'CS_CLOSER', phone: '08031000045' },
  { id: uuidv7(), name: 'Rilwan Abdullahi', email: 'closer16@yannis.dev', role: 'CS_CLOSER', phone: '08031000046' },
];

const byRole = (role: string) => USERS.find((u) => u.role === role)!;

const PRODUCTS = [
  { id: uuidv7(), name: 'LIV T-550', baseSalePrice: '59500.00', costPrice: '28000.00', category: 'Supplements' },
  { id: uuidv7(), name: 'GLUCO-BALANCE 850', baseSalePrice: '42000.00', costPrice: '18500.00', category: 'Supplements' },
  { id: uuidv7(), name: 'VITA-C EFFERVESCENT', baseSalePrice: '25000.00', costPrice: '11000.00', category: 'Vitamins' },
];

const CAMPAIGN_ID = uuidv7();

// Nigerian names for realistic orders
const CUSTOMERS = [
  { name: 'Adewale Johnson', phone: '08012345601', state: 'Lagos', address: '12 Allen Avenue, Ikeja' },
  { name: 'Chioma Okafor', phone: '08012345602', state: 'Lagos', address: '5 Admiralty Way, Lekki' },
  { name: 'Olumide Balogun', phone: '08012345603', state: 'Ogun', address: '23 Abeokuta Road, Sagamu' },
  { name: 'Amina Yusuf', phone: '08012345604', state: 'Abuja', address: 'Plot 45 Wuse 2, Abuja' },
  { name: 'Emeka Nwosu', phone: '08012345605', state: 'Lagos', address: '8 Gbagada Express, Gbagada' },
  { name: 'Funke Adeyemi', phone: '08012345606', state: 'Lagos', address: '15 Bode Thomas, Surulere' },
  { name: 'Ibrahim Musa', phone: '08012345607', state: 'Kano', address: '3 Bayero Road, Kano' },
  { name: 'Grace Eze', phone: '08012345608', state: 'Rivers', address: '10 Aba Road, Port Harcourt' },
  { name: 'Tunde Adeola', phone: '08012345609', state: 'Lagos', address: '28 Ikotun Road, Alimosho' },
  { name: 'Ngozi Chukwu', phone: '08012345610', state: 'Enugu', address: '7 Ogui Road, Enugu' },
  { name: 'Yemi Alabi', phone: '08012345611', state: 'Lagos', address: '33 Apapa Road, Costain' },
  { name: 'Halima Abdullahi', phone: '08012345612', state: 'Kaduna', address: '12 Ahmadu Bello Way, Kaduna' },
  { name: 'Chidi Obi', phone: '08012345613', state: 'Delta', address: '5 Warri-Sapele Road, Warri' },
  { name: 'Bukola Fashola', phone: '08012345614', state: 'Lagos', address: '22 Herbert Macaulay, Yaba' },
  { name: 'Aisha Bello', phone: '08012345615', state: 'Abuja', address: '8 Garki Area 11, Abuja' },
  { name: 'Segun Oladipo', phone: '08012345616', state: 'Oyo', address: '45 Ring Road, Ibadan' },
  { name: 'Nkechi Ugwu', phone: '08012345617', state: 'Anambra', address: '3 Onitsha Main Market, Onitsha' },
  { name: 'Musa Garba', phone: '08012345618', state: 'Lagos', address: '17 Marina Street, Lagos Island' },
  { name: 'Adeola Williams', phone: '08012345619', state: 'Lagos', address: '9 Oshodi-Apapa Express, Isolo' },
  { name: 'Khadija Suleiman', phone: '08012345620', state: 'Abuja', address: '14 Maitama District, Abuja' },
  { name: 'Obinna Agu', phone: '08012345621', state: 'Lagos', address: '6 Ajah-Lekki Express, Ajah' },
  { name: 'Tolulope Bakare', phone: '08012345622', state: 'Lagos', address: '31 Awolowo Road, Ikoyi' },
  { name: 'Rasheed Lawal', phone: '08012345623', state: 'Ogun', address: '11 Sagamu-Ore Express, Ijebu Ode' },
  { name: 'Blessing Okoro', phone: '08012345624', state: 'Lagos', address: '2 Festac Link Road, Festac' },
  { name: 'Danjuma Ahmed', phone: '08012345625', state: 'Lagos', address: '19 Third Mainland Bridge Rd, Oworonsoki' },
  { name: 'Shade Akinola', phone: '08012345626', state: 'Lagos', address: '14 Agege Motor Road, Oshodi' },
  { name: 'Victor Edet', phone: '08012345627', state: 'Cross River', address: '7 Marian Road, Calabar' },
  { name: 'Fatima Baba', phone: '08012345628', state: 'Lagos', address: '25 Adeola Odeku, VI' },
  { name: 'Ifeanyi Okonkwo', phone: '08012345629', state: 'Lagos', address: '4 Ikorodu Road, Maryland' },
  { name: 'Zainab Idris', phone: '08012345630', state: 'Lagos', address: '16 Ojuelegba Road, Surulere' },
];

// Status distribution for the 30 orders
const ORDER_STATUSES = [
  'UNPROCESSED', 'UNPROCESSED', 'UNPROCESSED',       // 3
  'CS_ASSIGNED', 'CS_ASSIGNED', 'CS_ASSIGNED',        // 3
  'CS_ENGAGED', 'CS_ENGAGED', 'CS_ENGAGED', 'CS_ENGAGED', // 4
  'CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED', // 5
  'AGENT_ASSIGNED', 'AGENT_ASSIGNED',                  // 2
  'DISPATCHED', 'DISPATCHED',                          // 2
  'IN_TRANSIT', 'IN_TRANSIT',                          // 2
  'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED', // 5
  'REMITTED', 'REMITTED',                              // 2
  'RETURNED',                                          // 1
  'DELETED',                                           // 1
];

async function main() {
  console.log('Seeding 13 users, 3 products, 1 campaign, 30 orders...');

  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  // 1. Ensure branch exists
  await sql`
    INSERT INTO branches (id, name, code, status)
    VALUES (${BRANCH_ID}, 'Lagos HQ', 'LGS', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING
  `;
  console.log('  Branch: Lagos HQ');

  // 2. Seed users (check-before-insert — no unique constraints guaranteed)
  for (const u of USERS) {
    const existing = await sql`SELECT id FROM users WHERE email = ${u.email} LIMIT 1`;
    if (existing.length > 0) {
      u.id = existing[0]!.id;
      await sql`
        UPDATE users SET name = ${u.name}, role = ${u.role}, password_hash = ${passwordHash}, status = 'ACTIVE'
        WHERE id = ${u.id}
      `;
    } else {
      await sql`
        INSERT INTO users (id, name, email, password_hash, role, status, primary_branch_id, capacity)
        VALUES (
          ${u.id}, ${u.name}, ${u.email}, ${passwordHash}, ${u.role},
          'ACTIVE',
          ${u.role === 'SUPER_ADMIN' ? null : BRANCH_ID},
          ${u.role === 'CS_CLOSER' ? 15 : 10}
        )
      `;
    }
    // Branch membership for non-SuperAdmin
    if (u.role !== 'SUPER_ADMIN') {
      const hasBranch = await sql`SELECT 1 FROM user_branches WHERE user_id = ${u.id} AND branch_id = ${BRANCH_ID} LIMIT 1`;
      if (hasBranch.length === 0) {
        await sql`
          INSERT INTO user_branches (user_id, branch_id, is_primary)
          VALUES (${u.id}, ${BRANCH_ID}, true)
        `;
      }
    }
  }
  console.log(`  Users: ${USERS.length} seeded (password: ${PASSWORD})`);

  // 3. Seed products (check by name)
  for (const p of PRODUCTS) {
    const existing = await sql`SELECT id FROM products WHERE name = ${p.name} LIMIT 1`;
    if (existing.length > 0) {
      p.id = existing[0]!.id;
    } else {
      await sql`
        INSERT INTO products (id, name, base_sale_price, cost_price, category, status)
        VALUES (${p.id}, ${p.name}, ${p.baseSalePrice}::numeric, ${p.costPrice}::numeric, ${p.category}, 'ACTIVE')
      `;
    }
  }
  console.log(`  Products: ${PRODUCTS.length} seeded`);

  // 4. Seed campaign
  const mb = byRole('MEDIA_BUYER');
  const existingCampaign = await sql`SELECT id FROM campaigns WHERE name = 'Lagos Health Campaign' LIMIT 1`;
  const campaignId = existingCampaign.length > 0 ? existingCampaign[0]!.id : CAMPAIGN_ID;
  if (existingCampaign.length === 0) {
    await sql`
      INSERT INTO campaigns (id, media_buyer_id, name, product_ids, status, branch_id, deployment_type)
      VALUES (
        ${campaignId}, ${mb.id}, 'Lagos Health Campaign',
        ${JSON.stringify(PRODUCTS.map((p) => p.id))}::jsonb,
        'ACTIVE', ${BRANCH_ID}, 'HOSTED'
      )
    `;
  }
  console.log('  Campaign: Lagos Health Campaign');

  // 5. Seed orders
  const closer = byRole('CS_CLOSER');
  const now = new Date();
  let created = 0;

  for (let i = 0; i < ORDER_STATUSES.length; i++) {
    const status = ORDER_STATUSES[i]!;
    const customer = CUSTOMERS[i]!;
    const product = PRODUCTS[i % PRODUCTS.length]!;
    const orderId = uuidv7();
    const phoneHash = hashPhone(customer.phone);

    // Spread creation times over the last 7 days
    const createdAt = new Date(now.getTime() - (ORDER_STATUSES.length - i) * 4 * 60 * 60 * 1000);
    const isAssigned = !['UNPROCESSED'].includes(status);
    const isConfirmed = ['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED', 'RETURNED'].includes(status);
    const isDelivered = ['DELIVERED', 'REMITTED'].includes(status);
    const isDeleted = status === 'DELETED';

    const assignedCsId = isAssigned ? closer.id : null;
    const confirmedAt = isConfirmed ? new Date(createdAt.getTime() + 2 * 60 * 60 * 1000) : null;
    const deliveredAt = isDelivered ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000) : null;
    const deletedAt = isDeleted ? new Date(createdAt.getTime() + 1 * 60 * 60 * 1000) : null;

    await sql`
      INSERT INTO orders (
        id, campaign_id, media_buyer_id, assigned_cs_id,
        status, customer_name, customer_phone_hash, customer_phone,
        customer_address, delivery_address, delivery_state,
        total_amount, landed_cost, delivery_fee,
        payment_method, order_source,
        branch_id, servicing_branch_id,
        created_at, confirmed_at, delivered_at, deleted_at, updated_at
      ) VALUES (
        ${orderId}, ${campaignId}, ${mb.id}, ${assignedCsId},
        ${status}, ${customer.name}, ${phoneHash}, ${customer.phone},
        ${customer.address}, ${customer.address}, ${customer.state},
        ${product.baseSalePrice}::numeric, ${product.costPrice}::numeric, ${'1500.00'}::numeric,
        'PAY_ON_DELIVERY', 'edge-form',
        ${BRANCH_ID}, ${BRANCH_ID},
        ${createdAt}, ${confirmedAt}, ${deliveredAt}, ${deletedAt}, ${createdAt}
      )
          `;

    // Order item
    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, offer_label)
      VALUES (${uuidv7()}, ${orderId}, ${product.id}, 1, ${product.baseSalePrice}::numeric, 'BUY 1 + FREE DELIVERY')
    `;

    // Timeline event: order received
    await sql`
      INSERT INTO order_timeline_events (id, order_id, event_type, actor_name, description, branch_id, created_at)
      VALUES (
        ${uuidv7()}, ${orderId}, 'ORDER_RECEIVED', 'Edge form',
        ${'Arrived from sales form — attributed to media buyer ' + mb.name},
        ${BRANCH_ID}, ${createdAt}
      )
    `;

    created++;
  }

  console.log(`  Orders: ${created} seeded across ${new Set(ORDER_STATUSES).size} statuses`);

  // ── 6. Seed branch departments, teams, supervisors, and team member orders ──

  // 6a. Ensure branch_departments rows exist for CS and MARKETING
  const csDeptId = uuidv7();
  const mktDeptId = uuidv7();
  for (const [deptId, dept] of [[csDeptId, 'CS'], [mktDeptId, 'MARKETING']] as const) {
    const existing = await sql`
      SELECT id FROM branch_departments WHERE branch_id = ${BRANCH_ID} AND department = ${dept} LIMIT 1
    `;
    if (existing.length === 0) {
      await sql`
        INSERT INTO branch_departments (id, branch_id, department)
        VALUES (${deptId}, ${BRANCH_ID}, ${dept})
      `;
    }
  }
  // Re-fetch actual IDs (in case they existed)
  const [csDept] = await sql`SELECT id FROM branch_departments WHERE branch_id = ${BRANCH_ID} AND department = 'CS' LIMIT 1`;
  const [mktDept] = await sql`SELECT id FROM branch_departments WHERE branch_id = ${BRANCH_ID} AND department = 'MARKETING' LIMIT 1`;

  // 6b. Create teams
  // CS Team Alpha (supervisor: closer2 — Ebenezzar) + CS Team Beta (supervisor: closer5 — Mercy)
  const csTeams = [
    { name: 'CS Team Alpha', supervisorEmail: 'closer2@yannis.dev', memberEmails: ['closer@yannis.dev', 'closer3@yannis.dev', 'closer4@yannis.dev', 'closer10@yannis.dev', 'closer11@yannis.dev', 'closer12@yannis.dev', 'closer13@yannis.dev'] },
    { name: 'CS Team Beta', supervisorEmail: 'closer5@yannis.dev', memberEmails: ['closer6@yannis.dev', 'closer7@yannis.dev', 'closer8@yannis.dev', 'closer9@yannis.dev', 'closer14@yannis.dev', 'closer15@yannis.dev', 'closer16@yannis.dev'] },
  ];

  // Marketing Team Alpha (supervisor: mb2 — Kemi) + Marketing Team Beta (supervisor: mb5 — Funmi)
  const mktTeams = [
    { name: 'Marketing Team Alpha', supervisorEmail: 'mb2@yannis.dev', memberEmails: ['mb@yannis.dev', 'mb3@yannis.dev', 'mb4@yannis.dev', 'mb8@yannis.dev', 'mb9@yannis.dev', 'mb10@yannis.dev'] },
    { name: 'Marketing Team Beta', supervisorEmail: 'mb5@yannis.dev', memberEmails: ['mb6@yannis.dev', 'mb7@yannis.dev', 'mb11@yannis.dev', 'mb12@yannis.dev', 'mb13@yannis.dev', 'mb14@yannis.dev', 'mb15@yannis.dev'] },
  ];

  const findUser = (email: string) => USERS.find((u) => u.email === email)!;

  async function seedTeam(
    teamName: string,
    department: 'CS' | 'MARKETING',
    deptRowId: string,
    supervisorEmail: string,
    memberEmails: string[],
  ) {
    // Check if team already exists
    let teamId: string;
    const existingTeam = await sql`
      SELECT id FROM branch_teams WHERE branch_id = ${BRANCH_ID} AND department = ${department} AND name = ${teamName} LIMIT 1
    `;
    if (existingTeam.length > 0) {
      teamId = existingTeam[0]!.id;
    } else {
      teamId = uuidv7();
      await sql`
        INSERT INTO branch_teams (id, branch_id, branch_department_id, department, name)
        VALUES (${teamId}, ${BRANCH_ID}, ${deptRowId}, ${department}, ${teamName})
      `;
    }

    // Add supervisor
    const supervisor = findUser(supervisorEmail);
    const existingSup = await sql`
      SELECT 1 FROM branch_team_members WHERE team_id = ${teamId} AND user_id = ${supervisor.id} LIMIT 1
    `;
    if (existingSup.length === 0) {
      await sql`
        INSERT INTO branch_team_members (team_id, user_id, is_supervisor) VALUES (${teamId}, ${supervisor.id}, true)
      `;
    } else {
      await sql`UPDATE branch_team_members SET is_supervisor = true WHERE team_id = ${teamId} AND user_id = ${supervisor.id}`;
    }
    // Sync is_team_supervisor flag on user
    await sql`UPDATE users SET is_team_supervisor = true WHERE id = ${supervisor.id}`;

    // Add members
    for (const email of memberEmails) {
      const member = findUser(email);
      const exists = await sql`
        SELECT 1 FROM branch_team_members WHERE team_id = ${teamId} AND user_id = ${member.id} LIMIT 1
      `;
      if (exists.length === 0) {
        await sql`
          INSERT INTO branch_team_members (team_id, user_id, is_supervisor) VALUES (${teamId}, ${member.id}, false)
        `;
      }
    }

    return { teamId, supervisor, memberIds: memberEmails.map((e) => findUser(e).id) };
  }

  const seededCsTeams = [];
  for (const t of csTeams) {
    const result = await seedTeam(t.name, 'CS', csDept!.id, t.supervisorEmail, t.memberEmails);
    seededCsTeams.push(result);
  }
  for (const t of mktTeams) {
    await seedTeam(t.name, 'MARKETING', mktDept!.id, t.supervisorEmail, t.memberEmails);
  }
  console.log('  Teams: 2 CS + 2 Marketing teams seeded with supervisors');

  // 6c. Seed orders for supervisors and their team members
  // Each supervisor gets 5 orders, each team member gets 3 orders
  const TEAM_ORDER_STATUSES = ['CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'DELIVERED', 'REMITTED'];
  const MEMBER_ORDER_STATUSES = ['CS_ENGAGED', 'CONFIRMED', 'DELIVERED'];
  let teamOrdersCreated = 0;

  // Extra customers for team orders
  const EXTRA_CUSTOMERS = [
    { name: 'Adaobi Nneka', phone: '08055500001', state: 'Lagos', address: '1 Victoria Island, Lagos' },
    { name: 'Babatunde Oye', phone: '08055500002', state: 'Lagos', address: '5 Lekki Phase 1, Lagos' },
    { name: 'Chinwe Ibeh', phone: '08055500003', state: 'Lagos', address: '12 Ilupeju Bypass, Lagos' },
    { name: 'Dauda Shehu', phone: '08055500004', state: 'Abuja', address: '7 Wuse Zone 5, Abuja' },
    { name: 'Evelyn Bassey', phone: '08055500005', state: 'Lagos', address: '22 Festac Town, Lagos' },
    { name: 'Faruk Bello', phone: '08055500006', state: 'Kano', address: '3 Nassarawa GRA, Kano' },
    { name: 'Gloria Odum', phone: '08055500007', state: 'Lagos', address: '8 Anthony Village, Lagos' },
    { name: 'Hamza Lawal', phone: '08055500008', state: 'Lagos', address: '15 Ojota, Lagos' },
    { name: 'Isioma Nwoye', phone: '08055500009', state: 'Rivers', address: '4 Trans Amadi, PH' },
    { name: 'Jide Okunade', phone: '08055500010', state: 'Lagos', address: '20 Magodo GRA, Lagos' },
    { name: 'Kelechi Eze', phone: '08055500011', state: 'Enugu', address: '6 New Haven, Enugu' },
    { name: 'Lateef Adewale', phone: '08055500012', state: 'Lagos', address: '11 Ogba, Lagos' },
    { name: 'Mariam Buba', phone: '08055500013', state: 'Lagos', address: '3 Berger, Lagos' },
    { name: 'Nonso Okeke', phone: '08055500014', state: 'Anambra', address: '9 Awka Road, Awka' },
    { name: 'Omolara Fash', phone: '08055500015', state: 'Lagos', address: '18 Aguda, Surulere' },
    { name: 'Peter Adamu', phone: '08055500016', state: 'Lagos', address: '7 Ogudu, Lagos' },
    { name: 'Queen Okafor', phone: '08055500017', state: 'Delta', address: '2 Asaba Road, Asaba' },
    { name: 'Rufai Garba', phone: '08055500018', state: 'Lagos', address: '14 Mushin, Lagos' },
    { name: 'Sade Bakare', phone: '08055500019', state: 'Lagos', address: '10 Ikeja GRA, Lagos' },
    { name: 'Tayo Ogunleye', phone: '08055500020', state: 'Ogun', address: '5 Abeokuta, Ogun' },
  ];
  let extraCustIdx = 0;
  const nextCustomer = () => EXTRA_CUSTOMERS[extraCustIdx++ % EXTRA_CUSTOMERS.length];

  async function seedOrderForUser(csId: string, mbId: string, status: string, offsetHours: number) {
    const customer = nextCustomer()!;
    const product = PRODUCTS[extraCustIdx % PRODUCTS.length]!;
    const orderId = uuidv7();
    const phoneHash = hashPhone(customer.phone);
    const createdAt = new Date(now.getTime() - offsetHours * 60 * 60 * 1000);
    const isConfirmed = ['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED'].includes(status);
    const isDelivered = ['DELIVERED', 'REMITTED'].includes(status);
    const confirmedAt = isConfirmed ? new Date(createdAt.getTime() + 2 * 60 * 60 * 1000) : null;
    const deliveredAt = isDelivered ? new Date(createdAt.getTime() + 24 * 60 * 60 * 1000) : null;

    await sql`
      INSERT INTO orders (
        id, campaign_id, media_buyer_id, assigned_cs_id,
        status, customer_name, customer_phone_hash, customer_phone,
        customer_address, delivery_address, delivery_state,
        total_amount, landed_cost, delivery_fee,
        payment_method, order_source,
        branch_id, servicing_branch_id,
        created_at, confirmed_at, delivered_at, updated_at
      ) VALUES (
        ${orderId}, ${campaignId}, ${mbId}, ${csId},
        ${status}, ${customer.name}, ${phoneHash}, ${customer.phone},
        ${customer.address}, ${customer.address}, ${customer.state},
        ${product.baseSalePrice}::numeric, ${product.costPrice}::numeric, ${'1500.00'}::numeric,
        'PAY_ON_DELIVERY', 'edge-form',
        ${BRANCH_ID}, ${BRANCH_ID},
        ${createdAt}, ${confirmedAt}, ${deliveredAt}, ${createdAt}
      )
    `;
    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, offer_label)
      VALUES (${uuidv7()}, ${orderId}, ${product.id}, 1, ${product.baseSalePrice}::numeric, 'BUY 1 + FREE DELIVERY')
    `;
    await sql`
      INSERT INTO order_timeline_events (id, order_id, event_type, actor_name, description, branch_id, created_at)
      VALUES (${uuidv7()}, ${orderId}, 'ORDER_RECEIVED', 'Edge form',
        ${'Arrived from sales form — attributed to media buyer ' + mb.name},
        ${BRANCH_ID}, ${createdAt})
    `;
    teamOrdersCreated++;
  }

  for (const csTeam of seededCsTeams) {
    // 5 orders for the supervisor
    for (let i = 0; i < TEAM_ORDER_STATUSES.length; i++) {
      await seedOrderForUser(csTeam.supervisor.id, mb.id, TEAM_ORDER_STATUSES[i]!, 10 + i * 6);
    }
    // 3 orders for each team member
    for (const memberId of csTeam.memberIds) {
      for (let i = 0; i < MEMBER_ORDER_STATUSES.length; i++) {
        await seedOrderForUser(memberId, mb.id, MEMBER_ORDER_STATUSES[i]!, 20 + i * 8);
      }
    }
  }

  console.log(`  Team orders: ${teamOrdersCreated} seeded (supervisors + members)`);

  console.log('\nDone! Login credentials:');
  console.log('  Password for all users: ' + PASSWORD);
  console.log('  Emails:');
  for (const u of USERS) {
    console.log(`    ${u.role.padEnd(20)} → ${u.email}`);
  }
  console.log('\n  Team Supervisors:');
  for (const t of csTeams) {
    const sup = findUser(t.supervisorEmail);
    console.log(`    ${t.name.padEnd(22)} → ${sup.name} (${sup.email})`);
  }
  for (const t of mktTeams) {
    const sup = findUser(t.supervisorEmail);
    console.log(`    ${t.name.padEnd(22)} → ${sup.name} (${sup.email})`);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
