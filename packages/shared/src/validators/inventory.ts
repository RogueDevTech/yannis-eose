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
