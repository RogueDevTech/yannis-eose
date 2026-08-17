import { z } from 'zod';
import { commissionRulesSchema } from './hr';

// ============================================
// Payroll PRD — Formula, metrics, tax, config validators
// ============================================

export const payrollMetricTypeSchema = z.enum([
  'INDIVIDUAL_DR',
  'TEAM_DR',
  'CPA',
  // Raw count of delivered orders in the period. Use with a threshold to gate
  // bonus qualification on volume (e.g. DELIVERED_COUNT >= 60) rather than DR%.
  'DELIVERED_COUNT',
  // Sum of order totals (₦) for DELIVERED/REMITTED orders the closer serviced in
  // the period (by delivered_at, servicing branch). Drives the CS closer base
  // tier: QUALIFYING_REVENUE >= 4,000,000 → ₦120k base, else the flat ₦80k.
  'QUALIFYING_REVENUE',
  'TARGET_MET',
  'NONE',
]);

export const payrollOperatorSchema = z.enum(['GTE', 'GT', 'LTE', 'LT', 'EQ']);

export const payrollTierKindSchema = z.enum(['PER_ORDER', 'FLAT']);

/**
 * A single metric condition. A tier's primary condition lives on the tier itself
 * (metric/operator/threshold); `extraConditions` holds additional conditions that
 * are ANDed with the primary one — e.g. `DR% >= 85 AND CPA < 1000`. A tier only
 * awards its amount when the primary condition AND every extra condition pass.
 */
export const payrollTierConditionSchema = z.object({
  metric: payrollMetricTypeSchema,
  operator: payrollOperatorSchema,
  threshold: z.number().min(0),
});

export const payrollBaseSalaryTierSchema = z.object({
  metric: payrollMetricTypeSchema,
  operator: payrollOperatorSchema,
  threshold: z.number().min(0),
  amount: z.number().min(0),
  extraConditions: z.array(payrollTierConditionSchema).max(4).optional(),
});

export const payrollBonusTierSchema = z.object({
  metric: payrollMetricTypeSchema,
  operator: payrollOperatorSchema,
  threshold: z.number().min(0),
  kind: payrollTierKindSchema,
  amount: z.number().min(0),
  extraConditions: z.array(payrollTierConditionSchema).max(4).optional(),
});

export const payrollMinimumFloorSchema = z.object({
  metric: payrollMetricTypeSchema,
  operator: payrollOperatorSchema,
  threshold: z.number().min(0),
  fallbackBonus: z.number().min(0).optional(),
});

export const payrollScalingRuleSchema = z.object({
  metric: payrollMetricTypeSchema.default('INDIVIDUAL_DR'),
  startThreshold: z.number().min(0),
  stepSize: z.number().min(0.01),
  incrementAmount: z.number().min(0),
  capAmount: z.number().min(0).nullable().optional(),
});

export const payrollAllowanceSchema = z.object({
  name: z.string().min(1).max(100),
  amount: z.number().min(0),
  taxable: z.boolean().default(true),
});

export const payrollEmployerPayeSubsidySchema = z.object({
  metric: payrollMetricTypeSchema,
  operator: payrollOperatorSchema,
  threshold: z.number().min(0),
  subsidyPercent: z.number().min(0).max(100),
});

export const payrollFormulaSchema = z.object({
  schemaVersion: z.literal('payroll_v1').optional(),
  flatBaseSalary: z.number().min(0).optional(),
  baseSalaryTiers: z.array(payrollBaseSalaryTierSchema).max(20).optional(),
  bonusTiers: z.array(payrollBonusTierSchema).max(30).optional(),
  minimumFloor: payrollMinimumFloorSchema.optional(),
  scalingRule: payrollScalingRuleSchema.optional(),
  allowances: z.array(payrollAllowanceSchema).max(10).optional(),
  penaltyPerReturn: z.number().min(0).optional(),
  employerPayeSubsidy: payrollEmployerPayeSubsidySchema.optional(),
  // Retained as an accepted-but-ignored field for backward compatibility with
  // any stored rules JSON. The per-product bonus path has been removed; bonuses
  // are always role-level. New configs should not set this.
  perProductBonus: z.boolean().optional(),
  flatMonthlyAmount: z.number().min(0).optional(),
});

export type PayrollFormula = z.infer<typeof payrollFormulaSchema>;

/** Union of legacy commission rules and new PRD formula — stored in commission_plans.rules JSONB. */
export const payrollRulesSchema = z.union([payrollFormulaSchema, commissionRulesSchema]);

