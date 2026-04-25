import { uuid, pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { uuidv7Pk, timestampColumns } from './helpers';
import { users } from './users';

/**
 * Audit trail of every "Mirror Mode" session — when a SuperAdmin/Admin or Head of
 * Department viewed the app through another user's eyes (read-only).
 *
 * The row is created when mirror mode starts and `endedAt` is stamped when it stops
 * (either explicitly via Exit Mirror, or when a new mirror starts and replaces the
 * active one). The row is permanent — even after end — so we always know who looked
 * through whose account and for how long.
 */
export const mirrorSessions = pgTable(
  'mirror_sessions',
  {
    id: uuidv7Pk(),
    /** The admin / head who initiated the mirror (the "real" user). */
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    /** The user being mirrored (whose perspective the actor is viewing). */
    targetId: uuid('target_id')
      .notNull()
      .references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Null while the mirror session is still active. */
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Optional context for the audit trail. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    ...timestampColumns,
  },
  (table) => ({
    actorIdIdx: index('mirror_sessions_actor_id_idx').on(table.actorId),
    targetIdIdx: index('mirror_sessions_target_id_idx').on(table.targetId),
    startedAtIdx: index('mirror_sessions_started_at_idx').on(table.startedAt),
    endedAtIdx: index('mirror_sessions_ended_at_idx').on(table.endedAt),
  }),
);
