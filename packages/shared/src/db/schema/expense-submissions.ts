import {
  pgTable,
  pgEnum,
  text,
  uuid,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';
import { branchGroups } from './branch-groups';

// ============================================
// Vendor Expense Submissions (Phase 4B)
//
// Any user can submit expenses with optional receipt upload.
// Finance Officer reviews, codes to a GL account, and approves
// (which posts the GL entry) or rejects with a reason.
// ============================================

export const expenseSubmissionStatusEnum = pgEnum('expense_submission_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

/**
 * expense_submissions — vendor expense claims submitted by any user.
 * Finance Officer codes the GL account on approval and the system
 * posts the corresponding journal entry (Dr coded account / Cr Creditors).
 */
export const expenseSubmissions = pgTable('expense_submissions', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  submitterId: uuid('submitter_id').notNull(),
  vendorName: text('vendor_name').notNull(),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  receiptUrl: text('receipt_url'),
  glAccountId: uuid('gl_account_id'),
  status: expenseSubmissionStatusEnum('status').notNull().default('PENDING'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  glVoucherId: uuid('gl_voucher_id'),
  branchId: uuid('branch_id'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
