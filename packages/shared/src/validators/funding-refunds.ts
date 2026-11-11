import { z } from 'zod';

/**
 * Funding refunds, adjustments and reconciliation (mig 0361).
 *
 * Refund: a funding receiver returns unspent money to the person who funded
 * them, against ONE original funding. Adjustment: an approved credit/debit
 * correction. Reconciliation: opening, movements and closing balance for any
 * period, with month close per company.
 */

const optionalAssetUrl = z
  .union([z.literal(''), z.string().url()])
  .optional()
  .transform((v) => (v ? v : undefined));

const reasonText = z.string().trim().min(10, 'Reason must be at least 10 characters').max(500);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

// ── Refunds ─────────────────────────────────────────────────────────────────

export const FUNDING_REFUND_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED'] as const;
export type FundingRefundStatus = (typeof FUNDING_REFUND_STATUSES)[number];

/** Statuses that hold the amount out of the refunder's available balance. */
export const FUNDING_REFUND_HELD_STATUSES = ['PENDING', 'APPROVED'] as const;

export const requestFundingRefundSchema = z.object({
  fundingId: z.string().uuid(),
  amount: z.number().positive().max(1_000_000_000),
  reason: reasonText,
  receiptUrl: optionalAssetUrl,
});
export type RequestFundingRefundInput = z.infer<typeof requestFundingRefundSchema>;

export const reviewFundingRefundSchema = z
  .object({
    refundId: z.string().uuid(),
    action: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action !== 'REJECT' || (v.note?.length ?? 0) >= 10, {
    message: 'Rejection reason must be at least 10 characters',
    path: ['note'],
  });
export type ReviewFundingRefundInput = z.infer<typeof reviewFundingRefundSchema>;

export const fundingRefundIdSchema = z.object({ refundId: z.string().uuid() });
export type FundingRefundIdInput = z.infer<typeof fundingRefundIdSchema>;

export const listFundingRefundsSchema = z.object({
  /** mine = refunds I asked for; to_review = refunds owed to me (or I can act on); all = company view. */
  view: z.enum(['mine', 'to_review', 'all']).default('mine'),
  status: z.enum(FUNDING_REFUND_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListFundingRefundsInput = z.infer<typeof listFundingRefundsSchema>;

// ── Adjustments ─────────────────────────────────────────────────────────────

export const FUNDING_ADJUSTMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type FundingAdjustmentStatus = (typeof FUNDING_ADJUSTMENT_STATUSES)[number];

export const createFundingAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  direction: z.enum(['CREDIT', 'DEBIT']),
  amount: z.number().positive().max(1_000_000_000),
  reason: reasonText,
  relatedFundingId: z.string().uuid().optional(),
  /** YYYY-MM of the closed month this corrects. */
  relatedPeriodMonth: ym.optional(),
});
export type CreateFundingAdjustmentInput = z.infer<typeof createFundingAdjustmentSchema>;

export const reviewFundingAdjustmentSchema = z
  .object({
    adjustmentId: z.string().uuid(),
    action: z.enum(['APPROVE', 'REJECT']),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.action !== 'REJECT' || (v.note?.length ?? 0) >= 10, {
    message: 'Rejection reason must be at least 10 characters',
    path: ['note'],
  });
export type ReviewFundingAdjustmentInput = z.infer<typeof reviewFundingAdjustmentSchema>;

export const listFundingAdjustmentsSchema = z.object({
  status: z.enum(FUNDING_ADJUSTMENT_STATUSES).optional(),
  userId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListFundingAdjustmentsInput = z.infer<typeof listFundingAdjustmentsSchema>;

// ── Reconciliation ──────────────────────────────────────────────────────────

export const RECONCILIATION_VIEWS = ['day', 'week', 'month', 'custom', 'all'] as const;
export type ReconciliationView = (typeof RECONCILIATION_VIEWS)[number];

export const fundingReconciliationSchema = z.object({
  userId: z.string().uuid(),
  view: z.enum(RECONCILIATION_VIEWS).default('month'),
  /** Inclusive Lagos calendar dates. Omitted with view=all. */
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  /** Optional second period to compare against (inclusive Lagos dates). */
  compareStartDate: ymd.optional(),
  compareEndDate: ymd.optional(),
});
export type FundingReconciliationInput = z.infer<typeof fundingReconciliationSchema>;

export const closeFundingPeriodSchema = z.object({
  month: ym,
  note: z.string().trim().max(500).optional(),
});
export type CloseFundingPeriodInput = z.infer<typeof closeFundingPeriodSchema>;
