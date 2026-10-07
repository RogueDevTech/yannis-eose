import { z } from 'zod';

/**
 * Duplicate rules — one per-company `system_settings` row (key below) that
 * switches every duplicate rule on the order pipeline. CEO request 2026-10-07.
 *
 * The defaults ARE today's hard-coded behaviour, so a company with no row (or a
 * corrupt row) runs exactly as before. Every read goes through
 * `resolveDuplicateRules`, which never throws: a settings problem must never be
 * the reason an order fails or a cron stops.
 */
export const DUPLICATE_RULES_SETTING_KEY = 'DUPLICATE_RULES' as const;

const windowDays = z.number().int().min(1).max(90);

export const duplicateRulesSchema = z.object({
  /** Public order form: same phone + product inside the window. */
  intakeBlock: z.object({
    /** BLOCK = no order, recorded in Cross-funnel. FLAG = order created + flagged. OFF = no check. */
    mode: z.enum(['BLOCK', 'FLAG', 'OFF']),
    windowDays,
  }),
  /** Public order form: same phone + form resubmitted inside the window returns the first order. */
  doubleSubmitGuard: z.object({
    enabled: z.boolean(),
    windowMinutes: z.number().int().min(1).max(60),
  }),
  /** CS-created orders (offline, delivered follow-up, cart recovery). */
  manualOrderBlock: z.object({
    mode: z.enum(['BLOCK', 'OFF']),
    windowDays,
  }),
  /** 2-hour cleanup cron over the orders table. */
  cleanupCron: z.object({
    /** DELETE = early-stage deleted, later flagged. FLAG = flag only. OFF = cron skips duplicates. */
    mode: z.enum(['DELETE', 'FLAG', 'OFF']),
    windowDays,
  }),
  /** Abandoned cart → cart order pull: skip carts whose customer already ordered. */
  cartPullGuard: z.object({
    enabled: z.boolean(),
    windowDays,
  }),
  /** Cart orders that match a real order. */
  cartReconcile: z.object({
    mode: z.enum(['DELETE', 'FLAG', 'OFF']),
  }),
  /** Older open carts for the same phone are removed so one customer has one cart. */
  cartMerge: z.object({
    enabled: z.boolean(),
  }),
  /** Cart / follow-up order cannot be marked DELIVERED when a matching delivery exists. */
  preDeliveryCheck: z.object({
    mode: z.enum(['BLOCK', 'OFF']),
    windowDays,
  }),
  /** Delivered cart / follow-up order is not copied into orders when a matching order exists. */
  graduationGuard: z.object({
    enabled: z.boolean(),
    windowDays,
  }),
});

export type DuplicateRules = z.infer<typeof duplicateRulesSchema>;
export type DuplicateRuleKey = keyof DuplicateRules;

/** Today's behaviour. Changing a value here changes production for every company without a row. */
export const DEFAULT_DUPLICATE_RULES: DuplicateRules = {
  intakeBlock: { mode: 'BLOCK', windowDays: 14 },
  doubleSubmitGuard: { enabled: true, windowMinutes: 2 },
  manualOrderBlock: { mode: 'BLOCK', windowDays: 14 },
  cleanupCron: { mode: 'DELETE', windowDays: 14 },
  cartPullGuard: { enabled: true, windowDays: 14 },
  cartReconcile: { mode: 'DELETE' },
  cartMerge: { enabled: true },
  preDeliveryCheck: { mode: 'BLOCK', windowDays: 14 },
  graduationGuard: { enabled: true, windowDays: 14 },
};

/**
 * Merge a stored value over the defaults, rule by rule. A rule whose stored
 * shape is invalid falls back to its default instead of failing the whole
 * config, so one bad field can never switch the other rules. Never throws.
 */
export function resolveDuplicateRules(raw: unknown): DuplicateRules {
  const out = JSON.parse(JSON.stringify(DEFAULT_DUPLICATE_RULES)) as DuplicateRules;
  if (!raw || typeof raw !== 'object') return out;
  const stored = raw as Record<string, unknown>;
  const shape = duplicateRulesSchema.shape;
  for (const key of Object.keys(shape) as DuplicateRuleKey[]) {
    const value = stored[key];
    if (!value || typeof value !== 'object') continue;
    const merged = { ...out[key], ...(value as Record<string, unknown>) };
    const parsed = shape[key].safeParse(merged);
    if (parsed.success) (out as Record<DuplicateRuleKey, unknown>)[key] = parsed.data;
  }
  return out;
}

export const updateDuplicateRulesSchema = duplicateRulesSchema;
