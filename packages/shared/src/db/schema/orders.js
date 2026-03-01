"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callLogs = exports.orderItems = exports.orders = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
const users_1 = require("./users");
const products_1 = require("./products");
const inventory_1 = require("./inventory");
const logistics_1 = require("./logistics");
const marketing_1 = require("./marketing");
exports.orders = (0, pg_core_1.pgTable)('orders', {
    id: (0, helpers_1.uuidv7Pk)(),
    campaignId: (0, pg_core_1.text)('campaign_id').references(() => marketing_1.campaigns.id),
    mediaBuyerId: (0, pg_core_1.text)('media_buyer_id').references(() => users_1.users.id),
    assignedCsId: (0, pg_core_1.text)('assigned_cs_id').references(() => users_1.users.id),
    logisticsProviderId: (0, pg_core_1.text)('logistics_provider_id').references(() => logistics_1.logisticsProviders.id),
    logisticsLocationId: (0, pg_core_1.text)('logistics_location_id').references(() => logistics_1.logisticsLocations.id),
    riderId: (0, pg_core_1.text)('rider_id').references(() => users_1.users.id),
    status: (0, enums_1.orderStatusEnum)('status').default('UNPROCESSED').notNull(),
    items: (0, pg_core_1.jsonb)('items'),
    customerName: (0, pg_core_1.text)('customer_name').notNull(),
    customerPhoneHash: (0, pg_core_1.text)('customer_phone_hash').notNull(),
    customerAddress: (0, pg_core_1.text)('customer_address'),
    deliveryAddress: (0, pg_core_1.text)('delivery_address'),
    totalAmount: (0, pg_core_1.numeric)('total_amount', { precision: 12, scale: 2 }),
    landedCost: (0, pg_core_1.numeric)('landed_cost', { precision: 12, scale: 2 }),
    deliveryFee: (0, pg_core_1.numeric)('delivery_fee', { precision: 12, scale: 2 }),
    deliveryNotes: (0, pg_core_1.text)('delivery_notes'),
    parentOrderId: (0, pg_core_1.text)('parent_order_id'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: (0, pg_core_1.timestamp)('confirmed_at', { withTimezone: true }),
    allocatedAt: (0, pg_core_1.timestamp)('allocated_at', { withTimezone: true }),
    dispatchedAt: (0, pg_core_1.timestamp)('dispatched_at', { withTimezone: true }),
    deliveredAt: (0, pg_core_1.timestamp)('delivered_at', { withTimezone: true }),
    ...helpers_1.temporalColumns,
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
exports.orderItems = (0, pg_core_1.pgTable)('order_items', {
    id: (0, helpers_1.uuidv7Pk)(),
    orderId: (0, pg_core_1.text)('order_id')
        .notNull()
        .references(() => exports.orders.id),
    productId: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => products_1.products.id),
    quantity: (0, pg_core_1.integer)('quantity').notNull(),
    unitPrice: (0, pg_core_1.numeric)('unit_price', { precision: 12, scale: 2 }).notNull(),
    batchId: (0, pg_core_1.text)('batch_id').references(() => inventory_1.stockBatches.id),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
exports.callLogs = (0, pg_core_1.pgTable)('call_logs', {
    id: (0, helpers_1.uuidv7Pk)(),
    orderId: (0, pg_core_1.text)('order_id')
        .notNull()
        .references(() => exports.orders.id),
    agentId: (0, pg_core_1.text)('agent_id')
        .notNull()
        .references(() => users_1.users.id),
    callToken: (0, pg_core_1.text)('call_token'),
    durationSeconds: (0, pg_core_1.integer)('duration_seconds'),
    callStatus: (0, enums_1.callStatusEnum)('call_status').notNull(),
    recordingUrl: (0, pg_core_1.text)('recording_url'),
    transcript: (0, pg_core_1.text)('transcript'),
    startedAt: (0, pg_core_1.timestamp)('started_at', { withTimezone: true }).defaultNow().notNull(),
});
//# sourceMappingURL=orders.js.map