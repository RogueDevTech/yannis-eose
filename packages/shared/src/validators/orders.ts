import { z } from 'zod';

// ============================================
// Order Input Validators
// ============================================

/**
 * All 13 order statuses.
 */
export const orderStatusSchema = z.enum([
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'CANCELLED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  'COMPLETED',
]);

export type OrderStatusInput = z.infer<typeof orderStatusSchema>;

/**
 * Order item — line item for an order.
 */
export const orderItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1),
  unitPrice: z.coerce.number().min(0).multipleOf(0.01),
  offerLabel: z.string().max(100).optional(),
});

/**
 * Reserved system actor ID for Edge Form order creation.
 * Stored in audit trail to distinguish from generic "System" (null) and other actors.
 */
export const EDGE_FORM_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Reserved system actor ID for cron and automated actions (e.g. lock release, cart mark abandoned).
 * Stored in audit trail so automated writes are distinguishable from user actions.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000002';

/**
 * Create order — used by Edge Worker or admin manual entry.
 * Phone number comes pre-hashed from the Edge Worker.
 * When source is 'edge-form', the audit trail uses EDGE_FORM_ACTOR_ID for traceability.
 */
export const createOrderSchema = z.object({
  campaignId: z.string().uuid().optional(),
  mediaBuyerId: z.string().uuid().optional(),
  customerName: z.string().min(2, 'Customer name is required'),
  customerPhoneHash: z.string().min(1, 'Phone hash is required'),
  /** Raw phone for manual-call reveal when VOIP is off. Sent by Edge on create only; never exposed except via reveal endpoint. */
  customerPhone: z.string().max(50).optional(),
  customerAddress: z.string().optional(),
  deliveryAddress: z.string().optional(),
  deliveryNotes: z.string().optional(),
  deliveryState: z.string().max(100).optional(),
  customerGender: z.enum(['male', 'female']).optional(),
  preferredDeliveryDate: z.string().max(100).optional(),
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
  totalAmount: z.coerce.number().min(0).multipleOf(0.01).optional(),
  /** Payment method: PAY_ON_DELIVERY (default) or PAY_ONLINE (requires customerEmail for Paystack) */
  paymentMethod: z.enum(['PAY_ON_DELIVERY', 'PAY_ONLINE']).optional(),
  /** Required when paymentMethod is PAY_ONLINE (for Paystack receipt and initialize) */
  customerEmail: z.string().email().max(255).optional(),
  /** Set by Edge Worker to identify order source in audit trail */
  source: z.enum(['edge-form']).optional(),
  /** Cart ID from prior cart save — marks cart as CONVERTED when order created */
  cartId: z.string().uuid().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * Create offline order — used by CS agent or Head of CS.
 * Accepts raw customerPhone; API hashes it server-side. Creator is set as assignee (no auto-dispatch).
 */
export const createOfflineOrderSchema = z.object({
  campaignId: z.string().uuid().optional(),
  mediaBuyerId: z.string().uuid().optional(),
  customerName: z.string().min(2, 'Customer name is required'),
  /** Raw phone — API hashes server-side; never send pre-hashed from CS UI */
  customerPhone: z.string().min(1, 'Customer phone is required').max(50),
  customerAddress: z.string().optional(),
  deliveryAddress: z.string().optional(),
  deliveryNotes: z.string().optional(),
  deliveryState: z.string().max(100).optional(),
  customerGender: z.enum(['male', 'female']).optional(),
  preferredDeliveryDate: z.string().max(100).optional(),
  items: z.array(orderItemSchema).min(1, 'At least one item is required'),
  totalAmount: z.coerce.number().min(0).multipleOf(0.01).optional(),
  paymentMethod: z.enum(['PAY_ON_DELIVERY', 'PAY_ONLINE']).optional(),
  customerEmail: z.string().email().max(255).optional(),
});

export type CreateOfflineOrderInput = z.infer<typeof createOfflineOrderSchema>;

/**
 * Transition order — move order to a new status.
 * Metadata varies by transition (e.g. cancel reason, delivery qty).
 */
export const transitionOrderSchema = z.object({
  orderId: z.string().uuid(),
  newStatus: orderStatusSchema,
  metadata: z.object({
    reason: z.string().optional(),
    deliveredQuantity: z.number().int().min(0).optional(),
    returnedQuantity: z.number().int().min(0).optional(),
    logisticsLocationId: z.string().uuid().optional(),
    logisticsProviderId: z.string().uuid().optional(),
    riderId: z.string().uuid().optional(),
    otp: z.string().length(4).regex(/^\d{4}$/).optional(),
    gpsLat: z.number().min(-90).max(90).optional(),
    gpsLng: z.number().min(-180).max(180).optional(),
    /** Add-on to delivery fee when marking DELIVERED/PARTIALLY_DELIVERED (required in v1 — 3PL records delivery cost) */
    deliveryFeeAddOn: z.number().min(0).optional(),
    /** URL of screenshot from 3PL delivery app (required when marking DELIVERED/PARTIALLY_DELIVERED in v1) */
    deliveryProofUrl: z.string().url().optional(),
    /** Scheduled delivery date set by CS agent when confirming the order */
    preferredDeliveryDate: z.string().optional(),
  }).optional(),
});

export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;

/**
 * Update order details — address change, upsell, quantity change.
 * Creates a version snapshot (temporal table preserves old values).
 */
export const updateOrderSchema = z.object({
  orderId: z.string().uuid(),
  customerAddress: z.string().optional(),
  deliveryAddress: z.string().optional(),
  deliveryNotes: z.string().optional(),
  deliveryState: z.string().max(100).optional(),
  customerGender: z.enum(['male', 'female']).optional(),
  preferredDeliveryDate: z.string().max(100).optional(),
  items: z.array(orderItemSchema).min(1).optional(),
  totalAmount: z.coerce.number().min(0).multipleOf(0.01).optional(),
  paymentMethod: z.enum(['PAY_ON_DELIVERY', 'PAY_ONLINE']).optional(),
  customerEmail: z.string().email().max(255).optional(),
});

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

/**
 * Assign order to CS agent — manual assignment or bulk reassign.
 */
export const assignOrderSchema = z.object({
  orderId: z.string().uuid(),
  csAgentId: z.string().uuid(),
});

export type AssignOrderInput = z.infer<typeof assignOrderSchema>;

/**
 * Bulk reassign orders from one agent to another.
 * Used by Head of CS for hot swap.
 */
export const bulkReassignSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1, 'At least one order is required'),
  fromAgentId: z.string().uuid(),
  toAgentId: z.string().uuid(),
});

export type BulkReassignInput = z.infer<typeof bulkReassignSchema>;

/**
 * List orders — filtering and pagination.
 */
export const listOrdersSchema = z.object({
  status: orderStatusSchema.optional(),
  assignedCsId: z.string().uuid().optional(),
  mediaBuyerId: z.string().uuid().optional(),
  riderId: z.string().uuid().optional(),
  logisticsLocationId: z.string().uuid().optional(),
  search: z.string().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'updatedAt', 'status', 'totalAmount', 'preferredDeliveryDate']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListOrdersInput = z.infer<typeof listOrdersSchema>;
