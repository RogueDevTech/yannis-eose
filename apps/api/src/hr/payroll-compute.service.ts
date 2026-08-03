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
  type PayeBandConfig,
  type PayrollFormula,
  type PayrollMetrics,
  type ProrationResult,
} from '@yannis/shared';
import { resolveApplicableCommissionPlan } from './commission-plan-resolution';
import { PayrollMetricsService } from './payroll-metrics.service';

type TxLike = PostgresJsDatabase<typeof schema>;

export interface ComputedPayslipLine {
  baseSalary: number;
  performanceBonus: number;
  addOnsTotal: number;
  deductionsTotal: number;
  allowancesTotal: number;
  grossPay: number;
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

    const metrics = await this.metricsService.getStaffMetrics(
      {
        staffId: member.id,
        staffRole: member.role,
        periodStart,
        periodEnd,
        crmLinked: true,
        reporteeIds: reporteeIds.length > 0 ? reporteeIds : undefined,
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
    const proratedAllowances = formulaResult.allowancesTotal * proration.fraction;
    const grossBeforeAdj =
      proratedBase + formulaResult.performanceBonus + proratedAllowances - formulaResult.penalties;

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

    const netPay = grossBeforeAdj - paye.employeePaye;
    const lineStatus = metrics.missingData ? 'NEEDS_ATTENTION' : 'OK';

    if (netPay <= 0 && formulaResult.penalties <= 0 && proratedBase <= 0) return null;

    return {
      baseSalary: proratedBase,
      performanceBonus: formulaResult.performanceBonus,
      addOnsTotal: 0,
      deductionsTotal: formulaResult.penalties,
      allowancesTotal: proratedAllowances,
      grossPay: grossBeforeAdj,
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
    const netPay = proratedAmount - paye.employeePaye;
    return {
      baseSalary: proratedAmount,
      performanceBonus: 0,
      addOnsTotal: 0,
      deductionsTotal: 0,
      allowancesTotal: 0,
      grossPay: proratedAmount,
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
    };
  }
}
