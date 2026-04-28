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
  // Logistics-dispatch placeholders (used by WHATSAPP_GROUP templates when CS shares an order to a 3PL).
  'quantity',
  'total_amount',
  'payment_status',
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
  totalAmount?: string | number | null;
  paymentStatus?: string | null;
  items?: Array<{ productName?: string | null; quantity?: number | null }>;
}): string {
  const firstItem = order.items?.[0];
  const productName = firstItem?.productName ?? '';
  const quantity = firstItem?.quantity != null ? String(firstItem.quantity) : '';
  const totalAmount = order.totalAmount != null ? String(order.totalAmount) : '';
  const paymentStatus = order.paymentStatus ?? '';
  return body
    .replace(/\{\{customer_name\}\}/g, order.customerName ?? '')
    .replace(/\{\{order_id\}\}/g, order.id.slice(0, 8).toUpperCase())
    .replace(/\{\{product_name\}\}/g, productName)
    .replace(/\{\{delivery_address\}\}/g, order.deliveryAddress ?? '')
    .replace(/\{\{estimated_date\}\}/g, '')  // Future: add estimated delivery date
    .replace(/\{\{quantity\}\}/g, quantity)
    .replace(/\{\{total_amount\}\}/g, totalAmount)
    .replace(/\{\{payment_status\}\}/g, paymentStatus);
}

/**
 * Send an outbound message. Mock implementation — logs the attempt and returns success.
 * To go live: integrate Africa's Talking SMS API (their `/messaging` endpoint) here using
 * the same `AT_USERNAME` + `AT_API_KEY` env vars already configured for voice. See
 * https://developers.africastalking.com/docs/sms/sending. Sender ID can be a registered
 * alphanumeric string (e.g. "Yannis") once approved by AT.
 */
async function dispatchMessage(_phone: string, _channel: 'SMS' | 'WHATSAPP', _body: string): Promise<{ success: boolean; error?: string }> {
  // TODO: POST to https://api.africastalking.com/version1/messaging with form fields
  // { username, to, message, from? } and headers { apiKey, Accept: 'application/json' }.
  // For now: mock success (no actual send) — keeps the in-app messaging UX flowing in dev.
  return { success: true };
}

