import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, ne, and, or, desc, gte, lte, isNull, isNotNull, ilike, count, sum, inArray, sql, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { computePaye, db as schema } from '@yannis/shared';
import type {
  GenerateBatchInput,
  GenerateBatchesBulkInput,
  PreviewSelectionInput,
  SubmitBatchInput,
  DeleteBatchInput,
  ApproveBatchInput,
  RejectBatchInput,
  MarkBatchPaidInput,
  ListMonthlyPayrollsInput,
  AddBatchAdjustmentInput,
  RemovePayoutLineInput,
  PayrollDepartment,
  PayrollBatchStatus,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor, withActorAndBranch } from '../common/db/with-actor';
import { GeneralLedgerService } from '../finance/general-ledger.service';
import { runGlPostWithFinanceAlert } from '../finance/gl-posting-notify';
import { canAccessStaffHrUserDetail, isOrgWideDepartmentHead } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isBranchTeamsSchemaMissingError } from '../common/db/branch-teams-schema';
import { resolveApplicableCommissionPlan } from './commission-plan-resolution';
import { computeEarningsFromPlanRules } from './commission-rules-math';
import { PayrollComputeService } from './payroll-compute.service';
import { PayrollMetricsService } from './payroll-metrics.service';
import { nigeriaMonthWindow } from '../common/utils/date-range';
import type { PayrollMetrics } from '@yannis/shared';

/**
 * Predicate: an adjustment is eligible to attach to a batch for `periodMonth`
 * (a YYYY-MM-01 string) when it has been APPROVED (approved_by IS NOT NULL) AND
 * is not yet linked to a payout AND is either un-earmarked (period_month IS NULL,
 * legacy "next batch, any month") or earmarked for exactly this month. Used by
 * every sweep + compute read so the link, compute, and preview paths stay in
 * lockstep. The approval gate is essential: without it, unapproved (and rejected,
 * which also have approved_by NULL) adjustments would leak onto generated payroll.
 */
function pendingAdjustmentForMonth(periodMonth: string) {
  return and(
    isNotNull(schema.earningsAdjustments.approvedBy),
    isNull(schema.earningsAdjustments.payoutId),
    or(
      isNull(schema.earningsAdjustments.periodMonth),
      eq(schema.earningsAdjustments.periodMonth, periodMonth),
    ),
  );
}

/**
 * A "null-scope" batch groups contractors (CONTRACTORS) or everyone company-wide
 * (ALL) and carries no department (and usually no branch). scope_type is the
 * authoritative discriminator — see the payroll_batches table doc (migration 0287).
 * Every branch/department guard downstream branches on this predicate.
 */
function isNullScopeType(scopeType: string | null | undefined): boolean {
  return scopeType === 'CONTRACTORS' || scopeType === 'ALL';
}

// Banks require the salary narration to be between 5 and 47 characters.
const BANK_NARRATION_MIN = 5;
const BANK_NARRATION_MAX = 47;

// Short "Mon YYYY" tag for narrations (e.g. "Jul 2026"). Avoids the full
// locale month name so more of the beneficiary name fits inside 47 chars.
function formatBankNarrationPeriod(periodMonth: string): string {
  const d = new Date(periodMonth);
  if (Number.isNaN(d.getTime())) return String(periodMonth).slice(0, 7);
  return d.toLocaleDateString('en-NG', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Build a bank-compliant salary narration clamped to [5, 47] chars.
// Strips characters most bank portals reject, then truncates the name (not the
// "Salary <period>" suffix) so the period stays intact, and pads if too short.
function buildBankNarration(beneficiaryName: string, period: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const name = clean(beneficiaryName);
  const suffix = clean(`Salary ${period}`);

  let narration = clean(`${name} ${suffix}`);
  if (narration.length > BANK_NARRATION_MAX) {
    // Trim the name so the "Salary <period>" suffix always survives.
    const room = BANK_NARRATION_MAX - suffix.length - 1; // -1 for the joining space
    const trimmedName = room > 0 ? name.slice(0, room).trim() : '';
    narration = clean(trimmedName ? `${trimmedName} ${suffix}` : suffix).slice(0, BANK_NARRATION_MAX);
  }
  if (narration.length < BANK_NARRATION_MIN) {
    narration = (narration + ' Salary').trim().padEnd(BANK_NARRATION_MIN, '.').slice(0, BANK_NARRATION_MAX);
  }
  return narration;
}

function isNullScopeBatch(batch: { scopeType?: string | null }): boolean {
  return isNullScopeType(batch.scopeType);
}

/**
 * Maps the four payroll departments to the staff roles each contains.
 *
 * HR is the catch-all for staff who don't sit under a Head of Department:
 * HR Manager themselves, the Heads (their own pay can't be in their own batch),
 * Branch Admins, and the Finance Officer.
 *
 * ADMIN is a real staff role on payroll (OPERATIONS). SUPER_ADMIN is the system
 * owner and is NEVER on payroll — it is intentionally absent from every department
 * here, and the generation roster additionally hard-excludes it (see
 * `synthesizeDraftBatchContent`) so no scope (including ALL) can ever pay it.
 *
 * Exported because plan creation (`HrService.createCommissionPlan`) and listing reuse the
 * same dept↔role mapping to scope what each Head can see + edit.
 */
export const DEPARTMENT_ROLES: Record<PayrollDepartment, readonly string[]> = {
  CS: ['CS_CLOSER', 'HEAD_OF_CS'],
  MARKETING: ['MEDIA_BUYER', 'HEAD_OF_MARKETING'],
  LOGISTICS: ['HEAD_OF_LOGISTICS', 'TPL_MANAGER', 'STOCK_MANAGER'],
  HR: ['HR_MANAGER', 'BRANCH_ADMIN'],
  OPERATIONS: ['ADMIN'],
  FINANCE: ['FINANCE_OFFICER', 'AUDITOR'],
  SUPPORT: ['SUPPORT'],
} as const;

export const DEPARTMENT_OWNER_ROLE: Record<PayrollDepartment, string> = {
  CS: 'HEAD_OF_CS',
  MARKETING: 'HEAD_OF_MARKETING',
  LOGISTICS: 'HEAD_OF_LOGISTICS',
  HR: 'HR_MANAGER',
  OPERATIONS: 'SUPER_ADMIN',
  FINANCE: 'FINANCE_OFFICER',
  SUPPORT: 'SUPER_ADMIN',
};

/**
 * Roles a viewer is allowed to manage commission plans for. Mirrors the batch ownership rules:
 *   - Admin: every role
 *   - HR Manager: every role (the catch-all owner)
 *   - HEAD_OF_CS: CS_CLOSER
 *   - HEAD_OF_MARKETING: MEDIA_BUYER
 *   - HEAD_OF_LOGISTICS: LOGISTICS_MANAGER + TPL_MANAGER + STOCK_MANAGER
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

/**
 * Payroll disbursement stage (Mark Paid + bank export). Requires finance.disburse
 * (Finance) OR payroll.run.disburse (HR completing its own payroll run) — NOT
 * merely cost-view / auditor. payroll.run.disburse is payroll-scoped and does not
 * confer funding approvals or the finance disbursements page.
 */
function canProcessBatch(user: SessionUser): boolean {
  if (user.role === 'SUPER_ADMIN' || user.role === 'SUPPORT') return true;
  const perms = user.permissions ?? [];
  return perms.includes('finance.disburse') || perms.includes('payroll.run.disburse');
}

function assertBatchInScope(
  batch: { branchId: string | null; scopeType?: string | null },
  viewer: SessionUser,
  effectiveBranchIds?: string[] | null,
) {
  if (viewer.role === 'SUPER_ADMIN' || viewer.role === 'SUPPORT') return;

  // Null-scope batch with no branch (contractors org-wide / ALL): only holders of
  // hr.write may act. A CONTRACTORS batch that DOES carry a branch (a Head running
  // their own branch's contractors) falls through to the normal branch check below.
  if (!batch.branchId) {
    if (isNullScopeBatch(batch) && (viewer.permissions ?? []).includes('hr.write')) return;
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only HR or an admin can act on an org-wide payroll batch.',
    });
  }

  if (effectiveBranchIds?.length) {
    if (!effectiveBranchIds.includes(batch.branchId)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Batch is outside your company or branch scope.',
      });
    }
    return;
  }
  if (viewer.currentBranchId && viewer.currentBranchId !== batch.branchId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Batch is outside your branch scope.',
    });
  }
}

interface PayoutRow {
  staffId: string;
  baseSalary: number;
  performanceBonus: number;
  addOnsTotal: number;
  deductionsTotal: number;
  totalPayout: number;
  allowancesTotal?: number;
  grossPay?: number;
  payeTax?: number;
  employerPayeSubsidy?: number;
  netPay?: number;
  metricsSnapshot?: unknown;
  bonusBreakdown?: unknown;
  lineStatus?: 'OK' | 'NEEDS_ATTENTION' | 'MANUALLY_OVERRIDDEN';
  payRoleName?: string | null;
  proration?: {
    activeDays: number;
    periodDays: number;
    fraction: number;
    reason: string;
  } | null;
}

/**
 * A single staff/contractor line in a preview roster. Shared by the single-slot
 * preview (`previewBatch`) and the multi-scope selection preview so the UI can
 * render the same table for a one-branch run or a full org-wide fan-out.
 */
export interface PreviewLineRow {
  staffId: string;
  staffName: string;
  staffRole: string;
  baseSalary: number;
  performanceBonus: number;
  addOnsTotal: number;
  deductionsTotal: number;
  grossPay: number;
  payeTax: number;
  totalPayout: number;
  /** Which branch/department slot this line belongs to (fan-out context). */
  branchName?: string | null;
  department?: PayrollDepartment | null;
}

/** Legacy rows may have total_payout populated while gross/net defaulted to 0. */
function effectivePayoutAmounts(p: {
  grossPay?: string | number | null;
  netPay?: string | number | null;
  payeTax?: string | number | null;
  totalPayout?: string | number | null;
  baseSalary?: string | number | null;
  performanceBonus?: string | number | null;
  addOnsTotal?: string | number | null;
  allowancesTotal?: string | number | null;
}) {
  const total = Number(p.totalPayout ?? 0);
  const grossRaw = Number(p.grossPay ?? 0);
  const netRaw = Number(p.netPay ?? 0);
  const componentGross =
    Number(p.baseSalary ?? 0) +
    Number(p.performanceBonus ?? 0) +
    Number(p.addOnsTotal ?? 0) +
    Number(p.allowancesTotal ?? 0);
  const gross = grossRaw > 0 ? grossRaw : total > 0 ? total : componentGross;
  const net = netRaw > 0 ? netRaw : total;
  // Cash to bank / payslip NET = totalPayout when set.
  const cash = total > 0 ? total : net;
  return { gross, net, paye: Number(p.payeTax ?? 0), total, cash };
}

@Injectable()
export class PayrollBatchService {
  private readonly logger = new Logger(PayrollBatchService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationsService,
    private readonly generalLedger: GeneralLedgerService,
    private readonly payrollCompute: PayrollComputeService,
    private readonly payrollMetrics: PayrollMetricsService,
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

  private async canPrepareDept(
    user: SessionUser,
    branchId: string | null,
    dept: PayrollDepartment | null,
  ): Promise<boolean> {
    // Null-scope batch (no department): only HR/admin (hr.write) may prepare, except
    // a branch-pinned contractor batch which a Head of that branch may also prepare.
    if (!dept) {
      if (user.role === 'SUPER_ADMIN' || (user.permissions ?? []).includes('hr.write')) return true;
      return !!branchId && user.currentBranchId === branchId;
    }
    if (!branchId) {
      return user.role === 'SUPER_ADMIN' || (user.permissions ?? []).includes('hr.write');
    }
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
    // Null-scope batches (CONTRACTORS / ALL) have their own, simpler path — no
    // department slot, no per-branch staff fan-out.
    if (isNullScopeType(input.scopeType)) {
      return this.generateNullScopeBatch(input, actor);
    }

    // From here on branchId + department are guaranteed present (validator refine).
    const branchId = input.branchId as string;
    const department = input.department as PayrollDepartment;
    const scopeBranchIds = [
      ...new Set(
        (input.scopeBranchIds?.length ? input.scopeBranchIds : [branchId]).filter(Boolean),
      ),
    ];
    if (!scopeBranchIds.includes(branchId)) {
      scopeBranchIds.unshift(branchId);
    }
    const scopeType =
      input.scopeType ?? (scopeBranchIds.length > 1 ? 'BRANCHES' : 'DEPARTMENT');

    for (const bid of scopeBranchIds) {
      if (!(await this.canPrepareDept(actor, bid, department))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `You cannot prepare a payroll batch for ${department} on one of the selected branches.`,
        });
      }
    }

    // periodMonth is validated as YYYY-MM-01 — do not append another `-01`.
    const { periodStart, periodEnd } = nigeriaMonthWindow(input.periodMonth);

