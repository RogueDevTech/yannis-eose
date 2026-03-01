"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timestampColumns = exports.temporalColumns = exports.uuidv7Pk = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const pg_core_1 = require("drizzle-orm/pg-core");
const uuidv7Pk = () => (0, pg_core_1.text)('id')
    .primaryKey()
    .default((0, drizzle_orm_1.sql) `gen_random_uuid()`)
    .notNull();
exports.uuidv7Pk = uuidv7Pk;
exports.temporalColumns = {
    validFrom: (0, pg_core_1.timestamp)('valid_from', { withTimezone: true })
        .defaultNow()
        .notNull(),
    validTo: (0, pg_core_1.timestamp)('valid_to', { withTimezone: true }),
    modifiedBy: (0, pg_core_1.text)('modified_by'),
};
exports.timestampColumns = {
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true })
        .defaultNow()
        .notNull(),
};
//# sourceMappingURL=helpers.js.map