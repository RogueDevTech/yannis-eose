import { uuid, pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { uuidv7Pk } from './helpers';
import { userRoleEnum } from './enums';
import { users } from './users';

/**
 * Permanent ledger of every probation termination act.
 *
 * One row per terminate-probation action. Survives forever — even though the
 * `users` row's PII is scrubbed (and `users_history` PII is nulled out) when a
 * probation user is terminated, this table records that the scrub happened,
 * who did it, when, and why. It's the audit trail for the carve-out from
 * Pillar 4 that termination represents.
 *
 * Rows are append-only — never updated, never deleted.
 *
 * See CLAUDE.md → "Probation user type" and migration 0126.
 */
export const probationTerminations = pgTable(
  'probation_terminations',
  {
    id: uuidv7Pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    terminatedAt: timestamp('terminated_at', { withTimezone: true }).notNull().defaultNow(),
    terminatedBy: uuid('terminated_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    /** Role the user held when probation was terminated (snapshot, since the live row's role may be retained but stripped of context). */
    originalRole: userRoleEnum('original_role').notNull(),
    /** Branch the user belonged to at termination time, for finance/HR reporting after scrub. */
    originalBranchId: uuid('original_branch_id'),
    /** Snapshot of the blockers list at the moment of termination (for forensic audits). */
    blockersResolved: jsonb('blockers_resolved').$type<{
      activeOrderCount: number;
      pendingCallbackCount: number;
      pendingPayoutCount: number;
      currentMonthPayrollPaid: boolean;
    }>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index('probation_terminations_user_id_idx').on(table.userId),
    terminatedAtIdx: index('probation_terminations_terminated_at_idx').on(table.terminatedAt),
    terminatedByIdx: index('probation_terminations_terminated_by_idx').on(table.terminatedBy),
  }),
);
