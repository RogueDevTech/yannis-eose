/**
 * cs-simulation — Processes orders through CS pipeline.
 *
 * Login as HoCS → distribute unassigned → for each order:
 *   CS_ENGAGED → initiateCall → CONFIRMED (80%) or CANCELLED (20%)
 *
 * Usage:
 *   pnpm simulate:cs
 *   SIMULATE_CS_COUNT=50 pnpm simulate:cs
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
const CS_EMAIL = process.env['SIMULATE_CS_EMAIL'] ?? 'kbshowkb+hocs@gmail.com';
const CS_PASSWORD = process.env['SIMULATE_CS_PASSWORD'] ?? 'password123';
const CS_COUNT = Math.min(200, Math.max(1, Number(process.env['SIMULATE_CS_COUNT'] ?? 20)));
const CONFIRM_RATE = 0.8; // 80% confirm, 20% cancel

// ═══════════════════════════════════════════════════════════

interface Order {
  id: string;
  status: string;
  customerName?: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' CS Simulation');
  console.log(`  API:      ${API_URL}`);
  console.log(`  Email:    ${CS_EMAIL}`);
  console.log(`  Count:    ${CS_COUNT}`);
  console.log(`  Interval: ${INTERVAL_MS}ms`);
  console.log(`  Confirm:  ${CONFIRM_RATE * 100}%`);
  console.log('═══════════════════════════════════════════════════\n');

  // ── Auth ───────────────────────────────────────────────
  console.log('Logging in...');
  const authRes = await login(API_URL, CS_EMAIL, CS_PASSWORD);
  if (!authRes.ok) {
    console.error(`Login failed: ${authRes.error}`);
    process.exit(1);
  }
  const cookie = authRes.data!;
  console.log('  Logged in.\n');

  // ── Distribute unassigned orders ───────────────────────
  console.log('Distributing unassigned orders...');
  const distRes = await trpcPost(API_URL, 'orders.distributeUnassignedOrders', {}, cookie);
  if (distRes.ok) {
    console.log(`  Distributed: ${(distRes.data as any)?.distributed ?? '?'} orders\n`);
  } else {
    console.log(`  Distribution warning: ${distRes.error} (continuing anyway)\n`);
  }

  await sleep(INTERVAL_MS);

  // ── Fetch CS_ASSIGNED orders ───────────────────────────
  console.log('Fetching CS_ASSIGNED orders...');
  const listRes = await trpcGet<{ orders: Order[]; total: number }>(
    API_URL,
    'orders.list',
    { status: 'CS_ASSIGNED', limit: 100, page: 1 },
    cookie,
  );

  if (!listRes.ok) {
    console.error(`Failed to list orders: ${listRes.error}`);
    process.exit(1);
  }

  let orders = listRes.data?.orders ?? [];

  // Also try UNPROCESSED if we don't have enough
  if (orders.length < CS_COUNT) {
    const unprocessedRes = await trpcGet<{ orders: Order[] }>(
      API_URL,
      'orders.list',
      { status: 'UNPROCESSED', limit: 100, page: 1 },
      cookie,
    );
    if (unprocessedRes.ok && unprocessedRes.data?.orders) {
      orders = [...orders, ...unprocessedRes.data.orders];
    }
  }

  const toProcess = orders.slice(0, CS_COUNT);
  console.log(`  Found ${orders.length} orders, will process ${toProcess.length}.\n`);

  if (toProcess.length === 0) {
    console.log('No orders to process. Run order-simulate first.');
    process.exit(0);
  }

  // ── Process each order ─────────────────────────────────
  let success = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const order = toProcess[i]!;
    const idx = i + 1;
    const total = toProcess.length;

    logStep('CS', idx, total, `Processing order ${order.id.slice(0, 8)}...`);

    // Step 1: initiateCall (auto-transitions to CS_ENGAGED if needed)
    const callRes = await trpcPost(API_URL, 'orders.initiateCall', { orderId: order.id }, cookie);
    if (!callRes.ok) {
      logStep('CS', idx, total, `initiateCall failed: ${callRes.error}, skipping`);
      failed++;
      if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
      continue;
    }
    logStep('CS', idx, total, `→ CS_ENGAGED + call initiated`);

    await sleep(INTERVAL_MS);

    // Step 2: CONFIRMED or CANCELLED
    const shouldConfirm = Math.random() < CONFIRM_RATE;

    if (shouldConfirm) {
      const confirmRes = await trpcPost(
        API_URL,
        'orders.transition',
        { orderId: order.id, newStatus: 'CONFIRMED' },
        cookie,
      );
      if (confirmRes.ok) {
        logStep('CS', idx, total, `→ CONFIRMED`);
        success++;
      } else {
        logStep('CS', idx, total, `CONFIRMED failed: ${confirmRes.error}, skipping`);
        failed++;
      }
    } else {
      const cancelRes = await trpcPost(
        API_URL,
        'orders.transition',
        {
          orderId: order.id,
          newStatus: 'CANCELLED',
          metadata: { reason: 'Simulation: customer declined the offer after call' },
        },
        cookie,
      );
      if (cancelRes.ok) {
        logStep('CS', idx, total, `→ CANCELLED`);
        success++;
      } else {
        logStep('CS', idx, total, `CANCELLED failed: ${cancelRes.error}, skipping`);
        failed++;
      }
    }

    if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
  }

  logSummary('CS Simulation', success, failed);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
