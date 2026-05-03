import { uuid, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { messageChannelEnum, outboundMessageStatusEnum, templateStatusEnum } from './enums';
import { uuidv7Pk, temporalColumns, timestampColumns } from './helpers';
import { users } from './users';
import { orders } from './orders';
import { branches } from './branches';

/**
 * message_templates — pre-configured CS communication templates for SMS and WhatsApp.
 * Body text supports dynamic placeholders: {{customer_name}}, {{product_name}},
 * {{order_id}}, {{delivery_address}}, {{estimated_date}}.
 * Templates are branch-scoped. Managed by HoCS or SuperAdmin.
 */
export const messageTemplates = pgTable('message_templates', {
  id: uuidv7Pk(),
  name: text('name').notNull(),
  channel: messageChannelEnum('channel').notNull(),
  /** Template body with {{placeholder}} syntax. */
  body: text('body').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  branchId: uuid('branch_id').references(() => branches.id),
  status: templateStatusEnum('status').default('ACTIVE').notNull(),
  ...temporalColumns,
  ...timestampColumns,
});

/**
 * outbound_messages — log of every message sent to a customer from within an order.
 * Append-only. Written atomically alongside the order_timeline_events entry.
 * Raw phone numbers are NEVER stored here — sends go through the platform bridge.
 */
export const outboundMessages = pgTable('outbound_messages', {
  id: uuidv7Pk(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => users.id),
  channel: messageChannelEnum('channel').notNull(),
  /** Null if the agent typed a freeform SMS rather than using a template. */
  templateId: uuid('template_id').references(() => messageTemplates.id),
  /** The final rendered message after placeholder substitution. */
  renderedBody: text('rendered_body').notNull(),
  status: outboundMessageStatusEnum('status').default('SENT').notNull(),
  /** Error detail if status = FAILED. */
  errorMessage: text('error_message'),
  branchId: uuid('branch_id').references(() => branches.id),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
});
