import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  computePaye,
  computePayrollFormula,
  computeProration,
  defaultPayeBandConfig,
  resolveFormulaFromRules,
  computeAttendanceEligibility,
  resolveAttendanceEnabled,
  countAbsencesInWindow,
  type PayeBandConfig,
  type PayrollFormula,
  type PayrollMetrics,
  type ProrationResult,
  type AttendanceConfig,
  type AttendanceEligibilityResult,
} from '@yannis/shared';
import { resolveApplicableCommissionPlan } from './commission-plan-resolution';
import { nigeriaCalendarDate } from '../common/utils/date-range';
import { PayrollMetricsService } from './payroll-metrics.service';

type TxLike = PostgresJsDatabase<typeof schema>;

export interface ComputedPayslipLine {
  baseSalary: number;
  performanceBonus: number;
  addOnsTotal: number;
  deductionsTotal: number;
  allowancesTotal: number;
  grossPay: number;
  /** Monthly statutory deductions (Pension/NHIS) taken off gross before PAYE. */
  statutoryTotal: number;
  /** Per-item statutory breakdown for payslips + PAYE remittance export. */
  statutoryBreakdown: Array<{ name: string; amount: number }>;
  payeTax: number;
  employerPayeSubsidy: number;
  netPay: number;
  totalPayout: number;
  metricsSnapshot: PayrollMetrics;
  bonusBreakdown: Array<{ label: string; amount: number; productId?: string; productName?: string }>;
  lineStatus: 'OK' | 'NEEDS_ATTENTION' | 'MANUALLY_OVERRIDDEN';
  payRoleName: string | null;
  /** Active-days proration applied to fixed pay (base + allowances). null when full month. */
  proration?: {
    activeDays: number;
    periodDays: number;
    fraction: number;
    reason: ProrationResult['reason'];
  } | null;
  /**
   * Attendance-based base-salary reduction applied AFTER proration (Track C).
   * null when attendance doesn't affect this staff (role OFF / override OFF) or
   * no absences crossed a band. Snapshotted for the payslip + readiness panel.
   */
  attendance?: {
    absences: number;
    deductionPercent: number;
    baseFraction: number;
    reason: string | null;
  } | null;
}

@Injectable()
export class PayrollComputeService {
  constructor(
    private readonly metricsService: PayrollMetricsService,
  ) {}

