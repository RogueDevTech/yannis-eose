import { pgTable, text } from 'drizzle-orm/pg-core';
import { uuidv7Pk, timestampColumns } from './helpers';

/**
 * branch_groups — lightweight "company" boundary.
 *
 * Each branch belongs to exactly one group. Products, system settings,
 * commission plans, and settlement configs are scoped per group.
 * SuperAdmin is the only role that sees the group layer in the UI;
 * everyone else sees branches as before.
 *
 * CEO directive 2026-06-10.
 */
export const branchGroups = pgTable('branch_groups', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  ...timestampColumns,
});
