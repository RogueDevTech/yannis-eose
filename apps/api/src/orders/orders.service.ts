import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, asc, sql, ilike, or, count } from 'drizzle-orm';
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
import {
  isTransitionAllowed,
  getAllowedNextStatuses,
  TRANSITION_TIMESTAMPS,
} from './order-state-machine';
import type { SessionUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly events: EventsService,
  ) {}

  /**
   * Create a new order with status UNPROCESSED.
   * Called by Edge Worker or admin manual entry.
   */
  async create(input: CreateOrderInput, actorId: string | null) {
    // Set actor for audit trail
    if (actorId) {
      await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;
    }

    const rows = await this.db
      .insert(schema.orders)
      .values({
        campaignId: input.campaignId ?? null,
        mediaBuyerId: input.mediaBuyerId ?? null,
        customerName: input.customerName,
        customerPhoneHash: input.customerPhoneHash,
        customerAddress: input.customerAddress ?? null,
        deliveryAddress: input.deliveryAddress ?? null,
        deliveryNotes: input.deliveryNotes ?? null,
        items: input.items,
        totalAmount: input.totalAmount ?? null,
        status: 'UNPROCESSED',
      })
      .returning();

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create order' });
    }

    // Create order items
    if (input.items.length > 0) {
      await this.db.insert(schema.orderItems).values(
        input.items.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      );
    }

    // Emit real-time event for CS dispatch
    this.events.emitNewOrder({
      orderId: order.id,
      productName: 'Order created',
    });

    // Auto-dispatch to least-loaded CS agent
    await this.autoDispatchToCS(order.id);

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

    // Execute side effects
    await this.executeTransitionSideEffects(newStatus);

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
    if (input.totalAmount !== undefined) updateFields['totalAmount'] = input.totalAmount;
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
          unitPrice: item.unitPrice,
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

    // Notify the assigned agent
    this.events.emitToUser(csAgentId, 'order:assigned', {
      orderId,
      customerName: updated.customerName,
    });

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

    // Notify both agents
    this.events.emitToUser(fromAgentId, 'order:reassigned', {
      count: updated.length,
      toAgentId,
    });
    this.events.emitToUser(toAgentId, 'order:assigned_bulk', {
      count: updated.length,
      fromAgentId,
    });

    return { reassignedCount: updated.length };
  }

  /**
   * Get order counts by status — for dashboard stats.
   */
  async getStatusCounts() {
    const results = await this.db
      .select({
        status: schema.orders.status,
        count: count(),
      })
      .from(schema.orders)
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
        };
      }),
    );

    return workloads;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Auto-dispatch a new order to the least-loaded CS agent.
   * Weighted dispatch: lowest active_pending_count wins.
   */
  private async autoDispatchToCS(orderId: string) {
    const workloads = await this.getCSAgentWorkloads();

    // Filter agents with available capacity
    const available = workloads.filter((w) => w.pendingCount < w.capacity);

    if (available.length === 0) return;

    // Sort by pending count (ascending) — least loaded first
    available.sort((a, b) => a.pendingCount - b.pendingCount);

    const targetAgent = available[0];
    if (!targetAgent) return;

    await this.db
      .update(schema.orders)
      .set({ assignedCsId: targetAgent.agentId, updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    // Notify the assigned agent
    this.events.emitToUser(targetAgent.agentId, 'order:assigned', {
      orderId,
    });
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
        break;
      }

      case 'CONFIRMED': {
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
        if (!lastCall || (lastCall.durationSeconds ?? 0) < 15) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot confirm: VOIP call duration must be at least 15 seconds',
          });
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
   * Stock reservation, deduction, commission triggers etc. will be
   * implemented when those modules are built.
   */
  private async executeTransitionSideEffects(
    _newStatus: OrderStatus,
  ) {
    // Side effects will be wired up as inventory/finance modules are built.
    // The temporal audit trail handles change tracking automatically.
  }

  /**
   * Mask phone hash for display: show first 4 + **** + last 4.
   */
  private maskPhone(phoneHash: string): string {
    if (phoneHash.length <= 8) return '****';
    return `${phoneHash.slice(0, 4)}****${phoneHash.slice(-4)}`;
  }
}
