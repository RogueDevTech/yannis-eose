/**
 * Integration: `UsersService.list` branch auto-scoping.
 *
 * The defect this protects against: prior to 2026-04-26, `users.list` returned
 * a global active-user list regardless of the caller's `currentBranchId`, which
 * leaked Media Buyers from other branches into the "Send Funding to Media Buyer"
 * dropdown on `/admin/marketing/funding`.
 *
 * These tests pin the four allowed branch-scope behaviors:
 *   1. Auto-scope by `ctx.currentBranchId` for non-admin callers
 *   2. `userIds` filter bypasses scope (name-resolution path)
 *   3. `allBranches: true` from admin bypasses scope (branch member picker)
 *   4. `allBranches: true` from non-admin is silently ignored (still scoped)
 *   5. Admin in global mode (`currentBranchId = NULL`) sees everyone
 */

import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestBranch } from '../test/factories/order.factory';
import { UsersService } from './users.service';
import { db as schema } from '@yannis/shared';
import type { AuthService } from '../auth/auth.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../permissions/permissions.service';
import type { EventsService } from '../events/events.service';
import type { UserBundleCacheService } from '../auth/user-bundle-cache.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('UsersService.list — branch auto-scope', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const authStub = {} as unknown as AuthService;
  const notificationsStub = {} as unknown as NotificationsService;
  const permissionsStub = {} as unknown as PermissionsService;
  const eventsStub = { emitToUser: () => undefined } as unknown as EventsService;
  // Tests in this file only exercise read paths (`UsersService.list`), so the cache
  // invalidation hook is never called — a no-op stub keeps DI happy.
  const userBundleCacheStub = {
    invalidate: async () => undefined,
  } as unknown as UserBundleCacheService;

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
   * Helper: build two branches with one Media Buyer and one HoM in each, plus a
   * standalone admin (no branch). Returns IDs the tests need.
   */
  async function seedTwoBranches() {
    const lagos = await createTestBranch(db as any);
    const main = await createTestBranch(db as any);

    const homLagos = await createTestUser(db as any, { role: 'HEAD_OF_MARKETING' });
    const mbLagos = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const mbMain = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const admin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });

    await db.insert(schema.userBranches).values([
      { userId: homLagos.id, branchId: lagos.id, isPrimary: true },
      { userId: mbLagos.id, branchId: lagos.id, isPrimary: true },
      { userId: mbMain.id, branchId: main.id, isPrimary: true },
    ]);

    return { lagos, main, homLagos, mbLagos, mbMain, admin };
  }

  it('auto-scopes by ctx.currentBranchId — HoM on Lagos sees only Lagos members', async () => {
    const { lagos, homLagos, mbLagos, mbMain } = await seedTwoBranches();
    await setSessionActor(pgClient, homLagos.id, lagos.id);

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub, eventsStub, userBundleCacheStub);
    const result = await svc.list(
      { page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc' },
      { id: homLagos.id, role: 'HEAD_OF_MARKETING' },
      lagos.id,
    );

    const ids = result.users.map((u) => u.id);
    expect(ids).toContain(homLagos.id);
    expect(ids).toContain(mbLagos.id);
    expect(ids).not.toContain(mbMain.id);
  });

  it('userIds filter bypasses branch scope (name-resolution path)', async () => {
    const { lagos, homLagos, mbLagos, mbMain } = await seedTwoBranches();
    await setSessionActor(pgClient, homLagos.id, lagos.id);

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub, eventsStub, userBundleCacheStub);
    const result = await svc.list(
      {
        page: 1,
        limit: 100,
        sortBy: 'name',
        sortOrder: 'asc',
        userIds: [mbLagos.id, mbMain.id],
      },
      { id: homLagos.id, role: 'HEAD_OF_MARKETING' },
      lagos.id,
    );

    const ids = result.users.map((u) => u.id);
    expect(ids).toContain(mbLagos.id);
    expect(ids).toContain(mbMain.id);
  });

  it('allBranches: true from SUPER_ADMIN bypasses scope', async () => {
    const { lagos, mbLagos, mbMain, admin } = await seedTwoBranches();
    await setSessionActor(pgClient, admin.id, lagos.id);

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub, eventsStub, userBundleCacheStub);
    const result = await svc.list(
      { page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc', allBranches: true },
      { id: admin.id, role: 'SUPER_ADMIN' },
      lagos.id,
    );

    const ids = result.users.map((u) => u.id);
    expect(ids).toContain(mbLagos.id);
    expect(ids).toContain(mbMain.id);
  });

  it('allBranches: true from non-admin is ignored — still branch-scoped', async () => {
    const { lagos, homLagos, mbLagos, mbMain } = await seedTwoBranches();
    await setSessionActor(pgClient, homLagos.id, lagos.id);

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub, eventsStub, userBundleCacheStub);
    const result = await svc.list(
      { page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc', allBranches: true },
      { id: homLagos.id, role: 'HEAD_OF_MARKETING' },
      lagos.id,
    );

    const ids = result.users.map((u) => u.id);
    expect(ids).toContain(mbLagos.id);
    expect(ids).not.toContain(mbMain.id);
  });

  it('admin with currentBranchId = NULL (global mode) sees all users', async () => {
    const { admin, mbLagos, mbMain } = await seedTwoBranches();
    await setSessionActor(pgClient, admin.id, null);

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub, eventsStub, userBundleCacheStub);
    const result = await svc.list(
      { page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc' },
      { id: admin.id, role: 'SUPER_ADMIN' },
      null,
    );

    const ids = result.users.map((u) => u.id);
    expect(ids).toContain(mbLagos.id);
    expect(ids).toContain(mbMain.id);
  });

  it('explicit input.branchId still wins over ctx.currentBranchId', async () => {
    const { lagos, main, homLagos, mbMain } = await seedTwoBranches();
    await setSessionActor(pgClient, homLagos.id, lagos.id);

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub, eventsStub, userBundleCacheStub);
    const result = await svc.list(
      { page: 1, limit: 100, sortBy: 'name', sortOrder: 'asc', branchId: main.id },
      { id: homLagos.id, role: 'HEAD_OF_MARKETING' },
      lagos.id,
    );

    const ids = result.users.map((u) => u.id);
    expect(ids).toContain(mbMain.id);
    expect(ids).not.toContain(homLagos.id);
  });
});