    return withActorAndBranch(this.db, { id: actor.id, currentBranchId: branchId }, async (tx) => {
      // Look up existing batch in this slot
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

      if (existing && existing.status === 'PAID') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Cannot regenerate a PAID batch. Paid payroll is an immutable financial record.',
        });
      }
      // Editable until Finance marks it paid (CEO 2026-08-05). A DRAFT batch may be
      // regenerated by its owning preparer (already cleared by the upfront
      // canPrepareDept check); once it is PENDING_HR / PENDING_FINANCE only
      // HR/admins (hr.write) may regenerate it, so a department head can't rebuild
      // a run after handing it up.
      if (existing && existing.status !== 'DRAFT' && !canReviewBatch(actor)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Batch is ${existing.status} — only HR Manager or admins can regenerate it before Finance marks it paid.`,
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
          .set({
            preparedBy: actor.id,
            preparedAt: new Date(),
            includeContractors: input.includeContractors ?? false,
            scopeType,
            scopeBranchIds: scopeBranchIds.length > 1 ? scopeBranchIds : null,
            scopeEmployeeIds: input.scopeEmployeeIds ?? null,
            runLabel: input.runLabel ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.payrollBatches.id, batchId));
      } else {
        const inserted = await tx
          .insert(schema.payrollBatches)
          .values({
            branchId,
            periodMonth: input.periodMonth,
            department,
            status: 'DRAFT',
            preparedBy: actor.id,
            preparedAt: new Date(),
            includeContractors: input.includeContractors ?? false,
            scopeType,
            scopeBranchIds: scopeBranchIds.length > 1 ? scopeBranchIds : null,
            scopeEmployeeIds: input.scopeEmployeeIds ?? null,
            runLabel: input.runLabel ?? null,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create batch' });
        batchId = row.id;
      }

      const { generated, totalAmount } = await this.synthesizeDraftBatchContent(
        tx,
        batchId,
        branchId,
        department,
        periodStart,
        periodEnd,
        input.periodMonth,
        {
          includeContractors: input.includeContractors ?? false,
          scopeEmployeeIds: input.scopeEmployeeIds ?? null,
          scopeBranchIds,
          includeNullBranch: input.includeNullBranch ?? false,
        },
      );
      return { batchId, generated, totalAmount };
    });
  }

  /**
   * Generate a null-scope batch (CONTRACTORS or ALL) — no department slot.
   *
   * - CONTRACTORS: contractor payouts only. branchId optional (a Head may run their
   *   own branch's contractors; admin/HR run org-wide with branchId null).
   * - ALL: every staff role across every branch + contractors, company-wide.
   *   branchId/department always null.
   *
   * Deduped by the partial index uq_payroll_batch_null_scope on
   * (scope_type, period_month, branch, run_label).
   */
  private async generateNullScopeBatch(input: GenerateBatchInput, actor: SessionUser) {
    const scopeType = input.scopeType as 'CONTRACTORS' | 'ALL';
    // ALL is org-wide by definition; CONTRACTORS may be branch-pinned by a Head.
    const branchId = scopeType === 'ALL' ? null : (input.branchId ?? null);

    // Authz: org-wide (no branch) requires hr.write; a branch-pinned CONTRACTORS
    // batch is allowed to that branch's preparers (Heads) too.
    const hasHrWrite =
      actor.role === 'SUPER_ADMIN' || (actor.permissions ?? []).includes('hr.write');
    if (!branchId) {
      if (!hasHrWrite) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only HR or an admin can generate an org-wide payroll batch.',
        });
      }
    } else if (!hasHrWrite && actor.currentBranchId !== branchId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You can only generate a contractor batch for your own branch.',
      });
    }

    const { periodStart, periodEnd } = nigeriaMonthWindow(input.periodMonth);
    const scopeBranchIds = branchId ? [branchId] : null;

    return withActorAndBranch(this.db, { id: actor.id, currentBranchId: branchId }, async (tx) => {
      // Dedup on (scope_type, month, branch, run_label) — mirrors the partial index.
      const existing = (
        await tx
          .select()
          .from(schema.payrollBatches)
          .where(
            and(
              eq(schema.payrollBatches.scopeType, scopeType),
              eq(schema.payrollBatches.periodMonth, input.periodMonth),
              branchId
                ? eq(schema.payrollBatches.branchId, branchId)
                : isNull(schema.payrollBatches.branchId),
              input.runLabel
                ? eq(schema.payrollBatches.runLabel, input.runLabel)
                : isNull(schema.payrollBatches.runLabel),
            ),
          )
          .limit(1)
      )[0];

      if (existing && existing.status === 'PAID') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Cannot regenerate a PAID batch. Paid payroll is an immutable financial record.',
        });
      }
      // Editable until Finance marks it paid (CEO 2026-08-05). Beyond DRAFT, only
      // HR/admins (hr.write) may regenerate — a branch head who prepared a pinned
      // contractor batch can't rebuild it once it has been submitted.
      if (existing && existing.status !== 'DRAFT' && !canReviewBatch(actor)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Batch is ${existing.status} — only HR Manager or admins can regenerate it before Finance marks it paid.`,
        });
      }

      let batchId: string;
      if (existing) {
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
        await tx
          .update(schema.payrollBatches)
          .set({ preparedBy: actor.id, preparedAt: new Date(), runLabel: input.runLabel ?? null, updatedAt: new Date() })
          .where(eq(schema.payrollBatches.id, batchId));
      } else {
        const inserted = await tx
          .insert(schema.payrollBatches)
          .values({
            branchId,
            periodMonth: input.periodMonth,
            department: null,
            status: 'DRAFT',
            preparedBy: actor.id,
            preparedAt: new Date(),
            // CONTRACTORS = contractors only (no staff). ALL = staff + contractors.
            includeContractors: true,
            scopeType,
            scopeBranchIds,
            runLabel: input.runLabel ?? null,
          })
          .returning();
        const row = inserted[0];
        if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create batch' });
        batchId = row.id;
      }

      const { generated, totalAmount } = await this.synthesizeDraftBatchContent(
        tx,
        batchId,
        branchId,
        null,
        periodStart,
        periodEnd,
        input.periodMonth,
        {
          includeContractors: true,
          staffMode: scopeType === 'ALL' ? 'all' : 'none',
          scopeBranchIds,
        },
      );
      return { batchId, generated, totalAmount };
    });
  }

  /**
   * Create DRAFT batches for every (branchId × department) slot that has no row yet.
   * Existing slots (any status, including DRAFT) are skipped — use `generateBatch` to refresh a single DRAFT.
   *
   * When `combineBranches` is true, each department gets one batch spanning all
   * selected branches (home branch = first id) instead of a cartesian fan-out.
   */
  async generateBatchesBulk(input: GenerateBatchesBulkInput, actor: SessionUser) {
    // Null-scope (CONTRACTORS / ALL) is a single batch, not a fan-out. Delegate to
    // the single-batch path and return a bulk-shaped summary.
    if (isNullScopeType(input.scopeType)) {
      const out = await this.generateNullScopeBatch(
        {
          periodMonth: input.periodMonth,
          scopeType: input.scopeType,
          // A CONTRACTORS run may still be branch-pinned (single selected branch).
          branchId: input.scopeType === 'CONTRACTORS' ? input.branchIds[0] : undefined,
          runLabel: input.runLabel,
        },
        actor,
      );
      return {
        created: [{ batchId: out.batchId, branchId: input.branchIds[0] ?? null, department: null }],
        skipped: [],
        summaryMessage: 'Created 1 batch · skipped 0',
      };
    }
    if (input.combineBranches) {
      const homeBranchId = input.branchIds[0];
      if (!homeBranchId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select at least one branch.' });
      }
      const created: Array<{ batchId: string; branchId: string; department: PayrollDepartment }> = [];
      const skipped: Array<{
        branchId: string;
        department: PayrollDepartment;
        reason: 'FORBIDDEN' | 'EXISTS';
        status?: PayrollBatchStatus;
      }> = [];

      for (const department of input.departments as PayrollDepartment[]) {
        try {
          const out = await this.generateBatch(
            {
              branchId: homeBranchId,
              department,
              periodMonth: input.periodMonth,
              scopeType: input.branchIds.length > 1 ? 'BRANCHES' : 'DEPARTMENT',
              scopeBranchIds: input.branchIds,
              includeContractors: input.includeContractors ?? false,
              // Combined batch spans all branches → the single per-department batch
              // is the only place no-branch staff can ride along.
              includeNullBranch: input.includeNullBranch ?? false,
              runLabel: input.runLabel,
            },
            actor,
          );
          created.push({ batchId: out.batchId, branchId: homeBranchId, department });
        } catch (err) {
          if (err instanceof TRPCError && err.code === 'FORBIDDEN') {
            skipped.push({ branchId: homeBranchId, department, reason: 'FORBIDDEN' });
            continue;
          }
          if (err instanceof TRPCError && err.code === 'CONFLICT') {
            skipped.push({ branchId: homeBranchId, department, reason: 'EXISTS' });
            continue;
          }
          throw err;
        }
      }

      const summaryMessage = `Created ${created.length} batch${created.length === 1 ? '' : 'es'} · skipped ${skipped.length}`;
      return { created, skipped, summaryMessage };
    }

    const { periodStart, periodEnd } = nigeriaMonthWindow(input.periodMonth);

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
              input.periodMonth,
              {
                // No-branch staff ride along on the HOME branch's batch only, so a
                // fan-out across branches never pays them more than once per dept.
                includeNullBranch: (input.includeNullBranch ?? false) && branchId === input.branchIds[0],
              },
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
    // NULL for null-scope batches (contractors org-wide / ALL). When null and
    // staffMode is 'all', staff span every branch.
    branchId: string | null,
    // NULL for null-scope batches — no department slot; staff selection then uses
    // staffMode instead of DEPARTMENT_ROLES.
    department: PayrollDepartment | null,
    periodStart: Date,
    periodEnd: Date,
    // YYYY-MM-01 for this batch. Passed explicitly (not derived from periodStart,
    // which is a UTC+1 instant whose UTC month can be the previous calendar month)
    // so period-earmarked adjustments attach to the correct month.
    periodMonth: string,
    opts: {
      includeContractors?: boolean;
      scopeEmployeeIds?: string[] | null;
      scopeBranchIds?: string[] | null;
      // 'department' (default): staff in DEPARTMENT_ROLES[department] on the scoped
      // branches. 'none': no staff (contractors-only batch). 'all': every payroll
      // role across every branch (ALL scope).
      staffMode?: 'department' | 'none' | 'all';
      // Also include matching-role staff with no primary branch (they ride along
      // on this batch). Ignored for staffMode 'all' (already spans all staff).
      includeNullBranch?: boolean;
    } = {},
  ): Promise<{ generated: number; totalAmount: number }> {
    const staffMode = opts.staffMode ?? 'department';
    // Roles this batch pays: a specific department's roles, or every payroll role
    // for an ALL-scope batch.
    const targetRoles =
      staffMode === 'all'
        ? [...new Set(Object.values(DEPARTMENT_ROLES).flat())]
        : department
          ? [...DEPARTMENT_ROLES[department]]
          : [];
    const scopeBranchIds = opts.scopeBranchIds?.length
      ? [...new Set(opts.scopeBranchIds.filter(Boolean))]
      : branchId
        ? [branchId]
        : [];
    // Include ACTIVE staff, plus mid-period leavers (now INACTIVE) whose exit
    // date falls inside this period — they're owed a final prorated payout.
    const periodEndYmd = periodEnd.toISOString().slice(0, 10);
    const periodStartYmd = periodStart.toISOString().slice(0, 10);
    // Branch predicate: ALL scope spans every branch (no filter). Otherwise scope
    // to the selected branches, optionally OR-ing in no-branch staff who ride along.
    const branchPredicate = scopeBranchIds.length
      ? opts.includeNullBranch
        ? or(
            inArray(schema.users.primaryBranchId, scopeBranchIds),
            isNull(schema.users.primaryBranchId),
          )
        : inArray(schema.users.primaryBranchId, scopeBranchIds)
      : sql`true`;
    let staff =
      staffMode === 'none' || targetRoles.length === 0
        ? []
        : await tx
            .select()
            .from(schema.users)
            .where(
              and(
                branchPredicate,
                inArray(schema.users.role, targetRoles as unknown as typeof schema.users.$inferSelect['role'][]),
                // Hard guardrail: SUPER_ADMIN is never on payroll and must never be
                // generated into a batch, regardless of scope (incl. ALL). Belt-and-
                // suspenders over DEPARTMENT_ROLES so a future edit can't reintroduce it.
                ne(schema.users.role, 'SUPER_ADMIN'),
                or(
                  eq(schema.users.status, 'ACTIVE'),
                  and(
                    gte(schema.users.exitDate, periodStartYmd),
                    lte(schema.users.exitDate, periodEndYmd),
                  ),
                ),
              ),
            );

    if (opts.scopeEmployeeIds?.length) {
      const allowed = new Set(opts.scopeEmployeeIds);
      staff = staff.filter((s) => allowed.has(s.id));
    }

    // Drop staff who joined after the period ended (no active days → no pay).
    staff = staff.filter((s) => !s.dateOfJoining || s.dateOfJoining <= periodEndYmd);

    const generatedPayouts: PayoutRow[] = [];

    // Compute every member's payout in ONE batched pass (a handful of aggregate
    // queries) instead of ~10 queries per member, then bulk-insert. Produces rows
    // identical to the per-member computePayoutForMember (same formula/PAYE math).
    const payableStaff = staff.filter((m) => m.onboardingPayrollStatus !== 'PENDING_APPROVAL');
    if (payableStaff.length > 0) {
      const computedByStaff = await this.computeStaffPayoutsBatched(
        tx,
        payableStaff,
        periodStart,
        periodEnd,
        periodMonth,
      );

      const insertValues = payableStaff.map((member) => {
        const computed =
          computedByStaff.get(member.id) ??
          { baseSalary: 0, performanceBonus: 0, addOnsTotal: 0, deductionsTotal: 0, totalPayout: 0 };
        generatedPayouts.push({ staffId: member.id, ...computed });
        return {
          batchId,
          staffId: member.id,
          periodStart,
          periodEnd,
          baseSalary: sql`${computed.baseSalary.toFixed(2)}::numeric`,
          performanceBonus: sql`${computed.performanceBonus.toFixed(2)}::numeric`,
          addOnsTotal: sql`${computed.addOnsTotal.toFixed(2)}::numeric`,
          deductionsTotal: sql`${computed.deductionsTotal.toFixed(2)}::numeric`,
          totalPayout: sql`${computed.totalPayout.toFixed(2)}::numeric`,
          allowancesTotal: sql`${(computed.allowancesTotal ?? 0).toFixed(2)}::numeric`,
          grossPay: sql`${(computed.grossPay ?? computed.totalPayout).toFixed(2)}::numeric`,
          payeTax: sql`${(computed.payeTax ?? 0).toFixed(2)}::numeric`,
          employerPayeSubsidy: sql`${(computed.employerPayeSubsidy ?? 0).toFixed(2)}::numeric`,
          netPay: sql`${(computed.netPay ?? computed.totalPayout).toFixed(2)}::numeric`,
          // Fold proration detail into the metrics snapshot jsonb (no schema
          // change) so payslips can show "N of M days worked" for partial months.
          metricsSnapshot: computed.metricsSnapshot
            ? { ...computed.metricsSnapshot, proration: computed.proration ?? null }
            : computed.proration
              ? { proration: computed.proration }
              : null,
          bonusBreakdown: computed.bonusBreakdown ?? null,
          lineStatus: computed.lineStatus ?? 'OK',
          payRoleName: computed.payRoleName ?? null,
          status: 'DRAFT' as const,
        };
      });

      // Bulk insert all staff payouts, returning the new id per staff so we can
      // link their pending adjustments.
      const insertedRows = await tx
        .insert(schema.payoutRecords)
        .values(insertValues)
        .returning({ id: schema.payoutRecords.id, staffId: schema.payoutRecords.staffId });

      // Link each member's pending, month-eligible adjustments to their new payout.
      for (const row of insertedRows) {
        if (!row.staffId) continue;
        await tx
          .update(schema.earningsAdjustments)
          .set({ payoutId: row.id })
          .where(
            and(
              eq(schema.earningsAdjustments.staffId, row.staffId),
              pendingAdjustmentForMonth(periodMonth),
            ),
          );
      }
    }

    if (opts.includeContractors) {
      // Org-wide null-scope batch (branchId null): every active contractor across
      // all companies. Branch-scoped batch: contractors on the scoped branch(es)
      // (plus branch-null shared) within that branch's company.
      const branchRow = branchId
        ? (
            await tx
              .select({ groupId: schema.branches.groupId })
              .from(schema.branches)
              .where(eq(schema.branches.id, branchId))
              .limit(1)
          )[0]
        : undefined;

      const contractors = await tx
        .select()
        .from(schema.payrollContractors)
        .where(
          and(
            eq(schema.payrollContractors.active, true),
            branchId
              ? and(
                  or(
                    scopeBranchIds.length
                      ? inArray(schema.payrollContractors.branchId, scopeBranchIds)
                      : sql`false`,
                    isNull(schema.payrollContractors.branchId),
                  ),
                  // Exact company only — never include null-scoped shared contractors.
                  branchRow?.groupId
                    ? eq(schema.payrollContractors.groupId, branchRow.groupId)
                    : sql`false`,
                )
              : sql`true`, // org-wide: all active contractors, any company
          ),
        );

      // Company PAYE bands for contractor fee tax. For a single-company batch use
      // that company's config; org-wide falls back to the global/default config.
      const taxConfig = await this.payrollCompute.loadTaxConfig(tx, branchRow?.groupId ?? null);

      const contractorRoleIds = [
        ...new Set(
          contractors
            .map((c) => c.payRoleId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];
      const roleTaxRows =
        contractorRoleIds.length > 0
          ? await tx
              .select({
                id: schema.payrollPayRoles.id,
                defaultTaxStatus: schema.payrollPayRoles.defaultTaxStatus,
              })
              .from(schema.payrollPayRoles)
              .where(inArray(schema.payrollPayRoles.id, contractorRoleIds))
          : [];
      const roleTaxById = new Map(roleTaxRows.map((r) => [r.id, r.defaultTaxStatus]));

      for (const contractor of contractors) {
        const fee = Number(contractor.monthlyFee);
        if (fee <= 0) continue;
        const roleTax = contractor.payRoleId ? roleTaxById.get(contractor.payRoleId) : undefined;
        const taxStatus =
          (roleTax as 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION' | undefined) ??
          (contractor.taxStatus as 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION') ??
          'GROSS_NO_DEDUCTION';
        const paye = computePaye({ monthlyGross: fee, taxStatus }, taxConfig);

        // Fold pending manual adjustments (bonuses / deductions / penalties) that
        // HR applied to this contractor. Deduction categories are stored negative;
        // add-ons positive (same convention as staff earnings adjustments).
        const [contractorClawbackRows, contractorAddOnRows] = await Promise.all([
          tx
            .select({ total: sum(schema.earningsAdjustments.amount) })
            .from(schema.earningsAdjustments)
            .where(
              and(
                eq(schema.earningsAdjustments.contractorId, contractor.id),
                inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
                pendingAdjustmentForMonth(periodMonth),
              ),
            ),
          tx
            .select({ total: sum(schema.earningsAdjustments.amount) })
            .from(schema.earningsAdjustments)
            .where(
              and(
                eq(schema.earningsAdjustments.contractorId, contractor.id),
                inArray(schema.earningsAdjustments.category, ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER']),
                pendingAdjustmentForMonth(periodMonth),
              ),
            ),
        ]);
        const clawbackTotal = Math.abs(Number(contractorClawbackRows[0]?.total ?? 0));
        const addOnsTotal = Number(contractorAddOnRows[0]?.total ?? 0);

        const grossPay = fee + addOnsTotal;
        const deductionsTotal = paye.employeePaye + clawbackTotal;
        const netPay = Math.max(0, grossPay - paye.employeePaye - clawbackTotal);
        const inserted = await tx
          .insert(schema.payoutRecords)
          .values({
            batchId,
            contractorId: contractor.id,
            staffId: null,
            periodStart,
            periodEnd,
            baseSalary: sql`${fee.toFixed(2)}::numeric`,
            performanceBonus: sql`0::numeric`,
            addOnsTotal: sql`${addOnsTotal.toFixed(2)}::numeric`,
            deductionsTotal: sql`${deductionsTotal.toFixed(2)}::numeric`,
            totalPayout: sql`${netPay.toFixed(2)}::numeric`,
            allowancesTotal: sql`0::numeric`,
            grossPay: sql`${grossPay.toFixed(2)}::numeric`,
            payeTax: sql`${paye.employeePaye.toFixed(2)}::numeric`,
            employerPayeSubsidy: sql`${paye.employerSubsidy.toFixed(2)}::numeric`,
            netPay: sql`${netPay.toFixed(2)}::numeric`,
            payRoleName: contractor.name,
            lineStatus: 'OK',
            status: 'DRAFT',
          })
          .returning({ id: schema.payoutRecords.id });

        // Link the settled adjustments to this payout so they aren't re-applied.
        const contractorPayoutId = inserted[0]?.id;
        if (contractorPayoutId) {
          await tx
            .update(schema.earningsAdjustments)
            .set({ payoutId: contractorPayoutId })
            .where(
              and(
                eq(schema.earningsAdjustments.contractorId, contractor.id),
                pendingAdjustmentForMonth(periodMonth),
              ),
            );
        }

        generatedPayouts.push({
          staffId: contractor.id,
          baseSalary: fee,
          performanceBonus: 0,
          addOnsTotal,
          deductionsTotal,
          totalPayout: netPay,
          grossPay,
          payeTax: paye.employeePaye,
          netPay,
          payRoleName: contractor.name,
        });
      }
    }

    const totalAmount = generatedPayouts.reduce((acc, p) => acc + p.totalPayout, 0);
    const totalGross = generatedPayouts.reduce((acc, p) => acc + (p.grossPay ?? p.totalPayout), 0);
    const totalTax = generatedPayouts.reduce((acc, p) => acc + (p.payeTax ?? 0), 0);
    const totalNet = generatedPayouts.reduce((acc, p) => acc + (p.netPay ?? p.totalPayout), 0);
    await tx
      .update(schema.payrollBatches)
      .set({
        staffCount: generatedPayouts.length,
        totalAmount: sql`${totalAmount.toFixed(2)}::numeric`,
        totalGross: sql`${totalGross.toFixed(2)}::numeric`,
        totalTax: sql`${totalTax.toFixed(2)}::numeric`,
        totalNet: sql`${totalNet.toFixed(2)}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(schema.payrollBatches.id, batchId));

    return { generated: generatedPayouts.length, totalAmount };
  }

  /**
   * BATCHED per-staff compute for the PREVIEW path only. Given the already-selected
   * staff, it does all the per-member DB work as a handful of AGGREGATE queries
   * (order metrics, team-DR, CPA, plan/pay-role/tax-config resolution, adjustment
   * sums) and then computes each member's line IN MEMORY via
   * `payrollCompute.computeForMemberInMemory` — reusing the exact same formula /
   * proration / PAYE math `computeForMember` runs. Produces payout rows identical
   * to the per-member `computePayoutForMember` for the same staff/period.
   *
   * Used by BOTH the selection preview and generation (which then bulk-inserts the
   * returned rows), so a batch's previewed total equals its generated total.
   */
  private async computeStaffPayoutsBatched(
    tx: DbOrTx,
    staff: Array<{
      id: string;
      name: string;
      role: string;
      commissionPlanId?: string | null;
      payRoleId?: string | null;
      salaryBasis?: string | null;
      taxStatus?: string | null;
      flatMonthlyAmount?: string | number | null;
      annualRent?: string | number | null;
      dateOfJoining?: string | Date | null;
      exitDate?: string | Date | null;
      primaryBranchId?: string | null;
    }>,
    periodStart: Date,
    periodEnd: Date,
    periodMonth: string,
  ): Promise<Map<string, Omit<PayoutRow, 'staffId'> | null>> {
    const out = new Map<string, Omit<PayoutRow, 'staffId'> | null>();
    if (staff.length === 0) return out;
    const staffIds = staff.map((s) => s.id);

    // --- 1) Branch + company (group) info for every member, in one query. -------
    // computeForMember reads each member's primary branch groupId (tax config +
    // effectiveBranchIds for team DR). Resolve all members' branches at once.
    const memberBranchRows = await tx
      .select({
        userId: schema.users.id,
        groupId: schema.branches.groupId,
        branchId: schema.branches.id,
      })
      .from(schema.users)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.users.primaryBranchId))
      .where(inArray(schema.users.id, staffIds));
    const memberBranchByUser = new Map(
      memberBranchRows.map((r) => [r.userId, { groupId: r.groupId, branchId: r.branchId }]),
    );

    // All branches per group → effectiveBranchIds for each member's team-DR scope.
    const groupIds = [...new Set(memberBranchRows.map((r) => r.groupId).filter(Boolean))] as string[];
    const groupBranches = new Map<string, string[]>();
    if (groupIds.length) {
      const gbRows = await tx
        .select({ id: schema.branches.id, groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(inArray(schema.branches.groupId, groupIds));
      for (const r of gbRows) {
        if (!r.groupId) continue;
        const list = groupBranches.get(r.groupId) ?? [];
        list.push(r.id);
        groupBranches.set(r.groupId, list);
      }
    }

    // --- 2) Reportee resolution for Heads (for team-DR), batched. ---------------
    // Mirror computeForMember's subordinate-role map + effective-branch scoping.
    const subordinateRoles: Record<string, string[]> = {
      HEAD_OF_CS: ['CS_CLOSER'],
      HEAD_OF_MARKETING: ['MEDIA_BUYER'],
      HEAD_OF_LOGISTICS: ['TPL_MANAGER', 'STOCK_MANAGER'],
    };
    const heads = staff.filter((s) => subordinateRoles[s.role]?.length);
    // Union of every role/branch pair we need reportees for → one query.
    const reporteeBranchScope = new Map<string, string[]>(); // headId → teamBranchIds
    const allSubRoles = new Set<string>();
    const allTeamBranchIds = new Set<string>();
    for (const head of heads) {
      const branchInfo = memberBranchByUser.get(head.id);
      const effective = branchInfo?.groupId ? groupBranches.get(branchInfo.groupId) ?? [] : [];
      const teamBranchIds = [
        ...new Set(
          (effective.length ? effective : branchInfo?.branchId ? [branchInfo.branchId] : []).filter(Boolean),
        ),
      ] as string[];
      reporteeBranchScope.set(head.id, teamBranchIds);
      for (const r of subordinateRoles[head.role] ?? []) allSubRoles.add(r);
      for (const b of teamBranchIds) allTeamBranchIds.add(b);
    }

    let reporteeRows: Array<{ id: string; role: string; primaryBranchId: string | null }> = [];
    if (allSubRoles.size && allTeamBranchIds.size) {
      reporteeRows = await tx
        .select({
          id: schema.users.id,
          role: schema.users.role,
          primaryBranchId: schema.users.primaryBranchId,
        })
        .from(schema.users)
        .where(
          and(
            inArray(schema.users.role, [...allSubRoles] as typeof schema.users.role.enumValues),
            eq(schema.users.status, 'ACTIVE'),
            inArray(schema.users.primaryBranchId, [...allTeamBranchIds]),
          ),
        );
    }
    // Resolve each head's reportee set in memory: role ∈ its subRoles AND branch ∈ its scope.
    const reporteesByHead = new Map<string, string[]>();
    for (const head of heads) {
      const subRoles = new Set(subordinateRoles[head.role]);
      const scope = new Set(reporteeBranchScope.get(head.id) ?? []);
      reporteesByHead.set(
        head.id,
        reporteeRows
          .filter((r) => subRoles.has(r.role) && r.primaryBranchId && scope.has(r.primaryBranchId))
          .map((r) => r.id),
      );
    }

    // --- 3) Order metrics (delivered/total/cohort/returned) for all staff. ------
    const metricsById = await this.payrollMetrics.getStaffMetricsBatched(
      staffIds,
      periodStart,
      periodEnd,
      tx,
    );

    // --- 4) Team-DR per Head + CPA for MB/HoM, batched. ------------------------
    const teamDrByHead = await this.payrollMetrics.computeTeamDrBatched(
      tx,
      reporteesByHead,
      periodStart,
      periodEnd,
    );
    const cpaStaffIds = staff
      .filter((s) => s.role === 'MEDIA_BUYER' || s.role === 'HEAD_OF_MARKETING')
      .map((s) => s.id);
    const totalOrdersByStaff = new Map<string, number>();
    for (const id of staffIds) totalOrdersByStaff.set(id, metricsById.get(id)?.totalOrders ?? 0);
    const cpaById = await this.payrollMetrics.computeCpaBatched(
      tx,
      cpaStaffIds,
      periodStart,
      periodEnd,
      totalOrdersByStaff,
    );

    // --- 5) Pending adjustment sums (clawback + add-on) for all staff. ---------
    const [clawbackRows, addOnRows] = await Promise.all([
      tx
        .select({
          staffId: schema.earningsAdjustments.staffId,
          total: sum(schema.earningsAdjustments.amount),
        })
        .from(schema.earningsAdjustments)
        .where(
          and(
            inArray(schema.earningsAdjustments.staffId, staffIds),
            inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
            pendingAdjustmentForMonth(periodMonth),
          ),
        )
        .groupBy(schema.earningsAdjustments.staffId),
      tx
        .select({
          staffId: schema.earningsAdjustments.staffId,
          total: sum(schema.earningsAdjustments.amount),
        })
        .from(schema.earningsAdjustments)
        .where(
          and(
            inArray(schema.earningsAdjustments.staffId, staffIds),
            inArray(schema.earningsAdjustments.category, ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER']),
            pendingAdjustmentForMonth(periodMonth),
          ),
        )
        .groupBy(schema.earningsAdjustments.staffId),
    ]);
    const clawbackByStaff = new Map(
      clawbackRows.map((r) => [r.staffId as string, Math.abs(Number(r.total ?? 0))]),
    );
    const addOnByStaff = new Map(addOnRows.map((r) => [r.staffId as string, Number(r.total ?? 0)]));

    // --- 6) Tax config (memoized per groupId) + plan/pay-role resolution. ------
    const taxConfigCache = new Map<string, Awaited<ReturnType<PayrollComputeService['loadTaxConfig']>>>();
    const loadTaxConfigCached = async (groupId: string | null) => {
      const key = groupId ?? '__null__';
      const hit = taxConfigCache.get(key);
      if (hit) return hit;
      const cfg = await this.payrollCompute.loadTaxConfig(tx, groupId);
      taxConfigCache.set(key, cfg);
      return cfg;
    };
    const payRoleCache = new Map<string, Awaited<ReturnType<PayrollComputeService['loadPayRole']>>>();
    const loadPayRoleCached = async (payRoleId: string) => {
      if (payRoleCache.has(payRoleId)) return payRoleCache.get(payRoleId) ?? null;
      const row = await this.payrollCompute.loadPayRole(tx, payRoleId);
      payRoleCache.set(payRoleId, row);
      return row;
    };
    // Plan resolution memo: keyed by payRoleId (payRole path) or role+commissionPlanId
    // (legacy path). Mirrors resolvePlanForMember's own branching exactly.
    const planCache = new Map<string, Awaited<ReturnType<PayrollComputeService['resolvePlanForMemberPublic']>>>();
    const resolvePlanCached = async (member: {
      id: string;
      role: string;
      commissionPlanId?: string | null;
      payRoleId?: string | null;
    }) => {
      const key = member.payRoleId
        ? `pr:${member.payRoleId}`
        : `role:${member.role}:${member.commissionPlanId ?? ''}`;
      if (planCache.has(key)) return planCache.get(key) ?? null;
      const plan = await this.payrollCompute.resolvePlanForMemberPublic(tx, member, periodStart, periodEnd);
      planCache.set(key, plan);
      return plan;
    };

    // --- 7) Compute each member's line IN MEMORY, folding in adjustments. ------
    for (const member of staff) {
      const branchInfo = memberBranchByUser.get(member.id);
      const groupId = branchInfo?.groupId ?? null;
      const base = metricsById.get(member.id) ?? PayrollMetricsService.PAY_METRIC_ZERO;

      // Rebuild the full PayrollMetrics object computeForMember would have — but
      // only the pay-relevant fields (display-only per-product/carry-over omitted).
      const individualDr = base.totalOrders > 0 ? (base.deliveredCohortCount / base.totalOrders) * 100 : 0;
      const teamDr = subordinateRoles[member.role]?.length ? teamDrByHead.get(member.id) : undefined;
      const cpa =
        member.role === 'MEDIA_BUYER' || member.role === 'HEAD_OF_MARKETING'
          ? cpaById.get(member.id) ?? null
          : null;
      const missingData =
        member.role !== 'HR_MANAGER' &&
        base.totalOrders === 0 &&
        base.deliveredCount === 0 &&
        !['FINANCE_OFFICER', 'BRANCH_ADMIN', 'STOCK_MANAGER'].includes(member.role);
      let metrics: PayrollMetrics = {
        individualDr,
        teamDr,
        cpa,
        deliveredCount: base.deliveredCount,
        deliveredCohortCount: base.deliveredCohortCount,
        totalOrders: base.totalOrders,
        returnedCount: base.returnedCount,
        missingData,
      };

      const [plan, payRole, taxConfig] = await Promise.all([
        resolvePlanCached(member),
        member.payRoleId ? loadPayRoleCached(member.payRoleId) : Promise.resolve(null),
        loadTaxConfigCached(groupId),
      ]);

      // Recovery categories count delivered orders across cart + delivered-follow-up
      // pipelines, which the funnel-only batched metrics query does not capture.
      // Recompute this small subset per-member so the preview matches generation.
      if (payRole?.deliveredMetricSource === 'RECOVERY_COMBINED') {
        metrics = await this.payrollMetrics.getStaffMetrics(
          {
            staffId: member.id,
            staffRole: member.role,
            periodStart,
            periodEnd,
            crmLinked: true,
            deliveredMetricSource: 'RECOVERY_COMBINED',
          },
          tx,
        );
      }

      const computed = this.payrollCompute.computeForMemberInMemory(
        member,
        periodStart,
        periodEnd,
        metrics,
        { plan: plan ? { planName: plan.planName, rules: plan.rules } : null, payRole, taxConfig },
      );

      if (!computed) {
        // computeForMember returns null → per-member path falls back to legacy
        // commission math. That path is rare (no PRD formula); run it per-member
        // so we never diverge from the authoritative compute for these staff.
        out.set(
          member.id,
          await this.computePayoutForMemberLegacy(tx, member, periodStart, periodEnd, periodMonth),
        );
        continue;
      }

      const clawbackTotal = clawbackByStaff.get(member.id) ?? 0;
      const addOnsTotal = addOnByStaff.get(member.id) ?? 0;
      const deductionsTotal = computed.deductionsTotal + clawbackTotal;
      const grossPay = computed.grossPay + addOnsTotal;
      const netPay = Math.max(0, grossPay - computed.payeTax - clawbackTotal);
      const totalPayout = netPay;

      if (totalPayout <= 0 && deductionsTotal <= 0 && computed.baseSalary <= 0) {
        out.set(member.id, null);
        continue;
      }

      out.set(member.id, {
        baseSalary: computed.baseSalary,
        performanceBonus: computed.performanceBonus,
        addOnsTotal,
        deductionsTotal,
        totalPayout,
        allowancesTotal: computed.allowancesTotal,
        grossPay,
        payeTax: computed.payeTax,
        employerPayeSubsidy: computed.employerPayeSubsidy,
        netPay,
        metricsSnapshot: computed.metricsSnapshot,
        bonusBreakdown: computed.bonusBreakdown,
        lineStatus: computed.lineStatus,
        payRoleName: computed.payRoleName,
        proration: computed.proration ?? null,
      });
    }

    return out;
  }

  /**
   * Read-only twin of `synthesizeDraftBatchContent` — same staff/contractor
   * SELECTION, but performs NO inserts (no payout_records, no earnings_adjustments
   * link, no batch rollup). Returns just the grand-total tallies for a single
   * batch slot. Staff lines are computed by the BATCHED fast path
   * (`computeStaffPayoutsBatched`): a handful of aggregate queries + the SAME
   * in-memory formula/proration/PAYE math `computeForMember` runs — so the total
   * equals the per-member compute while avoiding ~10 queries per person.
   *
   * INVARIANT (payroll correctness is paramount): the numbers this returns MUST
   * equal what `synthesizeDraftBatchContent` would insert for the SAME arguments.
   * Keep the selection predicates (branch/role/status filters) here in LOCKSTEP
   * with `synthesizeDraftBatchContent` above whenever either changes; the compute
   * math is shared via `payrollCompute.*` so it cannot drift.
   */
  private async computeSelectionTotals(
    tx: DbOrTx,
    opts: {
      branchId: string | null;
      department: PayrollDepartment | null;
      periodStart: Date;
      periodEnd: Date;
      periodMonth: string;
      includeContractors?: boolean;
      staffMode?: 'department' | 'none' | 'all';
      scopeEmployeeIds?: string[] | null;
      scopeBranchIds?: string[] | null;
      includeNullBranch?: boolean;
      /** When set, resolve staff/contractor branch names for the roster rows. */
      branchNameById?: Map<string, string> | null;
    },
  ): Promise<{ staffCount: number; contractorCount: number; totalAmount: number; rows: PreviewLineRow[] }> {
    const { branchId, department, periodStart, periodEnd, periodMonth } = opts;
    const staffMode = opts.staffMode ?? 'department';
    const targetRoles =
      staffMode === 'all'
        ? [...new Set(Object.values(DEPARTMENT_ROLES).flat())]
        : department
          ? [...DEPARTMENT_ROLES[department]]
          : [];
    const scopeBranchIds = opts.scopeBranchIds?.length
      ? [...new Set(opts.scopeBranchIds.filter(Boolean))]
      : branchId
        ? [branchId]
        : [];
    const periodEndYmd = periodEnd.toISOString().slice(0, 10);
    const periodStartYmd = periodStart.toISOString().slice(0, 10);
    const branchPredicate = scopeBranchIds.length
      ? opts.includeNullBranch
        ? or(
            inArray(schema.users.primaryBranchId, scopeBranchIds),
            isNull(schema.users.primaryBranchId),
          )
        : inArray(schema.users.primaryBranchId, scopeBranchIds)
      : sql`true`;
    let staff =
      staffMode === 'none' || targetRoles.length === 0
        ? []
        : await tx
            .select()
            .from(schema.users)
            .where(
              and(
                branchPredicate,
                inArray(schema.users.role, targetRoles as unknown as typeof schema.users.$inferSelect['role'][]),
                // Hard guardrail: SUPER_ADMIN is never on payroll and must never be
                // generated into a batch, regardless of scope (incl. ALL). Belt-and-
                // suspenders over DEPARTMENT_ROLES so a future edit can't reintroduce it.
                ne(schema.users.role, 'SUPER_ADMIN'),
                or(
                  eq(schema.users.status, 'ACTIVE'),
                  and(
                    gte(schema.users.exitDate, periodStartYmd),
                    lte(schema.users.exitDate, periodEndYmd),
                  ),
                ),
              ),
            );

    if (opts.scopeEmployeeIds?.length) {
      const allowed = new Set(opts.scopeEmployeeIds);
      staff = staff.filter((s) => allowed.has(s.id));
    }
    staff = staff.filter((s) => !s.dateOfJoining || s.dateOfJoining <= periodEndYmd);

    // Preview is read-only: compute all staff lines via the BATCHED fast path
    // (aggregate queries + in-memory formula), which is identical to the
    // per-member `computePayoutForMember` but avoids ~10 queries per person.
    const payableStaff = staff.filter((s) => s.onboardingPayrollStatus !== 'PENDING_APPROVAL');
    const rows: PreviewLineRow[] = [];
    const payoutById = await this.computeStaffPayoutsBatched(
      tx,
      payableStaff,
      periodStart,
      periodEnd,
      periodMonth,
    );
    let totalAmount = 0;
    for (const member of payableStaff) {
      const computed =
        payoutById.get(member.id) ??
        { baseSalary: 0, performanceBonus: 0, addOnsTotal: 0, deductionsTotal: 0, totalPayout: 0 };
      rows.push({
        staffId: member.id,
        staffName: member.name,
        staffRole: member.role,
        baseSalary: computed.baseSalary,
        performanceBonus: computed.performanceBonus,
        addOnsTotal: computed.addOnsTotal,
        deductionsTotal: computed.deductionsTotal,
        grossPay: computed.grossPay ?? computed.totalPayout,
        payeTax: computed.payeTax ?? 0,
        totalPayout: computed.totalPayout,
        branchName: member.primaryBranchId
          ? opts.branchNameById?.get(member.primaryBranchId) ?? null
          : null,
        department,
      });
      totalAmount += computed.totalPayout;
    }
    const staffCount = payableStaff.length;

    let contractorCount = 0;
    if (opts.includeContractors) {
      const branchRow = branchId
        ? (
            await tx
              .select({ groupId: schema.branches.groupId })
              .from(schema.branches)
              .where(eq(schema.branches.id, branchId))
              .limit(1)
          )[0]
        : undefined;

      const contractors = await tx
        .select()
        .from(schema.payrollContractors)
        .where(
          and(
            eq(schema.payrollContractors.active, true),
            branchId
              ? and(
                  or(
                    scopeBranchIds.length
                      ? inArray(schema.payrollContractors.branchId, scopeBranchIds)
                      : sql`false`,
                    isNull(schema.payrollContractors.branchId),
                  ),
                  branchRow?.groupId
                    ? eq(schema.payrollContractors.groupId, branchRow.groupId)
                    : sql`false`,
                )
              : sql`true`,
          ),
        );

      const taxConfig = await this.payrollCompute.loadTaxConfig(tx, branchRow?.groupId ?? null);

      const contractorRoleIds = [
        ...new Set(
          contractors
            .map((c) => c.payRoleId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ];
      const roleTaxRows =
        contractorRoleIds.length > 0
          ? await tx
              .select({
                id: schema.payrollPayRoles.id,
                defaultTaxStatus: schema.payrollPayRoles.defaultTaxStatus,
              })
              .from(schema.payrollPayRoles)
              .where(inArray(schema.payrollPayRoles.id, contractorRoleIds))
          : [];
      const roleTaxById = new Map(roleTaxRows.map((r) => [r.id, r.defaultTaxStatus]));

      const payableContractors = contractors.filter((c) => Number(c.monthlyFee) > 0);
      const contractorIds = payableContractors.map((c) => c.id);

      // Batch the contractor adjustment sums: one grouped query per category over
      // ALL contractor ids, instead of two queries per contractor.
      const clawbackByContractor = new Map<string, number>();
      const addOnByContractor = new Map<string, number>();
      if (contractorIds.length) {
        const [claw, add] = await Promise.all([
          tx
            .select({
              contractorId: schema.earningsAdjustments.contractorId,
              total: sum(schema.earningsAdjustments.amount),
            })
            .from(schema.earningsAdjustments)
            .where(
              and(
                inArray(schema.earningsAdjustments.contractorId, contractorIds),
                inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
                pendingAdjustmentForMonth(periodMonth),
              ),
            )
            .groupBy(schema.earningsAdjustments.contractorId),
          tx
            .select({
              contractorId: schema.earningsAdjustments.contractorId,
              total: sum(schema.earningsAdjustments.amount),
            })
            .from(schema.earningsAdjustments)
            .where(
              and(
                inArray(schema.earningsAdjustments.contractorId, contractorIds),
                inArray(schema.earningsAdjustments.category, ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER']),
                pendingAdjustmentForMonth(periodMonth),
              ),
            )
            .groupBy(schema.earningsAdjustments.contractorId),
        ]);
        for (const r of claw) clawbackByContractor.set(r.contractorId as string, Math.abs(Number(r.total ?? 0)));
        for (const r of add) addOnByContractor.set(r.contractorId as string, Number(r.total ?? 0));
      }

      for (const contractor of payableContractors) {
        const fee = Number(contractor.monthlyFee);
        const roleTax = contractor.payRoleId ? roleTaxById.get(contractor.payRoleId) : undefined;
        const taxStatus =
          (roleTax as 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION' | undefined) ??
          (contractor.taxStatus as 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION') ??
          'GROSS_NO_DEDUCTION';
        const paye = computePaye({ monthlyGross: fee, taxStatus }, taxConfig);

        const clawbackTotal = clawbackByContractor.get(contractor.id) ?? 0;
        const addOnsTotal = addOnByContractor.get(contractor.id) ?? 0;
        const grossPay = fee + addOnsTotal;
        const net = Math.max(0, grossPay - paye.employeePaye - clawbackTotal);
        rows.push({
          staffId: contractor.id,
          staffName: contractor.name,
          staffRole: 'CONTRACTOR',
          baseSalary: fee,
          performanceBonus: 0,
          addOnsTotal,
          deductionsTotal: paye.employeePaye + clawbackTotal,
          grossPay,
          payeTax: paye.employeePaye,
          totalPayout: net,
          branchName: contractor.branchId
            ? opts.branchNameById?.get(contractor.branchId) ?? null
            : null,
          department,
        });
        totalAmount += net;
      }
      contractorCount = payableContractors.length;
    }

    return { staffCount, contractorCount, totalAmount, rows };
  }

  /**
   * Grand-total preview for a whole payroll SELECTION (which may fan out into
   * several batches: one per department, plus contractors, or an ALL run). Unlike
   * `previewBatch` (single branch + department roster), this returns only the
   * combined { staffCount, contractorCount, totalAmount, batchCount } and inserts
   * nothing. Numbers are produced by `computeSelectionTotals`, which mirrors the
   * generate path exactly, so the preview equals what generation would produce.
   */
  async previewSelectionTotal(
    input: PreviewSelectionInput,
    actor: SessionUser,
  ): Promise<{ staffCount: number; contractorCount: number; totalAmount: number; batchCount: number; rows: PreviewLineRow[] }> {
    const { periodStart, periodEnd } = nigeriaMonthWindow(input.periodMonth);
    const periodMonth = input.periodMonth;
    // Preview is read-only: run against the pool (this.db), NOT a single-connection
    // transaction, so the per-member/per-department compute can fan out in parallel.
    const db = this.db;

    // Branch-name lookup so roster rows can show which branch each person is on
    // (matters for the multi-branch fan-out roster). One cheap query, reused below.
    const branchRows = await db
      .select({ id: schema.branches.id, name: schema.branches.name })
      .from(schema.branches);
    const branchNameById = new Map(branchRows.map((b) => [b.id, b.name]));

    // CONTRACTORS scope: one contractor-only slot. branchId optional (a Head may
    // pin their branch; admin/HR run org-wide with branchId null).
    if (input.scopeType === 'CONTRACTORS') {
      const branchId = input.branchId ?? null;
      if (!(await this.canPrepareDept(actor, branchId, null))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot preview this contractor payroll batch.' });
      }
      const totals = await this.computeSelectionTotals(db, {
        branchId,
        department: null,
        periodStart,
        periodEnd,
        periodMonth,
        includeContractors: true,
        staffMode: 'none',
        scopeBranchIds: branchId ? [branchId] : null,
        branchNameById,
      });
      return { ...totals, batchCount: 1 };
    }

    // ALL scope: every staff role across every branch + contractors, org-wide.
    if (input.scopeType === 'ALL') {
      if (!(await this.canPrepareDept(actor, null, null))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot preview an org-wide payroll batch.' });
      }
      const totals = await this.computeSelectionTotals(db, {
        branchId: null,
        department: null,
        periodStart,
        periodEnd,
        periodMonth,
        includeContractors: true,
        staffMode: 'all',
        scopeBranchIds: null,
        branchNameById,
      });
      return { ...totals, batchCount: 1 };
    }

    // Department scope: one staff batch per selected department, combining the
    // selected branches (mirrors generateBatch's BRANCHES/DEPARTMENT + the
    // includeNullBranch-on-home-branch rule). Contractors are their own scope now,
    // so staff department batches never include them.
    const departments = (
      input.departments?.length
        ? input.departments
        : input.department
          ? [input.department]
          : []
    ) as PayrollDepartment[];
    if (departments.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select at least one department.' });
    }
    const scopeBranchIds = [
      ...new Set(
        (input.scopeBranchIds?.length
          ? input.scopeBranchIds
          : input.branchId
            ? [input.branchId]
            : []
        ).filter(Boolean),
      ),
    ];
    if (input.branchId && !scopeBranchIds.includes(input.branchId)) {
      scopeBranchIds.unshift(input.branchId);
    }
    if (scopeBranchIds.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select at least one branch.' });
    }
    const homeBranchId = scopeBranchIds[0] as string;

    // Authz once per (department × branch) up front (cheap in-memory checks).
    for (const department of departments) {
      for (const bid of scopeBranchIds) {
        if (!(await this.canPrepareDept(actor, bid, department))) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `You cannot preview payroll for ${department} on one of the selected branches.`,
          });
        }
      }
    }

    // Departments computed sequentially. Each department's staff are computed by
    // the BATCHED fast path (a handful of aggregate queries, not per-member), so
    // total in-flight queries stay tiny regardless of headcount.
    let staffCount = 0;
    let contractorCount = 0;
    let totalAmount = 0;
    const rows: PreviewLineRow[] = [];
    for (const department of departments) {
      const t = await this.computeSelectionTotals(db, {
        branchId: homeBranchId,
        department,
        periodStart,
        periodEnd,
        periodMonth,
        includeContractors: false,
        staffMode: 'department',
        scopeBranchIds,
        // No-branch staff ride along on the HOME branch's batch only.
        includeNullBranch: input.includeNullBranch ?? false,
        branchNameById,
      });
      staffCount += t.staffCount;
      contractorCount += t.contractorCount;
      totalAmount += t.totalAmount;
      rows.push(...t.rows);
    }

    return { staffCount, contractorCount, totalAmount, batchCount: departments.length, rows };
  }

  async previewBatch(input: GenerateBatchInput, actor: SessionUser) {
    // Preview is a staff/department feature only; null-scope batches (contractors /
    // all) generate directly without a preview step.
    if (isNullScopeType(input.scopeType) || !input.branchId || !input.department) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Preview requires a branch and department.' });
    }
    const branchId = input.branchId;
    const department = input.department;
    const scopeBranchIds = [
      ...new Set(
        (input.scopeBranchIds?.length ? input.scopeBranchIds : [branchId]).filter(Boolean),
      ),
    ];
    if (!scopeBranchIds.includes(branchId)) scopeBranchIds.unshift(branchId);

    for (const bid of scopeBranchIds) {
      if (!(await this.canPrepareDept(actor, bid, department))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `You cannot preview payroll for ${department} on one of the selected branches.`,
        });
      }
    }
    const { periodStart, periodEnd } = nigeriaMonthWindow(input.periodMonth);

    return withActorAndBranch(this.db, { id: actor.id, currentBranchId: branchId }, async (tx) => {
      const departmentRoles = DEPARTMENT_ROLES[department];
      const staff = await tx
        .select({
          id: schema.users.id,
          name: schema.users.name,
          role: schema.users.role,
          commissionPlanId: schema.users.commissionPlanId,
          // Payroll-profile fields so preview matches the actual generate path
          // (pay-role/formula selection, tax status, flat rate, and rent relief).
          payRoleId: schema.users.payRoleId,
          salaryBasis: schema.users.salaryBasis,
          taxStatus: schema.users.taxStatus,
          flatMonthlyAmount: schema.users.flatMonthlyAmount,
          onboardingPayrollStatus: schema.users.onboardingPayrollStatus,
          annualRent: schema.users.annualRent,
          dateOfJoining: schema.users.dateOfJoining,
          exitDate: schema.users.exitDate,
        })
        .from(schema.users)
        .where(
          and(
            // Mirror generation: scoped branches, optionally OR-ing in no-branch staff.
            input.includeNullBranch
              ? or(
                  inArray(schema.users.primaryBranchId, scopeBranchIds),
                  isNull(schema.users.primaryBranchId),
                )
              : inArray(schema.users.primaryBranchId, scopeBranchIds),
            inArray(schema.users.role, departmentRoles as unknown as typeof schema.users.$inferSelect['role'][]),
            // Match generation: ACTIVE staff + mid-period leavers owed final pay.
            or(
              eq(schema.users.status, 'ACTIVE'),
              and(
                gte(schema.users.exitDate, periodStart.toISOString().slice(0, 10)),
                lte(schema.users.exitDate, periodEnd.toISOString().slice(0, 10)),
              ),
            ),
          ),
        )
        .then((rows) =>
          // Drop staff who joined after the period ended (no active days).
          rows.filter((s) => !s.dateOfJoining || s.dateOfJoining <= periodEnd.toISOString().slice(0, 10)),
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
        // Gross + PAYE surfaced so the preview roster matches the batch-detail
        // review columns (HR sees gross/tax before generating the draft).
        grossPay: number;
        payeTax: number;
      }>;
      for (const member of staff) {
        const computed = (await this.computePayoutForMember(tx, member, periodStart, periodEnd, input.periodMonth))
          ?? { baseSalary: 0, performanceBonus: 0, addOnsTotal: 0, deductionsTotal: 0, totalPayout: 0 };
        rows.push({
          staffId: member.id,
          staffName: member.name,
          staffRole: member.role,
          ...computed,
          // computePayoutForMember returns grossPay/payeTax on the PRD path but the
          // legacy fallback may omit them — default to gross=total, tax=0.
          grossPay: computed.grossPay ?? computed.totalPayout,
          payeTax: computed.payeTax ?? 0,
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
    tx: DbOrTx,
    member: {
      id: string;
      role: string;
      commissionPlanId?: string | null;
      payRoleId?: string | null;
      salaryBasis?: string | null;
      taxStatus?: string | null;
      onboardingPayrollStatus?: string | null;
      flatMonthlyAmount?: string | number | null;
      annualRent?: string | number | null;
      dateOfJoining?: string | Date | null;
      exitDate?: string | Date | null;
    },
    periodStart: Date,
    periodEnd: Date,
    // YYYY-MM-01 for the batch being computed. Gates which pending adjustments
    // fold into this payout (un-earmarked, or earmarked for this exact month).
    periodMonth: string,
  ): Promise<Omit<PayoutRow, 'staffId'> | null> {
    const branchRow = (
      await tx
        .select({ groupId: schema.branches.groupId, branchId: schema.branches.id })
        .from(schema.users)
        .innerJoin(schema.branches, eq(schema.branches.id, schema.users.primaryBranchId))
        .where(eq(schema.users.id, member.id))
        .limit(1)
    )[0];

    // Head team-DR counts reportees across the whole company (all branches sharing
    // the member's groupId), not just their primary branch — multi-branch teams
    // otherwise under-count and the team bonus silently drops to zero.
    let effectiveBranchIds: string[] | null = null;
    if (branchRow?.groupId) {
      const companyBranches = await tx
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(eq(schema.branches.groupId, branchRow.groupId));
      effectiveBranchIds = companyBranches.map((b) => b.id);
    }

    const computed = await this.payrollCompute.computeForMember(
      tx,
      member,
      periodStart,
      periodEnd,
      branchRow?.groupId ?? null,
      branchRow?.branchId ?? null,
      { effectiveBranchIds },
    );
    if (!computed) {
      return this.computePayoutForMemberLegacy(tx, member, periodStart, periodEnd, periodMonth);
    }

    const pendingClawbackRows = await tx
      .select({ total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, member.id),
          inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
          pendingAdjustmentForMonth(periodMonth),
        ),
      );
    const clawbackTotal = Math.abs(Number(pendingClawbackRows[0]?.total ?? 0));

    const positiveAddOnRows = await tx
      .select({ total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, member.id),
          pendingAdjustmentForMonth(periodMonth),
          inArray(schema.earningsAdjustments.category, ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER']),
        ),
      );
    const addOnsTotal = Number(positiveAddOnRows[0]?.total ?? 0);
    const deductionsTotal = computed.deductionsTotal + clawbackTotal;
    const grossPay = computed.grossPay + addOnsTotal;
    const netPay = Math.max(0, grossPay - computed.payeTax - clawbackTotal);
    const totalPayout = netPay;

    if (totalPayout <= 0 && deductionsTotal <= 0 && computed.baseSalary <= 0) return null;

    return {
      baseSalary: computed.baseSalary,
      performanceBonus: computed.performanceBonus,
      addOnsTotal,
      deductionsTotal,
      totalPayout,
      allowancesTotal: computed.allowancesTotal,
      grossPay,
      payeTax: computed.payeTax,
      employerPayeSubsidy: computed.employerPayeSubsidy,
      netPay,
      metricsSnapshot: computed.metricsSnapshot,
      bonusBreakdown: computed.bonusBreakdown,
      lineStatus: computed.lineStatus,
      payRoleName: computed.payRoleName,
      proration: computed.proration ?? null,
    };
  }

  /** Legacy commission math fallback when no PRD formula resolves. */
  private async computePayoutForMemberLegacy(
    tx: DbOrTx,
    member: { id: string; role: string; commissionPlanId?: string | null },
    periodStart: Date,
    periodEnd: Date,
    periodMonth: string,
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
          inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
          pendingAdjustmentForMonth(periodMonth),
        ),
      );
    const clawbackTotal = Math.abs(Number(pendingClawbackRows[0]?.total ?? 0));

    const positiveAddOnRows = await tx
      .select({ total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, member.id),
          pendingAdjustmentForMonth(periodMonth),
          inArray(schema.earningsAdjustments.category, ['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'OTHER']),
        ),
      );
    const addOnsTotal = Number(positiveAddOnRows[0]?.total ?? 0);
    const deductionsTotal = penalties + clawbackTotal;
    const totalPayout = Math.max(0, baseSalary + performanceBonus + addOnsTotal - deductionsTotal);

    if (totalPayout <= 0 && deductionsTotal <= 0 && baseSalary <= 0) return null;
    const grossPay = baseSalary + performanceBonus + addOnsTotal;
    return {
      baseSalary,
      performanceBonus,
      addOnsTotal,
      deductionsTotal,
      totalPayout,
      grossPay,
      netPay: totalPayout,
      payeTax: 0,
    };
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
    const payoutCountRows = await this.db
      .select({ count: count() })
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.batchId, input.batchId));
    const payoutLineCount = Number(payoutCountRows[0]?.count ?? 0);
    if (payoutLineCount === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Batch has no payout lines — re-generate from latest data before submitting.',
      });
    }

    const updated = await withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        await this.recomputeBatchTotals(tx, input.batchId);
        const refreshed = await tx
          .select({ staffCount: schema.payrollBatches.staffCount })
          .from(schema.payrollBatches)
          .where(eq(schema.payrollBatches.id, input.batchId))
          .limit(1);
        if (Number(refreshed[0]?.staffCount ?? 0) === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Batch is empty — generate payouts before submitting.',
          });
        }
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
      body: `${this.formatDepartment(batch.department, batch.scopeType)} batch for ${this.formatPeriod(batch.periodMonth)} is ready for your review.`,
      batchId: batch.id,
    });

    return updated;
  }

  /**
   * Hard-delete a payroll batch and its payout lines, allowed only while the
   * batch has NOT been paid. PAID batches are immutable (financial record).
   * Any earnings adjustments attached to this batch's payouts are detached
   * (payoutId nulled) so the per-staff adjustment trail survives.
   */
  async deleteBatch(
    input: DeleteBatchInput,
    actor: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const batch = await this.requireBatch(input.batchId);
    assertBatchInScope(batch, actor, effectiveBranchIds);

    // Only someone who can act on the batch at its current stage may delete it:
    // the owning department head (DRAFT), HR (PENDING_HR), or an admin. Reuse the
    // same allowed-transition gates so authorization stays consistent.
    const canAct =
      (await this.canPrepareDept(actor, batch.branchId, batch.department as PayrollDepartment | null)) ||
      canReviewBatch(actor) ||
      canProcessBatch(actor);
    if (!canAct) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not allowed to delete this batch.',
      });
    }

    if (batch.status === 'PAID') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Cannot delete a PAID batch. Paid payroll is an immutable financial record.',
      });
    }

    await withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const payouts = await tx
          .select({ id: schema.payoutRecords.id })
          .from(schema.payoutRecords)
          .where(eq(schema.payoutRecords.batchId, input.batchId));
        const payoutIds = payouts.map((p) => p.id);
        if (payoutIds.length) {
          // Keep the earnings-adjustment history; just unlink it from the payouts.
          await tx
            .update(schema.earningsAdjustments)
            .set({ payoutId: null })
            .where(inArray(schema.earningsAdjustments.payoutId, payoutIds));
          await tx.delete(schema.payoutRecords).where(eq(schema.payoutRecords.batchId, input.batchId));
        }
        // Optimistic guard: refuse if the batch flipped to PAID concurrently.
        const rows = await tx
          .delete(schema.payrollBatches)
          .where(
            and(
              eq(schema.payrollBatches.id, input.batchId),
              ne(schema.payrollBatches.status, 'PAID'),
            ),
          )
          .returning({ id: schema.payrollBatches.id });
        if (!rows[0]) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Batch was paid concurrently. Refresh and try again.',
          });
        }
      },
    );

    return { success: true as const };
  }

  async approveBatch(
    input: ApproveBatchInput,
    actor: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const batch = await this.requireBatch(input.batchId);
    assertBatchInScope(batch, actor, effectiveBranchIds);
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
          .where(
            and(
              eq(schema.payrollBatches.id, input.batchId),
              eq(schema.payrollBatches.status, 'PENDING_HR'),
            ),
          )
          .returning();
        if (!rows[0]) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Batch status changed concurrently — refresh and try again.',
          });
        }
        return rows[0];
      },
    );

    // Notify Finance Officers + Finance hat holder
    await this.notifyFinance(batch.branchId, {
      type: 'hr:batch_approved',
      title: 'Payroll batch ready for disbursement',
      body: `${this.formatDepartment(batch.department, batch.scopeType)} batch for ${this.formatPeriod(batch.periodMonth)} (${batch.staffCount} staff, ₦${Number(batch.totalAmount).toLocaleString('en-NG')}) is approved.`,
      batchId: batch.id,
    });

    return updated;
  }

  async rejectBatch(
    input: RejectBatchInput,
    actor: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const batch = await this.requireBatch(input.batchId);
    assertBatchInScope(batch, actor, effectiveBranchIds);

    let nextStatus: PayrollBatchStatus;
    let notifyType: string;
    let notifyRole: string;
    const expectedStatus = batch.status;

    if (batch.status === 'PENDING_HR') {
      // HR rejects back to the head — must be HR/admin
      if (!canReviewBatch(actor)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only HR Manager or admins can reject from HR review.' });
      }
      nextStatus = 'DRAFT';
      notifyType = 'hr:batch_rejected';
      // Null-scope batches have no department owner — route back to HR.
      notifyRole = isNullScopeBatch(batch)
        ? 'HR_MANAGER'
        : DEPARTMENT_OWNER_ROLE[batch.department as PayrollDepartment];
    } else if (batch.status === 'PENDING_FINANCE') {
      // Finance rejects back to HR — must be Finance/admin
      if (!canProcessBatch(actor)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Finance with disburse permission can reject from Finance review.' });
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
          .where(
            and(
              eq(schema.payrollBatches.id, input.batchId),
              eq(schema.payrollBatches.status, expectedStatus),
            ),
          )
          .returning();
        if (!rows[0]) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Batch status changed concurrently — refresh and try again.',
          });
        }
        return rows[0];
      },
    );

    await this.notifyByRoleOnBranch(notifyRole, batch.branchId, {
      type: notifyType,
      title: nextStatus === 'DRAFT' ? 'Payroll batch sent back for edits' : 'Payroll batch returned by Finance',
      body: `${this.formatDepartment(batch.department, batch.scopeType)} batch for ${this.formatPeriod(batch.periodMonth)} was rejected. Reason: ${input.reason}`,
      batchId: batch.id,
    });

    return updated;
  }

  async markBatchPaid(
    input: MarkBatchPaidInput,
    actor: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const batch = await this.requireBatch(input.batchId);
    assertBatchInScope(batch, actor, effectiveBranchIds);
    if (!canProcessBatch(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only users with finance.disburse or payroll.run.disburse (or SuperAdmin) can mark batches paid.',
      });
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
            financeReference: input.financeReference?.trim() || null,
            disbursementDate: input.disbursementDate ?? null,
            proofOfPaymentUrl: input.proofOfPaymentUrl?.trim() || null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.payrollBatches.id, input.batchId),
              eq(schema.payrollBatches.status, 'PENDING_FINANCE'),
            ),
          )
          .returning();
        if (!rows[0]) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Batch status changed concurrently — refresh and try again.',
          });
        }

        // Cascade: mark every payout in the batch PAID
        await tx
          .update(schema.payoutRecords)
          .set({ status: 'PAID' })
          .where(eq(schema.payoutRecords.batchId, input.batchId));

        return rows[0];
      },
    );

    // GL auto-post: salary expense (non-fatal — never blocks payroll)
    await runGlPostWithFinanceAlert(
      this.notifications,
      this.logger,
      'Payroll batch paid',
      input.batchId,
      () => this.generalLedger.postPayrollBatch(input.batchId, actor),
    );

    // Notify HR + the originating Head + every staff in the batch
    await this.notifyByRoleOnBranch('HR_MANAGER', batch.branchId, {
      type: 'hr:batch_paid',
      title: 'Payroll batch paid',
      body: `${this.formatDepartment(batch.department, batch.scopeType)} batch for ${this.formatPeriod(batch.periodMonth)} marked paid.`,
      batchId: batch.id,
    });
    // Null-scope batches have no department owner to notify beyond HR (already done above).
    const ownerRole = isNullScopeBatch(batch)
      ? null
      : DEPARTMENT_OWNER_ROLE[batch.department as PayrollDepartment];
    if (ownerRole && ownerRole !== 'HR_MANAGER') {
      await this.notifyByRoleOnBranch(ownerRole, batch.branchId, {
        type: 'hr:batch_paid',
        title: 'Your team has been paid',
        body: `Finance disbursed ${this.formatDepartment(batch.department, batch.scopeType)} payroll for ${this.formatPeriod(batch.periodMonth)} (₦${Number(batch.totalAmount).toLocaleString('en-NG')}).`,
        batchId: batch.id,
      });
    }

    // Per-staff notification — each gets the existing hr:payout_approved signal
    const staffPayouts = await this.db
      .select({ staffId: schema.payoutRecords.staffId, totalPayout: schema.payoutRecords.totalPayout, payoutId: schema.payoutRecords.id })
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.batchId, input.batchId));
    for (const p of staffPayouts) {
      if (!p.staffId) continue;
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

  async recalculateBatch(batchId: string, actor: SessionUser) {
    const batch = await this.requireBatch(batchId);
    if (batch.status === 'PAID') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Cannot recalculate a PAID batch. Paid payroll is an immutable financial record.' });
    }
    // Editable until Finance marks it paid (CEO 2026-08-05): DRAFT (owning head),
    // or PENDING_HR / PENDING_FINANCE (HR/admins only).
    if (!(await this.isBatchOpenForHrEdit(batch, actor))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to recalculate this batch.' });
    }

    const { periodStart, periodEnd } = nigeriaMonthWindow(String(batch.periodMonth));

    return withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const oldPayouts = await tx
          .select({ id: schema.payoutRecords.id })
          .from(schema.payoutRecords)
          .where(eq(schema.payoutRecords.batchId, batchId));
        const oldPayoutIds = oldPayouts.map((p) => p.id);
        if (oldPayoutIds.length) {
          await tx
            .update(schema.earningsAdjustments)
            .set({ payoutId: null })
            .where(inArray(schema.earningsAdjustments.payoutId, oldPayoutIds));
          await tx.delete(schema.payoutRecords).where(eq(schema.payoutRecords.batchId, batchId));
        }
        return this.synthesizeDraftBatchContent(
          tx,
          batchId,
          batch.branchId,
          batch.department as PayrollDepartment,
          periodStart,
          periodEnd,
          String(batch.periodMonth),
          {
            includeContractors: batch.includeContractors ?? false,
            scopeEmployeeIds: batch.scopeEmployeeIds ?? null,
            scopeBranchIds: batch.scopeBranchIds ?? null,
          },
        );
      },
    );
  }

  async overridePayslipLine(
    input: { payoutId: string; baseSalary?: number; performanceBonus?: number; payeTax?: number; reason: string },
    actor: SessionUser,
  ) {
    const payoutRows = await this.db
      .select()
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.id, input.payoutId))
      .limit(1);
    const payout = payoutRows[0];
    if (!payout?.batchId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payout not found' });

    const batch = await this.requireBatch(payout.batchId);
    if (batch.status === 'PAID') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Cannot override a PAID batch. Paid payroll is an immutable financial record.' });
    }
    if (!(await this.isBatchOpenForHrEdit(batch, actor))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to override payslip lines. Overrides are open until Finance marks the batch paid.' });
    }

    const base = input.baseSalary ?? Number(payout.baseSalary);
    const bonus = input.performanceBonus ?? Number(payout.performanceBonus);
    const deductions = Number(payout.deductionsTotal ?? 0);
    const gross = base + bonus + Number(payout.addOnsTotal) + Number(payout.allowancesTotal ?? 0);
    const tax = input.payeTax ?? Number(payout.payeTax ?? 0);
    const net = Math.max(0, gross - tax);
    const cash = Math.max(0, net - deductions);

    return withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        const [updated] = await tx
          .update(schema.payoutRecords)
          .set({
            baseSalary: sql`${base.toFixed(2)}::numeric`,
            performanceBonus: sql`${bonus.toFixed(2)}::numeric`,
            grossPay: sql`${gross.toFixed(2)}::numeric`,
            payeTax: sql`${tax.toFixed(2)}::numeric`,
            netPay: sql`${net.toFixed(2)}::numeric`,
            totalPayout: sql`${cash.toFixed(2)}::numeric`,
            lineStatus: 'MANUALLY_OVERRIDDEN',
            overrideReason: input.reason,
          })
          .where(eq(schema.payoutRecords.id, input.payoutId))
          .returning();
        await this.recomputeBatchTotals(tx, payout.batchId!);
        return updated;
      },
    );
  }

  async listPayslips(
    input: {
      staffId?: string;
      batchId?: string;
      department?: string;
      fromMonth?: string;
      toMonth?: string;
      branchId?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    effectiveBranchIds?: string[] | null,
  ) {
    const page = input.page ?? 1;
    const limit = input.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions: SQL[] = [eq(schema.payoutRecords.status, 'PAID')];

    if (input.staffId) conditions.push(eq(schema.payoutRecords.staffId, input.staffId));
    if (input.batchId) conditions.push(eq(schema.payoutRecords.batchId, input.batchId));
    if (input.department) conditions.push(eq(schema.payrollBatches.department, input.department as 'CS' | 'MARKETING' | 'LOGISTICS' | 'HR' | 'OPERATIONS' | 'FINANCE' | 'SUPPORT'));
    if (effectiveBranchIds?.length) {
      conditions.push(inArray(schema.payrollBatches.branchId, effectiveBranchIds));
    }
    if (input.branchId) conditions.push(eq(schema.payrollBatches.branchId, input.branchId));
    if (input.fromMonth) conditions.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) conditions.push(lte(schema.payrollBatches.periodMonth, input.toMonth));
    if (input.search) {
      conditions.push(
        or(
          ilike(schema.users.name, `%${input.search}%`),
          ilike(schema.payoutRecords.payRoleName, `%${input.search}%`),
        )!,
      );
    }

    const rows = await this.db
      .select({
        payout: schema.payoutRecords,
        batch: schema.payrollBatches,
        staffName: schema.users.name,
        staffRole: schema.users.role,
      })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.payoutRecords.staffId))
      .where(and(...conditions))
      .orderBy(desc(schema.payrollBatches.periodMonth))
      .limit(limit)
      .offset(offset);

    const countResult = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.payoutRecords.staffId))
      .where(and(...conditions));
    const total = countResult[0]?.count ?? 0;

    return { items: rows, page, limit, total };
  }

  async payrollRegister(
    input: { batchId?: string; fromMonth?: string; toMonth?: string; branchId?: string; department?: string; status?: PayrollBatchStatus },
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: SQL[] = [];
    if (input.batchId) conditions.push(eq(schema.payoutRecords.batchId, input.batchId));
    if (input.status) conditions.push(eq(schema.payrollBatches.status, input.status));
    if (input.fromMonth) conditions.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) conditions.push(lte(schema.payrollBatches.periodMonth, input.toMonth));
    if (effectiveBranchIds?.length) conditions.push(inArray(schema.payrollBatches.branchId, effectiveBranchIds));
    if (input.branchId) conditions.push(eq(schema.payrollBatches.branchId, input.branchId));
    if (input.department) conditions.push(eq(schema.payrollBatches.department, input.department as 'CS' | 'MARKETING' | 'LOGISTICS' | 'HR' | 'OPERATIONS' | 'FINANCE' | 'SUPPORT'));

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        payout: schema.payoutRecords,
        batch: schema.payrollBatches,
        staffName: schema.users.name,
        staffRole: schema.users.role,
      })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.payoutRecords.staffId))
      .where(whereClause)
      .orderBy(desc(schema.payrollBatches.periodMonth))
      .limit(500);

    return rows;
  }

  /**
   * Finance overview Payroll tab — pending queue + period costs + pay-role rollup.
   * Groups by snapshot `payRoleName` on payout lines (falls back to live pay-role
   * category / system role) so totals match what Finance marks paid.
   */
  async getFinanceOverviewPayroll(
    input: { fromMonth?: string; toMonth?: string; branchId?: string },
    _viewer: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const branchScope: SQL[] = [];
    if (effectiveBranchIds?.length) {
      branchScope.push(inArray(schema.payrollBatches.branchId, effectiveBranchIds));
    }
    if (input.branchId) {
      branchScope.push(eq(schema.payrollBatches.branchId, input.branchId));
    }

    // Same period/branch filters as Paid / Period cards — otherwise an older
    // PENDING_FINANCE batch outside the selected month still looks "stuck".
    const pendingConds: SQL[] = [
      eq(schema.payrollBatches.status, 'PENDING_FINANCE'),
      ...branchScope,
    ];
    if (input.fromMonth) pendingConds.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) pendingConds.push(lte(schema.payrollBatches.periodMonth, input.toMonth));

    const [pendingRow] = await this.db
      .select({
        batchCount: count(),
        staffCount: sum(schema.payrollBatches.staffCount),
        totalGross: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalGross}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalNet: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalNet}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalTax: sum(schema.payrollBatches.totalTax),
      })
      .from(schema.payrollBatches)
      .where(and(...pendingConds));

    const periodBatchConds: SQL[] = [
      inArray(schema.payrollBatches.status, ['PENDING_FINANCE', 'PAID']),
      ...branchScope,
    ];
    if (input.fromMonth) periodBatchConds.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) periodBatchConds.push(lte(schema.payrollBatches.periodMonth, input.toMonth));

    const [periodRow] = await this.db
      .select({
        batchCount: count(),
        staffCount: sum(schema.payrollBatches.staffCount),
        totalGross: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalGross}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalNet: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalNet}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalTax: sum(schema.payrollBatches.totalTax),
      })
      .from(schema.payrollBatches)
      .where(and(...periodBatchConds));

    const paidConds: SQL[] = [eq(schema.payrollBatches.status, 'PAID'), ...branchScope];
    if (input.fromMonth) paidConds.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) paidConds.push(lte(schema.payrollBatches.periodMonth, input.toMonth));

    const [paidRow] = await this.db
      .select({
        batchCount: count(),
        staffCount: sum(schema.payrollBatches.staffCount),
        totalGross: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalGross}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalNet: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalNet}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalTax: sum(schema.payrollBatches.totalTax),
      })
      .from(schema.payrollBatches)
      .where(and(...paidConds));

    const roleConds: SQL[] = [
      inArray(schema.payrollBatches.status, ['PENDING_FINANCE', 'PAID']),
      ...branchScope,
    ];
    if (input.fromMonth) roleConds.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) roleConds.push(lte(schema.payrollBatches.periodMonth, input.toMonth));

    const roleRows = await this.db
      .select({
        payRoleName: schema.payoutRecords.payRoleName,
        payRoleCategory: schema.payrollPayRoles.category,
        staffRole: schema.users.role,
        totalGross: sum(
          sql`COALESCE(NULLIF(${schema.payoutRecords.grossPay}, 0), ${schema.payoutRecords.totalPayout})`,
        ),
        totalNet: sum(
          sql`COALESCE(NULLIF(${schema.payoutRecords.netPay}, 0), ${schema.payoutRecords.totalPayout})`,
        ),
        headcount: count(),
      })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.payoutRecords.staffId))
      .leftJoin(schema.payrollPayRoles, eq(schema.payrollPayRoles.id, schema.users.payRoleId))
      .where(and(...roleConds))
      .groupBy(
        schema.payoutRecords.payRoleName,
        schema.payrollPayRoles.category,
        schema.users.role,
      );

    const byPayRoleMap = new Map<
      string,
      { label: string; totalGross: number; totalNet: number; headcount: number }
    >();
    for (const row of roleRows) {
      const label =
        row.payRoleName?.trim() ||
        row.payRoleCategory?.trim() ||
        row.staffRole?.trim() ||
        'Unassigned';
      const bucket = byPayRoleMap.get(label) ?? {
        label,
        totalGross: 0,
        totalNet: 0,
        headcount: 0,
      };
      bucket.totalGross += Number(row.totalGross ?? 0);
      bucket.totalNet += Number(row.totalNet ?? 0);
      bucket.headcount += Number(row.headcount ?? 0);
      byPayRoleMap.set(label, bucket);
    }

    const byPayRole = Array.from(byPayRoleMap.values()).sort((a, b) => b.totalNet - a.totalNet);

    const num = (v: unknown) => Number(v ?? 0);

    return {
      pendingFinance: {
        batchCount: num(pendingRow?.batchCount),
        staffCount: num(pendingRow?.staffCount),
        totalGross: num(pendingRow?.totalGross),
        totalNet: num(pendingRow?.totalNet),
        totalTax: num(pendingRow?.totalTax),
      },
      periodCost: {
        batchCount: num(periodRow?.batchCount),
        staffCount: num(periodRow?.staffCount),
        totalGross: num(periodRow?.totalGross),
        totalNet: num(periodRow?.totalNet),
        totalTax: num(periodRow?.totalTax),
      },
      paidInPeriod: {
        batchCount: num(paidRow?.batchCount),
        staffCount: num(paidRow?.staffCount),
        totalGross: num(paidRow?.totalGross),
        totalNet: num(paidRow?.totalNet),
        totalTax: num(paidRow?.totalTax),
      },
      byPayRole,
    };
  }

  async payrollCostByBranch(
    input: { fromMonth?: string; toMonth?: string; branchId?: string },
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: SQL[] = [inArray(schema.payrollBatches.status, ['PENDING_FINANCE', 'PAID'])];
    if (input.fromMonth) conditions.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) conditions.push(lte(schema.payrollBatches.periodMonth, input.toMonth));
    if (effectiveBranchIds?.length) conditions.push(inArray(schema.payrollBatches.branchId, effectiveBranchIds));
    if (input.branchId) conditions.push(eq(schema.payrollBatches.branchId, input.branchId));

    const rows = await this.db
      .select({
        branchId: schema.payrollBatches.branchId,
        // Null-branch (contractor / ALL) batches group under a synthetic label so
        // their cost is not dropped from the report.
        branchName: sql<string>`COALESCE(${schema.branches.name}, 'Contractors / All')`,
        totalGross: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalGross}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalTax: sum(schema.payrollBatches.totalTax),
        totalNet: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalNet}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        batchCount: count(),
      })
      .from(schema.payrollBatches)
      .leftJoin(schema.branches, eq(schema.branches.id, schema.payrollBatches.branchId))
      .where(and(...conditions))
      .groupBy(schema.payrollBatches.branchId, schema.branches.name)
      .orderBy(
        desc(sum(sql`COALESCE(NULLIF(${schema.payrollBatches.totalNet}, 0), ${schema.payrollBatches.totalAmount})`)),
      );

    return rows.map((r) => ({
      branchId: r.branchId,
      branchName: r.branchName,
      totalGross: Number(r.totalGross ?? 0),
      totalTax: Number(r.totalTax ?? 0),
      totalNet: Number(r.totalNet ?? 0),
      batchCount: Number(r.batchCount ?? 0),
    }));
  }

  async payrollCostByRoleCategory(
    input: { fromMonth?: string; toMonth?: string; branchId?: string },
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: SQL[] = [inArray(schema.payrollBatches.status, ['PENDING_FINANCE', 'PAID'])];
    if (input.fromMonth) conditions.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) conditions.push(lte(schema.payrollBatches.periodMonth, input.toMonth));
    if (effectiveBranchIds?.length) conditions.push(inArray(schema.payrollBatches.branchId, effectiveBranchIds));
    if (input.branchId) conditions.push(eq(schema.payrollBatches.branchId, input.branchId));

    const rows = await this.db
      .select({
        category: schema.payrollPayRoles.category,
        staffRole: schema.users.role,
        totalGross: sum(
          sql`COALESCE(NULLIF(${schema.payoutRecords.grossPay}, 0), ${schema.payoutRecords.totalPayout})`,
        ),
        totalNet: sum(
          sql`COALESCE(NULLIF(${schema.payoutRecords.netPay}, 0), ${schema.payoutRecords.totalPayout})`,
        ),
        headcount: count(),
      })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.payoutRecords.staffId))
      .leftJoin(schema.payrollPayRoles, eq(schema.payrollPayRoles.id, schema.users.payRoleId))
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(schema.payrollPayRoles.category, schema.users.role);

    const byCategory = new Map<string, { totalGross: number; totalNet: number; headcount: number }>();
    for (const row of rows) {
      const key = row.category ?? row.staffRole ?? 'CONTRACTOR';
      const bucket = byCategory.get(key) ?? { totalGross: 0, totalNet: 0, headcount: 0 };
      bucket.totalGross += Number(row.totalGross ?? 0);
      bucket.totalNet += Number(row.totalNet ?? 0);
      bucket.headcount += Number(row.headcount ?? 0);
      byCategory.set(key, bucket);
    }

    return Array.from(byCategory.entries()).map(([category, totals]) => ({
      category,
      ...totals,
    }));
  }

  async payrollTrend(
    input: { fromMonth?: string; toMonth?: string; branchId?: string },
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: SQL[] = [inArray(schema.payrollBatches.status, ['PENDING_FINANCE', 'PAID'])];
    if (input.fromMonth) conditions.push(gte(schema.payrollBatches.periodMonth, input.fromMonth));
    if (input.toMonth) conditions.push(lte(schema.payrollBatches.periodMonth, input.toMonth));
    if (effectiveBranchIds?.length) conditions.push(inArray(schema.payrollBatches.branchId, effectiveBranchIds));
    if (input.branchId) conditions.push(eq(schema.payrollBatches.branchId, input.branchId));

    const rows = await this.db
      .select({
        periodMonth: schema.payrollBatches.periodMonth,
        totalGross: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalGross}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        totalTax: sum(schema.payrollBatches.totalTax),
        totalNet: sum(
          sql`COALESCE(NULLIF(${schema.payrollBatches.totalNet}, 0), ${schema.payrollBatches.totalAmount})`,
        ),
        staffCount: sum(schema.payrollBatches.staffCount),
      })
      .from(schema.payrollBatches)
      .where(and(...conditions))
      .groupBy(schema.payrollBatches.periodMonth)
      .orderBy(schema.payrollBatches.periodMonth);

    return rows.map((r) => ({
      periodMonth: String(r.periodMonth),
      totalGross: Number(r.totalGross ?? 0),
      totalTax: Number(r.totalTax ?? 0),
      totalNet: Number(r.totalNet ?? 0),
      staffCount: Number(r.staffCount ?? 0),
    }));
  }

  async exportPayRunDraft(batchId: string, viewer: SessionUser) {
    const detail = await this.getBatchDetail(batchId, viewer);
    if (detail.batch.status !== 'DRAFT' && detail.batch.status !== 'PENDING_HR') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Draft export is only available for Draft or Pending Approval batches.' });
    }
    return {
      batch: detail.batch,
      rows: detail.payouts.map((p) => ({
        staffName: p.staffName,
        staffRole: p.staffRole,
        baseSalary: Number(p.baseSalary),
        performanceBonus: Number(p.performanceBonus),
        allowancesTotal: Number(p.allowancesTotal ?? 0),
        grossPay: Number(p.grossPay ?? p.totalPayout),
        payeTax: Number(p.payeTax ?? 0),
        netPay: Number(p.netPay ?? p.totalPayout),
        lineStatus: p.lineStatus,
        payRoleName: p.payRoleName,
      })),
    };
  }

  async exportBankUpload(
    input: { batchId?: string; batchIds?: string[] },
    viewer: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    if (!canProcessBatch(viewer)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Finance can export bank upload files.' });
    }

    const ids = [...new Set([...(input.batchIds ?? []), ...(input.batchId ? [input.batchId] : [])])];
    if (!ids.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Provide batchId or batchIds.' });
    }

    const batches = [];
    for (const batchId of ids) {
      const batch = await this.requireBatch(batchId);
      assertBatchInScope(batch, viewer, effectiveBranchIds);
      if (batch.status !== 'PENDING_FINANCE' && batch.status !== 'PAID') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Batch ${batchId.slice(0, 8)} is ${batch.status} — bank export requires Pending Finance or Paid.`,
        });
      }

      const detail = await this.getBatchDetail(batchId, viewer, effectiveBranchIds);
      const branchRow = batch.branchId
        ? (
            await this.db
              .select({ name: schema.branches.name })
              .from(schema.branches)
              .where(eq(schema.branches.id, batch.branchId))
              .limit(1)
          )[0]
        : undefined;

      const period = formatBankNarrationPeriod(batch.periodMonth);
      const rows = detail.payouts
        .filter((p) => Number(p.totalPayout ?? p.netPay) > 0)
        .map((p) => {
          const beneficiaryName = p.payoutAccountName ?? p.staffName ?? p.payRoleName ?? 'Unknown';
          return {
            beneficiaryName,
            accountNumber: p.payoutAccountNumber ?? '',
            bankCode: p.payoutBankCode ?? '',
            bankName: p.payoutBankName ?? '',
            // Cash to bank = totalPayout (after clawbacks); netPay is pre-deduction.
            amount: Number(p.totalPayout ?? p.netPay),
            // Bank-upload narration, clamped to the 5-47 char window banks require.
            narration: buildBankNarration(beneficiaryName, period),
            staffName: p.staffName,
            payRoleName: p.payRoleName,
          };
        });

      batches.push({
        batchId,
        branchName: branchRow?.name ?? batch.branchId,
        periodMonth: batch.periodMonth,
        department: batch.department,
        status: batch.status,
        rows,
      });
    }

    return { batches };
  }

  async getPayslip(payoutId: string, viewer: SessionUser) {
    const payoutRows = await this.db
      .select({
        payout: schema.payoutRecords,
        batch: schema.payrollBatches,
        staffName: schema.users.name,
        staffRole: schema.users.role,
        contractorName: schema.payrollContractors.name,
        branchName: schema.branches.name,
      })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.payoutRecords.staffId))
      .leftJoin(schema.payrollContractors, eq(schema.payrollContractors.id, schema.payoutRecords.contractorId))
      // Left join: a null-scope (contractor / ALL) batch has no branch — an inner
      // join would drop the row and 404 the payslip.
      .leftJoin(schema.branches, eq(schema.branches.id, schema.payrollBatches.branchId))
      .where(eq(schema.payoutRecords.id, payoutId))
      .limit(1);

    const row = payoutRows[0];
    if (!row?.payout.batchId) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payslip not found' });

    const paid =
      row.payout.status === 'PAID' || row.batch.status === 'PAID';
    const isOwnPaid = paid && row.payout.staffId != null && row.payout.staffId === viewer.id;

    if (!isOwnPaid) {
      // HR / Finance / department heads: full batch access.
      let batchAllowed = false;
      try {
        await this.getBatchDetail(row.payout.batchId, viewer);
        batchAllowed = true;
      } catch (err) {
        if (!(err instanceof TRPCError) || err.code !== 'FORBIDDEN') throw err;
      }

      // Staff-directory viewers (self already handled; heads / supervisors / HR
      // viewers who can open the profile) may open paid payslips without batch access.
      if (!batchAllowed) {
        if (!paid || !row.payout.staffId || !row.staffRole) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to view this payslip.' });
        }
        const memberships = await this.db
          .select({ branchId: schema.userBranches.branchId })
          .from(schema.userBranches)
          .where(eq(schema.userBranches.userId, row.payout.staffId));
        if (
          !canAccessStaffHrUserDetail(
            {
              id: viewer.id,
              role: viewer.role,
              permissions: viewer.permissions ?? [],
              branchIds: viewer.branchIds ?? [],
              currentBranchId: viewer.currentBranchId ?? null,
            },
            {
              id: row.payout.staffId,
              role: row.staffRole,
              branchIds: memberships.map((m) => m.branchId),
            },
          )
        ) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to view this payslip.' });
        }
      }
    }

    return {
      payout: row.payout,
      batch: row.batch,
      staffName: row.staffName ?? row.contractorName ?? row.payout.payRoleName ?? 'Staff',
      staffRole: row.staffRole,
      branchName: row.branchName,
    };
  }

  async bulkPayslipPdf(
    input: { batchId?: string; payoutIds?: string[] },
    viewer: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    if (!input.batchId && !input.payoutIds?.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Provide batchId or payoutIds.' });
    }

    if (input.batchId) {
      await this.getBatchDetail(input.batchId, viewer, effectiveBranchIds);
    }

    const conditions: SQL[] = [];
    if (input.batchId) conditions.push(eq(schema.payoutRecords.batchId, input.batchId));
    if (input.payoutIds?.length) conditions.push(inArray(schema.payoutRecords.id, input.payoutIds));

    const rows = await this.db
      .select({
        payout: schema.payoutRecords,
        batch: schema.payrollBatches,
        staffName: schema.users.name,
        contractorName: schema.payrollContractors.name,
      })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .leftJoin(schema.users, eq(schema.users.id, schema.payoutRecords.staffId))
      .leftJoin(schema.payrollContractors, eq(schema.payrollContractors.id, schema.payoutRecords.contractorId))
      .where(and(...conditions));

    // When selecting by payoutIds (no batch), each row must pass getPayslip auth.
    const allowed = input.batchId
      ? rows
      : (
          await Promise.all(
            rows.map(async (row) => {
              try {
                await this.getPayslip(row.payout.id, viewer);
                return row;
              } catch {
                return null;
              }
            }),
          )
        ).filter((r): r is (typeof rows)[number] => r != null);

    if (!input.batchId && input.payoutIds?.length && allowed.length === 0) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No accessible payslips for the requested IDs.' });
    }

    return allowed.map((row) => {
      const amounts = effectivePayoutAmounts(row.payout);
      return {
        payoutId: row.payout.id,
        periodMonth: row.batch.periodMonth,
        employeeName: row.staffName ?? row.contractorName ?? row.payout.payRoleName ?? 'Staff',
        baseSalary: Number(row.payout.baseSalary),
        performanceBonus: Number(row.payout.performanceBonus),
        allowancesTotal: Number(row.payout.allowancesTotal),
        addOnsTotal: Number(row.payout.addOnsTotal),
        deductionsTotal: Number(row.payout.deductionsTotal),
        grossPay: amounts.gross,
        payeTax: amounts.paye,
        // Cash net for payslip / bank parity
        netPay: amounts.cash,
        bonusBreakdown: row.payout.bonusBreakdown,
        payRoleName: row.payout.payRoleName,
      };
    });
  }

  // ============================================
  // HR adjustments during PENDING_HR review
  // ============================================

  async addBatchAdjustment(input: AddBatchAdjustmentInput, actor: SessionUser) {
    const batch = await this.requireBatch(input.batchId);
    if (batch.status === 'PAID') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Cannot adjust a PAID batch. Paid payroll is an immutable financial record.',
      });
    }
    if (!(await this.isBatchOpenForHrEdit(batch, actor))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          batch.status === 'DRAFT'
            ? 'Only eligible department preparers can adjust DRAFT batches.'
            : 'Only HR Manager or admins can add adjustments before Finance marks the batch paid.',
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

        // A payout line targets exactly one party — a staff user (staffId) or an
        // external contractor (contractorId). Attach the adjustment to whichever
        // this line carries so the earnings_adjustments CHECK (exactly one of
        // staff/contractor) is satisfied. recomputePayoutTotals is party-agnostic.
        if (!payout.staffId && !payout.contractorId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payout line has no staff or contractor to adjust.' });
        }

        await tx.insert(schema.earningsAdjustments).values({
          staffId: payout.staffId,
          contractorId: payout.contractorId,
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

  /**
   * Remove a single staff/contractor payout line from an open batch. HR removes a
   * line that shouldn't be in this run (wrong person, duplicate, someone paid off
   * cycle) without regenerating the whole batch.
   *
   * Same authorization + status window as `addBatchAdjustment`: the owning
   * department preparer on DRAFT, or HR/admins on PENDING_HR / PENDING_FINANCE.
   * Editable until Finance marks it PAID (CEO 2026-08-05). Never on a PAID batch —
   * paid payroll is an immutable financial record.
   *
   * Any earnings adjustments tied to the line are unlinked (payoutId → null), not
   * deleted, so the per-party audit trail survives and a later run can re-absorb
   * them. Then the batch totals + staff count are re-rolled.
   */
  async removePayoutLine(input: RemovePayoutLineInput, actor: SessionUser) {
    const batch = await this.requireBatch(input.batchId);
    if (batch.status === 'PAID') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Cannot remove a line from a PAID batch. Paid payroll is an immutable financial record.',
      });
    }
    if (!(await this.isBatchOpenForHrEdit(batch, actor))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          batch.status === 'DRAFT'
            ? 'Only eligible department preparers can remove lines from DRAFT batches.'
            : 'Only HR Manager or admins can remove lines before Finance marks the batch paid.',
      });
    }

    return withActorAndBranch(
      this.db,
      { id: actor.id, currentBranchId: batch.branchId },
      async (tx) => {
        // Re-read the batch status inside the tx and lock the row so it can't flip
        // to PAID (the immutable state) between our check and delete.
        const fresh = await tx
          .select({ status: schema.payrollBatches.status })
          .from(schema.payrollBatches)
          .where(eq(schema.payrollBatches.id, input.batchId))
          .for('update')
          .limit(1);
        if (fresh[0] && fresh[0].status === 'PAID') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Batch was paid concurrently — refresh and try again.',
          });
        }

        const payoutRows = await tx
          .select({ id: schema.payoutRecords.id })
          .from(schema.payoutRecords)
          .where(and(eq(schema.payoutRecords.id, input.payoutId), eq(schema.payoutRecords.batchId, input.batchId)))
          .limit(1);
        if (!payoutRows[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payout not in this batch' });

        // Keep the earnings-adjustment history; just detach it from the removed
        // line so a later run can re-absorb it (mirrors deleteBatch).
        await tx
          .update(schema.earningsAdjustments)
          .set({ payoutId: null })
          .where(eq(schema.earningsAdjustments.payoutId, input.payoutId));

        await tx
          .delete(schema.payoutRecords)
          .where(and(eq(schema.payoutRecords.id, input.payoutId), eq(schema.payoutRecords.batchId, input.batchId)));

        await this.recomputeBatchTotals(tx, input.batchId);
        return { success: true as const };
      },
    );
  }

  /**
   * "Keep absorbing until it leaves HR": when a standalone adjustment
   * (HrService.createAdjustment / approveAdjustment — the Deduct Salary / Add-on
   * toolbar path) is approved and an OPEN batch already has a payout line for that
   * party's month, fold it into that line right away instead of leaving it
   * floating for the next month's run.
   *
   * Works for both staff and contractors: we locate the open batch by the party's
   * existing payout line (join on payout_records → payroll_batches) rather than
   * re-deriving branch/department/scope. This naturally covers null-scope
   * CONTRACTORS/ALL batches and only fires when the party is already in the batch.
   *
   * Scope is deliberately DRAFT + PENDING_HR only — the same window
   * `addBatchAdjustment` allows. Once a batch reaches Finance we never mutate the
   * payout underneath them (Financial Truth / SoD boundary): the adjustment stays
   * floating and folds into a later batch for its month.
   *
   * Only APPROVED, un-linked, month-earmarked adjustments qualify — matching the
   * `pendingAdjustmentForMonth` predicate used at generation, so absorption never
   * folds in a row that a fresh generate would exclude. Best-effort: any miss just
   * leaves the adjustment pending, which the next generate/recalculate sweeps.
   *
   * `actorId` is the HR user performing the create/approve — used for audit
   * attribution (the party may be an external contractor with no users row).
   *
   * Returns true if the adjustment was attached to an open batch.
   */
  async absorbPendingStaffAdjustment(adjustmentId: string, actorId: string): Promise<boolean> {
    const adjRows = await this.db
      .select()
      .from(schema.earningsAdjustments)
      .where(eq(schema.earningsAdjustments.id, adjustmentId))
      .limit(1);
    const adj = adjRows[0];
    // Must mirror pendingAdjustmentForMonth: approved, unlinked, month-earmarked.
    // NULL-month adjustments keep legacy behavior (swept at generation only).
    if (!adj || !adj.approvedBy || adj.payoutId || !adj.periodMonth) return false;
    // Exactly one party per adjustment (staff XOR contractor).
    const partyStaffId = adj.staffId ?? null;
    const partyContractorId = adj.contractorId ?? null;
    if (!partyStaffId && !partyContractorId) return false;

    const partyMatch = partyStaffId
      ? eq(schema.payoutRecords.staffId, partyStaffId)
      : eq(schema.payoutRecords.contractorId, partyContractorId as string);

    // Find the party's line in an OPEN batch for the earmarked month, joining the
    // payout to its batch so this works for branch/department AND null-scope
    // (CONTRACTORS/ALL) batches alike.
    const lineRows = await this.db
      .select({
        payoutId: schema.payoutRecords.id,
        batchId: schema.payrollBatches.id,
        branchId: schema.payrollBatches.branchId,
      })
      .from(schema.payoutRecords)
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .where(
        and(
          partyMatch,
          eq(schema.payrollBatches.periodMonth, adj.periodMonth),
          inArray(schema.payrollBatches.status, ['DRAFT', 'PENDING_HR']),
        ),
      )
      .limit(1);
    const line = lineRows[0];
    // Party has no line in an open batch for this month (e.g. joined after
    // generation) — leave the adjustment pending; recalculate will pick them up.
    if (!line) return false;

    const run = async (tx: TxLike) => {
      await tx
        .update(schema.earningsAdjustments)
        .set({ payoutId: line.payoutId })
        .where(eq(schema.earningsAdjustments.id, adjustmentId));

      await this.recomputePayoutTotals(tx, line.payoutId);
      await this.recomputeBatchTotals(tx, line.batchId);
      return true;
    };

    // Attribute to the acting HR user. Carry the batch's branch when it has one
    // (branch/department batches write branch-scoped rows); null-scope contractor
    // batches have no branch, so a plain actor tx is correct there.
    if (line.branchId) {
      return withActorAndBranch(this.db, { id: actorId, currentBranchId: line.branchId }, run);
    }
    return withActor(this.db, { id: actorId }, run);
  }

  /**
   * Status of the batch an adjustment is currently linked to, or null when the
   * adjustment is floating (payoutId IS NULL). Used by the HR edit/delete guard to
   * decide whether the adjustment is still correctable.
   */
  async getAdjustmentBatchStatus(adjustmentId: string): Promise<PayrollBatchStatus | null> {
    const rows = await this.db
      .select({ status: schema.payrollBatches.status })
      .from(schema.earningsAdjustments)
      .innerJoin(schema.payoutRecords, eq(schema.payoutRecords.id, schema.earningsAdjustments.payoutId))
      .innerJoin(schema.payrollBatches, eq(schema.payrollBatches.id, schema.payoutRecords.batchId))
      .where(eq(schema.earningsAdjustments.id, adjustmentId))
      .limit(1);
    return (rows[0]?.status as PayrollBatchStatus | undefined) ?? null;
  }

  /**
   * After an adjustment linked to an OPEN batch (DRAFT / PENDING_HR) is edited or
   * detached, re-roll its payout + batch totals so the batch reflects the change.
   * No-op when the adjustment is floating or its payout can't be resolved.
   */
  async recomputeForAdjustment(payoutId: string, actorId: string): Promise<void> {
    await withActor(this.db, { id: actorId }, async (tx) => {
      const payoutRows = await tx
        .select({ batchId: schema.payoutRecords.batchId })
        .from(schema.payoutRecords)
        .where(eq(schema.payoutRecords.id, payoutId))
        .limit(1);
      const batchId = payoutRows[0]?.batchId;
      if (!batchId) return;
      await this.recomputePayoutTotals(tx, payoutId);
      await this.recomputeBatchTotals(tx, batchId);
    });
  }

  async getPrepareAccess(viewer: SessionUser) {
    const departments = new Set<PayrollDepartment>();
    const branchIds = new Set<string>();

    // Count ACTIVE payroll-role staff with no primary branch. These are invisible
    // to branch-scoped department batches — the generate UI warns and offers to
    // sweep them in (includeNullBranch) so they are never silently unpaid.
    const unassignedStaffCount = await this.countUnassignedPayrollStaff();

    const viewerHasFullHr =
      viewer.role === 'SUPER_ADMIN' ||
      (viewer.permissions ?? []).includes('hr.write');
    if (viewerHasFullHr) {
      (Object.keys(DEPARTMENT_OWNER_ROLE) as PayrollDepartment[]).forEach((d) => departments.add(d));
      const allBranches = await this.db
        .select({ id: schema.branches.id, name: schema.branches.name })
        .from(schema.branches)
        .where(sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`);
      return { allowed: true, departments: [...departments], branches: allBranches, unassignedStaffCount };
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
        unassignedStaffCount,
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
      unassignedStaffCount,
    };
  }

  /** Count ACTIVE staff on any payroll role who have no primary branch. */
  private async countUnassignedPayrollStaff(): Promise<number> {
    const payrollRoles = [...new Set(Object.values(DEPARTMENT_ROLES).flat())];
    const rows = await this.db
      .select({ n: count() })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.status, 'ACTIVE'),
          isNull(schema.users.primaryBranchId),
          inArray(schema.users.role, payrollRoles as unknown as typeof schema.users.$inferSelect['role'][]),
        ),
      );
    return Number(rows[0]?.n ?? 0);
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

    // Null-branch batches (org-wide contractors / ALL) have no branch to scope by.
    // They are visible to anyone with cross-branch HR reach (hr.write / SuperAdmin);
    // branch-scoped viewers only ever see them via a branch-pinned contractor batch,
    // which passes the normal branch filters below.
    const canSeeOrgWide =
      viewer.role === 'SUPER_ADMIN' || (viewer.permissions ?? []).includes('hr.write');
    const orgWideBatch = and(
      isNull(schema.payrollBatches.branchId),
      inArray(schema.payrollBatches.scopeType, ['CONTRACTORS', 'ALL']),
    );

    // Company group isolation: even cross-branch / org-wide viewers must be scoped
    // to their effective branch set when a company group is active. Null-branch
    // org-wide batches are exempt (they belong to no single company) for hr.write.
    if (effectiveBranchIds?.length) {
      conditions.push(
        canSeeOrgWide
          ? or(inArray(schema.payrollBatches.branchId, effectiveBranchIds), orgWideBatch)
          : inArray(schema.payrollBatches.branchId, effectiveBranchIds),
      );
    }

    if (!cross) {
      if (!viewer.currentBranchId && !orgWideHeadNullSession) return { batches: [], byMonth: [] };
      if (viewer.currentBranchId) {
        conditions.push(
          canSeeOrgWide
            ? or(eq(schema.payrollBatches.branchId, viewer.currentBranchId), orgWideBatch)
            : eq(schema.payrollBatches.branchId, viewer.currentBranchId),
        );
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
        // Dept-restricted viewers (Heads) only see their own department's batches.
        // A department filter also naturally excludes null-department (contractor /
        // ALL) batches — those are only for cross-branch admin/HR viewers.
        if (uniqueAllowed.length === 1) {
          const firstAllowed = uniqueAllowed[0] as PayrollDepartment;
          conditions.push(eq(schema.payrollBatches.department, firstAllowed));
        } else {
          conditions.push(
            inArray(
              schema.payrollBatches.department,
              uniqueAllowed as unknown as NonNullable<typeof schema.payrollBatches.$inferSelect['department']>[],
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
    if (input.department) conditions.push(eq(schema.payrollBatches.department, input.department as 'CS' | 'MARKETING' | 'LOGISTICS' | 'HR' | 'OPERATIONS' | 'FINANCE' | 'SUPPORT'));
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

  async getBatchDetail(
    batchId: string,
    viewer: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const batch = await this.requireBatch(batchId);
    assertBatchInScope(batch, viewer, effectiveBranchIds);

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
        hasFinanceAccess(viewer) ||
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

    const staffIds = payouts.map((p) => p.staffId).filter((id): id is string => !!id);
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

    // Contractor payout lines carry their bank details on payroll_contractors
    // (bank_name / bank_code / account_number / account_name) — a different table
    // and different column names than staff. Without this, contractor rows (e.g.
    // agency vendors) always exported blank bank fields for everyone.
    const contractorIds = payouts
      .map((p) => p.contractorId)
      .filter((id): id is string => !!id);
    const contractors = contractorIds.length
      ? await this.db
          .select({
            id: schema.payrollContractors.id,
            name: schema.payrollContractors.name,
            bankName: schema.payrollContractors.bankName,
            bankCode: schema.payrollContractors.bankCode,
            accountNumber: schema.payrollContractors.accountNumber,
            accountName: schema.payrollContractors.accountName,
          })
          .from(schema.payrollContractors)
          .where(inArray(schema.payrollContractors.id, contractorIds))
      : [];
    const contractorById = new Map(contractors.map((c) => [c.id, c]));

    const payoutIds = payouts.map((p) => p.id);
    const adjustments = payoutIds.length
      ? await this.db
          .select()
          .from(schema.earningsAdjustments)
          .where(inArray(schema.earningsAdjustments.payoutId, payoutIds))
          .orderBy(desc(schema.earningsAdjustments.createdAt))
      : [];

    const allowedTransitions = await this.getAllowedTransitions(batch, viewer);

    // Bank details are needed to produce the bank-upload file. Anyone who cleared
    // the `allowed` gate above (SuperAdmin, HR/reviewer, disburser, finance, or the
    // owning Head) may see them — HR now runs disbursement, so a finance-only gate
    // wrongly blanked the bank columns for HR's bank-pay export. The route into this
    // method is already permission-gated; this just stops over-redacting inside it.
    const canSeeBankDetails = allowed;
    return {
      batch,
      payouts: payouts.map((p) => {
        const staffRow = p.staffId ? staffById.get(p.staffId) : undefined;
        const contractorRow = p.contractorId ? contractorById.get(p.contractorId) : undefined;
        return {
          ...p,
          staffName: p.staffId
            ? (staffRow?.name ?? p.staffId.slice(0, 8))
            : (contractorRow?.name ?? p.payRoleName ?? 'Contractor'),
          staffRole: p.staffId ? (staffRow?.role ?? null) : null,
          // Staff use payout_* columns; contractors use bank_*/account_* columns.
          payoutBankName: !canSeeBankDetails
            ? null
            : (staffRow?.payoutBankName ?? contractorRow?.bankName ?? null),
          payoutAccountName: !canSeeBankDetails
            ? null
            : (staffRow?.payoutAccountName ?? contractorRow?.accountName ?? null),
          payoutAccountNumber: !canSeeBankDetails
            ? null
            : (staffRow?.payoutAccountNumber ?? contractorRow?.accountNumber ?? null),
          payoutBankCode: !canSeeBankDetails
            ? null
            : (staffRow?.payoutBankCode ?? contractorRow?.bankCode ?? null),
        };
      }),
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
      .select({
        baseSalary: schema.payoutRecords.baseSalary,
        performanceBonus: schema.payoutRecords.performanceBonus,
        allowancesTotal: schema.payoutRecords.allowancesTotal,
        payeTax: schema.payoutRecords.payeTax,
      })
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.id, payoutId))
      .limit(1);
    const p = payoutRows[0];
    if (!p) return null;

    const base = Number(p.baseSalary);
    const bonus = Number(p.performanceBonus);
    const allowances = Number(p.allowancesTotal ?? 0);
    const gross = base + bonus + positive + allowances;
    const tax = Number(p.payeTax ?? 0);
    const net = Math.max(0, gross - tax);
    const total = Math.max(0, net - deductions);

    const updated = await tx
      .update(schema.payoutRecords)
      .set({
        addOnsTotal: sql`${positive.toFixed(2)}::numeric`,
        deductionsTotal: sql`${deductions.toFixed(2)}::numeric`,
        grossPay: sql`${gross.toFixed(2)}::numeric`,
        netPay: sql`${net.toFixed(2)}::numeric`,
        totalPayout: sql`${total.toFixed(2)}::numeric`,
      })
      .where(eq(schema.payoutRecords.id, payoutId))
      .returning();
    return updated[0] ?? null;
  }

  private async recomputeBatchTotals(tx: TxLike, batchId: string) {
    const payouts = await tx
      .select()
      .from(schema.payoutRecords)
      .where(eq(schema.payoutRecords.batchId, batchId));
    const staffCount = payouts.length;
    const totalAmount = payouts.reduce((acc, p) => acc + Number(p.totalPayout), 0);
    const totalGross = payouts.reduce((acc, p) => acc + Number(p.grossPay ?? p.totalPayout), 0);
    const totalTax = payouts.reduce((acc, p) => acc + Number(p.payeTax ?? 0), 0);
    const totalNet = payouts.reduce((acc, p) => acc + Number(p.netPay ?? p.totalPayout), 0);
    await tx
      .update(schema.payrollBatches)
      .set({
        staffCount,
        totalAmount: sql`${totalAmount.toFixed(2)}::numeric`,
        totalGross: sql`${totalGross.toFixed(2)}::numeric`,
        totalTax: sql`${totalTax.toFixed(2)}::numeric`,
        totalNet: sql`${totalNet.toFixed(2)}::numeric`,
        updatedAt: new Date(),
      })
      .where(eq(schema.payrollBatches.id, batchId));
  }

  private async getAllowedTransitions(
    batch: { status: PayrollBatchStatus; branchId: string | null; department: string | null },
    viewer: SessionUser,
  ): Promise<string[]> {
    const out: string[] = [];
    if (
      batch.status === 'DRAFT' &&
      (await this.canPrepareDept(viewer, batch.branchId, batch.department as PayrollDepartment | null))
    ) {
      out.push('SUBMIT');
    }
    if (batch.status === 'PENDING_HR' && canReviewBatch(viewer)) {
      out.push('APPROVE', 'REJECT');
    }
    if (batch.status === 'PENDING_FINANCE' && canProcessBatch(viewer)) {
      out.push('MARK_PAID', 'REJECT');
    }
    if (await this.isBatchOpenForHrEdit(batch, viewer)) {
      out.push('EDIT');
    }
    // Delete is allowed at any stage before PAID, for anyone who can act on the
    // batch (owning head, HR, or Finance/admin). PAID batches are immutable.
    if (
      batch.status !== 'PAID' &&
      ((await this.canPrepareDept(viewer, batch.branchId, batch.department as PayrollDepartment | null)) ||
        canReviewBatch(viewer) ||
        canProcessBatch(viewer))
    ) {
      out.push('DELETE');
    }
    return out;
  }

  /**
   * The window in which HR may still edit a batch's payout lines — add-ons,
   * deductions, remove line, manual override, regenerate. Open through
   * PENDING_FINANCE so HR can correct a run after approving it to Finance but
   * before Finance disburses (CEO 2026-08-05: editable until marked PAID).
   *
   * - DRAFT: the owning department preparer (or HR/admin) — pre-submission editing.
   * - PENDING_HR / PENDING_FINANCE: HR/admins only (hr.write / SuperAdmin).
   *   Department heads do NOT get the post-approval window — once they submit,
   *   correcting the run is HR's responsibility.
   * - PAID: never. Paid payroll is an immutable financial record.
   */
  private async isBatchOpenForHrEdit(
    batch: { status: PayrollBatchStatus; branchId: string | null; department: string | null },
    actor: SessionUser,
  ): Promise<boolean> {
    if (batch.status === 'DRAFT') {
      return this.canPrepareDept(actor, batch.branchId, batch.department as PayrollDepartment | null);
    }
    if (batch.status === 'PENDING_HR' || batch.status === 'PENDING_FINANCE') {
      return canReviewBatch(actor);
    }
    return false;
  }

  private formatDepartment(d: string | null | undefined, scopeType?: string | null): string {
    // Null-scope batches have no department — describe them by scope instead.
    if (!d) {
      if (scopeType === 'CONTRACTORS') return 'Contractors';
      if (scopeType === 'ALL') return 'All staff & contractors';
      return 'Payroll';
    }
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
    branchId: string | null,
    payload: { type: string; title: string; body: string; batchId: string },
  ) {
    // For null-scope (contractor/all) batches there is no owning branch, so notify
    // every ACTIVE holder of the role org-wide rather than only branch-local ones.
    const recipients = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.status, 'ACTIVE'),
          eq(schema.users.role, role as typeof schema.users.$inferSelect['role']),
          branchId
            ? or(eq(schema.users.primaryBranchId, branchId), isNull(schema.users.primaryBranchId))
            : sql`true`,
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
    branchId: string | null,
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
// Accepts either a transaction OR the pool handle. Used by read-only compute that
// can run against the pool (e.g. parallel preview) as well as inside a tx.
type DbOrTx = TxLike | PostgresJsDatabase<typeof schema>;
