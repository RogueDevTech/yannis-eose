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
  // Accept a plain calendar date (YYYY-MM-DD) OR a full ISO datetime. Callers
  // scoping to a timezone-anchored month (e.g. Lagos) must pass the exact
  // instant: a bare date is read as UTC midnight and would exclude a period
  // stored at 2026-06-30T23:00Z (= 2026-07-01 00:00 +01:00).
  periodStart: z.union([z.string().date(), z.string().datetime()]).optional(),
  periodEnd: z.union([z.string().date(), z.string().datetime()]).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(20),
});
export type ListPayoutsInput = z.infer<typeof listPayoutsSchema>;

// ============================================
// Earnings Adjustment Validators
// ============================================

/** Categories that reduce earnings. Everything else adds to earnings. */
export const DEDUCTION_ADJUSTMENT_CATEGORIES = ['DEDUCTION', 'CLAWBACK'] as const;

export const createAdjustmentSchema = z
  .object({
    // Target is either a staff user OR an external contractor — exactly one.
    staffId: z.string().uuid().optional(),
    contractorId: z.string().uuid().optional(),
    // Deductions may be entered as a negative amount; add-ons as positive.
    // The refine below reconciles the sign with the chosen category.
    amount: z.coerce.number().multipleOf(0.01),
    category: z.enum(['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'DEDUCTION', 'CLAWBACK', 'OTHER']),
    reason: z.string().min(5).max(500),
    // Target payroll month (YYYY-MM-01). REQUIRED: every adjustment must name the
    // month whose batch it belongs to, so it can never silently float into an
    // unrelated batch (which previously zeroed out unrelated staff). The prior
    // "omit to attach to the next batch" behaviour is retired.
    periodMonth: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/, 'Select the target payroll month'),
    periodStart: z.string().date().optional(),
    periodEnd: z.string().date().optional(),
  })
  .refine((data) => (data.staffId ? 1 : 0) + (data.contractorId ? 1 : 0) === 1, {
    message: 'Select exactly one staff member or contractor',
    path: ['staffId'],
  })
  .transform((data) => {
    // Canonicalise the sign so storage/payroll math is unambiguous:
    // deduction categories are stored negative, add-on categories positive.
    const isDeduction = (DEDUCTION_ADJUSTMENT_CATEGORIES as readonly string[]).includes(data.category);
    const magnitude = Math.abs(data.amount);
    return { ...data, amount: isDeduction ? -magnitude : magnitude };
  })
  .refine((data) => data.amount !== 0, {
    message: 'Amount must not be zero',
    path: ['amount'],
  });
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;

export const approveAdjustmentSchema = z.object({
  adjustmentId: z.string().uuid(),
  approved: z.boolean(),
});
export type ApproveAdjustmentInput = z.infer<typeof approveAdjustmentSchema>;

/**
 * Edit an existing adjustment. Only the correctable fields are accepted; the
 * target party (staff/contractor) can't be swapped. Sign is re-canonicalised
 * from the (possibly new) category, mirroring createAdjustmentSchema. Editing is
 * blocked server-side once the adjustment has advanced into a PENDING_FINANCE or
 * PAID batch.
 */
export const updateAdjustmentSchema = z
  .object({
    adjustmentId: z.string().uuid(),
    amount: z.coerce.number().multipleOf(0.01),
    category: z.enum(['BONUS', 'EXTRA_SHIFT', 'PERFORMANCE', 'DEDUCTION', 'CLAWBACK', 'OTHER']),
    reason: z.string().min(5).max(500),
    periodMonth: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/, 'periodMonth must be YYYY-MM-01')
      .optional(),
  })
  .transform((data) => {
    const isDeduction = (DEDUCTION_ADJUSTMENT_CATEGORIES as readonly string[]).includes(data.category);
    const magnitude = Math.abs(data.amount);
    return { ...data, amount: isDeduction ? -magnitude : magnitude };
  })
  .refine((data) => data.amount !== 0, {
    message: 'Amount must not be zero',
    path: ['amount'],
  });
export type UpdateAdjustmentInput = z.infer<typeof updateAdjustmentSchema>;

export const deleteAdjustmentSchema = z.object({
  adjustmentId: z.string().uuid(),
});
export type DeleteAdjustmentInput = z.infer<typeof deleteAdjustmentSchema>;

// ============================================
// Staff Refund Validators (post-tax, doc §2)
// ============================================

/**
 * Record a refund owed to a staff member. Refunds are POST-TAX cash added to net
 * pay (never taxed), recorded by HR and approved on creation. `amount` is always
 * positive — a refund only ever adds to pay.
 */