export const payrollMetricsSchema = z.object({
  individualDr: z.number().min(0).max(100),
  teamDr: z.number().min(0).max(100).optional(),
  cpa: z.number().min(0).nullable().optional(),
  deliveredCount: z.number().int().min(0),
  deliveredCohortCount: z.number().int().min(0).optional(),
  // Display-only: of deliveredCount, how many were generated in a prior period
  // (carry-over). Never used in pay math or any rate.
  deliveredCarryOverCount: z.number().int().min(0).optional(),
  totalOrders: z.number().int().min(0),
  returnedCount: z.number().int().min(0).optional(),
  // Sum of DELIVERED/REMITTED order totals (₦) the closer serviced this period.
  // Drives the CS closer revenue-tier base salary. Optional — 0/absent for
  // non-CS staff and where not computed.
  qualifyingRevenue: z.number().min(0).optional(),
  targetMet: z.boolean().optional(),
  deliveredByProduct: z.record(z.string(), z.number().int().min(0)).optional(),
  drByProduct: z.record(z.string(), z.number().min(0).max(100)).optional(),
  missingData: z.boolean().optional(),
});

export type PayrollMetrics = z.infer<typeof payrollMetricsSchema>;

export const productTierRowSchema = z.object({
  fromPct: z.number().min(0).max(100),
  toPct: z.number().min(0).max(100).nullable().optional(),
  ratePerOrder: z.number().min(0),
});

export const saveProductTierConfigSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  productName: z.string().min(1).max(200),
  branchIds: z.array(z.string().uuid()).optional(),
  active: z.boolean().default(true),
  tierRows: z.array(productTierRowSchema).min(1),
  effectiveFrom: z.string().datetime().or(z.string().date()),
});

export const deleteProductTierConfigSchema = z.object({
  id: z.string().uuid(),
});

export const payeBandRowSchema = z.object({
  fromAmount: z.number().min(0),
  toAmount: z.number().min(0).nullable().optional(),
  rate: z.number().min(0).max(100),
});

export const payeReliefSchema = z.object({
  name: z.string().min(1),
  // PERCENT_OF_ANNUAL_RENT: HR-approved rent relief — `rate`% of the employee's
  // declared annual rent, subject to `cap` (₦500,000/yr). Not derived from salary,
  // so employees with no declared rent get zero relief.
  basis: z.enum([
    'PERCENT_OF_GROSS',
    'PERCENT_OF_MONTHLY_GROSS',
    'FLAT_ANNUAL',
    'PERCENT_OF_ANNUAL_RENT',
  ]),
  rate: z.number().min(0).max(100).default(0),
  amount: z.number().min(0).optional(),
  cap: z.number().min(0).nullable().optional(),
});

/**
 * Statutory deduction (Pension, NHIS, ...) taken off gross BEFORE PAYE.
 * Config-driven per company group so HR can tune rates without a deploy — mirrors
 * the reliefs pattern. `basis`:
 *  - PERCENT_OF_MONTHLY_GROSS: `rate`% of monthly gross, per month.
 *  - FLAT_MONTHLY: fixed `amount` per month.
 * Optional monthly `cap`. These reduce the "net before PAYE" used by the
 * low-income exemption AND appear on payslips / the PAYE remittance export.
 */
export const payeStatutoryDeductionSchema = z.object({
  name: z.string().min(1),
  basis: z.enum(['PERCENT_OF_MONTHLY_GROSS', 'FLAT_MONTHLY']),
  rate: z.number().min(0).max(100).default(0),
  amount: z.number().min(0).optional(),
  cap: z.number().min(0).nullable().optional(),
});

export const payeBandConfigSchema = z.object({
  taxFreeThreshold: z.number().min(0),
  bands: z.array(payeBandRowSchema).min(1),
  reliefs: z.array(payeReliefSchema).default([]),
  /** Pension / NHIS etc. taken off gross before PAYE. Empty = none. */
  statutoryDeductions: z.array(payeStatutoryDeductionSchema).default([]),
  /**
   * HR low-income PAYE exemption (monthly). When gross < threshold OR
   * net-before-PAYE < threshold, monthly PAYE is 0. HR policy: ₦66,000
   * (statutory minimum-wage floor). Omit/0 disables the exemption.
   */
  lowIncomeExemptionMonthly: z.number().min(0).default(0),
});

export type PayeBandConfig = z.infer<typeof payeBandConfigSchema>;
export type PayeReliefConfig = z.infer<typeof payeReliefSchema>;
export type PayeStatutoryDeductionConfig = z.infer<typeof payeStatutoryDeductionSchema>;

