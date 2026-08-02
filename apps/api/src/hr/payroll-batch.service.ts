import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, or, desc, gte, lte, isNull, ilike, count, sum, inArray, sql, type SQL } from 'drizzle-orm';
// `isNotNull` is imported separately so the compile-time exports list stays sorted.
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { computePaye, db as schema } from '@yannis/shared';
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
import { GeneralLedgerService } from '../finance/general-ledger.service';
import { runGlPostWithFinanceAlert } from '../finance/gl-posting-notify';
import { canAccessStaffHrUserDetail, isOrgWideDepartmentHead } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isBranchTeamsSchemaMissingError } from '../common/db/branch-teams-schema';
import { resolveApplicableCommissionPlan } from './commission-plan-resolution';
import { computeEarningsFromPlanRules } from './commission-rules-math';
import { PayrollComputeService } from './payroll-compute.service';
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
  CS: ['CS_CLOSER', 'HEAD_OF_CS'],
  MARKETING: ['MEDIA_BUYER', 'HEAD_OF_MARKETING'],
  LOGISTICS: ['HEAD_OF_LOGISTICS', 'TPL_MANAGER', 'STOCK_MANAGER'],
  HR: ['HR_MANAGER', 'BRANCH_ADMIN'],
  OPERATIONS: ['SUPER_ADMIN', 'ADMIN'],
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

/** Finance disbursement stage — requires finance.disburse (not merely cost-view / auditor). */
function canProcessBatch(user: SessionUser): boolean {
  if (user.role === 'SUPER_ADMIN' || user.role === 'SUPPORT') return true;
  return (user.permissions ?? []).includes('finance.disburse');
}

