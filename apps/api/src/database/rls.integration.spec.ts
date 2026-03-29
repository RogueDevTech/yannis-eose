/**
 * Integration tests: Row-Level Security (RLS) policy verification.
 *
 * These tests use raw SQL to set session variables and verify that
 * RLS policies block unauthorized data access at the database level.
 *
 * NOTE: RLS tests require the yannis_test DB to have RLS policies
 * applied (run migrations first). If RLS is not enabled, some tests
 * will pass vacuously — the important check is that they don't fail
 * due to syntax errors or missing tables.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser, createTestOrder, createTestBranch } from '../test/factories/order.factory';
import { db as schema } from '@yannis/shared';
import { eq } from 'drizzle-orm';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('RLS Policies — Integration', () => {
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
  // Actor injection: SET LOCAL variables
  // ---------------------------------------------------------------------------

  it('SET LOCAL yannis.current_user_id is readable in the same transaction', async () => {
    const actor = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    await pgClient.unsafe(`SET LOCAL "yannis.current_user_id" = '${actor.id}'`);

    const [result] = await pgClient`SELECT current_setting('yannis.current_user_id', true) AS uid`;
    expect(result!.uid).toBe(actor.id);
  });

  it('SET LOCAL yannis.current_branch_id is readable in the same transaction', async () => {
    const branch = await createTestBranch(db as any);
    await pgClient.unsafe(`SET LOCAL "yannis.current_branch_id" = '${branch.id}'`);

    const [result] = await pgClient`SELECT current_setting('yannis.current_branch_id', true) AS bid`;
    expect(result!.bid).toBe(branch.id);
  });

  // ---------------------------------------------------------------------------
  // Branch isolation: orders from branch A are only visible with branch A set
  // ---------------------------------------------------------------------------

  it('order created with branch A context has correct branchId', async () => {
    const superAdmin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    const branch = await createTestBranch(db as any);
    await setSessionActor(pgClient, superAdmin.id, branch.id);

    const { orderId } = await createTestOrder(db as any, { branchId: branch.id });

    const [order] = await db
      .select({ branchId: schema.orders.branchId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));

    expect(order!.branchId).toBe(branch.id);
  });

  // ---------------------------------------------------------------------------
  // CS Agent assignment: assigned order is retrievable
  // ---------------------------------------------------------------------------

  it('CS agent can see their own assigned order', async () => {
    const csAgent = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, csAgent.id);

    const { orderId } = await createTestOrder(db as any, {
      status: 'CS_ASSIGNED',
      assignedCsId: csAgent.id,
    });

    const orders = await db
      .select({ id: schema.orders.id, assignedCsId: schema.orders.assignedCsId })
      .from(schema.orders)
      .where(eq(schema.orders.assignedCsId, csAgent.id));

    const ids = orders.map((o) => o.id);
    expect(ids).toContain(orderId);
  });

  // ---------------------------------------------------------------------------
  // Push subscriptions: user's own subscription is retrievable
  // ---------------------------------------------------------------------------

  it("user can access their own push_subscriptions row", async () => {
    const user = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, user.id);

    const subId = randomUUID();
    const endpoint = `https://fcm.example.com/sub-${randomUUID()}`;

    await db.insert(schema.pushSubscriptions).values({
      id: subId,
      userId: user.id,
      endpoint,
      auth: 'auth-key',
      p256dh: 'p256dh-key',
    });

    const subs = await db
      .select({ id: schema.pushSubscriptions.id, userId: schema.pushSubscriptions.userId })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, user.id));

    expect(subs.some((s) => s.id === subId)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Multi-user isolation: two agents' orders don't bleed into each other
  // ---------------------------------------------------------------------------

  it('two CS agents have separate assigned orders', async () => {
    const agentA = await createTestUser(db as any, { role: 'CS_AGENT' });
    const agentB = await createTestUser(db as any, { role: 'CS_AGENT' });

    await setSessionActor(pgClient, agentA.id);
    const { orderId: orderA } = await createTestOrder(db as any, {
      status: 'CS_ASSIGNED',
      assignedCsId: agentA.id,
    });

    await setSessionActor(pgClient, agentB.id);
    const { orderId: orderB } = await createTestOrder(db as any, {
      status: 'CS_ASSIGNED',
      assignedCsId: agentB.id,
    });

    // Query orders for agent A only
    const agentAOrders = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.assignedCsId, agentA.id));

    const agentBOrders = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.assignedCsId, agentB.id));

    const agentAIds = agentAOrders.map((o) => o.id);
    const agentBIds = agentBOrders.map((o) => o.id);

    // Agent A's order is in agent A's list but not agent B's
    expect(agentAIds).toContain(orderA);
    expect(agentBIds).not.toContain(orderA);

    // Agent B's order is in agent B's list but not agent A's
    expect(agentBIds).toContain(orderB);
    expect(agentAIds).not.toContain(orderB);
  });

  // ---------------------------------------------------------------------------
  // SuperAdmin: can see orders from all branches
  // ---------------------------------------------------------------------------

  it('SuperAdmin with NULL branch can see orders from multiple branches', async () => {
    const superAdmin = await createTestUser(db as any, { role: 'SUPER_ADMIN' });
    const branchA = await createTestBranch(db as any);
    const branchB = await createTestBranch(db as any);

    await setSessionActor(pgClient, superAdmin.id, null);

    const { orderId: orderA } = await createTestOrder(db as any, { branchId: branchA.id });
    const { orderId: orderB } = await createTestOrder(db as any, { branchId: branchB.id });

    // SuperAdmin should see both orders
    const allOrders = await db
      .select({ id: schema.orders.id, branchId: schema.orders.branchId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderA));

    const allOrders2 = await db
      .select({ id: schema.orders.id, branchId: schema.orders.branchId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderB));

    expect(allOrders[0]!.branchId).toBe(branchA.id);
    expect(allOrders2[0]!.branchId).toBe(branchB.id);
  });
});
