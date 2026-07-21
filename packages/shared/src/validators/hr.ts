import { z } from 'zod';
import { USER_ROLE } from '../enums';
import type { UserRole } from '../enums';

// ============================================
// Commission Plan Validators
// ============================================

/** Every assignable PostgreSQL user_role excluding legacy gaps — aligns with Drizzle pgEnum user_role. */
const USER_ROLE_TUPLE = Object.values(USER_ROLE) as [UserRole, ...UserRole[]];

export const commissionOrderRateTierSchema = z.object({
  fromOrder: z.number().int().min(1),
  /** Inclusive ceiling; omit or null = no upper bound. */
  toOrder: z.number().int().min(1).nullable().optional(),
  ratePerOrder: z.number().min(0),
});

export const commissionRulesSchema = z
  .object({
    baseSalary: z.number().min(0).optional(),
    baseThreshold: z.number().int().min(0).optional(),
    perOrderRate: z.number().min(0).optional(),
    deliveryRateThreshold: z.number().min(0).max(100).optional(),
    bonusPerExtraOrder: z.number().min(0).optional(),
    penaltyPerReturn: z.number().min(0).optional(),
    /** Multiplier on `bonusPerExtraOrder` inside the delivery-rate accelerator (legacy default 50% = 0.5). */
    deliveryRateBonusMultiplier: z.number().min(0).max(10).optional(),
    /** Per-delivered-unit marginal rates. When non-empty, replaces flat `perOrderRate × count`. */
    orderRateTiers: z.array(commissionOrderRateTierSchema).max(12).optional(),
    minPerformanceBonus: z.number().min(0).optional(),
    maxPerformanceBonus: z.number().min(0).optional(),
  })
  .superRefine((r, ctx) => {
    if (r.orderRateTiers?.length && r.perOrderRate != null && r.perOrderRate > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Remove flat per-order rate when using order rate tiers.',
        path: ['orderRateTiers'],
      });
    }
    const tiers = r.orderRateTiers;
    if (tiers?.length) {
      for (let i = 0; i < tiers.length; i += 1) {
        const t = tiers[i]!;
        if (t.toOrder != null && t.toOrder < t.fromOrder) {
          ctx.addIssue({
            code: 'custom',
            message: `Tier ${i + 1}: toOrder must be ≥ fromOrder`,
            path: ['orderRateTiers', i, 'toOrder'],
          });
        }
      }
    }
    if (
      r.minPerformanceBonus != null &&
      r.maxPerformanceBonus != null &&
      r.maxPerformanceBonus < r.minPerformanceBonus
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'maxPerformanceBonus cannot be less than minPerformanceBonus',
        path: ['maxPerformanceBonus'],
      });
    }
  });

export type CommissionRules = z.infer<typeof commissionRulesSchema>;

/** `null`/omit before enum = per-user assignment only (linked from `users.commission_plan_id`). */
export const createCommissionPlanSchema = z.object({
  role: z.preprocess((v: unknown) => (v === '' || v === undefined ? null : v), z.enum(USER_ROLE_TUPLE).nullable()),
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
  /** When true, only plans where `role` IS NULL (per-user templates). */
  unassignedRoleOnly: z.boolean().optional(),
  activeOnly: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
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
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED']).optional(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
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

// ============================================
// Payroll Batch Validators (multi-stage monthly workflow)
// ============================================

export const payrollDepartmentSchema = z.enum(['CS', 'MARKETING', 'LOGISTICS', 'HR']);
export type PayrollDepartment = z.infer<typeof payrollDepartmentSchema>;

export const payrollBatchStatusSchema = z.enum([
  'DRAFT',
  'PENDING_HR',
  'PENDING_FINANCE',
  'PAID',
]);
export type PayrollBatchStatus = z.infer<typeof payrollBatchStatusSchema>;

/** First day of the month, e.g. "2026-04-01". */
const periodMonthSchema = z.string().regex(/^\d{4}-\d{2}-01$/, 'periodMonth must be YYYY-MM-01');

export const generateBatchSchema = z.object({
  branchId: z.string().uuid(),
  department: payrollDepartmentSchema,
  periodMonth: periodMonthSchema,
});
export type GenerateBatchInput = z.infer<typeof generateBatchSchema>;

/** Fan-out: create missing batches only (skipped if a row already exists for the slot). */
export const generateBatchesBulkSchema = z.object({
  branchIds: z.array(z.string().uuid()).min(1).max(50),
  departments: z.array(payrollDepartmentSchema).min(1).max(4),
  periodMonth: periodMonthSchema,
});
export type GenerateBatchesBulkInput = z.infer<typeof generateBatchesBulkSchema>;

export const submitBatchSchema = z.object({
  batchId: z.string().uuid(),
});
export type SubmitBatchInput = z.infer<typeof submitBatchSchema>;

export const approveBatchSchema = z.object({
  batchId: z.string().uuid(),
  hrNotes: z.string().max(1000).optional(),
});
export type ApproveBatchInput = z.infer<typeof approveBatchSchema>;

export const rejectBatchSchema = z.object({
  batchId: z.string().uuid(),
  reason: z.string().min(10, 'Reject reason must be at least 10 characters').max(1000),
});
export type RejectBatchInput = z.infer<typeof rejectBatchSchema>;

export const markBatchPaidSchema = z.object({
  batchId: z.string().uuid(),
  financeReference: z.string().min(2).max(200),
});
export type MarkBatchPaidInput = z.infer<typeof markBatchPaidSchema>;

/**
 * List monthly payrolls. Scope filters are optional — the service narrows further
 * based on the viewer's role (HoDs see only their dept; Finance sees PENDING_FINANCE+).
 */
export const listMonthlyPayrollsSchema = z.object({
  fromMonth: periodMonthSchema.optional(),
  toMonth: periodMonthSchema.optional(),
  branchId: z.string().uuid().optional(),
  department: payrollDepartmentSchema.optional(),
  status: payrollBatchStatusSchema.optional(),
});
export type ListMonthlyPayrollsInput = z.infer<typeof listMonthlyPayrollsSchema>;

export const getBatchSchema = z.object({
  batchId: z.string().uuid(),
});
export type GetBatchInput = z.infer<typeof getBatchSchema>;

/**
 * HR-added per-staff adjustment during PENDING_HR review. Routes through the
 * existing earnings_adjustments table so the per-staff trail stays canonical.
 */
export const addBatchAdjustmentSchema = z.object({
  batchId: z.string().uuid(),
  payoutId: z.string().uuid(),
  amount: z.coerce.number().multipleOf(0.01),
  category: z.enum(['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'DEDUCTION', 'CLAWBACK', 'OTHER']),
  reason: z.string().min(5).max(500),
});
export type AddBatchAdjustmentInput = z.infer<typeof addBatchAdjustmentSchema>;
