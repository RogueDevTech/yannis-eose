/**
 * 3pl-simulation — Moves ALLOCATED orders through the full delivery cycle.
 *
 * Login as HOL → fetch ALLOCATED orders + riders → per order:
 *   DISPATCHED → IN_TRANSIT → DELIVERED → COMPLETED
 * Each transition separated by INTERVAL_MS.
 *
 * Usage:
 *   pnpm simulate:3pl
 *   SIMULATE_3PL_COUNT=50 pnpm simulate:3pl
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../.env') });

import { login, trpcPost, trpcGet, sleep, logStep, logSummary } from './lib/api';

// ═══════════════════════════════════════════════════════════
// CONFIG — all tunables in one place
// ═══════════════════════════════════════════════════════════

const INTERVAL_MS = Number(process.env['SIMULATE_INTERVAL_MS'] ?? 3000);
const API_URL = process.env['API_URL'] ?? 'http://localhost:4444';
const TPL_EMAIL = process.env['SIMULATE_3PL_EMAIL'] ?? 'kbshowkb+hol@gmail.com';
const TPL_PASSWORD = process.env['SIMULATE_3PL_PASSWORD'] ?? 'password123';
const TPL_COUNT = Math.min(200, Math.max(1, Number(process.env['SIMULATE_3PL_COUNT'] ?? 20)));
const RETURN_RATE = 0.05; // 5% chance of RETURNED instead of DELIVERED

// ═══════════════════════════════════════════════════════════

interface Order {
  id: string;
  status: string;
  logisticsLocationId?: string | null;
}

interface Rider {
  id: string;
  name: string;
  logisticsLocationId: string | null;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' 3PL Simulation');
  console.log(`  API:      ${API_URL}`);
  console.log(`  Email:    ${TPL_EMAIL}`);
  console.log(`  Count:    ${TPL_COUNT}`);
  console.log(`  Interval: ${INTERVAL_MS}ms`);
  console.log(`  Return:   ${RETURN_RATE * 100}%`);
  console.log('═══════════════════════════════════════════════════\n');

  // ── Auth ───────────────────────────────────────────────
  console.log('Logging in...');
  const authRes = await login(API_URL, TPL_EMAIL, TPL_PASSWORD);
  if (!authRes.ok) {
    console.error(`Login failed: ${authRes.error}`);
    process.exit(1);
  }
  const cookie = authRes.data!;
  console.log('  Logged in.\n');

  // ── Fetch ALLOCATED orders ─────────────────────────────
  console.log('Fetching ALLOCATED orders...');
  const ordersRes = await trpcGet<{ orders: Order[]; total: number }>(
    API_URL,
    'orders.list',
    { status: 'ALLOCATED', limit: 100, page: 1 },
    cookie,
  );

  if (!ordersRes.ok) {
    console.error(`Failed to list orders: ${ordersRes.error}`);
    process.exit(1);
  }

  const allOrders = ordersRes.data?.orders ?? [];
  console.log(`  Found ${allOrders.length} ALLOCATED orders.\n`);

  // ── Fetch riders ───────────────────────────────────────
  console.log('Fetching riders...');
  const ridersRes = await trpcGet<Rider[]>(API_URL, 'logistics.listRiders', undefined, cookie);

  if (!ridersRes.ok) {
    console.error(`Failed to list riders: ${ridersRes.error}`);
    process.exit(1);
  }

  const riders = ridersRes.data ?? [];
  console.log(`  Found ${riders.length} riders.\n`);

  if (riders.length === 0) {
    console.error('No riders found. Seed riders first.');
    process.exit(1);
  }

  // Build rider lookup by locationId
  const ridersByLocation = new Map<string, Rider[]>();
  for (const rider of riders) {
    if (rider.logisticsLocationId) {
      const existing = ridersByLocation.get(rider.logisticsLocationId) ?? [];
      existing.push(rider);
      ridersByLocation.set(rider.logisticsLocationId, existing);
    }
  }

  const toProcess = allOrders.slice(0, TPL_COUNT);

  if (toProcess.length === 0) {
    console.log('No ALLOCATED orders to process. Run logistics-simulation first.');
    process.exit(0);
  }

  // ── Process each order through 4 transitions ──────────
  console.log(`Processing ${toProcess.length} orders through delivery cycle...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const order = toProcess[i]!;
    const idx = i + 1;
    const total = toProcess.length;
    let orderFailed = false;

    logStep('3PL', idx, total, `Order ${order.id.slice(0, 8)} — starting cycle`);

    // Pick a rider for this order's location
    const locationRiders = order.logisticsLocationId
      ? ridersByLocation.get(order.logisticsLocationId)
      : undefined;
    const rider = locationRiders && locationRiders.length > 0
      ? locationRiders[Math.floor(Math.random() * locationRiders.length)]!
      : riders[Math.floor(Math.random() * riders.length)]!;

    // Step 1: ALLOCATED → DISPATCHED
    const dispatchRes = await trpcPost(
      API_URL,
      'orders.transition',
      {
        orderId: order.id,
        newStatus: 'DISPATCHED',
        metadata: { riderId: rider.id },
      },
      cookie,
    );

    if (!dispatchRes.ok) {
      logStep('3PL', idx, total, `DISPATCHED failed: ${dispatchRes.error}, skipping order`);
      failed++;
      if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
      continue;
    }
    logStep('3PL', idx, total, `→ DISPATCHED (rider: ${rider.name})`);

    await sleep(INTERVAL_MS);

    // Step 2: DISPATCHED → IN_TRANSIT
    const transitRes = await trpcPost(
      API_URL,
      'orders.transition',
      { orderId: order.id, newStatus: 'IN_TRANSIT' },
      cookie,
    );

    if (!transitRes.ok) {
      logStep('3PL', idx, total, `IN_TRANSIT failed: ${transitRes.error}, skipping order`);
      failed++;
      if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
      continue;
    }
    logStep('3PL', idx, total, `→ IN_TRANSIT`);

    await sleep(INTERVAL_MS);

    // Step 3: IN_TRANSIT → DELIVERED or RETURNED
    const shouldReturn = Math.random() < RETURN_RATE;

    if (shouldReturn) {
      const returnRes = await trpcPost(
        API_URL,
        'orders.transition',
        {
          orderId: order.id,
          newStatus: 'RETURNED',
          metadata: {
            reason: 'Simulation: customer refused delivery upon arrival',
          },
        },
        cookie,
      );
      if (returnRes.ok) {
        logStep('3PL', idx, total, `→ RETURNED`);
        success++;
      } else {
        logStep('3PL', idx, total, `RETURNED failed: ${returnRes.error}`);
        failed++;
      }
      if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
      continue; // Skip COMPLETED for returned orders
    }

    // Random GPS near Lagos
    const gpsLat = 6.45 + Math.random() * 0.2;
    const gpsLng = 3.35 + Math.random() * 0.2;

    const deliverRes = await trpcPost(
      API_URL,
      'orders.transition',
      {
        orderId: order.id,
        newStatus: 'DELIVERED',
        metadata: {
          gpsLat: parseFloat(gpsLat.toFixed(6)),
          gpsLng: parseFloat(gpsLng.toFixed(6)),
          deliveryProofUrl: 'https://example.com/proof/sim-delivery.png',
          deliveryFeeAddOn: 0,
        },
      },
      cookie,
    );

    if (!deliverRes.ok) {
      logStep('3PL', idx, total, `DELIVERED failed: ${deliverRes.error}, skipping order`);
      failed++;
      if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
      continue;
    }
    logStep('3PL', idx, total, `→ DELIVERED`);

    await sleep(INTERVAL_MS);

    // Step 4: DELIVERED → COMPLETED
    const completeRes = await trpcPost(
      API_URL,
      'orders.transition',
      { orderId: order.id, newStatus: 'COMPLETED' },
      cookie,
    );

    if (completeRes.ok) {
      logStep('3PL', idx, total, `→ COMPLETED`);
      success++;
    } else {
      logStep('3PL', idx, total, `COMPLETED failed: ${completeRes.error}`);
      failed++;
    }

    if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
  }

  logSummary('3PL Simulation', success, failed);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
