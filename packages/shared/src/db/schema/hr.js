"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.earningsAdjustments = exports.payoutRecords = exports.commissionPlans = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
const users_1 = require("./users");
exports.commissionPlans = (0, pg_core_1.pgTable)('commission_plans', {
    id: (0, helpers_1.uuidv7Pk)(),
    role: (0, enums_1.userRoleEnum)('role').notNull(),
    planName: (0, pg_core_1.text)('plan_name').notNull(),
    rules: (0, pg_core_1.jsonb)('rules').notNull(),
    effectiveFrom: (0, pg_core_1.timestamp)('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: (0, pg_core_1.timestamp)('effective_to', { withTimezone: true }),
    createdBy: (0, pg_core_1.text)('created_by')
        .notNull()
        .references(() => users_1.users.id),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
exports.payoutRecords = (0, pg_core_1.pgTable)('payout_records', {
    id: (0, helpers_1.uuidv7Pk)(),
    staffId: (0, pg_core_1.text)('staff_id')
        .notNull()
        .references(() => users_1.users.id),
    periodStart: (0, pg_core_1.timestamp)('period_start', { withTimezone: true }).notNull(),
    periodEnd: (0, pg_core_1.timestamp)('period_end', { withTimezone: true }).notNull(),
    baseSalary: (0, pg_core_1.numeric)('base_salary', { precision: 12, scale: 2 }).default('0').notNull(),
    performanceBonus: (0, pg_core_1.numeric)('performance_bonus', { precision: 12, scale: 2 }).default('0').notNull(),
    addOnsTotal: (0, pg_core_1.numeric)('add_ons_total', { precision: 12, scale: 2 }).default('0').notNull(),
    deductionsTotal: (0, pg_core_1.numeric)('deductions_total', { precision: 12, scale: 2 }).default('0').notNull(),
    totalPayout: (0, pg_core_1.numeric)('total_payout', { precision: 12, scale: 2 }).default('0').notNull(),
    status: (0, enums_1.payoutStatusEnum)('status').default('DRAFT').notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    ...helpers_1.temporalColumns,
});
exports.earningsAdjustments = (0, pg_core_1.pgTable)('earnings_adjustments', {
    id: (0, helpers_1.uuidv7Pk)(),
    staffId: (0, pg_core_1.text)('staff_id')
        .notNull()
        .references(() => users_1.users.id),
    payoutId: (0, pg_core_1.text)('payout_id').references(() => exports.payoutRecords.id),
    amount: (0, pg_core_1.numeric)('amount', { precision: 12, scale: 2 }).notNull(),
    category: (0, enums_1.adjustmentCategoryEnum)('category').notNull(),
    reason: (0, pg_core_1.text)('reason').notNull(),
    approvedBy: (0, pg_core_1.text)('approved_by').references(() => users_1.users.id),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    ...helpers_1.temporalColumns,
});
//# sourceMappingURL=hr.js.map