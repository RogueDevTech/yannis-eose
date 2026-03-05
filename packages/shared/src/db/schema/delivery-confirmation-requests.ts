import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { deliveryConfirmationRequestStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns } from './helpers';
import { orders } from './orders';
import { users } from './users';

/**
 * Delivery confirmation requests: rider/3PL submit DELIVERED or PARTIALLY_DELIVERED
 * for HOL approval; on approve, order transition and side effects run.
 */
export const deliveryConfirmationRequests = pgTable('delivery_confirmation_requests', {
  id: uuidv7Pk(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  requestedBy: text('requested_by')
    .notNull()
    .references(() => users.id),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  status: deliveryConfirmationRequestStatusEnum('status').default('PENDING').notNull(),
  approvedBy: text('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  /** Same shape as transition metadata: newStatus, otp, gpsLat, gpsLng, deliveredQuantity, returnedQuantity, deliveryFeeAddOn, etc. */
  payload: jsonb('payload').notNull(),
  ...temporalColumns,
});
