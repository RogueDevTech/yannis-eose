import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, inArray, isNull, lte, sql, asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, SYSTEM_ACTOR_ID } from '@yannis/shared';
import type { ListCartOrdersInput, UpdateCartOrderInput } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { branchScopeCondition } from '../common/db/branch-scope-condition';
import type { SessionUser } from '../common/decorators/current-user.decorator';

/** Valid values for the order_timeline_events.event_type enum.
 *  Cart order timeline uses plain text — filter before copying to orders. */
const VALID_TIMELINE_EVENT_TYPES = new Set([
  'ORDER_RECEIVED', 'ORDER_AUTO_ASSIGNED', 'ORDER_MANUALLY_ASSIGNED',
  'ORDER_REASSIGNED', 'ORDER_CLAIMED', 'ORDER_VIEWED',
  'CALL_INITIATED', 'CALL_COMPLETED', 'CALL_NO_ANSWER', 'CALL_FAILED',
  'MANUAL_CALL_LOGGED', 'SMS_SENT', 'WHATSAPP_SENT',
  'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ADDRESS_UPDATED', 'QUANTITY_UPDATED',
  'CALLBACK_SCHEDULED', 'ORDER_ALLOCATED', 'ORDER_DISPATCHED',
  'ORDER_IN_TRANSIT', 'ORDER_DELIVERED', 'ORDER_PARTIALLY_DELIVERED',
  'ORDER_RETURNED', 'ORDER_RESTOCKED', 'ORDER_WRITTEN_OFF',
  'SUPERVISOR_WATCHING', 'PAYMENT_RECEIVED', 'ORDER_ARCHIVED', 'ORDER_DELETED',
  'LINE_PRICE_CHANGE_REQUESTED', 'LINE_PRICE_CHANGE_APPROVED', 'LINE_PRICE_CHANGE_REJECTED',
  'CS_ORDER_COMMENT', 'ORDER_RESTORED', 'ORDER_RETRACKED',
  'ORDER_CS_TRANSFERRED_POST_STATUS', 'ORDER_DUPLICATE_FLAGGED', 'ORDER_UNFROZEN',
]);

@Injectable()
export class CartOrdersService {
  private readonly logger = new Logger(CartOrdersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    // One-time backfill: set media_buyer_id on cart_orders that are missing it
    // by looking up the source cart abandonment's campaign → mediaBuyerId.
    this.backfillMissingMediaBuyers().catch((err) =>
      this.logger.warn(`Cart orders MB backfill failed: ${err.message}`),
    );
  }

  private async backfillMissingMediaBuyers() {
    const result = await this.db.execute(sql`
      UPDATE cart_orders co
      SET media_buyer_id = c.media_buyer_id
      FROM cart_abandonments ca
      JOIN campaigns c ON c.id = ca.campaign_id
      WHERE co.source_cart_id = ca.id
        AND co.media_buyer_id IS NULL
        AND c.media_buyer_id IS NOT NULL
    `);
    const count = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
    if (count > 0) {
      this.logger.log(`Backfilled media_buyer_id on ${count} cart orders`);
    }
  }

  // ── List Cart Orders ─────────────────────────────────────────────────

  async list(
    input: ListCartOrdersInput,
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: Parameters<typeof and>[0][] = input.showDeleted
      ? [sql`${schema.cartOrders.deletedAt} IS NOT NULL`]
      : [isNull(schema.cartOrders.deletedAt)];

    if (input.status) conditions.push(eq(schema.cartOrders.status, input.status));
    if (input.statuses && input.statuses.length > 0) {
      conditions.push(inArray(schema.cartOrders.status, input.statuses));
    }
    if (input.assignedCsId) conditions.push(eq(schema.cartOrders.assignedCsId, input.assignedCsId));
    if (input.unassignedOnly) conditions.push(isNull(schema.cartOrders.assignedCsId));
    if (input.search) {
      conditions.push(sql`${schema.cartOrders.customerName} ILIKE ${'%' + input.search + '%'}`);
    }
    {
      const bCond = branchScopeCondition(schema.cartOrders.servicingBranchId, branchId ?? input.branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    }
    if (input.startDate) conditions.push(gte(schema.cartOrders.createdAt, new Date(input.startDate)));
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.cartOrders.createdAt, end));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = ((input.page ?? 1) - 1) * (input.limit ?? 50);

