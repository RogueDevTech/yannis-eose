/**
 * Duplicate cleanup cron matching (`duplicateLosersQuery`) against real SQL.
 * The cron used to check only losers created in the last 48 hours, so a copy
 * that became a duplicate later (the customer's newer order moved past it)
 * sat in CS queues for good. It now checks each company's whole window.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb } from '../test/setup-integration';
import { createTestBranch, createTestProduct } from '../test/factories/order.factory';
import { duplicateLosersQuery, type DuplicateLoserRow } from './test-order-purge.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

describe.skipIf(SKIP_IF_NO_DB)('duplicate cleanup lookback', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  async function setup(mode: 'DELETE' | 'FLAG' = 'DELETE') {
    const { id: branchId, groupId } = await createTestBranch(db);
    const product = await createTestProduct(db);
    return {
      branchId,
      productId: product.id,
      // Only this test company is switched on, so other dev rows never match.
      rules: { companyRules: [{ groupId, mode, windowDays: 14 }], fallback: { mode: 'OFF' as const, windowDays: 14 } },
    };
  }

  async function order(
    ctx: { branchId: string; productId: string },
    o: {
      createdAt: Date;
      status: (typeof schema.orders.$inferInsert)['status'];
      phone?: string;
      hash?: string;
      currency?: string;
      deliveredAt?: Date;
      isDuplicate?: (typeof schema.orders.$inferInsert)['isDuplicate'];
    },
  ) {
    const [row] = await db
      .insert(schema.orders)
      .values({
        customerName: 'Dup Lookback Customer',
        customerPhone: o.phone ?? '08031234567',
        customerPhoneHash: o.hash ?? 'hash-dup-lookback',
        currencyCode: o.currency ?? 'NGN',
        status: o.status,
        branchId: ctx.branchId,
        totalAmount: '10000',
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt ?? null,
        isDuplicate: o.isDuplicate ?? null,
      })
      .returning({ id: schema.orders.id });
    await db.insert(schema.orderItems).values({
      id: randomUUID(),
      orderId: row!.id,
      productId: ctx.productId,
      quantity: 1,
      unitPrice: '10000',
    });
    return row!.id;
  }

  async function losers(rules: Parameters<typeof duplicateLosersQuery>[0]) {
    const rows = await db.execute<DuplicateLoserRow>(duplicateLosersQuery(rules));
    return new Map(rows.map((r) => [r.loser_id, r.winner_id]));
  }

  it('catches an older stuck copy once a newer order is delivered (missed by the 48h lookback)', async () => {
    const ctx = await setup();
    const stuck = await order(ctx, { createdAt: daysAgo(9), status: 'CS_ENGAGED' });
    const delivered = await order(ctx, { createdAt: daysAgo(4), status: 'REMITTED', deliveredAt: daysAgo(2) });
    const found = await losers(ctx.rules);
    expect(found.get(stuck)).toBe(delivered);
    expect(found.has(delivered)).toBe(false);
  });

  it('ignores losers older than the window plus margin, and pairs further apart than the window', async () => {
    const ctx = await setup();
    const tooOld = await order(ctx, { createdAt: daysAgo(20), status: 'CS_ENGAGED' });
    await order(ctx, { createdAt: daysAgo(19), status: 'CONFIRMED' });
    const farApart = await order(ctx, { createdAt: daysAgo(15.5), status: 'CS_ENGAGED', hash: 'hash-far', phone: '08039999999' });
    await order(ctx, { createdAt: daysAgo(1), status: 'CONFIRMED', hash: 'hash-far', phone: '08039999999' });
    const found = await losers(ctx.rules);
    expect(found.has(tooOld)).toBe(false);
    expect(found.has(farApart)).toBe(false);
  });

  it('matches on the last 9 digits when the hashes differ, but never across currencies', async () => {
    const ctx = await setup();
    const noZero = await order(ctx, { createdAt: daysAgo(5), status: 'UNPROCESSED', hash: 'hash-a', phone: '8031112222' });
    const kept = await order(ctx, { createdAt: daysAgo(6), status: 'CONFIRMED', hash: 'hash-b', phone: '+234 803 111 2222' });
    const otherCountry = await order(ctx, {
      createdAt: daysAgo(5), status: 'UNPROCESSED', hash: 'hash-c', phone: '+254 803 111 2222', currency: 'KES',
    });
    const found = await losers(ctx.rules);
    expect(found.get(noZero)).toBe(kept);
    expect(found.has(otherCountry)).toBe(false);
  });

  it('leaves settled orders alone: flagged CONFIRMED+, dismissed, and repeat purchases', async () => {
    const ctx = await setup();
    await order(ctx, { createdAt: daysAgo(10), status: 'REMITTED', deliveredAt: daysAgo(8) });
    const flaggedConfirmed = await order(ctx, { createdAt: daysAgo(9), status: 'CONFIRMED', isDuplicate: 'FLAGGED' });
    const dismissed = await order(ctx, { createdAt: daysAgo(9), status: 'CS_ENGAGED', isDuplicate: 'DISMISSED' });
    // Ordered after the first one was already delivered: a real repeat purchase.
    const repeat = await order(ctx, { createdAt: daysAgo(3), status: 'CS_ENGAGED', hash: 'hash-r', phone: '08035550000' });
    await order(ctx, { createdAt: daysAgo(6), status: 'DELIVERED', deliveredAt: daysAgo(5), hash: 'hash-r', phone: '08035550000' });
    const found = await losers(ctx.rules);
    expect(found.has(flaggedConfirmed)).toBe(false);
    expect(found.has(dismissed)).toBe(false);
    expect(found.has(repeat)).toBe(false);
  });

  it('still deletes an early copy the intake already flagged, and skips OFF companies', async () => {
    const ctx = await setup();
    await order(ctx, { createdAt: daysAgo(6), status: 'CONFIRMED' });
    const flaggedEarly = await order(ctx, { createdAt: daysAgo(5), status: 'UNPROCESSED', isDuplicate: 'FLAGGED' });
    expect((await losers(ctx.rules)).has(flaggedEarly)).toBe(true);
    const off = { ...ctx.rules, companyRules: ctx.rules.companyRules.map((r) => ({ ...r, mode: 'OFF' as const })) };
    expect((await losers(off)).has(flaggedEarly)).toBe(false);
  });
});
