import { pgTable, text, uuid, timestamp, unique } from 'drizzle-orm/pg-core';
import { branchGroups } from './branch-groups';
import { accounts } from './general-ledger';

/**
 * gl_account_mappings — per-company overrides for the auto-posting engine's
 * default account lookups.
 *
 * Each row says "for company X, whenever the posting engine needs account
 * MAPPING_KEY, use account_id instead of the default from ACCT constants."
 *
 * The unique constraint on (group_id, mapping_key) ensures one override per
 * company per key. A missing row means "use the default from chart-of-accounts.ts".
 */
export const glAccountMappings = pgTable(
  'gl_account_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom().notNull(),
    groupId: uuid('group_id').references(() => branchGroups.id),
    mappingKey: text('mapping_key').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqueGroupMapping: unique().on(t.groupId, t.mappingKey),
  }),
);
