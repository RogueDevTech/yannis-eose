import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, desc, gte, lte, isNull, isNotNull, count, sum, inArray, sql, exists } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  CreateCommissionPlanInput,
  UpdateCommissionPlanInput,
  ListCommissionPlansInput,
  GeneratePayoutsInput,
  ApprovePayoutInput,
  ListPayoutsInput,
  CreateAdjustmentInput,
  ApproveAdjustmentInput,
  UpdateAdjustmentInput,
  DeleteAdjustmentInput,
  SetSettlementConfigInput,
  PayrollMetrics,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor } from '../common/db/with-actor';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';
import { getManageableRolesForViewer, PayrollBatchService } from './payroll-batch.service';
import { resolveApplicableCommissionPlan } from './commission-plan-resolution';
import { computeEarningsFromPlanRules, resolveClawbackPerReturnAmount } from './commission-rules-math';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { PayrollComputeService, type ComputedPayslipLine } from './payroll-compute.service';
import { PayrollMetricsService } from './payroll-metrics.service';

@Injectable()
export class HrService {
  private readonly logger = new Logger(HrService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly payrollCompute: PayrollComputeService,
    private readonly payrollMetrics: PayrollMetricsService,
    private readonly payrollBatch: PayrollBatchService,
  ) {}

  // ============================================
  // Commission Plans
  // ============================================

