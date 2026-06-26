import { z } from 'zod';

// ── Cart Order List ──────────────────────────────────────────────────

export const listCartOrdersSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(2000).optional().default(50),
  status: z.string().optional(),
  statuses: z.array(z.string()).optional(),
  assignedCsId: z.string().uuid().optional(),
  mediaBuyerId: z.string().uuid().optional(),
  unassignedOnly: z.boolean().optional(),
  branchId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'orderNumber', 'status']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  showDeleted: z.boolean().optional(),
});

export const cartOrderDetailSchema = z.object({
  id: z.string().uuid(),
});

// ── Cart Order Assignment ────────────────────────────────────────────

export const assignCartOrderSchema = z.object({
  orderId: z.string().uuid(),
  closerId: z.string().uuid(),
});

export const bulkAssignCartOrdersSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  closerIds: z.array(z.string().uuid()).min(1).max(50),
});

// ── Cart Order Status Transition ─────────────────────────────────────

export const transitionCartOrderSchema = z.object({
  orderId: z.string().uuid(),
  newStatus: z.string(),
  note: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Types ────────────────────────────────────────────────────────────

export type ListCartOrdersInput = z.infer<typeof listCartOrdersSchema>;
export type AssignCartOrderInput = z.infer<typeof assignCartOrderSchema>;
export type BulkAssignCartOrdersInput = z.infer<typeof bulkAssignCartOrdersSchema>;
export type TransitionCartOrderInput = z.infer<typeof transitionCartOrderSchema>;

// ── Cart Order Update ───────────────────────────────────────────────

export const updateCartOrderSchema = z.object({
  orderId: z.string().uuid(),
  customerName: z.string().min(1).max(255).optional(),
  deliveryAddress: z.string().optional().nullable(),
  deliveryState: z.string().max(100).optional().nullable(),
  deliveryNotes: z.string().optional().nullable(),
  customerEmail: z.string().email().max(255).optional().nullable(),
  preferredDeliveryDate: z.string().max(100).optional().nullable(),
});

export type UpdateCartOrderInput = z.infer<typeof updateCartOrderSchema>;

// ── Cart Order Routing Rules ────────────────────────────────────────

export const createCartOrderRoutingRuleSchema = z.object({
  name: z.string().min(1).max(200),
  sourceBranchId: z.string().uuid().nullable().optional(),
  targetBranchId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
});

export const updateCartOrderRoutingRuleSchema = z.object({
  ruleId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  sourceBranchId: z.string().uuid().nullable().optional(),
  targetBranchId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
  enabled: z.boolean().optional(),
});

export const deleteCartOrderRoutingRuleSchema = z.object({
  ruleId: z.string().uuid(),
});

export const listCartOrderRoutingRulesSchema = z.object({
  enabledOnly: z.boolean().optional(),
});

export const listCartOrderSyncLogsSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(200).optional().default(50),
});

export type CreateCartOrderRoutingRuleInput = z.infer<typeof createCartOrderRoutingRuleSchema>;
export type UpdateCartOrderRoutingRuleInput = z.infer<typeof updateCartOrderRoutingRuleSchema>;
export type ListCartOrderRoutingRulesInput = z.infer<typeof listCartOrderRoutingRulesSchema>;
