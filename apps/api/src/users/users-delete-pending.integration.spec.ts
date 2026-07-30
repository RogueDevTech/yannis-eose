/**
 * Integration: `UsersService.deletePending` — hard-delete PENDING invites only.
 */

import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getPgClient, getDb, closeConnections } from '../test/setup-integration';
import { createTestUser } from '../test/factories/order.factory';
import { UsersService } from './users.service';
import { db as schema } from '@yannis/shared';
import type { AuthService } from '../auth/auth.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../permissions/permissions.service';
import type { EventsService } from '../events/events.service';
import type { UserBundleCacheService } from '../auth/user-bundle-cache.service';
import type { BranchTeamsService } from '../branches/branch-teams.service';
import type { CacheService } from '../common/cache/cache.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('UsersService.deletePending', () => {
  const pgClient = getPgClient();
  const db = getDb();

  const authStub = {
    killUserSessions: async () => undefined,
  } as unknown as AuthService;
  const notificationsStub = {} as unknown as NotificationsService;
  const permissionsStub = {} as unknown as PermissionsService;
  const eventsStub = { emitToUser: () => undefined } as unknown as EventsService;
  const userBundleCacheStub = {
    invalidate: async () => undefined,
  } as unknown as UserBundleCacheService;
  const branchTeamsStub = {} as unknown as BranchTeamsService;
  const cacheStub = {
    delPattern: async () => undefined,
  } as unknown as CacheService;

  function makeService() {
    return new UsersService(
      db as any,
      authStub,
      notificationsStub,
      permissionsStub,
      eventsStub,
      userBundleCacheStub,
      branchTeamsStub,
      cacheStub,
    );
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

  it('deletes a PENDING invite and frees the email', async () => {
    const admin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    const [group] = await db
      .insert(schema.branchGroups)
      .values({ name: `Delete Pending Group ${randomUUID().slice(0, 8)}` })
      .returning({ id: schema.branchGroups.id });
    const branchId = randomUUID();
    await db.insert(schema.branches).values({
      id: branchId,
      name: `Delete Pending Branch ${branchId.slice(0, 8)}`,
      code: `DP${branchId.slice(0, 4).toUpperCase()}`,
      status: 'ACTIVE',
      groupId: group!.id,
    });
    const pendingId = randomUUID();
    const email = `pending-delete-${pendingId.slice(0, 8)}@yannis.test`;

    await db.insert(schema.users).values({
      id: pendingId,
      name: 'Pending Invite',
      email,
      passwordHash: '$2b$10$testhashedpassword',
      role: 'CS_CLOSER',
      status: 'PENDING',
      primaryBranchId: branchId,
    });
    await db.insert(schema.userBranches).values({
      userId: pendingId,
      branchId,
      isPrimary: true,
    });

    const svc = makeService();
    const result = await svc.deletePending(pendingId, {
      id: admin.id,
      role: 'SUPER_ADMIN',
      name: 'Admin',
      permissions: [],
    } as any);

    expect(result).toMatchObject({ success: true, id: pendingId, email });

    const remaining = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.id, pendingId));
    expect(remaining).toHaveLength(0);

    const branches = await db
      .select({ userId: schema.userBranches.userId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, pendingId));
    expect(branches).toHaveLength(0);

    // Email is free for a new invite.
    await db.insert(schema.users).values({
      id: randomUUID(),
      name: 'Reinvited',
      email,
      passwordHash: '$2b$10$testhashedpassword',
      role: 'CS_CLOSER',
      status: 'PENDING',
    });
  });

  it('rejects ACTIVE users', async () => {
    const admin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    const active = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const svc = makeService();

    await expect(
      svc.deletePending(active.id, {
        id: admin.id,
        role: 'SUPER_ADMIN',
        name: 'Admin',
        permissions: [],
      } as any),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringMatching(/only pending invites/i),
    } satisfies Partial<TRPCError>);
  });

  it('rejects callers without users.create', async () => {
    const closer = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const pendingId = randomUUID();
    await db.insert(schema.users).values({
      id: pendingId,
      name: 'Pending Invite',
      email: `pending-forbidden-${pendingId.slice(0, 8)}@yannis.test`,
      passwordHash: '$2b$10$testhashedpassword',
      role: 'CS_CLOSER',
      status: 'PENDING',
    });

    const svc = makeService();
    await expect(
      svc.deletePending(pendingId, {
        id: closer.id,
        role: 'CS_CLOSER',
        name: 'Closer',
        permissions: [],
      } as any),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    } satisfies Partial<TRPCError>);
  });
});
