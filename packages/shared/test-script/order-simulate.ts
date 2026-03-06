/**
 * order-simulate — Creates random orders against the API.
 *
 * Pre-fetches campaigns + products from DB, then loops ORDER_COUNT times,
 * creating one order every INTERVAL_MS. Resilient: logs errors and continues.
 *
 * Usage:
 *   pnpm simulate:orders
 *   ORDER_COUNT=50 pnpm simulate:orders
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../.env') });

import { faker } from '@faker-js/faker';
import postgres from 'postgres';
import { trpcPost, hashPhone, sleep, logStep, logSummary } from './lib/api';

// ═══════════════════════════════════════════════════════════
// CONFIG — all tunables in one place
// ═══════════════════════════════════════════════════════════

const INTERVAL_MS = Number(process.env['SIMULATE_INTERVAL_MS'] ?? 3000);
const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';
const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const ORDER_COUNT = Math.min(500, Math.max(1, Number(process.env['SIMULATE_ORDER_COUNT'] ?? 30)));

// ═══════════════════════════════════════════════════════════

interface OrderTarget {
  campaignId: string;
  mediaBuyerId: string;
  productId: string;
  unitPrice: number;
  quantity: number;
  offerLabel: string;
}

/** Nigerian states for delivery addresses */
const NIGERIAN_STATES = [
  'Lagos', 'Abuja FCT', 'Ogun', 'Oyo', 'Rivers', 'Kano', 'Kaduna', 'Enugu',
  'Anambra', 'Delta', 'Edo', 'Imo', 'Abia', 'Kwara', 'Osun', 'Plateau',
];

async function main() {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is required. Set it in .env at the repo root.');
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════');
  console.log(' Order Simulate');
  console.log(`  API:      ${API_URL}`);
  console.log(`  Count:    ${ORDER_COUNT}`);
  console.log(`  Interval: ${INTERVAL_MS}ms`);
  console.log('═══════════════════════════════════════════════════\n');

  // ── Phase 1: Pre-fetch campaigns + products ────────────
  console.log('Phase 1: Loading campaigns & products from DB...');

  const sql = postgres(DATABASE_URL, { max: 1 });

  // product_ids may be stored as a JSONB string (e.g. "[\"uuid\"]") or a proper array.
  // Use jsonb_typeof to handle both cases safely.
  const rows: Array<{
    campaign_id: string;
    media_buyer_id: string;
    product_id: string;
    product_name: string;
    base_sale_price: string;
    offers: unknown;
  }> = await sql`
    SELECT
      c.id AS campaign_id,
      c.media_buyer_id,
      p.id AS product_id,
      p.name AS product_name,
      p.base_sale_price,
      p.offers
    FROM campaigns c
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(c.product_ids) = 'array' THEN c.product_ids
        WHEN jsonb_typeof(c.product_ids) = 'string' THEN (c.product_ids #>> '{}')::jsonb
        ELSE '[]'::jsonb
      END
    ) AS pid
    JOIN products p ON p.id = pid
    WHERE c.status = 'ACTIVE'
      AND p.status = 'ACTIVE'
    ORDER BY c.id
  `;

  await sql.end();

  if (rows.length === 0) {
    console.error('No active campaigns or products found. Run db:seed first.');
    process.exit(1);
  }

  // Build order targets — one entry per campaign×product×offer
  const targets: OrderTarget[] = [];

  for (const row of rows) {
    const offers = row.offers as Array<{ label?: string; qty?: number; price?: string }> | null;
    if (offers && Array.isArray(offers) && offers.length > 0) {
      for (const offer of offers) {
        targets.push({
          campaignId: row.campaign_id,
          mediaBuyerId: row.media_buyer_id,
          productId: row.product_id,
          unitPrice: parseFloat(offer.price ?? row.base_sale_price),
          quantity: offer.qty ?? 1,
          offerLabel: offer.label ?? 'Standard',
        });
      }
    } else {
      targets.push({
        campaignId: row.campaign_id,
        mediaBuyerId: row.media_buyer_id,
        productId: row.product_id,
        unitPrice: parseFloat(row.base_sale_price),
        quantity: 1,
        offerLabel: 'Standard',
      });
    }
  }

  const uniqueCampaigns = new Set(targets.map((t) => t.campaignId));
  const uniqueProducts = new Set(targets.map((t) => t.productId));
  console.log(`  Loaded ${uniqueCampaigns.size} campaigns, ${uniqueProducts.size} products, ${targets.length} offer combos.\n`);

  // ── Phase 2: Create orders ─────────────────────────────
  console.log(`Phase 2: Creating ${ORDER_COUNT} orders...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 1; i <= ORDER_COUNT; i++) {
    const target = targets[Math.floor(Math.random() * targets.length)]!;
    const phone = `080${faker.string.numeric(8)}`;
    const customerName = faker.person.fullName();
    const address = `${faker.location.streetAddress()}, ${NIGERIAN_STATES[Math.floor(Math.random() * NIGERIAN_STATES.length)]}`;

    const payload = {
      campaignId: target.campaignId,
      mediaBuyerId: target.mediaBuyerId,
      customerName,
      customerPhoneHash: hashPhone(phone),
      customerPhone: phone,
      customerAddress: address,
      deliveryAddress: address,
      deliveryState: NIGERIAN_STATES[Math.floor(Math.random() * NIGERIAN_STATES.length)],
      items: [
        {
          productId: target.productId,
          quantity: target.quantity,
          unitPrice: target.unitPrice,
          offerLabel: target.offerLabel,
        },
      ],
      totalAmount: target.unitPrice * target.quantity,
      paymentMethod: 'PAY_ON_DELIVERY' as const,
      source: 'edge-form' as const,
    };

    const res = await trpcPost(API_URL, 'orders.create', payload);

    if (res.ok) {
      const orderId = (res.data as any)?.id ?? '?';
      logStep('Order', i, ORDER_COUNT, `Created: id=${orderId}`);
      success++;
    } else {
      logStep('Order', i, ORDER_COUNT, `Error: ${res.error}, skipping`);
      failed++;
    }

    if (i < ORDER_COUNT) await sleep(INTERVAL_MS);
  }

  logSummary('Order Simulate', success, failed);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
