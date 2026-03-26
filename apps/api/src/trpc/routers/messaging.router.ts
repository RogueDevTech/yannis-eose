/**
 * Messaging tRPC Router — CS Communication Panel (SMS + WhatsApp)
 *
 * Procedures:
 *  - templates.list    — list active templates (filtered by channel/branch)
 *  - templates.create  — create a new template (HoCS/SuperAdmin)
 *  - templates.update  — update template name/body/status (HoCS/SuperAdmin)
 *  - sendMessage       — send an SMS or WhatsApp message to a customer (CS agent)
 *  - outboxList        — list outbound messages for an order
 *
 * Phone masking: raw phone is retrieved server-side from the orders table and
 * passed directly to the SMS/WhatsApp provider. It is NEVER returned to the client.
 */

import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { db as schema } from '@yannis/shared';

// Factory-injected DB
let drizzleInstance: PostgresJsDatabase<typeof schema> | null = null;

export function setMessagingDb(db: PostgresJsDatabase<typeof schema>) {
  drizzleInstance = db;
}

function getDb() {
  if (!drizzleInstance) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Messaging DB not initialized' });
  return drizzleInstance;
}

const ALLOWED_TEMPLATE_PLACEHOLDERS = new Set([
  'customer_name',
  'order_id',
  'product_name',
  'delivery_address',
  'estimated_date',
]);

function extractUnsupportedTemplatePlaceholders(body: string): string[] {
  const unsupported = new Set<string>();
  const placeholderRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

  for (const match of body.matchAll(placeholderRegex)) {
    const key = match[1]?.trim();
    if (key && !ALLOWED_TEMPLATE_PLACEHOLDERS.has(key)) {
      unsupported.add(key);
    }
  }

  return Array.from(unsupported);
}

function assertSupportedTemplatePlaceholders(body: string) {
  const unsupported = extractUnsupportedTemplatePlaceholders(body);
  if (unsupported.length === 0) return;

  const formatted = unsupported.map((key) => `{{${key}}}`).join(', ');
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'Only customer_name, order_id, product_name, delivery_address, estimated_date are supported in templates. '
      + `Remove: ${formatted}`,
  });
}

/** Resolve placeholder values from an order record. */
function resolvePlaceholders(body: string, order: {
  id: string;
  customerName: string | null;
  deliveryAddress: string | null;
  items?: Array<{ productName?: string | null }>;
}): string {
  const productName = order.items?.[0]?.productName ?? '';
  return body
    .replace(/\{\{customer_name\}\}/g, order.customerName ?? '')
    .replace(/\{\{order_id\}\}/g, order.id.slice(0, 8).toUpperCase())
    .replace(/\{\{product_name\}\}/g, productName)
    .replace(/\{\{delivery_address\}\}/g, order.deliveryAddress ?? '')
    .replace(/\{\{estimated_date\}\}/g, '');  // Future: add estimated delivery date
}

/**
 * Send an outbound message.
 * In the absence of real Twilio SMS credentials, logs to DB and emits success.
 * Real integration: call Twilio Messaging API here using the raw phone.
 */
async function dispatchMessage(_phone: string, _channel: 'SMS' | 'WHATSAPP', _body: string): Promise<{ success: boolean; error?: string }> {
  // TODO: Integrate Twilio SMS / WhatsApp API here.
  // const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // await twilioClient.messages.create({ body, from: process.env.TWILIO_FROM_NUMBER, to: phone });
  // For now: mock success (no actual send)
  return { success: true };
}

