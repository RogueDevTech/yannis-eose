import { z } from 'zod';

// ── Marketing Automation validators ──────────────────────────

export const marketingAutomationRuleKindSchema = z.enum(['EVENT', 'SEGMENT']);
export const marketingAutomationChannelSchema = z.enum(['EMAIL', 'SMS', 'WHATSAPP']);

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
