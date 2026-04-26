import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, desc, gte, lte, isNull, count, sum, inArray, sql } from 'drizzle-orm';
// `isNotNull` is imported separately so the compile-time exports list stays sorted.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  GenerateBatchInput,
  SubmitBatchInput,
  ApproveBatchInput,
  RejectBatchInput,
  MarkBatchPaidInput,
  ListMonthlyPayrollsInput,
  AddBatchAdjustmentInput,
  PayrollDepartment,
  PayrollBatchStatus,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { withActorAndBranch } from '../common/db/with-actor';
import { isAdminLevel } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/**
 * Maps the four payroll departments to the staff roles each contains.
 *
 * HR is the catch-all for staff who don't sit under a Head of Department:
 * HR Manager themselves, the Heads (their own pay can't be in their own batch),
 * Branch Admins, and the Finance Officer. SuperAdmin / Admin are not on payroll.
 *
 * Exported because plan creation (`HrService.createCommissionPlan`) and listing reuse the
 * same dept↔role mapping to scope what each Head can see + edit.
 */
export const DEPARTMENT_ROLES: Record<PayrollDepartment, readonly string[]> = {
  CS: ['CS_AGENT'],
  MARKETING: ['MEDIA_BUYER'],
  LOGISTICS: ['LOGISTICS_MANAGER', 'TPL_MANAGER', 'TPL_RIDER', 'STOCK_MANAGER'],
  HR: ['HR_MANAGER', 'HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS', 'BRANCH_ADMIN', 'FINANCE_OFFICER'],
} as const;

export const DEPARTMENT_OWNER_ROLE: Record<PayrollDepartment, string> = {
  CS: 'HEAD_OF_CS',
  MARKETING: 'HEAD_OF_MARKETING',
  LOGISTICS: 'HEAD_OF_LOGISTICS',
  HR: 'HR_MANAGER',
};

/**
 * Roles a viewer is allowed to manage commission plans for. Mirrors the batch ownership rules:
 *   - Admin: every role
 *   - HR Manager: every role (the catch-all owner)
 *   - HEAD_OF_CS: CS_AGENT
 *   - HEAD_OF_MARKETING: MEDIA_BUYER
 *   - HEAD_OF_LOGISTICS: LOGISTICS_MANAGER + TPL_MANAGER + TPL_RIDER + STOCK_MANAGER
 *   - everyone else: empty
 *
 * `null` return means "no plan management at all" — the caller should reject without checking
 * any specific role. An empty array would mean "manages 0 roles" which would be ambiguous.
 */
export function getManageableRolesForViewer(viewer: { role: string }): string[] | null {
  if (viewer.role === 'SUPER_ADMIN' || viewer.role === 'ADMIN' || viewer.role === 'HR_MANAGER') {
    return Array.from(new Set(Object.values(DEPARTMENT_ROLES).flat()));
  }
  const dept = (Object.entries(DEPARTMENT_OWNER_ROLE) as [PayrollDepartment, string][])
    .find(([, ownerRole]) => ownerRole === viewer.role)?.[0];
  if (!dept) return null;
  return [...DEPARTMENT_ROLES[dept]];
}

/** True when this user is allowed to prepare a DRAFT batch for the given (branch, department). */
function canPrepareDept(user: SessionUser, branchId: string, dept: PayrollDepartment): boolean {
  if (isAdminLevel(user)) return true;
  if (user.role !== DEPARTMENT_OWNER_ROLE[dept]) return false;
  // Heads must operate on their own branch. currentBranchId comes from the session switcher.
  return !!user.currentBranchId && user.currentBranchId === branchId;
}

/** HR review stage gate — HR Manager + admin-class. */
function canReviewBatch(user: SessionUser): boolean {
  return isAdminLevel(user) || user.role === 'HR_MANAGER';
}

/** Finance disbursement stage gate — Finance Officer + Finance hat + admin-class. */
function canProcessBatch(user: SessionUser): boolean {
  return hasFinanceAccess(user);
}

interface PayoutRow {
  staffId: string;
  baseSalary: number;
  performanceBonus: number;
  addOnsTotal: number;
  deductionsTotal: number;
  totalPayout: number;
}

