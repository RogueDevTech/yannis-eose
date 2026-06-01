import { z } from 'zod';

// ============================================
// Order Input Validators
// ============================================

/**
 * All 14 order statuses.
 */
export const orderStatusSchema = z.enum([
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'CANCELLED',
  // Renamed from ALLOCATED — CEO directive 2026-05-04, migration 0110.
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  // Renamed from COMPLETED — CEO directive 2026-05-04, migration 0110.
  'REMITTED',
  // Soft-removal — excluded from metrics, row stays in DB. Migration 0153.
  'DELETED',
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
  /** Edge forms may send configurable dropdown labels (see campaign formConfig.genderOptions). */
  customerGender: z.string().max(50).optional(),
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
  /**
   * Form-builder responses, keyed by `customField.id`. Persisted as-is to
   * `orders.custom_fields` (JSONB). Per-field types vary — text/email/number/dropdown
   * are strings (or numbers), checkbox_group is string[], toggle is boolean.
   */
  customFields: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string()).max(50)]))
    .optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * Create offline order — used by Sales closer or Head of CS.
 * Accepts raw customerPhone; API hashes it server-side. Creator is set as assignee (no auto-dispatch).
 */
export const createOfflineOrderSchema = z.object({
  /** Back-link to an abandoned cart this order is recovering. When set the
   *  service flips the cart to CONVERTED and copies the MB attribution. */
  cartId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  mediaBuyerId: z.string().uuid().optional(),
  customerName: z.string().min(2, 'Customer name is required'),
  /** Raw phone — API hashes server-side; never send pre-hashed from Sales UI */
  customerPhone: z.string().min(1, 'Customer phone is required').max(50),
  customerAddress: z.string().optional(),
  deliveryAddress: z.string().optional(),
  deliveryNotes: z.string().optional(),
  deliveryState: z.string().max(100).optional(),
  customerGender: z.string().max(50).optional(),
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
    /** Discount amount applied at delivery when marking DELIVERED/PARTIALLY_DELIVERED; reduces order totalAmount */
    deliveryDiscountAmount: z.number().min(0).optional(),
    /** Scheduled delivery date set by Sales closer when confirming the order */
    preferredDeliveryDate: z.string().optional(),
    /** Mandatory note when CS marks an order DELIVERED (e.g. "Customer confirmed receipt on call at 3:42pm"). */
    deliveryNote: z.string().min(10).max(500).optional(),
    /** What action triggered a CS_ENGAGED transition. Server uses this to write a precise
     *  timeline line ("revealed phone for manual call" vs "started VOIP call" vs generic). */
    engagementMethod: z
      .enum(['phone_revealed', 'voip_call_started', 'manual_call_logged'])
      .optional(),
  }).optional(),
});

export type TransitionOrderInput = z.infer<typeof transitionOrderSchema>;

/**
 * Update order details — address change, upsell, quantity change.
 * Creates a version snapshot (temporal table preserves old values).
 */
export const updateOrderSchema = z.object({
  orderId: z.string().uuid(),
  customerName: z.string().min(1).max(255).optional(),
  customerAddress: z.string().optional(),
  deliveryAddress: z.string().optional(),
  deliveryNotes: z.string().optional(),
  deliveryState: z.string().max(100).optional(),
  customerGender: z.string().max(50).optional(),
  preferredDeliveryDate: z.string().max(100).optional(),
  /**
   * Form-builder responses (same shape as create). CS / supervisors / heads may correct
   * answers without changing line pricing when not permitted.
   */
  customFields: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string()).max(50)]))
    .optional(),
  /** Optional delivery fee add-on (e.g. from Resolve order modal). Added to existing deliveryFee. */
  deliveryFeeAddOn: z.number().min(0).optional(),
  /** Optional discount at delivery. Reduces totalAmount and stored on order. */
  deliveryDiscountAmount: z.number().min(0).optional(),
  /** Required when resolving order (3PL): URL of uploaded receipt. */
  resolveReceiptUrl: z.string().url().optional(),
  items: z.array(orderItemSchema).min(1).optional(),
  totalAmount: z.coerce.number().min(0).multipleOf(0.01).optional(),
  paymentMethod: z.enum(['PAY_ON_DELIVERY', 'PAY_ONLINE']).optional(),
  customerEmail: z.string().email().max(255).optional(),
});

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;

/**
 * Proposed line-item prices + total submitted for approval (actors who cannot edit prices inline).
 */
