import { z } from 'zod';

// ============================================
// Logistics Provider Validators
// ============================================

export const createProviderSchema = z.object({
  name: z.string().trim().min(2).max(200),
  contactInfo: z.string().trim().min(1).max(500),
  coverageArea: z.string().trim().min(1).max(500),
  rateCard: z.record(z.unknown()).optional(),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = z.object({
  providerId: z.string().uuid(),
  name: z.string().trim().min(2).max(200).optional(),
  contactInfo: z.string().trim().min(1).max(500).optional(),
  coverageArea: z.string().trim().min(1).max(500).optional(),
  rateCard: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const listProvidersSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().optional(),
  /** Filter by kind. The Logistics Partners page passes `THIRD_PARTY` to hide Yannis warehouses. */
  kind: z.enum(['THIRD_PARTY', 'WAREHOUSE']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
});
export type ListProvidersInput = z.infer<typeof listProvidersSchema>;

// ============================================
// Logistics Location Validators
// ============================================

const whatsappGroupLinkSchema = z
  .string()
  .url()
  .refine((v) => v.startsWith('https://chat.whatsapp.com/') || v.startsWith('https://wa.me/'), {
    message: 'Must be a WhatsApp group invite (chat.whatsapp.com/...) or direct chat (wa.me/...) link',
  });

export const createLocationSchema = z.object({
  providerId: z.string().uuid(),
  name: z.string().min(2).max(200),
  address: z.string().min(5).max(500),
  coordinates: z.string().max(100).optional(),
  whatsappGroupLink: whatsappGroupLinkSchema.optional().nullable(),
  /** Per-location low-stock alert threshold. NULL = inherit the org-wide setting. */
  lowStockThreshold: z.number().int().min(1).max(10000).optional().nullable(),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z.object({
  locationId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  address: z.string().min(5).max(500).optional(),
  coordinates: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  whatsappGroupLink: whatsappGroupLinkSchema.optional().nullable(),
  lowStockThreshold: z.number().int().min(1).max(10000).optional().nullable(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const listLocationsSchema = z.object({
  providerId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  /** Filter by parent provider's kind — used by the shipment destination dropdown to show warehouses only. */
  providerKind: z.enum(['THIRD_PARTY', 'WAREHOUSE']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
});
export type ListLocationsInput = z.infer<typeof listLocationsSchema>;

// ============================================
// Transfer Remittance (3PL → warehouse)
// ============================================

/**
 * Optional asset URL — accepts blank, http(s), and rejects everything else.
 * Treats empty string as `undefined` for a single truthy check downstream.
 * Every image field is optional per the platform-wide directive (CEO 2026-05).
 */
const optionalAssetUrl = z
  .union([z.literal(''), z.string().url()])
  .optional()
  .transform((v) => (v ? v : undefined));

export const createRemittanceSchema = z.object({
  productId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantitySent: z.number().int().min(1),
  receiptUrl: optionalAssetUrl,
});
export type CreateRemittanceInput = z.infer<typeof createRemittanceSchema>;

export const listRemittancesSchema = z.object({
  locationId: z.string().uuid().optional(),
  status: z.enum(['SENT', 'RECEIVED', 'DISPUTED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
});
export type ListRemittancesInput = z.infer<typeof listRemittancesSchema>;

export const markRemittanceReceivedSchema = z.object({
  remittanceId: z.string().uuid(),
  quantityReceived: z.number().int().min(0),
  shrinkageReason: z.string().min(1).optional(),
});
export type MarkRemittanceReceivedInput = z.infer<typeof markRemittanceReceivedSchema>;

// ============================================
// Delivery confirmation requests (rider/3PL → HOL approval)
// ============================================

const deliveryConfirmationMetadataSchema = z.object({
  reason: z.string().optional(),
  deliveredQuantity: z.number().int().min(0).optional(),
  returnedQuantity: z.number().int().min(0).optional(),
  logisticsLocationId: z.string().uuid().optional(),
  logisticsProviderId: z.string().uuid().optional(),
  riderId: z.string().uuid().optional(),
  otp: z.string().length(4).regex(/^\d{4}$/).optional(),
  gpsLat: z.number().min(-90).max(90).optional(),
  gpsLng: z.number().min(-180).max(180).optional(),
  deliveryFeeAddOn: z.number().min(0).optional(),
  deliveryProofUrl: z.string().url().optional(),
  deliveryDiscountAmount: z.number().min(0).optional(),
  preferredDeliveryDate: z.string().optional(),
});

export const submitDeliveryConfirmationSchema = z.object({
  orderId: z.string().uuid(),
  newStatus: z.enum(['DELIVERED', 'PARTIALLY_DELIVERED']),
  metadata: deliveryConfirmationMetadataSchema.optional(),
});
export type SubmitDeliveryConfirmationInput = z.infer<typeof submitDeliveryConfirmationSchema>;

export const listDeliveryConfirmationRequestsSchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
});
export type ListDeliveryConfirmationRequestsInput = z.infer<typeof listDeliveryConfirmationRequestsSchema>;

export const approveDeliveryConfirmationSchema = z.object({
  requestId: z.string().uuid(),
});
export type ApproveDeliveryConfirmationInput = z.infer<typeof approveDeliveryConfirmationSchema>;

export const rejectDeliveryConfirmationSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().max(1000).optional(),
});
export type RejectDeliveryConfirmationInput = z.infer<typeof rejectDeliveryConfirmationSchema>;

// ============================================
// Delivery remittances (3PL batches delivered orders + receipts; Finance marks received)
// ============================================

export const createDeliveryRemittanceSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(500),
  receiptUrls: z.array(z.string().url()).max(20).default([]),
  /** Optional comment captured on the remittance row (Phase 18 — accountant-led flow). */
  notes: z.string().trim().max(1000).optional(),
  /**
   * When true, the same write transitions the remittance to RECEIVED and bulk-completes
   * every linked order (DELIVERED → COMPLETED). Phase 18 — accountant records cash + closes
   * the orders in one step. False (default) creates a Pending remittance the accountant
   * marks Received later from the detail page.
   */
  markReceivedNow: z.boolean().optional().default(false),
  /** Per-order delivery fee overrides. Keys are order UUIDs, values are fee amounts as strings (numeric). */
  deliveryFees: z.record(z.string()).optional(),
  /** Remittance-level deductions (not per-order). */
  commitmentFee: z.string().optional(),
  posFee: z.string().optional(),
  failedDeliveryCost: z.string().optional(),
});
export type CreateDeliveryRemittanceInput = z.infer<typeof createDeliveryRemittanceSchema>;

export const listDeliveryRemittancesSchema = z.object({
  logisticsLocationId: z.string().uuid().optional(),
  /** Filter by who recorded the remittance (Phase 18 — Sent by filter on the Finance page). */
  sentBy: z.string().uuid().optional(),
  status: z.enum(['SENT', 'RECEIVED', 'DISPUTED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().trim().max(200).optional(),
  /** Filter by order category in the orders view. */
  category: z.enum(['marketing', 'cart', 'follow-up', 'offline']).optional(),
  /** Sort field for the orders view. */
  sortBy: z.enum(['sentAt', 'deliveredAt', 'totalAmount', 'deliveryFee', 'orderNumber']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
});
export type ListDeliveryRemittancesInput = z.infer<typeof listDeliveryRemittancesSchema>;

/**
 * Phase 18 — accountant view of "delivered orders not yet on a remittance".
 * Replaces the old TPL_MANAGER-only signature. Filters mirror the Finance page picker.
 */
export const listDeliveryRemittanceEligibleOrdersSchema = z.object({
  logisticsLocationId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  orderIds: z.array(z.string().uuid()).max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(100),
});
export type ListDeliveryRemittanceEligibleOrdersInput = z.infer<typeof listDeliveryRemittanceEligibleOrdersSchema>;

export const markDeliveryRemittanceReceivedSchema = z.object({
  deliveryRemittanceId: z.string().uuid(),
});
export type MarkDeliveryRemittanceReceivedInput = z.infer<typeof markDeliveryRemittanceReceivedSchema>;

export const getDeliveryRemittanceSchema = z.object({
  deliveryRemittanceId: z.string().uuid(),
});
export type GetDeliveryRemittanceInput = z.infer<typeof getDeliveryRemittanceSchema>;

export const disputeDeliveryRemittanceSchema = z.object({
  deliveryRemittanceId: z.string().uuid(),
  disputeReason: z.string().min(10, 'Dispute reason must be at least 10 characters').max(1000),
});
export type DisputeDeliveryRemittanceInput = z.infer<typeof disputeDeliveryRemittanceSchema>;
