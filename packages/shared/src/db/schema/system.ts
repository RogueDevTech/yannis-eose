import { pgTable, text, jsonb, uuid, boolean } from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

// Table: system_settings — key-value store for global system flags
// Strict Data Mode, feature flags, etc.
export const systemSettings = pgTable('system_settings', {
  id: uuidv7Pk(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull().$type<Record<string, unknown>>(),
  /**
   * Phase C — when true, this system value wins over any branch_team_settings
   * override for the same key. Lets admin/SuperAdmin enforce a setting from the top.
   */
  isEnforced: boolean('is_enforced').notNull().default(false),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});
