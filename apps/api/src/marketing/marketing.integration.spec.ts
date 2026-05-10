/**
 * Integration: approving a funding request creates a matching marketing_funding ledger row.
 * Requires DB migrations through 0070 (source_funding_request_id column).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import {
  createTestUser,
  createTestBranch,
  createTestProduct,
  insertTestBranchTeam,
} from '../test/factories/order.factory';
import { MarketingService } from './marketing.service';
import { BranchTeamsService } from '../branches/branch-teams.service';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Marketing funding — approve creates ledger', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const eventsStub = {
    emitToUser: () => undefined,
    emitToRoom: () => undefined,
  } as unknown as EventsService;

  const notificationsStub = {
    create: async () => undefined,
    createForRole: async () => undefined,
  } as unknown as NotificationsService;

  // Returns null so MarketingService falls back to default profitability config (target=3, threshold=2.5).
  const settingsStub = {
    get: async () => null,
  } as unknown as SettingsService;

  const mkMarketing = () =>
    new MarketingService(
      db as any,
      eventsStub,
      notificationsStub,
      new BranchTeamsService(db as any),
      settingsStub,
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

  it('inserts marketing_funding with source_funding_request_id when HoM approves MB request', async () => {
    const branch = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });

    // Branch isolation guard requires both approver and requester to be members
    // of the active branch unless the caller is admin-class in global mode.
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, hom.id);

    const [req] = await db
      .insert(schema.marketingFundingRequests)
      .values({
        requesterId: mb.id,
        amount: '50000.00',
        status: 'PENDING',
        reason: 'Integration test request',
      })
      .returning({ id: schema.marketingFundingRequests.id });

    const requestId = req!.id;

    const finance = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });
    await db.insert(schema.userBranches).values([
      { userId: finance.id, branchId: branch.id, isPrimary: true },
    ]);
    await db.insert(schema.marketingFunding).values({
      senderId: finance.id,
      receiverId: hom.id,
      amount: '200000.00',
      receiptUrl: 'https://example.com/inbound.png',
      status: 'COMPLETED',
    });

    const svc = mkMarketing();
    await svc.approveFundingRequest(
      requestId,
      50000,
      'https://example.com/receipt-test.png',
      { id: hom.id, role: 'HEAD_OF_MARKETING' },
      branch.id,
    );

    const [ledger] = await db
      .select({
        id: schema.marketingFunding.id,
        senderId: schema.marketingFunding.senderId,
        receiverId: schema.marketingFunding.receiverId,
        amount: schema.marketingFunding.amount,
        status: schema.marketingFunding.status,
        sourceFundingRequestId: schema.marketingFunding.sourceFundingRequestId,
      })
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.sourceFundingRequestId, requestId));

    expect(ledger).toBeDefined();
    expect(ledger!.senderId).toBe(hom.id);
    expect(ledger!.receiverId).toBe(mb.id);
    expect(ledger!.status).toBe('SENT');
    expect(ledger!.sourceFundingRequestId).toBe(requestId);
    expect(Number(ledger!.amount)).toBe(50000);

    const [reqAfter] = await db
      .select({ status: schema.marketingFundingRequests.status, amount: schema.marketingFundingRequests.amount })
      .from(schema.marketingFundingRequests)
      .where(eq(schema.marketingFundingRequests.id, requestId));
    expect(reqAfter!.status).toBe('APPROVED');
    expect(Number(reqAfter!.amount)).toBe(50000);
  });

  it('approveFundingRequest stamps partial amount on request and ledger', async () => {
    const branch = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const finance = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
      { userId: finance.id, branchId: branch.id, isPrimary: true },
    ]);
    await db.insert(schema.marketingFunding).values({
      senderId: finance.id,
      receiverId: hom.id,
      amount: '100000.00',
      receiptUrl: 'https://x.test/in.png',
      status: 'COMPLETED',
    });
    await setSessionActor(pgClient, hom.id);

    const [req] = await db
      .insert(schema.marketingFundingRequests)
      .values({
        requesterId: mb.id,
        amount: '80000.00',
        status: 'PENDING',
        reason: 'Partial approve test',
      })
      .returning({ id: schema.marketingFundingRequests.id });

    await mkMarketing().approveFundingRequest(
      req!.id,
      40000,
      'https://x.test/rec-partial.png',
      { id: hom.id, role: 'HEAD_OF_MARKETING' },
      branch.id,
    );

    const [ledger] = await db
      .select({ amount: schema.marketingFunding.amount })
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.sourceFundingRequestId, req!.id));
    const [reqRow] = await db
      .select({ amount: schema.marketingFundingRequests.amount })
      .from(schema.marketingFundingRequests)
      .where(eq(schema.marketingFundingRequests.id, req!.id));
    expect(Number(ledger!.amount)).toBe(40000);
    expect(Number(reqRow!.amount)).toBe(40000);
  });

  it('approveFundingRequest rejects HoM when disbursable balance is insufficient', async () => {
    const branch = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, hom.id);

    const [req] = await db
      .insert(schema.marketingFundingRequests)
      .values({
        requesterId: mb.id,
        amount: '10000.00',
        status: 'PENDING',
        reason: 'No liquidity',
      })
      .returning({ id: schema.marketingFundingRequests.id });

    await expect(
      mkMarketing().approveFundingRequest(
        req!.id,
        10000,
        'https://x.test/r.png',
        { id: hom.id, role: 'HEAD_OF_MARKETING' },
        branch.id,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('Insufficient marketing funding balance'),
    });
  });

  // ---------------------------------------------------------------------------
  // Branch isolation: createFunding + approveFundingRequest reject cross-branch
  // transfers unless the caller is admin-class in global mode (currentBranchId = NULL).
  // ---------------------------------------------------------------------------

  it('createFunding rejects cross-branch transfer with FORBIDDEN', async () => {
    const lagos = await createTestBranch(db as any);
    const main = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mbMain = await createTestUser(db as any, { role: 'MEDIA_BUYER' });

    // HoM is on Lagos, MB is on Main — different branches.
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: lagos.id, isPrimary: true },
      { userId: mbMain.id, branchId: main.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, hom.id, lagos.id);

    const svc = mkMarketing();
    await expect(
      svc.createFunding(
        { receiverId: mbMain.id, amount: 50000, receiptUrl: 'https://x.test/r.png' },
        { id: hom.id, role: 'HEAD_OF_MARKETING' },
        lagos.id,
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('not a member'),
    });
  });

  it('createFunding allows same-branch transfer', async () => {
    const branch = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const finance = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });

    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
      { userId: finance.id, branchId: branch.id, isPrimary: true },
    ]);
    await db.insert(schema.marketingFunding).values({
      senderId: finance.id,
      receiverId: hom.id,
      amount: '100000.00',
      receiptUrl: 'https://x.test/in.png',
      status: 'COMPLETED',
    });
    await setSessionActor(pgClient, hom.id, branch.id);

    const svc = mkMarketing();
    await expect(
      svc.createFunding(
        { receiverId: mb.id, amount: 25000, receiptUrl: 'https://x.test/r.png' },
        { id: hom.id, role: 'HEAD_OF_MARKETING' },
        branch.id,
      ),
    ).resolves.toBeDefined();
  });

  it('createFunding rejects HoM when disbursable balance is insufficient', async () => {
    const branch = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, hom.id, branch.id);

    await expect(
      mkMarketing().createFunding(
        { receiverId: mb.id, amount: 5000, receiptUrl: 'https://x.test/r.png' },
        { id: hom.id, role: 'HEAD_OF_MARKETING' },
        branch.id,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('Insufficient marketing funding balance'),
    });
  });

  it('createFunding allows SuperAdmin scoped to a branch without user_branches row (receiver on branch)', async () => {
    const branch = await createTestBranch(db as any);
    const admin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    await db.insert(schema.userBranches).values([{ userId: hom.id, branchId: branch.id, isPrimary: true }]);
    // admin deliberately has no user_branches row

    const svc = mkMarketing();
    await expect(
      svc.createFunding(
        { receiverId: hom.id, amount: 12000, receiptUrl: 'https://x.test/r2.png' },
        { id: admin.id, role: 'SUPER_ADMIN' },
        branch.id,
      ),
    ).resolves.toBeDefined();
  });

  it('createFunding allows admin in global mode (currentBranchId = NULL) cross-branch', async () => {
    const lagos = await createTestBranch(db as any);
    const main = await createTestBranch(db as any);
    const admin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    const mbMain = await createTestUser(db as any, { role: 'MEDIA_BUYER' });

    await db.insert(schema.userBranches).values([
      { userId: mbMain.id, branchId: main.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, admin.id, null);

    const svc = mkMarketing();
    await expect(
      svc.createFunding(
        { receiverId: mbMain.id, amount: 75000, receiptUrl: 'https://x.test/r.png' },
        { id: admin.id, role: 'SUPER_ADMIN' },
        null,
      ),
    ).resolves.toBeDefined();
    // Suppress unused-var lint for `lagos` — used to seed both-branch context.
    expect(lagos.id).toBeTruthy();
  });

  it('createFunding rejects non-admin with no active branch (BAD_REQUEST)', async () => {
    const branch = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, hom.id, null);

    const svc = mkMarketing();
    await expect(
      svc.createFunding(
        { receiverId: mb.id, amount: 10000, receiptUrl: 'https://x.test/r.png' },
        { id: hom.id, role: 'HEAD_OF_MARKETING' },
        null,
      ),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('No active branch'),
    });
  });

  it('approveFundingRequest allows SuperAdmin scoped to branch without user_branches (requester on branch)', async () => {
    const branch = await createTestBranch(db as any);
    const admin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([{ userId: mb.id, branchId: branch.id, isPrimary: true }]);

    const [req] = await db
      .insert(schema.marketingFundingRequests)
      .values({
        requesterId: mb.id,
        amount: '30000.00',
        status: 'PENDING',
        reason: 'Admin approve test',
      })
      .returning({ id: schema.marketingFundingRequests.id });

    const svc = mkMarketing();
    await expect(
      svc.approveFundingRequest(
        req!.id,
        30000,
        'https://x.test/rec.png',
        { id: admin.id, role: 'SUPER_ADMIN' },
        branch.id,
      ),
    ).resolves.toBeDefined();
  });

  it('approveFundingRequest rejects cross-branch approver/requester pair', async () => {
    const lagos = await createTestBranch(db as any);
    const main = await createTestBranch(db as any);
    const hom = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mbMain = await createTestUser(db as any, { role: 'MEDIA_BUYER' });

    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: lagos.id, isPrimary: true },
      { userId: mbMain.id, branchId: main.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, hom.id, lagos.id);

    const [req] = await db
      .insert(schema.marketingFundingRequests)
      .values({
        requesterId: mbMain.id,
        amount: '50000.00',
        status: 'PENDING',
        reason: 'Cross-branch test',
      })
      .returning({ id: schema.marketingFundingRequests.id });

    const svc = mkMarketing();
    await expect(
      svc.approveFundingRequest(
        req!.id,
        50000,
        'https://x.test/r.png',
        { id: hom.id, role: 'HEAD_OF_MARKETING' },
        lagos.id,
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.stringContaining('not a member'),
    });
  });

  it('createFunding allows branch marketing supervisor (MEDIA_BUYER) to supervised MEDIA_BUYER', async () => {
    const branch = await createTestBranch(db as any);
    const supMb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const recvMb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const finance = await createTestUser(db as any, { role: 'FINANCE_OFFICER' });
    await db.insert(schema.userBranches).values([
      { userId: supMb.id, branchId: branch.id, isPrimary: true },
      { userId: recvMb.id, branchId: branch.id, isPrimary: true },
      { userId: finance.id, branchId: branch.id, isPrimary: true },
    ]);
    await db.insert(schema.marketingFunding).values({
      senderId: finance.id,
      receiverId: supMb.id,
      amount: '50000.00',
      receiptUrl: 'https://x.test/in-sup.png',
      status: 'COMPLETED',
    });
    const team = await insertTestBranchTeam(db as any, branch.id, 'MARKETING', 'MB squad');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: team!.id, userId: supMb.id, isSupervisor: true },
      { teamId: team!.id, userId: recvMb.id, isSupervisor: false },
    ]);
    await setSessionActor(pgClient, supMb.id);

    const row = await mkMarketing().createFunding(
      { receiverId: recvMb.id, amount: 5000, receiptUrl: 'https://x.test/supervisor.png' },
      { id: supMb.id, role: 'MEDIA_BUYER' },
      branch.id,
    );
    expect(row.receiverId).toBe(recvMb.id);
    expect(row.senderId).toBe(supMb.id);
  });
});

describe.skipIf(SKIP_IF_NO_DB)('Marketing supervisor — funding balances + ad spend', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const eventsStub = {
    emitToUser: () => undefined,
    emitToRoom: () => undefined,
  } as unknown as EventsService;

  const notificationsStub = {
    create: async () => undefined,
    createForRole: async () => undefined,
  } as unknown as NotificationsService;

  const settingsStub = {
    get: async () => null,
  } as unknown as SettingsService;

  const mkMarketing = () =>
    new MarketingService(
      db as never,
      eventsStub,
      notificationsStub,
      new BranchTeamsService(db as never),
      settingsStub,
    );

  function sessionUser(p: {
    id: string;
    role: string;
    branchId: string;
    permissions?: string[];
  }): SessionUser {
    return {
      id: p.id,
      email: `u-${p.id.slice(0, 8)}@test.local`,
      name: 'Test',
      role: p.role,
      logisticsLocationId: null,
      permissions: p.permissions ?? [],
      currentBranchId: p.branchId,
      branchIds: [p.branchId],
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

  it('listFundingBalances excludes non-supervised MBs for branch marketing supervisor', async () => {
    const branch = await createTestBranch(db as never);
    const supMb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    const recvMb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    const otherMb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: supMb.id, branchId: branch.id, isPrimary: true },
      { userId: recvMb.id, branchId: branch.id, isPrimary: true },
      { userId: otherMb.id, branchId: branch.id, isPrimary: true },
    ]);
    const team = await insertTestBranchTeam(db as never, branch.id, 'MARKETING', 'MB squad');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: team!.id, userId: supMb.id, isSupervisor: true },
      { teamId: team!.id, userId: recvMb.id, isSupervisor: false },
    ]);

    const balances = await mkMarketing().listFundingBalances(
      { id: supMb.id, role: 'MEDIA_BUYER', permissions: [] },
      branch.id,
    );
    const ids = new Set(balances.map((b) => b.userId));
    expect(ids.has(supMb.id)).toBe(true);
    expect(ids.has(recvMb.id)).toBe(true);
    expect(ids.has(otherMb.id)).toBe(false);
  });

  it('approveAdSpend allows marketing supervisor for supervisee row only', async () => {
    const branch = await createTestBranch(db as never);
    const supMb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    const recvMb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    const strangerMb = await createTestUser(db as never, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: supMb.id, branchId: branch.id, isPrimary: true },
      { userId: recvMb.id, branchId: branch.id, isPrimary: true },
      { userId: strangerMb.id, branchId: branch.id, isPrimary: true },
    ]);
    const team = await insertTestBranchTeam(db as never, branch.id, 'MARKETING', 'MB squad 2');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: team!.id, userId: supMb.id, isSupervisor: true },
      { teamId: team!.id, userId: recvMb.id, isSupervisor: false },
    ]);

    const product = await createTestProduct(db as never);
    const [recvCampaign] = await db
      .insert(schema.campaigns)
      .values({
        mediaBuyerId: recvMb.id,
        name: 'Recv camp',
        branchId: branch.id,
        productIds: [product.id],
      })
      .returning({ id: schema.campaigns.id });
    const [strangerCampaign] = await db
      .insert(schema.campaigns)
      .values({
        mediaBuyerId: strangerMb.id,
        name: 'Stranger camp',
        branchId: branch.id,
        productIds: [product.id],
      })
      .returning({ id: schema.campaigns.id });

    const [goodSpend] = await db
      .insert(schema.adSpendLogs)
      .values({
        mediaBuyerId: recvMb.id,
        productId: product.id,
        campaignId: recvCampaign!.id,
        spendAmount: '100',
        screenshotUrl: 'https://x.test/g.png',
        spendDate: new Date(),
        status: 'PENDING',
      })
      .returning({ id: schema.adSpendLogs.id });
    const [badSpend] = await db
      .insert(schema.adSpendLogs)
      .values({
        mediaBuyerId: strangerMb.id,
        productId: product.id,
        campaignId: strangerCampaign!.id,
        spendAmount: '200',
        screenshotUrl: 'https://x.test/b.png',
        spendDate: new Date(),
        status: 'PENDING',
      })
      .returning({ id: schema.adSpendLogs.id });

    await setSessionActor(pgClient, supMb.id, branch.id);
    const svc = mkMarketing();
    const supActor = sessionUser({ id: supMb.id, role: 'MEDIA_BUYER', branchId: branch.id });

    const approved = await svc.approveAdSpend(goodSpend!.id, supActor);
    expect(approved.status).toBe('APPROVED');

    await expect(svc.approveAdSpend(badSpend!.id, supActor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
