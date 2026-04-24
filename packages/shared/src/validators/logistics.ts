import { z } from 'zod';

// ============================================
// Logistics Provider Validators
// ============================================

export const createProviderSchema = z.object({
  name: z.string().min(2).max(200),
  contactInfo: z.string().max(500).optional(),
  coverageArea: z.string().max(500).optional(),
  rateCard: z.record(z.unknown()).optional(),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = z.object({
  providerId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  contactInfo: z.string().max(500).optional(),
  coverageArea: z.string().max(500).optional(),
  rateCard: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const listProvidersSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
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
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z.object({
  locationId: z.string().uuid(),
  name: z.string().min(2).max(200).optional(),
  address: z.string().min(5).max(500).optional(),
  coordinates: z.string().max(100).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  whatsappGroupLink: whatsappGroupLinkSchema.optional().nullable(),
});
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

export const listLocationsSchema = z.object({
  providerId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListLocationsInput = z.infer<typeof listLocationsSchema>;

// ============================================
// Transfer Remittance (3PL → warehouse)
// ============================================

export const createRemittanceSchema = z.object({
  productId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  quantitySent: z.number().int().min(1),
  receiptUrl: z.string().url().min(1),
});
export type CreateRemittanceInput = z.infer<typeof createRemittanceSchema>;

export const listRemittancesSchema = z.object({
  locationId: z.string().uuid().optional(),
  status: z.enum(['SENT', 'RECEIVED', 'DISPUTED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
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
  limit: z.number().int().min(1).max(100).default(20),
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
  receiptUrls: z.array(z.string().url()).min(1).max(20),
});
export type CreateDeliveryRemittanceInput = z.infer<typeof createDeliveryRemittanceSchema>;

export const listDeliveryRemittancesSchema = z.object({
  logisticsLocationId: z.string().uuid().optional(),
  status: z.enum(['SENT', 'RECEIVED', 'DISPUTED']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListDeliveryRemittancesInput = z.infer<typeof listDeliveryRemittancesSchema>;

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
