import { z } from 'zod';
import { MAX_OFFER_TIER_IMAGES } from './products';

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

/** Same date scope as listFundingRequests (createdAt); requester filters mirror the list API. */
export const fundingRequestStatusCountsSchema = z.object({
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  /** When set, count only requests where requester = this id ("my requests" view). */
  requesterId: z.string().uuid().optional(),
  /** When true, count only requests submitted BY *other* users than the caller — i.e.
   * MB requests pending approval from HoM ("inbox" view). Mutually exclusive with `requesterId`. */
  excludeSelfAsRequester: z.boolean().optional(),
  /** Migration 0106 — count only requests targeted at this user (post-broadcast flow). */
  targetUserId: z.string().uuid().optional(),
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
  /** Migration 0106 — list only requests targeted at this user. The router auto-applies
   * this for non-admin viewers so they only see their own inbox. */
  targetUserId: z.string().uuid().optional(),
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
  /** Amount actually sent (must be ≤ requested amount; server enforces cap). */
  amount: z.coerce.number().positive().multipleOf(0.01),
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

export const adPlatformValues = ['FACEBOOK', 'TIKTOK', 'GOOGLE', 'OTHER'] as const;
export type AdPlatform = (typeof adPlatformValues)[number];
export const adPlatformSchema = z.enum(adPlatformValues);

/** Optional MB-supplied label when platform is OTHER; blank → undefined. */
const platformCustomLabelSchema = z
  .union([z.literal(''), z.string().trim().max(80)])
  .optional()
  .transform((v) => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined));

/** Optional URL — accepts blank, http(s), and rejects everything else. */
const adUrlSchema = z
  .union([z.literal(''), z.string().url()])
  .optional()
  .transform((v) => (v ? v : undefined));

const createAdSpendObjectSchema = z.object({
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  spendAmount: z.coerce.number().min(0).multipleOf(0.01),
  screenshotUrl: z.string().url().min(1),
  spendDate: z.string().date(),
  notes: z.string().max(500).optional(),
  platform: adPlatformSchema.default('FACEBOOK'),
  platformCustomLabel: platformCustomLabelSchema,
  adUrl: adUrlSchema,
});

const refineAdSpendPlatform = (data: { platform: AdPlatform; platformCustomLabel?: string | undefined }, ctx: z.RefinementCtx) => {
  if (data.platform === 'OTHER' && !data.platformCustomLabel) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Enter the platform name when Other is selected',
      path: ['platformCustomLabel'],
    });
  }
};

export const createAdSpendSchema = createAdSpendObjectSchema.superRefine(refineAdSpendPlatform);
export type CreateAdSpendInput = z.infer<typeof createAdSpendSchema>;

/** tRPC `createAdSpend` input — same as `createAdSpendSchema` plus optional explicit branch. */
export const createAdSpendWithBranchSchema = createAdSpendObjectSchema
  .extend({ branchId: z.string().uuid().optional() })
  .superRefine(refineAdSpendPlatform);

/** Log ad spend from the admin UI — campaign and product required (stricter than optional API fields). */
export const createAdSpendLogFormSchema = createAdSpendObjectSchema
  .merge(
    z.object({
      campaignId: z.string().uuid(),
      productId: z.string().uuid(),
    }),
  )
  .superRefine(refineAdSpendPlatform);
export type CreateAdSpendLogFormInput = z.infer<typeof createAdSpendLogFormSchema>;

const adSpendBatchLineSchema = z.object({
  productId: z.string().uuid(),
  spendAmount: z.coerce.number().min(0).multipleOf(0.01),
  /**
   * Manual order-split entered by the Media Buyer (CEO directive 2026-05-08).
   * Server validates that the sum across lines equals the form-level order
   * count the system shows for this (campaign, mediaBuyer, spendDate window).
   */
  attributedOrderCount: z.coerce.number().int().min(0),
  // CEO directive 2026-05-10: ad URL is now the required evidence (proof the
  // ad ran), screenshot is optional supporting material. Empty/whitespace
  // collapses to undefined; the service writes '' to satisfy the column's
  // NOT NULL constraint without changing the DB schema.
  screenshotUrl: z
    .union([z.literal(''), z.string().url()])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  platform: adPlatformSchema.default('FACEBOOK'),
  platformCustomLabel: platformCustomLabelSchema,
  adUrl: z.string().trim().url('Ad URL must be a valid URL'),
});

