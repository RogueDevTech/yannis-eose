import { uuid, pgTable, text, integer, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { stockBatches } from './inventory';
import { logisticsProviders, logisticsLocations } from './logistics';
import { campaigns } from './marketing';
import { cartAbandonments } from './cart';

// ── Cart Orders ──────────────────────────────────────────────────────
// Standalone table for orders recovered from abandoned carts. Full order
// lifecycle (UNPROCESSED → … → DELIVERED). On DELIVERED, graduates into
// the orders table. Completely decoupled from the Follow-Up pipeline.

export const cartOrders = pgTable('cart_orders', {
  id: uuidv7Pk(),
  orderNumber: integer('order_number').default(sql`nextval('order_number_seq')`).notNull().unique(),
  /** The originating cart_abandonments row. Always set. */
  sourceCartId: uuid('source_cart_id').references(() => cartAbandonments.id).notNull(),
  campaignId: uuid('campaign_id').references(() => campaigns.id),
  mediaBuyerId: uuid('media_buyer_id').references(() => users.id),
  assignedCsId: uuid('assigned_cs_id').references(() => users.id),
  logisticsProviderId: uuid('logistics_provider_id').references(() => logisticsProviders.id),
  logisticsLocationId: uuid('logistics_location_id').references(() => logisticsLocations.id),
  riderId: uuid('rider_id').references(() => users.id),
  status: text('status').notNull().default('UNPROCESSED'),
  items: jsonb('items'),
  customerName: text('customer_name').notNull(),
  customerPhoneHash: text('customer_phone_hash').notNull(),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  deliveryAddress: text('delivery_address'),
  totalAmount: numeric('total_amount', { precision: 12, scale: 2 }),
  landedCost: numeric('landed_cost', { precision: 12, scale: 2 }),
  deliveryFee: numeric('delivery_fee', { precision: 12, scale: 2 }),
  deliveryNotes: text('delivery_notes'),
  deliveryState: text('delivery_state'),
  customerGender: text('customer_gender'),
  preferredDeliveryDate: text('preferred_delivery_date'),
  deliveryOtp: text('delivery_otp'),
  deliveryGpsLat: numeric('delivery_gps_lat', { precision: 10, scale: 7 }),
  deliveryGpsLng: numeric('delivery_gps_lng', { precision: 10, scale: 7 }),
  deliveryProofUrl: text('delivery_proof_url'),
  deliveryDiscountAmount: numeric('delivery_discount_amount', { precision: 12, scale: 2 }),
  resolveReceiptUrl: text('resolve_receipt_url'),
  paymentMethod: text('payment_method'),
  paymentStatus: text('payment_status'),
  paymentReference: text('payment_reference'),
  paymentProvider: text('payment_provider'),
  customerEmail: text('customer_email'),
  callbackScheduledAt: timestamp('callback_scheduled_at', { withTimezone: true }),
  callbackAttempts: integer('callback_attempts').default(0).notNull(),
  callbackNotes: text('callback_notes'),
  isDuplicate: text('is_duplicate'),
  duplicateOfId: uuid('duplicate_of_id'),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lockedBy: uuid('locked_by').references(() => users.id),
  orderSource: text('order_source'),
  customFields: jsonb('custom_fields'),
  branchId: uuid('branch_id'),
  servicingBranchId: uuid('servicing_branch_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...temporalColumns,
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Cart Order Items ─────────────────────────────────────────────────
export const cartOrderItems = pgTable('cart_order_items', {
  id: uuidv7Pk(),
  cartOrderId: uuid('cart_order_id')
    .notNull()
    .references(() => cartOrders.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  quantity: integer('quantity').notNull(),
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
  offerLabel: text('offer_label'),
  batchId: uuid('batch_id').references(() => stockBatches.id),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Cart Order Timeline Events ───────────────────────────────────────
export const cartOrderTimelineEvents = pgTable('cart_order_timeline_events', {
  id: uuidv7Pk(),
  cartOrderId: uuid('cart_order_id')
    .notNull()
    .references(() => cartOrders.id),
  eventType: text('event_type').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: text('actor_name'),
  description: text('description').notNull(),
  metadata: jsonb('metadata'),
  branchId: uuid('branch_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