export const saveTaxBandConfigSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(200).default('Default PAYE'),
  taxFreeThreshold: z.number().min(0),
  bands: z.array(payeBandRowSchema).min(1),
  reliefs: z.array(payeReliefSchema).default([]),
  statutoryDeductions: z.array(payeStatutoryDeductionSchema).default([]),
  lowIncomeExemptionMonthly: z.number().min(0).default(0),
  effectiveFrom: z.string().datetime().or(z.string().date()),
});

export const deleteTaxBandConfigSchema = z.object({
  id: z.string().uuid(),
});

export const payrollPayRoleCategorySchema = z.enum([
  // Legacy department-level categories (kept for existing rows)
  'CS',
  'MEDIA_BUYING',
  'LOGISTICS',
  'OPERATIONS',
  'SUPPORT',
  'LEADERSHIP',
  'CONTRACTOR',
  'FINANCE',
  'HR_ADMIN',
  'STOCK_MANAGEMENT',
  // Per-role categories (maps 1:1 to user_role values)
  'SUPER_ADMIN',
  'ADMIN',
  'BRANCH_ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  'CS_CLOSER',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'HR_MANAGER',
  'AUDITOR',
]);

export const payRoleTaxStatusSchema = z.enum([
  'STANDARD_PAYE',
  'EMPLOYER_SUBSIDIZED_PAYE',
  'GROSS_NO_DEDUCTION',
]);

/**
 * Which order pipelines feed delivered-order payroll metrics for staff on a pay
 * role. FUNNEL (default) = orders funnel; RECOVERY_COMBINED = cart +
 * delivered-follow-up recovery deliveries (excludes follow_up_orders to avoid
 * double-counting graduated follow-ups). Migration 0288.
 */
export const payRoleDeliveredMetricSourceSchema = z.enum(['FUNNEL', 'RECOVERY_COMBINED']);
export type PayRoleDeliveredMetricSource = z.infer<typeof payRoleDeliveredMetricSourceSchema>;

export const createPayRoleSchema = z.object({
  name: z.string().min(2).max(200),
  category: payrollPayRoleCategorySchema,
  reportsToRequired: z.boolean().default(false),
  perProductBonus: z.boolean().default(false),
  /** Default PAYE treatment for people on this role. GROSS_NO_DEDUCTION = none. */
  defaultTaxStatus: payRoleTaxStatusSchema.default('STANDARD_PAYE'),
  /** Delivered-metric pipeline source. Recovery categories use RECOVERY_COMBINED. */
  deliveredMetricSource: payRoleDeliveredMetricSourceSchema.default('FUNNEL'),
  commissionPlanId: z.string().uuid().optional(),
});

export const updatePayRoleSchema = createPayRoleSchema.partial().extend({
  id: z.string().uuid(),
  active: z.boolean().optional(),
});