const createAdSpendBatchObjectSchema = z.object({
  spendDate: z.string().date(),
  /** One form (campaign) per batch — every line in `lines` belongs to it. */
  campaignId: z.string().uuid(),
  lines: z
    .array(adSpendBatchLineSchema)
    .min(1, 'Add at least one ad')
    .max(50, 'Up to 50 lines per submission'),
});

const refineAdSpendBatchLines = (
  data: {
    lines: Array<{
      platform: AdPlatform;
      platformCustomLabel?: string | undefined;
      attributedOrderCount: number;
    }>;
  },
  ctx: z.RefinementCtx,
) => {
  data.lines.forEach((line, i) => {
    if (line.platform === 'OTHER' && !line.platformCustomLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter the platform name when Other is selected',
        path: ['lines', i, 'platformCustomLabel'],
      });
    }
  });
  // Sum-vs-system-total check happens in the service layer (where we can hit
  // the DB to look up the form's actual count). This refinement only does
  // shape-level checks that don't need the DB.
};

/**
 * Multi-line "Add Expense" submission — one shared spendDate, N line items
 * (each: campaign + product + amount + platform + optional adUrl + screenshot).
 * Server writes all rows in a single transaction; HoM gets ONE notification
 * for the whole batch, not one per line.
 */
export const createAdSpendBatchSchema = createAdSpendBatchObjectSchema.superRefine(refineAdSpendBatchLines);
export type CreateAdSpendBatchInput = z.infer<typeof createAdSpendBatchSchema>;

/** tRPC `createAdSpendBatch` input — optional explicit branch for org-wide heads. */
export const createAdSpendBatchWithBranchSchema = createAdSpendBatchObjectSchema
  .extend({ branchId: z.string().uuid().optional() })
  .superRefine(refineAdSpendBatchLines);