  async createCommissionPlan(input: CreateCommissionPlanInput, actor: SessionUser, groupId?: string | null) {
    // Dept-scoped: each Head can only create plans for the roles in their own department.
    // HR Manager and admins can create plans for any role.
    const manageable = getManageableRolesForViewer(actor);
    if (!manageable) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not allowed to manage commission plans.' });
    }
    if (input.role != null && !manageable.includes(input.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You can only create plans for roles in your department: ${manageable.join(', ')}.`,
      });
    }

    if (!groupId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Select a company before managing commission plans. Plans are fully company-isolated.',
      });
    }

    return withActor(this.db, { id: actor.id }, async (tx) => {
      const rows = await tx
        .insert(schema.commissionPlans)
        .values({
          role: input.role,
          groupId,
          planName: input.planName,
          rules: input.rules,
          effectiveFrom: new Date(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
          createdBy: actor.id,
        })
        .returning();

      const plan = rows[0];
      if (!plan) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create commission plan' });
      }
      return plan;
    });
  }

  async updateCommissionPlan(input: UpdateCommissionPlanInput, actor: SessionUser, groupId?: string | null) {
    const manageable = getManageableRolesForViewer(actor);
    if (!manageable) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not allowed to manage commission plans.' });
    }
    if (!groupId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Select a company before managing commission plans. Plans are fully company-isolated.',
      });
    }

    return withActor(this.db, { id: actor.id }, async (tx) => {
      // Authorize the edit against the EXISTING plan's role — Heads can't take over a plan that's
      // outside their dept just because they know the planId.
      const existingRows = await tx
        .select({ role: schema.commissionPlans.role, rules: schema.commissionPlans.rules })
        .from(schema.commissionPlans)
        .where(
          and(
            eq(schema.commissionPlans.id, input.planId),
            eq(schema.commissionPlans.groupId, groupId),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Commission plan not found in this company' });
      }
      if (existing.role != null && !manageable.includes(existing.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `You can only edit plans for roles in your department: ${manageable.join(', ')}.`,
        });
      }

      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.planName !== undefined) updateFields['planName'] = input.planName;
      if (input.rules !== undefined) {
        const prior = existing.rules;
        const merged =
          prior && typeof prior === 'object' && !Array.isArray(prior)
            ? { ...(prior as Record<string, unknown>), ...(input.rules as Record<string, unknown>) }
            : input.rules;
        updateFields['rules'] = merged;
      }
      if (input.effectiveTo !== undefined) updateFields['effectiveTo'] = new Date(input.effectiveTo);

      const rows = await tx
        .update(schema.commissionPlans)
        .set(updateFields)
        .where(
          and(
            eq(schema.commissionPlans.id, input.planId),
            eq(schema.commissionPlans.groupId, groupId),
          ),
        )
        .returning();

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Commission plan not found in this company' });
      }
      return rows[0];
    });
  }

  async listCommissionPlans(input: ListCommissionPlansInput, viewer: SessionUser, groupId?: string | null) {
    const conditions = [];

    // Exact company isolation — never include null/global shared plans.
    if (!groupId) {
      return { plans: [], pagination: { page: input.page, limit: input.limit, total: 0 }, manageableRoles: [] as string[] };
    }
    conditions.push(eq(schema.commissionPlans.groupId, groupId));

    // Auto-scope by viewer: Heads only see plans for their dept; admins/HR see everything.
    const manageable = getManageableRolesForViewer(viewer);
    if (!manageable) {
      // Non-manager roles get an empty list rather than an error — keeps the page safe to render.
      return { plans: [], pagination: { page: input.page, limit: input.limit, total: 0 }, manageableRoles: [] as string[] };
    }
    // Admin / SuperAdmin / HR Manager get full scope (manageable returns the union of all dept roles).
    // Heads get only their dept's roles, so we filter by them.
    const isFullScope = viewer.role === 'SUPER_ADMIN' || viewer.role === 'ADMIN' || viewer.role === 'HR_MANAGER';
    if (!isFullScope) {
      conditions.push(
        or(isNull(schema.commissionPlans.role), inArray(schema.commissionPlans.role, manageable as never)),
      );
    }

    if (input.unassignedRoleOnly) {
      conditions.push(isNull(schema.commissionPlans.role));
    } else if (input.role) {
      // Caller filter — must intersect the viewer's manageable set
      if (!isFullScope && !manageable.includes(input.role)) {
        return { plans: [], pagination: { page: input.page, limit: input.limit, total: 0 }, manageableRoles: manageable };
      }
      conditions.push(eq(schema.commissionPlans.role, input.role as never));
    }
    if (input.activeOnly) {
      conditions.push(
        lte(schema.commissionPlans.effectiveFrom, new Date()),
      );
      // effectiveTo is null (no end) or in the future
      conditions.push(
        or(isNull(schema.commissionPlans.effectiveTo), gte(schema.commissionPlans.effectiveTo, new Date())),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [plans, totalRows] = await Promise.all([
      this.db.select().from(schema.commissionPlans).where(whereClause)
        .orderBy(desc(schema.commissionPlans.effectiveFrom))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.commissionPlans).where(whereClause),
    ]);

    return {
      plans,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
      manageableRoles: manageable,
    };
  }

  // ============================================
  // Payouts
  // ============================================

  async generatePayouts(input: GeneratePayoutsInput, actorId: string, effectiveBranchIds?: string[] | null) {
    return withActor(this.db, { id: actorId }, async (tx) => {
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    // Get all active staff members, scoped to the active branch group when set
    const staffConditions: Parameters<typeof and>[0][] = [eq(schema.users.status, 'ACTIVE')];
    if (effectiveBranchIds?.length) {
      staffConditions.push(
        exists(
          tx.select({ one: sql`1` })
            .from(schema.userBranches)
            .where(and(
              eq(schema.userBranches.userId, schema.users.id),
              inArray(schema.userBranches.branchId, effectiveBranchIds),
            )),
        ),
      );
    }
    const staff = await tx
      .select()
      .from(schema.users)
      .where(and(...staffConditions));

    const payouts = [];

    for (const member of staff) {
      // Pay count by `deliveredAt` — staff get credited in the period their
      // delivery actually closed, so cross-period orders aren't lost.
      // Include REMITTED — once the accountant marks remittance received, the
      // status flips DELIVERED→REMITTED but the delivery still happened. If
      // payroll runs after that flip, status='DELIVERED' alone would silently
      // drop the order from the pay count and lose the agent's commission.
      const deliveredRows = await tx
        .select({ count: count(), revenue: sum(schema.orders.totalAmount) })
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.deliveredAt, periodStart),
            lte(schema.orders.deliveredAt, periodEnd),
            or(
              eq(schema.orders.assignedCsId, member.id),
              eq(schema.orders.mediaBuyerId, member.id),
            ),
          ),
        );

      // DELETED orders are editorial removals (test/fake/mistake), not real
      // workload, so they never enter a rate denominator.
      const totalOrdersRows = await tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            sql`${schema.orders.status} <> 'DELETED'`,
            gte(schema.orders.createdAt, periodStart),
            lte(schema.orders.createdAt, periodEnd),
            or(
              eq(schema.orders.assignedCsId, member.id),
              eq(schema.orders.mediaBuyerId, member.id),
            ),
          ),
        );

      // Cohort delivered (created in period AND now delivered) — feeds the
      // bonus-threshold rate so it can't exceed 100% on cross-period leakage.
      const deliveredCohortRows = await tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.createdAt, periodStart),
            lte(schema.orders.createdAt, periodEnd),
            or(
              eq(schema.orders.assignedCsId, member.id),
              eq(schema.orders.mediaBuyerId, member.id),
            ),
          ),
        );

      const returnedRows = await tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.status, 'RETURNED'),
            gte(schema.orders.deliveredAt, periodStart),
            lte(schema.orders.deliveredAt, periodEnd),
            or(
              eq(schema.orders.assignedCsId, member.id),
              eq(schema.orders.mediaBuyerId, member.id),
            ),
          ),
        );

      const deliveredCount = deliveredRows[0]?.count ?? 0;
      const totalOrders = totalOrdersRows[0]?.count ?? 0;
      const deliveredCohortCount = deliveredCohortRows[0]?.count ?? 0;
      const returnedCount = returnedRows[0]?.count ?? 0;

      const plan = await resolveApplicableCommissionPlan(tx, {
        commissionPlanId: member.commissionPlanId ?? null,
        staffRole: member.role,
        rangeStart: periodStart,
        rangeEnd: periodEnd,
      });
      if (!plan) continue;

      const { baseSalary, performanceBonus, penalties } = computeEarningsFromPlanRules(plan.rules, {
        deliveredCount,
        totalOrders,
        returnedCount,
        deliveredCohortCount,
      });

      // Get pending deductions (clawbacks from previous returns + manual deductions/fines).
      // Deduction-category amounts are stored negative, so abs() gives the amount owed.
      // Approved only (approved_by IS NOT NULL): unapproved/rejected adjustments must
      // never reach payroll.
      const deductionRows = await tx
        .select({ total: sum(schema.earningsAdjustments.amount) })
        .from(schema.earningsAdjustments)
        .where(
          and(
            eq(schema.earningsAdjustments.staffId, member.id),
            inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
            isNotNull(schema.earningsAdjustments.approvedBy),
            isNull(schema.earningsAdjustments.payoutId),
          ),
        );

      const clawbackTotal = Math.abs(Number(deductionRows[0]?.total ?? 0));

      // Get add-ons for this period (approved only — approvedBy is not null)
      const addOnsRows = await tx
        .select({ total: sum(schema.earningsAdjustments.amount) })
        .from(schema.earningsAdjustments)
        .where(
          and(
            eq(schema.earningsAdjustments.staffId, member.id),
            isNotNull(schema.earningsAdjustments.approvedBy),
            isNull(schema.earningsAdjustments.payoutId),
            // Exclude clawbacks — they're handled separately
            eq(schema.earningsAdjustments.category, 'BONUS'),
          ),
        );

      // Also get other positive add-on categories
      const otherAddOnsRows = await tx
        .select({ total: sum(schema.earningsAdjustments.amount) })
        .from(schema.earningsAdjustments)
        .where(
          and(
            eq(schema.earningsAdjustments.staffId, member.id),
            isNotNull(schema.earningsAdjustments.approvedBy),
            isNull(schema.earningsAdjustments.payoutId),
            or(
              eq(schema.earningsAdjustments.category, 'EXTRA_SHIFT'),
              eq(schema.earningsAdjustments.category, 'PERFORMANCE'),
              eq(schema.earningsAdjustments.category, 'OTHER'),
            ),
          ),
        );

      const addOnsTotal = Number(addOnsRows[0]?.total ?? 0) + Number(otherAddOnsRows[0]?.total ?? 0);
      const deductionsTotal = penalties + clawbackTotal;

      // Cap at zero — staff can't owe the company
      const totalPayout = Math.max(0, baseSalary + performanceBonus + addOnsTotal - deductionsTotal);

      // Only create payout if there's something to pay or deduct
      if (totalPayout > 0 || deductionsTotal > 0 || baseSalary > 0) {
        const payoutRows = await tx
          .insert(schema.payoutRecords)
          .values({
            staffId: member.id,
            periodStart,
            periodEnd,
            baseSalary: sql`${baseSalary}::numeric`,
            performanceBonus: sql`${performanceBonus}::numeric`,
            addOnsTotal: sql`${addOnsTotal}::numeric`,
            deductionsTotal: sql`${deductionsTotal}::numeric`,
            totalPayout: sql`${totalPayout}::numeric`,
            status: 'DRAFT',
          })
          .returning();

        if (payoutRows[0]) {
          payouts.push(payoutRows[0]);
        }
      }
    }

    return { generated: payouts.length, payouts };
    });
  }

  async approvePayout(input: ApprovePayoutInput, actorId: string) {
    const payout = await withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .update(schema.payoutRecords)
        .set({ status: input.status as typeof schema.payoutRecords.$inferInsert['status'] })
        .where(eq(schema.payoutRecords.id, input.payoutId))
        .returning();

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Payout record not found' });
      }
      return rows[0];
    });

    if (input.status === 'APPROVED') {
      // Look up the batch's branchId for notification group isolation
      const [batchRow] = payout.batchId
        ? await this.db
            .select({ branchId: schema.payrollBatches.branchId })
            .from(schema.payrollBatches)
            .where(eq(schema.payrollBatches.id, payout.batchId))
            .limit(1)
        : [undefined];

      if (payout.staffId) {
        this.notifications.enqueueCreate({
          userId: payout.staffId,
          type: 'hr:payout_approved',
          title: 'Payout approved',
          body: `Your payout for the period has been approved.`,
          data: { payoutId: payout.id, totalPayout: payout.totalPayout, branchId: batchRow?.branchId ?? null },
        });
      }
    }

    return payout;
  }

  async listPayouts(input: ListPayoutsInput, viewer?: SessionUser, effectiveBranchIds?: string[] | null) {
    const conditions = [];
    if (input.staffId) {
      conditions.push(eq(schema.payoutRecords.staffId, input.staffId));
    }

    // Company-group isolation: scope to payouts whose staff belong to a branch
    // in the active group. Mirrors getPayoutSummary — without this, a
    // group-scoped viewer sees payouts from every company. (Pillar 2/4.)
    if (effectiveBranchIds?.length) {
      conditions.push(
        sql`${schema.payoutRecords.staffId} IN (SELECT user_id FROM user_branches WHERE branch_id IN (${sql.join(effectiveBranchIds.map(id => sql`${id}`), sql`, `)}))`,
      );
    }
    if (input.status) {
      conditions.push(eq(schema.payoutRecords.status, input.status as typeof schema.payoutRecords.$inferSelect['status']));
    }
    if (input.periodStart) {
      conditions.push(gte(schema.payoutRecords.periodStart, new Date(input.periodStart)));
    }
    if (input.periodEnd) {
      conditions.push(lte(schema.payoutRecords.periodEnd, new Date(input.periodEnd)));
    }

    // HR_MANAGER scoped to a branch (CEO 2026-05-19) sees only payouts whose
    // parent payroll batch belongs to their branch. SuperAdmin / unassigned
    // HR / Finance keep the org-wide view.
    if (viewer?.role === 'HR_MANAGER' && viewer.currentBranchId) {
      const branchBatches = this.db
        .select({ id: schema.payrollBatches.id })
        .from(schema.payrollBatches)
        .where(eq(schema.payrollBatches.branchId, viewer.currentBranchId));
      conditions.push(inArray(schema.payoutRecords.batchId, branchBatches));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [payouts, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.payoutRecords.id,
          batchId: schema.payoutRecords.batchId,
          staffId: schema.payoutRecords.staffId,
          periodStart: schema.payoutRecords.periodStart,
          periodEnd: schema.payoutRecords.periodEnd,
          baseSalary: schema.payoutRecords.baseSalary,
          performanceBonus: schema.payoutRecords.performanceBonus,
          addOnsTotal: schema.payoutRecords.addOnsTotal,
          deductionsTotal: schema.payoutRecords.deductionsTotal,
          totalPayout: schema.payoutRecords.totalPayout,
          status: schema.payoutRecords.status,
          createdAt: schema.payoutRecords.createdAt,
          validFrom: schema.payoutRecords.validFrom,
          validTo: schema.payoutRecords.validTo,
          modifiedBy: schema.payoutRecords.modifiedBy,
        })
        .from(schema.payoutRecords)
        .where(whereClause)
        .orderBy(desc(schema.payoutRecords.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.payoutRecords).where(whereClause),
    ]);

    return {
      payouts,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async getPayoutSummary(effectiveBranchIds?: string[] | null, dateRange?: { startDate?: string; endDate?: string }) {
    const conditions: Parameters<typeof and>[0][] = [];
    if (effectiveBranchIds?.length) {
      conditions.push(
        sql`${schema.payoutRecords.staffId} IN (SELECT user_id FROM user_branches WHERE branch_id IN (${sql.join(effectiveBranchIds.map(id => sql`${id}`), sql`, `)}))`,
      );
    }
    if (dateRange?.startDate) conditions.push(gte(schema.payoutRecords.createdAt, nigeriaDayStart(dateRange.startDate)));
    if (dateRange?.endDate) conditions.push(lte(schema.payoutRecords.createdAt, nigeriaDayEnd(dateRange.endDate)));
    const results = await this.db
      .select({
        status: schema.payoutRecords.status,
        count: count(),
        total: sum(schema.payoutRecords.totalPayout),
      })
      .from(schema.payoutRecords)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(schema.payoutRecords.status);

    const summary: Record<string, { count: number; total: string }> = {};
    for (const row of results) {
      summary[row.status] = { count: row.count, total: row.total ?? '0' };
    }
    return summary;
  }

  /** Count of users with status='ACTIVE' (all roles). CEO dashboard widget. */
  async countActiveStaff(effectiveBranchIds?: string[] | null): Promise<number> {
    if (effectiveBranchIds?.length) {
      const [row] = await this.db
        .select({ count: sql<number>`COUNT(DISTINCT ${schema.userBranches.userId})` })
        .from(schema.userBranches)
        .innerJoin(schema.users, eq(schema.users.id, schema.userBranches.userId))
        .where(and(
          eq(schema.users.status, 'ACTIVE'),
          inArray(schema.userBranches.branchId, effectiveBranchIds),
        ));
      return Number(row?.count ?? 0);
    }
    const [row] = await this.db
      .select({ count: count() })
      .from(schema.users)
      .where(eq(schema.users.status, 'ACTIVE'));
    return row?.count ?? 0;
  }

  // ============================================
  // Clawback Engine
  // ============================================

  /**
   * Called when an order transitions to RETURNED.
   * Creates PENDING_DEDUCTION for both Media Buyer and Sales Closer.
   */
  async createClawbackForReturn(orderId: string, actorId: string) {
    const clawbacks = await withActor(this.db, { id: actorId }, async (tx) => {
      const notifications: Array<{ staffId: string; amount: number }> = [];

      // Get the order to find affected staff
      const orderRows = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);

      const order = orderRows[0];
      if (!order) return notifications;

      const affectedStaff: string[] = [];
      if (order.assignedCsId) affectedStaff.push(order.assignedCsId);
      if (order.mediaBuyerId && order.mediaBuyerId !== order.assignedCsId) {
        affectedStaff.push(order.mediaBuyerId);
      }

      // Get applicable penalty rate from their commission plans
      for (const staffId of affectedStaff) {
        const userRows = await tx
          .select({ role: schema.users.role, commissionPlanId: schema.users.commissionPlanId })
          .from(schema.users)
          .where(eq(schema.users.id, staffId))
          .limit(1);

        const role = userRows[0]?.role;
        if (!role) continue;

        const at = new Date();
        const plan = await resolveApplicableCommissionPlan(tx, {
          commissionPlanId: userRows[0]?.commissionPlanId ?? null,
          staffRole: role,
          rangeStart: at,
          rangeEnd: at,
        });
        const clawbackAmount = resolveClawbackPerReturnAmount(plan?.rules);
        if (clawbackAmount <= 0) continue;

        await tx
          .insert(schema.earningsAdjustments)
          .values({
            staffId,
            amount: sql`${-clawbackAmount}::numeric`,
            category: 'CLAWBACK',
            reason: `Return clawback for order ${orderId.slice(0, 8)}`,
          });

        notifications.push({ staffId, amount: clawbackAmount });
      }

      return notifications;
    });

    // Emit notifications outside the transaction
    for (const { staffId, amount } of clawbacks) {
      this.events.emitToUser(staffId, 'hr:clawback', { orderId, amount });
    }
  }

  /**
   * Preview payout for a staff member without creating it.
   *
   * Uses the same resolution as batch payroll (PayrollComputeService): the
   * assigned pay role's formula wins, then personal plan, then role default,
   * and FLAT_RATE basis is honored. Keeping this aligned is what makes the
   * profile Earnings tab match Payroll Config base salaries.
   */
  async previewPayout(staffId: string, periodStart: string, periodEnd: string) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid earnings period dates' });
    }

    const userRows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, staffId))
      .limit(1);

    const user = userRows[0];
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Staff not found' });
    }

    // Company scope for product tiers + PAYE config comes from the staff's
    // primary branch. For Head roles, the team-DR bonus basis counts reportees
    // across the whole company (all branches sharing the staff's groupId), not
    // just the staff's primary branch — multi-branch teams otherwise under-count.
    let groupId: string | null = null;
    let effectiveBranchIds: string[] | null = null;
    if (user.primaryBranchId) {
      const [branch] = await this.db
        .select({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(eq(schema.branches.id, user.primaryBranchId))
        .limit(1);
      groupId = branch?.groupId ?? null;
      if (groupId) {
        const companyBranches = await this.db
          .select({ id: schema.branches.id })
          .from(schema.branches)
          .where(eq(schema.branches.groupId, groupId));
        effectiveBranchIds = companyBranches.map((b) => b.id);
      }
    }

    let computed: ComputedPayslipLine | null = null;
    let computeError: string | null = null;
    try {
      computed = await this.payrollCompute.computeForMember(
        this.db,
        {
          id: user.id,
          role: user.role,
          commissionPlanId: user.commissionPlanId ?? null,
          payRoleId: user.payRoleId ?? null,
          salaryBasis: user.salaryBasis ?? null,
          taxStatus: user.taxStatus ?? null,
          flatMonthlyAmount: user.flatMonthlyAmount != null ? Number(user.flatMonthlyAmount) : null,
        },
        start,
        end,
        groupId,
        user.primaryBranchId ?? null,
        // Team-DR is required for Head bonus/subsidy tiers (they're keyed on
        // TEAM_DR). It's cheap (one reportee lookup + two counts), so the Outlook
        // computes it too — scoped company-wide so multi-branch teams count.
        { effectiveBranchIds },
      );
    } catch (err) {
      computeError = err instanceof Error ? err.message : 'Payroll formula failed';
      this.logger.warn(
        `previewPayout compute failed for staff=${staffId}: ${computeError}`,
        err instanceof Error ? err.stack : undefined,
      );
    }

    // Staff with no resolvable plan still get their real order metrics shown.
    let metrics: PayrollMetrics | null = computed?.metricsSnapshot ?? null;
    if (!metrics) {
      try {
        metrics = await this.payrollMetrics.getStaffMetrics({
          staffId: user.id,
          staffRole: user.role,
          periodStart: start,
          periodEnd: end,
          crmLinked: true,
        });
      } catch {
        metrics = null;
      }
    }
    const deliveredCount = metrics?.deliveredCount ?? 0;
    const deliveredCarryOverCount = metrics?.deliveredCarryOverCount ?? 0;
    const deliveredCohortCount = metrics?.deliveredCohortCount ?? 0;
    const totalOrders = metrics?.totalOrders ?? 0;
    const returnedCount = metrics?.returnedCount ?? 0;
    const deliveryRate = metrics?.individualDr ?? 0;
    const baseSalary = Number(computed?.baseSalary ?? 0) || 0;
    const performanceBonus = Number(computed?.performanceBonus ?? 0) || 0;
    const allowancesTotal = Number(computed?.allowancesTotal ?? 0) || 0;
    const penalties = Number(computed?.deductionsTotal ?? 0) || 0;

    let planName = computed?.payRoleName ?? 'No plan assigned';
    if (!computed && user.payRoleId) {
      const [roleRow] = await this.db
        .select({ name: schema.payrollPayRoles.name })
        .from(schema.payrollPayRoles)
        .where(eq(schema.payrollPayRoles.id, user.payRoleId))
        .limit(1);
      planName = roleRow
        ? `${roleRow.name}${computeError ? ' (estimate unavailable)' : ' (formula not linked yet)'}`
        : 'Pay role assigned (formula not linked yet)';
    } else if (computeError && !computed) {
      planName = 'Estimate unavailable';
    }

    const [pendingClawbacks, bonusRows, otherAddOnRows] = await Promise.all([
      this.db
        .select({ total: sum(schema.earningsAdjustments.amount) })
        .from(schema.earningsAdjustments)
        .where(
          and(
            eq(schema.earningsAdjustments.staffId, staffId),
            inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
            isNull(schema.earningsAdjustments.payoutId),
          ),
        ),
      this.db
        .select({ total: sum(schema.earningsAdjustments.amount) })
        .from(schema.earningsAdjustments)
        .where(
          and(
            eq(schema.earningsAdjustments.staffId, staffId),
            eq(schema.earningsAdjustments.category, 'BONUS'),
            isNull(schema.earningsAdjustments.payoutId),
          ),
        ),
      this.db
        .select({ total: sum(schema.earningsAdjustments.amount) })
        .from(schema.earningsAdjustments)
        .where(
          and(
            eq(schema.earningsAdjustments.staffId, staffId),
            isNull(schema.earningsAdjustments.payoutId),
            or(
              eq(schema.earningsAdjustments.category, 'EXTRA_SHIFT'),
              eq(schema.earningsAdjustments.category, 'PERFORMANCE'),
              eq(schema.earningsAdjustments.category, 'OTHER'),
            ),
          ),
        ),
    ]);
    const clawbackTotal = Math.abs(Number(pendingClawbacks[0]?.total ?? 0));
    const addOnsTotal = Number(bonusRows[0]?.total ?? 0) + Number(otherAddOnRows[0]?.total ?? 0);

    const deductionsTotal = penalties + clawbackTotal;
    const totalPayout = Math.max(
      0,
      baseSalary + performanceBonus + allowancesTotal + addOnsTotal - deductionsTotal,
    );

    return {
      staffId,
      staffName: user.name,
      role: user.role,
      planName,
      deliveredCount,
      /** Slice of deliveredCount generated before this period; included in per-order bonus. */
      deliveredCarryOverCount,
      /** Delivered orders whose created_at falls in this period (DR numerator). */
      deliveredCohortCount,
      totalOrders,
      returnedCount,
      deliveryRate,
      baseSalary,
      performanceBonus,
      allowancesTotal,
      addOnsTotal,
      penalties,
      clawbacks: clawbackTotal,
      deductionsTotal,
      totalPayout,
    };
  }

  // ============================================
  // Earnings Adjustments (Add-ons)
  // ============================================

  async createAdjustment(input: CreateAdjustmentInput, actorId: string) {
    const adj = await withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.earningsAdjustments)
        .values({
          staffId: input.staffId ?? null,
          contractorId: input.contractorId ?? null,
          amount: sql`${input.amount}::numeric`,
          category: input.category,
          reason: input.reason,
          periodMonth: input.periodMonth ?? null,
        })
        .returning();

      const inserted = rows[0];
      if (!inserted) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create adjustment' });
      }
      return inserted;
    });

    // Notify staff when clawback/deduction is created (they need to know).
    // Contractors are external and have no app account to notify.
    const isDeduction = ['CLAWBACK', 'DEDUCTION'].includes(input.category) || Number(input.amount) < 0;
    if (isDeduction && input.staffId) {
      // Look up the staff's primary branch for notification group isolation
      const [staffBranch] = await this.db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(and(eq(schema.userBranches.userId, input.staffId), eq(schema.userBranches.isPrimary, true)))
        .limit(1);

      this.notifications.enqueueCreate({
        userId: input.staffId,
        type: 'hr:deduction_created',
        title: 'Deduction added',
        body: 'A deduction has been added to your earnings. It will be applied to your next payout.',
        data: { adjustmentId: adj.id, amount: input.amount, category: input.category, branchId: staffBranch?.branchId ?? null },
      });
    }

    // If this adjustment is earmarked for a month that already has an OPEN batch
    // (DRAFT / PENDING_HR) with a line for this staff member OR contractor, fold it
    // in now instead of leaving it floating until the next run. The absorb helper
    // only acts on APPROVED rows, so this is a no-op for the common case where the
    // adjustment still needs approval — approveAdjustment then does the absorb.
    // Best-effort and non-fatal: on any miss the adjustment stays pending and the
    // next generate/recalculate sweeps it.
    if ((input.staffId || input.contractorId) && input.periodMonth) {
      try {
        await this.payrollBatch.absorbPendingStaffAdjustment(adj.id, actorId);
      } catch (err) {
        this.logger.warn(
          `absorbPendingStaffAdjustment failed for ${adj.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return adj;
  }

  async approveAdjustment(input: ApproveAdjustmentInput, actorId: string) {
    // When unapproving a row that was already folded into an open batch, we also
    // detach it (clear payout_id) so the batch stops counting it. Capture the
    // linkage before the update. Guard: don't unapprove a row whose batch has left
    // HR (Finance review / PAID) — those numbers are committed.
    let detachPayoutId: string | null = null;
    if (!input.approved) {
      const existing = await this.loadCorrectableAdjustment(input.adjustmentId);
      detachPayoutId = existing.payoutId ?? null;
    }

    const row = await withActor(this.db, { id: actorId }, async (tx) => {
      // earnings_adjustments has no rejected_by/rejected_at columns — "rejected"
      // is represented by approved_by staying NULL (see pendingAdjustmentForMonth,
      // which requires approved_by IS NOT NULL). Approving sets approvedBy;
      // rejecting/unapproving clears it and detaches any open-batch link so the row
      // is excluded from batch sweeps and no longer counted in the batch total.
      const updateFields: Record<string, unknown> = input.approved
        ? { approvedBy: actorId }
        : { approvedBy: null, payoutId: null };

      const rows = await tx
        .update(schema.earningsAdjustments)
        .set(updateFields)
        .where(eq(schema.earningsAdjustments.id, input.adjustmentId))
        .returning();

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Adjustment not found' });
      }
      return rows[0];
    });

    // Approval is the correct moment to fold a late adjustment into an already-open
    // batch: the absorb helper only acts on APPROVED rows. Covers both staff and
    // contractors; earmarked (period_month) + still-floating (payout_id NULL) only.
    // Best-effort and non-fatal — on any miss the next generate/recalculate sweeps.
    if (input.approved && row.periodMonth && !row.payoutId) {
      try {
        await this.payrollBatch.absorbPendingStaffAdjustment(row.id, actorId);
      } catch (err) {
        this.logger.warn(
          `absorbPendingStaffAdjustment failed for ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // If unapproving detached the row from an open batch, re-roll that payout so
    // the batch total drops it. Best-effort and non-fatal.
    if (!input.approved && detachPayoutId) {
      try {
        await this.payrollBatch.recomputeForAdjustment(detachPayoutId, actorId);
      } catch (err) {
        this.logger.warn(
          `recomputeForAdjustment failed after unapprove of ${row.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Notify staff when add-on/bonus is approved (or clawback/deduction is applied).
    // Contractors are external (no app account) — nothing to notify.
    if (input.approved && row.staffId) {
      const staffUserId = row.staffId;
      // Look up the staff's primary branch for notification group isolation
      const [staffBranch] = await this.db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(and(eq(schema.userBranches.userId, staffUserId), eq(schema.userBranches.isPrimary, true)))
        .limit(1);

      const isDeduction = Number(row.amount) < 0 || ['CLAWBACK', 'DEDUCTION'].includes(row.category);
      this.notifications.enqueueCreate({
        userId: staffUserId,
        type: isDeduction ? 'hr:deduction_applied' : 'hr:addon_approved',
        title: isDeduction ? 'Deduction applied' : 'Add-on approved',
        body: isDeduction
          ? 'A deduction has been applied to your earnings.'
          : 'Your add-on earnings have been approved.',
        data: { adjustmentId: row.id, amount: row.amount, category: row.category, branchId: staffBranch?.branchId ?? null },
      });
    }

    return row;
  }

  /**
   * Batch statuses at which an adjustment is locked from HR edit/delete. Editing is
   * allowed while the adjustment is floating or sitting in a DRAFT / PENDING_HR
   * batch; once it advances to Finance review (PENDING_FINANCE) or is PAID, the
   * numbers are committed and can no longer be corrected here.
   */
  private static readonly ADJUSTMENT_LOCKED_STATUSES = ['PENDING_FINANCE', 'PAID'] as const;

  /** Load an adjustment and throw if it can't be corrected (missing or locked in a finalized batch). */
  private async loadCorrectableAdjustment(adjustmentId: string) {
    const rows = await this.db
      .select()
      .from(schema.earningsAdjustments)
      .where(eq(schema.earningsAdjustments.id, adjustmentId))
      .limit(1);
    const adj = rows[0];
    if (!adj) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Adjustment not found' });
    }
    const batchStatus = await this.payrollBatch.getAdjustmentBatchStatus(adjustmentId);
    // Orphaned: the adjustment still points at a payout line but the join to the
    // batch resolves nothing — the batch is gone (e.g. a manual DB delete that
    // bypassed deleteBatch, which normally detaches adjustments first). Editing or
    // deleting here would try to recompute a payout with no batch, so block it and
    // surface the inconsistency rather than mutating an orphaned record.
    if (adj.payoutId && batchStatus === null) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'This adjustment is attached to a payroll batch that no longer exists. It can no longer be edited or deleted here.',
      });
    }
    if (batchStatus && (HrService.ADJUSTMENT_LOCKED_STATUSES as readonly string[]).includes(batchStatus)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'This adjustment is already in a payroll batch under Finance review or paid, so it can no longer be edited or deleted.',
      });
    }
    return adj;
  }

  async updateAdjustment(input: UpdateAdjustmentInput, actorId: string) {
    const existing = await this.loadCorrectableAdjustment(input.adjustmentId);

    const updated = await withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .update(schema.earningsAdjustments)
        .set({
          amount: sql`${input.amount}::numeric`,
          category: input.category,
          reason: input.reason,
          periodMonth: input.periodMonth ?? null,
        })
        .where(eq(schema.earningsAdjustments.id, input.adjustmentId))
        .returning();
      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Adjustment not found' });
      }
      return rows[0];
    });

    // If it's linked to an open (DRAFT / PENDING_HR) batch, re-roll that payout so
    // the edited amount is reflected. Best-effort: non-fatal on any recompute miss.
    if (existing.payoutId) {
      try {
        await this.payrollBatch.recomputeForAdjustment(existing.payoutId, actorId);
      } catch (err) {
        this.logger.warn(
          `recomputeForAdjustment failed for ${input.adjustmentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return updated;
  }

  async deleteAdjustment(input: DeleteAdjustmentInput, actorId: string) {
    const existing = await this.loadCorrectableAdjustment(input.adjustmentId);

    await withActor(this.db, { id: actorId }, async (tx) => {
      await tx
        .delete(schema.earningsAdjustments)
        .where(eq(schema.earningsAdjustments.id, input.adjustmentId));
    });

    // Re-roll the payout it was attached to (if any) now that the row is gone.
    if (existing.payoutId) {
      try {
        await this.payrollBatch.recomputeForAdjustment(existing.payoutId, actorId);
      } catch (err) {
        this.logger.warn(
          `recomputeForAdjustment failed after delete of ${input.adjustmentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { deleted: true };
  }

  async listAdjustments(staffId?: string, effectiveBranchIds?: string[] | null) {
    const conditions: Parameters<typeof and>[0][] = [];
    if (staffId) {
      conditions.push(eq(schema.earningsAdjustments.staffId, staffId));
    }
    if (effectiveBranchIds?.length) {
      // Match staff rows via user_branches, and contractor rows via the
      // contractor's own branch (contractors have no user_branches entry).
      conditions.push(
        or(
          exists(
            this.db.select({ one: sql`1` })
              .from(schema.userBranches)
              .where(and(
                sql`${schema.userBranches.userId} = ${schema.earningsAdjustments.staffId}`,
                inArray(schema.userBranches.branchId, effectiveBranchIds),
              )),
          ),
          exists(
            this.db.select({ one: sql`1` })
              .from(schema.payrollContractors)
              .where(and(
                sql`${schema.payrollContractors.id} = ${schema.earningsAdjustments.contractorId}`,
                inArray(schema.payrollContractors.branchId, effectiveBranchIds),
              )),
          ),
        )!,
      );
    }

    const adjustments = await this.db
      .select({
        adjustment: schema.earningsAdjustments,
        // Status of the batch this adjustment is linked to (NULL when floating).
        // Lets the UI decide whether Edit/Delete is still allowed without a second
        // round-trip. LEFT joins keep floating adjustments in the result.
        batchStatus: schema.payrollBatches.status,
      })
      .from(schema.earningsAdjustments)
      .leftJoin(schema.payoutRecords, eq(schema.payoutRecords.id, schema.earningsAdjustments.payoutId))
      .leftJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.earningsAdjustments.createdAt))
      .limit(50);

    // Flatten the joined shape back to a single adjustment row + batchStatus so
    // callers keep the same field access as before, plus the new lock signal.
    return adjustments.map((r) => ({ ...r.adjustment, batchStatus: r.batchStatus ?? null }));
  }

  // ============================================
  // Settlement Window Config
  // ============================================

  async setSettlementConfig(input: SetSettlementConfigInput, actorId: string, groupId?: string | null) {
    if (!groupId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Select a company before managing settlement config. Config is fully company-isolated.',
      });
    }
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.settlementConfigs)
        .values({
          windowType: input.windowType,
          startDay: input.startDay,
          createdBy: actorId,
          groupId,
        })
        .returning();

      const config = rows[0];
      if (!config) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create settlement config' });
      }
      return config;
    });
  }

  async getActiveSettlementConfig(groupId?: string | null) {
    if (!groupId) return null;
    const rows = await this.db
      .select()
      .from(schema.settlementConfigs)
      .where(eq(schema.settlementConfigs.groupId, groupId))
      .orderBy(desc(schema.settlementConfigs.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  async listSettlementConfigs(groupId?: string | null) {
    if (!groupId) return [];
    return this.db
      .select()
      .from(schema.settlementConfigs)
      .where(eq(schema.settlementConfigs.groupId, groupId))
      .orderBy(desc(schema.settlementConfigs.createdAt));
  }

  /**
   * Calculate the current settlement period based on the active config.
   * Returns { periodStart, periodEnd } in ISO date strings.
   */
  async getCurrentSettlementPeriod(groupId?: string | null): Promise<{ periodStart: string; periodEnd: string; windowType: string } | null> {
    const config = await this.getActiveSettlementConfig(groupId);
    if (!config) return null;

    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    switch (config.windowType) {
      case 'WEEKLY': {
        // startDay: 1=Monday, 7=Sunday
        const currentDay = now.getDay() || 7; // Convert 0 (Sunday) to 7
        const diff = currentDay - config.startDay;
        periodStart = new Date(now);
        periodStart.setDate(now.getDate() - (diff >= 0 ? diff : diff + 7));
        periodStart.setHours(0, 0, 0, 0);
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodStart.getDate() + 6);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      }
      case 'BIWEEKLY': {
        const currentDay = now.getDay() || 7;
        const diff = currentDay - config.startDay;
        periodStart = new Date(now);
        periodStart.setDate(now.getDate() - (diff >= 0 ? diff : diff + 7));
        // Go back to the nearest biweekly start (every 14 days from epoch)
        const daysSinceEpoch = Math.floor(periodStart.getTime() / 86400000);
        const biweeklyOffset = daysSinceEpoch % 14;
        periodStart.setDate(periodStart.getDate() - biweeklyOffset);
        periodStart.setHours(0, 0, 0, 0);
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodStart.getDate() + 13);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      }
      case 'MONTHLY': {
        // startDay: day of month (1-31)
        periodStart = new Date(now.getFullYear(), now.getMonth(), config.startDay);
        if (periodStart > now) {
          periodStart.setMonth(periodStart.getMonth() - 1);
        }
        periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setDate(periodEnd.getDate() - 1);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      }
    }

    return {
      periodStart: periodStart.toISOString().split('T')[0]!,
      periodEnd: periodEnd.toISOString().split('T')[0]!,
      windowType: config.windowType,
    };
  }
}
