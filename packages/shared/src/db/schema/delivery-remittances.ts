import { uuid, pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { remittanceStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns } from './helpers';
import { users } from './users';
import { logisticsLocations } from './logistics';
import { orders } from './orders';

/**
 * Delivery remittances — 3PL batches delivered orders and attaches payment receipt(s).
 * Finance/Accountant marks as RECEIVED (payment confirmed) or DISPUTED.
 */
export const deliveryRemittances = pgTable('delivery_remittances', {
  id: uuidv7Pk(),
  logisticsLocationId: uuid('logistics_location_id')
    .notNull()
    .references(() => logisticsLocations.id),
  sentBy: text('sent_by')
    .notNull()
    .references(() => users.id),
  /** One or more payment receipt URLs (3PL uploads). */
  receiptUrls: jsonb('receipt_urls').$type<string[]>().notNull(),
  status: remittanceStatusEnum('status').default('SENT').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  receivedBy: text('received_by').references(() => users.id),
  disputeReason: text('dispute_reason'),
  notes: text('notes'),
  ...temporalColumns,
});

/**
 * Junction: which orders are included in a delivery remittance.
 * Each order can be in at most one delivery remittance (enforce unique order_id in migration).
 */
export const deliveryRemittanceOrders = pgTable('delivery_remittance_orders', {
  id: uuidv7Pk(),
  deliveryRemittanceId: uuid('delivery_remittance_id')
    .notNull()
    .references(() => deliveryRemittances.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id)
    .unique(),
});
