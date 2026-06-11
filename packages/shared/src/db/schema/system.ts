import { pgTable, text, jsonb, uuid, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { branchGroups } from './branch-groups';

// Table: system_settings — key-value store for system flags, per branch group.
// Strict Data Mode, feature flags, dispatch strategy, etc.
// CEO directive 2026-06-10: scoped per group for multi-company.
export const systemSettings = pgTable('system_settings', {
  id: uuidv7Pk(),
  key: text('key').notNull(),
  /** Branch group this setting belongs to. NULL = legacy/global (pre-migration). */
  groupId: uuid('group_id').references(() => branchGroups.id),
  value: jsonb('value').notNull().$type<Record<string, unknown>>(),
  /**
   * Phase C — when true, this system value wins over any branch_team_settings
   * override for the same key. Lets admin/SuperAdmin enforce a setting from the top.
   */
  isEnforced: boolean('is_enforced').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
}, (t) => ({
  /** Same key can exist per-group, but only once per group. */
  uniqKeyGroup: uniqueIndex('system_settings_key_group_uniq').on(t.key, t.groupId),
}));
