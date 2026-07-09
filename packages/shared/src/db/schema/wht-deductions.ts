import {
  pgTable,
  text,
  uuid,
  numeric,
  boolean,
  date,
  timestamp,
} from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';
import { branchGroups } from './branch-groups';

// ============================================
// WHT (Withholding Tax) Deductions — Phase 6B
//
// Records WHT deducted at source on vendor payments. Used to generate
// WHT certificates required by FIRS (Federal Inland Revenue Service).
// ============================================

export const whtDeductions = pgTable('wht_deductions', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  vendorName: text('vendor_name').notNull(),
  vendorId: uuid('vendor_id'),
  paymentDate: date('payment_date').notNull(),
  grossAmount: numeric('gross_amount', { precision: 14, scale: 2 }).notNull(),
  whtRate: numeric('wht_rate', { precision: 5, scale: 2 }).notNull().default('5.00'),
  whtAmount: numeric('wht_amount', { precision: 14, scale: 2 }).notNull(),
  netAmount: numeric('net_amount', { precision: 14, scale: 2 }).notNull(),
  description: text('description'),
  certificateGenerated: boolean('certificate_generated').notNull().default(false),
  glVoucherId: uuid('gl_voucher_id'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
