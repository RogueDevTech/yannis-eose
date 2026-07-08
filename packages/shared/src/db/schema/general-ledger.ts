import {
  pgTable,
  text,
  uuid,
  numeric,
  boolean,
  date,
  serial,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { branchGroups } from './branch-groups';
import {
  glRootTypeEnum,
  glAccountTypeEnum,
  glVoucherTypeEnum,
  journalEntryStatusEnum,
  fiscalYearStatusEnum,
} from './enums';

// ============================================
// Double-Entry General Ledger (Phase 1 foundation)
//
// Replicates the client's ERPNext accounting engine. Everything the client
// sees (Trial Balance, P&L, Balance Sheet) is a query over `gl_entries`.
//
// Model: `gl_entries` ARE the journal lines (ERPNext style). Every voucher
// type (Journal Entry now; Sales Invoice, Payment Entry later) writes the
// SAME `gl_entries` rows, linked by (voucher_type, voucher_id). `gl_entries`
// is append-only/immutable — corrections are reversing entries, never edits.
// ============================================

/**
 * accounts — Chart of Accounts. A self-referencing tree scoped per company
 * (`group_id`). Group accounts (`is_group = true`) are headers you cannot post
 * to; only leaf accounts receive GL entries. `balance` is a debit-positive
 * running cache (Asset/Expense grow with debit; Liability/Equity/Income grow
 * with credit → stored negative). Authoritative balances are always derivable
 * from SUM(gl_entries), so this cache is self-healing.
 */
export const accounts = pgTable('accounts', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  code: text('code').notNull(),
  name: text('name').notNull(),
  rootType: glRootTypeEnum('root_type').notNull(),
  accountType: glAccountTypeEnum('account_type'),
  isGroup: boolean('is_group').notNull().default(false),
  // Self-referencing tree parent — no .references() on same-table self-ref
  // (matches orders.parentOrderId).
  parentAccountId: uuid('parent_account_id'),
  balance: numeric('balance', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  isActive: boolean('is_active').notNull().default(true),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * fiscal_years — accounting periods + the period-lock guard. A posting whose
 * `posting_date` falls in a CLOSED year (or in no year at all) is rejected.
 */
export const fiscalYears = pgTable('fiscal_years', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: fiscalYearStatusEnum('status').notNull().default('OPEN'),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * journal_entries — the voucher header for a manual balanced posting. The
 * lines live in `gl_entries` with voucher_type='JOURNAL_ENTRY' and
 * voucher_id = this row's id. Cancellation lives here (status='CANCELLED');
 * the reversal JE's rows net the original to zero, so original gl_entries are
 * never mutated.
 */
export const journalEntries = pgTable('journal_entries', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  entryNumber: serial('entry_number').notNull().unique(),
  postingDate: date('posting_date').notNull(),
  description: text('description').notNull(),
  totalDebit: numeric('total_debit', { precision: 12, scale: 2 }).notNull(),
  totalCredit: numeric('total_credit', { precision: 12, scale: 2 }).notNull(),
  status: journalEntryStatusEnum('status').notNull().default('POSTED'),
  // Self-ref: this JE reverses another JE (no .references() on self-ref).
  reversalOfId: uuid('reversal_of_id'),
  fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
  // Phase 5: approval workflow columns.
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  // Retry-safety for Phase 2 auto-postings (invoice → GL). Nullable; the
  // manual UI create path omits it.
  idempotencyKey: text('idempotency_key'),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * gl_entries — the immutable ledger = the journal lines. Append-only: a
 * BEFORE UPDATE OR DELETE trigger blocks all mutation (see migration). Each
 * line is one-sided (exactly one of debit/credit > 0), enforced by Zod, a DB
 * CHECK, and the posting service.
 */
export const glEntries = pgTable('gl_entries', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  postingDate: date('posting_date').notNull(),
  debit: numeric('debit', { precision: 12, scale: 2 }).notNull().default('0'),
  credit: numeric('credit', { precision: 12, scale: 2 }).notNull().default('0'),
  voucherType: glVoucherTypeEnum('voucher_type').notNull(),
  // = the voucher header id (journal_entries.id today). Generic, no FK since
  // later phases add more voucher tables.
  voucherId: uuid('voucher_id').notNull(),
  partyType: text('party_type'),
  partyId: uuid('party_id'),
  remarks: text('remarks'),
  fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id),
  // Append-only: timestamps only, NO temporalColumns (no history twin).
  ...timestampColumns,
});
