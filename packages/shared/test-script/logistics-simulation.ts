/**
 * logistics-simulation — Allocates CONFIRMED orders to 3PL locations.
 *
 * Login as HOL → fetch CONFIRMED orders + locations → allocate each to
 * a random active location, one request every INTERVAL_MS.
 *
 * Usage:
 *   pnpm simulate:logistics
 *   SIMULATE_LOGISTICS_COUNT=50 pnpm simulate:logistics
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
const LOGISTICS_EMAIL = process.env['SIMULATE_LOGISTICS_EMAIL'] ?? 'kbshowkb+hol@gmail.com';
const LOGISTICS_PASSWORD = process.env['SIMULATE_LOGISTICS_PASSWORD'] ?? 'password123';
const LOGISTICS_COUNT = Math.min(200, Math.max(1, Number(process.env['SIMULATE_LOGISTICS_COUNT'] ?? 20)));

// ═══════════════════════════════════════════════════════════

interface Order {
  id: string;
  status: string;
}

interface Location {
  id: string;
  name: string;
  providerId: string;
  dispatchLocked: boolean;
  status: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Logistics Simulation');
  console.log(`  API:      ${API_URL}`);
  console.log(`  Email:    ${LOGISTICS_EMAIL}`);
  console.log(`  Count:    ${LOGISTICS_COUNT}`);
  console.log(`  Interval: ${INTERVAL_MS}ms`);
  console.log('═══════════════════════════════════════════════════\n');

  // ── Auth ───────────────────────────────────────────────
  console.log('Logging in...');
  const authRes = await login(API_URL, LOGISTICS_EMAIL, LOGISTICS_PASSWORD);
  if (!authRes.ok) {
    console.error(`Login failed: ${authRes.error}`);
    process.exit(1);
  }
  const cookie = authRes.data!;
  console.log('  Logged in.\n');

  // ── Fetch CONFIRMED orders ─────────────────────────────
  console.log('Fetching CONFIRMED orders...');
  const ordersRes = await trpcGet<{ orders: Order[]; total: number }>(
    API_URL,
    'orders.list',
    { status: 'CONFIRMED', limit: 100, page: 1 },
    cookie,
  );

  if (!ordersRes.ok) {
    console.error(`Failed to list orders: ${ordersRes.error}`);
    process.exit(1);
  }

  const allOrders = ordersRes.data?.orders ?? [];
  console.log(`  Found ${allOrders.length} CONFIRMED orders.\n`);

  // ── Fetch locations ────────────────────────────────────
  console.log('Fetching locations...');
  const locRes = await trpcGet<{ locations: Location[]; total: number }>(
    API_URL,
    'logistics.listLocations',
    { status: 'ACTIVE', limit: 100, page: 1 },
    cookie,
  );

  if (!locRes.ok) {
    console.error(`Failed to list locations: ${locRes.error}`);
    process.exit(1);
  }

  const locations = (locRes.data?.locations ?? []).filter((l) => !l.dispatchLocked);
  console.log(`  Found ${locations.length} active, unlocked locations.\n`);

  if (locations.length === 0) {
    console.error('No available locations. Seed locations first.');
    process.exit(1);
  }

  const toProcess = allOrders.slice(0, LOGISTICS_COUNT);

  if (toProcess.length === 0) {
    console.log('No CONFIRMED orders to allocate. Run cs-simulation first.');
    process.exit(0);
  }

  // ── Allocate each order ────────────────────────────────
  console.log(`Allocating ${toProcess.length} orders...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const order = toProcess[i]!;
    const location = locations[Math.floor(Math.random() * locations.length)]!;
    const idx = i + 1;
    const total = toProcess.length;

    logStep('Logistics', idx, total, `Allocating ${order.id.slice(0, 8)} → ${location.name}...`);

    const res = await trpcPost(
      API_URL,
      'orders.transition',
      {
        orderId: order.id,
        newStatus: 'ALLOCATED',
        metadata: {
          logisticsLocationId: location.id,
          logisticsProviderId: location.providerId,
        },
      },
      cookie,
    );

    if (res.ok) {
      logStep('Logistics', idx, total, `→ ALLOCATED at ${location.name}`);
      success++;
    } else {
      logStep('Logistics', idx, total, `Error: ${res.error}, skipping`);
      failed++;
    }

    if (i < toProcess.length - 1) await sleep(INTERVAL_MS);
  }

  logSummary('Logistics Simulation', success, failed);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
