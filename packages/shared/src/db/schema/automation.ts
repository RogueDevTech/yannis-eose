import { uuid, pgTable, text, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import {
  automationRuleKindEnum,
  automationChannelEnum,
  automationJobStatusEnum,
  automationMessageChannelEnum,
  automationMessageTemplateStatusEnum,
  messageSuppressionChannelEnum,
  messageSuppressionReasonEnum,
} from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { branchGroups } from './branch-groups';
import { branches } from './branches';
import { messageTemplates, outboundMessages } from './messaging';

// ── Automation rules ─────────────────────────────────────────
// CEO-configured marketing automations. EVENT rules fire per-customer when an
// event happens (with an optional delay); SEGMENT rules broadcast to an audience
// on a schedule or on demand. Durable config → full temporal history table.
export const automationRules = pgTable('automation_rules', {
  id: uuidv7Pk(),
  /** Company boundary. NULL = org-wide. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  kind: automationRuleKindEnum('kind').notNull(),
  /** Channels this rule sends on (EMAIL / SMS / WHATSAPP). A multi-channel rule fans
   *  out into one job per channel at send time. */
  channels: text('channels').array().notNull().default([]),
  /** Legacy single channel — nullable, retained for back-compat until dropped. New
   *  rules write `channels` instead. */
  channel: automationChannelEnum('channel'),
  /** Rendered content lives in the reused message_templates table. */
  templateId: uuid('template_id').references(() => messageTemplates.id),
  /** Trigger/segment definition. jsonb so the rule builder evolves without a migration. */
  trigger: jsonb('trigger').notNull().default({}),
  /** Optional AND/OR condition tree from the rule builder. */
  conditions: jsonb('conditions'),
  /** EVENT rules: minutes to wait before sending (e.g. 120 = "2 hours later"). NULL = immediate. */
  delayMinutes: integer('delay_minutes'),
  /** SEGMENT rules: cron for the recurring broadcast. NULL = manual-only. */
  scheduleCron: text('schedule_cron'),
  /** Whether this rule honors the suppression/opt-out list. Overridable per rule. */
  respectOptOut: boolean('respect_opt_out').notNull().default(true),
  /** Higher = evaluated first. */
  priority: integer('priority').notNull().default(0),
  enabled: boolean('enabled').notNull().default(true),
  /** Branch scope filter. NULL = all branches in the company. */
  sourceBranchId: uuid('source_branch_id').references(() => branches.id),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Automation message templates ─────────────────────────────
// The message content an automation rule sends. Own table (NOT the CS
// message_templates), so email automations are first-class: own channel enum
// with EMAIL + a subject column. Durable config → full temporal history.
export const automationMessageTemplates = pgTable('automation_message_templates', {
  id: uuidv7Pk(),
  /** Company boundary. NULL = org-wide. */
  groupId: uuid('group_id').references(() => branchGroups.id),
  name: text('name').notNull(),
  /** Channels this template can be used on. One body reused across them (subject
   *  only applies to email). A rule picks this template when it covers a channel. */
  channels: text('channels').array().notNull().default([]),
  /** Legacy single channel — nullable, retained for back-compat until dropped.
   *  New templates write `channels`. */
  channel: automationMessageChannelEnum('channel'),
  /** Email subject. NULL for SMS/WhatsApp; email falls back to the rule name when null. */
  subject: text('subject'),
  /** Body with {{placeholder}} syntax (same convention as CS templates). */
  body: text('body').notNull(),
  status: automationMessageTemplateStatusEnum('status').notNull().default('ACTIVE'),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Automation jobs (delayed-send queue) ─────────────────────
// One scheduled send per customer — the "wait 2 hours" queue. High-volume +
// ephemeral → actor-stamp only, no history table.
export const automationJobs = pgTable('automation_jobs', {
  id: uuidv7Pk(),
  ruleId: uuid('rule_id')
    .notNull()
    .references(() => automationRules.id),
  /** Customer identity — there is no customers table; the phone hash IS the customer. */
  customerPhoneHash: text('customer_phone_hash').notNull(),
  /** Triggering order (placeholder rendering + eligibility re-check at send time). */
  orderId: uuid('order_id'),
  channel: automationChannelEnum('channel').notNull(),
  /** When the send becomes due. The poller drains rows where scheduled_at <= now(). */
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  status: automationJobStatusEnum('status').notNull().default('PENDING'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  outboundMessageId: uuid('outbound_message_id').references(() => outboundMessages.id),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  /** Direct recipient email for order-less jobs (e.g. Target Group members). When
   *  set, processJob sends here instead of resolving from an order. Raw phone is
   *  never stored (Lead Fortress) — order-less members are email-only. */
  recipientEmail: text('recipient_email'),
  ...temporalColumns,
  ...timestampColumns,
});

// ── Message suppressions (opt-out list) ──────────────────────
// Per-channel do-not-contact list, checked before every send. Actor-stamp only.
export const messageSuppressions = pgTable('message_suppressions', {
  id: uuidv7Pk(),
  groupId: uuid('group_id').references(() => branchGroups.id),
  /** Suppress by phone hash (SMS/WhatsApp). */
  customerPhoneHash: text('customer_phone_hash'),
  /** Suppress by email (email channel). At least one identifier is required (DB CHECK). */
  customerEmail: text('customer_email'),
  channel: messageSuppressionChannelEnum('channel').notNull().default('ALL'),
  reason: messageSuppressionReasonEnum('reason').notNull().default('UNSUBSCRIBED'),
  note: text('note'),
  ...temporalColumns,
  ...timestampColumns,
});
