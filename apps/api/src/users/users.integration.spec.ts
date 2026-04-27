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

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestBranch } from '../test/factories/order.factory';
import { UsersService } from './users.service';
import { db as schema } from '@yannis/shared';
import type { AuthService } from '../auth/auth.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../permissions/permissions.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('UsersService.list — branch auto-scope', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const authStub = {} as unknown as AuthService;
  const notificationsStub = {} as unknown as NotificationsService;
  const permissionsStub = {} as unknown as PermissionsService;

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

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub);
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

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub);
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

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub);
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

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub);
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

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub);
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

    const svc = new UsersService(db as any, authStub, notificationsStub, permissionsStub);
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
