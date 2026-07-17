import { uuid, pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';
import { users } from './users';
import { branches } from './branches';

// Table 20: notifications — in-app & push notifications
export const notifications = pgTable('notifications', {
  id: uuidv7Pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  data: jsonb('data'),
  read: boolean('read').default(false).notNull(),
  /**
   * Branch this notification belongs to, for company-scoping.
   * NULL = global / system-wide notification (visible in all companies).
   * Auto-stamped on creation from data.branchId or resolved from data.orderId.
   */
  branchId: uuid('branch_id').references(() => branches.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
