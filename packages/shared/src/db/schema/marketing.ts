import { uuid, pgTable, text, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { deploymentTypeEnum, fundingStatusEnum, fundingRequestStatusEnum, recordStatusEnum, adSpendStatusEnum } from './enums';
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
  spendDate: timestamp('spend_date', { withTimezone: true }).notNull(),
  status: adSpendStatusEnum('status').default('PENDING').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: text('approved_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
});
