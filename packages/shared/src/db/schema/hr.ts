import { uuid, pgTable, text, numeric, jsonb, timestamp, integer, date, boolean } from 'drizzle-orm/pg-core';
import { branchGroups } from './branch-groups';
import {
  payoutStatusEnum,
  adjustmentCategoryEnum,
  userRoleEnum,
  payrollBatchStatusEnum,
  payrollDepartmentEnum,
  payrollPayRoleCategoryEnum,
  payrollBatchScopeTypeEnum,
  payrollPayslipLineStatusEnum,
  payrollTaxStatusEnum,
  payrollDeliveredMetricSourceEnum,
} from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { branches } from './branches';
import { products } from './products';

// Table 17: commission_plans — JSONB commission rules
export const commissionPlans = pgTable('commission_plans', {
  id: uuidv7Pk(),
  /** Branch group this plan belongs to. CEO directive 2026-06-10. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  /** When NULL, the plan is not a role default — staff must reference it via `users.commission_plan_id`. */
  role: userRoleEnum('role'),
  /** Optional link to payroll pay role library entry. */
  payRoleId: uuid('pay_role_id'),
  planName: text('plan_name').notNull(),
  rules: jsonb('rules').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});

/** Pay role library — drives formula assignment per PRD Section 7.3. */
export const payrollPayRoles = pgTable('payroll_pay_roles', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  category: payrollPayRoleCategoryEnum('category').notNull(),
  reportsToRequired: boolean('reports_to_required').default(false).notNull(),
  perProductBonus: boolean('per_product_bonus').default(false).notNull(),
  commissionPlanId: uuid('commission_plan_id').references(() => commissionPlans.id),
  /**
   * Default PAYE treatment stamped onto staff/contractors when assigned to this role.
   * Migration 0281. `GROSS_NO_DEDUCTION` = no PAYE ("None" in Payroll Config UI).
   */
  defaultTaxStatus: payrollTaxStatusEnum('default_tax_status').default('STANDARD_PAYE').notNull(),
  /**
   * Which order pipelines feed delivered-order payroll metrics for staff on this
   * role. FUNNEL (default) = orders funnel; RECOVERY_COMBINED = cart +
   * delivered-follow-up recovery deliveries. Migration 0288.
   */
  deliveredMetricSource: payrollDeliveredMetricSourceEnum('delivered_metric_source')
    .default('FUNNEL')
    .notNull(),
  active: boolean('active').default(true).notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

/** Product DR tier tables for CS per-product bonuses — Section 7.2. */
export const payrollProductTierConfigs = pgTable('payroll_product_tier_configs', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  productId: uuid('product_id').references(() => products.id),
  productName: text('product_name').notNull(),
  branchIds: uuid('branch_ids').array(),
  active: boolean('active').default(true).notNull(),
  tierRows: jsonb('tier_rows').notNull().default([]),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});

/** Versioned PAYE band configuration — Section 7.5. */
export const payrollTaxBandConfigs = pgTable('payroll_tax_band_configs', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  label: text('label').default('Default PAYE').notNull(),
  taxFreeThreshold: numeric('tax_free_threshold', { precision: 14, scale: 2 }).default('800000').notNull(),
  bands: jsonb('bands').notNull().default([]),
  reliefs: jsonb('reliefs').notNull().default([]),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});

