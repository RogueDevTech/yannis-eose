import { pgTable, text, jsonb, uuid } from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';

// Table: system_settings — key-value store for global system flags
// Strict Data Mode, feature flags, etc.
export const systemSettings = pgTable('system_settings', {
  id: uuidv7Pk(),
  key: text('key').notNull().unique(),
  value: jsonb('value').notNull().$type<Record<string, unknown>>(),
  updatedBy: uuid('updated_by').references(() => users.id),
  ...temporalColumns,
  ...timestampColumns,
});
