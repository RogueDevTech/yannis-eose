import { uuid, pgTable, text, numeric, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { deploymentTypeEnum, fundingStatusEnum, fundingRequestStatusEnum, recordStatusEnum, adSpendStatusEnum, adPlatformEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';
import { branches } from './branches';

// Table 7: offer_templates — pre-configured sale offers
export const offerTemplates = pgTable('offer_templates', {
  id: uuidv7Pk(),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  name: text('name').notNull(),
  price: numeric('price', { precision: 12, scale: 2 }).notNull(),
  variants: jsonb('variants'),
  createdBy: text('created_by')
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
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  reason: text('reason'),
  status: fundingRequestStatusEnum('status').default('PENDING').notNull(),
  receiptUrl: text('receipt_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolvedBy: text('resolved_by').references(() => users.id),
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
    .notNull()
    .references(() => products.id),
  campaignId: uuid('campaign_id')
    .notNull()
    .references(() => campaigns.id),
  spendAmount: numeric('spend_amount', { precision: 12, scale: 2 }).notNull(),
  screenshotUrl: text('screenshot_url').notNull(),
  /** Optional link to the actual ad creative (Meta Ads Manager URL, TikTok Ads URL, etc.). */
  adUrl: text('ad_url'),
  /** Ad platform — defaults to FACEBOOK (vast majority of spend). */
  platform: adPlatformEnum('platform').default('FACEBOOK').notNull(),
  spendDate: timestamp('spend_date', { withTimezone: true }).notNull(),
  status: adSpendStatusEnum('status').default('PENDING').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by').references(() => users.id),
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
    /** SHA-256 hash of the normalized phone — never store raw phone (Pillar 2). */
    customerPhoneHash: text('customer_phone_hash').notNull(),
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
