import { pgTable, text, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { deploymentTypeEnum, fundingStatusEnum, fundingRequestStatusEnum, recordStatusEnum, adSpendStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { products } from './products';

// Table 7: offer_templates — pre-configured sale offers
export const offerTemplates = pgTable('offer_templates', {
  id: uuidv7Pk(),
  productId: text('product_id')
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
  mediaBuyerId: text('media_buyer_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  productIds: jsonb('product_ids'),
  offerTemplateId: text('offer_template_id').references(() => offerTemplates.id),
  formConfig: jsonb('form_config'),
  deploymentType: deploymentTypeEnum('deployment_type').default('HOSTED').notNull(),
  status: recordStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// Table 14: marketing_funding — HoM funding to Media Buyers
export const marketingFunding = pgTable('marketing_funding', {
  id: uuidv7Pk(),
  senderId: text('sender_id')
    .notNull()
    .references(() => users.id),
  receiverId: text('receiver_id')
    .notNull()
    .references(() => users.id),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  receiptUrl: text('receipt_url'),
  status: fundingStatusEnum('status').default('SENT').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  ...temporalColumns,
});

// Table: marketing_funding_requests — Media Buyer requests for funds (HoM approves by sending actual funding)
export const marketingFundingRequests = pgTable('marketing_funding_requests', {
  id: uuidv7Pk(),
  requesterId: text('requester_id')
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

// Table 15: ad_spend_logs — daily ad spend records
export const adSpendLogs = pgTable('ad_spend_logs', {
  id: uuidv7Pk(),
  mediaBuyerId: text('media_buyer_id')
    .notNull()
    .references(() => users.id),
  productId: text('product_id')
    .notNull()
    .references(() => products.id),
  campaignId: text('campaign_id')
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
