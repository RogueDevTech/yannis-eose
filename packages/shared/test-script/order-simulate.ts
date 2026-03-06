/**
 * order-simulate — Creates random orders against the API via the cart flow.
 *
 * Pre-fetches campaigns + products from DB, then for each of ORDER_COUNT rounds:
 * 1. Saves 3 carts in parallel (cart.save) with the same customer, 3 different targets.
 * 2. Submits one order (orders.create) with one of the 3 cart IDs so that cart is CONVERTED.
 * 3. Waits INTERVAL_MS (default 1s) before the next round.
 * Resilient: logs errors and continues.
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

const INTERVAL_MS = Number(process.env['SIMULATE_INTERVAL_MS'] ?? 1000);
const API_URL = process.env['API_URL'] ?? 'http://localhost:4444';
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

  // ── Phase 2: Cart saves (3 in parallel) then submit ─────
  console.log(`Phase 2: ${ORDER_COUNT} rounds (3 carts → 1 submit each, ${INTERVAL_MS}ms between submits)...\n`);

  let success = 0;
  let failed = 0;

  /** Pick 3 targets; distinct when possible so we get 3 distinct carts. */
  function pickThreeTargets(): OrderTarget[] {
    if (targets.length >= 3) {
      const indices = new Set<number>();
      while (indices.size < 3) {
        indices.add(Math.floor(Math.random() * targets.length));
      }
      return Array.from(indices).map((i) => targets[i]!);
    }
    return Array.from({ length: 3 }, () => targets[Math.floor(Math.random() * targets.length)]!);
  }

  for (let i = 1; i <= ORDER_COUNT; i++) {
    const phone = `080${faker.string.numeric(8)}`;
    const customerName = faker.person.fullName();
    const customerPhoneHash = hashPhone(phone);
    const address = `${faker.location.streetAddress()}, ${NIGERIAN_STATES[Math.floor(Math.random() * NIGERIAN_STATES.length)]}`;
    const deliveryState = NIGERIAN_STATES[Math.floor(Math.random() * NIGERIAN_STATES.length)]!;

    const threeTargets = pickThreeTargets();
    const cartPayloads = threeTargets.map((t) => ({
      campaignId: t.campaignId,
      mediaBuyerId: t.mediaBuyerId,
      customerName,
      customerPhoneHash,
      productId: t.productId,
      offerLabel: t.offerLabel,
    }));

    const cartResults = await Promise.all(
      cartPayloads.map((p) => trpcPost<{ id: string; created: boolean }>(API_URL, 'cart.save', p)),
    );

    const firstSuccessIdx = cartResults.findIndex((r) => r.ok && r.data?.id);
    if (firstSuccessIdx === -1) {
      logStep('Order', i, ORDER_COUNT, 'All 3 cart saves failed, skipping submit');
      failed++;
      if (i < ORDER_COUNT) await sleep(INTERVAL_MS);
      continue;
    }

    const chosenCartId = cartResults[firstSuccessIdx]!.data!.id;
    const submitTarget = threeTargets[firstSuccessIdx]!;

    const orderPayload = {
      campaignId: submitTarget.campaignId,
      mediaBuyerId: submitTarget.mediaBuyerId,
      customerName,
      customerPhoneHash,
      customerPhone: phone,
      customerAddress: address,
      deliveryAddress: address,
      deliveryState,
      items: [
        {
          productId: submitTarget.productId,
          quantity: submitTarget.quantity,
          unitPrice: submitTarget.unitPrice,
          offerLabel: submitTarget.offerLabel,
        },
      ],
      totalAmount: submitTarget.unitPrice * submitTarget.quantity,
      paymentMethod: 'PAY_ON_DELIVERY' as const,
      source: 'edge-form' as const,
      cartId: chosenCartId,
    };

    const res = await trpcPost(API_URL, 'orders.create', orderPayload);

    if (res.ok) {
      const orderId = (res.data as { id?: string })?.id ?? '?';
      logStep('Order', i, ORDER_COUNT, `Saved 3 carts, submitted: orderId=${orderId}, cartId=${chosenCartId}`);
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
