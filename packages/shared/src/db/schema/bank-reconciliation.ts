import {
  pgTable,
  pgEnum,
  uuid,
  numeric,
  date,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';
import { branchGroups } from './branch-groups';

// ============================================
// Bank Reconciliation (Phase 6D)
// ============================================

export const bankReconStatusEnum = pgEnum('bank_recon_status', [
  'IN_PROGRESS',
  'COMPLETED',
]);

export const bankReconLineStatusEnum = pgEnum('bank_recon_line_status', [
  'MATCHED',
  'UNMATCHED',
]);

/**
 * bank_reconciliations — header for a bank statement reconciliation session.
 * Links to a GL account of type BANK, captures the statement-reported balance,
 * the GL-computed balance, and the status.
 */
export const bankReconciliations = pgTable('bank_reconciliations', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  bankAccountId: uuid('bank_account_id').notNull(),
  statementDate: date('statement_date').notNull(),
  statementBalance: numeric('statement_balance', { precision: 14, scale: 2 }).notNull(),
  glBalance: numeric('gl_balance', { precision: 14, scale: 2 }).notNull(),
  difference: numeric('difference', { precision: 14, scale: 2 }).notNull().default('0'),
  status: bankReconStatusEnum('status').notNull().default('IN_PROGRESS'),
  completedBy: uuid('completed_by'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * bank_recon_lines — individual line items from the bank statement and/or GL
 * entries, paired together when matched.
 */
export const bankReconLines = pgTable('bank_recon_lines', {
  id: uuidv7Pk(),
  reconciliationId: uuid('reconciliation_id')
    .notNull()
    .references(() => bankReconciliations.id, { onDelete: 'cascade' }),
  // Statement side
  statementDate: date('statement_date'),
  statementDescription: text('statement_description'),
  statementAmount: numeric('statement_amount', { precision: 14, scale: 2 }),
  // GL side
  glEntryId: uuid('gl_entry_id'),
  glDate: date('gl_date'),
  glDescription: text('gl_description'),
  glAmount: numeric('gl_amount', { precision: 14, scale: 2 }),
  // Match
  status: bankReconLineStatusEnum('status').notNull().default('UNMATCHED'),
  matchedAt: timestamp('matched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
