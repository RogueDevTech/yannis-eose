/**
 * Adjust order items: product-swap picker (`listProductsForAdjustOffers`).
 * A ZK order could only pick the product already on it, because every other
 * product's offers were stripped for foreign currency and the picker hid
 * products without offers (ticket 2026-11-21: Brahmi Shakti -> Diabal).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections } from '../test/setup-integration';
import { createTestUser, createTestOrder, createTestProduct } from '../test/factories/order.factory';
import { OrdersService } from './orders.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('listProductsForAdjustOffers', () => {
  const pgClient = getPgClient();
  const db = getDb();
  const service = new OrdersService(
    db as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });
  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });
  afterAll(async () => {
    await closeConnections();
  });

  async function setup(currencyCode: string) {
    const user = await createTestUser(db, { role: 'SUPER_ADMIN' });
    const onOrder = await createTestProduct(db);
    const { orderId } = await createTestOrder(db, { productId: onOrder.id });
    await db.update(schema.orders).set({ currencyCode }).where(eq(schema.orders.id, orderId));

    // Product with one ZMW-priced tier, one unpriced tier and one priced at 0.
    const swapTo = await createTestProduct(db);
    const tpl = async (name: string, price: string, qty: number) => {
      const [row] = await db
        .insert(schema.offerTemplates)
        .values({ productId: swapTo.id, name, price, quantity: qty, createdBy: user.id })
        .returning({ id: schema.offerTemplates.id });
      return row!.id;
    };
    // Inserted out of order: the picker must still list them by quantity.
    const zero = await tpl('Buy 3 (zero ZMW)', '80000', 3);
    await tpl('Buy 2 (NGN only)', '55000', 2);
    const priced = await tpl('Buy 1', '30000', 1);
    await db.insert(schema.offerTemplatePrices).values([
      { id: randomUUID(), offerTemplateId: priced, currencyCode: 'ZMW', price: '1200' },
      { id: randomUUID(), offerTemplateId: zero, currencyCode: 'ZMW', price: '0' },
    ]);

    // Product with embedded (NGN-only) offers and no templates.
    const embeddedOnly = await createTestProduct(db);

    const products = [
      { id: onOrder.id, name: 'On order', offers: [] },
      { id: swapTo.id, name: 'Swap to', offers: [] },
      {
        id: embeddedOnly.id,
        name: 'Embedded',
        baseSalePrice: '10000',
        offers: [
          { label: 'Promo', qty: 2, price: '18000' },
          { label: 'No price', qty: 1 },
        ],
      },
    ];
    return { orderId, products, swapTo, embeddedOnly, onOrder, user, priced };
  }

  it('foreign-currency order: returns every product, offers only in that currency', async () => {
    const { orderId, products, swapTo, embeddedOnly, onOrder } = await setup('ZMW');
    const out = await service.listProductsForAdjustOffers(orderId, products);
    const byId = new Map(out.map((p) => [p.id, p]));

    expect(out).toHaveLength(3);
    expect(byId.get(swapTo.id)!.offers).toEqual([{ label: 'Buy 1', qty: 1, price: 1200 }]);
    // NGN embedded offers are never relabelled as ZK; product stays pickable.
    expect(byId.get(embeddedOnly.id)!.offers).toEqual([]);
    expect(byId.get(onOrder.id)!.offers).toEqual([]);
  });

  it('base-currency order: embedded offers first, else template base prices', async () => {
    const { orderId, products, swapTo, embeddedOnly } = await setup('NGN');
    const out = await service.listProductsForAdjustOffers(orderId, products);
    const byId = new Map(out.map((p) => [p.id, p]));

    expect(out).toHaveLength(3);
    // An embedded offer without a price falls back to the base sale price.
    expect(byId.get(embeddedOnly.id)!.offers).toEqual([
      { label: 'Promo', qty: 2, price: 18000 },
      { label: 'No price', qty: 1, price: 10000 },
    ]);
    // Sorted by quantity, so the tier auto-selected on a swap is stable.
    expect(byId.get(swapTo.id)!.offers.map((o) => o.qty)).toEqual([1, 2, 3]);
    expect(byId.get(swapTo.id)!.offers.map((o) => o.price)).toEqual([30000, 55000, 80000]);
  });

  it('listOrderItemOffers: a ZMW order never shows an unpriced tier at its NGN price', async () => {
    const { orderId, swapTo, user } = await setup('ZMW');
    // Put the swap-to product on the order so the fallback template path runs.
    await db.insert(schema.orderItems).values({
      id: randomUUID(),
      orderId,
      productId: swapTo.id,
      quantity: 1,
      unitPrice: '1200',
    });
    const out = await service.listOrderItemOffers(orderId, user as any);
    const tiers = out.find((e: { productId: string }) => e.productId === swapTo.id)?.offers ?? [];
    expect(tiers).toEqual([{ label: 'Buy 1', quantity: 1, unitPrice: 1200 }]);
  });
});
