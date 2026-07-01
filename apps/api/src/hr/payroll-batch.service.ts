import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, desc, gte, lte, isNull, count, sum, inArray, sql } from 'drizzle-orm';
// `isNotNull` is imported separately so the compile-time exports list stays sorted.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  GenerateBatchInput,
  GenerateBatchesBulkInput,
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
import { isOrgWideDepartmentHead } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isBranchTeamsSchemaMissingError } from '../common/db/branch-teams-schema';
import { resolveApplicableCommissionPlan } from './commission-plan-resolution';
import { computeEarningsFromPlanRules } from './commission-rules-math';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';

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
  CS: ['CS_CLOSER'],
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
 *   - HEAD_OF_CS: CS_CLOSER
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

/** True when this user is allowed to prepare a DRAFT batch by role-only policy. */
function canPrepareDeptByRole(user: SessionUser, branchId: string, dept: PayrollDepartment): boolean {
  // SuperAdmin always; otherwise anyone holding hr.write (admin via ALL_PERMISSION_CODES, HR_MANAGER) prepares any.
  if (user.role === 'SUPER_ADMIN') return true;
  const perms = user.permissions ?? [];
  if (perms.includes('hr.write')) return true;
  if (user.role !== DEPARTMENT_OWNER_ROLE[dept]) return false;
  if (isOrgWideDepartmentHead(user) && user.currentBranchId == null) return true;
  return !!user.currentBranchId && user.currentBranchId === branchId;
}

