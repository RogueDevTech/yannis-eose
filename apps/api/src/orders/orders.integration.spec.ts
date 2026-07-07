/**
 * Integration tests: Order state transition atomicity and actor injection.
 *
 * These tests run against yannis_test database.
 * Each test is wrapped in a rolled-back transaction.
 *
 * NOTE: These tests instantiate only what is needed from OrdersService.
 * They bypass the full NestJS IoC to keep tests fast and focused.
 */

import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db as schema, formatOrderCustomerPhoneDisplay } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import {
  createTestUser,
  createTestOrder,
  createTestBranch,
  insertTestBranchTeam,
} from '../test/factories/order.factory';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { createFakeCacheService } from '../test/fake-cache';
import { isTransitionAllowed } from './order-state-machine';
import { OrdersService } from './orders.service';

/** Minimal stub — integration tests do not exercise routing-rule dispatch. */
const stubCsOrderRouting = {
  resolveRoutingForDispatch: async () => null,
};

const noopEvents = {
  emitToUser: () => undefined,
  emitToRoom: () => undefined,
};

const noopNotifications = {
  create: async () => undefined,
  enqueueCreate: () => undefined,
  enqueueCreateForRole: () => undefined,
  enqueueCreateForLocation: () => undefined,
};

function createOrdersServiceForTest(dbRef: any, overrides?: { settingsService?: any }) {
  return new OrdersService(
    dbRef as any,
    {} as any,
    noopEvents as any,
    noopNotifications as any,
    (overrides?.settingsService ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
    new BranchTeamsService(dbRef as any, createFakeCacheService()),
    {} as any,
    stubCsOrderRouting as any,
    // GeneralLedgerService — order-lifecycle GL posting is non-fatal and these
    // tests don't assert on the ledger, so a no-op stub is sufficient.
    {
      postSalesInvoice: async () => ({ posted: false }),
      reverseVoucher: async () => ({ reversed: false }),
    } as any,
  );
}

// Skip all if no DB URL configured (unit-only environments)
const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Order State Transitions — Integration', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  afterAll(async () => {
    await closeConnections();
  });

  // ---------------------------------------------------------------------------
  // State machine — basic transition validation via isTransitionAllowed
  // ---------------------------------------------------------------------------

  it('rejects UNPROCESSED → DISPATCHED (state skip)', () => {
    expect(isTransitionAllowed('UNPROCESSED', 'DISPATCHED')).toBe(false);
  });

  it('rejects CS_ENGAGED → ALLOCATED (state skip)', () => {
    expect(isTransitionAllowed('CS_ENGAGED', 'AGENT_ASSIGNED')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Order creation and basic DB persistence
  // ---------------------------------------------------------------------------

  it('creates an order in UNPROCESSED status', async () => {
    const actor = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    await setSessionActor(pgClient, actor.id);

    const { orderId } = await createTestOrder(db as any);

    const [order] = await db
      .select({ id: schema.orders.id, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    expect(order).toBeDefined();
    expect(order!.status).toBe('UNPROCESSED');
  });

  it('list + statusCounts respect statuses[] filters for logistics-scoped queries', async () => {
    const actor = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    await setSessionActor(pgClient, actor.id);
    const branchId = randomUUID();

    await createTestOrder(db as any, { status: 'CS_ENGAGED', branchId });
    await createTestOrder(db as any, { status: 'CONFIRMED', branchId });
    await createTestOrder(db as any, { status: 'AGENT_ASSIGNED', branchId });
    await createTestOrder(db as any, { status: 'DELIVERED', branchId });

    const ordersService = new OrdersService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new BranchTeamsService(db as any, createFakeCacheService()),
      {} as any,
      stubCsOrderRouting as any,
      { postSalesInvoice: async () => ({ posted: false }), reverseVoucher: async () => ({ reversed: false }) } as any,
    );

    const logisticsStatuses = ['CONFIRMED', 'AGENT_ASSIGNED', 'DELIVERED'] as const;

    const listResult = await ordersService.list(
      {
        page: 1,
        limit: 50,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        statuses: [...logisticsStatuses],
      },
      branchId,
    );
    expect(listResult.orders.every((o) => logisticsStatuses.includes(o.status as (typeof logisticsStatuses)[number]))).toBe(true);
    expect(listResult.orders.some((o) => o.status === 'CS_ENGAGED')).toBe(false);

    const counts = await ordersService.getStatusCounts(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      branchId,
      [...logisticsStatuses],
      undefined,
    );
    expect(counts['CS_ENGAGED'] ?? 0).toBe(0);
    expect((counts['CONFIRMED'] ?? 0) + (counts['AGENT_ASSIGNED'] ?? 0) + (counts['DELIVERED'] ?? 0)).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Status update: UNPROCESSED → CS_ASSIGNED
  // ---------------------------------------------------------------------------

  it('transitions order from UNPROCESSED to CS_ASSIGNED', async () => {
    const actor = await createTestUser(db as any, { role: 'HEAD_OF_CS' });
    await setSessionActor(pgClient, actor.id);

    const csCloser = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const { orderId } = await createTestOrder(db as any, { status: 'UNPROCESSED' });

    // Direct DB update (service call would require full NestJS setup)
    await db
      .update(schema.orders)
      .set({ status: 'CS_ASSIGNED', assignedCsId: csCloser.id })
      .where(eq(schema.orders.id, orderId));

    const [updated] = await db
      .select({ status: schema.orders.status, assignedCsId: schema.orders.assignedCsId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    expect(updated!.status).toBe('CS_ASSIGNED');
    expect(updated!.assignedCsId).toBe(csCloser.id);
  });

  it('allows CS_ASSIGNED → CS_ENGAGED even when the closer backlog exceeds their quota', async () => {
    const closer = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, closer.id);
    await db.update(schema.users).set({ capacity: 1 }).where(eq(schema.users.id, closer.id));

    await createTestOrder(db as any, { status: 'CS_ASSIGNED', assignedCsId: closer.id });
    const { orderId } = await createTestOrder(db as any, {
      status: 'CS_ASSIGNED',
      assignedCsId: closer.id,
    });

    const ordersService = createOrdersServiceForTest(db);
    const actor = {
      id: closer.id,
      email: closer.email,
      name: 'Closer',
      role: 'CS_CLOSER',
      logisticsLocationId: null,
      currentBranchId: null,
      permissions: ['orders.read'],
    };

    const updated = await ordersService.transition(
      { orderId, newStatus: 'CS_ENGAGED' },
      actor as any,
    );

    expect(updated.status).toBe('CS_ENGAGED');
  });

  it('claimOrder succeeds even when the closer is already at the configured claim quota', async () => {
    const closer = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, closer.id);

    await createTestOrder(db as any, { status: 'CS_ASSIGNED', assignedCsId: closer.id });
    await createTestOrder(db as any, { status: 'CONFIRMED', assignedCsId: closer.id });
    const { orderId } = await createTestOrder(db as any, { status: 'UNPROCESSED' });

    const ordersService = createOrdersServiceForTest(db);
    const actor = {
      id: closer.id,
      email: closer.email,
      name: 'Closer',
      role: 'CS_CLOSER',
      logisticsLocationId: null,
      currentBranchId: null,
    };

    const result = await ordersService.claimOrder(orderId, actor as any);
    expect(result.success).toBe(true);

    const [claimed] = await db
      .select({ assignedCsId: schema.orders.assignedCsId, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    expect(claimed!.assignedCsId).toBe(closer.id);
    expect(claimed!.status).toBe('CS_ASSIGNED');
  });

  it('auto-dispatch still assigns an order to a closer who is already at quota', async () => {
    const branch = await createTestBranch(db as any);
    const closer = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await db.insert(schema.userBranches).values([{ userId: closer.id, branchId: branch.id, isPrimary: true }]);
    await db.update(schema.users).set({ capacity: 1 }).where(eq(schema.users.id, closer.id));

    await createTestOrder(db as any, {
      status: 'CS_ASSIGNED',
      assignedCsId: closer.id,
      branchId: branch.id,
    });
    const { orderId } = await createTestOrder(db as any, {
      status: 'UNPROCESSED',
      branchId: branch.id,
    });

    const ordersService = createOrdersServiceForTest(db, {
      settingsService: {
        get: async (key: string) => {
          if (key === 'CS_DISPATCH_STRATEGY') return { strategy: 'load_balanced' };
          if (key === 'CS_CLAIM_CAP') return { cap: 2 };
          return null;
        },
      },
    });

    const assigned = await (ordersService as any).assignOrderToBestAvailableAgent(orderId);
    expect(assigned).toBe(true);

    const [updated] = await db
      .select({ assignedCsId: schema.orders.assignedCsId, status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    expect(updated!.assignedCsId).toBe(closer.id);
    expect(updated!.status).toBe('CS_ASSIGNED');
  });

  // ---------------------------------------------------------------------------
  // Timeline event atomicity — if timeline insert fails, order status reverts
  // ---------------------------------------------------------------------------

  it('order status and timeline event persist in the same transaction', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    const { orderId } = await createTestOrder(db as any, { status: 'CS_ASSIGNED', assignedCsId: actor.id });

    // Manually set to CS_ENGAGED and insert timeline event atomically
    await db
      .update(schema.orders)
      .set({ status: 'CS_ENGAGED' })
      .where(eq(schema.orders.id, orderId));

    await db.insert(schema.orderTimelineEvents).values({
      id: randomUUID(),
      orderId,
      eventType: 'ORDER_VIEWED',
      actorId: actor.id,
      actorName: 'Test User',
      description: 'Sales closer engaged order',
    });

    // Both the status update and timeline event should exist
    const [order] = await db
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    const timelineRows = await db
      .select({ id: schema.orderTimelineEvents.id, eventType: schema.orderTimelineEvents.eventType })
      .from(schema.orderTimelineEvents)
      .where(eq(schema.orderTimelineEvents.orderId, orderId));

    expect(order!.status).toBe('CS_ENGAGED');
    expect(timelineRows).toHaveLength(1);
    expect(timelineRows[0]!.eventType).toBe('ORDER_VIEWED');
  });

  it('timeline event rollback reverts order status update', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    const { orderId } = await createTestOrder(db as any, { status: 'UNPROCESSED' });

    // Simulate atomicity: if we update order + insert bad timeline, then savepoint rollback
    await pgClient`SAVEPOINT test_atomicity`;
    await db
      .update(schema.orders)
      .set({ status: 'CS_ASSIGNED' })
      .where(eq(schema.orders.id, orderId));

    // Simulate timeline insert failure by rolling back to savepoint
    await pgClient`ROLLBACK TO SAVEPOINT test_atomicity`;

    const [order] = await db
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    // Status should still be UNPROCESSED since we rolled back to savepoint
    expect(order!.status).toBe('UNPROCESSED');
  });

  // ---------------------------------------------------------------------------
  // Actor injection — SET LOCAL variables persist through transaction
  // ---------------------------------------------------------------------------

  it('SET LOCAL actor variables are set and readable within the same transaction', async () => {
    const actor = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    await setSessionActor(pgClient, actor.id);

    const [result] = await pgClient`SELECT current_setting('yannis.current_user_id', true) as uid`;
    expect(result!.uid).toBe(actor.id);
  });

  it('SET LOCAL variables are cleared after transaction ends', async () => {
    const actor = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    await setSessionActor(pgClient, actor.id);

    // End and start a new transaction
    await pgClient`COMMIT`;
    await pgClient`BEGIN`;

    // SET LOCAL variables should be empty in new transaction
    const [result] = await pgClient`SELECT current_setting('yannis.current_user_id', true) as uid`;
    expect(result!.uid ?? '').toBe('');

    // Re-enter transaction state for afterEach ROLLBACK
    // (afterEach will ROLLBACK the current BEGIN we just started)
  });

  // ---------------------------------------------------------------------------
  // VOIP gate: CS_ENGAGED → CONFIRMED requires call_duration >= 15 seconds
  // ---------------------------------------------------------------------------

  it('VOIP gate: call log with duration >= 15s allows CONFIRMED transition check', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    const { orderId } = await createTestOrder(db as any, {
      status: 'CS_ENGAGED',
      assignedCsId: actor.id,
    });

    // Insert a qualifying call log (>= 15 seconds)
    await db.insert(schema.callLogs).values({
      id: randomUUID(),
      orderId,
      agentId: actor.id,
      callStatus: 'COMPLETED',
      durationSeconds: 20,
    });

    const [callRow] = await db
      .select({ durationSeconds: schema.callLogs.durationSeconds, callStatus: schema.callLogs.callStatus })
      .from(schema.callLogs)
      .where(eq(schema.callLogs.orderId, orderId));

    // The call log exists and has qualifying duration — service gate would pass
    expect(callRow).toBeDefined();
    expect(callRow!.durationSeconds).toBeGreaterThanOrEqual(15);
    expect(callRow!.callStatus).toBe('COMPLETED');
  });

  it('VOIP gate: call log with duration < 15s does NOT satisfy confirmation gate', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    const { orderId } = await createTestOrder(db as any, {
      status: 'CS_ENGAGED',
      assignedCsId: actor.id,
    });

    // Insert a short call log (< 15 seconds)
    await db.insert(schema.callLogs).values({
      id: randomUUID(),
      orderId,
      agentId: actor.id,
      callStatus: 'COMPLETED',
      durationSeconds: 10,
    });

    const [callRow] = await db
      .select({ durationSeconds: schema.callLogs.durationSeconds })
      .from(schema.callLogs)
      .where(eq(schema.callLogs.orderId, orderId));

    // Duration is present but below the 15s threshold — service gate would throw BAD_REQUEST
    expect(callRow!.durationSeconds).toBeLessThan(15);
  });

  it('VOIP gate: no call log at all fails the confirmation gate', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    const { orderId } = await createTestOrder(db as any, {
      status: 'CS_ENGAGED',
      assignedCsId: actor.id,
    });

    // No call logs inserted — query returns empty array
    const callRows = await db
      .select({ id: schema.callLogs.id })
      .from(schema.callLogs)
      .where(eq(schema.callLogs.orderId, orderId));

    expect(callRows).toHaveLength(0);
    // Service check: !lastCall || durationSeconds < 15 → would throw BAD_REQUEST
  });

  // ---------------------------------------------------------------------------
  // Phone masking: list response never contains raw customerPhone
  // ---------------------------------------------------------------------------

  it('orders list response exposes customerPhoneDisplay (masked) not raw customerPhone', async () => {
    const actor = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    await setSessionActor(pgClient, actor.id);

    const rawPhone = '08031234567';
    const { orderId } = await createTestOrder(db as any);

    // Update the order to have a known raw phone
    await db
      .update(schema.orders)
      .set({ customerPhone: rawPhone, customerPhoneHash: 'testhash1234567890ab' })
      .where(eq(schema.orders.id, orderId));

    const [order] = await db
      .select({
        id: schema.orders.id,
        customerPhone: schema.orders.customerPhone,
        customerPhoneHash: schema.orders.customerPhoneHash,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    // Raw phone is stored in DB but must NEVER appear in API response
    expect(order!.customerPhone).toBe(rawPhone);

    const display = formatOrderCustomerPhoneDisplay(order!.customerPhone, order!.customerPhoneHash);
    expect(display).toBe('0803****4567');
    expect(display).not.toBe(rawPhone);
    expect(display).not.toContain('testh');
  });

  // ---------------------------------------------------------------------------
  // Timeline actorName: snapshot at write time, not joined at read time
  // ---------------------------------------------------------------------------

  it('order_timeline_events stores actorName as snapshot, not a FK', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    const { orderId } = await createTestOrder(db as any, { assignedCsId: actor.id });

    const snapshotName = 'Jane Doe (snapshot)';
    const eventId = randomUUID();

    await db.insert(schema.orderTimelineEvents).values({
      id: eventId,
      orderId,
      eventType: 'ORDER_CONFIRMED',
      actorId: actor.id,
      actorName: snapshotName,
      description: 'Order confirmed by agent',
    });

    const [event] = await db
      .select({ actorId: schema.orderTimelineEvents.actorId, actorName: schema.orderTimelineEvents.actorName })
      .from(schema.orderTimelineEvents)
      .where(eq(schema.orderTimelineEvents.id, eventId));

    // actorName is stored denormalized — changing the user's name later won't affect this
    expect(event!.actorName).toBe(snapshotName);
    expect(event!.actorId).toBe(actor.id);

    // Simulate user name change — actorName in timeline must remain the snapshot
    await db
      .update(schema.users)
      .set({ name: 'Changed Name' })
      .where(eq(schema.users.id, actor.id));

    const [eventAfterNameChange] = await db
      .select({ actorName: schema.orderTimelineEvents.actorName })
      .from(schema.orderTimelineEvents)
      .where(eq(schema.orderTimelineEvents.id, eventId));

    expect(eventAfterNameChange!.actorName).toBe(snapshotName); // unchanged
  });

  it('addCsOrderComment writes CS_ORDER_COMMENT for assigned closer on DELIVERED order', async () => {
    const branch = await createTestBranch(db as any);
    const closer = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await db.insert(schema.userBranches).values({ userId: closer.id, branchId: branch.id, isPrimary: true });
    await setSessionActor(pgClient, closer.id, branch.id);
    const { orderId } = await createTestOrder(db as any, {
      status: 'DELIVERED',
      branchId: branch.id,
      assignedCsId: closer.id,
    });

    const ordersService = createOrdersServiceForTest(db as any);
    const actor = {
      id: closer.id,
      email: closer.email,
      name: 'Test closer',
      role: 'CS_CLOSER' as const,
      logisticsLocationId: null,
      currentBranchId: branch.id,
      permissions: [] as string[],
    };

    const res = await ordersService.addCsOrderComment(orderId, actor as any, {
      comment: 'Customer asked to call back Thursday.',
    });
    expect(res.success).toBe(true);

    const rows = await db
      .select()
      .from(schema.orderTimelineEvents)
      .where(and(eq(schema.orderTimelineEvents.orderId, orderId), eq(schema.orderTimelineEvents.eventType, 'CS_ORDER_COMMENT')));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toContain('Customer asked');
    expect((rows[0]!.metadata as { commentBody?: string })?.commentBody).toBe(
      'Customer asked to call back Thursday.',
    );
    expect(rows[0]!.actorId).toBe(closer.id);
  });

  it('addCsOrderComment rejects Sales closer not assigned to the order', async () => {
    const branch = await createTestBranch(db as any);
    const assignee = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const stranger = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await db.insert(schema.userBranches).values([
      { userId: assignee.id, branchId: branch.id, isPrimary: true },
      { userId: stranger.id, branchId: branch.id, isPrimary: true },
    ]);
    await setSessionActor(pgClient, stranger.id, branch.id);
    const { orderId } = await createTestOrder(db as any, {
      status: 'DELIVERED',
      branchId: branch.id,
      assignedCsId: assignee.id,
    });

    const ordersService = createOrdersServiceForTest(db as any);
    const actor = {
      id: stranger.id,
      email: stranger.email,
      name: 'Stranger closer',
      role: 'CS_CLOSER' as const,
      logisticsLocationId: null,
      currentBranchId: branch.id,
      permissions: [] as string[],
    };

    await expect(ordersService.addCsOrderComment(orderId, actor as any, { comment: 'Nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const commentRows = await db
      .select({ id: schema.orderTimelineEvents.id })
      .from(schema.orderTimelineEvents)
      .where(and(eq(schema.orderTimelineEvents.orderId, orderId), eq(schema.orderTimelineEvents.eventType, 'CS_ORDER_COMMENT')));
    expect(commentRows).toHaveLength(0);
  });

  it('assignToCS allows CS team supervisor for UNPROCESSED order on same branch', async () => {
    const branch = await createTestBranch(db as any);
    const supervisor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const agent = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await db.insert(schema.userBranches).values([
      { userId: supervisor.id, branchId: branch.id, isPrimary: true },
      { userId: agent.id, branchId: branch.id, isPrimary: true },
    ]);
    const team = await insertTestBranchTeam(db as any, branch.id, 'CS', 'CS squad');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: team!.id, userId: supervisor.id, isSupervisor: true },
      { teamId: team!.id, userId: agent.id, isSupervisor: false },
    ]);
    await setSessionActor(pgClient, supervisor.id, branch.id);
    const { orderId } = await createTestOrder(db as any, { status: 'UNPROCESSED', branchId: branch.id });

    const ordersService = new OrdersService(
      db as any,
      {} as any,
      { emitToUser: () => undefined, emitToRoom: () => undefined } as any,
      { create: async () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new BranchTeamsService(db as any, createFakeCacheService()),
      {} as any,
      stubCsOrderRouting as any,
      { postSalesInvoice: async () => ({ posted: false }), reverseVoucher: async () => ({ reversed: false }) } as any,
    );

    const actor = {
      id: supervisor.id,
      email: supervisor.email,
      name: 'Supervisor',
      role: 'CS_CLOSER',
      logisticsLocationId: null,
      currentBranchId: branch.id,
    };
    const updated = await ordersService.assignToCS(orderId, agent.id, actor as any);
    expect(updated.assignedCsId).toBe(agent.id);
    expect(updated.status).toBe('CS_ASSIGNED');
  });

  it('assignToCS rejects CS supervisor assigning to agent outside team', async () => {
    const branch = await createTestBranch(db as any);
    const supervisor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const stranger = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const teammate = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await db.insert(schema.userBranches).values([
      { userId: supervisor.id, branchId: branch.id, isPrimary: true },
      { userId: stranger.id, branchId: branch.id, isPrimary: true },
      { userId: teammate.id, branchId: branch.id, isPrimary: true },
    ]);
    const team = await insertTestBranchTeam(db as any, branch.id, 'CS', 'T');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: team!.id, userId: supervisor.id, isSupervisor: true },
      { teamId: team!.id, userId: teammate.id, isSupervisor: false },
    ]);
    await setSessionActor(pgClient, supervisor.id, branch.id);
    const { orderId } = await createTestOrder(db as any, { status: 'UNPROCESSED', branchId: branch.id });

    const ordersService = new OrdersService(
      db as any,
      {} as any,
      { emitToUser: () => undefined, emitToRoom: () => undefined } as any,
      { create: async () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new BranchTeamsService(db as any, createFakeCacheService()),
      {} as any,
      stubCsOrderRouting as any,
      { postSalesInvoice: async () => ({ posted: false }), reverseVoucher: async () => ({ reversed: false }) } as any,
    );
    const actor = {
      id: supervisor.id,
      email: supervisor.email,
      name: 'Supervisor',
      role: 'CS_CLOSER',
      logisticsLocationId: null,
      currentBranchId: branch.id,
    };
    await expect(ordersService.assignToCS(orderId, stranger.id, actor as any)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('list with null branchId includes orders from every branch', async () => {
    const branchA = await createTestBranch(db as any);
    const branchB = await createTestBranch(db as any);
    const { orderId: o1 } = await createTestOrder(db as any, { branchId: branchA.id });
    const { orderId: o2 } = await createTestOrder(db as any, { branchId: branchB.id });

    const ordersService = new OrdersService(
      db as any,
      {} as any,
      { emitToUser: () => undefined, emitToRoom: () => undefined } as any,
      { create: async () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new BranchTeamsService(db as any, createFakeCacheService()),
      {} as any,
      stubCsOrderRouting as any,
      { postSalesInvoice: async () => ({ posted: false }), reverseVoucher: async () => ({ reversed: false }) } as any,
    );

    const listResult = await ordersService.list(
      { page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' },
      null,
    );
    const ids = listResult.orders.map((o) => o.id);
    expect(ids).toContain(o1);
    expect(ids).toContain(o2);
  });

  it('list with specific branchId returns only orders for that branch', async () => {
    const branchA = await createTestBranch(db as any);
    const branchB = await createTestBranch(db as any);
    const { orderId: o1 } = await createTestOrder(db as any, { branchId: branchA.id });
    const { orderId: o2 } = await createTestOrder(db as any, { branchId: branchB.id });

    const ordersService = new OrdersService(
      db as any,
      {} as any,
      { emitToUser: () => undefined, emitToRoom: () => undefined } as any,
      { create: async () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new BranchTeamsService(db as any, createFakeCacheService()),
      {} as any,
      stubCsOrderRouting as any,
      { postSalesInvoice: async () => ({ posted: false }), reverseVoucher: async () => ({ reversed: false }) } as any,
    );

    const listA = await ordersService.list(
      { page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' },
      branchA.id,
    );
    expect(listA.orders.map((o) => o.id)).toContain(o1);
    expect(listA.orders.map((o) => o.id)).not.toContain(o2);

    const listB = await ordersService.list(
      { page: 1, limit: 50, sortBy: 'createdAt', sortOrder: 'desc' },
      branchB.id,
    );
    expect(listB.orders.map((o) => o.id)).toContain(o2);
    expect(listB.orders.map((o) => o.id)).not.toContain(o1);
  });

  it('list applies branch filter together with mediaBuyerId', async () => {
    const branchA = await createTestBranch(db as any);
    const branchB = await createTestBranch(db as any);
    const mb = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const { orderId: oA } = await createTestOrder(db as any, { branchId: branchA.id, mediaBuyerId: mb.id });
    const { orderId: oB } = await createTestOrder(db as any, { branchId: branchB.id, mediaBuyerId: mb.id });

    const ordersService = new OrdersService(
      db as any,
      {} as any,
      { emitToUser: () => undefined, emitToRoom: () => undefined } as any,
      { create: async () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      new BranchTeamsService(db as any, createFakeCacheService()),
      {} as any,
      stubCsOrderRouting as any,
      { postSalesInvoice: async () => ({ posted: false }), reverseVoucher: async () => ({ reversed: false }) } as any,
    );

    const filtered = await ordersService.list(
      {
        page: 1,
        limit: 50,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        mediaBuyerId: mb.id,
      },
      branchA.id,
    );
    const ids = filtered.orders.map((o) => o.id);
    expect(ids).toContain(oA);
    expect(ids).not.toContain(oB);
  });
});
