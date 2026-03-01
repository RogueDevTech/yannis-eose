import { pgTable, text, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { payoutStatusEnum, adjustmentCategoryEnum, userRoleEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

// Table 17: commission_plans — JSONB commission rules
export const commissionPlans = pgTable('commission_plans', {
  id: uuidv7Pk(),
  role: userRoleEnum('role').notNull(),
  planName: text('plan_name').notNull(),
  rules: jsonb('rules').notNull(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 18: payout_records — staff settlement periods
export const payoutRecords = pgTable('payout_records', {
  id: uuidv7Pk(),
  staffId: text('staff_id')
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
  staffId: text('staff_id')
    .notNull()
    .references(() => users.id),
  payoutId: text('payout_id').references(() => payoutRecords.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  category: adjustmentCategoryEnum('category').notNull(),
  reason: text('reason').notNull(),
  approvedBy: text('approved_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});
