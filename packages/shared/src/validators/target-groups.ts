import { z } from 'zod';

// ── Target Groups validators ─────────────────────────────────

export const targetGroupSourceKindSchema = z.enum(['RULE', 'UPLOAD', 'MANUAL']);

/**
 * Filter for a RULE group. All fields optional; a member must satisfy every set
 * filter (AND). `minOrders`/`maxOrders` bound the customer's lifetime order count;
 * `statuses` limits which order states count; `sinceDays` restricts to customers
 * who ordered within the window; `orderSource` filters by intake channel.
 */
export const targetGroupFilterSchema = z.object({
  minOrders: z.number().int().min(1).max(10_000).optional(),
  maxOrders: z.number().int().min(1).max(10_000).optional(),
  statuses: z.array(z.string()).optional(),
  branchIds: z.array(z.string().uuid()).optional(),
  sinceDays: z.number().int().min(1).max(3650).optional(),
  orderSource: z.enum(['edge-form', 'offline', 'any']).optional(),
});
export type TargetGroupFilter = z.infer<typeof targetGroupFilterSchema>;

export const createTargetGroupSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  sourceKind: targetGroupSourceKindSchema.default('RULE'),
  filter: targetGroupFilterSchema.default({}),
  enabled: z.boolean().default(true),
});
export type CreateTargetGroupInput = z.infer<typeof createTargetGroupSchema>;

export const updateTargetGroupSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  filter: targetGroupFilterSchema.optional(),
  enabled: z.boolean().optional(),
});
export type UpdateTargetGroupInput = z.infer<typeof updateTargetGroupSchema>;

export const listTargetGroupsSchema = z
  .object({
    includeDisabled: z.boolean().optional(),
  })
  .optional();
export type ListTargetGroupsInput = z.infer<typeof listTargetGroupsSchema>;

export const targetGroupIdSchema = z.object({ groupId: z.string().uuid() });
export type TargetGroupIdInput = z.infer<typeof targetGroupIdSchema>;

export const listTargetGroupMembersSchema = z.object({
  groupId: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export type ListTargetGroupMembersInput = z.infer<typeof listTargetGroupMembersSchema>;

/**
 * Import a single member row (CSV/Excel upload, one POST per row). The server
 * hashes the phone and stores only the hash + name/email — raw phone is never
 * persisted (Lead Fortress). At least a phone or an email is required.
 */
export const importTargetGroupMemberSchema = z
  .object({
    groupId: z.string().uuid(),
    name: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(320).optional(),
  })
  .refine((d) => !!(d.phone?.trim() || d.email?.trim()), {
    message: 'Each member needs a phone or an email.',
    path: ['phone'],
  });
export type ImportTargetGroupMemberInput = z.infer<typeof importTargetGroupMemberSchema>;
