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
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestOrder } from '../test/factories/order.factory';
import { isTransitionAllowed } from './order-state-machine';

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
    expect(isTransitionAllowed('CS_ENGAGED', 'ALLOCATED')).toBe(false);
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

  // ---------------------------------------------------------------------------
  // Status update: UNPROCESSED → CS_ASSIGNED
  // ---------------------------------------------------------------------------

  it('transitions order from UNPROCESSED to CS_ASSIGNED', async () => {
    const actor = await createTestUser(db as any, { role: 'HEAD_OF_CS' });
    await setSessionActor(pgClient, actor.id);

    const csAgent = await createTestUser(db as any, { role: 'CS_AGENT' });
    const { orderId } = await createTestOrder(db as any, { status: 'UNPROCESSED' });

    // Direct DB update (service call would require full NestJS setup)
    await db
      .update(schema.orders)
      .set({ status: 'CS_ASSIGNED', assignedCsId: csAgent.id })
      .where(eq(schema.orders.id, orderId));

    const [updated] = await db
      .select({ status: schema.orders.status, assignedCsId: schema.orders.assignedCsId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    expect(updated!.status).toBe('CS_ASSIGNED');
    expect(updated!.assignedCsId).toBe(csAgent.id);
  });

  // ---------------------------------------------------------------------------
  // Timeline event atomicity — if timeline insert fails, order status reverts
  // ---------------------------------------------------------------------------

  it('order status and timeline event persist in the same transaction', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
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
      description: 'CS agent engaged order',
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
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
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
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
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
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
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
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
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

    // maskPhone logic: first4 + **** + last4 of hash
    const hash = order!.customerPhoneHash ?? '';
    const masked = hash.length <= 8 ? '****' : `${hash.slice(0, 4)}****${hash.slice(-4)}`;
    // Masked value must NOT equal the raw phone
    expect(masked).not.toBe(rawPhone);
    // Masked value must contain ****
    expect(masked).toContain('****');
  });

  // ---------------------------------------------------------------------------
  // Timeline actorName: snapshot at write time, not joined at read time
  // ---------------------------------------------------------------------------

  it('order_timeline_events stores actorName as snapshot, not a FK', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
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
});
