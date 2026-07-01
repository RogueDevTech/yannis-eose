import { pgTable, text, jsonb, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

/**
 * Per-user per-page filter preferences — lets every user save their default
 * filters (date range, status, pagination, sort, etc.) for any page they
 * access. One row per user × page. Cached in Redis for fast reads.
 */
export const userFilterPreferences = pgTable('user_filter_preferences', {
  id: uuidv7Pk(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Dot-separated page key, e.g. 'admin.marketing.orders'. */
  pageKey: text('page_key').notNull(),
  /** Search param key-value pairs, e.g. { startDate: '2026-06-01', status: 'DELIVERED' }. */
  filters: jsonb('filters').notNull().$type<Record<string, string>>(),
  ...temporalColumns,
  ...timestampColumns,
}, (t) => ({
  uniqUserPage: uniqueIndex('user_filter_prefs_user_page_uniq').on(t.userId, t.pageKey),
}));
