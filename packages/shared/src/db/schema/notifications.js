"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifications = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
const helpers_1 = require("./helpers");
const users_1 = require("./users");
exports.notifications = (0, pg_core_1.pgTable)('notifications', {
    id: (0, helpers_1.uuidv7Pk)(),
    userId: (0, pg_core_1.text)('user_id')
        .notNull()
        .references(() => users_1.users.id),
    type: (0, pg_core_1.text)('type').notNull(),
    title: (0, pg_core_1.text)('title').notNull(),
    body: (0, pg_core_1.text)('body'),
    data: (0, pg_core_1.jsonb)('data'),
    read: (0, pg_core_1.boolean)('read').default(false).notNull(),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).defaultNow().notNull(),
});
//# sourceMappingURL=notifications.js.map