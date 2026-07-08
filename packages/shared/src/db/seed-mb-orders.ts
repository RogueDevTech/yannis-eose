/**
 * Seed orders for every MEDIA_BUYER so the Team Analysis leaderboard
 * has real data. Each MB gets 8–15 orders spread across statuses.
 *
 * Usage:
 *   DATABASE_URL='...' npx tsx packages/shared/src/db/seed-mb-orders.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';
import { createHash } from 'crypto';
import { uuidv7 } from 'uuidv7';

config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../../apps/api/.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(DATABASE_URL, { max: 1 });

const BRANCH_ID = '00000000-0000-0000-0000-000000000001';

function hashPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = '234' + digits.slice(1);
  return createHash('sha256').update(`yannis:phone:${digits}`).digest('hex');
}

// Realistic Nigerian customers
const CUSTOMERS = [
  'Adaeze Umeh', 'Bamidele Ojo', 'Chidi Aneke', 'Damilola Ige', 'Emeka Okwu',
  'Folashade Bisi', 'Gbenga Awe', 'Hauwa Musa', 'Ikenna Obi', 'Jumoke Ade',
  'Kehinde Yusuf', 'Ladi Garba', 'Modupe Alao', 'Nneka Chime', 'Olayemi Bako',
  'Peter Edet', 'Queen Bassey', 'Rashida Bala', 'Sola Fasasi', 'Tayo Oguns',
  'Ugochi Eze', 'Victor Nweke', 'Wasiu Lamidi', 'Xena Okoye', 'Yetunde Ola',
  'Zainab Shehu', 'Amara Ogu', 'Binta Danjuma', 'Chibuzor Ike', 'Dele Badmus',
];

const STATES = ['Lagos', 'Abuja', 'Ogun', 'Rivers', 'Kano', 'Oyo', 'Delta', 'Enugu'];
const ADDRESSES = [
  '12 Allen Ave, Ikeja', '5 Admiralty Way, Lekki', '23 Abeokuta Rd', 'Plot 45 Wuse 2',
  '8 Gbagada Express', '15 Bode Thomas, Surulere', '3 Bayero Rd, Kano', '10 Aba Rd, PH',
  '28 Ikotun Rd', '7 Ogui Rd, Enugu', '33 Apapa Rd', '22 Herbert Macaulay, Yaba',
  '14 Agege Motor Rd', '25 Adeola Odeku, VI', '4 Ikorodu Rd, Maryland', '16 Ojuelegba Rd',
];

// Per-MB order distribution — varied so the leaderboard isn't uniform
const MB_ORDER_PATTERNS = [
  // [status, count] — each MB gets a random pattern
  [['UNPROCESSED', 2], ['CS_ASSIGNED', 1], ['CS_ENGAGED', 2], ['CONFIRMED', 3], ['DELIVERED', 4], ['REMITTED', 1], ['RETURNED', 1]],
  [['UNPROCESSED', 1], ['CS_ENGAGED', 3], ['CONFIRMED', 2], ['AGENT_ASSIGNED', 1], ['DISPATCHED', 1], ['DELIVERED', 3], ['REMITTED', 2]],
  [['CS_ASSIGNED', 2], ['CS_ENGAGED', 2], ['CONFIRMED', 4], ['DELIVERED', 2], ['REMITTED', 1], ['DELETED', 1]],
  [['UNPROCESSED', 3], ['CS_ENGAGED', 1], ['CONFIRMED', 2], ['IN_TRANSIT', 1], ['DELIVERED', 5], ['REMITTED', 2]],
  [['CS_ASSIGNED', 1], ['CS_ENGAGED', 3], ['CONFIRMED', 3], ['DISPATCHED', 2], ['DELIVERED', 3], ['RETURNED', 1]],
  [['UNPROCESSED', 1], ['CS_ASSIGNED', 2], ['CS_ENGAGED', 2], ['CONFIRMED', 1], ['DELIVERED', 6], ['REMITTED', 3]],
  [['CS_ENGAGED', 4], ['CONFIRMED', 2], ['AGENT_ASSIGNED', 1], ['DELIVERED', 2], ['REMITTED', 1]],
  [['UNPROCESSED', 2], ['CS_ENGAGED', 1], ['CONFIRMED', 5], ['DISPATCHED', 1], ['IN_TRANSIT', 1], ['DELIVERED', 4]],
];

async function main() {
  // Fetch all MBs, products, and a campaign
  const mbs = await sql`SELECT id, name FROM users WHERE role = 'MEDIA_BUYER' AND status = 'ACTIVE' ORDER BY name`;
  if (mbs.length === 0) { console.error('No media buyers found'); process.exit(1); }

  const products = await sql`SELECT id, name, base_sale_price, cost_price FROM products WHERE status = 'ACTIVE' ORDER BY name LIMIT 3`;
  if (products.length === 0) { console.error('No products found'); process.exit(1); }

  // Pick first closer for assigned orders
  const [closer] = await sql`SELECT id FROM users WHERE role = 'CS_CLOSER' AND status = 'ACTIVE' LIMIT 1`;
  const closerId = closer?.id ?? null;

  // Pick or create a campaign
  let campaignId: string;
  const [existingCampaign] = await sql`SELECT id FROM campaigns WHERE branch_id = ${BRANCH_ID} AND status = 'ACTIVE' LIMIT 1`;
  if (existingCampaign) {
    campaignId = existingCampaign.id;
  } else {
    campaignId = uuidv7();
    await sql`
      INSERT INTO campaigns (id, media_buyer_id, name, product_ids, status, branch_id, deployment_type)
      VALUES (${campaignId}, ${mbs[0]!.id}, 'Seed Campaign', ${JSON.stringify(products.map((p) => p.id as string))}::jsonb, 'ACTIVE', ${BRANCH_ID}, 'HOSTED')
    `;
  }

  const now = Date.now();
  let totalOrders = 0;
  let custIdx = 0;

  for (let mbIdx = 0; mbIdx < mbs.length; mbIdx++) {
    const mb = mbs[mbIdx]!;
    const pattern = MB_ORDER_PATTERNS[mbIdx % MB_ORDER_PATTERNS.length]!;
    let orderOffset = 0;

    for (const [status, count] of pattern) {
      for (let j = 0; j < (count as number); j++) {
        const customer = CUSTOMERS[custIdx % CUSTOMERS.length]!;
        const phone = `0801${String(7000 + custIdx).padStart(7, '0')}`;
        const state = STATES[custIdx % STATES.length]!;
        const address = ADDRESSES[custIdx % ADDRESSES.length]!;
        const product = products[custIdx % products.length]!;
        custIdx++;

        const orderId = uuidv7();
        const phoneHash = hashPhone(phone);
        const createdAt = new Date(now - (200 - totalOrders) * 3 * 60 * 60 * 1000); // spread over ~25 days
        const isAssigned = status !== 'UNPROCESSED';
        const isConfirmed = ['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED', 'RETURNED'].includes(status as string);
        const isDelivered = ['DELIVERED', 'REMITTED'].includes(status as string);
        const isDeleted = status === 'DELETED';

        const assignedCsId = isAssigned ? closerId : null;
        const confirmedAt = isConfirmed ? new Date(createdAt.getTime() + 3 * 60 * 60 * 1000) : null;
        const deliveredAt = isDelivered ? new Date(createdAt.getTime() + 30 * 60 * 60 * 1000) : null;
        const deletedAt = isDeleted ? new Date(createdAt.getTime() + 2 * 60 * 60 * 1000) : null;

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
            ${status as string}, ${customer}, ${phoneHash}, ${phone},
            ${address}, ${address}, ${state},
            ${product.base_sale_price}::numeric, ${product.cost_price}::numeric, ${'1500.00'}::numeric,
            'PAY_ON_DELIVERY', 'edge-form',
            ${BRANCH_ID}, ${BRANCH_ID},
            ${createdAt}, ${confirmedAt}, ${deliveredAt}, ${deletedAt}, ${createdAt}
          )
        `;

        await sql`
          INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, offer_label)
          VALUES (${uuidv7()}, ${orderId}, ${product.id}, 1, ${product.base_sale_price}::numeric, 'BUY 1 + FREE DELIVERY')
        `;

        await sql`
          INSERT INTO order_timeline_events (id, order_id, event_type, actor_name, description, branch_id, created_at)
          VALUES (${uuidv7()}, ${orderId}, 'ORDER_RECEIVED', 'Edge form',
            ${'Arrived from sales form — attributed to media buyer ' + mb.name},
            ${BRANCH_ID}, ${createdAt})
        `;

        totalOrders++;
        orderOffset++;
      }
    }
    console.log(`  ${mb.name.padEnd(22)} → ${orderOffset} orders`);
  }

  console.log(`\nDone! ${totalOrders} orders seeded across ${mbs.length} media buyers.`);
  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
