/**
 * Integration: MB dashboard metrics follow the top-bar country (ticket, Nov 2026).
 *
 * Godwin's dashboard showed the same Total / CPA / ROAS / Ad Spend / Revenue
 * whether Tanzania or Zambia was picked, all in ₦. With a country picked:
 *  - orders and cart orders are only that currency,
 *  - ad spend is only spend logged on that country's forms (form country =
 *    `form_config.pinnedCurrency`, else the company base),
 *  - money comes back in that currency (₦ spend converted at the company rate),
 *  - with no rate, `fxRateMissing` instead of a ₦ number.
 * "All countries" keeps the ₦ consolidation, no double counting.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections } from '../test/setup-integration';
import { createTestUser, createTestBranch } from '../test/factories/order.factory';
import { MarketingService } from './marketing.service';
import { CartService } from '../cart/cart.service';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { createFakeCacheService } from '../test/fake-cache';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SettingsService } from '../settings/settings.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Marketing metrics by country', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const mkMarketing = () =>
    new MarketingService(
      db as any,
      { emitToUser: () => undefined, emitToRoom: () => undefined } as unknown as EventsService,
      { create: async () => undefined, createForRole: async () => undefined } as unknown as NotificationsService,
      new BranchTeamsService(db as any, createFakeCacheService()),
      { get: async () => null } as unknown as SettingsService,
      {} as any,
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

  /**
   * One company: NGN base, ZMW at 70 (₦70 = K1), GHS active but no rate.
   * One MB with a Nigeria form (no pinnedCurrency → base) and a Zambia form.
   */
  async function seed() {
    const branch = await createTestBranch(db as any);
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.currencies).values([
      { groupId: branch.groupId, code: 'NGN', symbol: '₦', countryName: 'Nigeria', isDefault: true, active: true, fxRateToBase: '1' },
      { groupId: branch.groupId, code: 'ZMW', symbol: 'K', countryName: 'Zambia', isDefault: false, active: true, fxRateToBase: '70' },
      { groupId: branch.groupId, code: 'GHS', symbol: 'GH₵', countryName: 'Ghana', isDefault: false, active: true, fxRateToBase: null },
    ]);
    const [ngForm] = await db
      .insert(schema.campaigns)
      .values({ mediaBuyerId: mb.id, name: 'Godwin-Nigeria', branchId: branch.id, formConfig: {} })
      .returning({ id: schema.campaigns.id });
    const [zmForm] = await db
      .insert(schema.campaigns)
      .values({ mediaBuyerId: mb.id, name: 'Godwin-Zambia', branchId: branch.id, formConfig: { pinnedCurrency: 'zmw' } })
      .returning({ id: schema.campaigns.id });

    const order = (currencyCode: string, status: string, totalAmount: string) => ({
      customerName: 'Country Test',
      customerPhoneHash: `hash-${randomUUID()}`,
      customerPhone: '08000000000',
      status: status as (typeof schema.orders.$inferInsert)['status'],
      mediaBuyerId: mb.id,
      branchId: branch.id,
      orderSource: 'edge-form',
      currencyCode,
      totalAmount: sql`${totalAmount}::numeric`,
    });
    await db.insert(schema.orders).values([
      // Nigeria: 3 orders, 1 delivered (₦60,000)
      order('NGN', 'DELIVERED', '60000'),
      order('NGN', 'UNPROCESSED', '60000'),
      order('NGN', 'CONFIRMED', '60000'),
      // Zambia: 2 orders, 1 delivered (K1,200)
      order('ZMW', 'DELIVERED', '1200'),
      order('ZMW', 'UNPROCESSED', '1200'),
    ] as any);

    const spend = (campaignId: string, amount: string) => ({
      mediaBuyerId: mb.id,
      campaignId,
      spendAmount: sql`${amount}::numeric`,
      spendDate: new Date(),
      status: 'APPROVED' as const,
      category: 'AD_SPEND' as const,
    });
    // ₦30,000 on the Nigeria form, ₦14,000 (= K200) on the Zambia form.
    await db.insert(schema.adSpendLogs).values([spend(ngForm!.id, '30000'), spend(zmForm!.id, '14000')] as any);

    // Abandoned carts: one picked ZMW, one phone-only save (no currency) on the
    // Zambia form, one NGN.
    const cart = (campaignId: string, currencyCode: string | null) => ({
      campaignId,
      customerName: 'Cart Test',
      customerPhoneHash: `hash-${randomUUID()}`,
      status: 'ABANDONED' as const,
      currencyCode,
    });
    await db
      .insert(schema.cartAbandonments)
      .values([cart(zmForm!.id, 'ZMW'), cart(zmForm!.id, null), cart(ngForm!.id, 'NGN')] as any);

    return { branch, mb };
  }

  const metricsFor = (mbId: string, currencyCode: string | null) =>
    mkMarketing().getPerformanceMetrics(
      mbId,
      'all_time',
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      null,
      undefined,
      { currencyCode },
    );

  it('Zambia: only Zambia orders and Zambia-form spend, money in ZMW', async () => {
    const { mb } = await seed();
    const m = await metricsFor(mb.id, 'ZMW');
    expect(m.currencyCode).toBe('ZMW');
    expect(m.fxRateMissing).toBe(false);
    expect(m.totalOrders).toBe(2);
    expect(m.deliveredOrders).toBe(1);
    expect(m.approvedSpend).toBeCloseTo(200, 6); // ₦14,000 / 70
    expect(m.deliveredRevenue).toBe(1200); // raw ZMW, no conversion
    expect(m.cpa).toBeCloseTo(100, 6); // K200 / 2 orders
    expect(m.trueRoas).toBeCloseTo(6, 6); // K1,200 / K200
    expect(m.cpaBase).toBeCloseTo(7000, 6); // ₦14,000 / 2, for colour thresholds
  });

  it('Nigeria: only Nigeria orders and Nigeria-form spend (form with no pin = company base)', async () => {
    const { mb } = await seed();
    const m = await metricsFor(mb.id, 'NGN');
    expect(m.currencyCode).toBe('NGN');
    expect(m.totalOrders).toBe(3);
    expect(m.confirmedOrders).toBe(2);
    expect(m.approvedSpend).toBe(30000);
    expect(m.deliveredRevenue).toBe(60000);
    expect(m.cpa).toBe(10000);
  });

  it('All countries: every order once, money consolidated in ₦ via FX', async () => {
    const { mb } = await seed();
    const all = await metricsFor(mb.id, null);
    const ng = await metricsFor(mb.id, 'NGN');
    const zm = await metricsFor(mb.id, 'ZMW');
    expect(all.currencyCode).toBeNull();
    // No double counting: the countries add up to the total.
    expect(all.totalOrders).toBe(ng.totalOrders + zm.totalOrders);
    expect(all.deliveredOrders).toBe(ng.deliveredOrders + zm.deliveredOrders);
    expect(all.approvedSpend).toBe(44000);
    expect(all.deliveredRevenue).toBe(60000 + 1200 * 70);
    expect(all.trueRoas).toBeCloseTo((60000 + 84000) / 44000, 6);
  });

  it('a country with no FX rate reports fxRateMissing, never ₦ spend', async () => {
    const { branch, mb } = await seed();
    const [ghForm] = await db
      .insert(schema.campaigns)
      .values({ mediaBuyerId: mb.id, name: 'Godwin-Ghana', branchId: branch.id, formConfig: { pinnedCurrency: 'GHS' } })
      .returning({ id: schema.campaigns.id });
    await db.insert(schema.adSpendLogs).values({
      mediaBuyerId: mb.id,
      campaignId: ghForm!.id,
      spendAmount: sql`5000::numeric`,
      spendDate: new Date(),
      status: 'APPROVED',
      category: 'AD_SPEND',
    } as any);
    const m = await metricsFor(mb.id, 'GHS');
    expect(m.currencyCode).toBe('GHS');
    expect(m.fxRateMissing).toBe(true);
    expect(m.approvedSpend).toBe(0); // not ₦5,000 under a GH₵ symbol
    expect(m.trueRoas).toBe(0);
    // The Ghana spend still counts under All countries (in ₦).
    expect((await metricsFor(mb.id, null)).approvedSpend).toBe(49000);
  });

  it('cart abandonment follows the country, placing currency-less carts by their form', async () => {
    const { mb } = await seed();
    const carts = new CartService(db as any, {} as any, {} as any, {} as any);
    const count = (codes: string[]) => carts.countAllCarts({ mediaBuyerId: mb.id, currencyCodes: codes });
    expect(await count([])).toBe(3);
    expect(await count(['ZMW'])).toBe(2);
    expect(await count(['NGN'])).toBe(1);
  });
});
