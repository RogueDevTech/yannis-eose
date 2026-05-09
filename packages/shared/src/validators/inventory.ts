import { z } from 'zod';

// ============================================
// Stock Intake — add a FIFO batch
// ============================================

export const stockIntakeSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  factoryCost: z.coerce.number().min(0).multipleOf(0.01),
  landingCost: z.coerce.number().min(0).multipleOf(0.01),
});

export type StockIntakeInput = z.infer<typeof stockIntakeSchema>;

// ============================================
// Stock Transfer — warehouse to 3PL
// ============================================

export const stockTransferSchema = z.object({
  productId: z.string().uuid(),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantity: z.number().int().min(1),
});

export type StockTransferInput = z.infer<typeof stockTransferSchema>;

// ============================================
// Verify Transfer — 3PL confirms receipt
// ============================================

export const verifyTransferSchema = z.object({
  transferId: z.string().uuid(),
  quantityReceived: z.number().int().min(0),
  shrinkageReason: z.string().optional(),
  /** Optional free-text comment from the receiver (visible in admin + transfers UI). */
  receiverNotes: z.string().max(500).optional(),
});

export type VerifyTransferInput = z.infer<typeof verifyTransferSchema>;

// ============================================
// Approve / Reject Transfer — source-authority gate
// ============================================
// Used when a non-source-authority initiated a transfer. The transfer sits in
// PENDING until the source authority approves (deducts source stock + flips to
// IN_TRANSIT) or rejects (terminal REJECTED, inventory-neutral).

export const approveTransferSchema = z.object({
  transferId: z.string().uuid(),
});

export type ApproveTransferInput = z.infer<typeof approveTransferSchema>;

export const rejectTransferSchema = z.object({
  transferId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Rejection reason must be at least 10 characters').max(500),
});

export type RejectTransferInput = z.infer<typeof rejectTransferSchema>;

// ============================================
// Stock Adjustment — manual correction
// ============================================

export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid(),
  adjustmentQuantity: z.number().int(), // positive = add, negative = remove
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

// ============================================
// List Inventory Levels
// ============================================

