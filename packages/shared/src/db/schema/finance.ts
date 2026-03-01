import { pgTable, text, numeric, jsonb, timestamp, serial } from 'drizzle-orm/pg-core';
import { invoiceStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns } from './helpers';
import { orders } from './orders';

// Table 16: invoices — sequential billing
export const invoices = pgTable('invoices', {
  id: uuidv7Pk(),
  referenceNumber: serial('reference_number').notNull().unique(),
  orderId: text('order_id').references(() => orders.id),
  recipientInfo: jsonb('recipient_info'),
  lineItems: jsonb('line_items'),
  taxRate: numeric('tax_rate', { precision: 5, scale: 4 }),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }).notNull(),
  status: invoiceStatusEnum('status').default('DRAFT').notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});
