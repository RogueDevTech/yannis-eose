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
    case 'DELIVERED_COUNT':
      return metrics.deliveredCount ?? 0;
    case 'QUALIFYING_REVENUE':
      return metrics.qualifyingRevenue ?? 0;
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

/**
 * A tier matches only when its primary condition AND every extra condition pass.
 * Extra conditions (optional) are ANDed with the primary one, e.g. a tier that
 * requires `DR% >= 85` AND `CPA < 1000`. Tiers with no `extraConditions` behave
 * exactly as a single-condition tier (backward compatible).
 */
function tierMatches(
  tier: {
    metric: string;
    operator: 'GTE' | 'GT' | 'LTE' | 'LT' | 'EQ';
    threshold: number;
    extraConditions?: Array<{ metric: string; operator: 'GTE' | 'GT' | 'LTE' | 'LT' | 'EQ'; threshold: number }>;
  },
  formula: PayrollFormula,
  metrics: PayrollMetrics,
): boolean {
  if (!passesCondition(tier.metric, tier.operator, tier.threshold, formula, metrics)) return false;
  for (const cond of tier.extraConditions ?? []) {
    if (!passesCondition(cond.metric, cond.operator, cond.threshold, formula, metrics)) return false;
  }
  return true;
}

/** Human-readable summary of a tier's conditions for breakdown labels. */
function tierConditionLabel(tier: {
  metric: string;
  operator: 'GTE' | 'GT' | 'LTE' | 'LT' | 'EQ';
  threshold: number;
  extraConditions?: Array<{ metric: string; operator: 'GTE' | 'GT' | 'LTE' | 'LT' | 'EQ'; threshold: number }>;
}): string {
  const opSym: Record<string, string> = { GTE: '≥', GT: '>', LTE: '≤', LT: '<', EQ: '=' };
  const parts = [`${tier.metric} ${opSym[tier.operator] ?? tier.operator} ${tier.threshold}`];
  for (const c of tier.extraConditions ?? []) {
    parts.push(`${c.metric} ${opSym[c.operator] ?? c.operator} ${c.threshold}`);
  }
  return parts.join(' & ');
}

