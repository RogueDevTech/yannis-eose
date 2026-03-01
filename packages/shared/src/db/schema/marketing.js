"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adSpendLogs = exports.marketingFunding = exports.campaigns = exports.offerTemplates = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
const users_1 = require("./users");
const products_1 = require("./products");
exports.offerTemplates = (0, pg_core_1.pgTable)('offer_templates', {
    id: (0, helpers_1.uuidv7Pk)(),
    productId: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => products_1.products.id),
    name: (0, pg_core_1.text)('name').notNull(),
    price: (0, pg_core_1.numeric)('price', { precision: 12, scale: 2 }).notNull(),
    variants: (0, pg_core_1.jsonb)('variants'),
    createdBy: (0, pg_core_1.text)('created_by')
        .notNull()
        .references(() => users_1.users.id),
    status: (0, enums_1.recordStatusEnum)('status').default('ACTIVE').notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
exports.campaigns = (0, pg_core_1.pgTable)('campaigns', {
    id: (0, helpers_1.uuidv7Pk)(),
    mediaBuyerId: (0, pg_core_1.text)('media_buyer_id')
        .notNull()
        .references(() => users_1.users.id),
    name: (0, pg_core_1.text)('name').notNull(),
    productIds: (0, pg_core_1.jsonb)('product_ids'),
    offerTemplateId: (0, pg_core_1.text)('offer_template_id').references(() => exports.offerTemplates.id),
    formConfig: (0, pg_core_1.jsonb)('form_config'),
    deploymentType: (0, enums_1.deploymentTypeEnum)('deployment_type').default('HOSTED').notNull(),
    status: (0, enums_1.recordStatusEnum)('status').default('ACTIVE').notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
exports.marketingFunding = (0, pg_core_1.pgTable)('marketing_funding', {
    id: (0, helpers_1.uuidv7Pk)(),
    senderId: (0, pg_core_1.text)('sender_id')
        .notNull()
        .references(() => users_1.users.id),
    receiverId: (0, pg_core_1.text)('receiver_id')
        .notNull()
        .references(() => users_1.users.id),
    amount: (0, pg_core_1.numeric)('amount', { precision: 12, scale: 2 }).notNull(),
    receiptUrl: (0, pg_core_1.text)('receipt_url'),
    status: (0, enums_1.fundingStatusEnum)('status').default('SENT').notNull(),
    sentAt: (0, pg_core_1.timestamp)('sent_at', { withTimezone: true }).defaultNow().notNull(),
    verifiedAt: (0, pg_core_1.timestamp)('verified_at', { withTimezone: true }),
    ...helpers_1.temporalColumns,
});
exports.adSpendLogs = (0, pg_core_1.pgTable)('ad_spend_logs', {
    id: (0, helpers_1.uuidv7Pk)(),
    mediaBuyerId: (0, pg_core_1.text)('media_buyer_id')
        .notNull()
        .references(() => users_1.users.id),
    productId: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => products_1.products.id),
    campaignId: (0, pg_core_1.text)('campaign_id')
        .notNull()
        .references(() => exports.campaigns.id),
    spendAmount: (0, pg_core_1.numeric)('spend_amount', { precision: 12, scale: 2 }).notNull(),
    screenshotUrl: (0, pg_core_1.text)('screenshot_url').notNull(),
    spendDate: (0, pg_core_1.timestamp)('spend_date', { withTimezone: true }).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
});
//# sourceMappingURL=marketing.js.map