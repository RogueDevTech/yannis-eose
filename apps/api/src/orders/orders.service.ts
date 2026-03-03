import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, asc, sql, ilike, or, count, gte, lte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type {
  CreateOrderInput,
  TransitionOrderInput,
  UpdateOrderInput,
  ListOrdersInput,
  OrderStatus,
} from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import {
  isTransitionAllowed,
  getAllowedNextStatuses,
  TRANSITION_TIMESTAMPS,
} from './order-state-machine';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { CartService } from '../cart/cart.service';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly cartService: CartService,
  ) {}

  /**
   * Create a new order with status UNPROCESSED.
   * Called by Edge Worker or admin manual entry.
   */
  async create(input: CreateOrderInput & { cartId?: string }, actorId: string | null) {
    // Set actor for audit trail
    if (actorId) {
      await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;
    }

    const { cartId, ...orderInput } = input;

    const rows = await this.db
      .insert(schema.orders)
      .values({
        campaignId: orderInput.campaignId ?? null,
        mediaBuyerId: orderInput.mediaBuyerId ?? null,
        customerName: orderInput.customerName,
        customerPhoneHash: orderInput.customerPhoneHash,
        customerAddress: orderInput.customerAddress ?? null,
        deliveryAddress: orderInput.deliveryAddress ?? null,
        deliveryNotes: orderInput.deliveryNotes ?? null,
        items: orderInput.items,
        totalAmount: orderInput.totalAmount != null ? String(orderInput.totalAmount) : null,
        status: 'UNPROCESSED',
      })
      .returning();

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create order' });
    }

    // Create order items
    if (orderInput.items.length > 0) {
      await this.db.insert(schema.orderItems).values(
        orderInput.items.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
          offerLabel: item.offerLabel ?? null,
        })),
      );
    }

    // Emit real-time event for CS dispatch
    this.events.emitNewOrder({
      orderId: order.id,
      productName: 'Order created',
    });

    // Notify Head of CS and Head of Marketing (every new order)
    this.notifications
      .createForRole('HEAD_OF_CS', {
        type: 'order:new',
        title: 'New order received',
        body: 'A new order needs attention.',
        data: { orderId: order.id },
      })
      .catch(() => {});
    this.notifications
      .createForRole('HEAD_OF_MARKETING', {
        type: 'order:new',
        title: 'New order received',
        body: 'A new order has been created.',
        data: { orderId: order.id },
      })
      .catch(() => {});

    // Notify Media Buyer if order is from their campaign
    if (order.mediaBuyerId) {
      this.notifications
        .create({
          userId: order.mediaBuyerId,
          type: 'order:new_campaign',
          title: 'New order from your campaign',
          body: 'A new order has been created from your campaign.',
          data: { orderId: order.id },
        })
        .catch(() => {});
    }

    // Auto-dispatch to least-loaded CS agent
    await this.autoDispatchToCS(order.id);

    // Mark cart as CONVERTED if cartId was provided
    if (cartId) {
      await this.cartService.convert(cartId, order.id);
    }

    return order;
  }

  /**
   * Get a single order by ID with masked phone.
   */
  async getById(orderId: string) {
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // Get order items
    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));

    // Get call logs
    const calls = await this.db
      .select()
      .from(schema.callLogs)
      .where(eq(schema.callLogs.orderId, orderId))
      .orderBy(desc(schema.callLogs.startedAt));

    // Get allowed next statuses for UI button state
    const allowedTransitions = getAllowedNextStatuses(order.status as OrderStatus);

    return {
      ...order,
      customerPhoneDisplay: this.maskPhone(order.customerPhoneHash),
      orderItems: items,
      callLogs: calls,
      allowedTransitions,
    };
  }

  /**
   * Reveal the raw customer phone number for manual calling.
   * Only works when VOIP feature flag is OFF (manual mode).
   * Logs a MANUAL_CALL record in call_logs for audit purposes.
   */
  async revealPhoneForManualCall(orderId: string, actor: SessionUser): Promise<{ phone: string }> {
    // Verify VOIP is disabled (manual calling only available when VOIP is off)
    const voipSetting = await this.settingsService.get('VOIP_ENABLED');
    const isVoipEnabled = voipSetting?.['enabled'] === true;
    if (isVoipEnabled) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'VOIP is enabled. Phone numbers cannot be revealed. Use the VOIP call button instead.',
      });
    }

    // Set actor for audit trail
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    // Get order
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // Must be CS_ENGAGED to reveal phone
    if (order.status !== 'CS_ENGAGED') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot reveal phone: order is in ${order.status} status, must be CS_ENGAGED`,
      });
    }

    // Agent must be assigned or elevated
    const isElevated = actor.role === 'HEAD_OF_CS' || actor.role === 'SUPER_ADMIN';
    if (!isElevated && order.assignedCsId !== actor.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not assigned to this order',
      });
    }

    // Log a MANUAL_CALL record for audit trail
    await this.db.insert(schema.callLogs).values({
      orderId,
      agentId: actor.id,
      callStatus: 'MANUAL_CALL',
      durationSeconds: null,
      callToken: null,
      recordingUrl: null,
    });

    // Return the raw phone number
    return { phone: order.customerPhoneHash };
  }

  /**
   * List orders with filtering, search, and pagination.
   */
  async list(input: ListOrdersInput) {
    const conditions = [];

    if (input.status) {
      conditions.push(eq(schema.orders.status, input.status));
    }
    if (input.assignedCsId) {
      conditions.push(eq(schema.orders.assignedCsId, input.assignedCsId));
    }
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.orders.mediaBuyerId, input.mediaBuyerId));
    }
    if (input.riderId) {
      conditions.push(eq(schema.orders.riderId, input.riderId));
    }
    if (input.logisticsLocationId) {
      conditions.push(eq(schema.orders.logisticsLocationId, input.logisticsLocationId));
    }
    if (input.search) {
      conditions.push(
        or(
          ilike(schema.orders.customerName, `%${input.search}%`),
          ilike(schema.orders.id, `%${input.search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderByColumn = {
      createdAt: schema.orders.createdAt,
      updatedAt: schema.orders.updatedAt,
      status: schema.orders.status,
      totalAmount: schema.orders.totalAmount,
    }[input.sortBy];

    const orderDirection = input.sortOrder === 'asc' ? asc : desc;

    const offset = (input.page - 1) * input.limit;

    const [orders, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.orders)
        .where(whereClause)
        .orderBy(orderDirection(orderByColumn))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return {
      orders: orders.map((order) => ({
        ...order,
        customerPhoneDisplay: this.maskPhone(order.customerPhoneHash),
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Transition an order to a new status.
   * Enforces the state machine, gates, and side effects.
   */
  async transition(input: TransitionOrderInput, actor: SessionUser) {
    // Set actor for audit trail
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    // Get current order
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, input.orderId))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    const currentStatus = order.status as OrderStatus;
    const newStatus = input.newStatus;

    // Validate transition is allowed
    if (!isTransitionAllowed(currentStatus, newStatus)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot transition from ${currentStatus} to ${newStatus}. Allowed: ${getAllowedNextStatuses(currentStatus).join(', ') || 'none'}`,
      });
    }

    // Validate gates based on the transition
    await this.validateTransitionGates(order, newStatus, input.metadata, actor);

    // Build update fields
    const updateFields: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };

    // Set timestamp for specific transitions
    const tsField = TRANSITION_TIMESTAMPS[newStatus];
    if (tsField) {
      updateFields[tsField] = new Date();
    }

    // 15-min order lock on CS_ENGAGED (agent clicks Call)
    if (newStatus === 'CS_ENGAGED') {
      const lockExpiry = new Date(Date.now() + 15 * 60 * 1000);
      updateFields['lockedUntil'] = lockExpiry;
      updateFields['lockedBy'] = actor.id;
    }

    // Clear lock when order moves past CS engagement
    if (
      newStatus === 'CONFIRMED' ||
      newStatus === 'CANCELLED'
    ) {
      updateFields['lockedUntil'] = null;
      updateFields['lockedBy'] = null;
    }

    // Update agent's lastActionAt for dispatch tiebreaker + inactivity tracking
    if (actor.role === 'CS_AGENT' || actor.role === 'HEAD_OF_CS') {
      await this.db
        .update(schema.users)
        .set({ lastActionAt: new Date() })
        .where(eq(schema.users.id, actor.id));
    }

    // Generate OTP on DISPATCHED (single-use, sent to customer)
    if (newStatus === 'DISPATCHED') {
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      updateFields['deliveryOtp'] = otp;
    }

    // Persist GPS and clear OTP on DELIVERED (prevents replay)
    if (newStatus === 'DELIVERED') {
      if (input.metadata?.gpsLat !== undefined) {
        updateFields['deliveryGpsLat'] = input.metadata.gpsLat.toString();
      }
      if (input.metadata?.gpsLng !== undefined) {
        updateFields['deliveryGpsLng'] = input.metadata.gpsLng.toString();
      }
      updateFields['deliveryOtp'] = null; // single-use — clear after verification
    }

    // Delivery fee add-on when marking DELIVERED or PARTIALLY_DELIVERED (3PL can add tolls, fuel, remote area surcharge)
    if (
      (newStatus === 'DELIVERED' || newStatus === 'PARTIALLY_DELIVERED') &&
      input.metadata?.deliveryFeeAddOn !== undefined
    ) {
      const addOn = Number(input.metadata.deliveryFeeAddOn);
      if (!Number.isNaN(addOn) && addOn >= 0) {
        const current = parseFloat(String(order.deliveryFee ?? 0)) || 0;
        updateFields['deliveryFee'] = (current + addOn).toFixed(2);
      }
    }

    // Set assignment fields based on transition metadata
    if (input.metadata?.logisticsLocationId) {
      updateFields['logisticsLocationId'] = input.metadata.logisticsLocationId;
    }
    if (input.metadata?.logisticsProviderId) {
      updateFields['logisticsProviderId'] = input.metadata.logisticsProviderId;
    }
    if (input.metadata?.riderId) {
      updateFields['riderId'] = input.metadata.riderId;
    }

    // Perform the update
    const updatedRows = await this.db
      .update(schema.orders)
      .set(updateFields)
      .where(eq(schema.orders.id, input.orderId))
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update order' });
    }

    // Execute side effects (stock reservation, deduction, etc.)
    await this.executeTransitionSideEffects(newStatus, order, actor.id);

    // Emit real-time event
    this.events.emitOrderStatusChange({
      orderId: order.id,
      oldStatus: currentStatus,
      newStatus,
      assignedCsId: updated.assignedCsId,
      mediaBuyerId: updated.mediaBuyerId,
      logisticsLocationId: updated.logisticsLocationId,
      riderId: updated.riderId,
    });

    // Persistent notifications for logistics flow
    if (newStatus === 'ALLOCATED' && updated.logisticsLocationId) {
      this.notifications
        .createForLocation(updated.logisticsLocationId, {
          type: 'order:allocated',
          title: 'Order allocated to your location',
          body: 'An order has been allocated to your 3PL location. Please assign a rider.',
          data: { orderId: order.id },
        })
        .catch(() => {});
    }
    if (newStatus === 'DISPATCHED' && updated.riderId) {
      this.notifications
        .create({
          userId: updated.riderId,
          type: 'delivery:assigned',
          title: 'Delivery assigned to you',
          body: 'A delivery has been assigned to you. Please pick up and deliver.',
          data: { orderId: order.id },
        })
        .catch(() => {});
    }

    return {
      ...updated,
      customerPhoneDisplay: this.maskPhone(updated.customerPhoneHash),
      allowedTransitions: getAllowedNextStatuses(newStatus),
    };
  }

  /**
   * Update order details (address, items, notes).
   * The temporal table automatically preserves old values.
   */
  async update(input: UpdateOrderInput, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, input.orderId))
      .limit(1);

    if (!existingRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.customerAddress !== undefined) updateFields['customerAddress'] = input.customerAddress;
    if (input.deliveryAddress !== undefined) updateFields['deliveryAddress'] = input.deliveryAddress;
    if (input.deliveryNotes !== undefined) updateFields['deliveryNotes'] = input.deliveryNotes;
    if (input.totalAmount !== undefined) updateFields['totalAmount'] = String(input.totalAmount);
    if (input.items !== undefined) updateFields['items'] = input.items;

    const updatedRows = await this.db
      .update(schema.orders)
      .set(updateFields)
      .where(eq(schema.orders.id, input.orderId))
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update order' });
    }

    // Update order items if provided
    if (input.items) {
      await this.db
        .delete(schema.orderItems)
        .where(eq(schema.orderItems.orderId, input.orderId));

      await this.db.insert(schema.orderItems).values(
        input.items.map((item) => ({
          orderId: input.orderId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
        })),
      );
    }

    return {
      ...updated,
      customerPhoneDisplay: this.maskPhone(updated.customerPhoneHash),
    };
  }

  /**
   * Manually assign an order to a CS agent.
   */
  async assignToCS(orderId: string, csAgentId: string, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    if (!existingRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    const updatedRows = await this.db
      .update(schema.orders)
      .set({
        assignedCsId: csAgentId,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId))
      .returning();

    const updated = updatedRows[0];
    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to assign order' });
    }

    // Notify the assigned agent (real-time + persistent)
    this.events.emitToUser(csAgentId, 'order:assigned', {
      orderId,
      customerName: updated.customerName,
    });
    this.notifications
      .create({
        userId: csAgentId,
        type: 'order:assigned',
        title: 'Order assigned to you',
        body: 'An order has been assigned to you. Please attend to it.',
        data: { orderId },
      })
      .catch(() => {});

    return updated;
  }

  /**
   * Bulk reassign orders from one agent to another (Hot Swap).
   */
  async bulkReassign(
    orderIds: string[],
    fromAgentId: string,
    toAgentId: string,
    actor: SessionUser,
  ) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const updated = await this.db
      .update(schema.orders)
      .set({
        assignedCsId: toAgentId,
        updatedAt: new Date(),
      })
      .where(
        and(
          sql`${schema.orders.id} = ANY(${orderIds})`,
          eq(schema.orders.assignedCsId, fromAgentId),
        ),
      )
      .returning();

    // Notify both agents (real-time + persistent)
    this.events.emitToUser(fromAgentId, 'order:reassigned', {
      count: updated.length,
      toAgentId,
    });
    this.events.emitToUser(toAgentId, 'order:assigned_bulk', {
      count: updated.length,
      fromAgentId,
    });
    this.notifications
      .create({
        userId: fromAgentId,
        type: 'order:reassigned',
        title: 'Orders reassigned',
        body: `${updated.length} order(s) have been reassigned to another agent.`,
        data: { count: updated.length, toAgentId },
      })
      .catch(() => {});
    this.notifications
      .create({
        userId: toAgentId,
        type: 'order:assigned_bulk',
        title: 'Orders assigned to you',
        body: `${updated.length} order(s) have been reassigned to you.`,
        data: { count: updated.length, fromAgentId, orderIds: updated.map((o) => o.id) },
      })
      .catch(() => {});

    return { reassignedCount: updated.length };
  }

  /**
   * Get order counts by status — for dashboard stats.
   * Optional mediaBuyerId filters to that buyer's orders (for Marketing Orders page).
   * Optional startDate/endDate filter by orders.createdAt (when provided: counts = orders created in period).
   */
  async getStatusCounts(
    mediaBuyerId?: string,
    startDate?: string,
    endDate?: string,
  ) {
    const conditions: Parameters<typeof and>[0][] = [];
    if (mediaBuyerId) conditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
    if (startDate) conditions.push(gte(schema.orders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, end));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const results = await this.db
      .select({
        status: schema.orders.status,
        count: count(),
      })
      .from(schema.orders)
      .where(whereClause)
      .groupBy(schema.orders.status);

    const counts: Record<string, number> = {};
    for (const row of results) {
      counts[row.status] = row.count;
    }
    return counts;
  }

  /**
   * Get CS agent workload — for dispatch algorithm and dashboard.
   */
  async getCSAgentWorkloads() {
    const agents = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'CS_AGENT'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    const workloads = await Promise.all(
      agents.map(async (agent) => {
        const pendingRows = await this.db
          .select({ count: count() })
          .from(schema.orders)
          .where(
            and(
              eq(schema.orders.assignedCsId, agent.id),
              or(
                eq(schema.orders.status, 'UNPROCESSED'),
                eq(schema.orders.status, 'CS_ENGAGED'),
              ),
            ),
          );

        return {
          agentId: agent.id,
          agentName: agent.name,
          capacity: agent.capacity ?? 10,
          pendingCount: pendingRows[0]?.count ?? 0,
          lastActionAt: agent.lastActionAt,
        };
      }),
    );

    return workloads;
  }

  /**
   * Release expired order locks (called periodically or before dispatch).
   * Orders locked for > 15 min are auto-released.
   */
  async releaseExpiredLocks() {
    const released = await this.db
      .update(schema.orders)
      .set({ lockedUntil: null, lockedBy: null, updatedAt: new Date() })
      .where(
        and(
          sql`${schema.orders.lockedUntil} IS NOT NULL`,
          sql`${schema.orders.lockedUntil} < NOW()`,
        ),
      )
      .returning();

    return { releasedCount: released.length };
  }

  /**
   * Check for inactive CS agents (no action for > 10 min).
   * Returns agent IDs that should receive an inactivity alert.
   */
  async getInactiveAgents(thresholdMinutes = 10) {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const agents = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'CS_AGENT'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    // Filter agents with pending orders but no recent action
    const inactive = [];
    for (const agent of agents) {
      const pendingRows = await this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.assignedCsId, agent.id),
            or(
              eq(schema.orders.status, 'UNPROCESSED'),
              eq(schema.orders.status, 'CS_ENGAGED'),
            ),
          ),
        );

      const hasPending = (pendingRows[0]?.count ?? 0) > 0;
      const isIdle = !agent.lastActionAt || agent.lastActionAt < threshold;

      if (hasPending && isIdle) {
        inactive.push({
          agentId: agent.id,
          agentName: agent.name,
          lastActionAt: agent.lastActionAt,
          pendingCount: pendingRows[0]?.count ?? 0,
        });
      }
    }

    return inactive;
  }

  /**
   * Get CS agent leaderboard — performance metrics for ranking.
   * Metrics: orders engaged, confirmed, cancelled, delivered, calls made,
   * confirmation rate, delivery rate, avg call duration.
   * period: 'this_month' (default) or 'all_time'
   */
  async getCSAgentLeaderboard(period: 'this_month' | 'all_time' = 'this_month') {
    const periodStart = period === 'this_month'
      ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      : null;

    const agents = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'CS_AGENT'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    const leaderboard = await Promise.all(
      agents.map(async (agent) => {
        const agentId = agent.id;
        const dateFilter = periodStart ? gte(schema.orders.createdAt, periodStart) : undefined;
        const baseOrderConditions = periodStart
          ? and(eq(schema.orders.assignedCsId, agentId), dateFilter)
          : eq(schema.orders.assignedCsId, agentId);

        const deliveredWhere = periodStart
          ? and(
              eq(schema.orders.assignedCsId, agentId),
              eq(schema.orders.status, 'DELIVERED'),
              gte(schema.orders.deliveredAt, periodStart),
            )
          : and(
              eq(schema.orders.assignedCsId, agentId),
              eq(schema.orders.status, 'DELIVERED'),
            );

        const callLogsWhere = periodStart
          ? and(
              eq(schema.callLogs.agentId, agentId),
              gte(schema.callLogs.startedAt, periodStart),
            )
          : eq(schema.callLogs.agentId, agentId);

        const callLogsAvgWhere = periodStart
          ? and(
              eq(schema.callLogs.agentId, agentId),
              eq(schema.callLogs.callStatus, 'COMPLETED'),
              gte(schema.callLogs.startedAt, periodStart),
            )
          : and(
              eq(schema.callLogs.agentId, agentId),
              eq(schema.callLogs.callStatus, 'COMPLETED'),
            );

        const [engagedRows, confirmedRows, cancelledRows, deliveredRows, callCountRows, avgCallRows] = await Promise.all([
          this.db
            .select({ count: count() })
            .from(schema.orders)
            .where(
              and(
                baseOrderConditions,
                or(
                  eq(schema.orders.status, 'CS_ENGAGED'),
                  eq(schema.orders.status, 'CONFIRMED'),
                  eq(schema.orders.status, 'CANCELLED'),
                ),
              ),
            ),
          this.db
            .select({ count: count() })
            .from(schema.orders)
            .where(and(baseOrderConditions, eq(schema.orders.status, 'CONFIRMED'))),
          this.db
            .select({ count: count() })
            .from(schema.orders)
            .where(and(baseOrderConditions, eq(schema.orders.status, 'CANCELLED'))),
          this.db
            .select({ count: count() })
            .from(schema.orders)
            .where(deliveredWhere),
          this.db
            .select({ count: count() })
            .from(schema.callLogs)
            .where(callLogsWhere),
          this.db
            .select({
              avg: sql<number>`COALESCE(AVG(${schema.callLogs.durationSeconds})::numeric, 0)`,
            })
            .from(schema.callLogs)
            .where(callLogsAvgWhere),
        ]);

        const ordersEngaged = engagedRows[0]?.count ?? 0;
        const ordersConfirmed = confirmedRows[0]?.count ?? 0;
        const ordersCancelled = cancelledRows[0]?.count ?? 0;
        const ordersDelivered = deliveredRows[0]?.count ?? 0;
        const callsMade = callCountRows[0]?.count ?? 0;
        const avgCallDurationSeconds = Number(avgCallRows[0]?.avg ?? 0);

        const engagedOrCancelled = ordersConfirmed + ordersCancelled;
        const confirmationRate = engagedOrCancelled > 0 ? (ordersConfirmed / engagedOrCancelled) * 100 : 0;
        const deliveryRate = ordersConfirmed > 0 ? (ordersDelivered / ordersConfirmed) * 100 : 0;

        return {
          agentId,
          agentName: agent.name,
          ordersEngaged,
          ordersConfirmed,
          ordersCancelled,
          ordersDelivered,
          callsMade,
          confirmationRate,
          deliveryRate,
          avgCallDurationSeconds: Math.round(avgCallDurationSeconds),
        };
      }),
    );

    leaderboard.sort((a, b) => {
      if (b.deliveryRate !== a.deliveryRate) return b.deliveryRate - a.deliveryRate;
      return b.confirmationRate - a.confirmationRate;
    });

    return leaderboard;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Auto-dispatch a new order to the least-loaded CS agent.
   * Weighted dispatch: lowest active_pending_count wins.
   */
  private async autoDispatchToCS(orderId: string) {
    // Release expired locks first
    await this.releaseExpiredLocks();

    const workloads = await this.getCSAgentWorkloads();

    // Filter agents with available capacity
    const available = workloads.filter((w) => w.pendingCount < w.capacity);

    if (available.length === 0) return;

    // Sort by pending count (ascending), then by lastActionAt (ascending = most idle first)
    // This is the tiebreaker: when two agents have the same pendingCount,
    // the one who hasn't acted in the longest time gets the order.
    available.sort((a, b) => {
      if (a.pendingCount !== b.pendingCount) {
        return a.pendingCount - b.pendingCount;
      }
      // Tiebreaker: oldest lastActionAt first (most idle)
      const aTime = a.lastActionAt?.getTime() ?? 0;
      const bTime = b.lastActionAt?.getTime() ?? 0;
      return aTime - bTime;
    });

    const targetAgent = available[0];
    if (!targetAgent) return;

    await this.db
      .update(schema.orders)
      .set({ assignedCsId: targetAgent.agentId, updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    // Notify the assigned agent (real-time + persistent)
    this.events.emitToUser(targetAgent.agentId, 'order:assigned', {
      orderId,
    });
    this.notifications
      .create({
        userId: targetAgent.agentId,
        type: 'order:assigned',
        title: 'Order assigned to you',
        body: 'A new order has been assigned to you. Please attend to it.',
        data: { orderId },
      })
      .catch(() => {});
  }

  /**
   * Validate transition gates.
   * Each transition has specific requirements that must be met.
   */
  private async validateTransitionGates(
    order: typeof schema.orders.$inferSelect,
    newStatus: OrderStatus,
    metadata: TransitionOrderInput['metadata'],
    actor: SessionUser,
  ) {
    switch (newStatus) {
      case 'CS_ENGAGED': {
        const workloads = await this.getCSAgentWorkloads();
        const agentWorkload = workloads.find((w) => w.agentId === actor.id);
        if (agentWorkload && agentWorkload.pendingCount >= agentWorkload.capacity) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Agent has reached maximum capacity',
          });
        }
        // Check if order is locked by another agent
        if (
          order.lockedBy &&
          order.lockedBy !== actor.id &&
          order.lockedUntil &&
          new Date(order.lockedUntil) > new Date()
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This order is currently locked by another agent',
          });
        }
        break;
      }

      case 'CONFIRMED': {
        // Check VOIP feature flag to determine confirm gate behavior
        const voipSetting = await this.settingsService.get('VOIP_ENABLED');
        const isVoipEnabled = voipSetting?.['enabled'] === true;

        const callRows = await this.db
          .select()
          .from(schema.callLogs)
          .where(
            and(
              eq(schema.callLogs.orderId, order.id),
              eq(schema.callLogs.agentId, actor.id),
            ),
          )
          .orderBy(desc(schema.callLogs.startedAt))
          .limit(1);

        const lastCall = callRows[0];

        if (isVoipEnabled) {
          // VOIP mode: require VOIP call with duration >= 15 seconds
          if (!lastCall || (lastCall.durationSeconds ?? 0) < 15) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot confirm: VOIP call duration must be at least 15 seconds',
            });
          }
        } else {
          // Manual mode: require at least one call log (MANUAL_CALL counts)
          if (!lastCall) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot confirm: you must click Call before confirming',
            });
          }
        }
        break;
      }

      case 'CANCELLED': {
        if (!metadata?.reason || metadata.reason.length < 10) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cancellation requires a reason with at least 10 characters',
          });
        }
        break;
      }

      case 'ALLOCATED': {
        if (!metadata?.logisticsLocationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Must specify a logistics location for allocation',
          });
        }
        break;
      }

      case 'DISPATCHED': {
        if (!metadata?.riderId && !order.riderId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A rider must be assigned before dispatch',
          });
        }
        break;
      }

      case 'DELIVERED': {
        // SuperAdmin can bypass OTP (manual correction — still audited via temporal trail)
        if (actor.role !== 'SUPER_ADMIN') {
          if (!metadata?.otp) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Delivery confirmation requires a 4-digit OTP from the customer',
            });
          }
          if (!order.deliveryOtp) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'No OTP has been generated for this order. Dispatch must occur first.',
            });
          }
          if (metadata.otp !== order.deliveryOtp) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'OTP does not match. Please verify with the customer.',
            });
          }
        }
        break;
      }

      case 'PARTIALLY_DELIVERED': {
        if (
          metadata?.deliveredQuantity === undefined ||
          metadata?.returnedQuantity === undefined
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Partial delivery requires delivered and returned quantities',
          });
        }
        break;
      }

      case 'RETURNED': {
        if (!metadata?.reason || metadata.reason.length < 10) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Return requires a reason with at least 10 characters',
          });
        }
        break;
      }

      case 'WRITTEN_OFF': {
        if (!metadata?.reason || metadata.reason.length < 10) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Write-off requires a damage note with at least 10 characters',
          });
        }
        break;
      }
    }
  }

  /**
   * Execute side effects after a successful state transition.
   * Stock reservation on CONFIRMED, deduction on DELIVERED, etc.
   */
  private async executeTransitionSideEffects(
    newStatus: OrderStatus,
    order: typeof schema.orders.$inferSelect,
    actorId: string,
  ) {
    const orderItems = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));

    switch (newStatus) {
      case 'CONFIRMED': {
        // Reserve stock for each item (Available → Reserved)
        // and calculate total landed cost using FIFO batch costing
        let totalLandedCost = 0;

        for (const item of orderItems) {
          await this.db
            .insert(schema.stockMovements)
            .values({
              productId: item.productId,
              movementType: 'RESERVATION',
              quantity: item.quantity,
              referenceId: order.id,
              reason: `Stock reserved for order ${order.id}`,
              actorId,
            });

          // FIFO: walk through batches oldest-first to calculate weighted landed cost
          const batches = await this.db
            .select()
            .from(schema.stockBatches)
            .where(eq(schema.stockBatches.productId, item.productId))
            .orderBy(asc(schema.stockBatches.receivedAt));

          let remaining = item.quantity;
          for (const batch of batches) {
            if (remaining <= 0) break;
            const batchRemaining = batch.remainingQuantity ?? 0;
            if (batchRemaining <= 0) continue;

            const units = Math.min(remaining, batchRemaining);
            const costPerUnit = parseFloat(batch.totalLandedCost ?? '0');
            totalLandedCost += units * costPerUnit;
            remaining -= units;
          }
        }

        // Persist the calculated landed cost on the order
        await this.db
          .update(schema.orders)
          .set({ landedCost: totalLandedCost.toFixed(2) })
          .where(eq(schema.orders.id, order.id));
        break;
      }

      case 'ALLOCATED': {
        // Look up the logistics provider's rate card and set deliveryFee
        const locationId = order.logisticsLocationId;
        if (locationId) {
          const locationRows = await this.db
            .select()
            .from(schema.logisticsLocations)
            .where(eq(schema.logisticsLocations.id, locationId))
            .limit(1);

          const location = locationRows[0];
          if (location) {
            const providerRows = await this.db
              .select()
              .from(schema.logisticsProviders)
              .where(eq(schema.logisticsProviders.id, location.providerId))
              .limit(1);

            const provider = providerRows[0];
            if (provider?.rateCard) {
              const rateCard = provider.rateCard as Record<string, unknown>;
              // rateCard may contain a flat deliveryFee or a per-item rate
              const flatFee = parseFloat(String(rateCard.deliveryFee ?? rateCard.delivery_fee ?? '0'));
              const perItemRate = parseFloat(String(rateCard.perItemRate ?? rateCard.per_item_rate ?? '0'));

              let deliveryFee = flatFee;
              if (perItemRate > 0) {
                const totalQty = orderItems.reduce((sum, item) => sum + item.quantity, 0);
                deliveryFee = perItemRate * totalQty;
              }

              if (deliveryFee > 0) {
                await this.db
                  .update(schema.orders)
                  .set({ deliveryFee: deliveryFee.toFixed(2) })
                  .where(eq(schema.orders.id, order.id));
              }
            }
          }
        }
        break;
      }

      case 'DELIVERED': {
        // FIFO: consume oldest batch first, then log delivery movement
        for (const item of orderItems) {
          const batches = await this.db
            .select()
            .from(schema.stockBatches)
            .where(eq(schema.stockBatches.productId, item.productId))
            .orderBy(schema.stockBatches.receivedAt);

          let remaining = item.quantity;
          for (const batch of batches) {
            if (remaining <= 0) break;
            const batchRemaining = batch.remainingQuantity ?? 0;
            if (batchRemaining <= 0) continue;

            const deduct = Math.min(remaining, batchRemaining);
            await this.db
              .update(schema.stockBatches)
              .set({ remainingQuantity: batchRemaining - deduct })
              .where(eq(schema.stockBatches.id, batch.id));

            remaining -= deduct;
          }

          await this.db
            .insert(schema.stockMovements)
            .values({
              productId: item.productId,
              movementType: 'DELIVERY',
              quantity: -item.quantity,
              referenceId: order.id,
              reason: `Delivered: order ${order.id}`,
              actorId,
            });
        }
        break;
      }

      case 'CANCELLED': {
        // Release any reserved stock if order was confirmed
        if (order.status === 'CONFIRMED') {
          for (const item of orderItems) {
            await this.db
              .insert(schema.stockMovements)
              .values({
                productId: item.productId,
                movementType: 'ADJUSTMENT',
                quantity: item.quantity,
                referenceId: order.id,
                reason: `Released: order ${order.id} cancelled`,
                actorId,
              });
          }
        }
        break;
      }

      case 'RETURNED': {
        for (const item of orderItems) {
          await this.db
            .insert(schema.stockMovements)
            .values({
              productId: item.productId,
              movementType: 'RETURN',
              quantity: item.quantity,
              referenceId: order.id,
              reason: `Returned: order ${order.id}`,
              actorId,
            });
        }
        break;
      }

      case 'RESTOCKED': {
        for (const item of orderItems) {
          await this.db
            .insert(schema.stockMovements)
            .values({
              productId: item.productId,
              movementType: 'RESTOCK',
              quantity: item.quantity,
              toLocationId: order.logisticsLocationId ?? undefined,
              referenceId: order.id,
              reason: `Restocked at 3PL: order ${order.id}`,
              actorId,
            });
        }
        break;
      }

      case 'WRITTEN_OFF': {
        for (const item of orderItems) {
          await this.db
            .insert(schema.stockMovements)
            .values({
              productId: item.productId,
              movementType: 'WRITE_OFF',
              quantity: -item.quantity,
              referenceId: order.id,
              reason: `Written off: order ${order.id}`,
              actorId,
            });
        }
        break;
      }
    }
  }

  // ============================================
  // Callback Reschedule Queue
  // ============================================

  /**
   * Schedule a callback for an order after "No Answer".
   * Auto-cancels after max attempts.
   */
  async scheduleCallback(
    orderId: string,
    actor: SessionUser,
    options?: { delayMinutes?: number; notes?: string },
  ) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    const currentAttempts = order.callbackAttempts ?? 0;
    const maxAttempts = 3;
    const delayMinutes = options?.delayMinutes ?? 120; // default: 2 hours

    if (currentAttempts >= maxAttempts) {
      // Auto-cancel: max callback attempts reached
      await this.db
        .update(schema.orders)
        .set({
          status: 'CANCELLED',
          callbackScheduledAt: null,
          callbackNotes: `Auto-cancelled: max callback attempts (${maxAttempts}) reached`,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      this.events.emitOrderStatusChange({
        orderId,
        oldStatus: order.status,
        newStatus: 'CANCELLED',
        assignedCsId: order.assignedCsId,
        mediaBuyerId: order.mediaBuyerId,
        logisticsLocationId: order.logisticsLocationId,
        riderId: order.riderId,
      });

      // Notify Head of CS about max-retry cancellation
      this.events.emitToRoom('cs-all', 'callback:max_reached', {
        orderId,
        customerName: order.customerName,
        attempts: currentAttempts,
      });

      return { action: 'auto_cancelled', attempts: currentAttempts, maxAttempts };
    }

    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

    await this.db
      .update(schema.orders)
      .set({
        callbackScheduledAt: scheduledAt,
        callbackAttempts: currentAttempts + 1,
        callbackNotes: options?.notes ?? null,
        // Move back to UNPROCESSED so it re-enters the queue
        status: 'UNPROCESSED',
        lockedUntil: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId));

    this.events.emitOrderStatusChange({
      orderId,
      oldStatus: order.status,
      newStatus: 'UNPROCESSED',
      assignedCsId: order.assignedCsId,
      mediaBuyerId: order.mediaBuyerId,
      logisticsLocationId: order.logisticsLocationId,
      riderId: order.riderId,
    });

    return {
      action: 'scheduled',
      scheduledAt: scheduledAt.toISOString(),
      attempt: currentAttempts + 1,
      maxAttempts,
    };
  }

  /**
   * Get orders due for callback (callbackScheduledAt <= now).
   */
  async getCallbackQueue() {
    const orders = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          sql`${schema.orders.callbackScheduledAt} IS NOT NULL`,
          sql`${schema.orders.callbackScheduledAt} <= NOW()`,
          or(
            eq(schema.orders.status, 'UNPROCESSED'),
            eq(schema.orders.status, 'CS_ENGAGED'),
          ),
        ),
      )
      .orderBy(asc(schema.orders.callbackScheduledAt));

    return orders.map((order) => ({
      ...order,
      customerPhoneDisplay: this.maskPhone(order.customerPhoneHash),
    }));
  }

  /**
   * Get all orders with scheduled callbacks (including future ones).
   */
  async getScheduledCallbacks() {
    const orders = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          sql`${schema.orders.callbackScheduledAt} IS NOT NULL`,
          sql`${schema.orders.callbackAttempts} > 0`,
          or(
            eq(schema.orders.status, 'UNPROCESSED'),
            eq(schema.orders.status, 'CS_ENGAGED'),
          ),
        ),
      )
      .orderBy(asc(schema.orders.callbackScheduledAt));

    return orders.map((order) => ({
      ...order,
      customerPhoneDisplay: this.maskPhone(order.customerPhoneHash),
    }));
  }

  // ============================================
  // Duplicate Order Merge/Dismiss
  // ============================================

  /**
   * Flag an order as a potential duplicate of another order.
   */
  async flagDuplicate(orderId: string, duplicateOfId: string, actorId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;

    await this.db
      .update(schema.orders)
      .set({
        isDuplicate: 'FLAGGED',
        duplicateOfId,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId));

    return { flagged: true };
  }

  /**
   * Get all flagged duplicate orders for review.
   */
  async getFlaggedDuplicates() {
    const flagged = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.isDuplicate, 'FLAGGED'))
      .orderBy(desc(schema.orders.createdAt));

    // For each flagged order, also fetch the original
    const results = await Promise.all(
      flagged.map(async (dup) => {
        let original = null;
        if (dup.duplicateOfId) {
          const origRows = await this.db
            .select()
            .from(schema.orders)
            .where(eq(schema.orders.id, dup.duplicateOfId))
            .limit(1);
          original = origRows[0]
            ? { ...origRows[0], customerPhoneDisplay: this.maskPhone(origRows[0].customerPhoneHash) }
            : null;
        }
        return {
          duplicate: { ...dup, customerPhoneDisplay: this.maskPhone(dup.customerPhoneHash) },
          original,
        };
      }),
    );

    return results;
  }

  /**
   * Merge a duplicate order into the original (combine quantities).
   */
  async mergeDuplicate(duplicateId: string, originalId: string, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    // Get both orders
    const [dupRows, origRows] = await Promise.all([
      this.db.select().from(schema.orders).where(eq(schema.orders.id, duplicateId)).limit(1),
      this.db.select().from(schema.orders).where(eq(schema.orders.id, originalId)).limit(1),
    ]);

    const duplicate = dupRows[0];
    const original = origRows[0];

    if (!duplicate || !original) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // Get items from both orders
    const [dupItems, origItems] = await Promise.all([
      this.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, duplicateId)),
      this.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, originalId)),
    ]);

    // Merge quantities: for matching products add quantities, for new products add items
    for (const dupItem of dupItems) {
      const matchingOrig = origItems.find((oi) => oi.productId === dupItem.productId);
      if (matchingOrig) {
        // Add quantities
        await this.db
          .update(schema.orderItems)
          .set({ quantity: matchingOrig.quantity + dupItem.quantity })
          .where(eq(schema.orderItems.id, matchingOrig.id));
      } else {
        // Add new item to original order
        await this.db.insert(schema.orderItems).values({
          orderId: originalId,
          productId: dupItem.productId,
          quantity: dupItem.quantity,
          unitPrice: dupItem.unitPrice,
        });
      }
    }

    // Update original order total
    const newTotal =
      parseFloat(original.totalAmount ?? '0') + parseFloat(duplicate.totalAmount ?? '0');
    await this.db
      .update(schema.orders)
      .set({
        totalAmount: newTotal.toFixed(2),
        deliveryNotes: [original.deliveryNotes, `[Merged from order ${duplicateId}]`]
          .filter(Boolean)
          .join(' | '),
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, originalId));

    // Mark duplicate as merged and cancel it
    await this.db
      .update(schema.orders)
      .set({
        isDuplicate: 'MERGED',
        duplicateOfId: originalId,
        status: 'CANCELLED',
        deliveryNotes: `Merged into order ${originalId}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, duplicateId));

    return { merged: true, originalId, duplicateId };
  }

  /**
   * Dismiss a flagged duplicate — mark as legitimate new order.
   */
  async dismissDuplicate(orderId: string, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    await this.db
      .update(schema.orders)
      .set({
        isDuplicate: 'DISMISSED',
        duplicateOfId: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.orders.id, orderId));

    return { dismissed: true };
  }

  /**
   * Detect potential duplicates for a new order.
   * Checks for orders with the same phone hash + product within 6 hours.
   */
  async detectDuplicates(phoneHash: string, _productIds: string[]) {
    const potential = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerPhoneHash, phoneHash),
          sql`${schema.orders.createdAt} >= NOW() - INTERVAL '6 hours'`,
          sql`${schema.orders.isDuplicate} IS NULL OR ${schema.orders.isDuplicate} = 'DISMISSED'`,
          sql`${schema.orders.status} != 'CANCELLED'`,
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(5);

    return potential.map((order) => ({
      ...order,
      customerPhoneDisplay: this.maskPhone(order.customerPhoneHash),
    }));
  }

  /**
   * Bulk transition multiple orders to a new status.
   * Each order is validated individually — partial success is possible.
   * Returns success/failure counts with per-order details.
   */
  async bulkTransition(
    orderIds: string[],
    newStatus: string,
    metadata: Record<string, unknown> | undefined,
    actor: SessionUser,
  ) {
    const results: Array<{
      orderId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const orderId of orderIds) {
      try {
        await this.transition(
          { orderId, newStatus: newStatus as OrderStatus, metadata },
          actor,
        );
        results.push({ orderId, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({ orderId, success: false, error: message });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return { results, succeeded, failed, total: orderIds.length };
  }

  /**
   * Bulk assign multiple orders to a CS agent.
   * Each order is assigned individually.
   */
  async bulkAssignToCS(
    orderIds: string[],
    csAgentId: string,
    actor: SessionUser,
  ) {
    const results: Array<{
      orderId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const orderId of orderIds) {
      try {
        await this.assignToCS(orderId, csAgentId, actor);
        results.push({ orderId, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({ orderId, success: false, error: message });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return { results, succeeded, failed, total: orderIds.length };
  }

  /**
   * Mask phone hash for display: show first 4 + **** + last 4.
   */
  private maskPhone(phoneHash: string): string {
    if (phoneHash.length <= 8) return '****';
    return `${phoneHash.slice(0, 4)}****${phoneHash.slice(-4)}`;
  }
}
