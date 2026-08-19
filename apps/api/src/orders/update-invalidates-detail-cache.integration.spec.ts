/**
 * Regression test for YNS-77587.
 *
 * An order was legitimately downgraded (12 bottles → 1 bottle) via a line-price
 * change approval, but its invoice stuck at the OLD total. Root cause: on the
 * approval path, `ordersService.update()` rewrote the order_items and synced the
 * invoice correctly, but did NOT invalidate the cached order-detail payload. A
 * follow-up `getById()` (in the approval handler) then read the STALE pre-edit
 * items from cache and a second invoice sync clobbered the correct total back to
 * the old value.
 *
 * This test proves the fix: `orders.update()` invalidates the order-detail cache
 * after mutating items, so a subsequent `getById()` returns the COMMITTED items,
 * making the stale re-clobber impossible.
 *
 * Uses a REAL in-memory cache (not the always-miss fake) so the stale-read
 * scenario can actually be reproduced — with an always-miss cache the bug is
 * invisible.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestOrder } from '../test/factories/order.factory';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { createFakeCacheService } from '../test/fake-cache';
import { OrdersService } from './orders.service';
import type { CacheService } from '../common/cache/cache.service';

/**
 * A REAL in-memory cache that honours get/set/del/getOrSet semantics, so a
 * cached order can go stale and invalidation can be observed. Unlike
 * `createFakeCacheService` (every read misses), this one actually stores values.
 */
function createInMemoryCacheService(): CacheService {
  const store = new Map<string, unknown>();
  return {
    get: async (key: string) => (store.has(key) ? store.get(key) : null),
    set: async (key: string, value: unknown) => { store.set(key, value); },
    del: async (key: string) => { store.delete(key); },
    delPattern: async () => {},
    getOrSet: async <T>(key: string, _ttl: number, factory: () => Promise<T>) => {
      if (store.has(key)) return store.get(key) as T;
      const value = await factory();
      store.set(key, value);
      return value;
    },
    // expose the backing map for assertions
    __store: store,
  } as unknown as CacheService;
}

const noopEvents = { emitToUser: () => undefined, emitToRoom: () => undefined };
const noopNotifications = {
  create: async () => undefined,
  enqueueCreate: () => undefined,
  enqueueCreateForRole: () => undefined,
  enqueueCreateForLocation: () => undefined,
};
const stubCsOrderRouting = { resolveRoutingForDispatch: async () => null };

function createOrdersServiceForTest(dbRef: any, cache: CacheService) {
  return new OrdersService(
    dbRef as any,
    {} as any,                       // redis
    noopEvents as any,
    noopNotifications as any,
    {} as any,                       // settingsService
    {} as any,                       // cartService
    {} as any,                       // inventoryService
    {} as any,                       // paystackService
    new BranchTeamsService(dbRef as any, createFakeCacheService()),
    cache,                           // <-- real in-memory cache under test
    stubCsOrderRouting as any,
    { postSalesInvoice: async () => ({ posted: false }), reverseVoucher: async () => ({ reversed: false }) } as any,
  );
}

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('orders.update() invalidates order-detail cache (YNS-77587 regression)', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });
  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });
  afterAll(async () => {
    await closeConnections();
  });

  it('getById after update() returns the NEW items, not the stale cached ones', async () => {
    const cache = createInMemoryCacheService();
    const store = (cache as unknown as { __store: Map<string, unknown> }).__store;
    const actor = await createTestUser(db, { role: 'SUPER_ADMIN' });
    const { orderId, productId } = await createTestOrder(db, { status: 'CONFIRMED' });
    await setSessionActor(pgClient, actor.id);
    const orders = createOrdersServiceForTest(db, cache);

    // 1) Prime the cache: getById caches the order at its ORIGINAL single line
    //    (qty 1, ₦10,000 from the factory). Bump it to a "large" order first so
    //    the downgrade is meaningful.
    await db.update(schema.orderItems)
      .set({ quantity: 12, unitPrice: '375000' })
      .where(eq(schema.orderItems.orderId, orderId));
    await db.update(schema.orders)
      .set({ totalAmount: '375000' })
      .where(eq(schema.orders.id, orderId));

    const primed = await orders.getById(orderId);
    const primedItems = (primed as { orderItems?: Array<{ quantity: number; unitPrice: string }> }).orderItems ?? [];
    expect(primedItems.length).toBe(1);
    expect(primedItems[0]!.quantity).toBe(12);
    // Cache is now warm for this order.
    expect([...store.keys()].some((k) => k.includes(orderId))).toBe(true);

    // 2) Downgrade the order to a single bottle via update() — the approval path.
    await orders.update(
      { orderId, items: [{ productId, quantity: 1, unitPrice: 60000, offerLabel: 'BUY 1 BOTTLE + FREE DELIVERY' }], totalAmount: 60000 },
      actor as any,
    );

    // 3) The cache MUST have been invalidated by update(). A fresh getById must
    //    now reflect the committed single-bottle items — NOT the stale qty-12
    //    snapshot. Before the fix, this returned the stale cached payload.
    const after = await orders.getById(orderId);
    const afterItems = (after as { orderItems?: Array<{ quantity: number; unitPrice: string }> }).orderItems ?? [];
    expect(afterItems.length).toBe(1);
    expect(afterItems[0]!.quantity).toBe(1);
    expect(Number(afterItems[0]!.unitPrice)).toBe(60000);
  });
});
