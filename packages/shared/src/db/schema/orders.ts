import { uuid, pgTable, text, integer, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { orderStatusEnum, callStatusEnum, timelineEventTypeEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { stockBatches } from './inventory';
import { logisticsProviders, logisticsLocations } from './logistics';
import { campaigns } from './marketing';

// Table 9: orders — core order records
export const orders = pgTable('orders', {
  id: uuidv7Pk(),
  campaignId: uuid('campaign_id').references(() => campaigns.id),
  mediaBuyerId: uuid('media_buyer_id').references(() => users.id),
  assignedCsId: uuid('assigned_cs_id').references(() => users.id),
  logisticsProviderId: uuid('logistics_provider_id').references(() => logisticsProviders.id),
  logisticsLocationId: uuid('logistics_location_id').references(() => logisticsLocations.id),
  riderId: uuid('rider_id').references(() => users.id),
  status: orderStatusEnum('status').default('UNPROCESSED').notNull(),
  items: jsonb('items'),
  customerName: text('customer_name').notNull(),
  customerPhoneHash: text('customer_phone_hash').notNull(),
  /** Raw phone for manual-call reveal when VOIP is off. Set by Edge on create; never exposed except via revealPhoneForManualCall. */
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
  /** URL to screenshot from 3PL delivery app (required when marking DELIVERED in v1). */
  deliveryProofUrl: text('delivery_proof_url'),
  /** Discount amount applied at delivery when 3PL marks DELIVERED/PARTIALLY_DELIVERED; order totalAmount is reduced by this. */
  deliveryDiscountAmount: numeric('delivery_discount_amount', { precision: 12, scale: 2 }),
  /** Required receipt URL when 3PL resolves order (Resolve order modal). */
  resolveReceiptUrl: text('resolve_receipt_url'),
  parentOrderId: uuid('parent_order_id'),
  // Payment: method (PAY_ON_DELIVERY | PAY_ONLINE), status when online (PENDING | PAID | FAILED), Paystack reference
  paymentMethod: text('payment_method'),
  paymentStatus: text('payment_status'),
  paymentReference: text('payment_reference'),
  paymentProvider: text('payment_provider'),
  customerEmail: text('customer_email'),
  // Callback reschedule queue: auto-retry on "No Answer"
  callbackScheduledAt: timestamp('callback_scheduled_at', { withTimezone: true }),
  callbackAttempts: integer('callback_attempts').default(0).notNull(),
  callbackNotes: text('callback_notes'),
  // Duplicate order tracking: agent can merge or dismiss flagged duplicates
  isDuplicate: text('is_duplicate'), // null = normal, 'FLAGGED' = potential duplicate, 'MERGED' = merged into another, 'DISMISSED' = agent cleared it
  duplicateOfId: uuid('duplicate_of_id'), // links to the original order if flagged
  // 15-min order lock: when an agent clicks Call, order is locked to them
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lockedBy: text('locked_by').references(() => users.id),
  /** Order source for reporting: 'edge-form' (sales form) or 'offline' (CS manual entry) */
  orderSource: text('order_source'),
  /**
   * Custom field responses from the campaign form builder. Keyed by `formConfig.customFields[].id`.
   * Values are strings, numbers, booleans, or string arrays depending on the field type.
   * Null when the form has no custom fields. Never queried by value — only rendered alongside
   * the order on CS / Logistics detail pages.
   */
  customFields: jsonb('custom_fields'),
  /** Branch this order belongs to. Set on creation, enforced by RLS. */
  branchId: uuid('branch_id'),
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
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
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

// Table 11: call_logs — VOIP call records
export const callLogs = pgTable('call_logs', {
  id: uuidv7Pk(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => users.id),
  callToken: text('call_token'),
  durationSeconds: integer('duration_seconds'),
  callStatus: callStatusEnum('call_status').notNull(),
  recordingUrl: text('recording_url'),
  transcript: text('transcript'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});

// Table: order_timeline_events — human-readable per-order lifecycle narrative.
// Append-only. Written atomically with every state transition. Never modified after insert.
export const orderTimelineEvents = pgTable('order_timeline_events', {
  id: uuidv7Pk(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  eventType: timelineEventTypeEnum('event_type').notNull(),
  /** UUID of the user who triggered this event. Null for system/edge events. */
  actorId: uuid('actor_id').references(() => users.id),
  /** Denormalized name snapshot at event time — survives user renames without joins. */
  actorName: text('actor_name'),
  /** Human-readable sentence describing what happened. */
  description: text('description').notNull(),
  /** Extra contextual data: old/new values, durations, quantities, GPS, template names, etc. */
  metadata: jsonb('metadata'),
  /** Branch context — scopes the event to a branch for RLS filtering. */
  branchId: uuid('branch_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