  async computeForMember(
    tx: TxLike,
    member: {
      id: string;
      role: string;
      commissionPlanId?: string | null;
      payRoleId?: string | null;
      salaryBasis?: string | null;
      taxStatus?: string | null;
      // Numeric columns arrive as strings from Drizzle, so accept both.
      flatMonthlyAmount?: string | number | null;
      /** Declared annual rent (₦) — drives the PAYE rent relief. Null → no relief. */
      annualRent?: string | number | null;
      /** Employment start — prorates fixed pay for mid-month joiners. */
      dateOfJoining?: string | Date | null;
      /** Exit date (last active day) — prorates fixed pay for mid-month leavers. */
      exitDate?: string | Date | null;
    },
    periodStart: Date,
    periodEnd: Date,
    groupId?: string | null,
    branchId?: string | null,
    opts?: {
      /**
       * Company-wide branch set the Head's team spans. When present, team DR
       * counts reportees across ALL these branches (multi-branch teams), not just
       * the Head's primary branch. Falls back to [branchId] when omitted.
       */
      effectiveBranchIds?: string[] | null;
      /**
       * Per-staff ad-hoc TAXABLE allowances for this period (doc §3), pre-summed by
       * the caller. `recurring` is prorated by active days; `oneTime` is paid in
       * full. Enters gross BEFORE PAYE. Omit → none. Formula/pay-role staff only.
       */
      adHocAllowance?: { recurring: number; oneTime: number } | null;
    },
  ): Promise<ComputedPayslipLine | null> {
    // Derive team membership from branch + subordinate role instead of explicit reportsTo links.
    const subordinateRoles: Record<string, string[]> = {
      HEAD_OF_CS: ['CS_CLOSER'],
      HEAD_OF_MARKETING: ['MEDIA_BUYER'],
      HEAD_OF_LOGISTICS: ['TPL_MANAGER', 'STOCK_MANAGER'],
    };
    const subRoles = subordinateRoles[member.role];
    // Team-DR resolution is cheap (one reportee-id lookup + two count queries) and
    // is required even on the Earnings Outlook path: Head bonus/subsidy tiers are
    // keyed on TEAM_DR, so skipping it collapses the whole variable-pay estimate
    // to base salary. Scope reportees to the Head's effective (company-wide)
    // branches so multi-branch teams count correctly; default to the primary branch.
    const teamBranchIds = [
      ...new Set((opts?.effectiveBranchIds?.length ? opts.effectiveBranchIds : branchId ? [branchId] : []).filter(Boolean)),
    ] as string[];
    let reporteeIds: string[] = [];
    if (subRoles?.length && teamBranchIds.length) {
      const reporteeRows = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            inArray(schema.users.role, subRoles as typeof schema.users.role.enumValues),
            eq(schema.users.status, 'ACTIVE'),
            inArray(schema.users.primaryBranchId, teamBranchIds),
          ),
        );
      reporteeIds = reporteeRows.map((r) => r.id);
    }

    // Recovery categories (e.g. "CS – Follow-up on Delivered Orders") count
    // delivered orders across the recovery pipelines, not the funnel. The
    // discriminator lives on the assigned pay role.
    let deliveredMetricSource: 'FUNNEL' | 'RECOVERY_COMBINED' = 'FUNNEL';
    if (member.payRoleId) {
      const [payRoleSrc] = await tx
        .select({ deliveredMetricSource: schema.payrollPayRoles.deliveredMetricSource })
        .from(schema.payrollPayRoles)
        .where(eq(schema.payrollPayRoles.id, member.payRoleId))
        .limit(1);
      if (payRoleSrc?.deliveredMetricSource === 'RECOVERY_COMBINED') {
        deliveredMetricSource = 'RECOVERY_COMBINED';
      }
    }

    // Attendance-based base eligibility (Track C). Resolve the role's config +
    // the per-user override, and count ABSENT days in the period. Only staff on a
    // role with attendance ON (and not overridden OFF) are gated. Computed here in
    // the DB-reading path; the pure in-memory twin receives the result pre-resolved.
    const attendanceEligibility = await this.resolveAttendanceEligibility(
      tx,
      member.id,
      member.payRoleId ?? null,
      periodStart,
      periodEnd,
    );

    // Servicing-branch scope for the CS-closer qualifying-revenue metric: the
    // company's effective branches when set, else this member's branch. Non-CS
    // roles ignore it (computeQualifyingRevenue returns 0 for them).
    const servicingBranchIds =
      opts?.effectiveBranchIds && opts.effectiveBranchIds.length > 0
        ? opts.effectiveBranchIds
        : branchId
          ? [branchId]
          : null;

    const metrics = await this.metricsService.getStaffMetrics(
      {
        staffId: member.id,
        staffRole: member.role,
        periodStart,
        periodEnd,
        crmLinked: true,
        reporteeIds: reporteeIds.length > 0 ? reporteeIds : undefined,
        deliveredMetricSource,
        servicingBranchIds,
      },
      tx,
    );

    // Pay-role formula is authoritative when assigned. Leftover FLAT_RATE +
    // flat_monthly_amount from old test data must not shadow Payroll Config.
    const useFlatRate =
      !member.payRoleId &&
      member.salaryBasis === 'FLAT_RATE' &&
      member.flatMonthlyAmount != null;

    const annualRent = member.annualRent != null ? Number(member.annualRent) : 0;

    // Active-days proration for mid-month joiners/leavers. Scales the FIXED pay
    // (base salary + allowances) only; performance bonus and return penalties
    // reflect actual work in the window and are never prorated.
    const proration = computeProration({
      periodStart,
      periodEnd,
      dateOfJoining: member.dateOfJoining ?? null,
      exitDate: member.exitDate ?? null,
    });

    if (useFlatRate) {
      return this.buildFlatLine(Number(member.flatMonthlyAmount), metrics, member.taxStatus ?? 'STANDARD_PAYE', tx, groupId, annualRent, proration);
    }

    const plan = await this.resolvePlanForMember(tx, member, periodStart, periodEnd);
    if (!plan) return null;

    const formula = resolveFormulaFromRules(plan.rules as PayrollFormula);
    const formulaResult = computePayrollFormula(formula, metrics);

    let payRoleName: string | null = plan.planName;
    let taxStatus: 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION' =
      (member.taxStatus as 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION') ??
      'STANDARD_PAYE';

    if (member.payRoleId) {
      const [payRole] = await tx
        .select({
          name: schema.payrollPayRoles.name,
          defaultTaxStatus: schema.payrollPayRoles.defaultTaxStatus,
        })
        .from(schema.payrollPayRoles)
        .where(eq(schema.payrollPayRoles.id, member.payRoleId))
        .limit(1);
      payRoleName = payRole?.name ?? plan.planName;
      // Pay-role Config tax is authoritative for everyone assigned to the role.
      if (payRole?.defaultTaxStatus) {
        taxStatus = payRole.defaultTaxStatus as typeof taxStatus;
      }
    }

    // Prorate fixed pay by active-days fraction; bonus/penalty stay as-earned.
    const proratedBase = formulaResult.baseSalary * proration.fraction;
    // Ad-hoc allowances: recurring portion prorated like role allowances, one-time
    // portion paid in full. Both taxable (folded into gross before PAYE). MUST match
    // computeForMemberInMemory (the pure twin) exactly — see the INVARIANT there.
    const adHocAllowance =
      (opts?.adHocAllowance?.recurring ?? 0) * proration.fraction +
      (opts?.adHocAllowance?.oneTime ?? 0);
    const proratedAllowances = formulaResult.allowancesTotal * proration.fraction + adHocAllowance;
    // Attendance gate is ABSOLUTE and applies AFTER proration: it multiplies the
    // already-prorated base. PAYE then follows the reduced base (no separate
    // "remove PAYE"). Only base is affected — bonus/allowances/penalty untouched.
    const gatedBase = proratedBase * attendanceEligibility.baseFraction;
    const grossBeforeAdj =
      gatedBase + formulaResult.performanceBonus + proratedAllowances - formulaResult.penalties;

    const taxConfig = await this.loadTaxConfig(tx, groupId);
    const paye = computePaye(
      {
        monthlyGross: grossBeforeAdj,
        taxStatus,
        employerSubsidyPercent: formulaResult.employerPayeSubsidyPercent,
        annualRent,
      },
      taxConfig,
    );

    const netPay = grossBeforeAdj - paye.employeePaye - paye.statutoryTotal;
    const lineStatus = metrics.missingData ? 'NEEDS_ATTENTION' : 'OK';

    // Drop guard checks the GATED base — a fully-gated staff with no bonus/penalty
    // is correctly dropped, same as an inactive (prorated-to-zero) member.
    if (netPay <= 0 && formulaResult.penalties <= 0 && gatedBase <= 0) return null;

    return {
      baseSalary: gatedBase,
      performanceBonus: formulaResult.performanceBonus,
      addOnsTotal: 0,
      deductionsTotal: formulaResult.penalties,
      allowancesTotal: proratedAllowances,
      grossPay: grossBeforeAdj,
      statutoryTotal: paye.statutoryTotal,
      statutoryBreakdown: paye.statutoryBreakdown,
      payeTax: paye.employeePaye,
      employerPayeSubsidy: paye.employerSubsidy,
      netPay,
      totalPayout: netPay,
      metricsSnapshot: metrics,
      bonusBreakdown: formulaResult.bonusBreakdown,
      lineStatus,
      payRoleName,
      proration: proration.isProrated
        ? {
            activeDays: proration.activeDays,
            periodDays: proration.periodDays,
            fraction: proration.fraction,
            reason: proration.reason,
          }
        : null,
      attendance: attendanceEligibility.baseReduced
        ? {
            absences: attendanceEligibility.absences,
            deductionPercent: attendanceEligibility.deductionPercent,
            baseFraction: attendanceEligibility.baseFraction,
            reason: attendanceEligibility.reason,
          }
        : null,
    };
  }

  /**
   * Resolve a staff member's attendance-based base eligibility for a period.
   * Reads the pay role's `attendanceConfig` + the user's `attendanceAffectsPay`
   * override, counts ABSENT days in [periodStart, periodEnd], and returns the
   * resulting base fraction. When attendance is OFF (role default OFF and no
   * force-ON override), returns a not-evaluated result (baseFraction = 1).
   *
   * Kept in the DB-reading path only; `computeForMemberInMemory` receives the
   * result pre-resolved via `opts.attendanceEligibility` so it stays pure.
   */
  private async resolveAttendanceEligibility(
    tx: TxLike,
    staffId: string,
    payRoleId: string | null,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<AttendanceEligibilityResult> {
    const notEvaluated: AttendanceEligibilityResult = {
      evaluated: false,
      absences: 0,
      matchedBand: null,
      deductionPercent: 0,
      baseFraction: 1,
      baseReduced: false,
      reason: null,
    };

    // Role config (default OFF) + per-user override.
    let roleConfig: AttendanceConfig | null = null;
    if (payRoleId) {
      const [row] = await tx
        .select({ attendanceConfig: schema.payrollPayRoles.attendanceConfig })
        .from(schema.payrollPayRoles)
        .where(eq(schema.payrollPayRoles.id, payRoleId))
        .limit(1);
      roleConfig = (row?.attendanceConfig as AttendanceConfig | undefined) ?? null;
    }

    const [userRow] = await tx
      .select({ override: schema.users.attendanceAffectsPay })
      .from(schema.users)
      .where(eq(schema.users.id, staffId))
      .limit(1);

    const enabled = resolveAttendanceEnabled(roleConfig?.enabled ?? false, userRow?.override ?? null);
    if (!enabled) return notEvaluated;

    // Count ABSENT records in the period window (date-only comparison).
    const startDay = this.toDateOnly(periodStart);
    const endDay = this.toDateOnly(periodEnd);
    const records = await tx
      .select({ status: schema.attendanceRecords.status })
      .from(schema.attendanceRecords)
      .where(
        and(
          eq(schema.attendanceRecords.staffId, staffId),
          gte(schema.attendanceRecords.attendanceDate, startDay),
          sql`${schema.attendanceRecords.attendanceDate} <= ${endDay}`,
        ),
      );

    const absences = countAbsencesInWindow(records);
    return computeAttendanceEligibility({
      absences,
      config: { enabled: true, bands: roleConfig?.bands ?? [] },
    });
  }

  /**
   * Format a WAT-window Date to its `YYYY-MM-DD` calendar day in Africa/Lagos.
   * MUST NOT use `toISOString().slice(0,10)` — periodStart/End are WAT-midnight
   * instants whose UTC date is the PREVIOUS day, which would shift the absence
   * window off by one at both boundaries (the documented WAT-midnight trap).
   */
  private toDateOnly(d: Date): string {
    return nigeriaCalendarDate(d);
  }

  /**
   * BATCHED attendance eligibility for the preview fast path — resolves every
   * staff member's eligibility in a fixed number of queries (2), not N. The
   * caller supplies each member's resolved role attendance config (from its own
   * pay-role cache). Returns a Map keyed by staffId; absent staff → not-evaluated.
   *
   * Preview MUST use this so its numbers match generation (which uses the
   * per-member `resolveAttendanceEligibility`). Same math, batched I/O.
   */
  async resolveAttendanceEligibilityBatched(
    tx: TxLike,
    members: Array<{ id: string; roleConfig: AttendanceConfig | null }>,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Map<string, AttendanceEligibilityResult>> {
    const notEvaluated = (): AttendanceEligibilityResult => ({
      evaluated: false,
      absences: 0,
      matchedBand: null,
      deductionPercent: 0,
      baseFraction: 1,
      baseReduced: false,
      reason: null,
    });

    const out = new Map<string, AttendanceEligibilityResult>();
    for (const m of members) out.set(m.id, notEvaluated());

    const allIds = members.map((m) => m.id);
    if (allIds.length === 0) return out;

    // Per-user override for everyone (a force-ON can gate even a role-OFF member).
    const overrideRows = await tx
      .select({ id: schema.users.id, override: schema.users.attendanceAffectsPay })
      .from(schema.users)
      .where(inArray(schema.users.id, allIds));
    const overrideById = new Map(overrideRows.map((r) => [r.id, r.override]));

    // Resolve which members are effectively ON, then count their absences in one query.
    const configById = new Map(members.map((m) => [m.id, m.roleConfig]));
    const enabledIds = allIds.filter((id) =>
      resolveAttendanceEnabled(configById.get(id)?.enabled ?? false, overrideById.get(id) ?? null),
    );
    if (enabledIds.length === 0) return out;

    const startDay = this.toDateOnly(periodStart);
    const endDay = this.toDateOnly(periodEnd);
    const absenceRows = await tx
      .select({
        staffId: schema.attendanceRecords.staffId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.attendanceRecords)
      .where(
        and(
          inArray(schema.attendanceRecords.staffId, enabledIds),
          eq(schema.attendanceRecords.status, 'ABSENT'),
          gte(schema.attendanceRecords.attendanceDate, startDay),
          sql`${schema.attendanceRecords.attendanceDate} <= ${endDay}`,
        ),
      )
      .groupBy(schema.attendanceRecords.staffId);
    const absencesById = new Map(absenceRows.map((r) => [r.staffId, Number(r.count)]));

    for (const id of enabledIds) {
      const cfg = configById.get(id);
      out.set(
        id,
        computeAttendanceEligibility({
          absences: absencesById.get(id) ?? 0,
          config: { enabled: true, bands: cfg?.bands ?? [] },
        }),
      );
    }
    return out;
  }

  /**
   * PURE, IN-MEMORY twin of the second half of `computeForMember` — takes
   * pre-fetched metrics, a resolved plan, a resolved pay-role (name + tax
   * status), and a pre-loaded tax config, and runs the SAME formula / proration
   * / PAYE math with ZERO database access. Used only by the batched preview fast
   * path (`computeSelectionTotalsBatched`); the per-member `computeForMember`
   * remains the authoritative DB-reading path and generation is unchanged.
   *
   * INVARIANT: for identical inputs this MUST return the same line
   * `computeForMember` would. It reuses the exact same shared functions
   * (`resolveFormulaFromRules`, `computePayrollFormula`, `computeProration`
   * result, `computePaye`) — no math is reimplemented here.
   */
  computeForMemberInMemory(
    member: {
      id: string;
      role: string;
      payRoleId?: string | null;
      salaryBasis?: string | null;
      taxStatus?: string | null;
      flatMonthlyAmount?: string | number | null;
      annualRent?: string | number | null;
      dateOfJoining?: string | Date | null;
      exitDate?: string | Date | null;
    },
    periodStart: Date,
    periodEnd: Date,
    metrics: PayrollMetrics,
    resolved: {
      /** Plan resolved via the same rules as `resolvePlanForMember` (null → no PRD formula). */
      plan: { planName: string; rules: unknown } | null;
      /** Pay-role name + defaultTaxStatus (from the pay-role row), when payRoleId set. */
      payRole?: { name: string | null; defaultTaxStatus: string | null } | null;
      taxConfig: PayeBandConfig;
      /**
       * Attendance eligibility, pre-resolved by the caller (DB-reading) so this
       * twin stays pure. Omit / null → attendance doesn't affect this member
       * (baseFraction 1). MUST be the same result `computeForMember` would derive.
       */
      attendanceEligibility?: AttendanceEligibilityResult | null;
      /**
       * Per-staff ad-hoc TAXABLE allowances for this period (doc §3), pre-summed
       * by the caller. `recurring` is prorated by active days like role
       * allowances; `oneTime` is paid in full. Enters gross BEFORE PAYE so it is
       * taxed. Omit → no ad-hoc allowance. Only applies to formula/pay-role staff.
       */
      adHocAllowance?: { recurring: number; oneTime: number } | null;
    },
  ): ComputedPayslipLine | null {
    const attendanceEligibility: AttendanceEligibilityResult = resolved.attendanceEligibility ?? {
      evaluated: false,
      absences: 0,
      matchedBand: null,
      deductionPercent: 0,
      baseFraction: 1,
      baseReduced: false,
      reason: null,
    };
    const useFlatRate =
      !member.payRoleId &&
      member.salaryBasis === 'FLAT_RATE' &&
      member.flatMonthlyAmount != null;

    const annualRent = member.annualRent != null ? Number(member.annualRent) : 0;
    const proration = computeProration({
      periodStart,
      periodEnd,
      dateOfJoining: member.dateOfJoining ?? null,
      exitDate: member.exitDate ?? null,
    });

    if (useFlatRate) {
      return this.buildFlatLineInMemory(
        Number(member.flatMonthlyAmount),
        metrics,
        member.taxStatus ?? 'STANDARD_PAYE',
        resolved.taxConfig,
        annualRent,
        proration,
      );
    }

    if (!resolved.plan) return null;

    const formula = resolveFormulaFromRules(resolved.plan.rules as PayrollFormula);
    const formulaResult = computePayrollFormula(formula, metrics);

    let payRoleName: string | null = resolved.plan.planName;
    let taxStatus: 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION' =
      (member.taxStatus as 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION') ??
      'STANDARD_PAYE';

    if (member.payRoleId) {
      payRoleName = resolved.payRole?.name ?? resolved.plan.planName;
      if (resolved.payRole?.defaultTaxStatus) {
        taxStatus = resolved.payRole.defaultTaxStatus as typeof taxStatus;
      }
    }

    const proratedBase = formulaResult.baseSalary * proration.fraction;
    // Ad-hoc allowances: recurring portion prorated like role allowances, one-time
    // portion paid in full. Both are taxable (folded into gross before PAYE).
    const adHocAllowance =
      (resolved.adHocAllowance?.recurring ?? 0) * proration.fraction +
      (resolved.adHocAllowance?.oneTime ?? 0);
    const proratedAllowances = formulaResult.allowancesTotal * proration.fraction + adHocAllowance;
    // Attendance gate — IDENTICAL to the DB-reading path: multiply the prorated
    // base by the eligibility fraction; PAYE follows the reduced base.
    const gatedBase = proratedBase * attendanceEligibility.baseFraction;
    const grossBeforeAdj =
      gatedBase + formulaResult.performanceBonus + proratedAllowances - formulaResult.penalties;

    const paye = computePaye(
      {
        monthlyGross: grossBeforeAdj,
        taxStatus,
        employerSubsidyPercent: formulaResult.employerPayeSubsidyPercent,
        annualRent,
      },
      resolved.taxConfig,
    );

    const netPay = grossBeforeAdj - paye.employeePaye - paye.statutoryTotal;
    const lineStatus = metrics.missingData ? 'NEEDS_ATTENTION' : 'OK';

    if (netPay <= 0 && formulaResult.penalties <= 0 && gatedBase <= 0) return null;

    return {
      baseSalary: gatedBase,
      performanceBonus: formulaResult.performanceBonus,
      addOnsTotal: 0,
      deductionsTotal: formulaResult.penalties,
      allowancesTotal: proratedAllowances,
      grossPay: grossBeforeAdj,
      statutoryTotal: paye.statutoryTotal,
      statutoryBreakdown: paye.statutoryBreakdown,
      payeTax: paye.employeePaye,
      employerPayeSubsidy: paye.employerSubsidy,
      netPay,
      totalPayout: netPay,
      metricsSnapshot: metrics,
      bonusBreakdown: formulaResult.bonusBreakdown,
      lineStatus,
      payRoleName,
      proration: proration.isProrated
        ? {
            activeDays: proration.activeDays,
            periodDays: proration.periodDays,
            fraction: proration.fraction,
            reason: proration.reason,
          }
        : null,
      attendance: attendanceEligibility.baseReduced
        ? {
            absences: attendanceEligibility.absences,
            deductionPercent: attendanceEligibility.deductionPercent,
            baseFraction: attendanceEligibility.baseFraction,
            reason: attendanceEligibility.reason,
          }
        : null,
    };
  }

  /** In-memory twin of `buildFlatLine` (no tax-config DB read). */
  private buildFlatLineInMemory(
    amount: number,
    metrics: PayrollMetrics,
    taxStatus: string,
    taxConfig: PayeBandConfig,
    annualRent = 0,
    proration?: ProrationResult,
  ): ComputedPayslipLine {
    const fraction = proration?.fraction ?? 1;
    const proratedAmount = amount * fraction;
    const paye = computePaye(
      { monthlyGross: proratedAmount, taxStatus: taxStatus as 'STANDARD_PAYE' | 'GROSS_NO_DEDUCTION', annualRent },
      taxConfig,
    );
    const netPay = proratedAmount - paye.employeePaye - paye.statutoryTotal;
    return {
      baseSalary: proratedAmount,
      performanceBonus: 0,
      addOnsTotal: 0,
      deductionsTotal: 0,
      allowancesTotal: 0,
      grossPay: proratedAmount,
      statutoryTotal: paye.statutoryTotal,
      statutoryBreakdown: paye.statutoryBreakdown,
      payeTax: paye.employeePaye,
      employerPayeSubsidy: 0,
      netPay,
      totalPayout: netPay,
      metricsSnapshot: metrics,
      bonusBreakdown: [],
      lineStatus: metrics.missingData ? 'NEEDS_ATTENTION' : 'OK',
      payRoleName: 'Flat rate',
      proration: proration?.isProrated
        ? {
            activeDays: proration.activeDays,
            periodDays: proration.periodDays,
            fraction: proration.fraction,
            reason: proration.reason,
          }
        : null,
    };
  }

  private async buildFlatLine(
    amount: number,
    metrics: PayrollMetrics,
    taxStatus: string,
    tx: TxLike,
    groupId?: string | null,
    annualRent = 0,
    proration?: ProrationResult,
  ): Promise<ComputedPayslipLine> {
    const fraction = proration?.fraction ?? 1;
    const proratedAmount = amount * fraction;
    const taxConfig = await this.loadTaxConfig(tx, groupId);
    const paye = computePaye(
      { monthlyGross: proratedAmount, taxStatus: taxStatus as 'STANDARD_PAYE' | 'GROSS_NO_DEDUCTION', annualRent },
      taxConfig,
    );
    const netPay = proratedAmount - paye.employeePaye - paye.statutoryTotal;
    return {
      baseSalary: proratedAmount,
      performanceBonus: 0,
      addOnsTotal: 0,
      deductionsTotal: 0,
      allowancesTotal: 0,
      grossPay: proratedAmount,
      statutoryTotal: paye.statutoryTotal,
      statutoryBreakdown: paye.statutoryBreakdown,
      payeTax: paye.employeePaye,
      employerPayeSubsidy: 0,
      netPay,
      totalPayout: netPay,
      metricsSnapshot: metrics,
      bonusBreakdown: [],
      lineStatus: metrics.missingData ? 'NEEDS_ATTENTION' : 'OK',
      payRoleName: 'Flat rate',
      proration: proration?.isProrated
        ? {
            activeDays: proration.activeDays,
            periodDays: proration.periodDays,
            fraction: proration.fraction,
            reason: proration.reason,
          }
        : null,
    };
  }

  /**
   * Fetch a pay-role's name + defaultTaxStatus (the two fields `computeForMember`
   * reads on the PRD path). Exposed so the batched preview can pre-load all
   * distinct pay roles at once and resolve each member in memory.
   */
  async loadPayRole(
    tx: TxLike,
    payRoleId: string,
  ): Promise<{
    name: string | null;
    defaultTaxStatus: string | null;
    deliveredMetricSource: 'FUNNEL' | 'RECOVERY_COMBINED';
    attendanceConfig: AttendanceConfig | null;
  } | null> {
    const [row] = await tx
      .select({
        name: schema.payrollPayRoles.name,
        defaultTaxStatus: schema.payrollPayRoles.defaultTaxStatus,
        deliveredMetricSource: schema.payrollPayRoles.deliveredMetricSource,
        attendanceConfig: schema.payrollPayRoles.attendanceConfig,
      })
      .from(schema.payrollPayRoles)
      .where(eq(schema.payrollPayRoles.id, payRoleId))
      .limit(1);
    if (!row) return null;
    return {
      name: row.name,
      defaultTaxStatus: row.defaultTaxStatus,
      deliveredMetricSource:
        row.deliveredMetricSource === 'RECOVERY_COMBINED' ? 'RECOVERY_COMBINED' : 'FUNNEL',
      attendanceConfig: (row.attendanceConfig as AttendanceConfig | undefined) ?? null,
    };
  }

  /**
   * Public wrapper over the plan resolution used by `computeForMember`. Same
   * logic, exposed so the batched preview can memoize identical resolutions
   * (by payRoleId / role) instead of re-running per member. Returns the resolved
   * commission plan row (with `.planName` + `.rules`) or null.
   */
  resolvePlanForMemberPublic(
    tx: TxLike,
    member: { id: string; role: string; commissionPlanId?: string | null; payRoleId?: string | null },
    periodStart: Date,
    periodEnd: Date,
  ) {
    return this.resolvePlanForMember(tx, member, periodStart, periodEnd);
  }

  private async resolvePlanForMember(
    tx: TxLike,
    member: { id: string; role: string; commissionPlanId?: string | null; payRoleId?: string | null },
    periodStart: Date,
    periodEnd: Date,
  ) {
    if (member.payRoleId) {
      const payRole = (
        await tx
          .select()
          .from(schema.payrollPayRoles)
          .where(eq(schema.payrollPayRoles.id, member.payRoleId))
          .limit(1)
      )[0];

      // 1) Plan currently linked on the pay role (Payroll Config → formula).
      if (payRole?.commissionPlanId) {
        const linked = (
          await tx
            .select()
            .from(schema.commissionPlans)
            .where(eq(schema.commissionPlans.id, payRole.commissionPlanId))
            .limit(1)
        )[0];
        if (linked) return linked;
      }

      // 2) Latest open plan written for this pay role (covers link drift after formula saves).
      const byPayRole = (
        await tx
          .select()
          .from(schema.commissionPlans)
          .where(
            and(
              eq(schema.commissionPlans.payRoleId, member.payRoleId),
              isNull(schema.commissionPlans.effectiveTo),
            ),
          )
          .orderBy(desc(schema.commissionPlans.effectiveFrom))
          .limit(1)
      )[0];
      if (byPayRole) return byPayRole;

      // Assigned pay role but no formula yet — do NOT fall back to a personal /
      // legacy role-default commission plan (that showed the wrong earnings outlook).
      return null;
    }

    return resolveApplicableCommissionPlan(tx, {
      commissionPlanId: member.commissionPlanId ?? null,
      staffRole: member.role,
      rangeStart: periodStart,
      rangeEnd: periodEnd,
    });
  }

  async loadTaxConfig(tx: TxLike, groupId?: string | null): Promise<PayeBandConfig> {
    const rows = await tx
      .select()
      .from(schema.payrollTaxBandConfigs)
      .where(
        and(
          or(isNull(schema.payrollTaxBandConfigs.effectiveTo), gte(schema.payrollTaxBandConfigs.effectiveTo, new Date())),
          // Exact company only — never fall back to null/global shared bands.
          groupId ? eq(schema.payrollTaxBandConfigs.groupId, groupId) : sql`false`,
        ),
      )
      .orderBy(desc(schema.payrollTaxBandConfigs.effectiveFrom))
      .limit(1);

    const row = rows[0];
    if (!row) return defaultPayeBandConfig();

    return {
      taxFreeThreshold: Number(row.taxFreeThreshold),
      bands: row.bands as PayeBandConfig['bands'],
      reliefs: row.reliefs as PayeBandConfig['reliefs'],
      statutoryDeductions:
        (row.statutoryDeductions as PayeBandConfig['statutoryDeductions']) ?? [],
      lowIncomeExemptionMonthly: Number(row.lowIncomeExemptionMonthly ?? 0),
    };
  }
}
