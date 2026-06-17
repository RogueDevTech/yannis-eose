import { uuid, pgTable, text, numeric, jsonb, timestamp, serial, integer } from 'drizzle-orm/pg-core';
import { invoiceStatusEnum, approvalRequestTypeEnum, approvalStatusEnum, settlementWindowEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { branchGroups } from './branch-groups';

// Table 16: invoices — sequential billing
export const invoices = pgTable('invoices', {
  id: uuidv7Pk(),
  referenceNumber: serial('reference_number').notNull().unique(),
  orderId: uuid('order_id'),
  recipientInfo: jsonb('recipient_info'),
  lineItems: jsonb('line_items'),
  taxRate: numeric('tax_rate', { precision: 5, scale: 4 }),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  status: invoiceStatusEnum('status').default('DRAFT').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});

// Table 20: approval_requests — unified queue for all financial requests
export const approvalRequests = pgTable('approval_requests', {
  id: uuidv7Pk(),
  type: approvalRequestTypeEnum('type').notNull(),
  requesterId: uuid('requester_id').notNull().references(() => users.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  description: text('description').notNull(),
  status: approvalStatusEnum('status').default('PENDING').notNull(),
  approverId: uuid('approver_id').references(() => users.id),
  approvalReason: text('approval_reason'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  budgetId: uuid('budget_id').references(() => budgets.id),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 21: budgets — department/campaign budget tracking
export const budgets = pgTable('budgets', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  departmentOrCampaign: text('department_or_campaign').notNull(),
  totalBudget: numeric('total_budget', { precision: 12, scale: 2 }).notNull(),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 22: settlement_configs — HR settlement window configuration
export const settlementConfigs = pgTable('settlement_configs', {
  id: uuidv7Pk(),
  /** Branch group this config belongs to. CEO directive 2026-06-10. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  windowType: settlementWindowEnum('window_type').notNull(),
  startDay: integer('start_day').default(1).notNull(), // day of week (1=Mon) or month
  createdBy: uuid('created_by').notNull().references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});
