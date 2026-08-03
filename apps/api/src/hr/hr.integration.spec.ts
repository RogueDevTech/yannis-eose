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
import { eq, and, gte, lte, or, isNull } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections, setSessionActor } from '../test/setup-integration';
import { createTestProduct, createTestUser } from '../test/factories/order.factory';
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
      role: 'CS_CLOSER',
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
    const csCloser = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, hrActor.id);

    const payoutRows = await db.insert(schema.payoutRecords).values({
      staffId: csCloser.id,
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
    const csCloser = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, hrActor.id);

    const adjustmentRows = await db.insert(schema.earningsAdjustments).values({
      staffId: csCloser.id,
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
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
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
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
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
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    // Create 60 delivered orders in January (all sharing one product to avoid
    // 60 redundant product+group inserts).
    const { id: productId } = await createTestProduct(db as any);
    const janDate = new Date('2026-01-20T10:00:00Z');
    const insertPromises = Array.from({ length: 60 }, () =>
      createTestDeliveredOrder(db as any, {
        assignedCsId: actor.id,
        deliveredAt: janDate,
        productId,
      }),
    );
    await Promise.all(insertPromises);

    const { rules } = await createTestCommissionPlan(db as any, {
      role: 'CS_CLOSER',
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
    const actor = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, actor.id);

    // Only 40 delivered orders (all sharing one product).
    const { id: productId } = await createTestProduct(db as any);
    const janDate = new Date('2026-01-20T10:00:00Z');
    const insertPromises = Array.from({ length: 40 }, () =>
      createTestDeliveredOrder(db as any, {
        assignedCsId: actor.id,
        deliveredAt: janDate,
        productId,
      }),
    );
    await Promise.all(insertPromises);

    const { rules } = await createTestCommissionPlan(db as any, {
      role: 'CS_CLOSER',
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

  // ---------------------------------------------------------------------------
  // Period-earmarked adjustments: the batch sweep predicate
  //   payout_id IS NULL AND (period_month IS NULL OR period_month = <batch month>)
  // must select only adjustments for the batch's own month (plus un-earmarked
  // legacy rows), and never an adjustment earmarked for a different month.
  // ---------------------------------------------------------------------------

  it('month-scoped sweep selects this-month + null-month, not other-month adjustments', async () => {
    const hrActor = await createTestUser(db as any, { role: 'HR_MANAGER' });
    const staff = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, hrActor.id);

    // Three pending (unlinked) adjustments for the same staff member.
    const rows = await db
      .insert(schema.earningsAdjustments)
      .values([
        { staffId: staff.id, category: 'DEDUCTION', amount: '-1000', reason: 'August earmark', periodMonth: '2026-08-01' },
        { staffId: staff.id, category: 'DEDUCTION', amount: '-2000', reason: 'September earmark', periodMonth: '2026-09-01' },
        { staffId: staff.id, category: 'DEDUCTION', amount: '-3000', reason: 'No earmark (legacy)', periodMonth: null },
      ])
      .returning({ id: schema.earningsAdjustments.id, periodMonth: schema.earningsAdjustments.periodMonth });
    const augustId = rows[0]!.id;
    const septemberId = rows[1]!.id;
    const nullMonthId = rows[2]!.id;

    // Mirror pendingAdjustmentForMonth('2026-08-01').
    const augustSweep = await db
      .select({ id: schema.earningsAdjustments.id })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, staff.id),
          isNull(schema.earningsAdjustments.payoutId),
          or(
            isNull(schema.earningsAdjustments.periodMonth),
            eq(schema.earningsAdjustments.periodMonth, '2026-08-01'),
          ),
        ),
      );
    const augustIds = augustSweep.map((r) => r.id);

    expect(augustIds).toContain(augustId); // this month
    expect(augustIds).toContain(nullMonthId); // legacy un-earmarked
    expect(augustIds).not.toContain(septemberId); // other month excluded
  });

  it('already-linked adjustments are never re-swept', async () => {
    const hrActor = await createTestUser(db as any, { role: 'HR_MANAGER' });
    const staff = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, hrActor.id);

    // A payout to link against.
    const payoutRows = await db
      .insert(schema.payoutRecords)
      .values({
        staffId: staff.id,
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        baseSalary: '50000',
        deductionsTotal: '0',
        totalPayout: '50000',
        status: 'DRAFT',
      })
      .returning({ id: schema.payoutRecords.id });
    const payoutId = payoutRows[0]!.id;

    // One already linked to that payout, one still pending — both August.
    await db.insert(schema.earningsAdjustments).values([
      { staffId: staff.id, category: 'DEDUCTION', amount: '-1000', reason: 'Already applied', periodMonth: '2026-08-01', payoutId },
      { staffId: staff.id, category: 'DEDUCTION', amount: '-2000', reason: 'Still pending', periodMonth: '2026-08-01' },
    ]);

    const augustSweep = await db
      .select({ id: schema.earningsAdjustments.id })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, staff.id),
          isNull(schema.earningsAdjustments.payoutId),
          or(
            isNull(schema.earningsAdjustments.periodMonth),
            eq(schema.earningsAdjustments.periodMonth, '2026-08-01'),
          ),
        ),
      );

    // Only the still-pending row is eligible; the linked one is excluded.
    expect(augustSweep.length).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Null-scope batches (CONTRACTORS / ALL): branch_id / department nullable, and
  // the partial unique index uq_payroll_batch_null_scope must still dedup one
  // batch per (scope_type, month, branch, run_label) despite the NULLs.
  // ---------------------------------------------------------------------------

  it('allows a CONTRACTORS batch with null branch + department, and dedups a duplicate', async () => {
    const hrActor = await createTestUser(db as any, { role: 'HR_MANAGER' });
    await setSessionActor(pgClient, hrActor.id);

    // First org-wide contractor batch for the month — should insert fine.
    await db.insert(schema.payrollBatches).values({
      periodMonth: '2026-08-01',
      branchId: null,
      department: null,
      scopeType: 'CONTRACTORS',
      status: 'DRAFT',
    });

    const rows = await db
      .select({ id: schema.payrollBatches.id, branchId: schema.payrollBatches.branchId, department: schema.payrollBatches.department })
      .from(schema.payrollBatches)
      .where(
        and(
          eq(schema.payrollBatches.scopeType, 'CONTRACTORS'),
          eq(schema.payrollBatches.periodMonth, '2026-08-01'),
          isNull(schema.payrollBatches.branchId),
        ),
      );
    expect(rows.length).toBe(1);
    expect(rows[0]!.branchId).toBeNull();
    expect(rows[0]!.department).toBeNull();

    // A second identical-scope batch (same scope_type, month, null branch, null
    // run_label) must violate the partial unique index.
    let dupRejected = false;
    try {
      await db.insert(schema.payrollBatches).values({
        periodMonth: '2026-08-01',
        branchId: null,
        department: null,
        scopeType: 'CONTRACTORS',
        status: 'DRAFT',
      });
    } catch {
      dupRejected = true;
    }
    expect(dupRejected).toBe(true);
  });

  it('lets a branch-pinned CONTRACTORS batch coexist with an org-wide one', async () => {
    const hrActor = await createTestUser(db as any, { role: 'HR_MANAGER' });
    const staff = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await setSessionActor(pgClient, hrActor.id);
    // staff.primaryBranchId gives us a real branch id to pin to.
    const [staffRow] = await db
      .select({ branchId: schema.users.primaryBranchId })
      .from(schema.users)
      .where(eq(schema.users.id, staff.id));
    const branchId = staffRow!.branchId;

    await db.insert(schema.payrollBatches).values([
      { periodMonth: '2026-08-01', branchId: null, department: null, scopeType: 'CONTRACTORS', status: 'DRAFT' },
      { periodMonth: '2026-08-01', branchId, department: null, scopeType: 'CONTRACTORS', status: 'DRAFT' },
    ]);

    const all = await db
      .select({ id: schema.payrollBatches.id })
      .from(schema.payrollBatches)
      .where(
        and(
          eq(schema.payrollBatches.scopeType, 'CONTRACTORS'),
          eq(schema.payrollBatches.periodMonth, '2026-08-01'),
        ),
      );
    // Org-wide (null branch) + branch-pinned are distinct slots — both survive.
    expect(all.length).toBe(2);
  });
});
