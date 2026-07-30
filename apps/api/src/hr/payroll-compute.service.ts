import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  db as schema,
  computePaye,
  computePayrollFormula,
  defaultPayeBandConfig,
  resolveFormulaFromRules,
  type PayeBandConfig,
  type PayrollFormula,
  type PayrollMetrics,
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
      flatMonthlyAmount?: number | null;
    },
    periodStart: Date,
    periodEnd: Date,
    groupId?: string | null,
    branchId?: string | null,
    opts?: {
      /**
       * Skip fan-out over branch reportees + team DR (expensive on large CS/MB teams).
       * Used by Earnings outlook so Head profiles still return a base-salary estimate.
       * TEAM_DR formula tiers fall back to individual DR when teamDr is absent.
       */
      skipTeamMetrics?: boolean;
    },
  ): Promise<ComputedPayslipLine | null> {
    // Derive team membership from branch + subordinate role instead of explicit reportsTo links.
    const subordinateRoles: Record<string, string[]> = {
      HEAD_OF_CS: ['CS_CLOSER'],
      HEAD_OF_MARKETING: ['MEDIA_BUYER'],
      HEAD_OF_LOGISTICS: ['TPL_MANAGER', 'STOCK_MANAGER'],
    };
    const subRoles = subordinateRoles[member.role];
    let reporteeIds: string[] = [];
    if (!opts?.skipTeamMetrics && subRoles?.length && branchId) {
      const reporteeRows = await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            inArray(schema.users.role, subRoles as typeof schema.users.role.enumValues),
            eq(schema.users.status, 'ACTIVE'),
            eq(schema.users.primaryBranchId, branchId),
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

    if (useFlatRate) {
      return this.buildFlatLine(Number(member.flatMonthlyAmount), metrics, member.taxStatus ?? 'STANDARD_PAYE', tx, groupId);
    }

    const plan = await this.resolvePlanForMember(tx, member, periodStart, periodEnd);
    if (!plan) return null;

    const formula = resolveFormulaFromRules(plan.rules as PayrollFormula);
    const productTiers = await this.loadProductTiers(tx, groupId);
    const formulaResult = computePayrollFormula(formula, metrics, productTiers);

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

    const grossBeforeAdj = formulaResult.grossBeforeAdjustments;
    const taxConfig = await this.loadTaxConfig(tx, groupId);
    const paye = computePaye(
      {
        monthlyGross: grossBeforeAdj,
        taxStatus,
        employerSubsidyPercent: formulaResult.employerPayeSubsidyPercent,
      },
      taxConfig,
    );

    const netPay = grossBeforeAdj - paye.employeePaye;
    const lineStatus = metrics.missingData ? 'NEEDS_ATTENTION' : 'OK';

    if (netPay <= 0 && formulaResult.penalties <= 0 && formulaResult.baseSalary <= 0) return null;

    return {
      baseSalary: formulaResult.baseSalary,
      performanceBonus: formulaResult.performanceBonus,
      addOnsTotal: 0,
      deductionsTotal: formulaResult.penalties,
      allowancesTotal: formulaResult.allowancesTotal,
      grossPay: grossBeforeAdj,
      payeTax: paye.employeePaye,
      employerPayeSubsidy: paye.employerSubsidy,
      netPay,
      totalPayout: netPay,
      metricsSnapshot: metrics,
      bonusBreakdown: formulaResult.bonusBreakdown,
      lineStatus,
      payRoleName,
    };
  }

  private async buildFlatLine(
    amount: number,
    metrics: PayrollMetrics,
    taxStatus: string,
    tx: TxLike,
    groupId?: string | null,
  ): Promise<ComputedPayslipLine> {
    const taxConfig = await this.loadTaxConfig(tx, groupId);
    const paye = computePaye(
      { monthlyGross: amount, taxStatus: taxStatus as 'STANDARD_PAYE' | 'GROSS_NO_DEDUCTION' },
      taxConfig,
    );
    const netPay = amount - paye.employeePaye;
    return {
      baseSalary: amount,
      performanceBonus: 0,
      addOnsTotal: 0,
      deductionsTotal: 0,
      allowancesTotal: 0,
      grossPay: amount,
      payeTax: paye.employeePaye,
      employerPayeSubsidy: 0,
      netPay,
      totalPayout: netPay,
      metricsSnapshot: metrics,
      bonusBreakdown: [],
      lineStatus: metrics.missingData ? 'NEEDS_ATTENTION' : 'OK',
      payRoleName: 'Flat rate',
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

  async loadProductTiers(
    tx: TxLike,
    groupId?: string | null,
  ): Promise<Array<{ productId: string; productName: string; tiers: Array<{ fromPct: number; toPct: number | null; ratePerOrder: number }> }>> {
    const rows = await tx
      .select()
      .from(schema.payrollProductTierConfigs)
      .where(
        and(
          eq(schema.payrollProductTierConfigs.active, true),
          or(isNull(schema.payrollProductTierConfigs.effectiveTo), gte(schema.payrollProductTierConfigs.effectiveTo, new Date())),
          // Exact company only — never fall back to null/global shared tiers.
          groupId ? eq(schema.payrollProductTierConfigs.groupId, groupId) : sql`false`,
        ),
      );

    return rows.map((r) => ({
      productId: r.productId ?? r.id,
      productName: r.productName,
      tiers: (r.tierRows as Array<{ fromPct: number; toPct?: number | null; ratePerOrder: number }>).map((t) => ({
        fromPct: t.fromPct,
        toPct: t.toPct ?? null,
        ratePerOrder: t.ratePerOrder,
      })),
    }));
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
