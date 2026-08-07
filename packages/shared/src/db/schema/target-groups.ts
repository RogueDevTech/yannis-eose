import { uuid, pgTable, text, boolean, jsonb, integer, timestamp } from 'drizzle-orm/pg-core';
import { targetGroupSourceKindEnum, targetGroupMemberSourceEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { branchGroups } from './branch-groups';

// ── Target groups ────────────────────────────────────────────
// Reusable named audiences. RULE groups auto-materialize members from a filter;
// UPLOAD/MANUAL groups are populated directly. Durable config → full history.
export const targetGroups = pgTable('target_groups', {
  id: uuidv7Pk(),
  /** Company boundary. NULL = org-wide. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  description: text('description'),
  sourceKind: targetGroupSourceKindEnum('source_kind').notNull().default('RULE'),
  /** RULE groups: the filter that selects members. jsonb so the builder can grow.
   *  Shape: { minOrders?, maxOrders?, statuses?, branchIds?, sinceDays?, orderSource? } */
  filter: jsonb('filter').notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Target group members (materialized membership) ───────────
// Identity is customer_phone_hash (no customers table). Raw phone is NEVER stored
// here (Lead Fortress). Actor-stamp only — high-volume, no history table.
export const targetGroupMembers = pgTable('target_group_members', {
  id: uuidv7Pk(),
  targetGroupId: uuid('target_group_id')
    .notNull()
    .references(() => targetGroups.id),
  /** The customer — the phone hash IS the identity. */
  customerPhoneHash: text('customer_phone_hash').notNull(),
  customerName: text('customer_name'),
  customerEmail: text('customer_email'),
  source: targetGroupMemberSourceEnum('source').notNull().default('RULE'),
  addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Sync logs (materialization cron audit) ───────────────────
export const targetGroupSyncLogs = pgTable('target_group_sync_logs', {
  id: uuidv7Pk(),
  /** 'cron' | 'manual'. */
  triggeredBy: text('triggered_by').notNull(),
  totalAdded: integer('total_added').notNull().default(0),
  groupResults: jsonb('group_results'),
  ...temporalColumns,
  ...timestampColumns,
});
