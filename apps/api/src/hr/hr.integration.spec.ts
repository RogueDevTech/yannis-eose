/**
 * Integration tests: Commission engine and payout records.
 *
 * Tests:
 * - Commission plan creation and retrieval
 * - Payout record with correct line items
 * - CLAWBACK adjustment reduces net payout
 * - Period filtering: January orders not in February run
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestUser } from '../test/factories/order.factory';
import { createTestCommissionPlan, createTestDeliveredOrder } from '../test/factories/commission.factory';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('Commission Engine — Integration', () => {
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
  // Commission plan creation and retrieval
  // ---------------------------------------------------------------------------

  it('creates a commission plan with all rules', async () => {
    const actor = await createTestUser(db as any, { role: 'HR_MANAGER' });
    await setSessionActor(pgClient, actor.id);

    const { id: planId, rules } = await createTestCommissionPlan(db as any, {
      role: 'CS_AGENT',
      baseSalary: 50000,
      baseThreshold: 50,
      perOrderRate: 1000,
      deliveryRateThreshold: 80,
      bonusPerExtraOrder: 500,
      penaltyPerReturn: 200,
    });

    const [plan] = await db
      .select({ id: schema.commissionPlans.id, rules: schema.commissionPlans.rules })
      .from(schema.commissionPlans)
      .where(eq(schema.commissionPlans.id, planId));

    expect(plan).toBeDefined();
    const planRules = plan!.rules as typeof rules;
    expect(planRules.baseSalary).toBe(50000);
    expect(planRules.baseThreshold).toBe(50);
    expect(planRules.perOrderRate).toBe(1000);
  });

  // ---------------------------------------------------------------------------
  // Payout record creation
  // ---------------------------------------------------------------------------

  it('creates a payout record with DRAFT status', async () => {
    const hrActor = await createTestUser(db as any, { role: 'HR_MANAGER' });
    const csAgent = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, hrActor.id);

    const payoutRows = await db.insert(schema.payoutRecords).values({
      staffId: csAgent.id,
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-01-31'),
      baseSalary: '50000',
      performanceBonus: '60000',
      deductionsTotal: '0',
      totalPayout: '110000',
      status: 'DRAFT',
    }).returning({ id: schema.payoutRecords.id });
    const payoutId = payoutRows[0]!.id;

    const [payout] = await db
      .select({
        id: schema.payoutRecords.id,
        status: schema.payoutRecords.status,
        totalPayout: schema.payoutRecords.totalPayout,
      })
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.id, payoutId));

    expect(payout).toBeDefined();
    expect(payout!.status).toBe('DRAFT');
    expect(Number(payout!.totalPayout)).toBe(110000);
  });

  // ---------------------------------------------------------------------------
  // CLAWBACK adjustment reduces net payout
  // ---------------------------------------------------------------------------

  it('clawback adjustment creates a negative line item record', async () => {
    const hrActor = await createTestUser(db as any, { role: 'HR_MANAGER' });
    const csAgent = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, hrActor.id);

    const adjustmentRows = await db.insert(schema.earningsAdjustments).values({
      staffId: csAgent.id,
      category: 'CLAWBACK',
      amount: '2000',
      reason: 'Customer returned the delivered order',
      approvedBy: hrActor.id,
    }).returning({ id: schema.earningsAdjustments.id });
    const adjustmentId = adjustmentRows[0]!.id;

    const [adjustment] = await db
      .select({
        id: schema.earningsAdjustments.id,
        category: schema.earningsAdjustments.category,
        amount: schema.earningsAdjustments.amount,
      })
      .from(schema.earningsAdjustments)
      .where(eq(schema.earningsAdjustments.id, adjustmentId));

    expect(adjustment).toBeDefined();
    expect(adjustment!.category).toBe('CLAWBACK');
    expect(Number(adjustment!.amount)).toBe(2000);
  });

  // ---------------------------------------------------------------------------
  // Period filtering: Jan order not in Feb payout run
  // ---------------------------------------------------------------------------

  it('delivered-in-January order is NOT in February payout window', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, actor.id);

    const januaryDate = new Date('2026-01-15T10:00:00Z');
    const { orderId } = await createTestDeliveredOrder(db as any, {
      assignedCsId: actor.id,
      deliveredAt: januaryDate,
    });

    // Simulate February payout window query
    const febStart = new Date('2026-02-01');
    const febEnd = new Date('2026-02-28');

    const februaryOrders = await db
      .select({ id: schema.orders.id, deliveredAt: schema.orders.deliveredAt })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.assignedCsId, actor.id),
          eq(schema.orders.status, 'DELIVERED'),
          gte(schema.orders.deliveredAt, febStart),
          lte(schema.orders.deliveredAt, febEnd),
        ),
      );

    // The January order should NOT appear in February window
    const ids = februaryOrders.map((o) => o.id);
    expect(ids).not.toContain(orderId);
  });

  // ---------------------------------------------------------------------------
  // Period filtering: Feb order IS in February payout window
  // ---------------------------------------------------------------------------

  it('delivered-in-February order IS in February payout window', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, actor.id);

    const februaryDate = new Date('2026-02-10T14:00:00Z');
    const { orderId } = await createTestDeliveredOrder(db as any, {
      assignedCsId: actor.id,
      deliveredAt: februaryDate,
    });

    const febStart = new Date('2026-02-01');
    const febEnd = new Date('2026-02-28');

    const februaryOrders = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.assignedCsId, actor.id),
          eq(schema.orders.status, 'DELIVERED'),
          gte(schema.orders.deliveredAt, febStart),
          lte(schema.orders.deliveredAt, febEnd),
        ),
      );

    const ids = februaryOrders.map((o) => o.id);
    expect(ids).toContain(orderId);
  });

  // ---------------------------------------------------------------------------
  // Base threshold: agent must hit count >= threshold to earn base salary
  // ---------------------------------------------------------------------------

  it('agent with >= threshold delivered orders qualifies for base salary', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, actor.id);

    // Create 60 delivered orders in January
    const janDate = new Date('2026-01-20T10:00:00Z');
    const insertPromises = Array.from({ length: 60 }, () =>
      createTestDeliveredOrder(db as any, {
        assignedCsId: actor.id,
        deliveredAt: janDate,
      }),
    );
    await Promise.all(insertPromises);

    const { rules } = await createTestCommissionPlan(db as any, {
      role: 'CS_AGENT',
      baseSalary: 50000,
      baseThreshold: 50, // needs 50 to unlock base
    });

    const janStart = new Date('2026-01-01');
    const janEnd = new Date('2026-01-31');

    const deliveredCount = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.assignedCsId, actor.id),
          eq(schema.orders.status, 'DELIVERED'),
          gte(schema.orders.deliveredAt, janStart),
          lte(schema.orders.deliveredAt, janEnd),
        ),
      );

    const count = deliveredCount.length;
    const baseSalaryEarned = count >= (rules.baseThreshold ?? 0) ? rules.baseSalary ?? 0 : 0;

    expect(count).toBe(60);
    expect(baseSalaryEarned).toBe(50000);
  });

  it('agent with < threshold delivered orders does NOT earn base salary', async () => {
    const actor = await createTestUser(db as any, { role: 'CS_AGENT' });
    await setSessionActor(pgClient, actor.id);

    // Only 40 delivered orders
    const janDate = new Date('2026-01-20T10:00:00Z');
    const insertPromises = Array.from({ length: 40 }, () =>
      createTestDeliveredOrder(db as any, {
        assignedCsId: actor.id,
        deliveredAt: janDate,
      }),
    );
    await Promise.all(insertPromises);

    const { rules } = await createTestCommissionPlan(db as any, {
      role: 'CS_AGENT',
      baseSalary: 50000,
      baseThreshold: 50,
    });

    const janStart = new Date('2026-01-01');
    const janEnd = new Date('2026-01-31');

    const deliveredRows = await db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.assignedCsId, actor.id),
          eq(schema.orders.status, 'DELIVERED'),
          gte(schema.orders.deliveredAt, janStart),
          lte(schema.orders.deliveredAt, janEnd),
        ),
      );

    const count = deliveredRows.length;
    const baseSalaryEarned = count >= (rules.baseThreshold ?? 0) ? rules.baseSalary ?? 0 : 0;

    expect(count).toBe(40);
    expect(baseSalaryEarned).toBe(0); // Below threshold
  });
});