describe.skipIf(SKIP_IF_NO_DB)('UsersService — org-wide department heads', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const authStub = {
    hashPassword: async () => '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  } as unknown as AuthService;

  const notificationsStub = {
    sendInviteEmail: async () => false,
    create: async () => {},
  } as unknown as NotificationsService;

  const permissionsStub = {
    isSensitiveRole: () => false,
  } as unknown as PermissionsService;

  const eventsStub = { emitToUser: () => undefined } as unknown as EventsService;
  // `UsersService.createStaff` calls `userBundleCache.invalidate(newUserId)` after the
  // staff is created. The stub no-ops it so the test only exercises the DB path.
  const userBundleCacheStub = {
    invalidate: async () => undefined,
  } as unknown as UserBundleCacheService;

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  it('createStaff allows a second HEAD_OF_CS now that the singleton is retired (CEO 2026-05-03)', async () => {
    const branch = await createTestBranch(db as any);
    const branch2 = await createTestBranch(db as any);
    const existing = await createTestUser(db as any, { role: 'HEAD_OF_CS' });
    await db.update(schema.users).set({ primaryBranchId: branch.id }).where(eq(schema.users.id, existing.id));

    const admin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    await setSessionActor(pgClient, admin.id, null);

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub, eventsStub, userBundleCacheStub);

    // Migration 0108 dropped the singleton DB index; the service no longer
    // throws CONFLICT for duplicate heads. Permissions handle the actual
    // capability now — multiple HEAD_OF_CS holders are allowed.
    await expect(
      svc.createStaff(
        {
          name: 'Second HoCS',
          email: `second-hocs-${randomUUID()}@yannis.test`,
          role: 'HEAD_OF_CS',
          status: 'PENDING',
          primaryBranchId: branch2.id,
          phone: '08031234567',
        },
        { id: admin.id, role: 'SUPER_ADMIN', name: 'Admin', currentBranchId: null } as any,
      ),
    ).resolves.toMatchObject({ role: 'HEAD_OF_CS' });
  });
});