export const requestOrderLinePriceChangeSchema = z.object({
  orderId: z.string().uuid(),
  items: z.array(orderItemSchema).min(1),
  totalAmount: z.coerce.number().min(0).multipleOf(0.01),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export type RequestOrderLinePriceChangeInput = z.infer<typeof requestOrderLinePriceChangeSchema>;

/**
 * Request soft-delete (archive) for approval — row stays until an approver stamps `deleted_at`.
 */
export const requestOrderDeletionSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export type RequestOrderDeletionInput = z.infer<typeof requestOrderDeletionSchema>;

/**
 * Immediate soft-delete by privileged roles (same approver matrix as line-price edits).
 */
export const softDeleteOrderSchema = requestOrderDeletionSchema;

export type SoftDeleteOrderInput = z.infer<typeof softDeleteOrderSchema>;

/**
 * Assign order to Sales closer — manual assignment or bulk reassign.
 */
export const assignOrderSchema = z.object({
  orderId: z.string().uuid(),
  csCloserId: z.string().uuid(),
  /**
   * Late-stage credit-attribution transfers (post-CS_ENGAGED) require a short
   * reason for the audit trail. Optional for normal pre-engagement assigns.
   * Server validates non-empty when the order's status is past CS_ENGAGED.
   */
  reason: z.string().trim().min(1).max(280).optional(),
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

/** CS / list: filter by callback queue, delivery day, overdue undelivered, etc. (see OrdersService.list). */
export const listOrdersScheduleKindSchema = z.enum([
  'callback_due',
  'callback_on_day',
  'delivery_on_day',
  'delivery_overdue',
]);

export type ListOrdersScheduleKind = z.infer<typeof listOrdersScheduleKindSchema>;

/**
 * List orders — filtering and pagination.
 */
export const listOrdersSchema = z
  .object({
    status: orderStatusSchema.optional(),
    statuses: z.array(orderStatusSchema).min(1).optional(),
    assignedCsId: z.string().uuid().optional(),
    mediaBuyerId: z.string().uuid().optional(),
    /**
     * Server-injected supervisor scope (OR semantics). When set, the list returns rows
     * where `assignedCsId IN csUserIds` OR `mediaBuyerId IN mediaBuyerIds`. Each set
     * always contains the supervisor's own id so they still see their own work.
     * Routers populate this; the UI never sends it.
     */
    supervisorScope: z
      .object({
        csUserIds: z.array(z.string().uuid()).max(2000),
        mediaBuyerIds: z.array(z.string().uuid()).max(2000),
      })
      .optional(),
    campaignId: z.string().uuid().optional(),
    productId: z.string().uuid().optional(),
    riderId: z.string().uuid().optional(),
    logisticsLocationId: z.string().uuid().optional(),
    /**
     * When true, returns only orders that were recovered from a dropped-off cart
     * (i.e. `orders.cart_id IS NOT NULL`). Used by the `/admin/orders` "Recovered
     * from cart" filter pill. When false or omitted, no filtering by cart origin.
     * Migration 0142 added the back-link column + index.
     */
    fromCart: z.boolean().optional(),
    /** Filter to orders where customer_name starts with "test" (whole word). Admin only. */
    testOrders: z.boolean().optional(),
    /** Filter by order source: 'offline' (CS manual entry) or 'edge-form' (sales form). */
    orderSource: z.enum(['offline', 'edge-form']).optional(),
    search: z.string().optional(),
    // Accept either `YYYY-MM-DD` (whole-day default) OR `YYYY-MM-DDTHH:MM[:SS]`
    // (precise moment from the time-aware DateFilterBar). API service detects the
    // `T` and skips the end-of-day bump for ISO datetimes.
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
    scheduleKind: listOrdersScheduleKindSchema.optional(),
    /** Required when scheduleKind is callback_on_day or delivery_on_day (YYYY-MM-DD). */
    scheduleDate: z.string().date().optional(),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(1000).default(20),
    /**
     * Branch scoping strategy (migration 0150).
     * `'servicing'` (default) filters by `orders.servicing_branch_id` — the CS
     * branch that works the order. Correct for CS / Sales / Logistics surfaces.
     * `'marketing'` filters by `orders.branch_id` — the campaign/form branch the
     * order is attributed to. Marketing pages (MB / HoM) pass `'marketing'`.
     */
    branchScope: z.enum(['servicing', 'marketing']).optional(),
    /** When true, exclude follow-up orders from results. Default true — normal pages never see follow-ups. */
    excludeFollowUp: z.boolean().optional(),
    sortBy: z.enum(['createdAt', 'updatedAt', 'status', 'totalAmount', 'preferredDeliveryDate']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine((val, ctx) => {
    if (val.scheduleKind === 'callback_on_day' || val.scheduleKind === 'delivery_on_day') {
      if (!val.scheduleDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'scheduleDate is required for this scheduleKind',
          path: ['scheduleDate'],
        });
      }
    }
    if (val.scheduleDate && !val.scheduleKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scheduleKind is required when scheduleDate is set',
        path: ['scheduleKind'],
      });
    }
    if (val.scheduleKind === 'delivery_overdue' && val.scheduleDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'scheduleDate must not be set for delivery_overdue',
        path: ['scheduleDate'],
      });
    }
  });

export type ListOrdersInput = z.infer<typeof listOrdersSchema>;

/** Per-day heat for CS schedule calendar (callbacks in Africa/Lagos + ISO preferred_delivery_date). */
export const scheduleCalendarHeatSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/, 'Expected YYYY-MM'),
  assignedCsId: z.string().uuid().optional(),
  mediaBuyerId: z.string().uuid().optional(),
  supervisorScope: z
    .object({
      csUserIds: z.array(z.string().uuid()).max(2000),
      mediaBuyerIds: z.array(z.string().uuid()).max(2000),
    })
    .optional(),
  status: orderStatusSchema.optional(),
});

export type ScheduleCalendarHeatInput = z.infer<typeof scheduleCalendarHeatSchema>;
