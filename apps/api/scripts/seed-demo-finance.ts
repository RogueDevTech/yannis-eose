/**
 * Demo seed: a coherent, fully-connected finance story for dev environments.
 *
 * Everything lands in ONE company (the first branch group) and one branch, so
 * company scoping is exercised with zero cross-company leakage. The numbers tie
 * end to end:
 *
 *   1. Supplier shipment (70 units, landed cost 2,560,000) is VERIFIED
 *      -> stock batches + inventory levels + INTAKE movements
 *      -> GL: Dr Stock In Hand / Cr Creditors            2,560,000
 *   2. 14 orders across the funnel (unprocessed -> remitted, plus one deleted).
 *      7 delivered sales post through the REAL GeneralLedgerService:
 *      -> GL per order: Dr Debtors / Cr Sale (revenue) + Dr COGS / Cr Stock (FIFO cost)
 *         revenue 382,000 / COGS 256,000
 *   3. A delivery remittance settles 4 of them (221,000 of AR):
 *      -> orders cascade to REMITTED
 *      -> GL: Dr Bank 210,000 + Dr Delivery Fees 8,000 + Dr Discount Fees 3,000
 *             / Cr Debtors 221,000
 *
 * Leaves: Trial Balance balanced; AR aging = 3 customers / 161,000; inventory
 * 63 units; P&L for the seed month: income 382,000, expenses 267,000.
 *
 * Usage (from repo root):
 *   DATABASE_URL=... pnpm --filter @yannis/api exec tsx scripts/seed-demo-finance.ts
 *
 * Refuses to run if any orders already exist (pass --force to also wipe the
 * demo tables first). Ledger tables are TRUNCATEd before seeding (TRUNCATE is
 * statement-level, so the gl_entries append-only row trigger does not apply;
 * this script is for dev databases only).
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { withActor } from '../src/common/db/with-actor';
import { GeneralLedgerService } from '../src/finance/general-ledger.service';

for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '.env'),
  resolve(process.cwd(), 'apps/api/.env'),
]) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
  }
}

const DB_URL = process.env['DATABASE_URL'];
if (!DB_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pgClient = postgres(DB_URL, {
  max: 1,
  onnotice: () => {},
  ssl: /sslmode=require/i.test(DB_URL) ? { rejectUnauthorized: false } : false,
});
const db = drizzle(pgClient, { schema });
const gl = new GeneralLedgerService(db as never);

const FORCE = process.argv.includes('--force');

/** Seed dates spread across the current month so default date filters show data. */
function dayOfThisMonth(day: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 10, 0, 0));
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // ── Guards ─────────────────────────────────────────────────────────────────
  const [{ n: orderCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.orders);
  if (orderCount > 0 && !FORCE) {
    console.error(`Refusing to seed: ${orderCount} orders already exist. Re-run with --force to wipe demo tables first.`);
    process.exit(1);
  }

  const [group] = await db.select().from(schema.branchGroups).limit(1);
  if (!group) {
    console.error('No branch group found. Boot the API once (migrations seed the default group) and retry.');
    process.exit(1);
  }
  const [branch] = await db.select().from(schema.branches).limit(1);
  if (!branch) {
    console.error('No branch found. Boot the API once and retry.');
    process.exit(1);
  }

  const [admin] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.role, 'SUPER_ADMIN'))
    .limit(1);
  if (!admin) {
    console.error('No SUPER_ADMIN user found to attribute the seed to.');
    process.exit(1);
  }
  const actor = { id: admin.id };

  console.log(`Seeding into company "${group.name}" / branch "${branch.name}" as ${admin.email}`);

  // ── Reset demo tables (dev only) ───────────────────────────────────────────
  await pgClient.unsafe(`
    TRUNCATE TABLE
      gl_entries, journal_entries,
      delivery_remittance_orders, delivery_remittance_outcomes, delivery_remittances,
      shipment_lines, shipments,
      stock_movements, inventory_levels, stock_batches,
      order_items, orders
    RESTART IDENTITY CASCADE
  `);
  await db.update(schema.accounts).set({ balance: '0' });

  // ── Fiscal year (idempotent) ───────────────────────────────────────────────
  const year = new Date().getUTCFullYear();
  const [fy] = await db
    .select()
    .from(schema.fiscalYears)
    .where(eq(schema.fiscalYears.name, String(year)))
    .limit(1);
  if (!fy) {
    await gl.createFiscalYear(
      { groupId: group.id, name: String(year), startDate: `${year}-01-01`, endDate: `${year}-12-31` },
      actor,
    );
  }

  // ── People ─────────────────────────────────────────────────────────────────
  async function ensureUser(email: string, name: string, role: string) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing) return existing;
    const [row] = await withActor(db as never, actor, async (tx) =>
      tx
        .insert(schema.users)
        .values({
          email,
          name,
          passwordHash: '$2b$10$demoseedusernotloginable',
          role: role as never,
          status: 'ACTIVE',
        })
        .returning(),
    );
    return row!;
  }
  const mediaBuyer = await ensureUser('demo.mb@yannis.dev', 'Tunde Bakare', 'MEDIA_BUYER');
  const closer = await ensureUser('demo.cs@yannis.dev', 'Chiamaka Obi', 'CS_CLOSER');

  // ── Logistics: provider + hub in this branch ──────────────────────────────
  const [provider] = await withActor(db as never, actor, async (tx) =>
    tx
      .insert(schema.logisticsProviders)
      .values({ name: 'Oredola Logistics' })
      .returning(),
  );
  const [hub] = await withActor(db as never, actor, async (tx) =>
    tx
      .insert(schema.logisticsLocations)
      .values({
        providerId: provider!.id,
        name: 'Lagos-Ogun Hub',
        address: '14 Ikorodu Road, Lagos',
        branchId: branch.id,
      })
      .returning(),
  );

  // ── Products (company-scoped) ──────────────────────────────────────────────
  const PRODUCTS = [
    { name: 'BCG 35', sale: 60000, factory: 38000, landingPerUnit: 2000, qty: 30 },
    { name: 'Madhuhara Silver', sale: 56000, factory: 36500, landingPerUnit: 1500, qty: 20 },
    { name: 'Arjuna-La', sale: 45000, factory: 28800, landingPerUnit: 1200, qty: 20 },
  ] as const;

  const productRows: Array<{ id: string; name: string; sale: number; landed: number }> = [];
  for (const p of PRODUCTS) {
    const [row] = await withActor(db as never, actor, async (tx) =>
      tx
        .insert(schema.products)
        .values({
          name: p.name,
          baseSalePrice: sql`${p.sale}::numeric`,
          costPrice: sql`${p.factory}::numeric`,
          groupId: group.id,
        })
        .returning(),
    );
    productRows.push({ id: row!.id, name: p.name, sale: p.sale, landed: p.factory + p.landingPerUnit });
  }

  // ── Shipment: supplier stock arrives and is VERIFIED ───────────────────────
  const verifiedAt = dayOfThisMonth(1);
  const totalLanding = PRODUCTS.reduce((s, p) => s + p.landingPerUnit * p.qty, 0);
  const [shipment] = await withActor(db as never, actor, async (tx) =>
    tx
      .insert(schema.shipments)
      .values({
        destinationLocationId: hub!.id,
        supplierName: 'Kranos Pharma Ltd',
        supplierReference: 'KP/2026/0117',
        status: 'VERIFIED',
        totalLandingCost: sql`${totalLanding}::numeric`,
        verifiedAt,
        verifiedBy: admin.id,
      })
      .returning(),
  );

  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i]!;
    const prod = productRows[i]!;
    await withActor(db as never, actor, async (tx) => {
      const [batch] = await tx
        .insert(schema.stockBatches)
        .values({
          productId: prod.id,
          factoryCost: sql`${p.factory}::numeric`,
          landingCost: sql`${p.landingPerUnit}::numeric`,
          totalLandedCost: sql`${prod.landed}::numeric`,
          quantity: p.qty,
          remainingQuantity: p.qty,
          receivedAt: verifiedAt,
        })
        .returning();
      await tx.insert(schema.shipmentLines).values({
        shipmentId: shipment!.id,
        productId: prod.id,
        expectedQuantity: p.qty,
        receivedQuantity: p.qty,
        factoryCost: sql`${p.factory}::numeric`,
        allocatedLandingCost: sql`${p.landingPerUnit * p.qty}::numeric`,
        batchId: batch!.id,
      });
      await tx.insert(schema.inventoryLevels).values({
        productId: prod.id,
        locationId: hub!.id,
        batchId: batch!.id,
        stockCount: p.qty,
        reservedCount: 0,
        status: 'AVAILABLE',
      });
      await tx.insert(schema.stockMovements).values({
        productId: prod.id,
        movementType: 'INTAKE',
        quantity: p.qty,
        toLocationId: hub!.id,
        referenceId: shipment!.id,
        reason: `Shipment receipt: ${p.qty} units of ${p.name}`,
        actorId: admin.id,
      });
    });
  }

  const purchase = await gl.postPurchaseReceipt(shipment!.id, actor);
  console.log(`Shipment VERIFIED, purchase GL posted: ${purchase.posted}`);

  // ── Orders across the funnel ───────────────────────────────────────────────
  type SeedOrder = {
    customer: string;
    product: number; // index into productRows
    status: 'UNPROCESSED' | 'CS_ASSIGNED' | 'CONFIRMED' | 'DELIVERED' | 'DELETED';
    day: number;
    remit?: boolean; // delivered orders that the remittance will settle
  };
  const ORDERS: SeedOrder[] = [
    { customer: 'Janet Ameh', product: 0, status: 'DELIVERED', day: 2, remit: true },
    { customer: 'EGBO Chisom', product: 1, status: 'DELIVERED', day: 2, remit: true },
    { customer: 'Mrs Adenle', product: 0, status: 'DELIVERED', day: 3, remit: true },
    { customer: 'Prince Jude', product: 2, status: 'DELIVERED', day: 3, remit: true },
    { customer: 'Oluseye Fagbamila', product: 0, status: 'DELIVERED', day: 4 },
    { customer: 'Silver Okafor', product: 1, status: 'DELIVERED', day: 5 },
    { customer: 'Ifeanyi Nwosu', product: 2, status: 'DELIVERED', day: 5 },
    { customer: 'Bamidele Ogboro', product: 0, status: 'CONFIRMED', day: 6 },
    { customer: 'Amaka Eze', product: 1, status: 'CONFIRMED', day: 6 },
    { customer: 'Yusuf Danladi', product: 2, status: 'CS_ASSIGNED', day: 7 },
    { customer: 'Blessing Etim', product: 0, status: 'CS_ASSIGNED', day: 7 },
    { customer: 'Ngozi Okeke', product: 1, status: 'UNPROCESSED', day: 7 },
    { customer: 'Sani Abdullahi', product: 2, status: 'UNPROCESSED', day: 7 },
    { customer: 'Test Duplicate', product: 0, status: 'DELETED', day: 4 },
  ];

  const remitIds: string[] = [];
  let seq = 0;
  for (const o of ORDERS) {
    const prod = productRows[o.product]!;
    const created = dayOfThisMonth(o.day);
    const delivered = o.status === 'DELIVERED';
    const pastConfirm = delivered || o.status === 'CONFIRMED';
    seq += 1;
    const [order] = await withActor(db as never, actor, async (tx) =>
      tx
        .insert(schema.orders)
        .values({
          customerName: o.customer,
          customerPhoneHash: `demo-seed-${seq}`,
          customerAddress: `${seq} Admiralty Way, Lekki, Lagos`,
          status: o.status as never,
          totalAmount: sql`${prod.sale}::numeric`,
          landedCost: pastConfirm ? sql`${prod.landed}::numeric` : null,
          deliveryFee: delivered ? sql`${2000}::numeric` : null,
          branchId: branch.id,
          servicingBranchId: branch.id,
          mediaBuyerId: mediaBuyer.id,
          assignedCsId: o.status === 'UNPROCESSED' ? null : closer.id,
          logisticsLocationId: delivered ? hub!.id : null,
          confirmedAt: pastConfirm ? created : null,
          deliveredAt: delivered ? created : null,
          createdAt: created,
          deletedAt: o.status === 'DELETED' ? created : null,
        })
        .returning(),
    );
    await withActor(db as never, actor, async (tx) =>
      tx.insert(schema.orderItems).values({
        orderId: order!.id,
        productId: prod.id,
        quantity: 1,
        // Project convention: unitPrice IS the line/offer total.
        unitPrice: sql`${prod.sale}::numeric`,
      }),
    );

    if (delivered) {
      // Deplete stock like the real delivery flow does.
      await withActor(db as never, actor, async (tx) => {
        await tx
          .update(schema.inventoryLevels)
          .set({ stockCount: sql`${schema.inventoryLevels.stockCount} - 1` })
          .where(eq(schema.inventoryLevels.productId, prod.id));
        await tx
          .update(schema.stockBatches)
          .set({ remainingQuantity: sql`${schema.stockBatches.remainingQuantity} - 1` })
          .where(eq(schema.stockBatches.productId, prod.id));
        await tx.insert(schema.stockMovements).values({
          productId: prod.id,
          movementType: 'DELIVERY',
          quantity: -1,
          fromLocationId: hub!.id,
          referenceId: order!.id,
          reason: `Delivered to ${o.customer}`,
          actorId: admin.id,
        });
      });
      // The real Phase 2 posting: Dr Debtors / Cr Sale + Dr COGS / Cr Stock.
      const posted = await gl.postSalesInvoice(order!.id, actor);
      if (!posted.posted) console.warn(`  sales GL skipped for ${o.customer}: ${posted.reason}`);
      if (o.remit) remitIds.push(order!.id);
    }
  }
  console.log(`Seeded ${ORDERS.length} orders (7 delivered, 4 to be remitted)`);

  // ── Remittance settles 4 delivered orders ──────────────────────────────────
  const receivedAt = dayOfThisMonth(6);
  const [remittance] = await withActor(db as never, actor, async (tx) =>
    tx
      .insert(schema.deliveryRemittances)
      .values({
        logisticsLocationId: hub!.id,
        sentBy: admin.id,
        receiptUrls: [],
        status: 'RECEIVED',
        commitmentFee: sql`${3000}::numeric`,
        sentAt: receivedAt,
        receivedAt,
        receivedBy: admin.id,
      })
      .returning(),
  );
  for (const orderId of remitIds) {
    await withActor(db as never, actor, async (tx) => {
      await tx.insert(schema.deliveryRemittanceOrders).values({
        deliveryRemittanceId: remittance!.id,
        orderId,
      });
      await tx
        .update(schema.orders)
        .set({ status: 'REMITTED', updatedAt: receivedAt })
        .where(eq(schema.orders.id, orderId));
    });
  }
  const settled = await gl.postRemittanceSettlement(remittance!.id, actor);
  console.log(`Remittance settled (${remitIds.length} orders), GL posted: ${settled.posted}`);

  // ── Tie-out report ─────────────────────────────────────────────────────────
  const tb = await gl.trialBalance({ groupId: group.id });
  const aging = await gl.aging({ groupId: group.id, kind: 'RECEIVABLE', asOfDate: ymd(dayOfThisMonth(28)) });
  const pl = await gl.profitAndLoss({ groupId: group.id, startDate: `${year}-01-01`, endDate: `${year}-12-31` });
  const [{ stock }] = await db
    .select({ stock: sql<number>`COALESCE(SUM(stock_count), 0)::int` })
    .from(schema.inventoryLevels);

  console.log('');
  console.log('Tie-out:');
  console.log(`  Trial balance      debit ${tb.totals.totalDebit} = credit ${tb.totals.totalCredit} (balanced: ${tb.totals.balanced})`);
  console.log(`  AR outstanding     ${aging.totals.total} across ${aging.parties.length} customers (expect 161000 / 3)`);
  console.log(`  P&L                income ${pl.totalIncome} (expect 382000), expenses ${pl.totalExpense} (expect 267000), net ${pl.netProfit}`);
  console.log(`  Inventory on hand  ${stock} units (expect 63)`);
  if (!tb.totals.balanced) {
    console.error('TRIAL BALANCE DOES NOT BALANCE');
    process.exit(1);
  }
  console.log('');
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pgClient.end());
