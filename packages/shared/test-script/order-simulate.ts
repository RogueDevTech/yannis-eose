/**
 * order-simulate — Creates random orders against the API via the cart flow.
 *
 * Pre-fetches campaigns + products from DB, then for each of ORDER_COUNT rounds:
 * 1. Saves one cart (cart.save) per user.
 * 2. Submits one order (orders.create) with that cart ID. One order per user, no duplicate phones.
 * 3. Optional INTERVAL_MS between rounds (default 0 for speed). CONCURRENCY runs multiple rounds in parallel.
 * Resilient: logs errors and continues.
 *
 * Usage:
 *   pnpm simulate:orders
 *   ORDER_COUNT=50 pnpm simulate:orders
 *   CONCURRENCY=5 pnpm simulate:orders
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

const INTERVAL_MS = Number(process.env['SIMULATE_INTERVAL_MS'] ?? 0);
const API_URL = process.env['API_URL'] ?? 'http://localhost:4444';
const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const ORDER_COUNT = Math.min(500, Math.max(1, Number(process.env['SIMULATE_ORDER_COUNT'] ?? 30)));
const CONCURRENCY = Math.max(1, Math.min(20, Number(process.env['SIMULATE_CONCURRENCY'] ?? 5)));

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
  console.log(`  API:         ${API_URL}`);
  console.log(`  Count:       ${ORDER_COUNT}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Interval:    ${INTERVAL_MS}ms`);
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

  // ── Phase 2: One cart + one order per user (unique phones), optional concurrency ─────
  console.log(`Phase 2: ${ORDER_COUNT} rounds (1 cart → 1 order per user, concurrency=${CONCURRENCY})...\n`);

  const usedPhones = new Set<string>();
  const uniquePhones: string[] = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    let phone: string;
    let attempts = 0;
    do {
      phone = `080${faker.string.numeric(8)}`;
      if (++attempts >= 100_000) throw new Error('Could not generate unique phones');
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    uniquePhones.push(phone);
  }

  /** Pick one target at random. */
  function pickOneTarget(): OrderTarget {
    return targets[Math.floor(Math.random() * targets.length)]!;
  }

  /** Run a single order round (1 cart save + 1 order create). Returns success. */
  async function runOneOrder(roundIndex: number, phone: string): Promise<boolean> {
    const customerName = faker.person.fullName();
    const customerPhoneHash = hashPhone(phone);
    const address = `${faker.location.streetAddress()}, ${NIGERIAN_STATES[Math.floor(Math.random() * NIGERIAN_STATES.length)]}`;
    const deliveryState = NIGERIAN_STATES[Math.floor(Math.random() * NIGERIAN_STATES.length)]!;
    const target = pickOneTarget();

    const cartRes = await trpcPost<{ id: string; created: boolean }>(API_URL, 'cart.save', {
      campaignId: target.campaignId,
      mediaBuyerId: target.mediaBuyerId,
      customerName,
      customerPhoneHash,
      productId: target.productId,
      offerLabel: target.offerLabel,
    });

    if (!cartRes.ok || !cartRes.data?.id) {
      logStep('Order', roundIndex, ORDER_COUNT, `Cart save failed: ${cartRes.error ?? 'no id'}`);
      return false;
    }

    const cartId = cartRes.data.id;
    const orderPayload = {
      campaignId: target.campaignId,
      mediaBuyerId: target.mediaBuyerId,
      customerName,
      customerPhoneHash,
      customerPhone: phone,
      customerAddress: address,
      deliveryAddress: address,
      deliveryState,
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
      cartId,
    };

    const orderRes = await trpcPost(API_URL, 'orders.create', orderPayload);
    if (orderRes.ok) {
      const orderId = (orderRes.data as { id?: string })?.id ?? '?';
      logStep('Order', roundIndex, ORDER_COUNT, `orderId=${orderId}, cartId=${cartId}`);
      return true;
    }
    logStep('Order', roundIndex, ORDER_COUNT, `Submit error: ${orderRes.error}`);
    return false;
  }

  // Run rounds with concurrency limit
  let success = 0;
  let failed = 0;
  let nextRound = 1;
  const inFlight: Promise<void>[] = [];

  async function runNext(): Promise<void> {
    while (nextRound <= ORDER_COUNT) {
      const round = nextRound++;
      const phone = uniquePhones[round - 1]!;
      const ok = await runOneOrder(round, phone);
      if (ok) success++;
      else failed++;
      if (INTERVAL_MS > 0 && round < ORDER_COUNT) await sleep(INTERVAL_MS);
    }
  }

  for (let c = 0; c < CONCURRENCY; c++) {
    inFlight.push(runNext());
  }
  await Promise.all(inFlight);

  logSummary('Order Simulate', success, failed);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
