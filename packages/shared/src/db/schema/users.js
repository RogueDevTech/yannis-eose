"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.users = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const enums_1 = require("./enums");
const helpers_1 = require("./helpers");
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, helpers_1.uuidv7Pk)(),
    name: (0, pg_core_1.text)('name').notNull(),
    email: (0, pg_core_1.text)('email').notNull().unique(),
    passwordHash: (0, pg_core_1.text)('password_hash').notNull(),
    role: (0, enums_1.userRoleEnum)('role').notNull(),
    status: (0, enums_1.recordStatusEnum)('status').default('ACTIVE').notNull(),
    capacity: (0, pg_core_1.integer)('capacity').default(10).notNull(),
    ...helpers_1.temporalColumns,
    ...helpers_1.timestampColumns,
});
//# sourceMappingURL=users.js.map