import { uuid, pgTable, text, numeric, jsonb, timestamp, index, integer } from 'drizzle-orm/pg-core';
import { deploymentTypeEnum, fundingStatusEnum, fundingRequestStatusEnum, mbFundTransferStatusEnum, recordStatusEnum, adSpendStatusEnum, adPlatformEnum, expenseCategoryEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { branches } from './branches';

// Table: offer_groups — reusable multi-item offers
export const offerGroups = pgTable('offer_groups', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});

// Table: offer_group_items — offer items within a group
export const offerGroupItems = pgTable(
  'offer_group_items',
  {
    id: uuidv7Pk(),
    offerGroupId: uuid('offer_group_id')
      .notNull()
      .references(() => offerGroups.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    label: text('label').notNull(),
    quantity: integer('quantity').notNull().default(1),
    price: numeric('price', { precision: 12, scale: 2 }).notNull(),
    imageUrl: text('image_url'),
    sortOrder: integer('sort_order').notNull().default(0),
    status: recordStatusEnum('status').default('ACTIVE').notNull(),
    ...temporalColumns,
    ...timestampColumns,
  },
  (table) => ({
    groupSortIdx: index('offer_group_items_group_sort_idx').on(table.offerGroupId, table.sortOrder),
    productIdx: index('offer_group_items_product_idx').on(table.productId),
    statusIdx: index('offer_group_items_status_idx').on(table.status),
  }),
);

// Table 7: offer_templates — pre-configured sale offers
export const offerTemplates = pgTable('offer_templates', {
  id: uuidv7Pk(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  name: text('name').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  /** Sellable bundle quantity for this tier (Edge form / orders). */
  quantity: integer('quantity').notNull().default(1),
  /** Thumbnail gallery for this tier on public forms (URLs). */
  imageUrls: jsonb('image_urls').notNull().default([]),
  variants: jsonb('variants'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 8: campaigns — media buyer campaigns
export const campaigns = pgTable('campaigns', {
  id: uuidv7Pk(),
  mediaBuyerId: uuid('media_buyer_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  productIds: jsonb('product_ids'),
  offerTemplateId: uuid('offer_template_id').references(() => offerTemplates.id),
  offerGroupId: uuid('offer_group_id').references(() => offerGroups.id),
  formConfig: jsonb('form_config'),
  deploymentType: deploymentTypeEnum('deployment_type').default('HOSTED').notNull(),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  /** Branch this campaign belongs to; aligns with orders and RLS. */
  branchId: uuid('branch_id').references(() => branches.id),
  ...temporalColumns,
  ...timestampColumns,
});

// Table: marketing_funding_requests — declared before marketing_funding for FK from ledger → request
export const marketingFundingRequests = pgTable('marketing_funding_requests', {
  id: uuidv7Pk(),
  requesterId: uuid('requester_id')
    .notNull()
    .references(() => users.id),
  /**
   * The user the request is directed at — Head of Marketing or Finance Officer
   * (CEO directive 2026-05-03). NULL = legacy broadcast row created before
   * migration 0106; legacy visibility falls back to the role-based audience
   * (HoM for MB requests, Finance/SuperAdmin for HoM requests).
   */
  targetUserId: uuid('target_user_id').references(() => users.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  status: fundingRequestStatusEnum('status').default('PENDING').notNull(),
  receiptUrl: text('receipt_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: uuid('resolved_by').references(() => users.id),
  ...temporalColumns,
});

// Table 14: marketing_funding — HoM funding to Media Buyers (and Finance→HoM); optional link to approved request
// Unique on source_funding_request_id (partial, WHERE NOT NULL) is enforced in SQL migration 0070 only.
export const marketingFunding = pgTable('marketing_funding', {
  id: uuidv7Pk(),
  senderId: uuid('sender_id')
    .notNull()
    .references(() => users.id),
  receiverId: uuid('receiver_id')
    .notNull()
    .references(() => users.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  receiptUrl: text('receipt_url'),
  status: fundingStatusEnum('status').default('SENT').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  /** When set, this ledger row was created by approving the linked funding request. */
  sourceFundingRequestId: uuid('source_funding_request_id').references(() => marketingFundingRequests.id),
  ...temporalColumns,
});

// Table 15: ad_spend_logs — daily ad spend records
export const adSpendLogs = pgTable('ad_spend_logs', {
  id: uuidv7Pk(),
  mediaBuyerId: uuid('media_buyer_id')
    .notNull()
    .references(() => users.id),
  productId: uuid('product_id')
    .references(() => products.id),
  campaignId: uuid('campaign_id')
    .references(() => campaigns.id),
  spendAmount: numeric('spend_amount', { precision: 12, scale: 2 }).notNull(),
  screenshotUrl: text('screenshot_url'),
  /** Optional link to the actual ad creative (Meta Ads Manager URL, TikTok Ads URL, etc.). */
  adUrl: text('ad_url'),
  /** Ad platform — defaults to FACEBOOK (vast majority of spend). */
  platform: adPlatformEnum('platform').default('FACEBOOK').notNull(),
  /** When `platform` is OTHER, Media Buyer–supplied label (e.g. Snapchat). Otherwise null. */
  platformCustomLabel: text('platform_custom_label'),
  /** Expense category — only AD_SPEND rows feed into CPA/ROAS. Others deduct from balance only. */
  category: expenseCategoryEnum('category').default('AD_SPEND').notNull(),
  /** Free-text description for non-AD_SPEND categories (e.g. "WhatsApp API credits for May"). */
  description: text('description'),
  /**
   * Manual order-split entered by the Media Buyer when creating the batch.
   * The Add Expense modal asks for the form's total order count from the
   * system, then has the MB split that total across each line — sum of
   * line.attributed_order_count must equal the system total. Used to compute
   * per-line CPA (= spend / attributed_order_count) at view time.
   *
   * 0 means "not yet split" — pre-directive rows fall back to the snapshot
   * interval calc so historical reports stay valid.
   */
  attributedOrderCount: integer('attributed_order_count').default(0).notNull(),
  /** System-derived order count frozen at log/update time (new daily flow). */
  orderCountSnapshot: integer('order_count_snapshot'),
  spendDate: timestamp('spend_date', { withTimezone: true }).notNull(),
  status: adSpendStatusEnum('status').default('PENDING').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by').references(() => users.id),
  rejectionReason: text('rejection_reason'),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});

/**
 * cross_funnel_attempts — same customer (phone) tried to order the same product
 * via a DIFFERENT Media Buyer's funnel within the dedup window. The first MB to
 * land an order wins attribution; subsequent submissions are recorded here, NOT
 * created as orders, NOT seen by CS, and NOT counted in any metric.
 *
 * Purpose: give each MB visibility that their funnel is generating real interest
 * even when they didn't get attribution. Strictly per-MB visibility.
 *
 * `original_order_id` FK is enforced at the DB level only (SQL migration) to
 * avoid a circular Drizzle import between marketing.ts and orders.ts.
 */
export const crossFunnelAttempts = pgTable(
  'cross_funnel_attempts',
  {
    id: uuidv7Pk(),
    /** SHA-256 hash of the normalized phone. */
    customerPhoneHash: text('customer_phone_hash').notNull(),
    /** Raw phone — visible to the runner-up MB on the cross-funnel page. */
    customerPhone: text('customer_phone'),
    customerName: text('customer_name').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    /** Whose form caught the duplicate. They are the only non-admin who can see this row. */
    mediaBuyerId: uuid('media_buyer_id')
      .notNull()
      .references(() => users.id),
    /** Their funnel/campaign. */
    campaignId: uuid('campaign_id').references(() => campaigns.id),
    /** Branch context for HoM scoping. Derived from campaign or MB at insert. */
    branchId: uuid('branch_id').references(() => branches.id),
    /** The winning order (DB-level FK to orders.id). May be null if order was hard-deleted. */
    originalOrderId: uuid('original_order_id'),
    /** Denormalized — who got attribution. Useful for the MB to see "credited to X". */
    originalMediaBuyerId: uuid('original_media_buyer_id').references(() => users.id),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    mediaBuyerAttemptedAtIdx: index('cfa_media_buyer_attempted_at_idx').on(
      table.mediaBuyerId,
      table.attemptedAt,
    ),
    branchAttemptedAtIdx: index('cfa_branch_attempted_at_idx').on(
      table.branchId,
      table.attemptedAt,
    ),
    phoneProductIdx: index('cfa_phone_product_idx').on(
      table.customerPhoneHash,
      table.productId,
      table.attemptedAt,
    ),
    originalOrderIdx: index('cfa_original_order_idx').on(table.originalOrderId),
  }),
);

// ── MB Fund Transfers — peer-to-peer funding within a branch ────────────
export const mbFundTransfers = pgTable('mb_fund_transfers', {
  id: uuidv7Pk(),
  senderMbId: uuid('sender_mb_id').notNull().references(() => users.id),
  receiverMbId: uuid('receiver_mb_id').notNull().references(() => users.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  status: mbFundTransferStatusEnum('status').default('PENDING').notNull(),
  branchId: uuid('branch_id').references(() => branches.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  rejectedBy: uuid('rejected_by').references(() => users.id),
  rejectedAt: timestamp('rejected_at', { withTimezone: true }),
  rejectionReason: text('rejection_reason'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  /** The marketing_funding ledger row created on acceptance. */
  ledgerEntryId: uuid('ledger_entry_id').references(() => marketingFunding.id),
  ...temporalColumns,
  ...timestampColumns,
}, (table) => ({
  senderStatusIdx: index('mb_ft_sender_status_idx').on(table.senderMbId, table.status),
  receiverStatusIdx: index('mb_ft_receiver_status_idx').on(table.receiverMbId, table.status),
  branchStatusIdx: index('mb_ft_branch_status_idx').on(table.branchId, table.status),
}));
