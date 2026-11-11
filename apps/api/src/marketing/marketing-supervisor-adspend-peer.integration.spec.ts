/**
 * Integration: team supervisors (HoM request 2026-11-11).
 *
 * 1. A marketing team supervisor approves / rejects their team's ad spend on
 *    any branch and any top-bar selection, never their own and never another
 *    team's.
 * 2. A supervisor can send a peer transfer to any marketer in their company
 *    (any branch). The Head of Marketing approves; the receiver accepts.
 * 3. Approving a peer transfer is restricted: never the sender, never the
 *    receiver short-circuiting it, never someone outside the company.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestBranch, insertTestBranchTeam } from '../test/factories/order.factory';
import { MarketingService } from './marketing.service';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { createFakeCacheService } from '../test/fake-cache';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Marketing team supervisors: ad spend approval and peer transfers', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const eventsStub = { emitToUser: () => undefined, emitToRoom: () => undefined } as unknown as EventsService;
  const notificationsStub = {
    create: async () => undefined,
    createForRole: async () => undefined,
    enqueueCreate: () => undefined,
    enqueueCreateForRole: () => undefined,
  } as unknown as NotificationsService;
  const settingsStub = { get: async () => null } as unknown as SettingsService;
  const teams = () => new BranchTeamsService(db as any, createFakeCacheService());
  const mkMarketing = () =>
    new MarketingService(db as any, eventsStub, notificationsStub, teams(), settingsStub, {} as any);

  const actor = (u: { id: string }, role: string, extra: Partial<SessionUser> = {}) =>
    ({ id: u.id, role, name: role, permissions: [], currentBranchId: null, ...extra }) as unknown as SessionUser;

  /**
   * Company 1: branches A and B. Supervisor S1 leads a team on A with MB1.
   * MB1's primary branch is B (the old rule refused this). Supervisor S2 leads
   * a team on B. MB2 is on A but not on S1's team. Company 2: branch C, MB3.
   */
  async function setup() {
    const branchA = await createTestBranch(db as any);
    const [a] = await db.select({ groupId: schema.branches.groupId }).from(schema.branches).where(eq(schema.branches.id, branchA.id));
    const branchB = await createTestBranch(db as any, { groupId: a!.groupId! });
    const branchC = await createTestBranch(db as any);

    const admin = await createTestUser(db as any, { role: 'ADMIN' as any });
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const s1 = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const s2 = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const mb1 = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const mb2 = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const mb3 = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const cs = await createTestUser(db as any, { role: 'CS_CLOSER' as any });
    await setSessionActor(pgClient, admin.id);

    await db.update(schema.users).set({ primaryBranchId: branchB.id }).where(eq(schema.users.id, mb1.id));
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branchA.id, isPrimary: true },
      { userId: s1.id, branchId: branchA.id, isPrimary: true },
      { userId: s2.id, branchId: branchB.id, isPrimary: true },
      { userId: mb1.id, branchId: branchB.id, isPrimary: true },
      { userId: mb2.id, branchId: branchA.id, isPrimary: true },
      { userId: mb3.id, branchId: branchC.id, isPrimary: true },
      { userId: cs.id, branchId: branchA.id, isPrimary: true },
    ]);

    const teamA = await insertTestBranchTeam(db as any, branchA.id, 'MARKETING', 'Team S1');
    const teamB = await insertTestBranchTeam(db as any, branchB.id, 'MARKETING', 'Team S2');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: teamA!.id, userId: s1.id, isSupervisor: true },
      { teamId: teamA!.id, userId: mb1.id, isSupervisor: false },
      { teamId: teamB!.id, userId: s2.id, isSupervisor: true },
    ]);

    // S1 holds 200,000 to send peer transfers from.
    await db.insert(schema.marketingFunding).values({
      senderId: hom.id,
      receiverId: s1.id,
      amount: sql`${200_000}::numeric`,
      status: 'COMPLETED',
      sentAt: new Date(),
      verifiedAt: new Date(),
    });

    const spend = async (mediaBuyerId: string) => {
      const [row] = await db
        .insert(schema.adSpendLogs)
        .values({ mediaBuyerId, spendAmount: sql`${10_000}::numeric`, spendDate: new Date(), status: 'PENDING' })
        .returning();
      return row!;
    };

    return {
      branchA,
      branchB,
      spend,
      admin: actor(admin, 'ADMIN'),
      hom: actor(hom, 'HEAD_OF_MARKETING'),
      // On "All branches": no current branch. The old rule refused every approval here.
      s1: actor(s1, 'MEDIA_BUYER', { isMarketingTeamSupervisorOnActiveBranch: true } as Partial<SessionUser>),
      s2: actor(s2, 'MEDIA_BUYER', { isMarketingTeamSupervisorOnActiveBranch: true } as Partial<SessionUser>),
      mb1: actor(mb1, 'MEDIA_BUYER'),
      mb2: actor(mb2, 'MEDIA_BUYER'),
      mb3: actor(mb3, 'MEDIA_BUYER'),
      cs: actor(cs, 'CS_CLOSER'),
    };
  }

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });
  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });
  afterAll(async () => {
    await closeConnections();
  });

  // ── Ad spend ────────────────────────────────────────────────────────────

  it('a supervisor approves and rejects their team member’s ad spend on any branch selection', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const one = await s.spend(s.mb1.id);
    const two = await s.spend(s.mb1.id);

    const approved = await svc.approveAdSpend(one.id, s.s1);
    expect(approved.status).toBe('APPROVED');
    expect(approved.approvedBy).toBe(s.s1.id);

    const rejected = await svc.rejectAdSpend(two.id, 'Wrong amount entered', { ...s.s1, currentBranchId: s.branchA.id } as SessionUser);
    expect(rejected.status).toBe('REJECTED');
  });

  it('a supervisor cannot approve their own ad spend', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const own = await s.spend(s.s1.id);
    await expect(svc.approveAdSpend(own.id, s.s1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('a supervisor cannot approve ad spend of someone outside their team', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const other = await s.spend(s.mb2.id);
    await expect(svc.approveAdSpend(other.id, s.s1)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // A plain Media Buyer can never approve.
    const teamRow = await s.spend(s.mb1.id);
    await expect(svc.approveAdSpend(teamRow.id, s.mb2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('the team lookup covers every branch and never includes the supervisor', async () => {
    const s = await setup();
    const ids = await teams().listMarketingSuperviseeIdsAnywhere(s.s1.id);
    expect(ids).toEqual([s.mb1.id]);
    expect(await teams().isMarketingTeamSupervisorAnywhere(s.s2.id)).toBe(true);
    expect(await teams().isMarketingTeamSupervisorAnywhere(s.mb1.id)).toBe(false);
  });

  // ── Peer transfers ──────────────────────────────────────────────────────

  it('supervisor to supervisor on another branch: HoM approves, receiver accepts, money moves', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const transfer = (await svc.createMbFundTransfer(
      { receiverMbId: s.s2.id, amount: 50_000, reason: 'Cover weekend spend' },
      s.s1,
      null,
      null,
    )) as any;
    expect(transfer.status).toBe('PENDING');
    expect(transfer.branchId).toBe(s.branchA.id); // sender's branch, for the HoM inbox

    // Neither party can approve it themselves.
    await expect(svc.approveMbFundTransfer(transfer.id, s.s1, null, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.approveMbFundTransfer(transfer.id, s.s2, null, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await svc.approveMbFundTransfer(transfer.id, s.hom, null, null);
    await svc.acceptMbFundTransfer(transfer.id, s.s2, null, null);

    const [row] = await db.select().from(schema.mbFundTransfers).where(eq(schema.mbFundTransfers.id, transfer.id));
    expect(row!.status).toBe('ACCEPTED');
    const balance = (id: string): Promise<number> => (svc as any).computeMbBalanceInTx(db, id, null, null);
    expect(await balance(s.s1.id)).toBe(150_000);
    expect(await balance(s.s2.id)).toBe(50_000);
  });

  // One refused call per test: a refused write rolls back this harness's setup rows.
  it('a supervisor cannot send to another company', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await expect(
      svc.createMbFundTransfer({ receiverMbId: s.mb3.id, amount: 1_000 }, s.s1, null, null),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('same company') });
  });

  it('a supervisor cannot send to a non-marketing user', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await expect(
      svc.createMbFundTransfer({ receiverMbId: s.cs.id, amount: 1_000 }, s.s1, null, null),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('a plain Media Buyer keeps the same-branch rule', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await setSessionActor(pgClient, s.admin.id);
    await db.insert(schema.marketingFunding).values({
      senderId: s.hom.id,
      receiverId: s.mb2.id,
      amount: sql`${10_000}::numeric`,
      status: 'COMPLETED',
      sentAt: new Date(),
      verifiedAt: new Date(),
    });
    await expect(
      svc.createMbFundTransfer({ receiverMbId: s.s2.id, amount: 1_000 }, s.mb2, s.branchA.id, [s.branchA.id]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('same branch') });
  });

  it('a plain Media Buyer cannot send to a non-marketing user on their branch', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await setSessionActor(pgClient, s.admin.id);
    await db.insert(schema.marketingFunding).values({
      senderId: s.hom.id,
      receiverId: s.mb2.id,
      amount: sql`${10_000}::numeric`,
      status: 'COMPLETED',
      sentAt: new Date(),
      verifiedAt: new Date(),
    });
    await expect(
      svc.createMbFundTransfer({ receiverMbId: s.cs.id, amount: 1_000 }, s.mb2, s.branchA.id, [s.branchA.id]),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining('Media Buyer') });
  });

  it('branch recipient list only offers marketers', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const ids = (await svc.listBranchMembersForTransfer(s.branchA.id)).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([s.s1.id, s.mb2.id, s.hom.id]));
    expect(ids).not.toContain(s.cs.id);
  });

  it('a receiver cannot approve a transfer into their own balance', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const transfer = (await svc.createMbFundTransfer({ receiverMbId: s.mb2.id, amount: 5_000 }, s.s1, null, null)) as any;
    await expect(svc.approveMbFundTransfer(transfer.id, s.mb2, null, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // An unrelated Media Buyer cannot approve either.
    await expect(svc.approveMbFundTransfer(transfer.id, s.mb1, null, null)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [row] = await db.select().from(schema.mbFundTransfers).where(eq(schema.mbFundTransfers.id, transfer.id));
    expect(row!.status).toBe('PENDING');
  });

  it('the Head of Marketing can reject a pending transfer from the approval inbox', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const transfer = (await svc.createMbFundTransfer({ receiverMbId: s.s2.id, amount: 5_000 }, s.s1, null, null)) as any;
    await svc.rejectMbFundTransfer(transfer.id, 'Not needed this week', s.hom);
    const [row] = await db.select().from(schema.mbFundTransfers).where(eq(schema.mbFundTransfers.id, transfer.id));
    expect(row!.status).toBe('REJECTED');
    expect(row!.rejectedBy).toBe(s.hom.id);
  });

  it('Finance cannot approve a peer transfer', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const fin = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });
    const transfer = (await svc.createMbFundTransfer({ receiverMbId: s.s2.id, amount: 5_000 }, s.s1, null, null)) as any;
    await expect(
      svc.approveMbFundTransfer(transfer.id, actor(fin, 'FINANCE_OFFICER'), null, null),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an outsider cannot reject someone else\'s transfer', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const transfer = (await svc.createMbFundTransfer({ receiverMbId: s.s2.id, amount: 5_000 }, s.s1, null, null)) as any;
    await expect(svc.rejectMbFundTransfer(transfer.id, 'Not mine to reject', s.mb2)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('approval inbox: a supervisor sees only transfers between their own team members', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await setSessionActor(pgClient, s.admin.id);
    // MB2 joins S1's team, so MB1 -> MB2 is an in-team transfer S1 may approve.
    const [teamA] = await db
      .select({ teamId: schema.branchTeamMembers.teamId })
      .from(schema.branchTeamMembers)
      .where(eq(schema.branchTeamMembers.userId, s.s1.id));
    await db.insert(schema.branchTeamMembers).values({ teamId: teamA!.teamId, userId: s.mb2.id, isSupervisor: false });
    const pending = async (from: string, to: string) => {
      const [row] = await db
        .insert(schema.mbFundTransfers)
        .values({ senderMbId: from, receiverMbId: to, amount: sql`${1_000}::numeric`, branchId: s.branchA.id })
        .returning();
      return row!.id;
    };
    const inTeam = await pending(s.mb1.id, s.mb2.id);
    const toOtherTeam = await pending(s.mb1.id, s.s2.id);

    const inbox = { direction: 'pending_approval', page: 1, limit: 50 };
    const ids = async (...args: [string, string, string[] | undefined]) =>
      ((await svc.listMbFundTransfers(inbox, args[0], args[1], null, null, args[2])) as any).transfers.map(
        (t: { id: string }) => t.id,
      );

    const team = await teams().listMarketingSuperviseeIdsAnywhere(s.s1.id);
    expect(await ids(s.s1.id, 'MEDIA_BUYER', team)).toEqual([inTeam]);
    // A plain Media Buyer approves nothing, so their inbox is empty.
    expect(await ids(s.mb2.id, 'MEDIA_BUYER', [])).toEqual([]);
    // The Head of Marketing still sees both.
    expect(await ids(s.hom.id, 'HEAD_OF_MARKETING', undefined)).toEqual(expect.arrayContaining([inTeam, toOtherTeam]));
  });

  it('other expenses summary counts only the Media Buyers passed in', async () => {
    const svc = mkMarketing();
    const s = await setup();
    await setSessionActor(pgClient, s.admin.id);
    const other = (mediaBuyerId: string, amount: number) =>
      db.insert(schema.adSpendLogs).values({
        mediaBuyerId,
        spendAmount: sql`${amount}::numeric`,
        spendDate: new Date(),
        status: 'PENDING',
        category: 'UGC_PRODUCTION',
      });
    await other(s.mb1.id, 3_000);
    await other(s.mb3.id, 7_000);
    const summary = await svc.getOtherExpensesSummary({ mediaBuyerIds: [s.s1.id, s.mb1.id] }, null, null);
    expect(summary.PENDING).toBe(1);
    expect(summary.pendingSpend).toBe(3_000);
  });

  it('recipient list for a supervisor: company marketers on every branch, nobody else', async () => {
    const svc = mkMarketing();
    const s = await setup();
    const ids = (await svc.listCompanyMarketersForTransfer(s.s1.id)).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([s.s2.id, s.mb1.id, s.mb2.id, s.hom.id]));
    expect(ids).not.toContain(s.s1.id);
    expect(ids).not.toContain(s.mb3.id);
    expect(ids).not.toContain(s.cs.id);
  });
});
