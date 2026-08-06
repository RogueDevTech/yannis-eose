import { z } from 'zod';

// ── Marketing Automation validators ──────────────────────────

export const marketingAutomationRuleKindSchema = z.enum(['EVENT', 'SEGMENT']);
export const marketingAutomationChannelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP']);

/**
 * EVENT trigger sources the engine understands. These are hooked at NON-FROZEN
 * lifecycle points (order status transitions + the cart-abandonment cron), never
 * the frozen edge-form intake path — so a raw "order created" trigger is
 * intentionally NOT offered here.
 */
export const AUTOMATION_EVENTS = [
  'order:confirmed',
  'order:delivered',
  'order:status_changed',
  'cart:abandoned',
] as const;
export const marketingAutomationEventSchema = z.enum(AUTOMATION_EVENTS);
export type MarketingAutomationEvent = (typeof AUTOMATION_EVENTS)[number];

/**
 * Typed shape the engine expects inside the rule's `trigger` jsonb. Stored as
 * open jsonb in the DB; this is what the engine parses at evaluation time.
 * - EVENT: `{ event, toStatus? }` — `toStatus` narrows a `status_changed` rule.
 * - SEGMENT: `{ segment: { statuses?, branchIds?, sinceDays? } }` audience filter.
 */
export const automationTriggerSchema = z.object({
  event: marketingAutomationEventSchema.optional(),
  /** For order:status_changed — only fire when the new status matches. */
  toStatus: z.string().optional(),
  segment: z
    .object({
      statuses: z.array(z.string()).optional(),
      branchIds: z.array(z.string().uuid()).optional(),
      /** Only orders created within the last N days. */
      sinceDays: z.number().int().min(1).max(365).optional(),
    })
    .optional(),
});
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

/**
 * Create a marketing automation rule.
 *
 * EVENT rules fire per-customer when `trigger.event` happens, optionally after
 * `delayMinutes`. SEGMENT rules broadcast to the audience defined in `trigger`,
 * on `scheduleCron` (or manually). `trigger`/`conditions` are open jsonb so the
 * rule builder can grow without a schema change; the engine validates their
 * shape at evaluation time.
 */
export const createMarketingAutomationRuleSchema = z
  .object({
    name: z.string().min(2).max(200),
    kind: marketingAutomationRuleKindSchema,
    /** One or more channels this rule sends on. At least one is required. */
    channels: z.array(marketingAutomationChannelSchema).min(1, 'Pick at least one channel').max(3),
    templateId: z.string().uuid().optional(),
    trigger: z.record(z.string(), z.unknown()).default({}),
    conditions: z.record(z.string(), z.unknown()).optional(),
    /** EVENT only: minutes to wait before sending. Omit for immediate. */
    delayMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
    /** SEGMENT only: cron for the recurring broadcast. Omit for manual-only. */
    scheduleCron: z.string().max(120).optional(),
    respectOptOut: z.boolean().default(true),
    priority: z.number().int().min(0).max(1_000_000).default(0),
    enabled: z.boolean().default(true),
    sourceBranchId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => d.kind !== 'SEGMENT' || d.delayMinutes == null, {
    message: 'delayMinutes applies to EVENT rules only.',
    path: ['delayMinutes'],
  })
  .refine((d) => d.kind !== 'EVENT' || d.scheduleCron == null, {
    message: 'scheduleCron applies to SEGMENT rules only.',
    path: ['scheduleCron'],
  });
export type CreateMarketingAutomationRuleInput = z.infer<typeof createMarketingAutomationRuleSchema>;

export const listMarketingAutomationRulesSchema = z
  .object({
    kind: marketingAutomationRuleKindSchema.optional(),
    enabledOnly: z.boolean().optional(),
  })
  .optional();
export type ListMarketingAutomationRulesInput = z.infer<typeof listMarketingAutomationRulesSchema>;

/** Edit an existing rule. All content fields optional; `ruleId` identifies it. */
export const updateMarketingAutomationRuleSchema = z.object({
  ruleId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  channels: z.array(marketingAutomationChannelSchema).min(1).max(3).optional(),
  templateId: z.string().uuid().nullable().optional(),
  trigger: z.record(z.string(), z.unknown()).optional(),
  conditions: z.record(z.string(), z.unknown()).nullable().optional(),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable().optional(),
  scheduleCron: z.string().max(120).nullable().optional(),
  respectOptOut: z.boolean().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
  sourceBranchId: z.string().uuid().nullable().optional(),
});
export type UpdateMarketingAutomationRuleInput = z.infer<typeof updateMarketingAutomationRuleSchema>;

export const automationRuleIdSchema = z.object({ ruleId: z.string().uuid() });
export type AutomationRuleIdInput = z.infer<typeof automationRuleIdSchema>;

export const toggleMarketingAutomationRuleSchema = z.object({
  ruleId: z.string().uuid(),
  enabled: z.boolean(),
});
export type ToggleMarketingAutomationRuleInput = z.infer<typeof toggleMarketingAutomationRuleSchema>;

/** Send a one-off test message for a rule to a specific address/phone, bypassing audience resolution. */
export const testMarketingAutomationRuleSchema = z.object({
  ruleId: z.string().uuid(),
  channel: marketingAutomationChannelSchema,
  /** Email address or E.164 phone, depending on channel. */
  to: z.string().min(3).max(320),
  /** Optional order id to render placeholders from; falses back to sample data. */
  sampleOrderId: z.string().uuid().optional(),
});
export type TestMarketingAutomationRuleInput = z.infer<typeof testMarketingAutomationRuleSchema>;
