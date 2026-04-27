/**
 * Integration: approving a funding request creates a matching marketing_funding ledger row.
 * Requires DB migrations through 0070 (source_funding_request_id column).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestBranch } from '../test/factories/order.factory';
import { MarketingService } from './marketing.service';
import { BranchTeamsService } from '../branches/branch-teams.service';
import type { EventsService } from '../events/events.service';
import type { NotificationsService } from '../notifications/notifications.service';

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

  const mkMarketing = () =>
    new MarketingService(db as any, eventsStub, notificationsStub, new BranchTeamsService(db as any));

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

    const svc = mkMarketing();
    await svc.approveFundingRequest(
      requestId,
      'https://example.com/receipt-test.png',
      { id: hom.id, role: 'HEAD_OF_MARKETING' },
      branch.id,
    );

    const [ledger] = await db
      .select({
        id: schema.marketingFunding.id,
        senderId: schema.marketingFunding.senderId,
        receiverId: schema.marketingFunding.receiverId,
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

    const [reqAfter] = await db
      .select({ status: schema.marketingFundingRequests.status })
      .from(schema.marketingFundingRequests)
      .where(eq(schema.marketingFundingRequests.id, requestId));
    expect(reqAfter!.status).toBe('APPROVED');
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

    await db.insert(schema.userBranches).values([
      { userId: hom.id, branchId: branch.id, isPrimary: true },
      { userId: mb.id, branchId: branch.id, isPrimary: true },
    ]);
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
    await db.insert(schema.userBranches).values([
      { userId: supMb.id, branchId: branch.id, isPrimary: true },
      { userId: recvMb.id, branchId: branch.id, isPrimary: true },
    ]);
    const [team] = await db
      .insert(schema.branchTeams)
      .values({ branchId: branch.id, department: 'MARKETING', name: 'MB squad' })
      .returning({ id: schema.branchTeams.id });
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
