import { uuid, pgTable, text, integer, numeric, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { stockBatches } from './inventory';
import { logisticsProviders, logisticsLocations } from './logistics';
import { campaigns } from './marketing';
import { orders, followUpGroups } from './orders';
import { branches } from './branches';

// ── Follow-Up Rules ──────────────────────────────────────────────────
// Admin-configured rules that define which stale orders get auto-pulled
// into the follow-up pipeline. Evaluated by the midnight cron + manual sync.

export const followUpRules = pgTable('follow_up_rules', {
  id: uuidv7Pk(),
  /** Human-readable label, e.g. "Confirmed > 7 days". */
  name: text('name').notNull(),
  /** Order status to match, e.g. CONFIRMED, CS_ENGAGED. */
  sourceStatus: text('source_status').notNull(),
  /** Minimum age in days for the order to qualify. */
  ageThresholdDays: integer('age_threshold_days').notNull(),
  /** Optional hours-based threshold. When set, takes precedence over ageThresholdDays (for sub-day rules like cart abandonment). */
  ageThresholdHours: integer('age_threshold_hours'),
  /** Maximum age in days (optional). When set, only orders between ageThresholdDays and maxAgeDays old match. */
  maxAgeDays: integer('max_age_days'),
  /** Optional source branch filter. NULL = org-wide (all branches). */
  sourceBranchId: uuid('source_branch_id').references(() => branches.id),
  /** Target: push to this branch's CS team. XOR with targetGroupId. */
  targetBranchId: uuid('target_branch_id').references(() => branches.id),
  /** Target: push to this follow-up group. XOR with targetBranchId. */
  targetGroupId: uuid('target_group_id').references(() => followUpGroups.id),
  /** Which timestamp the age threshold is measured from.
   *  STATUS_TIMESTAMP = confirmedAt/allocatedAt/etc (default).
   *  CREATED_AT = order creation date.
   *  PREFERRED_DELIVERY_DATE = scheduled delivery date. */
  ageRelativeTo: text('age_relative_to').notNull().default('STATUS_TIMESTAMP'),
  /** Optional target team: auto-assign follow-up orders only to closers in this team.
   *  NULL = any closer in the target branch. */
  teamId: uuid('team_id'),
  /** Higher priority = evaluated first. */
  priority: integer('priority').notNull().default(0),
  /** Disabled rules are skipped during sync. */
  enabled: boolean('enabled').notNull().default(true),
  /** When true (default), the source order is frozen when the follow-up copy is created.
   *  When false, the source order stays active — both original and follow-up compete. */
  freezeOriginal: boolean('freeze_original').notNull().default(true),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Follow-Up Orders ─────────────────────────────────────────────────
// Separate table for follow-up copies. Mirrors the orders table columns.
// Full lifecycle: UNPROCESSED → ... → DELIVERED. On DELIVERED, graduates
// into the orders table. Source order gets frozen_for_follow_up = true.

export const followUpOrders = pgTable('follow_up_orders', {
  id: uuidv7Pk(),
  orderNumber: integer('order_number').default(sql`nextval('order_number_seq')`).notNull().unique(),
  /** The frozen source order this follow-up was created from. NULL for cart-abandonment pulls. */
  sourceOrderId: uuid('source_order_id').references(() => orders.id),
  /** Which config rule pulled this order. NULL = manual follow-up. */
  followUpRuleId: uuid('follow_up_rule_id').references(() => followUpRules.id),
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
  /** Target team for auto-assignment. NULL = any closer in the branch. */
  routingTeamId: uuid('routing_team_id'),
  cartId: uuid('cart_id'),
  /** Back-link to the graduated orders row. NULL until graduation. Set once, prevents double-graduation. Migration 0263. */
  graduatedOrderId: uuid('graduated_order_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  allocatedAt: timestamp('allocated_at', { withTimezone: true }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...temporalColumns,
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Follow-Up Order Items ────────────────────────────────────────────
export const followUpOrderItems = pgTable('follow_up_order_items', {
  id: uuidv7Pk(),
  followUpOrderId: uuid('follow_up_order_id')
    .notNull()
    .references(() => followUpOrders.id),
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

// ── Follow-Up Order Timeline Events ──────────────────────────────────
export const followUpOrderTimelineEvents = pgTable('follow_up_order_timeline_events', {
  id: uuidv7Pk(),
  followUpOrderId: uuid('follow_up_order_id')
    .notNull()
    .references(() => followUpOrders.id),
  eventType: text('event_type').notNull(),
  actorId: uuid('actor_id').references(() => users.id),
  actorName: text('actor_name'),
  description: text('description').notNull(),
  metadata: jsonb('metadata'),
  branchId: uuid('branch_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Follow-Up Sync Logs ──────────────────────────────────────────────
// Tracks each automated or manual sync run for audit + debugging.

export const followUpSyncLogs = pgTable('follow_up_sync_logs', {
  id: uuidv7Pk(),
  /** 'cron' or 'manual' */
  triggeredBy: text('triggered_by').notNull(),
  /** User who triggered manual sync. NULL for cron. */
  triggeredByUserId: uuid('triggered_by_user_id').references(() => users.id),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  totalPulled: integer('total_pulled').notNull().default(0),
  /** Per-rule breakdown: [{ruleId, ruleName, pulled}] */
  ruleResults: jsonb('rule_results'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
