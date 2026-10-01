/**
 * Integration: funding dispute -> reversal workflow (mig 0348).
 * Reversal flips the original to REVERSED (kept, never deleted), writes one linked
 * marketing_funding_reversals row, credits the sender back, and debits the receiver
 * only when they had been credited.
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

describe.skipIf(SKIP_IF_NO_DB)('Marketing funding — dispute reversal', () => {
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
  const reverseVoucher = vi.fn(async () => ({ reversed: true }));

  const mkMarketing = () =>
    new MarketingService(
      db as any,
      eventsStub,
      notificationsStub,
      new BranchTeamsService(db as any, createFakeCacheService()),
      settingsStub,
      { reverseVoucher } as any,
    );

  const balanceOf = (svc: MarketingService, userId: string): Promise<number> =>
    (svc as any).computeMbBalanceInTx(db, userId, null, null);

  /** Finance -> HoM (received) -> MB funding chain on one branch. */
  async function setup() {
    const branch = await createTestBranch(db as any);
    const admin = await createTestUser(db as any, { role: 'ADMIN' as any });
    const finance = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, admin.id);
    // HoM holds 3,000,000 received from Finance.
    await db.insert(schema.marketingFunding).values({
      senderId: finance.id,
      receiverId: hom.id,
      amount: sql`${3_000_000}::numeric`,
      status: 'COMPLETED',
    });
    const [erroneous] = await db
      .insert(schema.marketingFunding)
      .values({ senderId: hom.id, receiverId: mb.id, amount: sql`${2_500_000}::numeric`, status: 'SENT' })
      .returning();
    const adminActor = { id: admin.id, role: 'ADMIN' } as SessionUser;
    return { branch, admin, adminActor, hom, mb, funding: erroneous! };
  }

  beforeEach(async () => {
    enqueueCreate.mockClear();
    reverseVoucher.mockClear();
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  afterAll(async () => {
    await closeConnections();
  });

  it('reverses a DISPUTED funding: sender credited back, receiver untouched, original kept', async () => {
    const svc = mkMarketing();
    const { adminActor, hom, mb, funding, branch } = await setup();

    await svc.verifyFunding(
      { fundingId: funding.id, action: 'DISPUTED', disputeReason: 'I did not request this funding' },
      mb.id,
    );
    expect(await balanceOf(svc, hom.id)).toBe(500_000);
    expect(await balanceOf(svc, mb.id)).toBe(0);

    const res = await svc.reverseFunding(
      { fundingId: funding.id, reason: 'Sent to the wrong media buyer' },
      adminActor,
      [branch.id],
    );

    expect(await balanceOf(svc, hom.id)).toBe(3_000_000);
    expect(await balanceOf(svc, mb.id)).toBe(0);

    const [original] = await db.select().from(schema.marketingFunding).where(eq(schema.marketingFunding.id, funding.id));
    expect(original!.status).toBe('REVERSED');
    expect(original!.disputeReason).toBe('I did not request this funding');

    expect(res.reversal).toMatchObject({
      fundingId: funding.id,
      senderId: hom.id,
      receiverId: mb.id,
      previousStatus: 'DISPUTED',
      reason: 'Sent to the wrong media buyer',
      reversedBy: adminActor.id,
      receiverBalanceBefore: null,
    });
    expect(Number(res.reversal.amount)).toBe(2_500_000);
    expect(enqueueCreate).toHaveBeenCalledTimes(2);
  });

  it('refuses to reverse the same funding twice', async () => {
    const svc = mkMarketing();
    const { adminActor, funding, branch } = await setup();
    await svc.reverseFunding({ fundingId: funding.id, reason: 'Sent to the wrong media buyer' }, adminActor, [branch.id]);

    await expect(
      svc.reverseFunding({ fundingId: funding.id, reason: 'Second attempt at reversing' }, adminActor, [branch.id]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'This funding has already been reversed' });

    const reversals = await db
      .select()
      .from(schema.marketingFundingReversals)
      .where(eq(schema.marketingFundingReversals.fundingId, funding.id));
    expect(reversals).toHaveLength(1);
  });

  it('reverses a COMPLETED funding by debiting the receiver', async () => {
    const svc = mkMarketing();
    const { adminActor, hom, mb, funding, branch } = await setup();
    await svc.verifyFunding({ fundingId: funding.id, action: 'COMPLETED' }, mb.id);
    expect(await balanceOf(svc, mb.id)).toBe(2_500_000);

    const res = await svc.reverseFunding(
      { fundingId: funding.id, reason: 'Duplicate funding sent in error' },
      adminActor,
      [branch.id],
    );

    expect(await balanceOf(svc, mb.id)).toBe(0);
    expect(await balanceOf(svc, hom.id)).toBe(3_000_000);
    expect(res.reversal.previousStatus).toBe('COMPLETED');
    expect(Number(res.reversal.receiverBalanceBefore)).toBe(2_500_000);
  });

  it('blocks reversing more than the receiver still holds', async () => {
    const svc = mkMarketing();
    const { adminActor, mb, funding, branch } = await setup();
    await svc.verifyFunding({ fundingId: funding.id, action: 'COMPLETED' }, mb.id);
    await db.insert(schema.adSpendLogs).values({
      mediaBuyerId: mb.id,
      spendAmount: sql`${1_000_000}::numeric`,
      spendDate: new Date(),
      status: 'APPROVED',
    });

    await expect(
      svc.reverseFunding({ fundingId: funding.id, reason: 'Duplicate funding sent in error' }, adminActor, [branch.id]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const [row] = await db.select().from(schema.marketingFunding).where(eq(schema.marketingFunding.id, funding.id));
    expect(row!.status).toBe('COMPLETED');
  });

  it('hides funding outside the caller company (NOT_FOUND)', async () => {
    const svc = mkMarketing();
    const { adminActor, funding } = await setup();
    const otherBranch = await createTestBranch(db as any);

    await expect(
      svc.reverseFunding({ fundingId: funding.id, reason: 'Sent to the wrong media buyer' }, adminActor, [otherBranch.id]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('offsets the GL voucher when the funding came from an approved request', async () => {
    const svc = mkMarketing();
    const { adminActor, hom, mb, branch } = await setup();
    const [request] = await db
      .insert(schema.marketingFundingRequests)
      .values({ requesterId: mb.id, amount: sql`${100_000}::numeric`, status: 'APPROVED' })
      .returning();
    const [fromRequest] = await db
      .insert(schema.marketingFunding)
      .values({
        senderId: hom.id,
        receiverId: mb.id,
        amount: sql`${100_000}::numeric`,
        status: 'SENT',
        sourceFundingRequestId: request!.id,
      })
      .returning();

    await svc.reverseFunding({ fundingId: fromRequest!.id, reason: 'Approved the wrong request' }, adminActor, [branch.id]);
    expect(reverseVoucher).toHaveBeenCalledWith('EXPENSE', request!.id, { id: adminActor.id }, expect.any(String));
  });

  it('a late Mark Received cannot overwrite a reversal', async () => {
    const svc = mkMarketing();
    const { adminActor, mb, funding, branch } = await setup();
    await svc.reverseFunding({ fundingId: funding.id, reason: 'Sent to the wrong media buyer' }, adminActor, [branch.id]);

    await expect(svc.verifyFunding({ fundingId: funding.id, action: 'COMPLETED' }, mb.id)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'This funding was reversed back to the sender',
    });
    const [row] = await db.select().from(schema.marketingFunding).where(eq(schema.marketingFunding.id, funding.id));
    expect(row!.status).toBe('REVERSED');
  });

  it('fails closed when the company scope is unresolved ([])', async () => {
    const svc = mkMarketing();
    const { adminActor, funding } = await setup();
    await expect(
      svc.reverseFunding({ fundingId: funding.id, reason: 'Sent to the wrong media buyer' }, adminActor, []),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const list = await svc.listFundingDisputes({ status: 'SENT', page: 1, limit: 20 }, adminActor, null, []);
    expect(list.records).toHaveLength(0);
  });

  it('refuses to reverse a peer-transfer ledger row', async () => {
    const svc = mkMarketing();
    const { adminActor, mb, branch } = await setup();
    const mb2 = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values({ userId: mb2.id, branchId: branch.id, isPrimary: true });
    const [ledger] = await db
      .insert(schema.marketingFunding)
      .values({ senderId: mb.id, receiverId: mb2.id, amount: sql`${1_000}::numeric`, status: 'COMPLETED' })
      .returning();
    await db.insert(schema.mbFundTransfers).values({
      senderMbId: mb.id,
      receiverMbId: mb2.id,
      amount: sql`${1_000}::numeric`,
      status: 'ACCEPTED',
      ledgerEntryId: ledger!.id,
    });

    await expect(
      svc.reverseFunding({ fundingId: ledger!.id, reason: 'Peer transfer in error' }, adminActor, [branch.id]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('keeps reversed funding out of the default funding list and ALL count', async () => {
    const svc = mkMarketing();
    const { adminActor, hom, funding, branch } = await setup();
    await svc.reverseFunding({ fundingId: funding.id, reason: 'Sent to the wrong media buyer' }, adminActor, [branch.id]);

    const list = await svc.listFunding({ senderId: hom.id, page: 1, limit: 20 } as any, null, [branch.id]);
    expect(list.records.map((r) => r.id)).not.toContain(funding.id);
    const counts = await svc.fundingStatusCounts({ senderId: hom.id } as any, null, [branch.id]);
    expect(counts.ALL).toBe(counts.SENT + counts.COMPLETED + counts.DISPUTED);
  });

  it('lists disputes with the reason, then the reversal record once reversed', async () => {
    const svc = mkMarketing();
    const { adminActor, mb, funding, branch } = await setup();
    await svc.verifyFunding(
      { fundingId: funding.id, action: 'DISPUTED', disputeReason: 'I did not request this funding' },
      mb.id,
    );

    const disputed = await svc.listFundingDisputes({ status: 'DISPUTED', page: 1, limit: 20 }, adminActor, null, [branch.id]);
    expect(disputed.records.map((r) => r.id)).toEqual([funding.id]);
    expect(disputed.records[0]!.disputeReason).toBe('I did not request this funding');
    expect(disputed.statusCounts.DISPUTED).toBe(1);

    await svc.reverseFunding({ fundingId: funding.id, reason: 'Sent to the wrong media buyer' }, adminActor, [branch.id]);

    const reversed = await svc.listFundingDisputes({ status: 'REVERSED', page: 1, limit: 20 }, adminActor, null, [branch.id]);
    expect(reversed.records).toHaveLength(1);
    expect(reversed.records[0]).toMatchObject({
      id: funding.id,
      status: 'REVERSED',
      reversalReason: 'Sent to the wrong media buyer',
      reversalPreviousStatus: 'DISPUTED',
    });
    expect(reversed.statusCounts).toMatchObject({ DISPUTED: 0, REVERSED: 1 });

    const flow = await svc.getFundingFlow({ transferId: funding.id }, { id: adminActor.id, role: 'SUPER_ADMIN' });
    expect(flow.events.map((e) => e.kind)).toEqual(['sent', 'disputed', 'reversed']);
  });
});