@Injectable()
export class PayrollBatchService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================
  // Generation: DRAFT batch + child payouts
  // ============================================

  /**
   * Create or refresh a DRAFT batch for (branchId, periodMonth, department).
   *
   * If the slot is already in PENDING_HR or further, throws — only DRAFT batches
   * may be regenerated. Existing DRAFT payouts in the batch are wiped and re-derived
   * from the latest commission plans + delivered orders.
   */
  async generateBatch(input: GenerateBatchInput, actor: SessionUser) {
    if (!canPrepareDept(actor, input.branchId, input.department)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You cannot prepare a payroll batch for ${input.department} on this branch.`,
      });
    }

    const periodStart = new Date(`${input.periodMonth}T00:00:00.000Z`);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    periodEnd.setUTCMilliseconds(periodEnd.getUTCMilliseconds() - 1);

    return withActorAndBranch(this.db, { id: actor.id, currentBranchId: input.branchId }, async (tx) => {
      // Look up existing batch in this slot
      const existing = (
        await tx
          .select()
          .from(schema.payrollBatches)
          .where(
            and(
              eq(schema.payrollBatches.branchId, input.branchId),
              eq(schema.payrollBatches.periodMonth, input.periodMonth),
              eq(schema.payrollBatches.department, input.department),
            ),
          )
          .limit(1)
      )[0];

      if (existing && existing.status !== 'DRAFT') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Batch is already ${existing.status} — generate is only allowed for DRAFT batches. Reject the batch first to edit.`,
        });
      }

      let batchId: string;
      if (existing) {
        // Wipe existing DRAFT payouts and adjustments tied to them so we re-derive cleanly.
        // Adjustments must die first (FK to payout_records); detach by clearing payoutId so the
        // pending clawback rows survive (they'll re-link to the regenerated payout below).
        const oldPayouts = await tx
          .select({ id: schema.payoutRecords.id })
          .from(schema.payoutRecords)
          .where(eq(schema.payoutRecords.batchId, existing.id));
        const oldPayoutIds = oldPayouts.map((p) => p.id);
        if (oldPayoutIds.length) {
          await tx
            .update(schema.earningsAdjustments)
            .set({ payoutId: null })
            .where(inArray(schema.earningsAdjustments.payoutId, oldPayoutIds));
          await tx.delete(schema.payoutRecords).where(eq(schema.payoutRecords.batchId, existing.id));
        }
        batchId = existing.id;
        await tx.update(schema.payrollBatches)
          .set({ preparedBy: actor.id, preparedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.payrollBatches.id, batchId));
      } else {
        const inserted = await tx
          .insert(schema.payrollBatches)
          .values({
            branchId: input.branchId,
            periodMonth: input.periodMonth,
            department: input.department,
            status: 'DRAFT',
            preparedBy: actor.id,
            preparedAt: new Date(),
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create batch' });
        batchId = row.id;
      }

      // Pull staff in this department on this branch
      const departmentRoles = DEPARTMENT_ROLES[input.department];
      const staff = await tx
        .select()
        .from(schema.users)
        .where(
          and(
            eq(schema.users.status, 'ACTIVE'),
            eq(schema.users.primaryBranchId, input.branchId),
            inArray(schema.users.role, departmentRoles as unknown as typeof schema.users.$inferSelect['role'][]),
          ),
        );

      const generatedPayouts: PayoutRow[] = [];

      // CEO directive 2026-04-26: every active staff member in (branch × dept) gets a payout row,
      // even if the commission plan is missing or computes to zero. This gives HR a full roster to
      // review + adjust manually before submitting. Previously we skipped staff with no plan,
      // which left them invisible in the batch.
      for (const member of staff) {
        const computed = (await this.computePayoutForMember(tx, member, periodStart, periodEnd))
          ?? { baseSalary: 0, performanceBonus: 0, addOnsTotal: 0, deductionsTotal: 0, totalPayout: 0 };
        const inserted = await tx
          .insert(schema.payoutRecords)
          .values({
            batchId,
            staffId: member.id,
            periodStart,
            periodEnd,
            baseSalary: sql`${computed.baseSalary.toFixed(2)}::numeric`,
            performanceBonus: sql`${computed.performanceBonus.toFixed(2)}::numeric`,
            addOnsTotal: sql`${computed.addOnsTotal.toFixed(2)}::numeric`,
            deductionsTotal: sql`${computed.deductionsTotal.toFixed(2)}::numeric`,
            totalPayout: sql`${computed.totalPayout.toFixed(2)}::numeric`,
            status: 'DRAFT',
          })
          .returning({ id: schema.payoutRecords.id });
        const payoutId = inserted[0]?.id;
        if (!payoutId) continue;
        generatedPayouts.push({ staffId: member.id, ...computed });

        // Re-link any pending unattached clawbacks/adjustments for this staff to this payout
        await tx
          .update(schema.earningsAdjustments)
          .set({ payoutId })
          .where(
            and(
              eq(schema.earningsAdjustments.staffId, member.id),
              isNull(schema.earningsAdjustments.payoutId),
            ),
          );
      }

      const totalAmount = generatedPayouts.reduce((acc, p) => acc + p.totalPayout, 0);
      await tx
        .update(schema.payrollBatches)
        .set({
          staffCount: generatedPayouts.length,
          totalAmount: sql`${totalAmount.toFixed(2)}::numeric`,
          updatedAt: new Date(),
        })
        .where(eq(schema.payrollBatches.id, batchId));

      return { batchId, generated: generatedPayouts.length, totalAmount };
    });
  }

  /**
   * Pure compute (no inserts). Mirrors `HrService.generatePayouts` math but reads
   * the same data inside the caller's transaction so totals are consistent.
   */
  private async computePayoutForMember(
    tx: TxLike,
    member: { id: string; role: string },
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Omit<PayoutRow, 'staffId'> | null> {
    const deliveredRows = await tx
      .select({ count: count() })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'DELIVERED'),
          gte(schema.orders.deliveredAt, periodStart),
          lte(schema.orders.deliveredAt, periodEnd),
          or(eq(schema.orders.assignedCsId, member.id), eq(schema.orders.mediaBuyerId, member.id)),
        ),
      );
    const totalOrdersRows = await tx
      .select({ count: count() })
      .from(schema.orders)
      .where(
        and(
          gte(schema.orders.createdAt, periodStart),
          lte(schema.orders.createdAt, periodEnd),
          or(eq(schema.orders.assignedCsId, member.id), eq(schema.orders.mediaBuyerId, member.id)),
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
          or(eq(schema.orders.assignedCsId, member.id), eq(schema.orders.mediaBuyerId, member.id)),
        ),
      );

    const deliveredCount = deliveredRows[0]?.count ?? 0;
    const totalOrders = totalOrdersRows[0]?.count ?? 0;
    const returnedCount = returnedRows[0]?.count ?? 0;
    const deliveryRate = totalOrders > 0 ? (deliveredCount / totalOrders) * 100 : 0;

    const planRows = await tx
      .select()
      .from(schema.commissionPlans)
      .where(
        and(
          eq(schema.commissionPlans.role, member.role as typeof schema.commissionPlans.$inferSelect['role']),
          lte(schema.commissionPlans.effectiveFrom, periodEnd),
        ),
      )
      .orderBy(desc(schema.commissionPlans.effectiveFrom))
      .limit(1);
    const plan = planRows[0];
    if (!plan) return null;

    const rules = (plan.rules ?? {}) as {
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
    } else if (!rules.baseThreshold && rules.baseSalary) {
      // Plans with a base but no threshold (e.g. fixed-salary HR/admin staff)
      baseSalary = rules.baseSalary;
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

    const pendingClawbackRows = await tx
      .select({ total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, member.id),
          eq(schema.earningsAdjustments.category, 'CLAWBACK'),
          isNull(schema.earningsAdjustments.payoutId),
        ),
      );
    const clawbackTotal = Math.abs(Number(pendingClawbackRows[0]?.total ?? 0));

    const positiveAddOnRows = await tx
      .select({ total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, member.id),
          isNull(schema.earningsAdjustments.payoutId),
          inArray(schema.earningsAdjustments.category, ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER']),
        ),
      );
    const addOnsTotal = Number(positiveAddOnRows[0]?.total ?? 0);
    const deductionsTotal = penalties + clawbackTotal;
    const totalPayout = Math.max(0, baseSalary + performanceBonus + addOnsTotal - deductionsTotal);

    if (totalPayout <= 0 && deductionsTotal <= 0 && baseSalary <= 0) return null;
    return { baseSalary, performanceBonus, addOnsTotal, deductionsTotal, totalPayout };
  }

  // ============================================
  // Stage transitions
  // ============================================

  async submitBatch(input: SubmitBatchInput, actor: SessionUser) {
    const batch = await this.requireBatch(input.batchId);
    if (!canPrepareDept(actor, batch.branchId, batch.department)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owning department head (or admin) can submit this batch.' });
    }
    if (batch.status !== 'DRAFT') {
      throw new TRPCError({ code: 'CONFLICT', message: `Cannot submit a ${batch.status} batch — only DRAFT batches submit to HR.` });
    }
    if (batch.staffCount === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Batch is empty — generate payouts before submitting.' });
    }

    const updated = await withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const rows = await tx
          .update(schema.payrollBatches)
          .set({
            status: 'PENDING_HR',
            submittedAt: new Date(),
            submittedBy: actor.id,
            rejectionReason: null,
            rejectedAt: null,
            rejectedBy: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.payrollBatches.id, input.batchId))
          .returning();
        return rows[0];
      },
    );

    // Notify HR managers on this branch (and admins)
    await this.notifyByRoleOnBranch('HR_MANAGER', batch.branchId, {
      type: 'hr:batch_submitted',
      title: 'Payroll batch submitted for review',
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} is ready for your review.`,
      batchId: batch.id,
    });

    return updated;
  }

  async approveBatch(input: ApproveBatchInput, actor: SessionUser) {
    const batch = await this.requireBatch(input.batchId);
    if (!canReviewBatch(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only HR Manager or admins can approve batches.' });
    }
    if (batch.status !== 'PENDING_HR') {
      throw new TRPCError({ code: 'CONFLICT', message: `Cannot approve a ${batch.status} batch — only PENDING_HR batches forward to Finance.` });
    }

    const updated = await withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const rows = await tx
          .update(schema.payrollBatches)
          .set({
            status: 'PENDING_FINANCE',
            hrReviewedAt: new Date(),
            hrReviewedBy: actor.id,
            hrNotes: input.hrNotes ?? null,
            rejectionReason: null,
            rejectedAt: null,
            rejectedBy: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.payrollBatches.id, input.batchId))
          .returning();
        return rows[0];
      },
    );

    // Notify Finance Officers + Finance hat holder
    await this.notifyFinance(batch.branchId, {
      type: 'hr:batch_approved',
      title: 'Payroll batch ready for disbursement',
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} (${batch.staffCount} staff, ₦${Number(batch.totalAmount).toLocaleString('en-NG')}) is approved.`,
      batchId: batch.id,
    });

    return updated;
  }

  async rejectBatch(input: RejectBatchInput, actor: SessionUser) {
    const batch = await this.requireBatch(input.batchId);

    let nextStatus: PayrollBatchStatus;
    let notifyType: string;
    let notifyRole: string;

    if (batch.status === 'PENDING_HR') {
      // HR rejects back to the head — must be HR/admin
      if (!canReviewBatch(actor)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only HR Manager or admins can reject from HR review.' });
      }
      nextStatus = 'DRAFT';
      notifyType = 'hr:batch_rejected';
      notifyRole = DEPARTMENT_OWNER_ROLE[batch.department as PayrollDepartment];
    } else if (batch.status === 'PENDING_FINANCE') {
      // Finance rejects back to HR — must be Finance/admin
      if (!canProcessBatch(actor)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Finance or admins can reject from Finance review.' });
      }
      nextStatus = 'PENDING_HR';
      notifyType = 'hr:batch_rejected';
      notifyRole = 'HR_MANAGER';
    } else {
      throw new TRPCError({ code: 'CONFLICT', message: `Cannot reject a ${batch.status} batch.` });
    }

    const updated = await withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const rows = await tx
          .update(schema.payrollBatches)
          .set({
            status: nextStatus,
            rejectionReason: input.reason,
            rejectedAt: new Date(),
            rejectedBy: actor.id,
            // Clear any forward-stage timestamps so the new owner sees a fresh slate
            ...(nextStatus === 'DRAFT'
              ? { submittedAt: null, submittedBy: null, hrReviewedAt: null, hrReviewedBy: null }
              : { hrReviewedAt: null, hrReviewedBy: null }),
            updatedAt: new Date(),
          })
          .where(eq(schema.payrollBatches.id, input.batchId))
          .returning();
        return rows[0];
      },
    );

    await this.notifyByRoleOnBranch(notifyRole, batch.branchId, {
      type: notifyType,
      title: nextStatus === 'DRAFT' ? 'Payroll batch sent back for edits' : 'Payroll batch returned by Finance',
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} was rejected. Reason: ${input.reason}`,
      batchId: batch.id,
    });

    return updated;
  }

  async markBatchPaid(input: MarkBatchPaidInput, actor: SessionUser) {
    const batch = await this.requireBatch(input.batchId);
    if (!canProcessBatch(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Finance Officer, Finance hat, or admins can mark batches paid.' });
    }
    if (batch.status !== 'PENDING_FINANCE') {
      throw new TRPCError({ code: 'CONFLICT', message: `Cannot pay a ${batch.status} batch.` });
    }

    const updated = await withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const rows = await tx
          .update(schema.payrollBatches)
          .set({
            status: 'PAID',
            financeProcessedAt: new Date(),
            financeProcessedBy: actor.id,
            financeReference: input.financeReference,
            updatedAt: new Date(),
          })
          .where(eq(schema.payrollBatches.id, input.batchId))
          .returning();

        // Cascade: mark every payout in the batch PAID
        await tx
          .update(schema.payoutRecords)
          .set({ status: 'PAID' })
          .where(eq(schema.payoutRecords.batchId, input.batchId));

        return rows[0];
      },
    );

    // Notify HR + the originating Head + every staff in the batch
    await this.notifyByRoleOnBranch('HR_MANAGER', batch.branchId, {
      type: 'hr:batch_paid',
      title: 'Payroll batch paid',
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} marked paid (ref: ${input.financeReference}).`,
      batchId: batch.id,
    });
    const ownerRole = DEPARTMENT_OWNER_ROLE[batch.department as PayrollDepartment];
    if (ownerRole !== 'HR_MANAGER') {
      await this.notifyByRoleOnBranch(ownerRole, batch.branchId, {
        type: 'hr:batch_paid',
        title: 'Your team has been paid',
        body: `Finance disbursed ${this.formatDepartment(batch.department)} payroll for ${this.formatPeriod(batch.periodMonth)} (₦${Number(batch.totalAmount).toLocaleString('en-NG')}).`,
        batchId: batch.id,
      });
    }

    // Per-staff notification — each gets the existing hr:payout_approved signal
    const staffPayouts = await this.db
      .select({ staffId: schema.payoutRecords.staffId, totalPayout: schema.payoutRecords.totalPayout, payoutId: schema.payoutRecords.id })
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.batchId, input.batchId));
    for (const p of staffPayouts) {
      this.notifications.create({
        userId: p.staffId,
        type: 'hr:payout_approved',
        title: 'Payout paid',
        body: `Your payout of ₦${Number(p.totalPayout).toLocaleString('en-NG')} for ${this.formatPeriod(batch.periodMonth)} has been disbursed.`,
        data: { payoutId: p.payoutId, batchId: batch.id, amount: p.totalPayout },
      }).catch(() => {});
    }

    return updated;
  }

  // ============================================
  // HR adjustments during PENDING_HR review
  // ============================================

  /**
   * HR adds a per-staff adjustment during review. Inserts a row in earnings_adjustments
   * (auto-approved, since HR is the approver here) AND recomputes the payout total so
   * the batch summary stays accurate. Only allowed while status = PENDING_HR.
   */
  async addBatchAdjustment(input: AddBatchAdjustmentInput, actor: SessionUser) {
    if (!canReviewBatch(actor)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only HR Manager or admins can add adjustments at this stage.' });
    }
    const batch = await this.requireBatch(input.batchId);
    if (batch.status !== 'PENDING_HR') {
      throw new TRPCError({ code: 'CONFLICT', message: `Adjustments are only editable while the batch is in HR review (current: ${batch.status}).` });
    }

    return withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const payoutRows = await tx
          .select()
          .from(schema.payoutRecords)
          .where(and(eq(schema.payoutRecords.id, input.payoutId), eq(schema.payoutRecords.batchId, input.batchId)))
          .limit(1);
        const payout = payoutRows[0];
        if (!payout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payout not in this batch' });

        await tx.insert(schema.earningsAdjustments).values({
          staffId: payout.staffId,
          payoutId: payout.id,
          amount: sql`${input.amount.toFixed(2)}::numeric`,
          category: input.category,
          reason: input.reason,
          approvedBy: actor.id,
        });

        // Recompute totals from all adjustments tied to this payout
        const recomputed = await this.recomputePayoutTotals(tx, payout.id);
        await this.recomputeBatchTotals(tx, input.batchId);
        return recomputed;
      },
    );
  }

  // ============================================
  // Reads
  // ============================================

  /**
   * List batches grouped by month. Auto-scopes by viewer:
   *   - admin / cross-branch: all batches matching filters
   *   - HR Manager: all batches on their currentBranchId
   *   - Finance: all batches on their currentBranchId (UI usually filters to PENDING_FINANCE+)
   *   - Head of Dept: only their dept on their currentBranchId
   */
  async listMonthlyPayrolls(input: ListMonthlyPayrollsInput, viewer: SessionUser) {
    const conditions = [] as ReturnType<typeof and>[] | unknown[];

    // Viewer scoping
    const cross = isAdminLevel(viewer);
    if (!cross) {
      if (!viewer.currentBranchId) return { batches: [], byMonth: [] };
      conditions.push(eq(schema.payrollBatches.branchId, viewer.currentBranchId));

      // Heads can only see their own dept
      const ownerDept = (Object.keys(DEPARTMENT_OWNER_ROLE) as PayrollDepartment[])
        .find((d) => DEPARTMENT_OWNER_ROLE[d] === viewer.role);
      const isHeadButNotHr = ownerDept && viewer.role !== 'HR_MANAGER';
      if (isHeadButNotHr && !canReviewBatch(viewer) && !canProcessBatch(viewer)) {
        conditions.push(eq(schema.payrollBatches.department, ownerDept));
      }
    }

    if (input.fromMonth) conditions.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) conditions.push(lte(schema.payrollBatches.periodMonth, input.toMonth));
    if (input.branchId && cross) conditions.push(eq(schema.payrollBatches.branchId, input.branchId));
    if (input.department) conditions.push(eq(schema.payrollBatches.department, input.department));
    if (input.status) conditions.push(eq(schema.payrollBatches.status, input.status));

    const where = conditions.length ? and(...(conditions as Parameters<typeof and>)) : undefined;

    const batches = await this.db
      .select()
      .from(schema.payrollBatches)
      .where(where)
      .orderBy(desc(schema.payrollBatches.periodMonth), desc(schema.payrollBatches.createdAt));

    // Group by periodMonth (YYYY-MM-01 string)
    const byMonth = new Map<string, typeof batches>();
    for (const b of batches) {
      const key = String(b.periodMonth);
      const arr = byMonth.get(key) ?? [];
      arr.push(b);
      byMonth.set(key, arr);
    }

    return {
      batches,
      byMonth: Array.from(byMonth.entries()).map(([month, items]) => ({
        month,
        totalAmount: items.reduce((acc, x) => acc + Number(x.totalAmount), 0),
        staffCount: items.reduce((acc, x) => acc + (x.staffCount ?? 0), 0),
        items,
      })),
    };
  }

  async getBatchDetail(batchId: string, viewer: SessionUser) {
    const batch = await this.requireBatch(batchId);

    // Permission check: same scoping as list
    const allowedAsHead = canPrepareDept(viewer, batch.branchId, batch.department as PayrollDepartment);
    const allowed =
      isAdminLevel(viewer) ||
      canReviewBatch(viewer) ||
      canProcessBatch(viewer) ||
      allowedAsHead;
    if (!allowed) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to view this batch.' });
    }

    const payouts = await this.db
      .select()
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.batchId, batchId))
      .orderBy(desc(schema.payoutRecords.totalPayout));

    const staffIds = payouts.map((p) => p.staffId);
    const staff = staffIds.length
      ? await this.db
          .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
          .from(schema.users)
          .where(inArray(schema.users.id, staffIds))
      : [];
    const staffById = new Map(staff.map((s) => [s.id, s]));

    const payoutIds = payouts.map((p) => p.id);
    const adjustments = payoutIds.length
      ? await this.db
          .select()
          .from(schema.earningsAdjustments)
          .where(inArray(schema.earningsAdjustments.payoutId, payoutIds))
          .orderBy(desc(schema.earningsAdjustments.createdAt))
      : [];

    const allowedTransitions = this.getAllowedTransitions(batch.status as PayrollBatchStatus, viewer);

    return {
      batch,
      payouts: payouts.map((p) => ({
        ...p,
        staffName: staffById.get(p.staffId)?.name ?? p.staffId.slice(0, 8),
        staffRole: staffById.get(p.staffId)?.role ?? null,
      })),
      adjustments,
      allowedTransitions,
    };
  }

  // ============================================
  // Helpers
  // ============================================

  private async requireBatch(batchId: string) {
    const rows = await this.db
      .select()
      .from(schema.payrollBatches)
      .where(eq(schema.payrollBatches.id, batchId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found' });
    return row;
  }

  private async recomputePayoutTotals(tx: TxLike, payoutId: string) {
    const adj = await tx
      .select({ category: schema.earningsAdjustments.category, total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(eq(schema.earningsAdjustments.payoutId, payoutId))
      .groupBy(schema.earningsAdjustments.category);

    let positive = 0;
    let deductions = 0;
    for (const row of adj) {
      const total = Number(row.total ?? 0);
      if (row.category === 'CLAWBACK' || row.category === 'DEDUCTION' || total < 0) {
        deductions += Math.abs(total);
      } else {
        positive += total;
      }
    }

    const payoutRows = await tx
      .select({ baseSalary: schema.payoutRecords.baseSalary, performanceBonus: schema.payoutRecords.performanceBonus })
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.id, payoutId))
      .limit(1);
    const p = payoutRows[0];
    if (!p) return null;

    const total = Math.max(0, Number(p.baseSalary) + Number(p.performanceBonus) + positive - deductions);
    const updated = await tx
      .update(schema.payoutRecords)
      .set({
        addOnsTotal: sql`${positive.toFixed(2)}::numeric`,
        deductionsTotal: sql`${deductions.toFixed(2)}::numeric`,
        totalPayout: sql`${total.toFixed(2)}::numeric`,
      })
      .where(eq(schema.payoutRecords.id, payoutId))
      .returning();
    return updated[0] ?? null;
  }

  private async recomputeBatchTotals(tx: TxLike, batchId: string) {
    const agg = await tx
      .select({ count: count(), total: sum(schema.payoutRecords.totalPayout) })
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.batchId, batchId));
    const staffCount = agg[0]?.count ?? 0;
    const totalAmount = Number(agg[0]?.total ?? 0);
    await tx
      .update(schema.payrollBatches)
      .set({ staffCount, totalAmount: sql`${totalAmount.toFixed(2)}::numeric`, updatedAt: new Date() })
      .where(eq(schema.payrollBatches.id, batchId));
  }

  private getAllowedTransitions(status: PayrollBatchStatus, viewer: SessionUser): string[] {
    const out: string[] = [];
    if (status === 'DRAFT' && (isAdminLevel(viewer) || viewer.role.startsWith('HEAD_OF_') || viewer.role === 'HR_MANAGER')) {
      out.push('SUBMIT');
    }
    if (status === 'PENDING_HR' && canReviewBatch(viewer)) {
      out.push('APPROVE', 'REJECT');
    }
    if (status === 'PENDING_FINANCE' && canProcessBatch(viewer)) {
      out.push('MARK_PAID', 'REJECT');
    }
    return out;
  }

  private formatDepartment(d: string): string {
    if (d === 'CS') return 'Customer Service';
    if (d === 'HR') return 'HR';
    return d.charAt(0) + d.slice(1).toLowerCase();
  }

  private formatPeriod(periodMonth: string | Date): string {
    const d = typeof periodMonth === 'string' ? new Date(periodMonth) : periodMonth;
    return d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  /**
   * Notify all ACTIVE users with the given role on the given branch.
   * Admins also get notified for visibility (cross-branch role).
   */
  private async notifyByRoleOnBranch(
    role: string,
    branchId: string,
    payload: { type: string; title: string; body: string; batchId: string },
  ) {
    const recipients = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.status, 'ACTIVE'),
          eq(schema.users.role, role as typeof schema.users.$inferSelect['role']),
          or(eq(schema.users.primaryBranchId, branchId), isNull(schema.users.primaryBranchId)),
        ),
      );
    for (const r of recipients) {
      this.notifications
        .create({
          userId: r.id,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: { batchId: payload.batchId },
        })
        .catch(() => {});
    }
  }

  private async notifyFinance(
    branchId: string,
    payload: { type: string; title: string; body: string; batchId: string },
  ) {
    // Finance Officers (any branch) + Finance hat holder
    const recipients = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.status, 'ACTIVE'),
          or(
            eq(schema.users.role, 'FINANCE_OFFICER'),
            eq(schema.users.isFinanceOfficer, true),
          ),
        ),
      );
    for (const r of recipients) {
      this.notifications
        .create({
          userId: r.id,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: { batchId: payload.batchId, branchId },
        })
        .catch(() => {});
    }
  }
}

// ── tx type alias ──────────────────────────────────────────────
type TxLike = Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0];
