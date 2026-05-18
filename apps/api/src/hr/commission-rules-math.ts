import {
  commissionRulesSchema,
  computeOrderAttributedCommission,
  type CommissionRules,
} from '@yannis/shared';

export function computeEarningsFromPlanRules(
  planRules: unknown,
  metrics: { deliveredCount: number; totalOrders: number; returnedCount: number },
): ReturnType<typeof computeOrderAttributedCommission> {
  const parsed = commissionRulesSchema.safeParse(planRules);
  const rules: CommissionRules = parsed.success ? parsed.data : {};
  return computeOrderAttributedCommission(rules, metrics);
}

/** Clawbacks prefer explicit penalty; else flat per-order rate; else top tier marginal rate when tiered only. */
export function resolveClawbackPerReturnAmount(planRules: unknown): number {
  const parsed = commissionRulesSchema.safeParse(planRules);
  if (!parsed.success) return 0;
  const r = parsed.data;
  if (r.penaltyPerReturn != null && r.penaltyPerReturn > 0) return r.penaltyPerReturn;
  if (r.perOrderRate != null && r.perOrderRate > 0) return r.perOrderRate;
  if (r.orderRateTiers?.length) {
    return Math.max(0, ...r.orderRateTiers.map((t) => t.ratePerOrder));
  }
  return 0;
}
