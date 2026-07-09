import { uuid, pgTable, text, integer, numeric, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { stockBatches } from './inventory';
import { logisticsProviders, logisticsLocations } from './logistics';
import { campaigns } from './marketing';
import { cartAbandonments } from './cart';
import { branches } from './branches';

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
  /** Which routing rule determined the servicing branch. NULL = manual pull / fallback. */
  routingRuleId: uuid('routing_rule_id'),
  /** Target team for auto-assignment. NULL = any closer in the branch. */
  routingTeamId: uuid('routing_team_id'),
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

// ── Cart Order Routing Rules ────────────────────────────────────────
// Admin-configured rules that determine which branch cart orders are
// routed to when pulled from abandoned carts. Evaluated in priority
// order (highest first). First matching rule wins.

export const cartOrderRoutingRules = pgTable('cart_order_routing_rules', {
  id: uuidv7Pk(),
  /** Human-readable label, e.g. "Lagos carts → Lagos CS". */
  name: text('name').notNull(),
  /** Optional source branch filter: only route carts whose campaign belongs to this marketing branch.
   *  NULL = match carts from any branch (org-wide). */
  sourceBranchId: uuid('source_branch_id').references(() => branches.id),
  /** Target: push cart orders to this specific branch's CS team.
   *  NULL = round-robin across all active CS branches. */
  targetBranchId: uuid('target_branch_id').references(() => branches.id),
  /** Optional target team: auto-assign only to closers in this team.
   *  NULL = any closer in the target branch. */
  teamId: uuid('team_id'),
  /** Higher priority = evaluated first. */
  priority: integer('priority').notNull().default(0),
  /** Disabled rules are skipped during routing. */
  enabled: boolean('enabled').notNull().default(true),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Cart Order Sync Logs ────────────────────────────────────────────
// Tracks each auto-pull cron run for audit + debugging.

export const cartOrderSyncLogs = pgTable('cart_order_sync_logs', {
  id: uuidv7Pk(),
  /** 'cron' or 'manual' */
  triggeredBy: text('triggered_by').notNull(),
  /** User who triggered manual sync. NULL for cron. */
  triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  totalPulled: integer('total_pulled').notNull().default(0),
  /** Per-rule breakdown: [{ruleId, ruleName, pulled, targetBranchName}] */
  ruleResults: jsonb('rule_results'),
  /** Count of carts routed via fallback (no rule matched). */
  fallbackCount: integer('fallback_count').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
