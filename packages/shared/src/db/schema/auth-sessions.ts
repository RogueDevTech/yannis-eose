import { pgTable, text, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { uuidv7Pk, timestampColumns } from './helpers';
import { users } from './users';

// Fallback/persistent auth sessions for Redis outage resilience.
// Redis remains the hot path; this table is the durable backup.
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuidv7Pk(),
    token: text('token').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    sessionData: jsonb('session_data').notNull().$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => ({
    tokenIdx: index('auth_sessions_token_idx').on(table.token),
    userIdIdx: index('auth_sessions_user_id_idx').on(table.userId),
    expiresAtIdx: index('auth_sessions_expires_at_idx').on(table.expiresAt),
    revokedAtIdx: index('auth_sessions_revoked_at_idx').on(table.revokedAt),
  }),
);
