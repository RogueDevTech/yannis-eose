import { z } from 'zod';

// ============================================
// Commission Plan Validators
// ============================================

export const commissionRulesSchema = z.object({
  baseSalary: z.number().min(0).optional(),
  baseThreshold: z.number().int().min(0).optional(),
  perOrderRate: z.number().min(0).optional(),
  deliveryRateThreshold: z.number().min(0).max(100).optional(),
  bonusPerExtraOrder: z.number().min(0).optional(),
  penaltyPerReturn: z.number().min(0).optional(),
});

export const createCommissionPlanSchema = z.object({
  role: z.string().min(1),
  planName: z.string().min(2).max(200),
  rules: commissionRulesSchema,
  effectiveFrom: z.string().date(),
  effectiveTo: z.string().date().optional(),
});
export type CreateCommissionPlanInput = z.infer<typeof createCommissionPlanSchema>;

export const updateCommissionPlanSchema = z.object({
  planId: z.string().uuid(),
  planName: z.string().min(2).max(200).optional(),
  rules: commissionRulesSchema.optional(),
  effectiveTo: z.string().date().optional(),
});
export type UpdateCommissionPlanInput = z.infer<typeof updateCommissionPlanSchema>;

export const listCommissionPlansSchema = z.object({
  role: z.string().optional(),
  activeOnly: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListCommissionPlansInput = z.infer<typeof listCommissionPlansSchema>;

// ============================================
// Payout Validators
// ============================================

export const generatePayoutsSchema = z.object({
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
});
export type GeneratePayoutsInput = z.infer<typeof generatePayoutsSchema>;

export const approvePayoutSchema = z.object({
  payoutId: z.string().uuid(),
  status: z.enum(['APPROVED', 'PAID', 'REJECTED']),
  notes: z.string().max(500).optional(),
});
export type ApprovePayoutInput = z.infer<typeof approvePayoutSchema>;

export const listPayoutsSchema = z.object({
  staffId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PAID', 'REJECTED']).optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListPayoutsInput = z.infer<typeof listPayoutsSchema>;

// ============================================
// Earnings Adjustment Validators
// ============================================

export const createAdjustmentSchema = z.object({
  staffId: z.string().uuid(),
  amount: z.coerce.number().min(0).multipleOf(0.01),
  category: z.enum(['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'DEDUCTION', 'CLAWBACK', 'OTHER']),
  reason: z.string().min(5).max(500),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
});
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;

export const approveAdjustmentSchema = z.object({
  adjustmentId: z.string().uuid(),
  approved: z.boolean(),
});
export type ApproveAdjustmentInput = z.infer<typeof approveAdjustmentSchema>;

// ============================================
// Settlement Window Config Validators
// ============================================

export const setSettlementConfigSchema = z.object({
  windowType: z.enum(['WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  startDay: z.number().int().min(1).max(31), // day of week (1-7) for WEEKLY/BIWEEKLY, day of month (1-31) for MONTHLY
});
export type SetSettlementConfigInput = z.infer<typeof setSettlementConfigSchema>;