export const createContractorSchema = z.object({
  name: z.string().min(2).max(200),
  jobTitle: z.string().max(200).optional(),
  payRoleId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
  monthlyFee: z.coerce.number().min(0),
  taxStatus: z
    .enum(['STANDARD_PAYE', 'EMPLOYER_SUBSIDIZED_PAYE', 'GROSS_NO_DEDUCTION'])
    .default('GROSS_NO_DEDUCTION'),
  bankName: z.string().optional(),
  // NIBSS NIP institution code: exactly 6 digits, leading zeros preserved.
  bankCode: z
    .string()
    .regex(/^\d{6}$/u, 'Bank code must be exactly 6 digits')
    .optional()
    .or(z.literal('')),
  accountNumber: z.string().length(10).optional(),
  accountName: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const updateContractorSchema = createContractorSchema.partial().extend({
  id: z.string().uuid(),
  active: z.boolean().optional(),
});

export const getContractorSchema = z.object({
  id: z.string().uuid(),
});

/** Omit or `active: true` = active only (default). `active: false` = inactive only. */
export const listContractorsSchema = z.object({
  active: z.boolean().optional(),
});

export const listContractorPayoutsSchema = z.object({
  contractorId: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  /** Inclusive payroll period bounds as `YYYY-MM-01`. */
  fromMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  toMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
});

export const overridePayslipLineSchema = z.object({
  payoutId: z.string().uuid(),
  baseSalary: z.coerce.number().min(0).optional(),
  performanceBonus: z.coerce.number().min(0).optional(),
  payeTax: z.coerce.number().min(0).optional(),
  reason: z.string().min(10).max(500),
});

export const previewPayeSchema = z.object({
  monthlyGross: z.coerce.number().min(0),
  taxStatus: z.enum(['STANDARD_PAYE', 'EMPLOYER_SUBSIDIZED_PAYE', 'GROSS_NO_DEDUCTION']).default('STANDARD_PAYE'),
  employerSubsidyPercent: z.coerce.number().min(0).max(100).optional(),
  /** Declared annual rent (₦) to preview the rent relief. Omitted → no relief. */
  annualRent: z.coerce.number().min(0).optional(),
});

export const payrollOnboardingActionSchema = z.object({
  userId: z.string().uuid(),
  comment: z.string().max(500).optional(),
});

export const updatePayrollProfileSchema = z.object({
  userId: z.string().uuid(),
  payRoleId: z.string().uuid().nullable().optional(),
  employmentType: z.enum(['STAFF', 'CONTRACTOR_AGENCY']).optional(),
  salaryBasis: z.enum(['FORMULA_BASED', 'FLAT_RATE']).optional(),
  taxStatus: z.enum(['STANDARD_PAYE', 'EMPLOYER_SUBSIDIZED_PAYE', 'GROSS_NO_DEDUCTION']).optional(),
  reportsToUserId: z.string().uuid().nullable().optional(),
  crmLinked: z.boolean().optional(),
  flatMonthlyAmount: z.coerce.number().min(0).optional(),
  /** Declared annual rent (₦) for PERCENT_OF_ANNUAL_RENT relief. */
  annualRent: z.coerce.number().min(0).nullable().optional(),
  /** Tax Identification Number (TIN) for the PAYE remittance report. */
  tin: z.string().trim().max(50).nullable().optional(),
});

/**
 * Self-serve payroll profile edit. Same fields as {@link updatePayrollProfileSchema}
 * minus `userId` — the target is always the authenticated caller (forced
 * server-side), so a user can maintain their own payroll declarations
 * (e.g. annual rent for PAYE relief) without holding `hr.write`. It carries NO
 * role / permission / branch fields, so it can never escalate access.
 */
export const updateMyPayrollProfileSchema = updatePayrollProfileSchema.omit({
  userId: true,
});

export const bulkAssignPayRoleSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(200),
  payRoleId: z.string().uuid(),
  employmentType: z.enum(['STAFF', 'CONTRACTOR_AGENCY']).default('STAFF'),
  salaryBasis: z.enum(['FORMULA_BASED', 'FLAT_RATE']).default('FORMULA_BASED'),
  taxStatus: z.enum(['STANDARD_PAYE', 'EMPLOYER_SUBSIDIZED_PAYE', 'GROSS_NO_DEDUCTION']).default('STANDARD_PAYE'),
  crmLinked: z.boolean().default(true),
});

export const bulkAssignContractorsToPayRoleSchema = z.object({
  contractorIds: z.array(z.string().uuid()).min(1).max(200),
  payRoleId: z.string().uuid(),
  /** Stamped onto contractors on assign so batch PAYE matches pay-role config intent. */
  taxStatus: z
    .enum(['STANDARD_PAYE', 'EMPLOYER_SUBSIDIZED_PAYE', 'GROSS_NO_DEDUCTION'])
    .default('STANDARD_PAYE'),
});

export const markBatchPaidExtendedSchema = z.object({
  batchId: z.string().uuid(),
  financeReference: z.string().max(200).optional(),
  disbursementDate: z.string().date().optional(),
  proofOfPaymentUrl: z.string().url().optional(),
});

// ── Supplementary payroll (Track A) ──────────────────────────────────────────
// Preview which staff were UNDERPAID in an already-settled original period, and
// how much salary + PAYE is still owed to complete it.
export const previewSupplementaryBatchSchema = z.object({
  /** The ORIGINAL month being completed (YYYY-MM-01). */
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
  /** Optional branch scope; omit for org-wide (hr.write only). */
  branchId: z.string().uuid().nullable().optional(),
});

// Generate the supplementary batch for the confirmed set of affected staff.
export const generateSupplementaryBatchSchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
  branchId: z.string().uuid().nullable().optional(),
  /** Staff the HR user confirmed to include. Empty = all detected as underpaid. */
  staffIds: z.array(z.string().uuid()).optional(),
  runLabel: z.string().max(200).optional(),
});

export type PreviewSupplementaryBatchInput = z.infer<typeof previewSupplementaryBatchSchema>;
export type GenerateSupplementaryBatchInput = z.infer<typeof generateSupplementaryBatchSchema>;

