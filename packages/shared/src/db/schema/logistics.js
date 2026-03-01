"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logisticsLocations = exports.logisticsProviders = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
exports.logisticsProviders = (0, pg_core_1.pgTable)('logistics_providers', {
    id: (0, helpers_1.uuidv7Pk)(),
    name: (0, pg_core_1.text)('name').notNull(),
    contactInfo: (0, pg_core_1.text)('contact_info'),
    coverageArea: (0, pg_core_1.text)('coverage_area'),
    rateCard: (0, pg_core_1.jsonb)('rate_card'),
    status: (0, enums_1.recordStatusEnum)('status').default('ACTIVE').notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
exports.logisticsLocations = (0, pg_core_1.pgTable)('logistics_locations', {
    id: (0, helpers_1.uuidv7Pk)(),
    providerId: (0, pg_core_1.text)('provider_id')
        .notNull()
        .references(() => exports.logisticsProviders.id),
    name: (0, pg_core_1.text)('name').notNull(),
    address: (0, pg_core_1.text)('address').notNull(),
    coordinates: (0, pg_core_1.text)('coordinates'),
    status: (0, enums_1.recordStatusEnum)('status').default('ACTIVE').notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
//# sourceMappingURL=logistics.js.map