    const orderDir = input.sortOrder === 'asc' ? asc : desc;
    const sortCol =
      input.sortBy === 'orderNumber'
        ? schema.cartOrders.orderNumber
        : input.sortBy === 'status'
          ? schema.cartOrders.status
          : schema.cartOrders.createdAt;

    const [orders, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.cartOrders)
        .where(whereClause)
        .orderBy(orderDir(sortCol))
        .limit(input.limit ?? 50)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.cartOrders).where(whereClause),
    ]);

    // Enrich with user names, campaign names, and order items
    const orderIds = orders.map((o) => o.id);
    const userIds = [...new Set(
      orders.flatMap((o) => [o.assignedCsId, o.mediaBuyerId].filter(Boolean)),
    )] as string[];
    const campaignIds = [...new Set(orders.map((o) => o.campaignId).filter(Boolean))] as string[];

    const [userRows, campaignRows, itemRows] = await Promise.all([
      userIds.length > 0
        ? this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, userIds))
        : Promise.resolve([]),
      campaignIds.length > 0
        ? this.db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).where(inArray(schema.campaigns.id, campaignIds as string[]))
        : Promise.resolve([]),
      orderIds.length > 0
        ? this.db
            .select({
              cartOrderId: schema.cartOrderItems.cartOrderId,
              productId: schema.cartOrderItems.productId,
              quantity: schema.cartOrderItems.quantity,
              unitPrice: schema.cartOrderItems.unitPrice,
              offerLabel: schema.cartOrderItems.offerLabel,
              productName: schema.products.name,
            })
            .from(schema.cartOrderItems)
            .innerJoin(schema.products, eq(schema.products.id, schema.cartOrderItems.productId))
            .where(inArray(schema.cartOrderItems.cartOrderId, orderIds))
        : Promise.resolve([]),
    ]);

    const userMap = new Map(userRows.map((u) => [u.id, u.name]));
    const campaignMap = new Map(campaignRows.map((c) => [c.id, c.name]));
    const itemsMap = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const list = itemsMap.get(item.cartOrderId) ?? [];
      list.push(item);
      itemsMap.set(item.cartOrderId, list);
    }

    const total = totalRows[0]?.count ?? 0;
    const enrichedOrders = orders.map((o) => ({
      ...o,
      assignedCsName: o.assignedCsId ? userMap.get(o.assignedCsId) ?? null : null,
      mediaBuyerName: o.mediaBuyerId ? userMap.get(o.mediaBuyerId) ?? null : null,
      campaignName: o.campaignId ? campaignMap.get(o.campaignId) ?? null : null,
      orderItems: itemsMap.get(o.id) ?? [],
    }));

    return {
      orders: enrichedOrders,
      total,
      totalPages: Math.ceil(total / (input.limit ?? 50)),
    };
  }

  // ── Status Counts ────────────────────────────────────────────────────

  async getStatusCounts(
    branchId?: string | null,
    assignedCsId?: string | null,
    startDate?: string,
    endDate?: string,
    effectiveBranchIds?: string[] | null,
    mediaBuyerId?: string | null,
  ) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.cartOrders.deletedAt)];
    if (assignedCsId) conditions.push(eq(schema.cartOrders.assignedCsId, assignedCsId));
    if (mediaBuyerId) conditions.push(eq(schema.cartOrders.mediaBuyerId, mediaBuyerId));
    {
      const bCond = branchScopeCondition(schema.cartOrders.servicingBranchId, branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    }
    if (startDate) conditions.push(gte(schema.cartOrders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.cartOrders.createdAt, end));
    }

    const rows = await this.db
      .select({
        status: schema.cartOrders.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.cartOrders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(schema.cartOrders.status);

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = row.count;

    // Deleted count (separate query, soft-deleted orders excluded from main)
    const deletedConditions: Parameters<typeof and>[0][] = [sql`${schema.cartOrders.deletedAt} IS NOT NULL`];
    {
      const bCond = branchScopeCondition(schema.cartOrders.servicingBranchId, branchId, effectiveBranchIds);
      if (bCond) deletedConditions.push(bCond);
    }
    if (assignedCsId) deletedConditions.push(eq(schema.cartOrders.assignedCsId, assignedCsId));
    if (mediaBuyerId) deletedConditions.push(eq(schema.cartOrders.mediaBuyerId, mediaBuyerId));
    if (startDate) deletedConditions.push(gte(schema.cartOrders.createdAt, new Date(startDate)));
    if (endDate) {
      const endDel = new Date(endDate);
      endDel.setHours(23, 59, 59, 999);
      deletedConditions.push(lte(schema.cartOrders.createdAt, endDel));
    }

    const [deletedRow] = await this.db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.cartOrders)
      .where(and(...deletedConditions));
    if (deletedRow && deletedRow.count > 0) counts.DELETED = deletedRow.count;

    return counts;
  }

  // ── Assign to CS ─────────────────────────────────────────────────────

  async assignToCS(orderId: string, closerId: string, actor: SessionUser) {
    const [order] = await this.db
      .select({ id: schema.cartOrders.id, servicingBranchId: schema.cartOrders.servicingBranchId })
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });

    // Resolve the closer's primary branch
    const [closerBranch] = await this.db
      .select({ branchId: schema.userBranches.branchId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, closerId))
      .limit(1);

    return withActor(this.db, actor, async (tx) => {
      const [updated] = await tx
        .update(schema.cartOrders)
        .set({
          assignedCsId: closerId,
          status: 'CS_ASSIGNED',
          ...(closerBranch ? { servicingBranchId: closerBranch.branchId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.cartOrders.id, orderId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });

      const closerName = (await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, closerId)).limit(1))[0]?.name ?? 'Unknown';
      await tx.insert(schema.cartOrderTimelineEvents).values({
        cartOrderId: orderId,
        eventType: 'ORDER_MANUALLY_ASSIGNED',
        actorId: actor.id,
        actorName: actor.name,
        description: `Assigned to ${closerName}.`,
        metadata: { closerId, closerName },
        branchId: updated.servicingBranchId,
      });

      return { success: true };
    });
  }

  // ── Bulk Assign ──────────────────────────────────────────────────────

  async bulkAssign(orderIds: string[], closerIds: string[], actor: SessionUser) {
    const cartOrders = await this.db
      .select({
        id: schema.cartOrders.id,
        servicingBranchId: schema.cartOrders.servicingBranchId,
      })
      .from(schema.cartOrders)
      .where(inArray(schema.cartOrders.id, orderIds));

    // Resolve closer names + branches in parallel
    const uniqueCloserIds = [...new Set(closerIds)];
    const [closerRows, closerBranchRows] = await Promise.all([
      this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, uniqueCloserIds)),
      this.db.select({ userId: schema.userBranches.userId, branchId: schema.userBranches.branchId }).from(schema.userBranches).where(inArray(schema.userBranches.userId, uniqueCloserIds)),
    ]);
    const closerNameMap = new Map(closerRows.map((u) => [u.id, u.name]));
    const closerBranchMap = new Map(closerBranchRows.map((r) => [r.userId, r.branchId]));

    // Build assignment plan (round-robin)
    const assignments: Array<{ orderId: string; closerId: string; closerName: string; branchId: string | null }> = [];
    for (let i = 0; i < orderIds.length; i++) {
      const orderId = orderIds[i]!;
      const closerId = closerIds[i % closerIds.length]!;
      const co = cartOrders.find((o) => o.id === orderId);
      if (!co) continue;

      assignments.push({
        orderId,
        closerId,
        closerName: closerNameMap.get(closerId) ?? 'Unknown',
        branchId: closerBranchMap.get(closerId) ?? co.servicingBranchId,
      });
    }

    if (assignments.length > 0) {
      await withActor(this.db, actor, async (tx) => {
        const byCloser = new Map<string, string[]>();
        for (const a of assignments) {
          const list = byCloser.get(a.closerId) ?? [];
          list.push(a.orderId);
          byCloser.set(a.closerId, list);
        }

        for (const [closerId, ids] of byCloser) {
          const branch = closerBranchMap.get(closerId);
          await tx
            .update(schema.cartOrders)
            .set({
              assignedCsId: closerId,
              status: 'CS_ASSIGNED',
              ...(branch ? { servicingBranchId: branch } : {}),
              updatedAt: new Date(),
            })
            .where(inArray(schema.cartOrders.id, ids));
        }

        // Insert timeline events for all assignments
        await tx.insert(schema.cartOrderTimelineEvents).values(
          assignments.map((a) => ({
            cartOrderId: a.orderId,
            eventType: 'ORDER_MANUALLY_ASSIGNED',
            actorId: actor.id,
            actorName: actor.name,
            description: `Assigned to ${a.closerName}.`,
            metadata: { closerId: a.closerId, closerName: a.closerName },
            branchId: a.branchId,
          })),
        );
      });
    }

    return { success: true, assigned: assignments.length };
  }

  // ── Transition Status ────────────────────────────────────────────────

  async transitionStatus(
    orderId: string,
    newStatus: string,
    actor: SessionUser,
    note?: string,
    metadata?: Record<string, unknown>,
  ) {
    const [order] = await this.db
      .select()
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });

    const timestampUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (newStatus === 'CONFIRMED') timestampUpdates.confirmedAt = new Date();
    if (newStatus === 'AGENT_ASSIGNED') timestampUpdates.allocatedAt = new Date();
    if (newStatus === 'DISPATCHED') timestampUpdates.dispatchedAt = new Date();
    if (newStatus === 'DELIVERED') timestampUpdates.deliveredAt = new Date();
    if (newStatus === 'DELETED') timestampUpdates.deletedAt = new Date();

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.cartOrders)
        .set({ status: newStatus, ...timestampUpdates })
        .where(eq(schema.cartOrders.id, orderId));

      const eventTypeMap: Record<string, string> = {
        CS_ASSIGNED: 'ORDER_MANUALLY_ASSIGNED',
        CS_ENGAGED: 'ORDER_VIEWED',
        CONFIRMED: 'ORDER_CONFIRMED',
        AGENT_ASSIGNED: 'ORDER_ALLOCATED',
        DISPATCHED: 'ORDER_DISPATCHED',
        IN_TRANSIT: 'ORDER_IN_TRANSIT',
        DELIVERED: 'ORDER_DELIVERED',
        REMITTED: 'ORDER_ARCHIVED',
        DELETED: 'ORDER_DELETED',
      };
      const eventType = eventTypeMap[newStatus] ?? 'ORDER_VIEWED';

      // Build a descriptive timeline message instead of the generic "Status changed to X."
      let description = note;
      if (!description) {
        const logisticsLocationId = metadata?.logisticsLocationId as string | undefined;
        let locationLabel: string | undefined;
        if (logisticsLocationId) {
          const [locRow] = await tx
            .select({ name: schema.logisticsLocations.name, providerName: schema.logisticsProviders.name })
            .from(schema.logisticsLocations)
            .innerJoin(schema.logisticsProviders, eq(schema.logisticsLocations.providerId, schema.logisticsProviders.id))
            .where(eq(schema.logisticsLocations.id, logisticsLocationId))
            .limit(1);
          locationLabel = locRow ? (locRow.providerName ? `${locRow.name} (${locRow.providerName})` : locRow.name) : undefined;
        }
        const isReassignment = order.status === 'AGENT_ASSIGNED' && newStatus === 'AGENT_ASSIGNED';
        switch (newStatus) {
          case 'CS_ASSIGNED': description = 'Order assigned to closer.'; break;
          case 'CS_ENGAGED': description = 'CS started customer engagement.'; break;
          case 'CONFIRMED': description = 'Order confirmed.'; break;
          case 'AGENT_ASSIGNED':
            description = isReassignment
              ? `Reassigned to logistics${locationLabel ? ` at ${locationLabel}` : ''}.`
              : `Order assigned to logistics${locationLabel ? ` at ${locationLabel}` : ''}.`;
            break;
          case 'DISPATCHED': description = 'Order dispatched to rider.'; break;
          case 'IN_TRANSIT': description = 'Order in transit.'; break;
          case 'DELIVERED': description = 'Order marked delivered.'; break;
          case 'DELETED': description = 'Order deleted.'; break;
          default: description = `Status changed to ${newStatus.replace(/_/g, ' ').toLowerCase()}.`;
        }
      }

      await tx.insert(schema.cartOrderTimelineEvents).values({
        cartOrderId: orderId,
        eventType,
        actorId: actor.id,
        actorName: actor.name,
        description,
        metadata: metadata ?? { previousStatus: order.status, newStatus },
        branchId: order.servicingBranchId,
      });
    });

    // Graduate to orders on DELIVERED
    if (newStatus === 'DELIVERED') {
      await this.graduateToOrders(orderId);
    }

    return { success: true };
  }

  // ── Graduate to Orders ───────────────────────────────────────────────

  private async graduateToOrders(cartOrderId: string) {
    const [co] = await this.db
      .select()
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, cartOrderId))
      .limit(1);
    if (!co) return;

    const coItems = await this.db
      .select()
      .from(schema.cartOrderItems)
      .where(eq(schema.cartOrderItems.cartOrderId, cartOrderId));

    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      const [graduated] = await tx
        .insert(schema.orders)
        .values({
          campaignId: co.campaignId,
          mediaBuyerId: co.mediaBuyerId,
          assignedCsId: co.assignedCsId,
          logisticsProviderId: co.logisticsProviderId,
          logisticsLocationId: co.logisticsLocationId,
          riderId: co.riderId,
          status: 'DELIVERED',
          items: co.items,
          customerName: co.customerName,
          customerPhoneHash: co.customerPhoneHash,
          customerPhone: co.customerPhone,
          customerAddress: co.customerAddress,
          deliveryAddress: co.deliveryAddress,
          totalAmount: co.totalAmount,
          landedCost: co.landedCost,
          deliveryFee: co.deliveryFee,
          deliveryNotes: co.deliveryNotes,
          deliveryState: co.deliveryState,
          customerGender: co.customerGender,
          preferredDeliveryDate: co.preferredDeliveryDate,
          paymentMethod: co.paymentMethod,
          paymentStatus: co.paymentStatus,
          paymentReference: co.paymentReference,
          paymentProvider: co.paymentProvider,
          customerEmail: co.customerEmail,
          orderSource: 'online',
          customFields: co.customFields,
          branchId: co.branchId,
          servicingBranchId: co.servicingBranchId,
          cartId: co.sourceCartId,
          deliveryProofUrl: co.deliveryProofUrl,
          deliveryDiscountAmount: co.deliveryDiscountAmount,
          deliveryOtp: co.deliveryOtp,
          deliveryGpsLat: co.deliveryGpsLat,
          deliveryGpsLng: co.deliveryGpsLng,
          isFollowUp: false,
          confirmedAt: co.confirmedAt,
          allocatedAt: co.allocatedAt,
          dispatchedAt: co.dispatchedAt,
          deliveredAt: co.deliveredAt,
        })
        .returning({ id: schema.orders.id });

      if (graduated && coItems.length > 0) {
        await tx.insert(schema.orderItems).values(
          coItems.map((item) => ({
            orderId: graduated.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            offerLabel: item.offerLabel,
            batchId: item.batchId,
          })),
        );
      }

      if (graduated) {
        // Copy the full cart order journey timeline.
        // cart_order_timeline_events uses a plain text column, but
        // order_timeline_events uses a strict enum — filter out any
        // event types that don't exist in the enum (e.g. raw status
        // strings like CS_ASSIGNED stored by older code paths).
        const coTimeline = await tx
          .select()
          .from(schema.cartOrderTimelineEvents)
          .where(eq(schema.cartOrderTimelineEvents.cartOrderId, cartOrderId))
          .orderBy(asc(schema.cartOrderTimelineEvents.createdAt));

        // Filter to only event types the orders timeline enum accepts
        const validTimeline = coTimeline.filter((t) => VALID_TIMELINE_EVENT_TYPES.has(t.eventType));
        if (validTimeline.length > 0) {
          await tx.insert(schema.orderTimelineEvents).values(
            validTimeline.map((t) => ({
              orderId: graduated.id,
              eventType: t.eventType as (typeof schema.orderTimelineEvents.$inferInsert)['eventType'],
              actorId: t.actorId,
              actorName: t.actorName,
              description: t.description,
              metadata: t.metadata,
              branchId: t.branchId,
              createdAt: t.createdAt,
            })),
          );
        }

        // Final graduation event
        await tx.insert(schema.orderTimelineEvents).values({
          orderId: graduated.id,
          eventType: 'ORDER_DELIVERED' as const,
          actorId: null,
          actorName: 'System',
          description: `Order graduated from cart recovery (YNS-${String(co.orderNumber).padStart(5, '0')}).`,
          metadata: { cartOrderId, sourceCartId: co.sourceCartId },
          branchId: co.servicingBranchId,
        });

        // Mark original cart as CONVERTED
        await tx
          .update(schema.cartAbandonments)
          .set({ status: 'CONVERTED', convertedOrderId: graduated.id })
          .where(eq(schema.cartAbandonments.id, co.sourceCartId));
      }
    });

    this.logger.log(`Cart order ${cartOrderId} graduated to orders table`);
  }

  // ── Get Single Cart Order ────────────────────────────────────────────

  async getById(id: string) {
    const [order] = await this.db
      .select()
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, id))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });

    const [items, timeline, userIds] = await Promise.all([
      this.db
        .select({
          id: schema.cartOrderItems.id,
          productId: schema.cartOrderItems.productId,
          quantity: schema.cartOrderItems.quantity,
          unitPrice: schema.cartOrderItems.unitPrice,
          offerLabel: schema.cartOrderItems.offerLabel,
          productName: schema.products.name,
        })
        .from(schema.cartOrderItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.cartOrderItems.productId))
        .where(eq(schema.cartOrderItems.cartOrderId, id)),
      this.db
        .select()
        .from(schema.cartOrderTimelineEvents)
        .where(eq(schema.cartOrderTimelineEvents.cartOrderId, id))
        .orderBy(asc(schema.cartOrderTimelineEvents.createdAt)),
      Promise.resolve([order.assignedCsId, order.mediaBuyerId].filter(Boolean) as string[]),
    ]);

    const userRows = userIds.length > 0
      ? await this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, userIds))
      : [];
    const userMap = new Map(userRows.map((u) => [u.id, u.name]));

    const campaignName = order.campaignId
      ? (await this.db.select({ name: schema.campaigns.name }).from(schema.campaigns).where(eq(schema.campaigns.id, order.campaignId)).limit(1))[0]?.name ?? null
      : null;

    return {
      ...order,
      assignedCsName: order.assignedCsId ? userMap.get(order.assignedCsId) ?? null : null,
      mediaBuyerName: order.mediaBuyerId ? userMap.get(order.mediaBuyerId) ?? null : null,
      campaignName,
      orderItems: items,
      timeline,
    };
  }

  // ── Update Cart Order Details ────────────────────────────────────────

  async update(input: UpdateCartOrderInput, actor: SessionUser) {
    const [order] = await this.db
      .select({ id: schema.cartOrders.id, servicingBranchId: schema.cartOrders.servicingBranchId })
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, input.orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.customerName !== undefined) updates.customerName = input.customerName;
    if (input.deliveryAddress !== undefined) updates.deliveryAddress = input.deliveryAddress;
    if (input.deliveryState !== undefined) updates.deliveryState = input.deliveryState;
    if (input.deliveryNotes !== undefined) updates.deliveryNotes = input.deliveryNotes;
    if (input.customerEmail !== undefined) updates.customerEmail = input.customerEmail;
    if (input.preferredDeliveryDate !== undefined) updates.preferredDeliveryDate = input.preferredDeliveryDate;

    return withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.cartOrders)
        .set(updates)
        .where(eq(schema.cartOrders.id, input.orderId));

      const changedFields = Object.keys(updates).filter((k) => k !== 'updatedAt');
      await tx.insert(schema.cartOrderTimelineEvents).values({
        cartOrderId: input.orderId,
        eventType: 'ORDER_DETAILS_UPDATED',
        actorId: actor.id,
        actorName: actor.name,
        description: `Order details updated (${changedFields.join(', ')}).`,
        metadata: { changedFields },
        branchId: order.servicingBranchId,
      });

      return { success: true };
    });
  }

  // ── Initiate Call ─────────────────────────────────────────────────────
  // Mirrors orders.initiateCall: transitions to CS_ENGAGED + records MANUAL_CALL.

  async initiateCall(orderId: string, actor: SessionUser) {
    const [order] = await this.db
      .select({ id: schema.cartOrders.id, status: schema.cartOrders.status, servicingBranchId: schema.cartOrders.servicingBranchId })
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });

    // Transition to CS_ENGAGED if not already past it
    if (order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') {
      await withActor(this.db, actor, async (tx) => {
        await tx
          .update(schema.cartOrders)
          .set({ status: 'CS_ENGAGED', updatedAt: new Date() })
          .where(eq(schema.cartOrders.id, orderId));

        await tx.insert(schema.cartOrderTimelineEvents).values({
          cartOrderId: orderId,
          eventType: 'MANUAL_CALL_LOGGED',
          actorId: actor.id,
          actorName: actor.name,
          description: 'Manual call recorded.',
          metadata: { previousStatus: order.status, newStatus: 'CS_ENGAGED' },
          branchId: order.servicingBranchId,
        });
      });
    }

    return { success: true, callInitiated: true, callLog: null };
  }

  // ── Pull Abandoned Carts into Cart Orders ────────────────────────────
  // Called from the queue.carts page or cron to convert abandoned carts
  // into cart_orders for CS to work.

  async pullFromAbandonedCarts(
    cartIds: string[],
    targetBranchId: string | null,
    actor: SessionUser,
  ) {
    const carts = await this.db
      .select()
      .from(schema.cartAbandonments)
      .where(
        and(
          inArray(schema.cartAbandonments.id, cartIds),
          inArray(schema.cartAbandonments.status, ['PENDING', 'ABANDONED']),
          // Not already pulled into cart_orders
          sql`${schema.cartAbandonments.id} NOT IN (SELECT source_cart_id FROM cart_orders)`,
        ),
      );

    if (carts.length === 0) return { pulled: 0 };

    // Resolve product prices
    const productIds = [...new Set(carts.map((c) => c.productId))];
    const products = await this.db
      .select({ id: schema.products.id, baseSalePrice: schema.products.baseSalePrice, offers: schema.products.offers })
      .from(schema.products)
      .where(inArray(schema.products.id, productIds));
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Resolve campaign → branch + mediaBuyer mapping so each cart order
    // inherits the campaign's branch/MB when the cart abandonment lacks one.
    const campaignIds = [...new Set(carts.map((c) => c.campaignId).filter(Boolean))] as string[];
    const campaignBranchMap = new Map<string, string>();
    const campaignMbMap = new Map<string, string>();
    if (campaignIds.length > 0) {
      const rows = await this.db
        .select({ id: schema.campaigns.id, branchId: schema.campaigns.branchId, mediaBuyerId: schema.campaigns.mediaBuyerId })
        .from(schema.campaigns)
        .where(inArray(schema.campaigns.id, campaignIds));
      for (const r of rows) {
        if (r.branchId) campaignBranchMap.set(r.id, r.branchId);
        if (r.mediaBuyerId) campaignMbMap.set(r.id, r.mediaBuyerId);
      }
    }

    // Validate mediaBuyerIds — include campaign-derived MBs as candidates
    const directMbIds = carts.map((c) => c.mediaBuyerId).filter(Boolean) as string[];
    const campaignMbIds = [...campaignMbMap.values()];
    const mbIds = [...new Set([...directMbIds, ...campaignMbIds])];
    const validMbIds = new Set(
      mbIds.length > 0
        ? (await this.db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, mbIds))).map((u) => u.id)
        : [],
    );

    let succeeded = 0;
    for (const cart of carts) {
      try {
        // As long as there's a phone, create the cart order — that's all CS
        // needs to initiate a call. Product/price are nice-to-have extras.
        if (!cart.customerPhone && !cart.customerPhoneHash) {
          this.logger.warn(`Cart pull skipped cart ${cart.id}: no phone`);
          continue;
        }

        const product = productMap.get(cart.productId);
        const qty = cart.quantity ?? 1;

        let unitPrice = product?.baseSalePrice ?? '0';
        if (cart.offerLabel && product?.offers) {
          const offers = product.offers as Array<{ label?: string; price?: string | number }>;
          const match = offers.find((o) => o.label === cart.offerLabel);
          if (match?.price != null) unitPrice = String(match.price);
        }

        const directMb = cart.mediaBuyerId && validMbIds.has(cart.mediaBuyerId) ? cart.mediaBuyerId : null;
        const campaignMb = !directMb && cart.campaignId ? campaignMbMap.get(cart.campaignId) ?? null : null;
        const safeMbId = directMb ?? (campaignMb && validMbIds.has(campaignMb) ? campaignMb : null);
        const resolvedBranchId = targetBranchId ?? (cart.campaignId ? campaignBranchMap.get(cart.campaignId) ?? null : null);

        await withActor(this.db, actor, async (tx) => {
          const [co] = await tx
            .insert(schema.cartOrders)
            .values({
              sourceCartId: cart.id,
              campaignId: cart.campaignId,
              mediaBuyerId: safeMbId,
              status: 'UNPROCESSED',
              customerName: cart.customerName || 'Unknown',
              customerPhoneHash: cart.customerPhoneHash,
              customerPhone: cart.customerPhone,
              customerAddress: cart.customerAddress,
              deliveryAddress: cart.deliveryAddress,
              totalAmount: sql`${unitPrice}::numeric`,
              deliveryNotes: cart.deliveryNotes,
              deliveryState: cart.deliveryState,
              customerGender: cart.customerGender,
              preferredDeliveryDate: cart.preferredDeliveryDate,
              paymentMethod: cart.paymentMethod,
              customerEmail: cart.customerEmail,
              orderSource: 'online',
              customFields: cart.customFieldValues,
              servicingBranchId: resolvedBranchId,
            })
            .returning({ id: schema.cartOrders.id });

          if (co) {
            // Item insert is best-effort — the product FK could fail if the
            // product was deleted. The cart order itself is what matters (CS
            // needs the phone to call, not the line item to start recovery).
            try {
              await tx.insert(schema.cartOrderItems).values({
                cartOrderId: co.id,
                productId: cart.productId,
                quantity: qty,
                unitPrice,
                offerLabel: cart.offerLabel,
              });
            } catch (itemErr) {
              this.logger.warn(`Cart order ${co.id} created but item insert failed (product ${cart.productId}): ${itemErr instanceof Error ? itemErr.message : itemErr}`);
            }

            await tx.insert(schema.cartOrderTimelineEvents).values({
              cartOrderId: co.id,
              eventType: 'ORDER_RECEIVED',
              // System actor may not exist in users table — skip FK to avoid
              // blocking the entire pull. Human-initiated pulls pass a real user.
              actorId: actor.id === SYSTEM_ACTOR_ID ? null : actor.id,
              actorName: actor.name ?? 'System',
              description: 'Cart order created from abandoned cart.',
              metadata: { sourceCartId: cart.id },
              branchId: resolvedBranchId,
            });
          }
        });
        succeeded++;
      } catch (err) {
        this.logger.warn(`Cart pull skipped cart ${cart.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { pulled: succeeded };
  }
}