// PAYE Remittance Export (Track D#5) — the schedule submitted to the Revenue Office.
export const exportPayeRemittanceSchema = z
  .object({
    batchId: z.string().uuid().optional(),
    periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
    branchId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.batchId || v.periodMonth, {
    message: 'Provide a batchId or a periodMonth.',
  });

export type ExportPayeRemittanceInput = z.infer<typeof exportPayeRemittanceSchema>;

// Payroll reconciliation report (Track B) — correct vs paid for a settled month.
export const payrollReconciliationSchema = z.object({
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
  branchId: z.string().uuid().nullable().optional(),
});

export type PayrollReconciliationInput = z.infer<typeof payrollReconciliationSchema>;

export const generateBatchExtendedSchema = z.object({
  branchId: z.string().uuid(),
  department: z.enum(['CS', 'MARKETING', 'LOGISTICS', 'HR', 'OPERATIONS', 'FINANCE', 'SUPPORT']).optional(),
  periodMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
  scopeType: z.enum(['ALL_BRANCHES', 'BRANCHES', 'EMPLOYEES', 'DEPARTMENT']).default('DEPARTMENT'),
  scopeBranchIds: z.array(z.string().uuid()).optional(),
  scopeEmployeeIds: z.array(z.string().uuid()).optional(),
  includeContractors: z.boolean().default(false),
  runLabel: z.string().max(200).optional(),
});

export const listPayslipsSchema = z.object({
  staffId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  department: z.string().optional(),
  // Filter by batch scope for org-wide batches (Contractors / All staff &
  // contractors), which have a NULL department. UI-exclusive with `department`.
  scopeType: z.enum(['CONTRACTORS', 'ALL']).optional(),
  fromMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  toMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  branchId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
});

export type CreatePayRoleInput = z.infer<typeof createPayRoleSchema>;
export type UpdatePayRoleInput = z.infer<typeof updatePayRoleSchema>;
export type SaveProductTierConfigInput = z.infer<typeof saveProductTierConfigSchema>;
export type DeleteProductTierConfigInput = z.infer<typeof deleteProductTierConfigSchema>;
export type SaveTaxBandConfigInput = z.infer<typeof saveTaxBandConfigSchema>;
export type DeleteTaxBandConfigInput = z.infer<typeof deleteTaxBandConfigSchema>;
export type CreateContractorInput = z.infer<typeof createContractorSchema>;
export type UpdateContractorInput = z.infer<typeof updateContractorSchema>;
export type GetContractorInput = z.infer<typeof getContractorSchema>;
export type ListContractorsInput = z.infer<typeof listContractorsSchema>;
export type ListContractorPayoutsInput = z.infer<typeof listContractorPayoutsSchema>;

export const payrollRegisterSchema = z.object({

  batchId: z.string().uuid().optional(),
  fromMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  toMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  branchId: z.string().uuid().optional(),
  department: z.string().optional(),
  status: z.enum(['DRAFT', 'PENDING_HR', 'PENDING_FINANCE', 'PAID']).optional(),
});

export const payrollReportRangeSchema = z.object({
  fromMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  toMonth: z.string().regex(/^\d{4}-\d{2}-01$/).optional(),
  branchId: z.string().uuid().optional(),
});

export const getPayrollMetricsBulkSchema = z.object({
  staffIds: z.array(z.string().uuid()).min(1).max(200),
  periodStart: z.string(),
  periodEnd: z.string(),
});

export const saveFormulaConfigSchema = z.object({
  payRoleId: z.string().uuid(),
  planName: z.string().min(2).max(200).optional(),
  effectiveFrom: z.string().datetime().or(z.string().date()),
  formula: payrollFormulaSchema,
  sampleMetrics: payrollMetricsSchema.optional(),
});

export const previewPayrollFormulaSchema = z.object({
  formula: payrollFormulaSchema,
  metrics: payrollMetricsSchema,
});

export const archivePayRoleSchema = z.object({
  id: z.string().uuid(),
});

export const getPayRoleWithFormulaSchema = z.object({
  payRoleId: z.string().uuid(),
});

export const getPayslipSchema = z.object({
  payoutId: z.string().uuid(),
});

export const bulkPayslipPdfSchema = z.object({
  batchId: z.string().uuid().optional(),
  payoutIds: z.array(z.string().uuid()).max(500).optional(),
});

export const exportPayRunDraftSchema = z.object({
  batchId: z.string().uuid(),
});

export const exportBankUploadSchema = z
  .object({
    batchId: z.string().uuid().optional(),
    batchIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.batchId && !val.batchIds?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide batchId or batchIds',
        path: ['batchIds'],
      });
    }
  });
