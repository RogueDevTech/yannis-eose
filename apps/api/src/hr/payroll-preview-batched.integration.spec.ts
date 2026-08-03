/**
 * Correctness harness for the BATCHED payroll preview fast path.
 *
 * Payroll correctness is non-negotiable, so this proves two invariants against a
 * real DB (skipped when none is configured):
 *
 *  1. `PayrollMetricsService.getStaffMetricsBatched` returns, for every staff,
 *     the SAME delivered/total/cohort/returned counts as the per-member
 *     `getStaffMetrics` — including the OR-attribution edge case where the SAME
 *     order names one staff in BOTH assigned_cs_id and media_buyer_id (must be
 *     counted ONCE, not doubled).
 *
 *  2. The batched `previewSelectionTotal` grand total equals the sum of the
 *     per-member `computePayoutForMember` line totals for the same selection —
 *     i.e. the fast path produces an identical number to the authoritative
 *     per-member compute.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, setSessionActor } from '../test/setup-integration';
import { createTestBranch, createTestUser, createTestOrder } from '../test/factories/order.factory';
import { PayrollMetricsService } from './payroll-metrics.service';
import { PayrollComputeService } from './payroll-compute.service';
import { PayrollBatchService } from './payroll-batch.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

// A CS-department payroll period covering "this order was delivered in-period".
const PERIOD_MONTH = '2026-05-01';
const PERIOD_START = new Date('2026-05-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-05-31T23:59:59.999Z');
const IN_PERIOD = new Date('2026-05-15T12:00:00.000Z');

async function stampOrderDates(
  db: ReturnType<typeof getDb>,
  orderId: string,
  createdAt: Date,
  deliveredAt: Date | null,
) {
  await db
    .update(schema.orders)
    .set({ createdAt, deliveredAt })
    .where(eq(schema.orders.id, orderId));
}

describe.skipIf(SKIP_IF_NO_DB)('Payroll preview — batched fast path parity', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });
  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  it('getStaffMetricsBatched matches per-member getStaffMetrics (incl. OR-dedup)', async () => {
    const metricsSvc = new PayrollMetricsService(db as any);
    const branch = await createTestBranch(db as any);
    const csA = await createTestUser(db as any, { role: 'CS_CLOSER', branchId: branch.id });
    const csB = await createTestUser(db as any, { role: 'CS_CLOSER', branchId: branch.id });

    // csA attributed via assigned_cs_id only.
    const o1 = await createTestOrder(db as any, { status: 'DELIVERED', assignedCsId: csA.id });
    await stampOrderDates(db, o1.orderId, IN_PERIOD, IN_PERIOD);
    // csA attributed via media_buyer_id only.
    const o2 = await createTestOrder(db as any, { status: 'REMITTED', mediaBuyerId: csA.id });
    await stampOrderDates(db, o2.orderId, IN_PERIOD, IN_PERIOD);
    // EDGE CASE: csA in BOTH columns on ONE order — OR counts once; two grouped
    // sums would double it. This is the load-bearing dedup assertion.
    const o3 = await createTestOrder(db as any, {
      status: 'DELIVERED',
      assignedCsId: csA.id,
      mediaBuyerId: csA.id,
    });
    await stampOrderDates(db, o3.orderId, IN_PERIOD, IN_PERIOD);
    // A RETURNED order for csA (delivered-at in period).
    const o4 = await createTestOrder(db as any, { status: 'RETURNED', assignedCsId: csA.id });
    await stampOrderDates(db, o4.orderId, IN_PERIOD, IN_PERIOD);
    // csB: one delivered order.
    const o5 = await createTestOrder(db as any, { status: 'DELIVERED', assignedCsId: csB.id });
    await stampOrderDates(db, o5.orderId, IN_PERIOD, IN_PERIOD);

    const perMemberA = await metricsSvc.getStaffMetrics(
      { staffId: csA.id, staffRole: 'CS_CLOSER', periodStart: PERIOD_START, periodEnd: PERIOD_END },
      db as any,
    );
    const perMemberB = await metricsSvc.getStaffMetrics(
      { staffId: csB.id, staffRole: 'CS_CLOSER', periodStart: PERIOD_START, periodEnd: PERIOD_END },
      db as any,
    );

    const batched = await metricsSvc.getStaffMetricsBatched(
      [csA.id, csB.id],
      PERIOD_START,
      PERIOD_END,
      db as any,
    );

    const bA = batched.get(csA.id)!;
    // csA: o1,o2,o3 delivered (o3 counted ONCE despite both columns) = 3.
    expect(bA.deliveredCount).toBe(3);
    expect(bA.deliveredCount).toBe(perMemberA.deliveredCount);
    expect(bA.totalOrders).toBe(perMemberA.totalOrders);
    expect(bA.deliveredCohortCount).toBe(perMemberA.deliveredCohortCount);
    expect(bA.returnedCount).toBe(perMemberA.returnedCount);
    // Explicit dedup proof: total orders (o1..o4, all non-DELETED, created in-period) = 4.
    expect(bA.totalOrders).toBe(4);
    expect(bA.returnedCount).toBe(1);

    const bB = batched.get(csB.id)!;
    expect(bB.deliveredCount).toBe(perMemberB.deliveredCount);
    expect(bB.totalOrders).toBe(perMemberB.totalOrders);
    expect(bB.deliveredCohortCount).toBe(perMemberB.deliveredCohortCount);
    expect(bB.returnedCount).toBe(perMemberB.returnedCount);
  });

  it('previewSelectionTotal (batched) equals per-member computePayoutForMember sum', async () => {
    const metricsSvc = new PayrollMetricsService(db as any);
    const computeSvc = new PayrollComputeService(metricsSvc);
    const batchSvc = new PayrollBatchService(
      db as any,
      {} as any,
      {} as any,
      computeSvc,
      metricsSvc,
    );

    const branch = await createTestBranch(db as any);
    const actor = await createTestUser(db as any, { role: 'SUPER_ADMIN' });

    // A pay role + PRD formula: flat base + per-delivered bonus + return penalty.
    const [payRole] = await db
      .insert(schema.payrollPayRoles)
      .values({
        id: randomUUID(),
        groupId: branch.groupId,
        name: 'CS Closer (test)',
        category: 'CS',
        defaultTaxStatus: 'GROSS_NO_DEDUCTION',
      })
      .returning({ id: schema.payrollPayRoles.id });

    const formula = {
      schemaVersion: 'payroll_v1',
      flatBaseSalary: 50000,
      penaltyPerReturn: 2000,
      bonusTiers: [
        { metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 0, kind: 'PER_ORDER', amount: 500 },
      ],
      allowances: [{ name: 'Transport', amount: 3000, taxable: false }],
    };
    await db.insert(schema.commissionPlans).values({
      id: randomUUID(),
      planName: 'CS Closer plan (test)',
      payRoleId: payRole!.id,
      rules: formula as unknown as typeof schema.commissionPlans.$inferInsert['rules'],
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      createdBy: actor.id,
    });

    // Two CS closers on the branch, both assigned to the pay role.
    const cs1 = await createTestUser(db as any, { role: 'CS_CLOSER', branchId: branch.id });
    const cs2 = await createTestUser(db as any, { role: 'CS_CLOSER', branchId: branch.id });
    await db
      .update(schema.users)
      .set({ primaryBranchId: branch.id, payRoleId: payRole!.id })
      .where(inArray(schema.users.id, [cs1.id, cs2.id]));

    // Orders driving deliveredCount / DR / returns, including a both-columns order.
    const seed = async (staffId: string, count: number, status: 'DELIVERED' | 'RETURNED', both = false) => {
      for (let i = 0; i < count; i++) {
        const o = await createTestOrder(db as any, {
          status,
          assignedCsId: staffId,
          mediaBuyerId: both ? staffId : undefined,
        });
        await stampOrderDates(db, o.orderId, IN_PERIOD, IN_PERIOD);
      }
    };
    await seed(cs1.id, 4, 'DELIVERED');
    await seed(cs1.id, 1, 'DELIVERED', true); // both-columns delivered (dedup)
    await seed(cs1.id, 1, 'RETURNED');
    await seed(cs2.id, 2, 'DELIVERED');

    // A pending add-on adjustment for cs1 (folds into the payout on both paths).
    await db.insert(schema.earningsAdjustments).values({
      id: randomUUID(),
      staffId: cs1.id,
      amount: '1500',
      category: 'BONUS',
      periodMonth: PERIOD_MONTH,
      reason: 'test bonus',
    });

    await setSessionActor(pgClient, actor.id, branch.id);

    // ---- Batched preview grand total. ----
    const preview = await batchSvc.previewSelectionTotal(
      {
        scopeType: 'DEPARTMENT',
        periodMonth: PERIOD_MONTH,
        department: 'CS',
        branchId: branch.id,
        scopeBranchIds: [branch.id],
      } as any,
      { id: actor.id, role: 'SUPER_ADMIN', currentBranchId: branch.id } as any,
    );

    // ---- Per-member reference total via the authoritative compute path. ----
    // Reuse the SAME public compute the per-member preview uses so the reference
    // is the ground truth, not a reimplementation.
    const members = await db
      .select()
      .from(schema.users)
      .where(and(inArray(schema.users.id, [cs1.id, cs2.id])));

    let referenceTotal = 0;
    for (const m of members) {
      const branchRow = (
        await db
          .select({ groupId: schema.branches.groupId, branchId: schema.branches.id })
          .from(schema.users)
          .innerJoin(schema.branches, eq(schema.branches.id, schema.users.primaryBranchId))
          .where(eq(schema.users.id, m.id))
          .limit(1)
      )[0];
      const line = await computeSvc.computeForMember(
        db as any,
        m as any,
        PERIOD_START,
        PERIOD_END,
        branchRow?.groupId ?? null,
        branchRow?.branchId ?? null,
        { effectiveBranchIds: [branch.id] },
      );
      // Fold the pending add-on the same way computePayoutForMember does.
      const addOn = m.id === cs1.id ? 1500 : 0;
      if (line) {
        const grossPay = line.grossPay + addOn;
        const net = Math.max(0, grossPay - line.payeTax);
        referenceTotal += net;
      }
    }

    expect(preview.staffCount).toBe(2);
    expect(preview.totalAmount).toBeCloseTo(referenceTotal, 2);
    expect(preview.totalAmount).toBeGreaterThan(0);
  });
});