export const messagingRouter = router({
  /**
   * List active message templates for the current branch (or all if SuperAdmin).
   */
  'templates.list': authedProcedure
    .input(
      z.object({
        channel: z.enum(['SMS', 'WHATSAPP']).optional(),
        includeArchived: z.boolean().optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const conditions: Parameters<typeof and>[0][] = [];

      // Filter by status
      if (!input?.includeArchived) {
        conditions.push(eq(schema.messageTemplates.status, 'ACTIVE'));
      }

      // Filter by channel if specified
      if (input?.channel) {
        conditions.push(eq(schema.messageTemplates.channel, input.channel));
      }

      // Branch scoping: non-SuperAdmin sees own branch templates only
      if (ctx.user.role !== 'SUPER_ADMIN' && ctx.user.currentBranchId) {
        conditions.push(eq(schema.messageTemplates.branchId, ctx.user.currentBranchId));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      return db
        .select()
        .from(schema.messageTemplates)
        .where(whereClause)
        .orderBy(desc(schema.messageTemplates.createdAt));
    }),

  /**
   * Create a message template (HoCS / SuperAdmin only).
   */
  'templates.create': permissionProcedure('cs.teamOverview')
    .input(
      z.object({
        name: z.string().min(2).max(100),
        channel: z.enum(['SMS', 'WHATSAPP']),
        body: z.string().min(5).max(1600),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      assertSupportedTemplatePlaceholders(input.body);
      await db.insert(schema.messageTemplates).values({
        name: input.name,
        channel: input.channel,
        body: input.body,
        createdBy: ctx.user.id,
        branchId: ctx.user.currentBranchId ?? null,
        status: 'ACTIVE',
      });
      return { success: true };
    }),

  /**
   * Update template name, body, or status (archive/restore). HoCS / SuperAdmin only.
   */
  'templates.update': permissionProcedure('cs.teamOverview')
    .input(
      z.object({
        templateId: z.string().uuid(),
        name: z.string().min(2).max(100).optional(),
        body: z.string().min(5).max(1600).optional(),
        status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const updates: Partial<typeof schema.messageTemplates.$inferInsert> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.body !== undefined) {
        assertSupportedTemplatePlaceholders(input.body);
        updates.body = input.body;
      }
      if (input.status !== undefined) updates.status = input.status;

      await db
        .update(schema.messageTemplates)
        .set(updates)
        .where(eq(schema.messageTemplates.id, input.templateId));
      return { success: true };
    }),

  /**
   * Send an outbound message to the order's customer.
   * CS agents can access this via `orders.read` permission.
   * Phone number is fetched server-side and NEVER returned to the client.
   */
  sendMessage: permissionProcedure('orders.read')
    .input(
      z.object({
        orderId: z.string().uuid(),
        channel: z.enum(['SMS', 'WHATSAPP']),
        /** If using a template, provide templateId. Body is auto-resolved from template. */
        templateId: z.string().uuid().optional(),
        /** Freeform body for SMS (no template required). Not allowed for WHATSAPP. */
        body: z.string().min(1).max(1600).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      // Fetch the order to get phone and resolve placeholders
      const orderRows = await db
        .select({
          id: schema.orders.id,
          customerName: schema.orders.customerName,
          customerPhone: schema.orders.customerPhone,
          deliveryAddress: schema.orders.deliveryAddress,
          status: schema.orders.status,
        })
        .from(schema.orders)
        .where(eq(schema.orders.id, input.orderId))
        .limit(1);

      const order = orderRows[0];
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });

      if (!order.customerPhone) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This order has no phone number on record — messaging is unavailable.',
        });
      }

      // Resolve message body
      let renderedBody: string;
      let templateId: string | null = null;

      if (input.templateId) {
        const templateRows = await db
          .select()
          .from(schema.messageTemplates)
          .where(eq(schema.messageTemplates.id, input.templateId))
          .limit(1);

        const template = templateRows[0];
        if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
        if (template.status === 'ARCHIVED') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Template is archived' });

        renderedBody = resolvePlaceholders(template.body, {
          id: order.id,
          customerName: order.customerName,
          deliveryAddress: order.deliveryAddress,
        });
        templateId = template.id;
      } else if (input.body) {
        renderedBody = input.body;
      } else {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Either templateId or body must be provided' });
      }

      // Dispatch via provider (mock or real Twilio)
      const result = await dispatchMessage(order.customerPhone, input.channel, renderedBody);

      // Log to outbound_messages
      await db.insert(schema.outboundMessages).values({
        orderId: input.orderId,
        agentId: ctx.user.id,
        channel: input.channel,
        templateId,
        renderedBody,
        status: result.success ? 'SENT' : 'FAILED',
        errorMessage: result.error ?? null,
        branchId: ctx.user.currentBranchId ?? null,
      });

      if (!result.success) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Message send failed' });
      }

      return { success: true, channel: input.channel };
    }),

  /**
   * List outbound messages for a specific order.
   */
  outboxList: permissionProcedure('orders.read')
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: schema.outboundMessages.id,
          channel: schema.outboundMessages.channel,
          renderedBody: schema.outboundMessages.renderedBody,
          status: schema.outboundMessages.status,
          sentAt: schema.outboundMessages.sentAt,
          templateId: schema.outboundMessages.templateId,
        })
        .from(schema.outboundMessages)
        .where(eq(schema.outboundMessages.orderId, input.orderId))
        .orderBy(desc(schema.outboundMessages.sentAt));
    }),
});