function assertBatchInScope(
  batch: { branchId: string },
  viewer: SessionUser,
  effectiveBranchIds?: string[] | null,
) {
  if (viewer.role === 'SUPER_ADMIN' || viewer.role === 'SUPPORT') return;
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
    const scopeBranchIds = [
      ...new Set(
        (input.scopeBranchIds?.length ? input.scopeBranchIds : [input.branchId]).filter(Boolean),
      ),
    ];
    if (!scopeBranchIds.includes(input.branchId)) {
      scopeBranchIds.unshift(input.branchId);
    }
    const scopeType =
      input.scopeType ?? (scopeBranchIds.length > 1 ? 'BRANCHES' : 'DEPARTMENT');

    for (const bid of scopeBranchIds) {
      if (!(await this.canPrepareDept(actor, bid, input.department))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `You cannot prepare a payroll batch for ${input.department} on one of the selected branches.`,
        });
      }
    }

    // periodMonth is validated as YYYY-MM-01 — do not append another `-01`.
    const periodStart = nigeriaDayStart(input.periodMonth);
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
            branchId: input.branchId,
            periodMonth: input.periodMonth,
            department: input.department,
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
        input.branchId,
        input.department,
        periodStart,
        periodEnd,
        {
          includeContractors: input.includeContractors ?? false,
          scopeEmployeeIds: input.scopeEmployeeIds ?? null,
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

    const periodStart = nigeriaDayStart(input.periodMonth);
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
    opts: {
      includeContractors?: boolean;
      scopeEmployeeIds?: string[] | null;
      scopeBranchIds?: string[] | null;
    } = {},
  ): Promise<{ generated: number; totalAmount: number }> {
    const departmentRoles = DEPARTMENT_ROLES[department];
    const staffBranchIds = [
      ...new Set(
        (opts.scopeBranchIds?.length ? opts.scopeBranchIds : [branchId]).filter(Boolean),
      ),
    ];
    // Include ACTIVE staff, plus mid-period leavers (now INACTIVE) whose exit
    // date falls inside this period — they're owed a final prorated payout.
    const periodEndYmd = periodEnd.toISOString().slice(0, 10);
    const periodStartYmd = periodStart.toISOString().slice(0, 10);
    let staff = await tx
      .select()
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.primaryBranchId, staffBranchIds),
          inArray(schema.users.role, departmentRoles as unknown as typeof schema.users.$inferSelect['role'][]),
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

    for (const member of staff) {
      if (member.onboardingPayrollStatus === 'PENDING_APPROVAL') continue;

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

    if (opts.includeContractors) {
      const branchRow = (
        await tx
          .select({ groupId: schema.branches.groupId })
          .from(schema.branches)
          .where(eq(schema.branches.id, branchId))
          .limit(1)
      )[0];

      const contractors = await tx
        .select()
        .from(schema.payrollContractors)
        .where(
          and(
            eq(schema.payrollContractors.active, true),
            or(
              inArray(schema.payrollContractors.branchId, staffBranchIds),
              isNull(schema.payrollContractors.branchId),
            ),
            // Exact company only — never include null-scoped shared contractors.
            branchRow?.groupId
              ? eq(schema.payrollContractors.groupId, branchRow.groupId)
              : sql`false`,
          ),
        );

      // Company PAYE bands for contractor fee tax (same config as staff lines).
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
        const netPay = Math.max(0, fee - paye.employeePaye);
        await tx.insert(schema.payoutRecords).values({
          batchId,
          contractorId: contractor.id,
          staffId: null,
          periodStart,
          periodEnd,
          baseSalary: sql`${fee.toFixed(2)}::numeric`,
          performanceBonus: sql`0::numeric`,
          addOnsTotal: sql`0::numeric`,
          deductionsTotal: sql`${paye.employeePaye.toFixed(2)}::numeric`,
          totalPayout: sql`${netPay.toFixed(2)}::numeric`,
          allowancesTotal: sql`0::numeric`,
          grossPay: sql`${fee.toFixed(2)}::numeric`,
          payeTax: sql`${paye.employeePaye.toFixed(2)}::numeric`,
          employerPayeSubsidy: sql`${paye.employerSubsidy.toFixed(2)}::numeric`,
          netPay: sql`${netPay.toFixed(2)}::numeric`,
          payRoleName: contractor.name,
          lineStatus: 'OK',
          status: 'DRAFT',
        });
        generatedPayouts.push({
          staffId: contractor.id,
          baseSalary: fee,
          performanceBonus: 0,
          addOnsTotal: 0,
          deductionsTotal: paye.employeePaye,
          totalPayout: netPay,
          grossPay: fee,
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

  async previewBatch(input: GenerateBatchInput, actor: SessionUser) {
    const scopeBranchIds = [
      ...new Set(
        (input.scopeBranchIds?.length ? input.scopeBranchIds : [input.branchId]).filter(Boolean),
      ),
    ];
    if (!scopeBranchIds.includes(input.branchId)) scopeBranchIds.unshift(input.branchId);

    for (const bid of scopeBranchIds) {
      if (!(await this.canPrepareDept(actor, bid, input.department))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `You cannot preview payroll for ${input.department} on one of the selected branches.`,
        });
      }
    }
    const periodStart = nigeriaDayStart(input.periodMonth);
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
            inArray(schema.users.primaryBranchId, scopeBranchIds),
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
  ): Promise<Omit<PayoutRow, 'staffId'> | null> {
    const branchRow = (
      await tx
        .select({ groupId: schema.branches.groupId, branchId: schema.branches.id })
        .from(schema.users)
        .innerJoin(schema.branches, eq(schema.branches.id, schema.users.primaryBranchId))
        .where(eq(schema.users.id, member.id))
        .limit(1)
    )[0];

    const computed = await this.payrollCompute.computeForMember(
      tx,
      member,
      periodStart,
      periodEnd,
      branchRow?.groupId ?? null,
      branchRow?.branchId ?? null,
    );
    if (!computed) {
      return this.computePayoutForMemberLegacy(tx, member, periodStart, periodEnd);
    }

    const pendingClawbackRows = await tx
      .select({ total: sum(schema.earningsAdjustments.amount) })
      .from(schema.earningsAdjustments)
      .where(
        and(
          eq(schema.earningsAdjustments.staffId, member.id),
          inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
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
          inArray(schema.earningsAdjustments.category, ['CLAWBACK', 'DEDUCTION']),
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
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} is ready for your review.`,
      batchId: batch.id,
    });

    return updated;
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
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} (${batch.staffCount} staff, ₦${Number(batch.totalAmount).toLocaleString('en-NG')}) is approved.`,
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
      notifyRole = DEPARTMENT_OWNER_ROLE[batch.department as PayrollDepartment];
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
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} was rejected. Reason: ${input.reason}`,
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
        message: 'Only users with finance.disburse (or SuperAdmin) can mark batches paid.',
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
      body: `${this.formatDepartment(batch.department)} batch for ${this.formatPeriod(batch.periodMonth)} marked paid.`,
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
    if (!(await this.canPrepareDept(actor, batch.branchId, batch.department as PayrollDepartment))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to recalculate this batch.' });
    }
    if (batch.status !== 'DRAFT') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Only DRAFT batches can be recalculated.' });
    }

    const periodStart = nigeriaDayStart(String(batch.periodMonth));
    const lastDay = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0));
    const periodEnd = nigeriaDayEnd(lastDay.toISOString().slice(0, 10));

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
    if (batch.status !== 'DRAFT' && batch.status !== 'PENDING_HR') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Overrides only allowed on Draft or Pending Approval batches.' });
    }
    if (!canReviewBatch(actor) && !(await this.canPrepareDept(actor, batch.branchId, batch.department as PayrollDepartment))) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to override payslip lines.' });
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
        branchName: schema.branches.name,
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
      .innerJoin(schema.branches, eq(schema.branches.id, schema.payrollBatches.branchId))
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
      const branchRow = (
        await this.db
          .select({ name: schema.branches.name })
          .from(schema.branches)
          .where(eq(schema.branches.id, batch.branchId))
          .limit(1)
      )[0];

      const rows = detail.payouts
        .filter((p) => Number(p.totalPayout ?? p.netPay) > 0)
        .map((p) => ({
          beneficiaryName: p.payoutAccountName ?? p.staffName ?? p.payRoleName ?? 'Unknown',
          accountNumber: p.payoutAccountNumber ?? '',
          bankCode: p.payoutBankCode ?? '',
          bankName: p.payoutBankName ?? '',
          // Cash to bank = totalPayout (after clawbacks); netPay is pre-deduction.
          amount: Number(p.totalPayout ?? p.netPay),
          reference: `${batch.periodMonth}-${batch.department}-${p.staffName ?? p.payRoleName ?? 'line'}`,
          staffName: p.staffName,
          payRoleName: p.payRoleName,
        }));

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
      .innerJoin(schema.branches, eq(schema.branches.id, schema.payrollBatches.branchId))
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

        if (!payout.staffId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot adjust contractor payout lines this way' });

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
        staffName: p.staffId ? (staffById.get(p.staffId)?.name ?? p.staffId.slice(0, 8)) : (p.payRoleName ?? 'Contractor'),
        staffRole: p.staffId ? (staffById.get(p.staffId)?.role ?? null) : null,
        payoutBankName: hasFinanceAccess(viewer) && p.staffId ? (staffById.get(p.staffId)?.payoutBankName ?? null) : null,
        payoutAccountName: hasFinanceAccess(viewer) && p.staffId ? (staffById.get(p.staffId)?.payoutAccountName ?? null) : null,
        payoutAccountNumber: hasFinanceAccess(viewer) && p.staffId ? (staffById.get(p.staffId)?.payoutAccountNumber ?? null) : null,
        payoutBankCode: hasFinanceAccess(viewer) && p.staffId ? (staffById.get(p.staffId)?.payoutBankCode ?? null) : null,
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
