import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, desc, gte, lte, isNull, count, sum, inArray } from 'drizzle-orm';
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
  SetSettlementConfigInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor } from '../common/db/with-actor';
import { getManageableRolesForViewer } from './payroll-batch.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class HrService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================
  // Commission Plans
  // ============================================

  async createCommissionPlan(input: CreateCommissionPlanInput, actor: SessionUser) {
    // Dept-scoped: each Head can only create plans for the roles in their own department.
    // HR Manager and admins can create plans for any role.
    const manageable = getManageableRolesForViewer(actor);
    if (!manageable) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not allowed to manage commission plans.' });
    }
    if (!manageable.includes(input.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You can only create plans for roles in your department: ${manageable.join(', ')}.`,
      });
    }

    return withActor(this.db, { id: actor.id }, async (tx) => {
      const rows = await tx
        .insert(schema.commissionPlans)
        .values({
          role: input.role as typeof schema.commissionPlans.$inferInsert['role'],
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

  async updateCommissionPlan(input: UpdateCommissionPlanInput, actor: SessionUser) {
    const manageable = getManageableRolesForViewer(actor);
    if (!manageable) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not allowed to manage commission plans.' });
    }

    return withActor(this.db, { id: actor.id }, async (tx) => {
      // Authorize the edit against the EXISTING plan's role — Heads can't take over a plan that's
      // outside their dept just because they know the planId.
      const existingRows = await tx
        .select({ role: schema.commissionPlans.role })
        .from(schema.commissionPlans)
        .where(eq(schema.commissionPlans.id, input.planId))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Commission plan not found' });
      }
      if (!manageable.includes(existing.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `You can only edit plans for roles in your department: ${manageable.join(', ')}.`,
        });
      }

      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.planName !== undefined) updateFields['planName'] = input.planName;
      if (input.rules !== undefined) updateFields['rules'] = input.rules;
      if (input.effectiveTo !== undefined) updateFields['effectiveTo'] = new Date(input.effectiveTo);

      const rows = await tx
        .update(schema.commissionPlans)
        .set(updateFields)
        .where(eq(schema.commissionPlans.id, input.planId))
        .returning();

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Commission plan not found' });
      }
      return rows[0];
    });
  }

  async listCommissionPlans(input: ListCommissionPlansInput, viewer: SessionUser) {
    const conditions = [];

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
      conditions.push(inArray(schema.commissionPlans.role, manageable as typeof schema.commissionPlans.$inferSelect['role'][]));
    }

    if (input.role) {
      // Caller filter — must intersect the viewer's manageable set
      if (!isFullScope && !manageable.includes(input.role)) {
        return { plans: [], pagination: { page: input.page, limit: input.limit, total: 0 }, manageableRoles: manageable };
      }
      conditions.push(eq(schema.commissionPlans.role, input.role as typeof schema.commissionPlans.$inferSelect['role']));
    }
    if (input.activeOnly) {
      conditions.push(
        lte(schema.commissionPlans.effectiveFrom, new Date()),
      );
      // effectiveTo is null (no end) or in the future
      // We'll handle this with a raw condition
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

  async generatePayouts(input: GeneratePayoutsInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    // Get all active staff members
    const staff = await tx
      .select()
      .from(schema.users)
      .where(eq(schema.users.status, 'ACTIVE'));

    const payouts = [];

    for (const member of staff) {
      // Get delivered orders in this period — check BOTH CS agent and Media Buyer attribution
      // Commission is based on DELIVERED_AT timestamp, NOT CREATED_AT
      const deliveredRows = await tx
        .select({ count: count(), revenue: sum(schema.orders.totalAmount) })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.status, 'DELIVERED'),
            gte(schema.orders.deliveredAt, periodStart),
            lte(schema.orders.deliveredAt, periodEnd),
            or(
              eq(schema.orders.assignedCsId, member.id),
              eq(schema.orders.mediaBuyerId, member.id),
            ),
          ),
        );

      // Get total orders (all statuses) for delivery rate calculation
      const totalOrdersRows = await tx
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            gte(schema.orders.createdAt, periodStart),
            lte(schema.orders.createdAt, periodEnd),
            or(
              eq(schema.orders.assignedCsId, member.id),
              eq(schema.orders.mediaBuyerId, member.id),
            ),
          ),
        );

      // Get returned orders for penalty calculation
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
      const returnedCount = returnedRows[0]?.count ?? 0;
      const deliveryRate = totalOrders > 0 ? (deliveredCount / totalOrders) * 100 : 0;

      // Get applicable commission plan — most recent plan for this role
      const planRows = await tx
        .select()
        .from(schema.commissionPlans)
        .where(
          and(
            eq(schema.commissionPlans.role, member.role),
            lte(schema.commissionPlans.effectiveFrom, periodEnd),
          ),
        )
        .orderBy(desc(schema.commissionPlans.effectiveFrom))
        .limit(1);

      const plan = planRows[0];
      if (!plan) continue; // No plan configured for this role — skip

      const rules = (plan.rules ?? {}) as {
        baseSalary?: number;
        baseThreshold?: number;
        perOrderRate?: number;
        deliveryRateThreshold?: number;
        bonusPerExtraOrder?: number;
        penaltyPerReturn?: number;
      };

      // Calculate base salary (earned when orders >= threshold)
      let baseSalary = 0;
      if (rules.baseThreshold && deliveredCount >= rules.baseThreshold) {
        baseSalary = rules.baseSalary ?? 0;
      }

      // Calculate per-order commission
      let performanceBonus = 0;
      if (rules.perOrderRate) {
        performanceBonus = deliveredCount * rules.perOrderRate;
      }

      // Bonus for extra orders above threshold
      if (rules.bonusPerExtraOrder && rules.baseThreshold && deliveredCount > rules.baseThreshold) {
        performanceBonus += (deliveredCount - rules.baseThreshold) * rules.bonusPerExtraOrder;
      }

      // Delivery rate bonus: if delivery rate exceeds threshold, add extra
      if (rules.deliveryRateThreshold && deliveryRate > rules.deliveryRateThreshold && rules.bonusPerExtraOrder) {
        // Additional 50% bonus on extra orders for high-performing delivery rate
        const extraOrders = Math.max(0, deliveredCount - (rules.baseThreshold ?? 0));
        performanceBonus += extraOrders * (rules.bonusPerExtraOrder * 0.5);
      }

      // Penalty deductions for returned orders (Clawback)
      let penalties = 0;
      if (rules.penaltyPerReturn && returnedCount > 0) {
        penalties = returnedCount * rules.penaltyPerReturn;
      }

      // Get pending deductions (clawbacks from previous returns)
      const deductionRows = await tx
        .select({ total: sum(schema.earningsAdjustments.amount) })
        .from(schema.earningsAdjustments)
        .where(
          and(
            eq(schema.earningsAdjustments.staffId, member.id),
            eq(schema.earningsAdjustments.category, 'CLAWBACK'),
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
            baseSalary: baseSalary.toFixed(2),
            performanceBonus: performanceBonus.toFixed(2),
            addOnsTotal: addOnsTotal.toFixed(2),
            deductionsTotal: deductionsTotal.toFixed(2),
            totalPayout: totalPayout.toFixed(2),
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
      this.notifications.enqueueCreate({
        userId: payout.staffId,
        type: 'hr:payout_approved',
        title: 'Payout approved',
        body: `Your payout for the period has been approved.`,
        data: { payoutId: payout.id, totalPayout: payout.totalPayout },
      });
    }

    return payout;
  }

  async listPayouts(input: ListPayoutsInput) {
    const conditions = [];
    if (input.staffId) {
      conditions.push(eq(schema.payoutRecords.staffId, input.staffId));
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

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [payouts, totalRows] = await Promise.all([
      this.db.select().from(schema.payoutRecords).where(whereClause)
        .orderBy(desc(schema.payoutRecords.createdAt))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.payoutRecords).where(whereClause),
    ]);

    return {
      payouts,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async getPayoutSummary() {
    const results = await this.db
      .select({
        status: schema.payoutRecords.status,
        count: count(),
        total: sum(schema.payoutRecords.totalPayout),
      })
      .from(schema.payoutRecords)
      .groupBy(schema.payoutRecords.status);

    const summary: Record<string, { count: number; total: string }> = {};
    for (const row of results) {
      summary[row.status] = { count: row.count, total: row.total ?? '0' };
    }
    return summary;
  }

  // ============================================
  // Clawback Engine
  // ============================================

  /**
   * Called when an order transitions to RETURNED.
   * Creates PENDING_DEDUCTION for both Media Buyer and CS Agent.
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
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, staffId))
          .limit(1);

        const role = userRows[0]?.role;
        if (!role) continue;

        const planRows = await tx
          .select()
          .from(schema.commissionPlans)
          .where(
            and(
              eq(schema.commissionPlans.role, role),
              lte(schema.commissionPlans.effectiveFrom, new Date()),
            ),
          )
          .orderBy(desc(schema.commissionPlans.effectiveFrom))
          .limit(1);

        const plan = planRows[0];
        const rules = (plan?.rules ?? {}) as { penaltyPerReturn?: number; perOrderRate?: number };

        // Use penalty rate if set, otherwise use per-order rate as the clawback amount
        const clawbackAmount = rules.penaltyPerReturn ?? rules.perOrderRate ?? 0;
        if (clawbackAmount <= 0) continue;

        await tx
          .insert(schema.earningsAdjustments)
          .values({
            staffId,
            amount: (-clawbackAmount).toFixed(2),
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
   */
  async previewPayout(staffId: string, periodStart: string, periodEnd: string) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);

    const userRows = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, staffId))
      .limit(1);

    const user = userRows[0];
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Staff not found' });
    }

    const deliveredRows = await this.db
      .select({ count: count(), revenue: sum(schema.orders.totalAmount) })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'DELIVERED'),
          gte(schema.orders.deliveredAt, start),
          lte(schema.orders.deliveredAt, end),
          or(
            eq(schema.orders.assignedCsId, staffId),
            eq(schema.orders.mediaBuyerId, staffId),
          ),
        ),
      );

    const totalOrdersRows = await this.db
      .select({ count: count() })
      .from(schema.orders)
      .where(
        and(
          gte(schema.orders.createdAt, start),
          lte(schema.orders.createdAt, end),
          or(
            eq(schema.orders.assignedCsId, staffId),
            eq(schema.orders.mediaBuyerId, staffId),
          ),
        ),
      );

    const returnedRows = await this.db
      .select({ count: count() })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'RETURNED'),
          gte(schema.orders.deliveredAt, start),
          lte(schema.orders.deliveredAt, end),
          or(
            eq(schema.orders.assignedCsId, staffId),
            eq(schema.orders.mediaBuyerId, staffId),
          ),
        ),
      );

    const deliveredCount = deliveredRows[0]?.count ?? 0;
    const totalOrders = totalOrdersRows[0]?.count ?? 0;
    const returnedCount = returnedRows[0]?.count ?? 0;
    const deliveryRate = totalOrders > 0 ? (deliveredCount / totalOrders) * 100 : 0;

    // Get plan
    const planRows = await this.db
      .select()
      .from(schema.commissionPlans)
      .where(
        and(
          eq(schema.commissionPlans.role, user.role),
          lte(schema.commissionPlans.effectiveFrom, end),
        ),
      )
      .orderBy(desc(schema.commissionPlans.effectiveFrom))
      .limit(1);

    const plan = planRows[0];
    const rules = (plan?.rules ?? {}) as {
      baseSalary?: number;
      baseThreshold?: number;
      perOrderRate?: number;
      deliveryRateThreshold?: number;
      bonusPerExtraOrder?: number;
      penaltyPerReturn?: number;
    };

    let baseSalary = 0;
    if (rules.baseThreshold && deliveredCount >= rules.baseThreshold) {
      baseSalary = rules.baseSalary ?? 0;
    }

    let performanceBonus = 0;
    if (rules.perOrderRate) performanceBonus = deliveredCount * rules.perOrderRate;
    if (rules.bonusPerExtraOrder && rules.baseThreshold && deliveredCount > rules.baseThreshold) {
      performanceBonus += (deliveredCount - rules.baseThreshold) * rules.bonusPerExtraOrder;
    }
    if (rules.deliveryRateThreshold && deliveryRate > rules.deliveryRateThreshold && rules.bonusPerExtraOrder) {
      const extraOrders = Math.max(0, deliveredCount - (rules.baseThreshold ?? 0));
      performanceBonus += extraOrders * (rules.bonusPerExtraOrder * 0.5);
    }

    const penalties = (rules.penaltyPerReturn ?? 0) * returnedCount;

    const pendingClawbacks = await this.db
      .select({ total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, staffId),
          eq(schema.earningsAdjustments.category, 'CLAWBACK'),
          isNull(schema.earningsAdjustments.payoutId),
        ),
      );
    const clawbackTotal = Math.abs(Number(pendingClawbacks[0]?.total ?? 0));

    const deductionsTotal = penalties + clawbackTotal;
    const totalPayout = Math.max(0, baseSalary + performanceBonus - deductionsTotal);

    return {
      staffId,
      staffName: user.name,
      role: user.role,
      planName: plan?.planName ?? 'No plan assigned',
      deliveredCount,
      totalOrders,
      returnedCount,
      deliveryRate,
      baseSalary,
      performanceBonus,
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
          staffId: input.staffId,
          amount: String(input.amount),
          category: input.category,
          reason: input.reason,
        })
        .returning();

      const inserted = rows[0];
      if (!inserted) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create adjustment' });
      }
      return inserted;
    });

    // Notify staff when clawback/deduction is created (they need to know)
    const isDeduction = ['CLAWBACK', 'DEDUCTION'].includes(input.category) || Number(input.amount) < 0;
    if (isDeduction) {
      this.notifications.enqueueCreate({
        userId: input.staffId,
        type: 'hr:deduction_created',
        title: 'Deduction added',
        body: 'A deduction has been added to your earnings. It will be applied to your next payout.',
        data: { adjustmentId: adj.id, amount: input.amount, category: input.category },
      });
    }

    return adj;
  }

  async approveAdjustment(input: ApproveAdjustmentInput, actorId: string) {
    const row = await withActor(this.db, { id: actorId }, async (tx) => {
      const updateFields: Record<string, unknown> = {};
      if (input.approved) {
        updateFields['approvedBy'] = actorId;
      }

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

    // Notify staff when add-on/bonus is approved (or clawback/deduction is applied)
    if (input.approved) {
      const isDeduction = Number(row.amount) < 0 || ['CLAWBACK', 'DEDUCTION'].includes(row.category);
      this.notifications.enqueueCreate({
        userId: row.staffId,
        type: isDeduction ? 'hr:deduction_applied' : 'hr:addon_approved',
        title: isDeduction ? 'Deduction applied' : 'Add-on approved',
        body: isDeduction
          ? 'A deduction has been applied to your earnings.'
          : 'Your add-on earnings have been approved.',
        data: { adjustmentId: row.id, amount: row.amount, category: row.category },
      });
    }

    return row;
  }

  async listAdjustments(staffId?: string) {
    const conditions = staffId ? eq(schema.earningsAdjustments.staffId, staffId) : undefined;

    const adjustments = await this.db
      .select()
      .from(schema.earningsAdjustments)
      .where(conditions)
      .orderBy(desc(schema.earningsAdjustments.createdAt))
      .limit(50);

    return adjustments;
  }

  // ============================================
  // Settlement Window Config
  // ============================================

  async setSettlementConfig(input: SetSettlementConfigInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.settlementConfigs)
        .values({
          windowType: input.windowType,
          startDay: input.startDay,
          createdBy: actorId,
        })
        .returning();

      const config = rows[0];
      if (!config) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create settlement config' });
      }
      return config;
    });
  }

  async getActiveSettlementConfig() {
    // Return the most recently created settlement config
    const rows = await this.db
      .select()
      .from(schema.settlementConfigs)
      .orderBy(desc(schema.settlementConfigs.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  async listSettlementConfigs() {
    return this.db
      .select()
      .from(schema.settlementConfigs)
      .orderBy(desc(schema.settlementConfigs.createdAt));
  }

  /**
   * Calculate the current settlement period based on the active config.
   * Returns { periodStart, periodEnd } in ISO date strings.
   */
  async getCurrentSettlementPeriod(): Promise<{ periodStart: string; periodEnd: string; windowType: string } | null> {
    const config = await this.getActiveSettlementConfig();
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
