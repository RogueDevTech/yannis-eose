import { uuid, pgTable, text, numeric, jsonb, timestamp, integer, date } from 'drizzle-orm/pg-core';
import {
  payoutStatusEnum,
  adjustmentCategoryEnum,
  userRoleEnum,
  payrollBatchStatusEnum,
  payrollDepartmentEnum,
} from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { branches } from './branches';

// Table 17: commission_plans — JSONB commission rules
export const commissionPlans = pgTable('commission_plans', {
  id: uuidv7Pk(),
  /** When NULL, the plan is not a role default — staff must reference it via `users.commission_plan_id`. */
  role: userRoleEnum('role'),
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

/**
 * Table: payroll_batches — monthly grouping of payouts by (branch × department × month).
 *
 * Lifecycle: DRAFT → PENDING_HR → PENDING_FINANCE → PAID. Reject sends PENDING_* one
 * stage back. One row per (branch_id, period_month, department) — enforced by
 * unique index `uq_payroll_batch_per_branch_dept_month`.
 *
 * `staff_count` and `total_amount` are denormalised summaries recomputed on every
 * status transition or payout edit so the monthly list view doesn't need to aggregate
 * payouts per row. Source of truth remains payout_records.
 */
export const payrollBatches = pgTable('payroll_batches', {
  id: uuidv7Pk(),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  /** First day of the month this batch covers, e.g. 2026-04-01 for April 2026. */
  periodMonth: date('period_month').notNull(),
  department: payrollDepartmentEnum('department').notNull(),
  status: payrollBatchStatusEnum('status').default('DRAFT').notNull(),

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

  /** Last rejection note — clears on next forward transition; see audit history for full trail. */
  rejectionReason: text('rejection_reason'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by').references(() => users.id),

  /** Denormalised summary for the monthly list view; recomputed on every payout edit. */
  staffCount: integer('staff_count').default(0).notNull(),
  totalAmount: numeric('total_amount', { precision: 14, scale: 2 }).default('0').notNull(),

  ...temporalColumns,
  ...timestampColumns,
});

// Table 18: payout_records — staff settlement periods
export const payoutRecords = pgTable('payout_records', {
  id: uuidv7Pk(),
  /** Parent batch — null only on legacy rows from before payroll batches existed. */
  batchId: uuid('batch_id').references(() => payrollBatches.id),
  staffId: uuid('staff_id')
    .notNull()
    .references(() => users.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  baseSalary: numeric('base_salary', { precision: 12, scale: 2 }).default('0').notNull(),
  performanceBonus: numeric('performance_bonus', { precision: 12, scale: 2 }).default('0').notNull(),
  addOnsTotal: numeric('add_ons_total', { precision: 12, scale: 2 }).default('0').notNull(),
  deductionsTotal: numeric('deductions_total', { precision: 12, scale: 2 }).default('0').notNull(),
  totalPayout: numeric('total_payout', { precision: 12, scale: 2 }).default('0').notNull(),
  status: payoutStatusEnum('status').default('DRAFT').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});

// Table 19: earnings_adjustments — manual bonuses/deductions
export const earningsAdjustments = pgTable('earnings_adjustments', {
  id: uuidv7Pk(),
  staffId: uuid('staff_id')
    .notNull()
    .references(() => users.id),
  payoutId: uuid('payout_id').references(() => payoutRecords.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  category: adjustmentCategoryEnum('category').notNull(),
  reason: text('reason').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});
