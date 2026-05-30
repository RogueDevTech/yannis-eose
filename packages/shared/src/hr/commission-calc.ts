/**
 * Pure commission math for payroll / previews / clawbacks.
 * Rules come from JSONB (`commission_plans.rules`) validated by commissionRulesSchema.
 */

import type { CommissionRules } from '../validators/hr';

export interface OrderAttributedCommissionMetrics {
  deliveredCount: number;
  totalOrders: number;
  returnedCount: number;
  /**
   * Orders created in the period that have since reached DELIVERED/REMITTED.
   * Used as the rate numerator so `deliveryRate` is bounded by 100% — the
   * pay-out count (`deliveredCount`, by `deliveredAt`) crosses period
   * boundaries and would otherwise push the rate past 100%, spuriously
   * tripping `deliveryRateThreshold` bonus gates.
   * Optional for back-compat — when omitted, falls back to `deliveredCount`.
   */
  deliveredCohortCount?: number;
}

function marginalPerOrderCommissionDelivered(deliveredCount: number, tiers: NonNullable<CommissionRules['orderRateTiers']>): number {
  if (deliveredCount <= 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.fromOrder - b.fromOrder || (a.ratePerOrder - b.ratePerOrder));
  let total = 0;
  for (let i = 1; i <= deliveredCount; i += 1) {
    let rate = 0;
    // Last matching tier wins if ranges overlap — explicit ranges encouraged in UI copy.
    for (const t of sorted) {
      if (i < t.fromOrder) continue;
      if (t.toOrder != null && i > t.toOrder) continue;
      rate = t.ratePerOrder;
    }
    total += rate;
  }
  return total;
}

/**
 * Mirrors legacy payout math plus optional tiered order rates + delivery bonus multiplier clamps.
 */
export function computeOrderAttributedCommission(
  rules: CommissionRules,
  metrics: OrderAttributedCommissionMetrics,
): {
  baseSalary: number;
  performanceBonus: number;
  penalties: number;
  deliveryRate: number;
} {
  const deliveredCount = metrics.deliveredCount;
  const totalOrders = metrics.totalOrders;
  const returnedCount = metrics.returnedCount;
  // Rate uses the cohort numerator so it's bounded by 100% — see field doc.
  const deliveredForRate = metrics.deliveredCohortCount ?? deliveredCount;
  const deliveryRate = totalOrders > 0 ? (deliveredForRate / totalOrders) * 100 : 0;

  let baseSalary = 0;
  if (rules.baseThreshold != null && rules.baseThreshold > 0) {
    if (deliveredCount >= rules.baseThreshold) {
      baseSalary = rules.baseSalary ?? 0;
    }
  } else if (rules.baseSalary != null && rules.baseSalary > 0) {
    // Fixed base with no gate (e.g. monthly stipend)
    baseSalary = rules.baseSalary;
  }

  let performanceBonus = 0;
  if (rules.orderRateTiers && rules.orderRateTiers.length > 0) {
    performanceBonus += marginalPerOrderCommissionDelivered(deliveredCount, rules.orderRateTiers);
  } else if (rules.perOrderRate) {
    performanceBonus += deliveredCount * rules.perOrderRate;
  }

  if (rules.bonusPerExtraOrder && rules.baseThreshold != null && deliveredCount > rules.baseThreshold) {
    performanceBonus += (deliveredCount - rules.baseThreshold) * rules.bonusPerExtraOrder;
  }

  const deliveryMultiplier = rules.deliveryRateBonusMultiplier ?? 0.5;
  if (
    rules.deliveryRateThreshold != null &&
    deliveryRate > rules.deliveryRateThreshold &&
    rules.bonusPerExtraOrder
  ) {
    const extraOrders = Math.max(0, deliveredCount - (rules.baseThreshold ?? 0));
    performanceBonus += extraOrders * (rules.bonusPerExtraOrder * deliveryMultiplier);
  }

  if (rules.minPerformanceBonus != null) {
    performanceBonus = Math.max(performanceBonus, rules.minPerformanceBonus);
  }
  if (rules.maxPerformanceBonus != null) {
    performanceBonus = Math.min(performanceBonus, rules.maxPerformanceBonus);
  }

  const penalties = (rules.penaltyPerReturn ?? 0) * returnedCount;

  return { baseSalary, performanceBonus, penalties, deliveryRate };
}
