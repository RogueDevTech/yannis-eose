import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { uuidv7Pk, temporalColumns } from './helpers';
import { users } from './users';
import {
  pushDeliveryStatusEnum,
  pushTriggerTypeEnum,
  pushTargetTypeEnum,
  pushAutomationTriggerEnum,
} from './enums';
import { branches } from './branches';

/**
 * push_subscriptions — one row per browser/device subscription per user.
 * Endpoint is unique: a device always maps to exactly one subscription record.
 */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuidv7Pk(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  auth: text('auth').notNull(),
  p256dh: text('p256dh').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * push_broadcasts — one record per admin-triggered broadcast.
 * Captures the audience selector and message at time of send.
 */
export const pushBroadcasts = pgTable('push_broadcasts', {
  id: uuidv7Pk(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  targetType: pushTargetTypeEnum('target_type').notNull(),
  /** Stores a userRoleEnum value as plain text — avoids circular dependency. */
  targetRole: text('target_role'),
  targetUserId: text('target_user_id').references(() => users.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  branchId: text('branch_id').references(() => branches.id),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * push_automation_rules — temporal so changes are versioned.
 * Rules can be CRON-based (fire on schedule) or EVENT-based (fire on domain event).
 */
export const pushAutomationRules = pgTable('push_automation_rules', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  triggerType: pushAutomationTriggerEnum('trigger_type').notNull(),
  /** CRON expression, e.g. "0 9 * * 1" for Monday 9am. Required when triggerType=CRON. */
  cronExpr: text('cron_expr'),
  /** Domain event key, e.g. "agent_inactive_2h", "order_stuck_24h". Required when triggerType=EVENT. */
  eventKey: text('event_key'),
  targetType: pushTargetTypeEnum('target_type').notNull(),
  targetRole: text('target_role'),
  targetUserId: text('target_user_id').references(() => users.id),
  titleTemplate: text('title_template').notNull(),
  bodyTemplate: text('body_template').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  branchId: text('branch_id').references(() => branches.id),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  ...temporalColumns,
});

/**
 * push_delivery_log — one row per individual push attempt to a device.
 * Covers mirror notifications, broadcasts, and automation rule fires.
 */
export const pushDeliveryLog = pgTable('push_delivery_log', {
  id: uuidv7Pk(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  broadcastId: text('broadcast_id').references(() => pushBroadcasts.id),
  automationRuleId: text('automation_rule_id').references(() => pushAutomationRules.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  triggerType: pushTriggerTypeEnum('trigger_type').notNull(),
  status: pushDeliveryStatusEnum('status').notNull().default('SENT'),
  failureReason: text('failure_reason'),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  shownAt: timestamp('shown_at', { withTimezone: true }),
  clickedAt: timestamp('clicked_at', { withTimezone: true }),
});
