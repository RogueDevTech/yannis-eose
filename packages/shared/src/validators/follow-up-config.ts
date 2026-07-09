import { z } from 'zod';

// ── Follow-Up Rule CRUD ──────────────────────────────────────────────

/** Valid source statuses for follow-up rules — only statuses where orders can go stale. */
export const followUpRuleSourceStatuses = [
  // CART_ABANDONMENT removed — cart orders now have a standalone pipeline (cart-orders module).
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'REMITTED',
] as const;

/** Which timestamp the age threshold is measured from. */
export const ageRelativeToOptions = [
  'STATUS_TIMESTAMP',
  'CREATED_AT',
  'PREFERRED_DELIVERY_DATE',
] as const;

export const createFollowUpRuleSchema = z
  .object({
    name: z.string().min(1).max(200),
    sourceStatus: z.enum(followUpRuleSourceStatuses),
    ageThresholdDays: z.number().int().min(1).max(365),
    ageThresholdHours: z.number().int().min(1).max(8760).nullable().optional(),
    maxAgeDays: z.number().int().min(1).max(365).nullable().optional(),
    ageRelativeTo: z.enum(ageRelativeToOptions).optional(),
    sourceBranchId: z.string().uuid().nullable().optional(),
    targetBranchId: z.string().uuid().nullable().optional(),
    targetGroupId: z.string().uuid().nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    priority: z.number().int().min(0).max(1_000_000).optional(),
    enabled: z.boolean().optional(),
    freezeOriginal: z.boolean().optional(),
  })
  .refine(
    (d) =>
      // Both null = All branches (round-robin). One set = specific target. Both set = invalid.
      !(d.targetBranchId != null && d.targetGroupId != null),
    { message: 'Cannot set both targetBranchId and targetGroupId' },
  );

export const updateFollowUpRuleSchema = z
  .object({
    ruleId: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    sourceStatus: z.enum(followUpRuleSourceStatuses).optional(),
    ageThresholdDays: z.number().int().min(1).max(365).optional(),
    ageThresholdHours: z.number().int().min(1).max(8760).nullable().optional(),
    maxAgeDays: z.number().int().min(1).max(365).nullable().optional(),
    ageRelativeTo: z.enum(ageRelativeToOptions).optional(),
    sourceBranchId: z.string().uuid().nullable().optional(),
    targetBranchId: z.string().uuid().nullable().optional(),
    targetGroupId: z.string().uuid().nullable().optional(),
    teamId: z.string().uuid().nullable().optional(),
    priority: z.number().int().min(0).max(1_000_000).optional(),
    enabled: z.boolean().optional(),
    freezeOriginal: z.boolean().optional(),
  })
  .refine(
    (d) => {
      // Both set = invalid. Both null or one set = fine.
      if (d.targetBranchId != null && d.targetGroupId != null) return false;
      return true;
    },
    { message: 'Cannot set both targetBranchId and targetGroupId' },
  );

export const deleteFollowUpRuleSchema = z.object({
  ruleId: z.string().uuid(),
});

export const listFollowUpRulesSchema = z.object({
  enabledOnly: z.boolean().optional(),
});

// ── Follow-Up Sync ───────────────────────────────────────────────────

export const listFollowUpSyncLogsSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

// ── Follow-Up Orders ─────────────────────────────────────────────────

export const listFollowUpOrdersSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(2000).optional().default(50),
  status: z.string().optional(),
  statuses: z.array(z.string()).optional(),
  assignedCsId: z.string().uuid().optional(),
  unassignedOnly: z.boolean().optional(),
  branchId: z.string().uuid().optional(),
  search: z.string().optional(),
  ruleId: z.string().uuid().optional(),
  sortBy: z.enum(['createdAt', 'orderNumber', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  /** When true, show only soft-deleted follow-up orders (unfrozen originals). */
  showDeleted: z.boolean().optional(),
});

export const followUpOrderDetailSchema = z.object({
  id: z.string().uuid(),
});

export const assignFollowUpOrderSchema = z.object({
  orderId: z.string().uuid(),
  closerId: z.string().uuid(),
  /** When true, skip the same-closer warning and assign anyway. */
  force: z.boolean().optional(),
});

export const bulkAssignFollowUpOrdersSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  closerIds: z.array(z.string().uuid()).min(1).max(50),
});

export const transitionFollowUpOrderSchema = z.object({
  orderId: z.string().uuid(),
  newStatus: z.string(),
  note: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateFollowUpRuleInput = z.infer<typeof createFollowUpRuleSchema>;
export type UpdateFollowUpRuleInput = z.infer<typeof updateFollowUpRuleSchema>;
export type ListFollowUpOrdersInput = z.infer<typeof listFollowUpOrdersSchema>;