/** HR review stage gate — anyone with hr.write (HR_MANAGER, admin) or SuperAdmin. */
function canReviewBatch(user: SessionUser): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
  return (user.permissions ?? []).includes('hr.write');
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

  private async isBranchTeamSupervisorForDept(
    actorId: string,
    branchId: string,
    dept: PayrollDepartment,
  ): Promise<boolean> {
    const teamDept = dept === 'CS' ? 'CS' : dept === 'MARKETING' ? 'MARKETING' : null;
    if (!teamDept) return false;
    try {
      const rows = await this.db
        .select({ one: sql`1` })
        .from(schema.branchTeamMembers)
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, schema.branchTeamMembers.teamId))
        .where(
          and(
            eq(schema.branchTeamMembers.userId, actorId),
            eq(schema.branchTeamMembers.isSupervisor, true),
            eq(schema.branchTeams.branchId, branchId),
            eq(schema.branchTeams.department, teamDept),
          ),
        )
        .limit(1);
      return rows.length > 0;
    } catch (err) {
      if (isBranchTeamsSchemaMissingError(err)) return false;
      throw err;
    }
  }

  private async canPrepareDept(user: SessionUser, branchId: string, dept: PayrollDepartment): Promise<boolean> {
    if (canPrepareDeptByRole(user, branchId, dept)) return true;
    // HR Manager is an org-wide role (CEO directive 2026-05-10) — they
    // can prepare any department on any branch. `canPrepareDeptByRole` above
    // already catches HR via the `hr.write` permission gate, but be explicit
    // here so a future tweak to that helper can't accidentally lock HR out.
    if (user.role === 'HR_MANAGER') return true;
    return this.isBranchTeamSupervisorForDept(user.id, branchId, dept);
  }

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
    if (!(await this.canPrepareDept(actor, input.branchId, input.department))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You cannot prepare a payroll batch for ${input.department} on this branch.`,
      });
    }

    const periodStart = nigeriaDayStart(`${input.periodMonth}-01`);
    const lastDay = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
    const periodEnd = nigeriaDayEnd(lastDay.toISOString().slice(0, 10));

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

      const { generated, totalAmount } = await this.synthesizeDraftBatchContent(
        tx,
        batchId,
        input.branchId,
        input.department,
        periodStart,
        periodEnd,
      );
      return { batchId, generated, totalAmount };
    });
  }

  /**
   * Create DRAFT batches for every (branchId × department) slot that has no row yet.
   * Existing slots (any status, including DRAFT) are skipped — use `generateBatch` to refresh a single DRAFT.
   */
  async generateBatchesBulk(input: GenerateBatchesBulkInput, actor: SessionUser) {
    const periodStart = nigeriaDayStart(`${input.periodMonth}-01`);
    const lastDay = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
    const periodEnd = nigeriaDayEnd(lastDay.toISOString().slice(0, 10));

    const created: Array<{ batchId: string; branchId: string; department: PayrollDepartment }> =
      [];
    const skipped: Array<{
      branchId: string;
      department: PayrollDepartment;
      reason: 'FORBIDDEN' | 'EXISTS';
      status?: PayrollBatchStatus;
    }> = [];

    for (const branchId of input.branchIds) {
      for (const department of input.departments as PayrollDepartment[]) {
        if (!(await this.canPrepareDept(actor, branchId, department))) {
          skipped.push({ branchId, department, reason: 'FORBIDDEN' });
          continue;
        }

        const run = await withActorAndBranch(
          this.db,
          { id: actor.id, currentBranchId: branchId },
          async (tx) => {
            const existing = (
              await tx
                .select()
                .from(schema.payrollBatches)
                .where(
                  and(
                    eq(schema.payrollBatches.branchId, branchId),
                    eq(schema.payrollBatches.periodMonth, input.periodMonth),
                    eq(schema.payrollBatches.department, department),
                  ),
                )
                .limit(1)
            )[0];
            if (existing) {
              return {
                skipped: true as const,
                status: existing.status as PayrollBatchStatus,
              };
            }

            const inserted = await tx
              .insert(schema.payrollBatches)
              .values({
                branchId,
                periodMonth: input.periodMonth,
                department,
                status: 'DRAFT',
                preparedBy: actor.id,
                preparedAt: new Date(),
              })
              .returning({ id: schema.payrollBatches.id });
            const row = inserted[0];
            if (!row?.id)
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create batch' });

            await this.synthesizeDraftBatchContent(
              tx,
              row.id,
              branchId,
              department,
              periodStart,
              periodEnd,
            );
            return { skipped: false as const, batchId: row.id };
          },
        );

        if ('skipped' in run && run.skipped) {
          skipped.push({
            branchId,
            department,
            reason: 'EXISTS',
            status: run.status,
          });
        } else if ('batchId' in run) {
          created.push({ batchId: run.batchId, branchId, department });
        }
      }
    }

    const summaryMessage = `Created ${created.length} batch${created.length === 1 ? '' : 'es'} · skipped ${skipped.length}`;
    return { created, skipped, summaryMessage };
  }

  /** Insert payout rows into an existing draft batch shell and update rollup totals (caller wipes old payouts when refreshing). */
  private async synthesizeDraftBatchContent(
    tx: TxLike,
    batchId: string,
    branchId: string,
    department: PayrollDepartment,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ generated: number; totalAmount: number }> {
    const departmentRoles = DEPARTMENT_ROLES[department];
    const staff = await tx
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.status, 'ACTIVE'),
          eq(schema.users.primaryBranchId, branchId),
          inArray(schema.users.role, departmentRoles as unknown as typeof schema.users.$inferSelect['role'][]),
        ),
      );

    const generatedPayouts: PayoutRow[] = [];

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

    return { generated: generatedPayouts.length, totalAmount };
  }

  async previewBatch(input: GenerateBatchInput, actor: SessionUser) {
    if (!(await this.canPrepareDept(actor, input.branchId, input.department))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You cannot preview payroll for ${input.department} on this branch.`,
      });
    }
    const periodStart = nigeriaDayStart(`${input.periodMonth}-01`);
    const lastDay = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
    const periodEnd = nigeriaDayEnd(lastDay.toISOString().slice(0, 10));

    return withActorAndBranch(this.db, { id: actor.id, currentBranchId: input.branchId }, async (tx) => {
      const departmentRoles = DEPARTMENT_ROLES[input.department];
      const staff = await tx
        .select({
          id: schema.users.id,
          name: schema.users.name,
          role: schema.users.role,
          commissionPlanId: schema.users.commissionPlanId,
        })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.status, 'ACTIVE'),
            eq(schema.users.primaryBranchId, input.branchId),
            inArray(schema.users.role, departmentRoles as unknown as typeof schema.users.$inferSelect['role'][]),
          ),
        );

      const rows = [] as Array<{
        staffId: string;
        staffName: string;
        staffRole: string;
        baseSalary: number;
        performanceBonus: number;
        addOnsTotal: number;
        deductionsTotal: number;
        totalPayout: number;
      }>;
      for (const member of staff) {
        const computed = (await this.computePayoutForMember(tx, member, periodStart, periodEnd))
          ?? { baseSalary: 0, performanceBonus: 0, addOnsTotal: 0, deductionsTotal: 0, totalPayout: 0 };
        rows.push({
          staffId: member.id,
          staffName: member.name,
          staffRole: member.role,
          ...computed,
        });
      }

      return {
        branchId: input.branchId,
        department: input.department,
        periodMonth: input.periodMonth,
        staffCount: rows.length,
        totalAmount: rows.reduce((acc, row) => acc + row.totalPayout, 0),
        rows: rows.sort((a, b) => b.totalPayout - a.totalPayout),
      };
    });
  }

  /**
   * Pure compute (no inserts). Mirrors `HrService.generatePayouts` math but reads
   * the same data inside the caller's transaction so totals are consistent.
   */
  private async computePayoutForMember(
    tx: TxLike,
    member: { id: string; role: string; commissionPlanId?: string | null },
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Omit<PayoutRow, 'staffId'> | null> {
    // Pay count by `deliveredAt` — staff get credited in the period their
    // delivery actually closed, so cross-period orders aren't lost.
    // Include REMITTED so commission isn't lost when the accountant marks
    // remittance received before payroll runs (DELIVERED→REMITTED flip).
    const deliveredRows = await tx
      .select({ count: count() })
      .from(schema.orders)
      .where(
        and(
          inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
          gte(schema.orders.deliveredAt, periodStart),
          lte(schema.orders.deliveredAt, periodEnd),
          or(eq(schema.orders.assignedCsId, member.id), eq(schema.orders.mediaBuyerId, member.id)),
        ),
      );
    // DELETED orders are editorial removals (test/fake/mistake), not real
    // workload — never count them in the delivery-rate denominator.
    const totalOrdersRows = await tx
      .select({ count: count() })
      .from(schema.orders)
      .where(
        and(
          sql`${schema.orders.status} <> 'DELETED'`,
          gte(schema.orders.createdAt, periodStart),
          lte(schema.orders.createdAt, periodEnd),
          or(eq(schema.orders.assignedCsId, member.id), eq(schema.orders.mediaBuyerId, member.id)),
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
    const deliveredCohortCount = deliveredCohortRows[0]?.count ?? 0;
    const returnedCount = returnedRows[0]?.count ?? 0;

    const plan = await resolveApplicableCommissionPlan(tx, {
      commissionPlanId: member.commissionPlanId ?? null,
      staffRole: member.role,
      rangeStart: periodStart,
      rangeEnd: periodEnd,
    });
    if (!plan) return null;

    const {
      baseSalary,
      performanceBonus,
      penalties,
    } = computeEarningsFromPlanRules(plan.rules, {
      deliveredCount,
      totalOrders,
      returnedCount,
      deliveredCohortCount,
    });

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
    if (!(await this.canPrepareDept(actor, batch.branchId, batch.department))) {
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
      this.notifications.enqueueCreate({
        userId: p.staffId,
        type: 'hr:payout_approved',
        title: 'Payout paid',
        body: `Your payout of ₦${Number(p.totalPayout).toLocaleString('en-NG')} for ${this.formatPeriod(batch.periodMonth)} has been disbursed.`,
        data: { payoutId: p.payoutId, batchId: batch.id, amount: p.totalPayout },
      });
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
    const batch = await this.requireBatch(input.batchId);
    const canPrepareDraft =
      batch.status === 'DRAFT' &&
      (await this.canPrepareDept(actor, batch.branchId, batch.department as PayrollDepartment));
    const canReviewPendingHr = batch.status === 'PENDING_HR' && canReviewBatch(actor);
    if (!canPrepareDraft && !canReviewPendingHr) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          batch.status === 'DRAFT'
            ? 'Only eligible department preparers can adjust DRAFT batches.'
            : 'Only HR Manager or admins can add adjustments during HR review.',
      });
    }
    if (batch.status !== 'DRAFT' && batch.status !== 'PENDING_HR') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Adjustments are only editable in DRAFT or PENDING_HR (current: ${batch.status}).`,
      });
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

  async getPrepareAccess(viewer: SessionUser) {
    const departments = new Set<PayrollDepartment>();
    const branchIds = new Set<string>();

    const viewerHasFullHr =
      viewer.role === 'SUPER_ADMIN' ||
      (viewer.permissions ?? []).includes('hr.write');
    if (viewerHasFullHr) {
      (Object.keys(DEPARTMENT_OWNER_ROLE) as PayrollDepartment[]).forEach((d) => departments.add(d));
      const allBranches = await this.db
        .select({ id: schema.branches.id, name: schema.branches.name })
        .from(schema.branches)
        .where(sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`);
      return { allowed: true, departments: [...departments], branches: allBranches };
    }

    const ownerDept = (Object.keys(DEPARTMENT_OWNER_ROLE) as PayrollDepartment[])
      .find((d) => DEPARTMENT_OWNER_ROLE[d] === viewer.role);
    if (ownerDept) departments.add(ownerDept);

    if (viewer.role === 'HR_MANAGER') {
      departments.add('LOGISTICS');
      departments.add('HR');
    }

    if (viewer.currentBranchId) {
      branchIds.add(viewer.currentBranchId);
      if (await this.isBranchTeamSupervisorForDept(viewer.id, viewer.currentBranchId, 'CS')) {
        departments.add('CS');
      }
      if (await this.isBranchTeamSupervisorForDept(viewer.id, viewer.currentBranchId, 'MARKETING')) {
        departments.add('MARKETING');
      }
    }

    if (isOrgWideDepartmentHead(viewer) && viewer.currentBranchId == null) {
      const allBranches = await this.db
        .select({ id: schema.branches.id, name: schema.branches.name })
        .from(schema.branches)
        .where(sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`);
      return {
        allowed: departments.size > 0 && allBranches.length > 0,
        departments: [...departments],
        branches: allBranches,
      };
    }

    const branches = branchIds.size
      ? await this.db
          .select({ id: schema.branches.id, name: schema.branches.name })
          .from(schema.branches)
          .where(inArray(schema.branches.id, [...branchIds]))
      : [];

    return {
      allowed: departments.size > 0 && branches.length > 0,
      departments: [...departments],
      branches,
    };
  }

  // ============================================
  // Reads
  // ============================================

  /**
   * List batches grouped by month. Auto-scopes by viewer:
   *   - admin / cross-branch: all batches matching filters
   *   - HR Manager: all batches on their currentBranchId
   *   - Finance: all batches on their currentBranchId (UI usually filters to PENDING_FINANCE+)
   *   - Head of Dept: their dept — on currentBranchId, or all branches when session branch is null (org-wide heads)
   */
  async listMonthlyPayrolls(input: ListMonthlyPayrollsInput, viewer: SessionUser, effectiveBranchIds?: string[] | null) {
    const conditions = [] as ReturnType<typeof and>[] | unknown[];

    // Viewer scoping. Cross-branch view is granted to SuperAdmin and anyone holding hr.write
    // (admin via ALL_PERMISSION_CODES, HR_MANAGER via SYSTEM template). HR_MANAGER assigned
    // to a branch (CEO 2026-05-19) loses cross-branch — they see only their branch's batches.
    const cross =
      viewer.role === 'SUPER_ADMIN' ||
      ((viewer.permissions ?? []).includes('hr.write') && viewer.currentBranchId == null);
    const orgWideHeadNullSession =
      isOrgWideDepartmentHead(viewer) && viewer.currentBranchId == null;

    // Company group isolation: even cross-branch / org-wide viewers must be scoped
    // to their effective branch set when a company group is active.
    if (effectiveBranchIds?.length) {
      conditions.push(inArray(schema.payrollBatches.branchId, effectiveBranchIds));
    }

    if (!cross) {
      if (!viewer.currentBranchId && !orgWideHeadNullSession) return { batches: [], byMonth: [] };
      if (viewer.currentBranchId) {
        conditions.push(eq(schema.payrollBatches.branchId, viewer.currentBranchId));
      }

      // Restrict branch-scoped non-admin viewers to departments they can actually prepare/review/process.
      const ownerDept = (Object.keys(DEPARTMENT_OWNER_ROLE) as PayrollDepartment[])
        .find((d) => DEPARTMENT_OWNER_ROLE[d] === viewer.role);
      const isHeadButNotHr = ownerDept && viewer.role !== 'HR_MANAGER';
      if (!canReviewBatch(viewer) && !canProcessBatch(viewer)) {
        const allowedDepts: PayrollDepartment[] = [];
        if (isHeadButNotHr) allowedDepts.push(ownerDept);
        if (viewer.role === 'HR_MANAGER' && viewer.currentBranchId) {
          allowedDepts.push('LOGISTICS', 'HR');
        }
        if (viewer.currentBranchId && (await this.isBranchTeamSupervisorForDept(viewer.id, viewer.currentBranchId, 'CS'))) {
          allowedDepts.push('CS');
        }
        if (viewer.currentBranchId && (await this.isBranchTeamSupervisorForDept(viewer.id, viewer.currentBranchId, 'MARKETING'))) {
          allowedDepts.push('MARKETING');
        }
        const uniqueAllowed = [...new Set(allowedDepts)];
        if (uniqueAllowed.length === 0) return { batches: [], byMonth: [] };
        if (uniqueAllowed.length === 1) {
          const firstAllowed = uniqueAllowed[0] as PayrollDepartment;
          conditions.push(eq(schema.payrollBatches.department, firstAllowed));
        } else {
          conditions.push(
            inArray(
              schema.payrollBatches.department,
              uniqueAllowed as unknown as typeof schema.payrollBatches.$inferSelect['department'][],
            ),
          );
        }
      }
    }

    if (input.fromMonth) conditions.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) conditions.push(lte(schema.payrollBatches.periodMonth, input.toMonth));
    if (input.branchId && (cross || orgWideHeadNullSession)) {
      conditions.push(eq(schema.payrollBatches.branchId, input.branchId));
    }
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
    const allowedAsHead = await this.canPrepareDept(viewer, batch.branchId, batch.department as PayrollDepartment);
    // HR_MANAGER assigned to a branch (CEO 2026-05-19) sees only that branch.
    const hrBranchScopeOk =
      viewer.role !== 'HR_MANAGER' ||
      viewer.currentBranchId == null ||
      batch.branchId === viewer.currentBranchId;
    const allowed =
      hrBranchScopeOk && (
        viewer.role === 'SUPER_ADMIN' ||
        canReviewBatch(viewer) ||
        canProcessBatch(viewer) ||
        allowedAsHead
      );
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
          .select({
            id: schema.users.id,
            name: schema.users.name,
            role: schema.users.role,
            payoutBankName: schema.users.payoutBankName,
            payoutAccountName: schema.users.payoutAccountName,
            payoutAccountNumber: schema.users.payoutAccountNumber,
            payoutBankCode: schema.users.payoutBankCode,
          })
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

    const allowedTransitions = await this.getAllowedTransitions(batch, viewer);

    return {
      batch,
      payouts: payouts.map((p) => ({
        ...p,
        staffName: staffById.get(p.staffId)?.name ?? p.staffId.slice(0, 8),
        staffRole: staffById.get(p.staffId)?.role ?? null,
        payoutBankName: hasFinanceAccess(viewer) ? (staffById.get(p.staffId)?.payoutBankName ?? null) : null,
        payoutAccountName: hasFinanceAccess(viewer) ? (staffById.get(p.staffId)?.payoutAccountName ?? null) : null,
        payoutAccountNumber: hasFinanceAccess(viewer) ? (staffById.get(p.staffId)?.payoutAccountNumber ?? null) : null,
        payoutBankCode: hasFinanceAccess(viewer) ? (staffById.get(p.staffId)?.payoutBankCode ?? null) : null,
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

  private async getAllowedTransitions(
    batch: { status: PayrollBatchStatus; branchId: string; department: string },
    viewer: SessionUser,
  ): Promise<string[]> {
    const out: string[] = [];
    if (
      batch.status === 'DRAFT' &&
      (await this.canPrepareDept(viewer, batch.branchId, batch.department as PayrollDepartment))
    ) {
      out.push('SUBMIT');
    }
    if (batch.status === 'PENDING_HR' && canReviewBatch(viewer)) {
      out.push('APPROVE', 'REJECT');
    }
    if (batch.status === 'PENDING_FINANCE' && canProcessBatch(viewer)) {
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
      this.notifications.enqueueCreate({
        userId: r.id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: { batchId: payload.batchId },
      });
    }
  }

  private async notifyFinance(
    branchId: string,
    payload: { type: string; title: string; body: string; batchId: string },
  ) {
    // Finance Officers (any branch). The Finance "hat" pattern was retired in favour of
    // permission overrides — admins now grant the relevant `finance.*` codes directly.
    const recipients = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.status, 'ACTIVE'),
          eq(schema.users.role, 'FINANCE_OFFICER'),
        ),
      );
    for (const r of recipients) {
      this.notifications.enqueueCreate({
        userId: r.id,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: { batchId: payload.batchId, branchId },
      });
    }
  }
}

// ── tx type alias ──────────────────────────────────────────────
type TxLike = Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0];