function resolveBaseSalary(formula: PayrollFormula, metrics: PayrollMetrics): number {
  const flatBase = Number(formula.flatBaseSalary ?? formula.flatMonthlyAmount ?? 0) || 0;
  if (formula.baseSalaryTiers?.length) {
    const sorted = [...formula.baseSalaryTiers].sort((a, b) => Number(b.threshold) - Number(a.threshold));
    for (const tier of sorted) {
      if (tierMatches(tier, formula, metrics)) {
        return Number(tier.amount) || 0;
      }
    }
    // No tier matched: use configured flat base (same rule as the formula builder UI).
    return flatBase;
  }
  return flatBase;
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
    if (tierMatches(tier, formula, metrics)) {
      if (tier.kind === 'FLAT') {
        flatBonus = tier.amount;
        lines.push({ label: `${labelPrefix} ${tierConditionLabel(tier)}`, amount: tier.amount });
      } else {
        const orderBonus = deliveredCount * tier.amount;
        lines.push({ label: `${labelPrefix} ${tierConditionLabel(tier)} @ ₦${tier.amount}/order × ${deliveredCount}`, amount: orderBonus });
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

function sumAllowances(allowances: PayrollFormulaAllowance[] | undefined): {
  total: number;
  lines: Array<{ name: string; amount: number; taxable: boolean }>;
} {
  const lines = (allowances ?? []).map((a) => ({ name: a.name, amount: a.amount, taxable: a.taxable ?? true }));
  return { total: lines.reduce((s, l) => s + l.amount, 0), lines };
}

export interface FormulaValidationResult {
  /** Blocking problems — the formula should not be saved. */
  errors: string[];
  /** Non-blocking concerns (e.g. ambiguous overlaps) — save allowed. */
  warnings: string[];
}

/** DR-style metrics are percentages (0–100); CPA/DELIVERED_COUNT are counts. */
function isPercentMetric(metric: string): boolean {
  return metric === 'INDIVIDUAL_DR' || metric === 'TEAM_DR';
}

/**
 * Semantic validation of a payroll formula BEFORE saving (requirement #11).
 * Zod already enforces types/ranges; this catches logical problems the schema
 * can't: bad thresholds for the metric, operator/metric mismatches, conflicting
 * or overlapping tiers, and per-order tiers with no delivered-count basis.
 */
export function validatePayrollFormula(formula: PayrollFormula): FormulaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const checkTier = (
    t: { metric: string; operator: string; threshold: number; kind?: string; amount?: number },
    label: string,
  ) => {
    // Threshold sanity.
    if (!Number.isFinite(t.threshold) || t.threshold < 0) {
      errors.push(`${label}: threshold must be a number ≥ 0.`);
    } else if (isPercentMetric(t.metric) && t.threshold > 100) {
      errors.push(`${label}: ${t.metric} is a percentage — threshold ${t.threshold} cannot exceed 100.`);
    }
    // Operator / metric compatibility.
    if (t.metric === 'TARGET_MET' && !['EQ', 'GTE', 'GT'].includes(t.operator)) {
      warnings.push(`${label}: "Target met" is yes/no — "at least / exactly" reads clearer than ${t.operator}.`);
    }
    if (t.metric === 'NONE' && (t.operator !== 'GTE' || t.threshold !== 0)) {
      warnings.push(`${label}: a "None (flat)" tier ignores its operator/threshold — it always applies.`);
    }
    // Per-order amount sanity.
    if (t.kind === 'PER_ORDER' && (t.amount ?? 0) <= 0) {
      errors.push(`${label}: per-order tiers need a rate greater than ₦0.`);
    }
  };

  (formula.baseSalaryTiers ?? []).forEach((t, i) => checkTier(t, `Base tier ${i + 1}`));
  (formula.bonusTiers ?? []).forEach((t, i) => checkTier(t, `Bonus tier ${i + 1}`));

  // Duplicate detection within the bonus tiers. Two tiers are duplicates only
  // when their ENTIRE condition set matches — the primary condition AND every
  // extra (ANDed) condition. Tiers that share a primary condition but differ in
  // their extraConditions are DISTINCT valid rules (e.g. both "INDIVIDUAL_DR >=
  // 34.5" but one also requires "TEAM_DR >= 40"), so they must not be flagged.
  // extraConditions are compared order-independently.
  const condSig = (c: { metric: string; operator: string; threshold: number }) =>
    `${c.metric}:${c.operator}:${c.threshold}`;
  const tierSignature = (t: {
    metric: string;
    operator: string;
    threshold: number;
    extraConditions?: Array<{ metric: string; operator: string; threshold: number }>;
  }): string => {
    const extras = (t.extraConditions ?? []).map(condSig).sort();
    return [condSig(t), ...extras].join(' & ');
  };

  const bonusTiers = formula.bonusTiers ?? [];
  for (let a = 0; a < bonusTiers.length; a++) {
    const x = bonusTiers[a]!;
    if (x.metric === 'NONE') continue;
    for (let b = a + 1; b < bonusTiers.length; b++) {
      const y = bonusTiers[b]!;
      if (y.metric === 'NONE') continue;
      if (tierSignature(x) === tierSignature(y)) {
        errors.push(
          `Bonus tiers ${a + 1} and ${b + 1} use the same conditions (${tierConditionLabel(x)}) — duplicate/conflicting rules.`,
        );
      }
    }
  }

  // A per-order bonus tier requires a delivered-order count to multiply against.
  const hasPerOrderBonus = (formula.bonusTiers ?? []).some((t) => t.kind === 'PER_ORDER');
  if (hasPerOrderBonus) {
    warnings.push('Per-order bonus configured: staff without a delivered-order count will earn ₦0 bonus.');
  }

  return { errors, warnings };
}

/**
 * Evaluate PRD formula config against payroll metrics.
 *
 * Bonuses are always resolved from role-level `bonusTiers`. The former
 * per-product bonus path (keyed on individual product delivery counts) was
 * removed — bonus configuration is role/department level only.
 */
export function computePayrollFormula(
  formula: PayrollFormula,
  metrics: PayrollMetrics,
): PayrollFormulaResult {
  const baseSalary = resolveBaseSalary(formula, metrics);
  const deliveredCount = metrics.deliveredCount;

  const bonusBreakdown: BonusBreakdownLine[] = [];
  const bb = resolveBonusFromTiers(formula.bonusTiers, metrics, formula, deliveredCount, 'Bonus');
  const performanceBonus = bb.bonus;
  bonusBreakdown.push(...bb.lines);

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