/** External agency contractors — fixed monthly fee; PAYE optional via taxStatus. */
export const payrollContractors = pgTable('payroll_contractors', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  branchId: uuid('branch_id').references(() => branches.id),
  /** Pay role this contractor counts toward on Payroll Config headcounts. */
  payRoleId: uuid('pay_role_id').references(() => payrollPayRoles.id),
  monthlyFee: numeric('monthly_fee', { precision: 14, scale: 2 }).notNull(),
  /**
   * Per-contractor PAYE treatment (same enum as users.tax_status).
   * Migration 0280. Default GROSS_NO_DEDUCTION keeps legacy "no PAYE" behaviour.
   */
  taxStatus: payrollTaxStatusEnum('tax_status').default('GROSS_NO_DEDUCTION').notNull(),
  bankName: text('bank_name'),
  bankCode: text('bank_code'),
  accountNumber: text('account_number'),
  accountName: text('account_name'),
  bankVerified: boolean('bank_verified').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  jobTitle: text('job_title'),
  notes: text('notes'),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * Table: payroll_batches — monthly grouping of payouts.
 *
 * `scope_type` is the authoritative grouping discriminator:
 *   - DEPARTMENT / BRANCHES / ALL_BRANCHES / EMPLOYEES — staff batches keyed on
 *     (branch_id, period_month, department), both NOT NULL. Deduped by partial
 *     index `uq_payroll_batch_dept_slot`.
 *   - CONTRACTORS / ALL — null-scope batches that group contractors (or everyone)
 *     with no department (department NULL) and often no branch (branch_id NULL).
 *     Deduped by partial index `uq_payroll_batch_null_scope`
 *     (scope_type, period_month, COALESCE(branch_id,…), COALESCE(run_label,…)).
 * Hence branch_id / department are nullable (migration 0287). Consumers must treat
 * a batch as null-scope when scope_type IN ('CONTRACTORS','ALL').
 *
 * Lifecycle: DRAFT → PENDING_HR → PENDING_FINANCE → PAID. Reject sends PENDING_* one
 * stage back.
 *
 * `staff_count` and `total_amount` are denormalised summaries recomputed on every
 * status transition or payout edit so the monthly list view doesn't need to aggregate
 * payouts per row. Source of truth remains payout_records.
 */
export const payrollBatches = pgTable('payroll_batches', {
  id: uuidv7Pk(),
  /** NULL for null-scope batches (scope_type CONTRACTORS/ALL); see table doc. */
  branchId: uuid('branch_id').references(() => branches.id),
  /** First day of the month this batch covers, e.g. 2026-04-01 for April 2026. */
  periodMonth: date('period_month').notNull(),
  /** NULL for null-scope batches (scope_type CONTRACTORS/ALL); see table doc. */
  department: payrollDepartmentEnum('department'),
  status: payrollBatchStatusEnum('status').default('DRAFT').notNull(),

  scopeType: payrollBatchScopeTypeEnum('scope_type').default('DEPARTMENT'),
  scopeBranchIds: uuid('scope_branch_ids').array(),
  scopeEmployeeIds: uuid('scope_employee_ids').array(),
  includeContractors: boolean('include_contractors').default(false).notNull(),
  runLabel: text('run_label'),

  /** Head/HR who initially generated the batch (null = system auto-generated). */
  preparedBy: uuid('prepared_by').references(() => users.id),
  preparedAt: timestamp('prepared_at', { withTimezone: true }),

  /** When/who submitted DRAFT → PENDING_HR. */
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  submittedBy: uuid('submitted_by').references(() => users.id),

  /** When/who approved PENDING_HR → PENDING_FINANCE. */
  hrReviewedAt: timestamp('hr_reviewed_at', { withTimezone: true }),
  hrReviewedBy: uuid('hr_reviewed_by').references(() => users.id),
  hrNotes: text('hr_notes'),

  /** When/who closed PENDING_FINANCE → PAID. */
  financeProcessedAt: timestamp('finance_processed_at', { withTimezone: true }),
  financeProcessedBy: uuid('finance_processed_by').references(() => users.id),
  /** Free-form payment reference (bank transfer ID, cheque number, batch payout reference). */
  financeReference: text('finance_reference'),
  disbursementDate: date('disbursement_date'),
  proofOfPaymentUrl: text('proof_of_payment_url'),

  /** Last rejection note — clears on next forward transition; see audit history for full trail. */
  rejectionReason: text('rejection_reason'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by').references(() => users.id),

  /** Denormalised summary for the monthly list view; recomputed on every payout edit. */
  staffCount: integer('staff_count').default(0).notNull(),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).default('0').notNull(),
  totalGross: numeric('total_gross', { precision: 14, scale: 2 }).default('0').notNull(),
  totalTax: numeric('total_tax', { precision: 14, scale: 2 }).default('0').notNull(),
  totalNet: numeric('total_net', { precision: 14, scale: 2 }).default('0').notNull(),

  ...temporalColumns,
  ...timestampColumns,
});

// Table 18: payout_records — staff settlement periods (PayslipLine snapshot)
export const payoutRecords = pgTable('payout_records', {
  id: uuidv7Pk(),
  /** Parent batch — null only on legacy rows from before payroll batches existed. */
  batchId: uuid('batch_id').references(() => payrollBatches.id),
  staffId: uuid('staff_id').references(() => users.id),
  contractorId: uuid('contractor_id').references(() => payrollContractors.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  baseSalary: numeric('base_salary', { precision: 12, scale: 2 }).default('0').notNull(),
  performanceBonus: numeric('performance_bonus', { precision: 12, scale: 2 }).default('0').notNull(),
  addOnsTotal: numeric('add_ons_total', { precision: 12, scale: 2 }).default('0').notNull(),
  deductionsTotal: numeric('deductions_total', { precision: 12, scale: 2 }).default('0').notNull(),
  totalPayout: numeric('total_payout', { precision: 12, scale: 2 }).default('0').notNull(),
  /** PRD PayslipLine extended fields */
  metricsSnapshot: jsonb('metrics_snapshot'),
  bonusBreakdown: jsonb('bonus_breakdown'),
  allowancesTotal: numeric('allowances_total', { precision: 12, scale: 2 }).default('0').notNull(),
  grossPay: numeric('gross_pay', { precision: 12, scale: 2 }).default('0').notNull(),
  payeTax: numeric('paye_tax', { precision: 12, scale: 2 }).default('0').notNull(),
  employerPayeSubsidy: numeric('employer_paye_subsidy', { precision: 12, scale: 2 }).default('0').notNull(),
  netPay: numeric('net_pay', { precision: 12, scale: 2 }).default('0').notNull(),
  lineStatus: payrollPayslipLineStatusEnum('line_status').default('OK'),
  overrideReason: text('override_reason'),
  manualAdjustments: jsonb('manual_adjustments').default([]),
  payRoleName: text('pay_role_name'),
  status: payoutStatusEnum('status').default('DRAFT').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});

// Table 19: earnings_adjustments — manual bonuses/deductions.
// Applies to either a staff user (staff_id) OR an external contractor
// (contractor_id) — exactly one is set (enforced by a DB CHECK).
export const earningsAdjustments = pgTable('earnings_adjustments', {
  id: uuidv7Pk(),
  staffId: uuid('staff_id').references(() => users.id),
  contractorId: uuid('contractor_id').references(() => payrollContractors.id),
  payoutId: uuid('payout_id').references(() => payoutRecords.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  category: adjustmentCategoryEnum('category').notNull(),
  reason: text('reason').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  // Target payroll month (YYYY-MM-01). NULL = attach to the next batch generated
  // for this party regardless of month (legacy behavior). When set, the batch
  // sweep only links this row into a batch for the matching period_month.
  periodMonth: date('period_month'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});
