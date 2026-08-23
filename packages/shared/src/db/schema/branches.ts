import { uuid, pgTable, text, jsonb, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { branchStatusEnum, userRoleEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { branchGroups } from './branch-groups';

/**
 * branches — each branch is an independent operational unit within the master account.
 * Products/stock_batches are global (no branch_id). All other business data is branch-scoped.
 */
export const branches = pgTable('branches', {
  id: uuidv7Pk(),
  /** Branch group ("company") this branch belongs to. CEO directive 2026-06-10. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  /** Short unique code for the branch, e.g. "LGS", "ABJ". */
  code: text('code').notNull().unique(),
  status: branchStatusEnum('status').default('ACTIVE').notNull(),
  /** Branch-level config overrides: dispatch mode, claim cap, commission defaults, etc. */
  settings: jsonb('settings'),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * user_branches — a user can belong to multiple branches.
 * role_in_branch overrides the user's global role for that specific branch if set.
 * is_primary marks the default branch loaded on login.
 */
export const userBranches = pgTable(
  'user_branches',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    /** If set, this role overrides the user's global role when they are in this branch context. */
    roleInBranch: userRoleEnum('role_in_branch'),
    /** True if this is the branch the user lands on after login. Only one can be primary per user. */
    isPrimary: boolean('is_primary').default(false).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('user_branches_user_branch_uniq').on(t.userId, t.branchId),
  }),
);

/**
 * user_countries — per-user country/currency data-scope (multi-country, mig 0330).
 *
 * Country is a hard data-scope: a user only sees orders/shipments/stock/logistics
 * for currencies they are assigned. 1 country = 1 currency, so the assignment is
 * keyed on currency_code.
 *
 * Semantics (resolved in trpc/context.ts → effectiveCurrencyCodes):
 *  - MEDIA_BUYER role + anyone with `countries.view_all` → ALL currencies (no filter).
 *  - Assigned non-view_all user → exactly their assigned currency_codes.
 *  - UNassigned non-view_all user → falls back to the base country ('NGN') only,
 *    so a freshly-created user never sees a fully empty app; foreign countries
 *    stay hidden until explicitly granted.
 *
 * Mirrors user_branches. No temporal columns (assignment membership, like
 * user_branches, is not system-versioned).
 */
export const userCountries = pgTable(
  'user_countries',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** ISO-ish currency code matching currencies.code (e.g. 'NGN', 'GHS'). */
    currencyCode: text('currency_code').notNull(),
  },
  (t) => ({
    uniq: uniqueIndex('user_countries_user_currency_uniq').on(t.userId, t.currencyCode),
  }),
);