export const messagingRouter = router({
  /**
   * List active message templates for the current branch (or all if SuperAdmin).
   */
  'templates.list': authedProcedure
    .input(
      z.object({
        channel: z.enum(['SMS', 'WHATSAPP', 'WHATSAPP_GROUP']).optional(),
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
      if ((ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN') && ctx.user.currentBranchId) {
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
   * Create a message template. HoCS / Admin / SuperAdmin can create branch-shared templates;
   * CS agents can also author their own (visible to the team but only editable by the
   * creator and Heads).
   */
  'templates.create': authedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(100),
        channel: z.enum(['SMS', 'WHATSAPP', 'WHATSAPP_GROUP']),
        body: z.string().min(5).max(1600),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_AGENT'];
      if (!allowedRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only CS agents and CS leadership can create templates' });
      }

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
   * Update template name, body, or status (archive/restore).
   * - HoCS / Admin / SuperAdmin: can update any template in their scope.
   * - CS_AGENT: can only update templates they themselves created.
   */
  'templates.update': authedProcedure
    .input(
      z.object({
        templateId: z.string().uuid(),
        name: z.string().min(2).max(100).optional(),
        body: z.string().min(5).max(1600).optional(),
        status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const allowedRoles = ['SUPER_ADMIN', 'ADMIN', 'HEAD_OF_CS', 'CS_AGENT'];
      if (!allowedRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only CS agents and CS leadership can edit templates' });
      }

      const db = getDb();

      // CS agents may only edit their own templates. Heads can edit anything.
      if (ctx.user.role === 'CS_AGENT') {
        const [existing] = await db
          .select({ createdBy: schema.messageTemplates.createdBy })
          .from(schema.messageTemplates)
          .where(eq(schema.messageTemplates.id, input.templateId))
          .limit(1);
        if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
        if (existing.createdBy !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You can only edit templates you created. Ask Head of CS to update shared templates.',
          });
        }
      }

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

      // WhatsApp is currently a manual deep-link flow (agent sends in app and confirms).
      // Do not dispatch through provider here to avoid duplicate customer messages.
      const result =
        input.channel === 'WHATSAPP'
          ? { success: true as const, error: undefined }
          : await dispatchMessage(order.customerPhone, input.channel, renderedBody);

      // Log to outbound_messages and order timeline together.
      const timelineEventType = input.channel === 'WHATSAPP' ? 'WHATSAPP_SENT' : 'SMS_SENT';
      const timelineDescription =
        input.channel === 'WHATSAPP'
          ? 'WhatsApp message sent to customer (agent-confirmed)'
          : 'SMS sent to customer';
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.outboundMessages)
          .values({
            orderId: input.orderId,
            agentId: ctx.user.id,
            channel: input.channel,
            templateId,
            renderedBody,
            status: result.success ? 'SENT' : 'FAILED',
            errorMessage: result.error ?? null,
            branchId: ctx.user.currentBranchId ?? null,
          })
          .returning({ id: schema.outboundMessages.id });

        await tx.insert(schema.orderTimelineEvents).values({
          orderId: input.orderId,
          eventType: timelineEventType as (typeof schema.orderTimelineEvents.$inferInsert)['eventType'],
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          description: timelineDescription,
          metadata: {
            channel: input.channel,
            outboundMessageId: inserted[0]?.id ?? null,
            templateId,
            status: result.success ? 'SENT' : 'FAILED',
          },
          branchId: ctx.user.currentBranchId ?? null,
        });
      });

      if (!result.success) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.error ?? 'Message send failed' });
      }

      return { success: true, channel: input.channel };
    }),

  /**
   * List outbound messages for a specific order.
   */
  /**
   * Share an order to a logistics company via WhatsApp group (Phase 4 "Share to logistics company" flow).
   * The server renders the template, logs an outbound_messages row (channel WHATSAPP_GROUP)
   * and an order_timeline_events row in a single transaction, then returns the rendered text
   * and group link so the client can copy + open WhatsApp. WhatsApp group invite links do not
   * support pre-filled text, so this two-step (copy + open) is the best one-click UX available.
   */
  shareToLogistics: permissionProcedure('orders.read')
    .input(
      z.object({
        orderId: z.string().uuid(),
        locationId: z.string().uuid(),
        templateId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();

      const [orderRows, locationRows, templateRows] = await Promise.all([
        db
          .select({
            id: schema.orders.id,
            customerName: schema.orders.customerName,
            deliveryAddress: schema.orders.deliveryAddress,
            totalAmount: schema.orders.totalAmount,
            paymentStatus: schema.orders.paymentStatus,
            branchId: schema.orders.branchId,
          })
          .from(schema.orders)
          .where(eq(schema.orders.id, input.orderId))
          .limit(1),
        db
          .select({
            id: schema.logisticsLocations.id,
            name: schema.logisticsLocations.name,
            whatsappGroupLink: schema.logisticsLocations.whatsappGroupLink,
          })
          .from(schema.logisticsLocations)
          .where(eq(schema.logisticsLocations.id, input.locationId))
          .limit(1),
        db
          .select()
          .from(schema.messageTemplates)
          .where(eq(schema.messageTemplates.id, input.templateId))
          .limit(1),
      ]);

      const order = orderRows[0];
      const location = locationRows[0];
      const template = templateRows[0];
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      if (!location) throw new TRPCError({ code: 'NOT_FOUND', message: 'Logistics location not found' });
      if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      if (template.status === 'ARCHIVED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Template is archived' });
      }
      if (!location.whatsappGroupLink) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${location.name} has no WhatsApp group link configured. Ask Logistics to add one on the 3PL location settings.`,
        });
      }

      // Fetch order items for product_name / quantity placeholders (join products for the name).
      const items = await db
        .select({
          productName: schema.products.name,
          quantity: schema.orderItems.quantity,
        })
        .from(schema.orderItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
        .where(eq(schema.orderItems.orderId, order.id));

      const renderedBody = resolvePlaceholders(template.body, {
        id: order.id,
        customerName: order.customerName,
        deliveryAddress: order.deliveryAddress,
        totalAmount: order.totalAmount,
        paymentStatus: order.paymentStatus,
        items,
      });

      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.outboundMessages)
          .values({
            orderId: order.id,
            agentId: ctx.user.id,
            channel: 'WHATSAPP_GROUP',
            templateId: template.id,
            renderedBody,
            status: 'SENT',
            branchId: order.branchId ?? ctx.user.currentBranchId ?? null,
          })
          .returning({ id: schema.outboundMessages.id });

        await tx.insert(schema.orderTimelineEvents).values({
          orderId: order.id,
          eventType: 'WHATSAPP_SENT' as (typeof schema.orderTimelineEvents.$inferInsert)['eventType'],
          actorId: ctx.user.id,
          actorName: ctx.user.name ?? null,
          description: `Order shared to ${location.name} via WhatsApp group`,
          metadata: {
            channel: 'WHATSAPP_GROUP',
            outboundMessageId: inserted[0]?.id ?? null,
            templateId: template.id,
            locationId: location.id,
            locationName: location.name,
          },
          branchId: order.branchId ?? ctx.user.currentBranchId ?? null,
        });
      });

      return {
        success: true,
        renderedBody,
        groupLink: location.whatsappGroupLink,
        locationName: location.name,
      };
    }),

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