export const listInventorySchema = z.object({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  /** Only levels that still hold FIFO from this verified shipment (batch remaining > 0). */
  shipmentId: z.string().uuid().optional(),
  belowThreshold: z.boolean().optional(),
  /** Substring match against the product name (case-insensitive). */
  search: z.string().trim().min(1).max(100).optional(),
  /** `available` sorts by (stockCount - reservedCount); `updatedAt` is the default recency sort. */
  sortBy: z.enum(['updatedAt', 'available']).default('updatedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ListInventoryInput = z.infer<typeof listInventorySchema>;

// ============================================
// List Stock Movements
// ============================================

export const listMovementsSchema = z.object({
  productId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  movementType: z.enum([
    'INTAKE', 'RESERVATION', 'ALLOCATION', 'DISPATCH',
    'DELIVERY', 'RETURN', 'RESTOCK', 'WRITE_OFF',
    'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT',
  ]).optional(),
  /**
   * Trace a single shipment's intake into the movement ledger. Filters movements whose
   * `referenceId` points at one of this shipment's `shipment_lines`. The trigger that
   * stamps INTAKE rows on shipment verification sets `referenceId = shipment_line.id`,
   * so this captures the entry of the shipment's units into stock. Downstream
   * allocations/deliveries off those batches reference order_id (not the line) and
   * therefore aren't included — current location distribution is in the Stock Levels
   * tab via the matching `shipmentId` filter on `listInventorySchema`.
   */
  shipmentId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ListMovementsInput = z.infer<typeof listMovementsSchema>;

// ============================================
// Stock Reconciliation — Ghost Stock Prevention
// ============================================

export const createReconciliationSchema = z.object({
  locationId: z.string().uuid(),
  productId: z.string().uuid(),
  physicalCount: z.number().int().min(0, 'Physical count cannot be negative'),
  reasonCode: z.enum([
    'DAMAGED',
    'LOST',
    'EXPIRED',
    'THEFT',
    'COUNTING_ERROR',
    'OTHER',
  ]),
  notes: z.string().min(10, 'Notes must be at least 10 characters').optional(),
});

export type CreateReconciliationInput = z.infer<typeof createReconciliationSchema>;

export const resolveReconciliationSchema = z.object({
  reconciliationId: z.string().uuid(),
  approved: z.boolean(),
});

export type ResolveReconciliationInput = z.infer<typeof resolveReconciliationSchema>;

// ============================================
// Inbound Shipments — multi-line supplier receipts
// ============================================

export const shipmentStatusSchema = z.enum([
  'CREATED',
  'IN_TRANSIT',
  'ARRIVED',
  'VERIFIED',
  'CLOSED',
  'CANCELLED',
]);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;

const moneyAmount = z.coerce.number().min(0).multipleOf(0.01);

const createShipmentLineSchema = z.object({
  productId: z.string().uuid(),
  expectedQuantity: z.number().int().min(1, 'Expected quantity must be at least 1'),
  factoryCost: moneyAmount,
});

export const createShipmentSchema = z.object({
  destinationLocationId: z.string().uuid(),
  label: z.string().trim().max(160).optional().or(z.literal('')),
  supplierName: z.string().trim().max(160).optional().or(z.literal('')),
  supplierReference: z.string().trim().max(160).optional().or(z.literal('')),
  expectedArrivalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected arrival must be YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  totalLandingCost: moneyAmount.default(0),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
  /**
   * `arrivedNow: true` skips planning and creates the shipment in ARRIVED state
   * (retroactive entry — goods already on-site). Default is `CREATED`.
   */
  arrivedNow: z.boolean().optional(),
  lines: z.array(createShipmentLineSchema).min(1, 'At least one line item is required'),
});
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export const updateShipmentLinesSchema = z.object({
  shipmentId: z.string().uuid(),
  totalLandingCost: moneyAmount.optional(),
  label: z.string().trim().max(160).optional().or(z.literal('')),
  supplierName: z.string().trim().max(160).optional().or(z.literal('')),
  supplierReference: z.string().trim().max(160).optional().or(z.literal('')),
  expectedArrivalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected arrival must be YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
  /** Replace the line set wholesale. Each entry is the same shape as create. */
  lines: z.array(createShipmentLineSchema).min(1).optional(),
});
export type UpdateShipmentLinesInput = z.infer<typeof updateShipmentLinesSchema>;

export const shipmentTransitionSchema = z.object({
  shipmentId: z.string().uuid(),
});
export type ShipmentTransitionInput = z.infer<typeof shipmentTransitionSchema>;

export const verifyShipmentSchema = z.object({
  shipmentId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        receivedQuantity: z.number().int().min(0),
        varianceReason: z.string().trim().max(500).optional().or(z.literal('')),
      }),
    )
    .min(1),
});
export type VerifyShipmentInput = z.infer<typeof verifyShipmentSchema>;

export const cancelShipmentSchema = z.object({
  shipmentId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(500),
});
export type CancelShipmentInput = z.infer<typeof cancelShipmentSchema>;

export const listShipmentsSchema = z.object({
  status: shipmentStatusSchema.optional(),
  destinationLocationId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListShipmentsInput = z.infer<typeof listShipmentsSchema>;

export const getShipmentSchema = z.object({
  shipmentId: z.string().uuid(),
});
export type GetShipmentInput = z.infer<typeof getShipmentSchema>;

// ============================================
// Our warehouses (internal provider kind WAREHOUSE) — managed at /admin/inventory/warehouses
// ============================================

export const createWarehouseSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(160),
  address: z.string().trim().min(2, 'Address is required').max(500),
  coordinates: z.string().trim().max(100).optional().or(z.literal('')),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;

export const listWarehousesSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  /** `all` — every logistics site. `our` — internal (provider kind WAREHOUSE) sites only. */
  listScope: z.enum(['all', 'our']).default('all'),
  /**
   * `available` sorts by computed (stockCount − reservedCount) summed across the warehouse;
   * `name` is alphabetical; `createdAt` is recency. Default = `createdAt` desc (newest first),
   * with internal warehouses surfaced first by provider-kind tiebreaker (unchanged from prior).
   */
  sortBy: z.enum(['createdAt', 'name', 'available']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListWarehousesInput = z.infer<typeof listWarehousesSchema>;
