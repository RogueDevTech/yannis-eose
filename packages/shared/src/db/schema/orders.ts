import { pgTable, text, integer, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { orderStatusEnum, callStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { stockBatches } from './inventory';
import { logisticsProviders, logisticsLocations } from './logistics';
import { campaigns } from './marketing';

// Table 9: orders — core order records
export const orders = pgTable('orders', {
  id: uuidv7Pk(),
  campaignId: text('campaign_id').references(() => campaigns.id),
  mediaBuyerId: text('media_buyer_id').references(() => users.id),
  assignedCsId: text('assigned_cs_id').references(() => users.id),
  logisticsProviderId: text('logistics_provider_id').references(() => logisticsProviders.id),
  logisticsLocationId: text('logistics_location_id').references(() => logisticsLocations.id),
  riderId: text('rider_id').references(() => users.id),
  status: orderStatusEnum('status').default('UNPROCESSED').notNull(),
  items: jsonb('items'),
  customerName: text('customer_name').notNull(),
  customerPhoneHash: text('customer_phone_hash').notNull(),
  customerAddress: text('customer_address'),
  deliveryAddress: text('delivery_address'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  landedCost: numeric('landed_cost', { precision: 12, scale: 2 }),
  deliveryFee: numeric('delivery_fee', { precision: 12, scale: 2 }),
  deliveryNotes: text('delivery_notes'),
  parentOrderId: text('parent_order_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  ...temporalColumns,
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// Table 10: order_items — line items per order
export const orderItems = pgTable('order_items', {
  id: uuidv7Pk(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  batchId: text('batch_id').references(() => stockBatches.id),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 11: call_logs — VOIP call records
export const callLogs = pgTable('call_logs', {
  id: uuidv7Pk(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  agentId: text('agent_id')
    .notNull()
    .references(() => users.id),
  callToken: text('call_token'),
  durationSeconds: integer('duration_seconds'),
  callStatus: callStatusEnum('call_status').notNull(),
  recordingUrl: text('recording_url'),
  transcript: text('transcript'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
});