export const createRefundSchema = z.object({
  staffId: z.string().uuid(),
  amount: z.coerce.number().multipleOf(0.01).positive('Refund amount must be greater than zero'),
  reason: z.string().min(3).max(200),
  notes: z.string().max(1000).optional(),
  docUrl: z.string().url().optional(),
  // Date the refund was incurred/approved.
  refundDate: z.string().date(),
  // Target payroll month (YYYY-MM-01) whose batch this refund settles in.
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/, 'Select the target payroll month'),
});
export type CreateRefundInput = z.infer<typeof createRefundSchema>;

/** Edit a refund. Blocked server-side once swept into a PENDING_FINANCE/PAID batch. */
export const updateRefundSchema = z.object({
  refundId: z.string().uuid(),
  amount: z.coerce.number().multipleOf(0.01).positive('Refund amount must be greater than zero'),
  reason: z.string().min(3).max(200),
  notes: z.string().max(1000).optional(),
  docUrl: z.string().url().optional(),
  refundDate: z.string().date(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/, 'periodMonth must be YYYY-MM-01').optional(),
});
export type UpdateRefundInput = z.infer<typeof updateRefundSchema>;

/** Void (soft-cancel) a refund without a hard delete, preserving the audit trail. */
export const voidRefundSchema = z.object({
  refundId: z.string().uuid(),
});
export type VoidRefundInput = z.infer<typeof voidRefundSchema>;

// ============================================
// Per-staff Allowance Validators (taxable, doc §3)
// ============================================

/**
 * Record a per-staff ad-hoc allowance. Allowances are TAXABLE earnings added to
 * gross before PAYE, on top of role allowances. `recurring` allowances prorate by
 * active days; one-time allowances are paid in full. Amount is always positive.
 */
export const createStaffAllowanceSchema = z.object({
  staffId: z.string().uuid(),
  amount: z.coerce.number().multipleOf(0.01).positive('Allowance amount must be greater than zero'),
  name: z.string().min(2).max(100),
  notes: z.string().max(1000).optional(),
  recurring: z.coerce.boolean().default(false),
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/, 'Select the target payroll month'),
});
export type CreateStaffAllowanceInput = z.infer<typeof createStaffAllowanceSchema>;

/** Edit an allowance. Blocked server-side once swept into a PENDING_FINANCE/PAID batch. */
export const updateStaffAllowanceSchema = z.object({
  allowanceId: z.string().uuid(),
  amount: z.coerce.number().multipleOf(0.01).positive('Allowance amount must be greater than zero'),
  name: z.string().min(2).max(100),
  notes: z.string().max(1000).optional(),
  recurring: z.coerce.boolean().default(false),
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/, 'periodMonth must be YYYY-MM-01').optional(),
});
export type UpdateStaffAllowanceInput = z.infer<typeof updateStaffAllowanceSchema>;

/** Void (soft-cancel) a per-staff allowance, preserving the audit trail. */
export const voidStaffAllowanceSchema = z.object({
  allowanceId: z.string().uuid(),
});
export type VoidStaffAllowanceInput = z.infer<typeof voidStaffAllowanceSchema>;

// ============================================
// Staff Tax Document Validators (doc §5)
// ============================================

export const taxDocumentTypeSchema = z.enum([
  'TIN_CERTIFICATE',
  'TAX_CARD',
  'PAYE_RECEIPT',
  'TAX_CLEARANCE',
  'OTHER',
]);
export type TaxDocumentType = z.infer<typeof taxDocumentTypeSchema>;

/** Record a tax document for a staff member. The file is already uploaded to GCS. */
export const createTaxDocumentSchema = z.object({
  staffId: z.string().uuid(),
  docType: taxDocumentTypeSchema,
  title: z.string().min(2).max(150),
  docUrl: z.string().url(),
  notes: z.string().max(1000).optional(),
  expiresOn: z.string().date().optional(),
});
export type CreateTaxDocumentInput = z.infer<typeof createTaxDocumentSchema>;

/** Delete a tax document (hard delete — the audit trail lives in the history twin). */
export const deleteTaxDocumentSchema = z.object({
  documentId: z.string().uuid(),
});
export type DeleteTaxDocumentInput = z.infer<typeof deleteTaxDocumentSchema>;

/** List tax documents for one staff member. */
export const listTaxDocumentsSchema = z.object({
  staffId: z.string().uuid(),
});
export type ListTaxDocumentsInput = z.infer<typeof listTaxDocumentsSchema>;

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

export const payrollDepartmentSchema = z.enum(['CS', 'MARKETING', 'LOGISTICS', 'HR', 'OPERATIONS', 'FINANCE', 'SUPPORT']);
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

export const payrollBatchScopeTypeSchema = z.enum([
  'ALL_BRANCHES',
  'BRANCHES',
  'EMPLOYEES',
  'DEPARTMENT',
  'CONTRACTORS',
  'ALL',
]);

/** Null-scope batches carry no department (and often no branch). */
const isNullScopeType = (t: string | undefined): boolean =>
  t === 'CONTRACTORS' || t === 'ALL';

