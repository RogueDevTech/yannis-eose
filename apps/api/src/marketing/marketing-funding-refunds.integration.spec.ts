/**
 * Integration: funding refunds, adjustments, reconciliation and month close (mig 0361).
 *
 * A Media Buyer returns unspent funding to the HoM who funded them:
 *   request (amount held) -> funder approves -> funder confirms -> COMPLETED
 * Only COMPLETED moves money; both balances change in one transaction; the
 * original funding row is never touched.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestBranch } from '../test/factories/order.factory';
import { MarketingService } from './marketing.service';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { createFakeCacheService } from '../test/fake-cache';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Marketing funding: refunds and reconciliation', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const eventsStub = { emitToUser: () => undefined, emitToRoom: () => undefined } as unknown as EventsService;
  const enqueueCreate = vi.fn();
  const notificationsStub = {
    create: async () => undefined,
    createForRole: async () => undefined,
    enqueueCreate,
    enqueueCreateForRole: () => undefined,
  } as unknown as NotificationsService;
  const settingsStub = { get: async () => null } as unknown as SettingsService;
  const postMarketingFundingRefund = vi.fn(async () => ({ posted: true }));

  const mkMarketing = () =>
    new MarketingService(
      db as any,
      eventsStub,
      notificationsStub,
      new BranchTeamsService(db as any, createFakeCacheService()),
      settingsStub,
      { postMarketingFundingRefund, reverseVoucher: vi.fn(async () => ({ reversed: true })) } as any,
    );

  const mbBalance = (svc: MarketingService, userId: string): Promise<number> =>
    (svc as any).computeMbBalanceInTx(db, userId, null, null);
  const homDisbursable = (svc: MarketingService, userId: string): Promise<number> =>
    (svc as any).computeMarketingDisbursableInTx(db, userId, null, null);
  const ctx = { currentBranchId: null, effectiveBranchIds: null };

  /** Finance -> HoM 1,000,000 (received); HoM -> MB 100,000 (received). */
  async function setup() {
    const branch = await createTestBranch(db as any);
    const admin = await createTestUser(db as any, { role: 'ADMIN' as any });
    const finance = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });
    const finance2 = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const otherMb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
      { userId: otherMb.id, branchId: branch.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, admin.id);
    await db.insert(schema.marketingFunding).values({
      senderId: finance.id,
      receiverId: hom.id,
      amount: sql`${1_000_000}::numeric`,
      status: 'COMPLETED',
      verifiedAt: new Date('2026-09-01T09:00:00Z'),
      sentAt: new Date('2026-09-01T08:00:00Z'),
    });
    const [funding] = await db
      .insert(schema.marketingFunding)
      .values({
        senderId: hom.id,
        receiverId: mb.id,
        amount: sql`${100_000}::numeric`,
        status: 'COMPLETED',
        sentAt: new Date('2026-09-02T08:00:00Z'),
        verifiedAt: new Date('2026-09-02T09:00:00Z'),
      })
      .returning();
    const actor = (u: { id: string; name?: string | null }, role: string, extra: Partial<SessionUser> = {}) =>
      ({ id: u.id, role, name: u.name ?? role, permissions: [], ...extra }) as unknown as SessionUser;
    return {
      branch,
      funding: funding!,
      admin: actor(admin, 'ADMIN'),
      finance: actor(finance, 'FINANCE_OFFICER', { permissions: ['marketing.funding.adjust', 'marketing.funding.reconcile'] }),
      finance2: actor(finance2, 'FINANCE_OFFICER', { permissions: ['marketing.funding.adjust', 'marketing.funding.reconcile'] }),
      hom: actor(hom, 'HEAD_OF_MARKETING'),
      mb: actor(mb, 'MEDIA_BUYER'),
      otherMb: actor(otherMb, 'MEDIA_BUYER'),
    };
  }

  beforeEach(async () => {
    enqueueCreate.mockClear();
    postMarketingFundingRefund.mockClear();
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  afterAll(async () => {
    await closeConnections();
  });

  it('partial refund: held on request, moves both balances only on completion', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const homBefore = await homDisbursable(svc, s.hom.id); // 1,000,000 - 100,000

    const refund = await svc.refunds.requestRefund(
      { fundingId: s.funding.id, amount: 40_000, reason: 'Campaign paused, returning unused budget' },
      s.mb,
    );
    expect(refund.status).toBe('PENDING');
    expect(refund.reference).toMatch(/^RF-[0-9A-F]{10}$/);
    // Held: the MB cannot spend it, the HoM does not have it yet.
    expect(await mbBalance(svc, s.mb.id)).toBe(60_000);
    expect(await homDisbursable(svc, s.hom.id)).toBe(homBefore);
    expect(enqueueCreate).toHaveBeenCalledWith(expect.objectContaining({ userId: s.hom.id, type: 'funding:refund_requested' }));

    // The refunder cannot approve their own refund; an unrelated MB cannot either.
    await expect(svc.refunds.reviewRefund({ refundId: refund.id, action: 'APPROVE' }, s.mb)).rejects.toThrow(/cannot approve/);
    await expect(svc.refunds.reviewRefund({ refundId: refund.id, action: 'APPROVE' }, s.otherMb)).rejects.toThrow(/original funder/);
    // Cannot complete before approval.
    await expect(svc.refunds.completeRefund(refund.id, s.hom)).rejects.toThrow(/Approve the refund first/);

    const approved = await svc.refunds.reviewRefund({ refundId: refund.id, action: 'APPROVE' }, s.hom);
    expect(approved.status).toBe('APPROVED');
    expect(await mbBalance(svc, s.mb.id)).toBe(60_000);
    expect(await homDisbursable(svc, s.hom.id)).toBe(homBefore);

    const done = await svc.refunds.completeRefund(refund.id, s.hom);
    expect(done.status).toBe('COMPLETED');
    expect(done.completedAt).toBeTruthy();
    expect(await mbBalance(svc, s.mb.id)).toBe(60_000);
    expect(await homDisbursable(svc, s.hom.id)).toBe(homBefore + 40_000);

    // Original funding untouched.
    const [orig] = await db.select().from(schema.marketingFunding).where(eq(schema.marketingFunding.id, s.funding.id));
    expect(orig).toMatchObject({ status: 'COMPLETED', amount: '100000.00' });

    // Not a GL refund: this funding was not created from a request.
    expect(postMarketingFundingRefund).not.toHaveBeenCalled();
    // Both parties told it is complete.
    const completedTo = enqueueCreate.mock.calls
      .map((c) => c[0])
      .filter((n) => n.type === 'funding:refund_completed')
      .map((n) => n.userId);
    expect(completedTo.sort()).toEqual([s.hom.id, s.mb.id].sort());

    // Cannot complete twice.
    await expect(svc.refunds.completeRefund(refund.id, s.hom)).rejects.toThrow(/already completed/);
  });

  it('cannot refund more than the unspent balance or the funding, nor the same money twice', async () => {
    // Note: the harness BEGIN is invisible to withActor, so the first SUCCESSFUL
    // call commits the setup; expected failures come after it.
    const svc = mkMarketing();
    const s = await setup();
    const [small] = await db
      .insert(schema.marketingFunding)
      .values({ senderId: s.hom.id, receiverId: s.mb.id, amount: sql`${20_000}::numeric`, status: 'COMPLETED', verifiedAt: new Date() })
      .returning();
    await db.insert(schema.adSpendLogs).values({
      mediaBuyerId: s.mb.id,
      spendAmount: sql`${70_000}::numeric`,
      spendDate: new Date('2026-09-05T10:00:00Z'),
      status: 'APPROVED',
    });
    // Available: 120,000 - 70,000 = 50,000.
    await svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 30_000, reason: 'Returning most of the remainder' }, s.mb);
    // 20,000 left available; the small funding is 20,000 but 25,000 asked.
    await expect(
      svc.refunds.requestRefund({ fundingId: small!.id, amount: 25_000, reason: 'More than this funding was' }, s.mb),
    ).rejects.toThrow(/at most ₦20,000 of this funding/);
    await svc.refunds.requestRefund({ fundingId: small!.id, amount: 20_000, reason: 'Returning the small funding' }, s.mb);
    // Everything unspent is now held: the same money cannot be refunded again.
    await expect(
      svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 1, reason: 'Trying to refund the same money' }, s.mb),
    ).rejects.toThrow(/unspent balance/);
    expect(await mbBalance(svc, s.mb.id)).toBe(0);
  });

  it('refunds stay inside a company: recorded on the refund, refused across companies', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const r = await svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 1_000, reason: 'Small return in my company' }, s.mb);
    expect(r.groupId).toBe(s.branch.groupId);

    // A funder who only belongs to another company.
    const other = await createTestBranch(db as any);
    const outsider = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    await db.insert(schema.userBranches).values({ userId: outsider.id, branchId: other.id, isPrimary: true });
    const [foreign] = await db
      .insert(schema.marketingFunding)
      .values({ senderId: outsider.id, receiverId: s.mb.id, amount: sql`${10_000}::numeric`, status: 'COMPLETED', verifiedAt: new Date() })
      .returning();
    await expect(
      svc.refunds.requestRefund({ fundingId: foreign!.id, amount: 1_000, reason: 'Back to a funder in another company' }, s.mb),
    ).rejects.toThrow(/not in the same company/);
  });

  it('only funding marked Received, by its receiver, can be refunded', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const [sent] = await db
      .insert(schema.marketingFunding)
      .values({ senderId: s.hom.id, receiverId: s.mb.id, amount: sql`${5_000}::numeric`, status: 'SENT' })
      .returning();
    await expect(
      svc.refunds.requestRefund({ fundingId: sent!.id, amount: 1_000, reason: 'Not received yet but refunding' }, s.mb),
    ).rejects.toThrow(/Mark this funding Received/);
    await expect(
      svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 1_000, reason: 'Refunding somebody else funding' }, s.otherMb),
    ).rejects.toThrow(/only refund funding you received/);
  });

  it('reject and cancel release the hold', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const a = await svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 10_000, reason: 'First refund request here' }, s.mb);
    const b = await svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 20_000, reason: 'Second refund request here' }, s.mb);
    expect(await mbBalance(svc, s.mb.id)).toBe(70_000);
    await svc.refunds.reviewRefund({ refundId: a.id, action: 'REJECT', note: 'Keep it for next week please' }, s.hom);
    await svc.refunds.cancelRefund(b.id, s.mb);
    expect(await mbBalance(svc, s.mb.id)).toBe(100_000);
    await expect(
      svc.refunds.reviewRefund({ refundId: a.id, action: 'APPROVE' }, s.hom),
    ).rejects.toThrow(/already rejected/);
  });

  it('reversal is blocked once a refund exists on the funding', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 10_000, reason: 'Returning part of this one' }, s.mb);
    await expect(
      svc.reverseFunding({ fundingId: s.funding.id, reason: 'Sent to the wrong media buyer' }, s.admin as any, null),
    ).rejects.toThrow(/has a refund/);
  });

  it('refund of request-funded money posts the GL offset', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const [req] = await db
      .insert(schema.marketingFundingRequests)
      .values({ requesterId: s.mb.id, amount: sql`${50_000}::numeric`, status: 'APPROVED' })
      .returning();
    const [funded] = await db
      .insert(schema.marketingFunding)
      .values({
        senderId: s.hom.id, receiverId: s.mb.id, amount: sql`${50_000}::numeric`, status: 'COMPLETED',
        sourceFundingRequestId: req!.id, verifiedAt: new Date(),
      })
      .returning();
    const r = await svc.refunds.requestRefund({ fundingId: funded!.id, amount: 15_000, reason: 'Unused part of request' }, s.mb);
    await svc.refunds.reviewRefund({ refundId: r.id, action: 'APPROVE' }, s.hom);
    await svc.refunds.completeRefund(r.id, s.hom);
    expect(postMarketingFundingRefund).toHaveBeenCalledWith(r.id, req!.id, 15_000, { id: s.hom.id });
  });

  it('adjustments need a second approver and only count once approved', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const adj = await svc.refunds.createAdjustment(
      { userId: s.mb.id, direction: 'DEBIT', amount: 5_000, reason: 'Duplicate funding entry correction' },
      s.finance,
    );
    expect(await mbBalance(svc, s.mb.id)).toBe(100_000);
    await expect(
      svc.refunds.reviewAdjustment({ adjustmentId: adj.id, action: 'APPROVE' }, s.finance),
    ).rejects.toThrow(/other than the requester/);
    await svc.refunds.reviewAdjustment({ adjustmentId: adj.id, action: 'APPROVE' }, s.finance2);
    expect(await mbBalance(svc, s.mb.id)).toBe(95_000);
  });

  it('reconciliation: monthly carry-forward, refunds by direction, and the balance check', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await db.insert(schema.adSpendLogs).values([
      { mediaBuyerId: s.mb.id, spendAmount: sql`${30_000}::numeric`, spendDate: new Date('2026-09-10T10:00:00Z'), status: 'APPROVED' },
      { mediaBuyerId: s.mb.id, spendAmount: sql`${8_000}::numeric`, spendDate: new Date('2026-10-03T10:00:00Z'), status: 'PENDING' },
    ]);
    const r = await svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 20_000, reason: 'End of September return' }, s.mb);
    await svc.refunds.reviewRefund({ refundId: r.id, action: 'APPROVE' }, s.hom);
    await svc.refunds.completeRefund(r.id, s.hom);

    const sep = await svc.reconciliation.getReconciliation(
      { userId: s.mb.id, view: 'month', startDate: '2026-09-01', endDate: '2026-09-30' },
      s.finance,
      ctx,
    );
    expect(sep.summary).toMatchObject({ opening: '0', received: '100000', expenses: '30000', closing: '70000' });

    const all = await svc.reconciliation.getReconciliation({ userId: s.mb.id, view: 'all' }, s.finance, ctx);
    expect(all.toDate).toMatchObject({ received: '100000', expenses: '30000', refundsOut: '20000', closing: '50000', pendingExpenses: '8000', available: '42000' });
    expect(all.check.ok).toBe(true);
    expect(all.check.systemAvailable).toBe('42000');

    // The funder sees the same refund as money received back, not as new funding.
    const homAll = await svc.reconciliation.getReconciliation({ userId: s.hom.id, view: 'all' }, s.finance, ctx);
    expect(homAll.toDate).toMatchObject({ received: '1000000', distributed: '100000', refundsIn: '20000' });
    expect(homAll.check.ok).toBe(true);

    // Remaining per funding: the refund comes out of its own funding.
    const src = all.funders.find((f) => f.sourceId === s.funding.id)!;
    expect(src).toMatchObject({ amount: '100000', refunded: '20000', used: '30000', remaining: '50000' });
  });

  it('month close freezes figures; a later backdated expense shows as a prior-period correction', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await db.insert(schema.adSpendLogs).values({
      mediaBuyerId: s.mb.id, spendAmount: sql`${30_000}::numeric`, spendDate: new Date('2026-09-10T10:00:00Z'), status: 'APPROVED',
    });
    const closer = { ...s.finance, activeGroupId: s.branch.groupId } as SessionUser;
    // No close yet: Finance may start from any of the last 24 finished months.
    const before = await svc.reconciliation.listCloses(closer);
    expect(before.closes).toHaveLength(0);
    expect(before.closableMonths).toHaveLength(24);
    expect(before.closableMonths).toContain('2026-09');
    // The first close may be any finished month.
    await svc.reconciliation.closePeriod({ month: '2026-09' }, closer);
    await expect(svc.reconciliation.closePeriod({ month: '2026-09' }, closer)).rejects.toThrow(/already closed/);

    const frozen = await svc.reconciliation.getReconciliation(
      { userId: s.mb.id, view: 'month', startDate: '2026-09-01', endDate: '2026-09-30' }, closer, ctx,
    );
    expect(frozen.frozen).toBe(true);
    expect(frozen.summary.closing).toBe('70000');

    // After the close, an expense dated 20 September is logged.
    await db.insert(schema.adSpendLogs).values({
      mediaBuyerId: s.mb.id, spendAmount: sql`${5_000}::numeric`, spendDate: new Date('2026-09-20T10:00:00Z'), status: 'APPROVED',
    });

    const sepAgain = await svc.reconciliation.getReconciliation(
      { userId: s.mb.id, view: 'month', startDate: '2026-09-01', endDate: '2026-09-30' }, closer, ctx,
    );
    expect(sepAgain.summary.closing).toBe('70000'); // frozen, not silently changed
    expect(sepAgain.closedPeriod?.drift).toBe('-5000');
    expect(sepAgain.closedPeriod?.changedItems.map((c) => c.kind)).toContain('expense');

    const oct = await svc.reconciliation.getReconciliation(
      { userId: s.mb.id, view: 'month', startDate: '2026-10-01', endDate: '2026-10-31' }, closer, ctx,
    );
    expect(oct.summary).toMatchObject({ opening: '70000', corrections: '-5000', closing: '65000' });
    expect(oct.priorCorrection?.amount).toBe('-5000');
    // Months close in order: after September only October is offered.
    await expect(svc.reconciliation.closePeriod({ month: '2026-08' }, closer)).rejects.toThrow(/already closed/);
    expect((await svc.reconciliation.listCloses(closer)).closableMonths).toEqual(['2026-10']);
  });

  it('compare periods, and the row-by-row balance check', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await db.insert(schema.adSpendLogs).values([
      { mediaBuyerId: s.mb.id, spendAmount: sql`${30_000}::numeric`, spendDate: new Date('2026-09-10T10:00:00Z'), status: 'APPROVED' },
      { mediaBuyerId: s.mb.id, spendAmount: sql`${12_000}::numeric`, spendDate: new Date('2026-10-04T10:00:00Z'), status: 'APPROVED' },
    ]);
    const oct = await svc.reconciliation.getReconciliation(
      {
        userId: s.mb.id, view: 'month', startDate: '2026-10-01', endDate: '2026-10-31',
        compareStartDate: '2026-09-01', compareEndDate: '2026-09-30',
      },
      s.finance,
      ctx,
    );
    expect(oct.summary).toMatchObject({ opening: '70000', expenses: '12000', closing: '58000' });
    expect(oct.comparison?.summary).toMatchObject({ opening: '0', received: '100000', expenses: '30000', closing: '70000' });
    // Every row agrees with the displayed balance.
    expect(oct.check.ok).toBe(true);
    expect(oct.check.itemCount).toBe(0);
  });

  it('balance at request includes refunds and pending expenses', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await db.insert(schema.adSpendLogs).values({
      mediaBuyerId: s.mb.id, spendAmount: sql`${10_000}::numeric`, spendDate: new Date('2026-09-05T10:00:00Z'), status: 'PENDING',
      createdAt: new Date('2026-09-05T10:00:00Z'),
    } as any);
    await svc.refunds.requestRefund({ fundingId: s.funding.id, amount: 20_000, reason: 'Returning some before asking again' }, s.mb);
    await db.insert(schema.marketingFundingRequests).values({
      requesterId: s.mb.id, targetUserId: s.hom.id, amount: sql`${50_000}::numeric`, status: 'PENDING', createdAt: new Date(Date.now() + 1000),
    });
    const list = await svc.listFundingRequests({ page: 1, limit: 20, requesterId: s.mb.id }, null, null);
    const row = (list.records as Array<{ requesterId: string; balanceAtRequest: string | null }>).find((r) => r.requesterId === s.mb.id);
    // 100,000 - 10,000 pending expense - 20,000 held refund
    expect(Number(row?.balanceAtRequest)).toBe(70_000);
  });

  it('ledger access: a Media Buyer cannot open another Media Buyer ledger', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await expect(
      svc.reconciliation.getLedger(
        { userId: s.mb.id, entryType: 'all', page: 1, limit: 50 },
        { ...s.otherMb, permissions: ['marketing.read'] } as SessionUser,
        { currentBranchId: s.branch.id, effectiveBranchIds: [s.branch.id] },
      ),
    ).rejects.toThrow(/yourself or your team/);
    const own = await svc.reconciliation.getLedger({ userId: s.mb.id, entryType: 'all', page: 1, limit: 50 }, s.mb, ctx);
    expect(own.summary.closingBalance).toBe('100000');
  });
});
