/**
 * PRD payroll formula engine — evaluates config-driven rules against metrics.
 * All thresholds and rates come from JSONB config, never hard-coded.
 */

import type { CommissionRules } from '../validators/hr';
import type { PayrollFormula, PayrollMetrics } from '../validators/payroll';
import { payrollAllowanceSchema } from '../validators/payroll';
import type { z } from 'zod';

type PayrollFormulaAllowance = z.infer<typeof payrollAllowanceSchema>;

export interface BonusBreakdownLine {
  label: string;
  amount: number;
  productId?: string;
  productName?: string;
}

export interface PayrollFormulaResult {
  baseSalary: number;
  performanceBonus: number;
  penalties: number;
  allowancesTotal: number;
  allowanceLines: Array<{ name: string; amount: number; taxable: boolean }>;
  bonusBreakdown: BonusBreakdownLine[];
  grossBeforeAdjustments: number;
  employerPayeSubsidyPercent: number;
  deliveryRate: number;
  teamDeliveryRate: number;
  cpa: number | null;
}

function metricValue(_formula: PayrollFormula, metrics: PayrollMetrics, metric: string): number {
  switch (metric) {
    case 'INDIVIDUAL_DR':
      return metrics.individualDr;
    case 'TEAM_DR':
      return metrics.teamDr ?? metrics.individualDr;
    case 'CPA':
      return metrics.cpa ?? 0;
    case 'TARGET_MET':
      return metrics.targetMet ? 1 : 0;
    case 'NONE':
    default:
      return 0;
  }
}

function passesCondition(
  metric: string,
  operator: 'GTE' | 'GT' | 'LTE' | 'LT' | 'EQ',
  threshold: number,
  formula: PayrollFormula,
  metrics: PayrollMetrics,
): boolean {
  const value = metric === 'NONE' ? 0 : metricValue(formula, metrics, metric);
  switch (operator) {
    case 'GTE':
      return value >= threshold;
    case 'GT':
      return value > threshold;
    case 'LTE':
      return value <= threshold;
    case 'LT':
      return value < threshold;
    case 'EQ':
      return value === threshold;
    default:
      return false;
  }
}

function resolveBaseSalary(formula: PayrollFormula, metrics: PayrollMetrics): number {
  if (formula.baseSalaryTiers?.length) {
    const sorted = [...formula.baseSalaryTiers].sort((a, b) => b.threshold - a.threshold);
    for (const tier of sorted) {
      if (passesCondition(tier.metric, tier.operator, tier.threshold, formula, metrics)) {
        return tier.amount;
      }
    }
    // No tier matched: use configured flat base (same rule as the formula builder UI).
    return formula.flatBaseSalary ?? 0;
  }
  return formula.flatBaseSalary ?? 0;
}

function resolveBonusFromTiers(
  tiers: PayrollFormula['bonusTiers'],
  metrics: PayrollMetrics,
  formula: PayrollFormula,
  deliveredCount: number,
  labelPrefix: string,
): { bonus: number; lines: BonusBreakdownLine[] } {
  if (!tiers?.length) return { bonus: 0, lines: [] };

  const floor = formula.minimumFloor;
  if (floor && !passesCondition(floor.metric, floor.operator, floor.threshold, formula, metrics)) {
    return { bonus: floor.fallbackBonus ?? 0, lines: [{ label: `${labelPrefix} (floor)`, amount: floor.fallbackBonus ?? 0 }] };
  }

  let flatBonus = 0;
  const lines: BonusBreakdownLine[] = [];

  const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
  for (const tier of sorted) {
    if (passesCondition(tier.metric, tier.operator, tier.threshold, formula, metrics)) {
      if (tier.kind === 'FLAT') {
        flatBonus = tier.amount;
        lines.push({ label: `${labelPrefix} ${tier.metric} ≥ ${tier.threshold}%`, amount: tier.amount });
      } else {
        const orderBonus = deliveredCount * tier.amount;
        lines.push({ label: `${labelPrefix} ${tier.metric} tier @ ₦${tier.amount}/order × ${deliveredCount}`, amount: orderBonus });
        return { bonus: flatBonus + orderBonus, lines };
      }
      break;
    }
  }

  if (formula.scalingRule) {
    const sr = formula.scalingRule;
    const dr = metricValue(formula, metrics, sr.metric);
    if (dr >= sr.startThreshold) {
      const steps = Math.floor((dr - sr.startThreshold) / sr.stepSize);
      const scalingBonus = sr.incrementAmount * (1 + steps);
      const capped = sr.capAmount != null ? Math.min(scalingBonus, sr.capAmount) : scalingBonus;
      flatBonus += capped;
      lines.push({ label: `${labelPrefix} scaling bonus`, amount: capped });
    }
  }

  return { bonus: flatBonus, lines };
}

