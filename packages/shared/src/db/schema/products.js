"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.products = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
exports.products = (0, pg_core_1.pgTable)('products', {
    id: (0, helpers_1.uuidv7Pk)(),
    name: (0, pg_core_1.text)('name').notNull(),
    description: (0, pg_core_1.text)('description'),
    sku: (0, pg_core_1.text)('sku').notNull().unique(),
    baseSalePrice: (0, pg_core_1.numeric)('base_sale_price', { precision: 12, scale: 2 }).notNull(),
    costPrice: (0, pg_core_1.numeric)('cost_price', { precision: 12, scale: 2 }).notNull(),
    minThreshold: (0, pg_core_1.integer)('min_threshold').default(0).notNull(),
    category: (0, pg_core_1.text)('category'),
    status: (0, enums_1.recordStatusEnum)('status').default('ACTIVE').notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
//# sourceMappingURL=products.js.map