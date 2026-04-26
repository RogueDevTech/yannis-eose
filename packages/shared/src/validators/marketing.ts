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
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListFundingInput = z.infer<typeof listFundingSchema>;

/** Scope for funding status counts — matches listFunding filters except status (counts are per-status). */
export const fundingStatusCountsSchema = z.object({
  receiverId: z.string().uuid().optional(),
  /** Optional sender filter — used by the Funding page's "Distributing" section to count
   * outgoing-only transfers (HoM disbursing to MBs). */
  senderId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  search: z.string().trim().max(200).optional(),
});
export type FundingStatusCountsInput = z.infer<typeof fundingStatusCountsSchema>;

/** Same date scope as listFundingRequests (createdAt); visibility matches list (MB = own, others = branch). */
export const fundingRequestStatusCountsSchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  /** When set, count only requests where requester = this id ("my requests" view). */
  requesterId: z.string().uuid().optional(),
  /** When true, count only requests submitted BY *other* users than the caller — i.e.
   * MB requests pending approval from HoM ("inbox" view). Mutually exclusive with `requesterId`. */
  excludeSelfAsRequester: z.boolean().optional(),
});
export type FundingRequestStatusCountsInput = z.infer<typeof fundingRequestStatusCountsSchema>;

/** Direction-aware summary for the funding page top strip. Returns the actor's total
 * received and distributed in the period — the two numbers HoMs care about most. */
export const fundingDirectionSummarySchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});
export type FundingDirectionSummaryInput = z.infer<typeof fundingDirectionSummarySchema>;

export const listFundingRequestsSchema = z.object({
  requesterId: z.string().uuid().optional(),
  /** When true, exclude requests where requester = caller. Used by HoM's "MB Requests"
   * inbox so it doesn't include the HoM's own outbound requests to Finance. Mutually
   * exclusive with `requesterId`; if both are set the explicit `requesterId` wins. */
  excludeSelfAsRequester: z.boolean().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
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
  status: z.enum(['PENDING', 'APPROVED']).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListAdSpendInput = z.infer<typeof listAdSpendSchema>;

/** Scope for ad spend status counts — matches listAdSpend filters except status. */
export const adSpendStatusCountsSchema = z.object({
  mediaBuyerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  search: z.string().trim().max(200).optional(),
});
export type AdSpendStatusCountsInput = z.infer<typeof adSpendStatusCountsSchema>;

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

/**
 * Custom field on a campaign's public form. Built by Media Buyers via the form builder
 * at `/admin/marketing/forms/:id/builder`. Customer responses land in `orders.custom_fields`
 * keyed by `id`.
 *
 * Standard fields (Name, Phone, Address, etc.) remain protected and are NOT in this list —
 * they're toggled by `showDelivery*` / `showGender` / etc. flags above.
 */
export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'email',
  'phone',
  'number',
  'date',
  'dropdown',
  'radio',
  'checkbox_group',
  'toggle',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const customFormFieldSchema = z.object({
  /** Stable id (uuid). Generated client-side when the field is added; never reused. */
  id: z.string().uuid(),
  type: z.enum(FORM_FIELD_TYPES),
  label: z.string().min(1).max(120),
  placeholder: z.string().max(120).optional(),
  helpText: z.string().max(240).optional(),
  required: z.boolean().default(false),
  /** Sort order — 0-indexed. Renderer + builder both honour ascending. */
  order: z.number().int().min(0),
  /** Options for dropdown / radio / checkbox_group. Ignored otherwise. */
  options: z.array(z.string().min(1).max(120)).max(50).optional(),
  /** Length / value bounds. Per-type meaning: text/textarea = char length, number = value, date = ISO yyyy-mm-dd. */
  min: z.union([z.number(), z.string()]).optional(),
  max: z.union([z.number(), z.string()]).optional(),
});
export type CustomFormField = z.infer<typeof customFormFieldSchema>;

/** Shared formConfig shape — used by both create and update. Pulled out so the route loader,
 *  the edge-worker public endpoint, and the builder UI all infer the same type. */
export const formConfigSchema = z.object({
  // Display customization (used by Edge Worker form rendering)
  heading: z.string().max(200).optional(),
  subtitle: z.string().max(500).optional(),
  buttonText: z.string().max(50).optional(),
  accentColor: z.string().max(20).optional(),
  successMessage: z.string().max(500).optional(),
  // Optional field visibility toggles for STANDARD fields. Custom fields are managed in `customFields`.
  showDeliveryAddress: z.boolean().optional(),
  showDeliveryNotes: z.boolean().optional(),
  showDeliveryState: z.boolean().optional(),
  showGender: z.boolean().optional(),
  showPreferredDeliveryDate: z.boolean().optional(),
  showPaymentMethod: z.boolean().optional(),
  // Custom options for select fields
  deliveryStateOptions: z.array(z.string().max(100)).max(50).optional(),
  preferredDeliveryDateOptions: z.array(z.string().max(100)).max(20).optional(),
  // Legacy: pre-builder advanced field array. Kept for backward compatibility — the new
  // builder writes to `customFields` instead.
  fields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.enum(['text', 'tel', 'email', 'textarea', 'select']),
    required: z.boolean().default(true),
    placeholder: z.string().optional(),
    options: z.array(z.string()).optional(),
  })).optional(),
  /** Form Builder output — arbitrary fields the Media Buyer adds to their public form. */
  customFields: z.array(customFormFieldSchema).max(50).optional(),
  thankYouUrl: z.string().url().optional(),
  /**
   * Optional success callback URL. When set, the Edge Worker redirects the buyer here
   * after a successful form submission instead of showing the default inline success
   * message. Useful for routing back to the Media Buyer's funnel thank-you page.
   * Must be a full http(s) URL — partial paths are rejected by the validator.
   */
  successCallbackUrl: z.string().url().optional(),
  maxQuantity: z.number().int().min(1).max(100).optional(),
});
export type FormConfig = z.infer<typeof formConfigSchema>;

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(200),
  productIds: z.array(z.string().uuid()).min(1, 'At least one product is required'),
  deploymentType: z.enum(['SNIPPET', 'IFRAME', 'HOSTED']).default('HOSTED'),
  formConfig: formConfigSchema.optional(),
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
