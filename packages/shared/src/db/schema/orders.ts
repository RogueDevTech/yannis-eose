import { uuid, pgTable, text, integer, numeric, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
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
  /** Sequential human-friendly reference. Displayed as YNS-XXXXX. DB default: nextval('order_number_seq'). */
  orderNumber: integer('order_number').default(sql`nextval('order_number_seq')`).notNull().unique(),
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
  // null = normal | 'FLAGGED' = same phone non-cancelled order in last 24h
  // 'POSSIBLY_DUPLICATE' = same phone non-cancelled order older than 24h but within 30d (softer signal)
  // 'MERGED' = merged into another | 'DISMISSED' = agent cleared it
  isDuplicate: text('is_duplicate'),
  duplicateOfId: uuid('duplicate_of_id'), // links to the original order if flagged
  // 15-min order lock: when an agent clicks Call, order is locked to them
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lockedBy: uuid('locked_by').references(() => users.id),
  /** Order source for reporting: 'edge-form' (sales form) or 'offline' (CS manual entry) */
  orderSource: text('order_source'),
  /**
   * Custom field responses from the campaign form builder. Keyed by `formConfig.customFields[].id`.
   * Values are strings, numbers, booleans, or string arrays depending on the field type.
   * Null when the form has no custom fields. Never queried by value — only rendered alongside
   * the order on CS / Logistics detail pages.
   */
  customFields: jsonb('custom_fields'),
  /**
   * MARKETING branch — the campaign/form branch this order is attributed to.
   * Set once on creation, never changes. Drives MB / HoM / Team Analysis /
   * Marketing P&L. NOT the CS servicing branch — see `servicingBranchId`.
   */
  branchId: uuid('branch_id'),
  /**
   * CS SERVICING branch — which branch's CS team works this order. Resolved
   * from CS order routing rules at creation; falls back to `branchId` when no
   * rule matches. Drives CS queues, claim dispatch, and logistics scoping.
   * Migration 0150.
   */
  servicingBranchId: uuid('servicing_branch_id'),
  /**
   * Back-link to the originating cart_abandonments row when this order was
   * recovered from a dropped-off cart (CS-led recovery OR direct edge-form
   * conversion with the cartId in the submit payload). NULL for orders that
   * were never preceded by a cart row. Indexed for the `/admin/orders` filter
   * "Recovered from cart". Migration 0142.
   */
  cartId: uuid('cart_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  /**
   * Soft-delete (archive): when set, the order is excluded from lists and detail views.
   * Rows are never physically removed — temporal history + audit remain intact.
   */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** Set to true when an order is a follow-up copy. Excludes from normal order views. */
  isFollowUp: boolean('is_follow_up').default(false).notNull(),
  /** Links a follow-up copy back to the original order. NULL for normal orders. */
  followUpSourceOrderId: uuid('follow_up_source_order_id'),
  /** When true, order is frozen — no further status transitions, assignments, or edits allowed.
   *  Set by the follow-up config sync when the order is pulled into follow_up_orders. */
  frozenForFollowUp: boolean('frozen_for_follow_up').default(false).notNull(),
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

// ── Follow-Up Groups ──────────────────────────────────────────
// Named groups of CS closers that can be assigned follow-up batches.

export const followUpGroups = pgTable('follow_up_groups', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  createdById: uuid('created_by_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const followUpGroupMembers = pgTable('follow_up_group_members', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => followUpGroups.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Follow-Up Batches ──────────────────────────────────────────
// Tracks groups of orders reopened via the Follow Up page so users
// can measure conversion/recovery performance per batch.

export const followUpBatches = pgTable('follow_up_batches', {
  id: uuidv7Pk(),
  /** Display name — auto-generated ("Follow Up #N") or user-supplied. */
  name: text('name').notNull(),
  /** "orders" or "carts" — what was selected when the batch was created. */
  source: text('source').notNull().default('orders'),
  /** Target CS branch the orders were assigned to. */
  branchId: uuid('branch_id'),
  /** User who created this batch. */
  createdById: uuid('created_by_id').references(() => users.id).notNull(),
  /** Denormalized count for list views (avoids COUNT on every row). */
  orderCount: integer('order_count').notNull().default(0),
  /** Follow-up group assigned to this batch. */
  groupId: uuid('group_id').references(() => followUpGroups.id),
  /** EQUAL = auto round-robin assign; MANUAL = user assigns individually. */
  assignmentMode: text('assignment_mode').notNull().default('MANUAL'),
  /** ACTIVE = live batch; REVERTED = batch deleted, orders restored. */
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const followUpBatchItems = pgTable('follow_up_batch_items', {
  id: uuidv7Pk(),
  batchId: uuid('batch_id').references(() => followUpBatches.id, { onDelete: 'cascade' }).notNull(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  /** Status of the order at the time it was added to the batch. */
  originalStatus: text('original_status').notNull(),
  /** CS closer assigned to work this order (set by auto-assign or manual). */
  assignedCsId: uuid('assigned_cs_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