export const listAdSpendSchema = z.object({
  mediaBuyerId: z.string().uuid().optional(),
  /** Server-side supervisor scoping: limit to ad spend where mediaBuyerId is in this set. */
  mediaBuyerIds: z.array(z.string().uuid()).max(2000).optional(),
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListAdSpendInput = z.infer<typeof listAdSpendSchema>;

/** Grouped accordion (`listAdSpendGrouped`) — same filter dimensions as `listAdSpend`, separate pagination. */
export const listAdSpendGroupedSchema = z.object({
  mediaBuyerId: z.string().uuid().optional(),
  mediaBuyerIds: z.array(z.string().uuid()).max(2000).optional(),
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(50).default(20),
});
export type ListAdSpendGroupedInput = z.infer<typeof listAdSpendGroupedSchema>;

/** Scope for ad spend status counts — matches listAdSpend filters except status. */
export const adSpendStatusCountsSchema = z.object({
  mediaBuyerId: z.string().uuid().optional(),
  mediaBuyerIds: z.array(z.string().uuid()).max(2000).optional(),
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

export const rejectAdSpendSchema = z.object({
  adSpendId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type RejectAdSpendInput = z.infer<typeof rejectAdSpendSchema>;

export const updateAdSpendSchema = z.object({
  adSpendId: z.string().uuid(),
  spendAmount: z.coerce.number().min(0).multipleOf(0.01),
  screenshotUrl: z.string().url().min(1),
  spendDate: z.string().date(),
  productId: z.string().uuid().optional(),
  campaignId: z.string().uuid().optional(),
});
export type UpdateAdSpendInput = z.infer<typeof updateAdSpendSchema>;

/** Preview: orders since last APPROVED spend (calendar day before spendDate) + indicative CPA. */
export const previewAdSpendIntervalSchema = z.object({
  campaignId: z.string().uuid(),
  productId: z.string().uuid(),
  spendDate: z.string().date(),
  spendAmount: z.coerce.number().min(0).multipleOf(0.01).optional(),
});
export type PreviewAdSpendIntervalInput = z.infer<typeof previewAdSpendIntervalSchema>;

/**
 * Form-level order total for the Add Expense modal (CEO directive 2026-05-08).
 * Returns the count of orders attributed to (campaign, mediaBuyer) that arrived
 * AFTER the most recent APPROVED ad spend on the same campaign, up to spendDate.
 * The Media Buyer splits this number across their batch lines.
 */
export const campaignOrderTotalForBatchSchema = z.object({
  campaignId: z.string().uuid(),
  spendDate: z.string().date(),
});
export type CampaignOrderTotalForBatchInput = z.infer<typeof campaignOrderTotalForBatchSchema>;

// ============================================
// Offer Template Validators
// ============================================

const offerTemplateImagesSchema = z
  .array(z.string().url())
  .max(MAX_OFFER_TIER_IMAGES)
  .optional()
  .transform((v) => (Array.isArray(v) ? v : []));

export const createOfferTemplateSchema = z.object({
  productId: z.string().uuid(),
  name: z.string().min(1, 'Template name is required').max(200),
  price: z.coerce.number().min(0).multipleOf(0.01),
  quantity: z.number().int().min(1).optional().default(1),
  imageUrls: offerTemplateImagesSchema,
  variants: z.record(z.unknown()).optional(),
});
export type CreateOfferTemplateInput = z.infer<typeof createOfferTemplateSchema>;

export const updateOfferTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  price: z.coerce.number().min(0).multipleOf(0.01).optional(),
  quantity: z.number().int().min(1).optional(),
  imageUrls: offerTemplateImagesSchema.optional(),
  variants: z.record(z.unknown()).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
});
export type UpdateOfferTemplateInput = z.infer<typeof updateOfferTemplateSchema>;

export const listOfferTemplatesSchema = z.object({
  productId: z.string().uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  /** Hub page loads up to 250 rows; per-product screens use smaller pages. */
  limit: z.number().int().min(1).max(250).default(20),
});
export type ListOfferTemplatesInput = z.infer<typeof listOfferTemplatesSchema>;

/** Bulk-archive ACTIVE + INACTIVE tiers for a product (clears campaign tier picks / legacy FK). */
export const archiveAllOfferTemplatesForProductSchema = z.object({
  productId: z.string().uuid(),
});
export type ArchiveAllOfferTemplatesForProductInput = z.infer<
  typeof archiveAllOfferTemplatesForProductSchema
>;

// ============================================
// Offer Groups (multi-item offers)
// ============================================

const offerGroupItemSchema = z.object({
  productId: z.string().uuid(),
  label: z.string().trim().min(1, 'Label is required').max(200),
  quantity: z.number().int().min(1).default(1),
  price: z.coerce.number().min(0).multipleOf(0.01),
  /** Optional image URL selected from the product's gallery. */
  imageUrl: z.union([z.literal(''), z.string().url()]).optional().transform((v) => (v ? v : undefined)),
  sortOrder: z.number().int().min(0).optional(),
});

export const createOfferGroupSchema = z.object({
  name: z.string().trim().min(1, 'Offer name is required').max(200),
  items: z.array(offerGroupItemSchema).min(1, 'Add at least one offer item').max(50),
});
export type CreateOfferGroupInput = z.infer<typeof createOfferGroupSchema>;

export const updateOfferGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  /** Full replace of items for now (simple + safe). */
  items: z.array(offerGroupItemSchema).min(1).max(50).optional(),
});
export type UpdateOfferGroupInput = z.infer<typeof updateOfferGroupSchema>;

export const getOfferGroupSchema = z.object({ id: z.string().uuid() });
export type GetOfferGroupInput = z.infer<typeof getOfferGroupSchema>;

export const listOfferGroupsSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(250).default(20),
});
export type ListOfferGroupsInput = z.infer<typeof listOfferGroupsSchema>;

export const clearLegacyOfferTemplatesSchema = z.object({
  /** When true, detach campaigns from offer_template_id and clear selectedOfferTemplateIds in formConfig. */
  detachCampaigns: z.boolean().optional().default(true),
});
export type ClearLegacyOfferTemplatesInput = z.infer<typeof clearLegacyOfferTemplatesSchema>;

// ============================================
// Campaign Validators
// ============================================

/**
 * Custom field on a campaign's public form. Configured when creating a form (`/admin/marketing/forms/new`)
 * or editing one (`/admin/marketing/forms/:id/edit`). Customer responses land in `orders.custom_fields`
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

export const STANDARD_FIELD_KEYS = [
  'deliveryAddress',
  'deliveryNotes',
  'deliveryState',
  'gender',
  'preferredDeliveryDate',
  'customerEmail',
  'paymentMethod',
] as const;
export const standardFormFieldSchema = z.object({
  key: z.enum(STANDARD_FIELD_KEYS),
  required: z.boolean().default(false),
});

/**
 * When a field is `required`, the submitted answer must be non-empty in the type-specific sense.
 * Aligns with Edge `required` + checkbox-group / toggle checks; used on `orders.create` as a
 * backstop when API clients skip browser validation.
 */
