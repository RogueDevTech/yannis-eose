"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stockTransfers = exports.stockMovements = exports.inventoryLevels = exports.stockBatches = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
const products_1 = require("./products");
const users_1 = require("./users");
const logistics_1 = require("./logistics");
exports.stockBatches = (0, pg_core_1.pgTable)('stock_batches', {
    id: (0, helpers_1.uuidv7Pk)(),
    productId: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => products_1.products.id),
    factoryCost: (0, pg_core_1.numeric)('factory_cost', { precision: 12, scale: 2 }).notNull(),
    landingCost: (0, pg_core_1.numeric)('landing_cost', { precision: 12, scale: 2 }).notNull(),
    totalLandedCost: (0, pg_core_1.numeric)('total_landed_cost', { precision: 12, scale: 2 }).notNull(),
    quantity: (0, pg_core_1.integer)('quantity').notNull(),
    remainingQuantity: (0, pg_core_1.integer)('remaining_quantity').notNull(),
    receivedAt: (0, pg_core_1.timestamp)('received_at', { withTimezone: true }).defaultNow().notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
exports.inventoryLevels = (0, pg_core_1.pgTable)('inventory_levels', {
    id: (0, helpers_1.uuidv7Pk)(),
    productId: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => products_1.products.id),
    locationId: (0, pg_core_1.text)('location_id')
        .notNull()
        .references(() => logistics_1.logisticsLocations.id),
    batchId: (0, pg_core_1.text)('batch_id').references(() => exports.stockBatches.id),
    stockCount: (0, pg_core_1.integer)('stock_count').default(0).notNull(),
    reservedCount: (0, pg_core_1.integer)('reserved_count').default(0).notNull(),
    status: (0, enums_1.stockStateEnum)('status').default('AVAILABLE').notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
exports.stockMovements = (0, pg_core_1.pgTable)('stock_movements', {
    id: (0, helpers_1.uuidv7Pk)(),
    productId: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => products_1.products.id),
    movementType: (0, enums_1.movementTypeEnum)('movement_type').notNull(),
    quantity: (0, pg_core_1.integer)('quantity').notNull(),
    fromLocationId: (0, pg_core_1.text)('from_location_id').references(() => logistics_1.logisticsLocations.id),
    toLocationId: (0, pg_core_1.text)('to_location_id').references(() => logistics_1.logisticsLocations.id),
    referenceId: (0, pg_core_1.text)('reference_id'),
    reason: (0, pg_core_1.text)('reason'),
    actorId: (0, pg_core_1.text)('actor_id')
        .notNull()
        .references(() => users_1.users.id),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
});
exports.stockTransfers = (0, pg_core_1.pgTable)('stock_transfers', {
    id: (0, helpers_1.uuidv7Pk)(),
    productId: (0, pg_core_1.text)('product_id')
        .notNull()
        .references(() => products_1.products.id),
    quantitySent: (0, pg_core_1.integer)('quantity_sent').notNull(),
    quantityReceived: (0, pg_core_1.integer)('quantity_received'),
    fromLocationId: (0, pg_core_1.text)('from_location_id')
        .notNull()
        .references(() => logistics_1.logisticsLocations.id),
    toLocationId: (0, pg_core_1.text)('to_location_id')
        .notNull()
        .references(() => logistics_1.logisticsLocations.id),
    transferStatus: (0, enums_1.transferStatusEnum)('transfer_status').default('PENDING').notNull(),
    shrinkageReason: (0, pg_core_1.text)('shrinkage_reason'),
    transferCost: (0, pg_core_1.numeric)('transfer_cost', { precision: 12, scale: 2 }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
    verifiedAt: (0, pg_core_1.timestamp)('verified_at', { withTimezone: true }),
    ...helpers_1.temporalColumns,
});
//# sourceMappingURL=inventory.js.map