export const generateBatchSchema = z
  .object({
    // Optional for null-scope batches. A CONTRACTORS batch may still set branchId
    // (a Head running their own branch's contractors); ALL never does.
    branchId: z.string().uuid().optional(),
    department: payrollDepartmentSchema.optional(),
    periodMonth: periodMonthSchema,
    scopeType: payrollBatchScopeTypeSchema.default('DEPARTMENT').optional(),
    scopeBranchIds: z.array(z.string().uuid()).optional(),
    scopeEmployeeIds: z.array(z.string().uuid()).optional(),
    includeContractors: z.boolean().default(false).optional(),
    // Also sweep matching-role staff who have no primary branch (primary_branch_id
    // NULL) into this department batch — they ride along on the home branch.
    includeNullBranch: z.boolean().default(false).optional(),
    runLabel: z.string().max(200).optional(),
  })
  .refine((d) => isNullScopeType(d.scopeType) || (!!d.branchId && !!d.department), {
    message: 'branchId and department are required for a staff (department-scoped) batch.',
    path: ['department'],
  })
  .refine((d) => d.scopeType !== 'ALL' || (!d.branchId && !d.department), {
    message: 'An ALL-scope batch cannot target a specific branch or department.',
    path: ['scopeType'],
  })
  .refine((d) => d.scopeType !== 'CONTRACTORS' || !d.department, {
    message: 'A CONTRACTORS batch cannot target a department.',
    path: ['department'],
  });
export type GenerateBatchInput = z.infer<typeof generateBatchSchema>;

/**
 * Grand-total preview for a whole selection. Looser than generateBatchSchema: a
 * staff preview may target several departments via `departments[]` (a fan-out)
 * instead of a single `department`, so it does not require branchId+department.
 */
export const previewSelectionSchema = z
  .object({
    branchId: z.string().uuid().optional(),
    department: payrollDepartmentSchema.optional(),
    departments: z.array(payrollDepartmentSchema).optional(),
    periodMonth: periodMonthSchema,
    scopeType: payrollBatchScopeTypeSchema.optional(),
    scopeBranchIds: z.array(z.string().uuid()).optional(),
    includeNullBranch: z.boolean().default(false).optional(),
  })
  .refine(
    (d) =>
      isNullScopeType(d.scopeType) ||
      !!d.department ||
      (d.departments?.length ?? 0) > 0,
    {
      message: 'Select at least one department to preview a staff run.',
      path: ['departments'],
    },
  );
export type PreviewSelectionInput = z.infer<typeof previewSelectionSchema>;

/** Fan-out: create missing batches only (skipped if a row already exists for the slot). */
export const generateBatchesBulkSchema = z
  .object({
    // Empty allowed only for a null-scope run (CONTRACTORS / ALL); a staff fan-out
    // still requires at least one branch and one department.
    branchIds: z.array(z.string().uuid()).max(50).default([]),
    departments: z.array(payrollDepartmentSchema).max(7).default([]),
    periodMonth: periodMonthSchema,
    /**
     * When true, each department gets ONE batch spanning all `branchIds`
     * (`scopeType: BRANCHES`) instead of one batch per branch × department.
     */
    combineBranches: z.boolean().default(false).optional(),
    /** CONTRACTORS / ALL create a single null-scope batch instead of a fan-out. */
    scopeType: payrollBatchScopeTypeSchema.optional(),
    includeContractors: z.boolean().default(false).optional(),
    /** Sweep no-branch staff into each department's home-branch batch. */
    includeNullBranch: z.boolean().default(false).optional(),
    runLabel: z.string().max(200).optional(),
  })
  .refine(
    (d) => isNullScopeType(d.scopeType) || (d.branchIds.length >= 1 && d.departments.length >= 1),
    {
      message: 'Select at least one branch and one department.',
      path: ['departments'],
    },
  );
export type GenerateBatchesBulkInput = z.infer<typeof generateBatchesBulkSchema>;

export const submitBatchSchema = z.object({
  batchId: z.string().uuid(),
});
export type SubmitBatchInput = z.infer<typeof submitBatchSchema>;

export const deleteBatchSchema = z.object({
  batchId: z.string().uuid(),
});
export type DeleteBatchInput = z.infer<typeof deleteBatchSchema>;

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
  /** Optional: payroll is multi-line disbursement, not a single payment ref. */
  financeReference: z.string().max(200).optional(),
  disbursementDate: z.string().date().optional(),
  proofOfPaymentUrl: z.string().url().optional(),
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

/**
 * Remove a single payout line from an open (DRAFT / PENDING_HR) batch. Deletes
 * the payout row, unlinks (but keeps) any earnings adjustments tied to it, and
 * re-rolls the batch totals + staff count. Never allowed once a batch is PAID.
 */
export const removePayoutLineSchema = z.object({
  batchId: z.string().uuid(),
  payoutId: z.string().uuid(),
});
export type RemovePayoutLineInput = z.infer<typeof removePayoutLineSchema>;