function resolvePerProductBonus(
  _formula: PayrollFormula,
  metrics: PayrollMetrics,
  productTiers: Array<{ productId: string; productName: string; tiers: Array<{ fromPct: number; toPct: number | null; ratePerOrder: number }> }>,
): { bonus: number; lines: BonusBreakdownLine[] } {
  let total = 0;
  const lines: BonusBreakdownLine[] = [];

  for (const product of productTiers) {
    const count = metrics.deliveredByProduct?.[product.productId] ?? 0;
    if (count <= 0) continue;

    const dr = metrics.drByProduct?.[product.productId] ?? metrics.individualDr;
    let rate = 0;
    for (const tier of product.tiers) {
      const inRange = dr >= tier.fromPct && (tier.toPct == null || dr <= tier.toPct);
      if (inRange) rate = tier.ratePerOrder;
    }
    const amount = count * rate;
    total += amount;
    lines.push({
      label: `${product.productName} bonus`,
      amount,
      productId: product.productId,
      productName: product.productName,
    });
  }

  return { bonus: total, lines };
}

function sumAllowances(allowances: PayrollFormulaAllowance[] | undefined): {
  total: number;
  lines: Array<{ name: string; amount: number; taxable: boolean }>;
} {
  const lines = (allowances ?? []).map((a) => ({ name: a.name, amount: a.amount, taxable: a.taxable ?? true }));
  return { total: lines.reduce((s, l) => s + l.amount, 0), lines };
}

/** Evaluate PRD formula config against payroll metrics. */
export function computePayrollFormula(
  formula: PayrollFormula,
  metrics: PayrollMetrics,
  productTiers: Array<{ productId: string; productName: string; tiers: Array<{ fromPct: number; toPct: number | null; ratePerOrder: number }> }> = [],
): PayrollFormulaResult {
  const baseSalary = resolveBaseSalary(formula, metrics);
  const deliveredCount = metrics.deliveredCount;

  let performanceBonus = 0;
  const bonusBreakdown: BonusBreakdownLine[] = [];

  if (formula.perProductBonus && productTiers.length > 0) {
    const pp = resolvePerProductBonus(formula, metrics, productTiers);
    performanceBonus += pp.bonus;
    bonusBreakdown.push(...pp.lines);
  } else {
    const bb = resolveBonusFromTiers(formula.bonusTiers, metrics, formula, deliveredCount, 'Bonus');
    performanceBonus += bb.bonus;
    bonusBreakdown.push(...bb.lines);
  }

  const penalties = (formula.penaltyPerReturn ?? 0) * (metrics.returnedCount ?? 0);
  const { total: allowancesTotal, lines: allowanceLines } = sumAllowances(formula.allowances);

  const grossBeforeAdjustments = baseSalary + performanceBonus + allowancesTotal - penalties;

  let employerPayeSubsidyPercent = 0;
  if (formula.employerPayeSubsidy) {
    const sub = formula.employerPayeSubsidy;
    if (passesCondition(sub.metric, sub.operator, sub.threshold, formula, metrics)) {
      employerPayeSubsidyPercent = sub.subsidyPercent;
    }
  }

  return {
    baseSalary,
    performanceBonus,
    penalties,
    allowancesTotal,
    allowanceLines,
    bonusBreakdown,
    grossBeforeAdjustments,
    employerPayeSubsidyPercent,
    deliveryRate: metrics.individualDr,
    teamDeliveryRate: metrics.teamDr ?? metrics.individualDr,
    cpa: metrics.cpa ?? null,
  };
}

/** Convert legacy commission_plans.rules JSONB to PayrollFormula for backward compat. */
export function legacyCommissionRulesToFormula(rules: CommissionRules): PayrollFormula {
  const formula: PayrollFormula = {
    flatBaseSalary: rules.baseSalary,
    penaltyPerReturn: rules.penaltyPerReturn,
    bonusTiers: [],
    allowances: [],
  };

  if (rules.baseThreshold != null && rules.baseSalary != null) {
    formula.baseSalaryTiers = [
      { metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: rules.baseThreshold, amount: rules.baseSalary },
    ];
  }

  if (rules.orderRateTiers?.length) {
    for (const t of rules.orderRateTiers) {
      formula.bonusTiers!.push({
        metric: 'INDIVIDUAL_DR',
        operator: 'GTE',
        threshold: 0,
        kind: 'PER_ORDER',
        amount: t.ratePerOrder,
      });
    }
  } else if (rules.perOrderRate) {
    formula.bonusTiers!.push({
      metric: 'INDIVIDUAL_DR',
      operator: 'GTE',
      threshold: rules.deliveryRateThreshold ?? 0,
      kind: 'PER_ORDER',
      amount: rules.perOrderRate,
    });
  }

  if (rules.deliveryRateThreshold != null) {
    formula.minimumFloor = {
      metric: 'INDIVIDUAL_DR',
      operator: 'LT',
      threshold: rules.deliveryRateThreshold,
      fallbackBonus: 0,
    };
  }

  return formula;
}

/** Detect whether rules JSON uses new PRD schema (has version marker or baseSalaryTiers). */
export function isPayrollFormulaRules(rules: unknown): rules is PayrollFormula {
  if (!rules || typeof rules !== 'object') return false;
  const r = rules as Record<string, unknown>;
  return r.schemaVersion === 'payroll_v1' || Array.isArray(r.baseSalaryTiers) || Array.isArray(r.bonusTiers);
}

export function resolveFormulaFromRules(rules: CommissionRules | PayrollFormula): PayrollFormula {
  if (isPayrollFormulaRules(rules)) return rules;
  return legacyCommissionRulesToFormula(rules as CommissionRules);
}
