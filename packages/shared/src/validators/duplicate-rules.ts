import { z } from 'zod';

/**
 * Duplicate rules — one per-company `system_settings` row (key below) that
 * switches every duplicate rule on the order pipeline. CEO request 2026-10-07.
 *
 * DEFAULTS ARE ALL OFF (owner decision 2026-10-07, CEO: "capture every
 * legitimate order first"): a company with no saved row, or a corrupt row, runs
 * with no duplicate rules. The double-tap guard (same phone + form within 2
 * minutes returns the first order) is NOT here: it is always on, not a setting. The windows keep their old values so switching a rule
 * on restores the previous behaviour. Every read goes through
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

/**
 * Every rule off. Changing a value here changes production for every company
 * without a saved row. The previous hard-coded behaviour was: intakeBlock BLOCK,
 * manualOrderBlock BLOCK, cleanupCron DELETE, cartPullGuard
 * on, cartReconcile DELETE, cartMerge on, preDeliveryCheck BLOCK,
 * graduationGuard on (windows as below).
 */
export const DEFAULT_DUPLICATE_RULES: DuplicateRules = {
  intakeBlock: { mode: 'OFF', windowDays: 14 },
  manualOrderBlock: { mode: 'OFF', windowDays: 14 },
  cleanupCron: { mode: 'OFF', windowDays: 14 },
  cartPullGuard: { enabled: false, windowDays: 14 },
  cartReconcile: { mode: 'OFF' },
  cartMerge: { enabled: false },
  preDeliveryCheck: { mode: 'OFF', windowDays: 14 },
  graduationGuard: { enabled: false, windowDays: 14 },
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
