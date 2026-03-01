import { pgTable, text, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';
import { users } from './users';

// Table 20: notifications — in-app & push notifications
export const notifications = pgTable('notifications', {
  id: uuidv7Pk(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  data: jsonb('data'),
  read: boolean('read').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
