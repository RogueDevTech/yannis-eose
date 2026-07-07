import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, SYSTEM_ACTOR_ID } from '@yannis/shared';
import type { ListCartOrdersInput, UpdateCartOrderInput, CreateCartOrderRoutingRuleInput, UpdateCartOrderRoutingRuleInput } from '@yannis/shared';
import { DRIZZLE, PG_CLIENT_RAW } from '../database/database.module';
import type postgres from 'postgres';
import { withActor } from '../common/db/with-actor';
import { branchScopeCondition } from '../common/db/branch-scope-condition';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';
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
    @Inject(PG_CLIENT_RAW) private readonly pg: ReturnType<typeof postgres>,
  ) {
    // One-time backfill: set media_buyer_id on cart_orders that are missing it
    // by looking up the source cart abandonment's campaign → mediaBuyerId.
    this.backfillMissingMediaBuyers().catch((err) =>
      this.logger.warn(`Cart orders MB backfill failed: ${err.message}`),
    );
    // Seed default routing rule on boot (idempotent)
    this.seedDefaultRoutingRule().catch((err) =>
      this.logger.warn(`Cart routing rule seed failed: ${err.message}`),
    );
    // Backfill cart_order_items for any cart orders missing line items
    this.backfillMissingCartOrderItems().catch((err) =>
      this.logger.warn(`Cart order items backfill failed: ${err.message}`),
    );
    // Retry orphaned graduations 60s after boot
    setTimeout(() => {
      this.retryFailedGraduations().catch((err) =>
        this.logger.error(`Cart graduation retry failed: ${err instanceof Error ? err.message : err}`),
      );
    }, 60_000);
  }

  private async backfillMissingMediaBuyers() {
    // Pass 1: resolve from cart_abandonments → campaigns chain
    const r1 = await this.db.execute(sql`
      UPDATE cart_orders co
      SET media_buyer_id = COALESCE(co.media_buyer_id, c.media_buyer_id),
          campaign_id    = COALESCE(co.campaign_id, ca.campaign_id)
      FROM cart_abandonments ca
      JOIN campaigns c ON c.id = ca.campaign_id
      WHERE co.source_cart_id = ca.id
        AND (co.media_buyer_id IS NULL OR co.campaign_id IS NULL)
    `);
    // Pass 2: for any still missing, assign a campaign+MB from the same branch
    // (validate user FK to avoid constraint violations)
    const r2 = await this.db.execute(sql`
      UPDATE cart_orders co
      SET campaign_id = sub.campaign_id,
          media_buyer_id = sub.media_buyer_id
      FROM (
        SELECT DISTINCT ON (co2.id) co2.id AS cart_order_id, c.id AS campaign_id, c.media_buyer_id
        FROM cart_orders co2
        JOIN campaigns c ON c.media_buyer_id IS NOT NULL
          AND (c.branch_id = co2.servicing_branch_id OR c.branch_id = co2.branch_id)
        JOIN users u ON u.id = c.media_buyer_id
        WHERE co2.media_buyer_id IS NULL
        ORDER BY co2.id, random()
      ) sub
      WHERE co.id = sub.cart_order_id
    `);
    // Pass 3: absolute fallback — any campaign with a valid MB user
    const r3 = await this.db.execute(sql`
      UPDATE cart_orders co
      SET campaign_id = sub.campaign_id,
          media_buyer_id = sub.media_buyer_id
      FROM (
        SELECT DISTINCT ON (co2.id) co2.id AS cart_order_id, c.id AS campaign_id, c.media_buyer_id
        FROM cart_orders co2
        CROSS JOIN LATERAL (
          SELECT c2.id, c2.media_buyer_id
          FROM campaigns c2
          JOIN users u ON u.id = c2.media_buyer_id
          WHERE c2.media_buyer_id IS NOT NULL
          ORDER BY random() LIMIT 1
        ) c
        WHERE co2.media_buyer_id IS NULL
      ) sub
      WHERE co.id = sub.cart_order_id
    `);
    const total = ((r1 as unknown as { rowCount?: number })?.rowCount ?? 0)
      + ((r2 as unknown as { rowCount?: number })?.rowCount ?? 0)
      + ((r3 as unknown as { rowCount?: number })?.rowCount ?? 0);
    if (total > 0) {
      this.logger.log(`Backfilled media_buyer_id/campaign_id on ${total} cart orders`);
    }
  }

  private async seedDefaultRoutingRule() {
    const LAGOS_BRANCH_ID = '00000000-0000-0000-0000-000000000001';
    const RULE_ID = 'a0000000-0000-0000-0000-000000000001';
    await this.db.execute(sql`
      INSERT INTO cart_order_routing_rules (id, name, source_branch_id, target_branch_id, priority, enabled)
      VALUES (${RULE_ID}, 'All carts → Lagos', NULL, ${LAGOS_BRANCH_ID}, 10, true)
      ON CONFLICT (id) DO NOTHING
    `);
    // Backfill all cart orders not on Lagos to Lagos (CEO directive: single CS branch for carts)
    const result = await this.db.execute(sql`
      UPDATE cart_orders
      SET servicing_branch_id = ${LAGOS_BRANCH_ID}, updated_at = now()
      WHERE servicing_branch_id IS NULL
         OR servicing_branch_id != ${LAGOS_BRANCH_ID}
    `);
    const backfilled = (result as unknown as { rowCount?: number })?.rowCount ?? 0;
    if (backfilled > 0) {
      this.logger.log(`Backfilled ${backfilled} cart orders to Lagos branch`);
    }
  }

  /** Backfill cart_order_items for cart orders that were pulled without line items. */
  private async backfillMissingCartOrderItems() {
    // Use pg.unsafe() to bypass Drizzle — simple protocol avoids trigger conflict.
    const result = await this.pg.unsafe(`
      INSERT INTO cart_order_items (id, cart_order_id, product_id, quantity, unit_price, offer_label)
      SELECT
        gen_random_uuid(), co.id, ca.product_id, COALESCE(ca.quantity, 1),
        COALESCE(
          (SELECT (o->>'price')::numeric
           FROM jsonb_array_elements(p.offers) AS o
           WHERE o->>'label' = ca.offer_label
           LIMIT 1),
          COALESCE(p.base_sale_price, 0)
        ),
        ca.offer_label
      FROM cart_orders co
      JOIN cart_abandonments ca ON ca.id = co.source_cart_id
      LEFT JOIN products p ON p.id = ca.product_id
      WHERE NOT EXISTS (
        SELECT 1 FROM cart_order_items coi WHERE coi.cart_order_id = co.id
      )
        AND ca.product_id IS NOT NULL
    `);
    if (result.count > 0) {
      this.logger.log(`Backfilled ${result.count} missing cart_order_items from source carts`);
      await this.pg.unsafe(`
        UPDATE cart_orders co
        SET total_amount = sub.line_total, updated_at = now()
        FROM (
          SELECT coi.cart_order_id, SUM(coi.unit_price * coi.quantity) AS line_total
          FROM cart_order_items coi
          GROUP BY coi.cart_order_id
        ) sub
        WHERE co.id = sub.cart_order_id
          AND (co.total_amount IS NULL OR co.total_amount = 0)
      `);
    }
  }

  // ── List Cart Orders ─────────────────────────────────────────────────

  async list(
    input: ListCartOrdersInput,
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
    /** The logged-in closer's ID — enables (branch OR assigned=me) expansion
     *  ONLY when the closer is viewing their own queue. */
    viewerCloserId?: string | null,
  ) {
    const conditions: Parameters<typeof and>[0][] = input.showDeleted
      ? [sql`${schema.cartOrders.deletedAt} IS NOT NULL`]
      : [isNull(schema.cartOrders.deletedAt)];

    if (input.status) conditions.push(eq(schema.cartOrders.status, input.status));
    if (input.statuses && input.statuses.length > 0) {
      conditions.push(inArray(schema.cartOrders.status, input.statuses));
    }
    if (input.mediaBuyerId) conditions.push(eq(schema.cartOrders.mediaBuyerId, input.mediaBuyerId));
    if (input.unassignedOnly) conditions.push(isNull(schema.cartOrders.assignedCsId));
    if (input.search) {
      const trimmed = input.search.trim();
      if (trimmed.length > 0) {
        const orderNumMatch = trimmed.match(/^(?:YNS[- ]?)?(\d{1,7})$/i);
        const parsedOrderNum = orderNumMatch?.[1] ? parseInt(orderNumMatch[1], 10) : NaN;
        if (!Number.isNaN(parsedOrderNum) && parsedOrderNum > 0) {
          const combined = or(
            eq(schema.cartOrders.orderNumber, parsedOrderNum),
            ilike(schema.cartOrders.customerName, `%${trimmed}%`),
          );
          if (combined) conditions.push(combined);
        } else {
          conditions.push(ilike(schema.cartOrders.customerName, `%${trimmed}%`));
        }
      }
    }
    if (input.assignedCsId) conditions.push(eq(schema.cartOrders.assignedCsId, input.assignedCsId));
    {
      const bCond = branchScopeCondition(schema.cartOrders.servicingBranchId, branchId ?? input.branchId, effectiveBranchIds);
      // CS closer self-query: show orders in their branch OR assigned to them
      // so orders serviced by a different branch are still visible to the closer.
      // Only applies when the closer is viewing their own queue (viewerCloserId matches).
      const isSelfQuery = viewerCloserId && input.assignedCsId === viewerCloserId;
      if (isSelfQuery && bCond) {
        conditions.push(or(bCond, eq(schema.cartOrders.assignedCsId, viewerCloserId))!);
      } else if (bCond) {
        conditions.push(bCond);
      }
    }
    // Status-aware date column: when filtering by a terminal status, use the
    // milestone timestamp so "delivered this month" shows orders delivered in
    // the period, not just created in it.
    const dateCol =
      input.showDeleted
        ? schema.cartOrders.deletedAt
        : input.status === 'DELIVERED' || input.status === 'REMITTED'
          ? schema.cartOrders.deliveredAt
          : input.status === 'CONFIRMED' || input.status === 'AGENT_ASSIGNED' || input.status === 'DISPATCHED' || input.status === 'IN_TRANSIT'
            ? schema.cartOrders.confirmedAt
            : schema.cartOrders.createdAt;
    if (input.startDate) conditions.push(gte(dateCol, nigeriaDayStart(input.startDate)));
    if (input.endDate) conditions.push(lte(dateCol, nigeriaDayEnd(input.endDate)));

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
    viewerCloserId?: string | null,
  ) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.cartOrders.deletedAt)];
    if (assignedCsId) conditions.push(eq(schema.cartOrders.assignedCsId, assignedCsId));
    if (mediaBuyerId) conditions.push(eq(schema.cartOrders.mediaBuyerId, mediaBuyerId));
    {
      const bCond = branchScopeCondition(schema.cartOrders.servicingBranchId, branchId, effectiveBranchIds);
      const isSelfQuery = viewerCloserId && assignedCsId === viewerCloserId;
      if (isSelfQuery && bCond) {
        conditions.push(or(bCond, eq(schema.cartOrders.assignedCsId, viewerCloserId))!);
      } else if (bCond) {
        conditions.push(bCond);
      }
    }
    // Date filter — counts must match the list so the pills agree with the rows.
    if (startDate) conditions.push(gte(schema.cartOrders.createdAt, nigeriaDayStart(startDate)));
    if (endDate) conditions.push(lte(schema.cartOrders.createdAt, nigeriaDayEnd(endDate)));

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
    // Date-scope deleted count by deletedAt so the pill matches the list rows.
    if (startDate) deletedConditions.push(gte(schema.cartOrders.deletedAt, nigeriaDayStart(startDate)));
    if (endDate) deletedConditions.push(lte(schema.cartOrders.deletedAt, nigeriaDayEnd(endDate)));

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

    // Persist logistics fields from metadata (mirrors regular order transitions)
    const logisticsUpdates: Record<string, unknown> = {};
    if (metadata?.logisticsLocationId) logisticsUpdates.logisticsLocationId = metadata.logisticsLocationId;
    if (metadata?.logisticsProviderId) logisticsUpdates.logisticsProviderId = metadata.logisticsProviderId;
    if (metadata?.riderId) logisticsUpdates.riderId = metadata.riderId;
    if (metadata?.preferredDeliveryDate) logisticsUpdates.preferredDeliveryDate = metadata.preferredDeliveryDate;
    if (metadata?.deliveryNote) logisticsUpdates.deliveryNotes = metadata.deliveryNote;
    if (metadata?.deliveryProofUrl) logisticsUpdates.deliveryProofUrl = metadata.deliveryProofUrl;

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.cartOrders)
        .set({ status: newStatus, ...timestampUpdates, ...logisticsUpdates })
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

      // Detect retrack (rolling back to an earlier status).
      const STATUS_ORDER = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED'];
      const prevIdx = STATUS_ORDER.indexOf(order.status);
      const newIdx = STATUS_ORDER.indexOf(newStatus);
      const isRetrack = prevIdx > 0 && newIdx >= 0 && newIdx < prevIdx && newStatus !== 'DELETED';

      const statusLabel = (s: string) => {
        const labels: Record<string, string> = {
          UNPROCESSED: 'Unassigned', CS_ASSIGNED: 'Assigned', CS_ENGAGED: 'Unconfirmed',
          CONFIRMED: 'Confirmed', AGENT_ASSIGNED: 'Agent Assigned', DISPATCHED: 'Dispatched',
          IN_TRANSIT: 'In Transit', DELIVERED: 'Delivered', REMITTED: 'Remitted', DELETED: 'Deleted',
        };
        return labels[s] ?? s.replace(/_/g, ' ').toLowerCase();
      };

      // Build a descriptive timeline message instead of the generic "Status changed to X."
      let description: string | undefined;
      if (isRetrack) {
        description = `Order retracked from ${statusLabel(order.status)} to ${statusLabel(newStatus)}${note ? `. ${note}` : ''}`;
      } else if (note) {
        description = note;
      }
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

    // Auto-generate a draft invoice when a cart order is CONFIRMED.
    // Mirrors the regular orders CONFIRMED trigger. Idempotent — the graduation
    // path also tries to create one, so whichever fires first wins.
    if (newStatus === 'CONFIRMED') {
      try {
        await this.autoCreateInvoiceForCartOrder(orderId, order);
      } catch (err) {
        this.logger.warn(`Auto-invoice for cart order ${orderId} on CONFIRMED failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Graduate to orders on DELIVERED.
    // Wrapped in try/catch so the DELIVERED status (already committed above)
    // is never rolled back. Failed graduations are retried by the boot sweep.
    if (newStatus === 'DELIVERED') {
      try {
        await this.graduateToOrders(orderId);
      } catch (err) {
        this.logger.error(`Cart order graduation failed for ${orderId} — will be retried by boot sweep: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { success: true };
  }

  // ── Auto Invoice on CONFIRMED ────────────────────────────────────────

  private async autoCreateInvoiceForCartOrder(
    cartOrderId: string,
    order: typeof schema.cartOrders.$inferSelect,
  ): Promise<void> {
    // Idempotent — skip if an invoice already exists for this cart order
    const [existing] = await this.db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.orderId, cartOrderId))
      .limit(1);
    if (existing) return;

    const items = await this.db
      .select({
        quantity: schema.cartOrderItems.quantity,
        unitPrice: schema.cartOrderItems.unitPrice,
        offerLabel: schema.cartOrderItems.offerLabel,
        productName: schema.products.name,
      })
      .from(schema.cartOrderItems)
      .leftJoin(schema.products, eq(schema.cartOrderItems.productId, schema.products.id))
      .where(eq(schema.cartOrderItems.cartOrderId, cartOrderId));

    if (items.length === 0) {
      this.logger.warn(`autoCreateInvoiceForCartOrder: cart order ${cartOrderId} has no items, skipping`);
      return;
    }

    const lineItems = items.map((it) => ({
      description: `${it.productName ?? 'Product'}${it.offerLabel ? ` (${it.offerLabel})` : ''}`,
      quantity: it.quantity,
      unitPrice: String(it.unitPrice),
    }));
    const totalAmount = items.reduce((sum, it) => sum + Number(it.unitPrice), 0);

    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx.insert(schema.invoices).values({
        orderId: cartOrderId,
        recipientInfo: {
          name: order.customerName,
          address: order.customerAddress ?? undefined,
        },
        lineItems,
        taxRate: null,
        totalAmount: totalAmount.toFixed(2),
        dueDate: null,
        status: 'DRAFT',
      });
    });
  }

  // ── Graduation Retry ─────────────────────────────────────────────────

  /**
   * Retry orphaned cart order graduations — DELIVERED in cart_orders but
   * no matching row in the orders table. Called on boot by the follow-up
   * service's sweep (which delegates here).
   */
  async retryFailedGraduations(): Promise<void> {
    const orphaned = await this.db.execute<{ id: string }>(sql`
      SELECT co.id
      FROM cart_orders co
      WHERE co.status = 'DELIVERED'
        AND co.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          WHERE o.order_source = 'online'
            AND (
              (co.source_cart_id IS NOT NULL AND o.cart_id = co.source_cart_id)
              OR o.customer_phone_hash = co.customer_phone_hash
            )
        )
      LIMIT 200
    `);

    if (orphaned.length === 0) return;

    this.logger.log(`Retrying graduation for ${orphaned.length} orphaned cart order(s)`);
    let succeeded = 0;
    for (const row of orphaned) {
      try {
        await this.graduateToOrders(row.id);
        succeeded++;
      } catch (err) {
        this.logger.error(`Retry graduation failed for cart order ${row.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
    this.logger.log(`Cart order graduation retry: ${succeeded}/${orphaned.length} succeeded`);
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

    // Dedup guard: skip graduation only if the same phone+product+amount already has
    // a DELIVERED or REMITTED order within 14 days. Different amounts or 14+ day
    // gaps are legitimate separate purchases — don't block.
    if (co.customerPhoneHash && coItems.length > 0) {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const productIds = coItems.map((i) => i.productId).filter(Boolean) as string[];
      const itemPrices = coItems.map((i) => String(i.unitPrice)).filter(Boolean);
      if (productIds.length > 0) {
        const existing = await this.db
          .select({ id: schema.orders.id })
          .from(schema.orders)
          .innerJoin(schema.orderItems, eq(schema.orderItems.orderId, schema.orders.id))
          .where(
            and(
              eq(schema.orders.customerPhoneHash, co.customerPhoneHash),
              inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
              isNull(schema.orders.deletedAt),
              gte(schema.orders.deliveredAt, fourteenDaysAgo),
              inArray(schema.orderItems.productId, productIds),
              // Must match price — different amount = different purchase
              ...(itemPrices.length > 0
                ? [sql`${schema.orderItems.unitPrice}::text IN (${sql.join(itemPrices.map(p => sql`${p}`), sql`, `)})`]
                : []),
            ),
          )
          .limit(1);
        const dupeMatch = existing[0];
        if (dupeMatch) {
          this.logger.warn(
            `Cart order ${cartOrderId} skipped graduation: duplicate delivery found (order ${dupeMatch.id}) for same phone+product+amount`,
          );
          await this.db
            .update(schema.cartOrders)
            .set({ status: 'CONVERTED' })
            .where(eq(schema.cartOrders.id, cartOrderId));
          return;
        }
      }
    }

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
          createdAt: co.createdAt,
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

        // Auto-generate invoice inside the same transaction so a graduated
        // order can never land in the orders table without an invoice.
        const gradItems = await tx
          .select({
            quantity: schema.orderItems.quantity,
            unitPrice: schema.orderItems.unitPrice,
            offerLabel: schema.orderItems.offerLabel,
            productName: schema.products.name,
          })
          .from(schema.orderItems)
          .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
          .where(eq(schema.orderItems.orderId, graduated.id));

        if (gradItems.length > 0) {
          const lineItems = gradItems.map((it) => ({
            description: `${it.productName ?? 'Product'}${it.offerLabel ? ` (${it.offerLabel})` : ''}`,
            quantity: it.quantity,
            unitPrice: String(it.unitPrice),
          }));
          const totalAmount = gradItems.reduce((sum, it) => sum + Number(it.unitPrice), 0);

          await tx.insert(schema.invoices).values({
            orderId: graduated.id,
            recipientInfo: {
              name: co.customerName,
              address: co.customerAddress ?? undefined,
            },
            lineItems,
            taxRate: null,
            totalAmount: totalAmount.toFixed(2),
            dueDate: null,
            status: 'DRAFT',
          }).onConflictDoNothing();
        }
      }

      return graduated?.id ?? null;
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

    const [items, timeline, userIds, pendingPriceReq] = await Promise.all([
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
      this.db
        .select({
          id: schema.permissionRequests.id,
          payload: schema.permissionRequests.payload,
          reason: schema.permissionRequests.reason,
          requesterId: schema.permissionRequests.requesterId,
        })
        .from(schema.permissionRequests)
        .where(
          and(
            eq(schema.permissionRequests.status, 'PENDING'),
            sql`${schema.permissionRequests.type}::text = 'ORDER_LINE_PRICE_CHANGE'`,
            sql`(${schema.permissionRequests.payload}->>'orderId') = ${id}`,
          ),
        )
        .limit(1),
    ]);

    const prReq = pendingPriceReq[0] ?? null;
    const allUserIds = [...userIds, ...(prReq?.requesterId ? [prReq.requesterId] : [])];
    const uniqueAllUserIds = [...new Set(allUserIds)];
    const userRows = uniqueAllUserIds.length > 0
      ? await this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, uniqueAllUserIds))
      : [];
    const userMap = new Map(userRows.map((u) => [u.id, u.name]));

    const campaignName = order.campaignId
      ? (await this.db.select({ name: schema.campaigns.name }).from(schema.campaigns).where(eq(schema.campaigns.id, order.campaignId)).limit(1))[0]?.name ?? null
      : null;

    // Synthetic ORDER_RECEIVED fallback — mirrors the orders service behaviour.
    // Cart orders pulled before Step D was added (or hit a race) may have no
    // timeline events at all.
    const hasOrderReceived = timeline.some((t) => t.eventType === 'ORDER_RECEIVED');
    const finalTimeline = hasOrderReceived
      ? timeline
      : [
          {
            id: `derived:${order.id}:order_received`,
            cartOrderId: order.id,
            eventType: 'ORDER_RECEIVED' as const,
            actorId: null,
            actorName: 'System',
            description: 'Cart order created from abandoned cart.',
            metadata: { sourceCartId: order.sourceCartId, derivedFromOrderRow: true },
            branchId: order.servicingBranchId,
            createdAt: order.createdAt,
          },
          ...timeline,
        ];

    return {
      ...order,
      assignedCsName: order.assignedCsId ? userMap.get(order.assignedCsId) ?? null : null,
      mediaBuyerName: order.mediaBuyerId ? userMap.get(order.mediaBuyerId) ?? null : null,
      pendingOrderLinePriceRequestId: prReq?.id ?? null,
      pendingLinePriceChangeProposal: prReq ? {
        items: ((prReq.payload as Record<string, unknown>)?.items ?? []) as Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>,
        totalAmount: Number((prReq.payload as Record<string, unknown>)?.totalAmount ?? 0),
        reason: prReq.reason,
        requesterName: prReq.requesterId ? (userMap.get(prReq.requesterId) ?? null) : null,
      } : null,
      campaignName,
      orderItems: items,
      timeline: finalTimeline,
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

      const fieldLabels: Record<string, string> = {
        customerName: 'customer name',
        deliveryAddress: 'delivery address',
        deliveryState: 'delivery state',
        deliveryNotes: 'delivery notes',
        customerEmail: 'customer email',
        preferredDeliveryDate: 'preferred delivery date',
      };
      const changedFields = Object.keys(updates).filter((k) => k !== 'updatedAt');
      const readableFields = changedFields.map((f) => fieldLabels[f] ?? f);
      await tx.insert(schema.cartOrderTimelineEvents).values({
        cartOrderId: input.orderId,
        eventType: 'ADDRESS_UPDATED',
        actorId: actor.id,
        actorName: actor.name,
        description: `Updated ${readableFields.join(', ')}.`,
        metadata: { changedFields },
        branchId: order.servicingBranchId,
      });

      return { success: true };
    });
  }

  // ── Adjust Items ──────────────────────────────────────────────────────
  async adjustItems(
    orderId: string,
    items: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>,
    totalAmount: number,
    actor: SessionUser,
  ) {
    const [order] = await this.db
      .select({ id: schema.cartOrders.id, status: schema.cartOrders.status, servicingBranchId: schema.cartOrders.servicingBranchId })
      .from(schema.cartOrders)
      .where(eq(schema.cartOrders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });

    const blockedStatuses = ['DELIVERED', 'REMITTED'];
    if (blockedStatuses.includes(order.status)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cart order items cannot be adjusted after delivery.' });
    }

    return withActor(this.db, actor, async (tx) => {
      // Delete existing items and reinsert — use returning() to verify rows removed
      const deleted = await tx.delete(schema.cartOrderItems)
        .where(eq(schema.cartOrderItems.cartOrderId, orderId))
        .returning({ id: schema.cartOrderItems.id });
      this.logger.log(`adjustItems: deleted ${deleted.length} existing items for cart order ${orderId}`);

      const inserted = [];
      for (const item of items) {
        const [row] = await tx.insert(schema.cartOrderItems).values({
          cartOrderId: orderId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: sql`${item.unitPrice}::numeric`,
          offerLabel: item.offerLabel ?? null,
        }).returning({ id: schema.cartOrderItems.id });
        inserted.push(row);
      }
      this.logger.log(`adjustItems: inserted ${inserted.length} new items for cart order ${orderId}`);

      // Update totalAmount + jsonb items on the cart order
      await tx
        .update(schema.cartOrders)
        .set({ totalAmount: sql`${totalAmount}::numeric`, items: items, updatedAt: new Date() })
        .where(eq(schema.cartOrders.id, orderId));

      await tx.insert(schema.cartOrderTimelineEvents).values({
        cartOrderId: orderId,
        eventType: 'QUANTITY_UPDATED',
        actorId: actor.id,
        actorName: actor.name,
        description: `Adjusted order items. New total ₦${totalAmount.toLocaleString('en-NG')}.`,
        metadata: { items, totalAmount },
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

    await withActor(this.db, actor, async (tx) => {
      // Transition to CS_ENGAGED if not already past it
      if (order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') {
        await tx
          .update(schema.cartOrders)
          .set({ status: 'CS_ENGAGED', updatedAt: new Date() })
          .where(eq(schema.cartOrders.id, orderId));
      }

      // Always record the manual call — even if already CS_ENGAGED.
      // The confirm gate requires at least one call log to exist.
      await tx.insert(schema.cartOrderTimelineEvents).values({
        cartOrderId: orderId,
        eventType: 'MANUAL_CALL_LOGGED',
        actorId: actor.id,
        actorName: actor.name,
        description: 'Manual call recorded.',
        metadata: { previousStatus: order.status },
        branchId: order.servicingBranchId,
      });
    });

    return { success: true, callInitiated: true, callLog: null };
  }

  // ── Pull Abandoned Carts into Cart Orders ────────────────────────────
  // Called from the queue.carts page or cron to convert abandoned carts
  // into cart_orders for CS to work.

  async pullFromAbandonedCarts(
    cartIds: string[],
    targetBranchId: string | null,
    _actor: SessionUser,
  ) {
    if (cartIds.length === 0) return { pulled: 0 };

    // ── 1. Resolve routing BEFORE the transaction (read-only, can use Drizzle) ──
    let resolvedBranchId = targetBranchId;
    let resolvedRuleId: string | null = null;
    if (!resolvedBranchId) {
      // Look up the first cart's campaign branch to seed routing
      const idList = cartIds.map((id) => `'${id}'`).join(', ');
      const [firstCart] = await this.pg.unsafe<Array<{ campaign_id: string | null }>>(`
        SELECT ca.campaign_id FROM cart_abandonments ca
        WHERE ca.id IN (${idList}) AND ca.campaign_id IS NOT NULL
        LIMIT 1
      `);
      let campaignBranchId: string | null = null;
      if (firstCart?.campaign_id) {
        const [camp] = await this.db
          .select({ branchId: schema.campaigns.branchId })
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, firstCart.campaign_id))
          .limit(1);
        campaignBranchId = camp?.branchId ?? null;
      }
      const routing = await this.resolveRoutingBranch(campaignBranchId);
      if (routing) {
        resolvedBranchId = routing.branchId;
        resolvedRuleId = routing.ruleId;
      }
    }

    const branchLiteral = resolvedBranchId ? `'${resolvedBranchId}'` : 'NULL';
    const ruleLiteral = resolvedRuleId ? `'${resolvedRuleId}'` : 'NULL';
    const safeIdList = cartIds.map((id) => `'${id}'`).join(', ');

    // ── 2. Standalone pg.unsafe() calls (simple protocol) ──────────────
    // pg.begin() uses extended protocol internally which triggers the
    // "column valid_from does not exist" error even with UPDATE-only triggers.
    // Standalone pg.unsafe() calls stay on simple protocol and work reliably.
    // The NOT IN / NOT EXISTS guards on each step prevent duplicates if a
    // partial failure leaves orphaned rows — the next cron run completes them.

    // Step A: Insert cart_orders from eligible abandoned carts
    this.logger.log(`[pull] Step A: starting INSERT for ${cartIds.length} cart(s), branch=${branchLiteral}, rule=${ruleLiteral}`);
    const inserted = await this.pg.unsafe<Array<{ id: string; source_cart_id: string }>>(`
      INSERT INTO cart_orders (
        id, source_cart_id, campaign_id, media_buyer_id, status,
        customer_name, customer_phone_hash, customer_phone,
        customer_address, delivery_address, total_amount,
        delivery_notes, delivery_state, customer_gender,
        preferred_delivery_date, payment_method, customer_email,
        order_source, branch_id, servicing_branch_id, routing_rule_id,
        custom_fields
      )
      SELECT
        gen_random_uuid(), ca.id, ca.campaign_id, ca.media_buyer_id,
        'UNPROCESSED', ca.customer_name, ca.customer_phone_hash, ca.customer_phone,
        ca.customer_address, ca.delivery_address, 0,
        ca.delivery_notes, ca.delivery_state, ca.customer_gender,
        ca.preferred_delivery_date, ca.payment_method, ca.customer_email,
        'online', camp.branch_id, ${branchLiteral}, ${ruleLiteral},
        ca.custom_field_values
      FROM cart_abandonments ca
      LEFT JOIN campaigns camp ON camp.id = ca.campaign_id
      WHERE ca.id IN (${safeIdList})
        AND ca.status IN ('PENDING', 'ABANDONED')
        AND (ca.customer_phone IS NOT NULL OR ca.customer_phone_hash IS NOT NULL)
        AND ca.id NOT IN (SELECT source_cart_id FROM cart_orders)
        -- Dedup: skip if an edge-form order already exists for the same
        -- customer + product + same total amount within 14 days.
        -- Different amounts or 14+ day gaps are likely legitimate separate purchases.
        AND NOT EXISTS (
          SELECT 1
          FROM orders o
          JOIN order_items oi ON oi.order_id = o.id
          WHERE o.customer_phone_hash = ca.customer_phone_hash
            AND oi.product_id = ca.product_id
            AND oi.unit_price = COALESCE(
              (SELECT (ofr->>'price')::numeric
               FROM jsonb_array_elements(p.offers) AS ofr
               WHERE ofr->>'label' = ca.offer_label
               LIMIT 1),
              COALESCE(p.base_sale_price, 0)
            )
            AND (o.order_source IS NULL OR o.order_source = 'edge-form')
            AND o.deleted_at IS NULL
            AND o.status != 'DELETED'
            AND o.created_at >= (ca.created_at - INTERVAL '14 days')
        )
      RETURNING id, source_cart_id
    `);

    this.logger.log(`[pull] Step A: inserted ${inserted.length} cart orders`);
    if (inserted.length === 0) return { pulled: 0 };

    const sourceIdList = inserted.map((r) => `'${r.source_cart_id}'`).join(', ');

    // Step B: Create cart_order_items from product catalog
    const items = await this.pg.unsafe<Array<{ id: string }>>(`
      INSERT INTO cart_order_items (
        id, cart_order_id, product_id, quantity, unit_price, offer_label
      )
      SELECT
        gen_random_uuid(),
        co.id,
        ca.product_id,
        COALESCE(ca.quantity, 1),
        COALESCE(
          (SELECT (o->>'price')::numeric
           FROM jsonb_array_elements(p.offers) AS o
           WHERE o->>'label' = ca.offer_label
           LIMIT 1),
          COALESCE(p.base_sale_price, 0)
        ),
        ca.offer_label
      FROM cart_orders co
      JOIN cart_abandonments ca ON ca.id = co.source_cart_id
      LEFT JOIN products p ON p.id = ca.product_id
      WHERE co.source_cart_id IN (${sourceIdList})
        AND NOT EXISTS (
          SELECT 1 FROM cart_order_items coi WHERE coi.cart_order_id = co.id
        )
      RETURNING id
    `);
    this.logger.log(`[pull] Step B: created ${items.length} line items`);

    // Step C: Update total_amount from line items
    await this.pg.unsafe(`
      UPDATE cart_orders co
      SET total_amount = sub.line_total, updated_at = now()
      FROM (
        SELECT coi.cart_order_id, SUM(coi.unit_price * coi.quantity) AS line_total
        FROM cart_order_items coi
        WHERE coi.cart_order_id IN (
          SELECT id FROM cart_orders WHERE source_cart_id IN (${sourceIdList})
        )
        GROUP BY coi.cart_order_id
      ) sub
      WHERE co.id = sub.cart_order_id
        AND (co.total_amount IS NULL OR co.total_amount = 0)
    `);
    this.logger.log(`[pull] Step C: updated totals`);

    // Step D: Create timeline events
    await this.pg.unsafe(`
      INSERT INTO cart_order_timeline_events (
        id, cart_order_id, event_type, actor_name, description, metadata, branch_id
      )
      SELECT
        gen_random_uuid(),
        co.id,
        'ORDER_RECEIVED',
        'System',
        'Cart order created from abandoned cart.',
        jsonb_build_object('sourceCartId', co.source_cart_id),
        co.servicing_branch_id
      FROM cart_orders co
      WHERE co.source_cart_id IN (${sourceIdList})
        AND NOT EXISTS (
          SELECT 1 FROM cart_order_timeline_events cte WHERE cte.cart_order_id = co.id
        )
    `);
    this.logger.log(`[pull] Step D: created timeline events`);

    this.logger.log(`pullFromAbandonedCarts: pulled ${inserted.length} of ${cartIds.length} requested`);
    return { pulled: inserted.length };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Cart Order Routing Rules — CRUD + route resolution + auto-pull cron
  // ══════════════════════════════════════════════════════════════════════

  async listRoutingRules(enabledOnly?: boolean) {
    const conditions: Parameters<typeof and>[0][] = [];
    if (enabledOnly) conditions.push(eq(schema.cartOrderRoutingRules.enabled, true));

    const rules = await this.db
      .select({
        id: schema.cartOrderRoutingRules.id,
        name: schema.cartOrderRoutingRules.name,
        sourceBranchId: schema.cartOrderRoutingRules.sourceBranchId,
        targetBranchId: schema.cartOrderRoutingRules.targetBranchId,
        priority: schema.cartOrderRoutingRules.priority,
        enabled: schema.cartOrderRoutingRules.enabled,
        createdAt: schema.cartOrderRoutingRules.createdAt,
        updatedAt: schema.cartOrderRoutingRules.updatedAt,
      })
      .from(schema.cartOrderRoutingRules)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(schema.cartOrderRoutingRules.priority), asc(schema.cartOrderRoutingRules.createdAt));

    // Enrich with branch names
    const branchIds = [...new Set([
      ...rules.map((r) => r.sourceBranchId).filter(Boolean),
      ...rules.map((r) => r.targetBranchId).filter(Boolean),
    ])] as string[];

    const branchMap = new Map<string, string>();
    if (branchIds.length > 0) {
      const rows = await this.db
        .select({ id: schema.branches.id, name: schema.branches.name })
        .from(schema.branches)
        .where(inArray(schema.branches.id, branchIds));
      for (const r of rows) branchMap.set(r.id, r.name);
    }

    return rules.map((r) => ({
      ...r,
      sourceBranchName: r.sourceBranchId ? branchMap.get(r.sourceBranchId) ?? null : null,
      targetBranchName: r.targetBranchId ? branchMap.get(r.targetBranchId) ?? null : null,
    }));
  }

  async createRoutingRule(actor: SessionUser, input: CreateCartOrderRoutingRuleInput) {
    const [rule] = await withActor(this.db, actor, async (tx) => {
      return tx
        .insert(schema.cartOrderRoutingRules)
        .values({
          name: input.name,
          sourceBranchId: input.sourceBranchId ?? null,
          targetBranchId: input.targetBranchId ?? null,
          priority: input.priority ?? 0,
          enabled: input.enabled ?? true,
        })
        .returning();
    });
    return rule;
  }

  async updateRoutingRule(actor: SessionUser, input: UpdateCartOrderRoutingRuleInput) {
    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateFields['name'] = input.name;
    if (input.sourceBranchId !== undefined) updateFields['sourceBranchId'] = input.sourceBranchId;
    if (input.targetBranchId !== undefined) updateFields['targetBranchId'] = input.targetBranchId;
    if (input.priority !== undefined) updateFields['priority'] = input.priority;
    if (input.enabled !== undefined) updateFields['enabled'] = input.enabled;

    const [updated] = await withActor(this.db, actor, async (tx) => {
      return tx
        .update(schema.cartOrderRoutingRules)
        .set(updateFields)
        .where(eq(schema.cartOrderRoutingRules.id, input.ruleId))
        .returning();
    });
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Routing rule not found' });
    return updated;
  }

  async deleteRoutingRule(actor: SessionUser, ruleId: string) {
    const [deleted] = await withActor(this.db, actor, async (tx) => {
      return tx
        .delete(schema.cartOrderRoutingRules)
        .where(eq(schema.cartOrderRoutingRules.id, ruleId))
        .returning({ id: schema.cartOrderRoutingRules.id });
    });
    if (!deleted) throw new TRPCError({ code: 'NOT_FOUND', message: 'Routing rule not found' });
    return { success: true };
  }

  /**
   * Resolve the target servicing branch for a cart by evaluating routing rules.
   * Rules are evaluated in priority order (highest first). First match wins.
   * If no rule matches, returns null (caller decides fallback).
   */
  private async resolveRoutingBranch(
    campaignBranchId: string | null,
  ): Promise<{ branchId: string; ruleId: string; ruleName: string } | null> {
    const rules = await this.db
      .select()
      .from(schema.cartOrderRoutingRules)
      .where(eq(schema.cartOrderRoutingRules.enabled, true))
      .orderBy(desc(schema.cartOrderRoutingRules.priority), asc(schema.cartOrderRoutingRules.createdAt));

    if (rules.length === 0) return null;

    for (const rule of rules) {
      // sourceBranchId filter: if set, only match carts from this marketing branch
      if (rule.sourceBranchId && rule.sourceBranchId !== campaignBranchId) continue;
      // sourceBranchId=null matches everything (org-wide catch-all)

      if (rule.targetBranchId) {
        return { branchId: rule.targetBranchId, ruleId: rule.id, ruleName: rule.name };
      }

      // targetBranchId=null → round-robin across active CS branches
      const activeBranches = await this.getActiveCsBranchIds();
      if (activeBranches.length === 0) return null;

      // Simple round-robin: use current count of today's cart orders as offset
      const todayCount = await this.db
        .select({ c: count() })
        .from(schema.cartOrders)
        .where(gte(schema.cartOrders.createdAt, nigeriaDayStart(new Date().toISOString().slice(0, 10))));
      const idx = (todayCount[0]?.c ?? 0) % activeBranches.length;
      return { branchId: activeBranches[idx]!, ruleId: rule.id, ruleName: rule.name };
    }

    return null;
  }

  /** Returns branch IDs that have an active CS department. */
  private async getActiveCsBranchIds(): Promise<string[]> {
    const rows = await this.db
      .select({ branchId: schema.branchDepartments.branchId })
      .from(schema.branchDepartments)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.branchDepartments.branchId))
      .where(and(
        eq(schema.branchDepartments.department, 'CS'),
        eq(schema.branchDepartments.status, 'ACTIVE'),
        eq(schema.branches.status, 'ACTIVE'),
        sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`,
      ));
    return rows.map((r) => r.branchId);
  }

  async listActiveCsBranches(effectiveBranchIds?: string[] | null): Promise<Array<{ id: string; name: string }>> {
    const conditions = [
      eq(schema.branchDepartments.department, 'CS'),
      eq(schema.branchDepartments.status, 'ACTIVE'),
      eq(schema.branches.status, 'ACTIVE'),
      sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`,
    ];
    const bCond = branchScopeCondition(schema.branches.id, null, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    return this.db
      .select({ id: schema.branches.id, name: schema.branches.name })
      .from(schema.branchDepartments)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.branchDepartments.branchId))
      .where(and(...conditions));
  }

  // ── Auto-Pull (called from cart.service.ts 10-min cron) ─────────────
  // No standalone cron here — the 10-min abandoned-cart cron in
  // CartService marks PENDING→ABANDONED then calls runAutoSync so
  // there is a single pull path with routing rules.

  async runAutoSync(triggeredBy: 'cron' | 'manual', actorId?: string) {
    const startedAt = new Date();

    // Find all ABANDONED carts not yet pulled into cart_orders.
    // Use pg.unsafe() (simple protocol) — Drizzle extended protocol has caused
    // silent failures with NOT IN subqueries on this table.
    const carts = await this.pg.unsafe<Array<{ id: string }>>(`
      SELECT ca.id
      FROM cart_abandonments ca
      WHERE ca.status = 'ABANDONED'
        AND ca.id NOT IN (SELECT source_cart_id FROM cart_orders)
      LIMIT 5000
    `);

    this.logger.log(`[runAutoSync] Found ${carts.length} ABANDONED cart(s) not yet pulled`);

    if (carts.length === 0) {
      return { totalPulled: 0 };
    }

    const actor: SessionUser = {
      id: actorId ?? SYSTEM_ACTOR_ID,
      name: actorId ? undefined : 'System',
      role: 'SUPER_ADMIN',
    } as SessionUser;

    // Pull in batches of 100 to limit blast radius — if one batch fails,
    // the rest still get pulled on the next cron run.
    const BATCH_SIZE = 100;
    const cartIds = carts.map((c) => c.id);
    let totalPulled = 0;
    let errorMessage: string | null = null;

    for (let i = 0; i < cartIds.length; i += BATCH_SIZE) {
      const batch = cartIds.slice(i, i + BATCH_SIZE);
      try {
        const result = await this.pullFromAbandonedCarts(batch, null, actor);
        totalPulled += result.pulled;
      } catch (err) {
        const msg = err instanceof Error ? (err as Error).stack ?? err.message : String(err);
        this.logger.error(`[runAutoSync] Batch ${i / BATCH_SIZE + 1} failed (${batch.length} carts): ${msg}`);
        errorMessage = errorMessage ? `${errorMessage}; ${msg}` : msg;
        // Continue with next batch — don't let one bad batch block everything
      }
    }

    // Write sync log for observability
    try {
      await this.pg.unsafe(`
        INSERT INTO cart_order_sync_logs (
          id, triggered_by, triggered_by_user_id, started_at, finished_at,
          total_pulled, error_message
        ) VALUES (
          gen_random_uuid(), '${triggeredBy}',
          ${actorId ? `'${actorId}'` : 'NULL'},
          '${startedAt.toISOString()}'::timestamptz,
          now(),
          ${totalPulled},
          ${errorMessage ? `'${errorMessage.replace(/'/g, "''")}'` : 'NULL'}
        )
      `);
    } catch (logErr) {
      this.logger.warn(`[runAutoSync] Failed to write sync log: ${logErr instanceof Error ? logErr.message : logErr}`);
    }

    this.logger.log(`[runAutoSync] Done: pulled ${totalPulled} of ${cartIds.length} cart(s)${errorMessage ? ` (errors: ${errorMessage})` : ''}`);
    return { totalPulled };
  }
}
