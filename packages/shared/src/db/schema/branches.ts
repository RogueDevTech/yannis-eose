import { pgTable, text, jsonb, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { branchStatusEnum, userRoleEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

/**
 * branches — each branch is an independent operational unit within the master account.
 * Products/stock_batches are global (no branch_id). All other business data is branch-scoped.
 */
export const branches = pgTable('branches', {
  id: uuidv7Pk(),
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
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    branchId: text('branch_id')
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
