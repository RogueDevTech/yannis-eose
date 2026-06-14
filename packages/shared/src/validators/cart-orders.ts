import { z } from 'zod';

// ── Cart Order List ──────────────────────────────────────────────────

export const listCartOrdersSchema = z.object({
  page: z.number().int().min(1).optional().default(1),
  limit: z.number().int().min(1).max(2000).optional().default(50),
  status: z.string().optional(),
  statuses: z.array(z.string()).optional(),
  assignedCsId: z.string().uuid().optional(),
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
