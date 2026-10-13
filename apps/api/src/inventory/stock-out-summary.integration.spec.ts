/**
 * Integration tests: product-level stock out (/admin/inventory/stock-out).
 *
 * Stock out = DELIVERY + WRITE_OFF minus delivery reversals. Transfers and
 * manual adjustments never count. The summary total must equal the sum of
 * its transactions, and dates are Nigeria-calendar days.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestProduct, createTestOrder } from '../test/factories/order.factory';
import { InventoryService, type StockOutScope } from './inventory.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Stock out summary — Integration', () => {
  const pgClient = getPgClient();
  const db = getDb();
  const svc = new InventoryService(
    db as any,
    { emitToRoom: () => {} } as any,
    { createForRole: async () => undefined, enqueueCreateForRole: () => undefined } as any,
    { get: async () => null } as any,
  );
  const openScope: StockOutScope = { groupId: null, effectiveBranchIds: null, effectiveCurrencyCodes: null };
  const september = { startDate: '2026-09-01', endDate: '2026-09-30' };

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  afterAll(async () => {
    await closeConnections();
  });

  async function seed() {
    const actor = await createTestUser(db as any, { role: 'STOCK_MANAGER' });
    await setSessionActor(pgClient, actor.id);
    const { id: productId } = await createTestProduct(db as any);
    const { orderId } = await createTestOrder(db as any, { productId, status: 'DELIVERED' });
    const [provider] = await db
      .insert(schema.logisticsProviders)
      .values({ name: `Provider ${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.logisticsProviders.id });
    const [location] = await db
      .insert(schema.logisticsLocations)
      .values({ providerId: provider!.id, name: `Location ${randomUUID().slice(0, 8)}`, address: 'Lagos' })
      .returning({ id: schema.logisticsLocations.id });
    const locationId = location!.id;

    const move = (
      movementType: (typeof schema.stockMovements.$inferInsert)['movementType'],
      quantity: number,
      createdAt: string,
      reason: string | null = null,
      referenceId: string | null = null,
    ) => ({
      productId,
      movementType,
      quantity,
      fromLocationId: quantity < 0 ? locationId : null,
      toLocationId: quantity > 0 ? locationId : null,
      reason,
      referenceId,
      actorId: actor.id,
      createdAt: new Date(createdAt),
    });

    await db.insert(schema.stockMovements).values([
      // Counted
      move('DELIVERY', -10, '2026-09-15T12:00:00+01:00'),
      move('DELIVERY', -5, '2026-09-16T12:00:00+01:00'),
      move('ADJUSTMENT', 5, '2026-09-17T12:00:00+01:00', 'Stock reversal: delivered order retracked or deleted. Reversing 5 units.', orderId),
      move('WRITE_OFF', -2, '2026-09-18T12:00:00+01:00'),
      // WAT day bounds: 00:30 on Sep 1 and 23:30 on Sep 30 are inside September
      move('DELIVERY', -1, '2026-09-01T00:30:00+01:00'),
      move('DELIVERY', -1, '2026-09-30T23:30:00+01:00'),
      // Never stock out
      move('TRANSFER_OUT', -50, '2026-09-15T12:00:00+01:00'),
      move('ADJUSTMENT', -3, '2026-09-15T12:00:00+01:00', 'Counting error'),
      move('ADJUSTMENT', 4, '2026-09-15T12:00:00+01:00', 'Found in store'),
      // Manual adjustment whose free-text reason mimics the prefix: no order, not a reversal
      move('ADJUSTMENT', 20, '2026-09-15T12:00:00+01:00', 'Stock reversal: miscounted intake'),
      // Outside September (23:30 on Aug 31 and 00:30 on Oct 1, WAT)
      move('DELIVERY', -7, '2026-08-31T23:30:00+01:00'),
      move('DELIVERY', -7, '2026-10-01T00:30:00+01:00'),
    ]);
    return { productId, locationId };
  }

  it('nets reversals, adds write-offs, ignores transfers and adjustments', async () => {
    const { productId } = await seed();
    const summary = await svc.stockOutSummary({ ...september, productId }, openScope);

    expect(summary.products).toHaveLength(1);
    expect(summary.products[0]).toMatchObject({
      productId,
      soldQty: 12, // 10 + 5 + 1 + 1 - 5 reversed
      reversedQty: 5,
      writtenOffQty: 2,
      totalQty: 14,
      transactionCount: 6,
    });
    expect(summary.totals).toEqual({ soldQty: 12, writtenOffQty: 2, totalQty: 14, transactionCount: 6 });
  });

  it('transactions reconcile with the summary total across pages', async () => {
    const { productId } = await seed();
    const page1 = await svc.stockOutTransactions({ ...september, productId, page: 1, limit: 4 }, openScope);
    const page2 = await svc.stockOutTransactions({ ...september, productId, page: 2, limit: 4 }, openScope);

    expect(page1.pagination.total).toBe(6);
    expect(page1.totalQty).toBe(14);
    const rows = [...page1.transactions, ...page2.transactions];
    expect(new Set(rows.map((r) => r.id)).size).toBe(6);
    expect(rows.reduce((sum, r) => sum + r.quantity, 0)).toBe(14);
    expect(rows.find((r) => r.kind === 'REVERSAL')?.quantity).toBe(-5);
  });

  it('all time includes rows outside the month', async () => {
    const { productId } = await seed();
    const summary = await svc.stockOutSummary({ productId }, openScope);
    expect(summary.totals.totalQty).toBe(28);
  });

  it('hides another company\'s products and fails closed on an empty branch scope', async () => {
    const { productId } = await seed();
    const otherCompany = await svc.stockOutSummary({ ...september, productId }, { ...openScope, groupId: randomUUID() });
    expect(otherCompany.products).toHaveLength(0);
    const noBranches = await svc.stockOutSummary({ ...september, productId }, { ...openScope, effectiveBranchIds: [] });
    expect(noBranches.products).toHaveLength(0);
  });
});