export function getMissingRequiredCustomFormLabels(
  fields: CustomFormField[],
  answers: Record<string, unknown> | null | undefined,
): string[] {
  const a = answers ?? {};
  const missing: string[] = [];
  for (const f of fields) {
    if (f.required !== true) continue;
    if (customFormAnswerSatisfied(f.type, a[f.id])) continue;
    missing.push(f.label);
  }
  return missing;
}

function customFormAnswerSatisfied(type: FormFieldType, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  switch (type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'date':
    case 'dropdown':
    case 'radio':
      return typeof value === 'string' && value.trim().length > 0;
    case 'phone':
      // Phone answers must be digits only (allow `+`, spaces, dashes,
      // parentheses for formatting). At least 4 digits after stripping
      // formatters — anything shorter isn't a real phone.
      if (typeof value !== 'string') return false;
      if (!/^[\d+\-\s()]+$/.test(value.trim())) return false;
      return value.replace(/\D/g, '').length >= 4;
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return true;
      if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return true;
      return false;
    }
    case 'checkbox_group':
      return Array.isArray(value) && value.length > 0;
    case 'toggle':
      return value === true;
    default:
      return false;
  }
}

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
  showCustomerEmail: z.boolean().optional(),
  showPaymentMethod: z.boolean().optional(),
  showProductImages: z.boolean().optional(),
  requireDeliveryAddress: z.boolean().optional(),
  requireDeliveryNotes: z.boolean().optional(),
  requireDeliveryState: z.boolean().optional(),
  requireGender: z.boolean().optional(),
  requirePreferredDeliveryDate: z.boolean().optional(),
  requireCustomerEmail: z.boolean().optional(),
  requirePaymentMethod: z.boolean().optional(),
  // Custom options for select fields (additional / standard fields on the public form)
  deliveryStateOptions: z.array(z.string().max(100)).max(50).optional(),
  preferredDeliveryDateOptions: z.array(z.string().max(100)).max(20).optional(),
  genderOptions: z.array(z.string().max(100)).max(20).optional(),
  standardFields: z.array(standardFormFieldSchema).max(STANDARD_FIELD_KEYS.length).optional(),
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
  /** Limit which `offer_templates` tiers appear on the Edge form (same product as campaign). Empty = all ACTIVE. */
  selectedOfferTemplateIds: z.array(z.string().uuid()).max(50).optional(),
});
export type FormConfig = z.infer<typeof formConfigSchema>;

const createCampaignFieldsSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(200),
  /**
   * Legacy path when `offerGroupId` is omitted. Minimum one id (often a single product).
   * When `offerGroupId` is set, the API derives product ids from the offer — client may omit this.
   */
  productIds: z.array(z.string().uuid()).max(50).optional(),
  /** When set, server derives ordered distinct `productIds` from active `offer_group_items`. */
  offerGroupId: z.string().uuid().optional(),
  deploymentType: z.enum(['SNIPPET', 'IFRAME', 'HOSTED']).default('HOSTED'),
  formConfig: formConfigSchema.optional(),
});

function refineCreateCampaignFields(data: z.infer<typeof createCampaignFieldsSchema>, ctx: z.RefinementCtx) {
  if (data.offerGroupId) {
    return;
  }
  if (!data.productIds || data.productIds.length < 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide offerGroupId or at least one product id.',
      path: ['productIds'],
    });
  }
}

/** Input for `marketing.createCampaign` (no `branchId`). */
export const createCampaignSchema = createCampaignFieldsSchema.superRefine(refineCreateCampaignFields);
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

/** tRPC router: same as `createCampaignSchema` plus optional session branch override. */
export const createCampaignProcedureSchema = createCampaignFieldsSchema
  .extend({
    branchId: z.string().uuid().optional(),
  })
  .superRefine(refineCreateCampaignFields);

export const updateCampaignSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  formConfig: z.record(z.unknown()).optional(),
  offerGroupId: z.string().uuid().nullable().optional(),
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
