import { z } from 'zod';

// ============================================
// Marketing Funding Validators
// ============================================

export const createFundingSchema = z.object({
  receiverId: z.string().uuid(),
  amount: z.coerce.number().min(0).multipleOf(0.01),
  receiptUrl: z.string().url().min(1),
  paymentMethod: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});
export type CreateFundingInput = z.infer<typeof createFundingSchema>;

export const verifyFundingSchema = z.object({
  fundingId: z.string().uuid(),
  action: z.enum(['COMPLETED', 'DISPUTED']),
  disputeReason: z.string().min(10).optional(),
});
export type VerifyFundingInput = z.infer<typeof verifyFundingSchema>;

export const listFundingSchema = z.object({
  status: z.enum(['SENT', 'COMPLETED', 'DISPUTED']).optional(),
  receiverId: z.string().uuid().optional(),
  senderId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListFundingInput = z.infer<typeof listFundingSchema>;

export const listFundingRequestsSchema = z.object({
  requesterId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListFundingRequestsInput = z.infer<typeof listFundingRequestsSchema>;

export const getFundingBalanceSchema = z.object({
  userId: z.string().uuid(),
});
export type GetFundingBalanceInput = z.infer<typeof getFundingBalanceSchema>;

export const approveFundingRequestSchema = z.object({
  requestId: z.string().uuid(),
  receiptUrl: z.string().url().min(1),
});
export type ApproveFundingRequestInput = z.infer<typeof approveFundingRequestSchema>;

export const rejectFundingRequestSchema = z.object({
  requestId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type RejectFundingRequestInput = z.infer<typeof rejectFundingRequestSchema>;

// ============================================
// Ad Spend Log Validators
// ============================================

export const createAdSpendSchema = z.object({
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  spendAmount: z.coerce.number().min(0).multipleOf(0.01),
  screenshotUrl: z.string().url().min(1),
  spendDate: z.string().date(),
  notes: z.string().max(500).optional(),
});
export type CreateAdSpendInput = z.infer<typeof createAdSpendSchema>;

export const listAdSpendSchema = z.object({
  mediaBuyerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListAdSpendInput = z.infer<typeof listAdSpendSchema>;

export const approveAdSpendSchema = z.object({
  adSpendId: z.string().uuid(),
});
export type ApproveAdSpendInput = z.infer<typeof approveAdSpendSchema>;

// ============================================
// Offer Template Validators
// ============================================

export const createOfferTemplateSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1, 'Template name is required').max(200),
  price: z.coerce.number().min(0).multipleOf(0.01),
  variants: z.record(z.unknown()).optional(),
});
export type CreateOfferTemplateInput = z.infer<typeof createOfferTemplateSchema>;

export const updateOfferTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  price: z.coerce.number().min(0).multipleOf(0.01).optional(),
  variants: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateOfferTemplateInput = z.infer<typeof updateOfferTemplateSchema>;

export const listOfferTemplatesSchema = z.object({
  productId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListOfferTemplatesInput = z.infer<typeof listOfferTemplatesSchema>;

// ============================================
// Campaign Validators
// ============================================

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(200),
  productIds: z.array(z.string().uuid()).min(1, 'At least one product is required'),
  deploymentType: z.enum(['SNIPPET', 'IFRAME', 'HOSTED']).default('HOSTED'),
  formConfig: z.object({
    // Display customization (used by Edge Worker form rendering)
    heading: z.string().max(200).optional(),
    subtitle: z.string().max(500).optional(),
    buttonText: z.string().max(50).optional(),
    accentColor: z.string().max(20).optional(),
    successMessage: z.string().max(500).optional(),
    // Optional field visibility toggles
    showDeliveryAddress: z.boolean().optional(),
    showDeliveryNotes: z.boolean().optional(),
    showDeliveryState: z.boolean().optional(),
    showGender: z.boolean().optional(),
    showPreferredDeliveryDate: z.boolean().optional(),
    showPaymentMethod: z.boolean().optional(),
    // Custom options for select fields
    deliveryStateOptions: z.array(z.string().max(100)).max(50).optional(),
    preferredDeliveryDateOptions: z.array(z.string().max(100)).max(20).optional(),
    // Advanced form config
    fields: z.array(z.object({
      name: z.string(),
      label: z.string(),
      type: z.enum(['text', 'tel', 'email', 'textarea', 'select']),
      required: z.boolean().default(true),
      placeholder: z.string().optional(),
      options: z.array(z.string()).optional(),
    })).optional(),
    thankYouUrl: z.string().url().optional(),
    maxQuantity: z.number().int().min(1).max(100).optional(),
  }).optional(),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  formConfig: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const listCampaignsSchema = z.object({
  mediaBuyerId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(500).default(20),
});
export type ListCampaignsInput = z.infer<typeof listCampaignsSchema>;
