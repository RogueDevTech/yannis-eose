import {
  createOrderSchema,
  createOfflineOrderSchema,
  EDGE_FORM_ACTOR_ID,
  transitionOrderSchema,
  updateOrderSchema,
  assignOrderSchema,
  bulkReassignSchema,
  listOrdersSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, permissionProcedure, publicProcedure } from '../trpc';
import { OrdersService } from '../../orders/orders.service';
import type { VoipService } from '../../voip/voip.service';

// We need to pass the service instance through context or create it inline.
// Since tRPC routers in this architecture are static, we use a factory pattern.
let ordersServiceInstance: OrdersService | null = null;
let voipServiceInstance: VoipService | null = null;

export function setOrdersService(service: OrdersService) {
  ordersServiceInstance = service;
}

export function setVoipService(service: VoipService) {
  voipServiceInstance = service;
}

function getOrdersService(): OrdersService {
  if (!ordersServiceInstance) {
    throw new Error('OrdersService not initialized. Call setOrdersService() first.');
  }
  return ordersServiceInstance;
}

function getVoipService(): VoipService {
  if (!voipServiceInstance) {
    throw new Error('VoipService not initialized. Call setVoipService() first.');
  }
  return voipServiceInstance;
}

export const ordersRouter = router({
  /**
   * Create a new order.
   * Public procedure — Edge Worker creates orders without auth.
   * When called by Edge Worker (source: edge-form), audit uses EDGE_FORM_ACTOR_ID.
   * When called by authenticated user, actor is tracked.
   */
  create: publicProcedure
    .input(createOrderSchema)
    .mutation(async ({ input, ctx }) => {
      const actorId =
        ctx.user?.id ??
        (input.source === 'edge-form' ? EDGE_FORM_ACTOR_ID : null);
      const source = input.source === 'edge-form' ? 'edge-form' : undefined;
      const { source: _source, cartId: _cartId, ...orderInput } = input;
      return getOrdersService().create(
        { ...orderInput, cartId: input.cartId },
        actorId,
        source,
      );
    }),

  /**
   * Create an offline order (CS manual entry). Creator is set as assignee. Any CS role can use (no permission required).
   */
  createOffline: authedProcedure
    .input(createOfflineOrderSchema)
    .mutation(async ({ input, ctx }) => {
      const allowedRoles = ['CS_AGENT', 'HEAD_OF_CS', 'SUPER_ADMIN'];
      if (!ctx.user?.id || !allowedRoles.includes(ctx.user.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only CS agents and Head of CS can create offline orders',
        });
      }
      return getOrdersService().createOffline(input, ctx.user.id);
    }),

  /**
   * Prepare Paystack payment (payment-first): do NOT create order.
   * Stores payload in Redis, returns Paystack authorization URL. Order is created only after payment in completePaymentByReference.
   * Public procedure — Edge Worker calls without auth when user selects Pay online.
   */
  preparePaystackOrder: publicProcedure
    .input(createOrderSchema)
    .mutation(async ({ input, ctx }) => {
      const actorId =
        ctx.user?.id ??
        (input.source === 'edge-form' ? EDGE_FORM_ACTOR_ID : null);
      return getOrdersService().preparePaystackOrder(
        { ...input, cartId: input.cartId },
        actorId,
      );
    }),

  /**
   * Allows orders.read (full access) or marketing.orders (own orders for Media Buyer, all for Head of Marketing).
   */
  getById: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const order = await getOrdersService().getById(input.orderId);
      if (ctx.user.role === 'SUPER_ADMIN') return order;
      const perms = ctx.user.permissions ?? [];
      const hasOrdersRead = perms.includes('orders.read');
      const hasMarketingOrders = perms.includes('marketing.orders');
      if (hasOrdersRead) return order;
      if (hasMarketingOrders) {
        if (ctx.user.role === 'HEAD_OF_MARKETING') return order;
        if (order.mediaBuyerId === ctx.user.id) return order;
      }
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to view this order',
      });
    }),

  /**
   * List orders with filtering and pagination.
   * Allows orders.read (full access) or marketing.orders (scoped: Media Buyer = own only, Head of Marketing = all).
   */
  list: authedProcedure
    .input(listOrdersSchema)
    .query(async ({ input, ctx }) => {
      if (ctx.user.role === 'SUPER_ADMIN') {
        return getOrdersService().list(input);
      }
      const perms = ctx.user.permissions ?? [];
      const hasOrdersRead = perms.includes('orders.read');
      const hasMarketingOrders = perms.includes('marketing.orders');
      if (!hasOrdersRead && !hasMarketingOrders) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Missing orders.read or marketing.orders permission',
        });
      }
      let effectiveInput = input;
      if (!hasOrdersRead && hasMarketingOrders && ctx.user.role === 'MEDIA_BUYER') {
        effectiveInput = { ...input, mediaBuyerId: ctx.user.id };
      }
      if (hasOrdersRead && ctx.user.role === 'CS_AGENT') {
        effectiveInput = { ...effectiveInput, assignedCsId: ctx.user.id };
      }
      return getOrdersService().list(effectiveInput);
    }),

  /**
   * Transition an order to a new status.
   * Enforces the state machine + gates.
   */
  transition: authedProcedure
    .input(transitionOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().transition(input, ctx.user);
    }),

  /**
   * Update order details (address, items, notes).
   */
  update: authedProcedure
    .input(updateOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().update(input, ctx.user);
    }),

  /**
   * Assign an order to a CS agent.
   * Restricted to Head of CS and SuperAdmin.
   */
  assignToCS: permissionProcedure('orders.reassign')
    .input(assignOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().assignToCS(input.orderId, input.csAgentId, ctx.user);
    }),

  /**
   * Bulk reassign orders (Hot Swap).
   * Restricted to Head of CS and SuperAdmin.
   */
  bulkReassign: permissionProcedure('orders.reassign')
    .input(bulkReassignSchema)
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().bulkReassign(
        input.orderIds,
        input.fromAgentId,
        input.toAgentId,
        ctx.user,
      );
    }),

  /**
   * Redistribute CS_ASSIGNED orders across agents (load-balanced or performance strategy).
   * Restricted to Head of CS and SuperAdmin.
   */
  redistributeCSOrders: permissionProcedure('orders.reassign').mutation(async ({ ctx }) => {
    return getOrdersService().redistributeCSOrders(ctx.user);
  }),

  /**
   * Redistribute one agent's CS_ASSIGNED and CS_ENGAGED orders to other agents (from CS Team page).
   * Restricted to Head of CS and SuperAdmin.
   */
  redistributeOrdersFromAgent: permissionProcedure('orders.reassign')
    .input(z.object({ agentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().redistributeOrdersFromAgent(input.agentId, ctx.user);
    }),

  /**
   * Distribute all UNPROCESSED (unassigned) orders to CS agents using the dispatch algorithm.
   * Manual fallback when auto-assignment on order creation did not run. Restricted to Head of CS and SuperAdmin.
   */
  distributeUnassignedOrders: permissionProcedure('orders.reassign').mutation(async ({ ctx }) => {
    return getOrdersService().distributeUnassignedOrders(ctx.user);
  }),

  /**
   * CS_AGENT can request for their assigned orders; HoS/SuperAdmin can request for any.
   */
  requestTransfer: permissionProcedure('orders.requestTransfer')
    .input(z.object({ orderId: z.string().uuid(), toCsAgentId: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().requestTransfer(input.orderId, input.toCsAgentId, ctx.user, input.reason);
    }),

  /**
   * Accept a transfer request (target agent or HoS/SuperAdmin).
   */
  acceptTransfer: authedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().acceptTransfer(input.requestId, ctx.user);
    }),

  /**
   * Reject a transfer request (target agent or HoS/SuperAdmin).
   */
  rejectTransfer: authedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().rejectTransfer(input.requestId, ctx.user);
    }),

  /**
   * List PENDING transfer requests where the current user is the target.
   */
  listTransferRequestsForMe: authedProcedure.query(async ({ ctx }) => {
    return getOrdersService().listTransferRequestsForMe(ctx.user);
  }),

  /**
   * List CS agents (id + name) for transfer dropdown. Requires orders.requestTransfer.
   */
  listCSAgents: permissionProcedure('orders.requestTransfer').query(async () => {
    return getOrdersService().listCSAgents();
  }),

  /**
   * Get order counts by status — for dashboard stats.
   * Optional mediaBuyerId filters to that buyer's orders (for Marketing Orders page).
   * Optional assignedCsId filters to that CS agent's orders (for CS Orders page).
   * Optional startDate/endDate filter by orders.createdAt.
   */
  statusCounts: authedProcedure
    .input(
      z
        .object({
          mediaBuyerId: z.string().uuid().optional(),
          assignedCsId: z.string().uuid().optional(),
          logisticsLocationId: z.string().uuid().optional(),
          startDate: z.string().date().optional(),
          endDate: z.string().date().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      return getOrdersService().getStatusCounts(
        input?.mediaBuyerId,
        input?.startDate,
        input?.endDate,
        input?.assignedCsId,
        input?.logisticsLocationId,
      );
    }),

  /**
   * Get CS agent workloads — for dispatch dashboard.
   * Restricted to Head of CS and SuperAdmin.
   */
  csWorkloads: permissionProcedure('orders.csWorkloads').query(async () => {
    return getOrdersService().getCSAgentWorkloads();
  }),

  /**
   * Get workload for the current CS agent — for \"My Orders\" page.
   * Non–CS agents receive null.
   */
  myCSWorkload: authedProcedure.query(async ({ ctx }) => {
    return getOrdersService().getMyCSWorkload(ctx.user);
  }),

  /**
   * Release expired order locks.
   * Can be called periodically or on-demand.
   */
  releaseExpiredLocks: permissionProcedure('orders.releaseLocks').mutation(async ({ ctx }) => {
    return getOrdersService().releaseExpiredLocks(ctx.user?.id ?? null);
  }),

  /**
   * Get inactive CS agents (no action for > threshold minutes).
   * Used by Head of CS to monitor agent activity.
   */
  inactiveAgents: permissionProcedure('orders.inactiveAgents')
    .input(z.object({ thresholdMinutes: z.number().min(1).default(10) }).optional())
    .query(async ({ input }) => {
      return getOrdersService().getInactiveAgents(input?.thresholdMinutes ?? 10);
    }),

  /**
   * Get CS agent leaderboard — performance metrics for ranking.
   * Restricted to Head of CS, SuperAdmin, and CS_AGENT (gamification).
   * period: 'this_month' (default) or 'all_time'
   */
  csLeaderboard: permissionProcedure('orders.csLeaderboard')
    .input(
      z.object({
        period: z.enum(['this_month', 'all_time']).optional().default('this_month'),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
      }),
    )
    .query(async ({ input }) =>
      getOrdersService().getCSAgentLeaderboard(
        input.period ?? 'this_month',
        input.startDate,
        input.endDate,
      ),
    ),

  // ── Manual Call (Relaxed Mode) ──────────────────────────────────

  /**
   * Reveal the customer phone number for manual calling.
   * Only works when Strict Data Mode is OFF.
   * Logs an audit record and returns the raw phone number.
   */
  revealPhoneForManualCall: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().revealPhoneForManualCall(input.orderId, ctx.user);
    }),

  // ── VOIP Procedures ────────────────────────────────────────────

  /**
   * Initiate a VOIP call for an order.
   * Agent must be assigned to the order (or HEAD_OF_CS / SUPER_ADMIN).
   * If the order is UNPROCESSED or CS_ASSIGNED, it is transitioned to CS_ENGAGED first, then the call is initiated.
   */
  initiateCall: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const order = await getOrdersService().getById(input.orderId);
      if (order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') {
        await getOrdersService().transition(
          { orderId: input.orderId, newStatus: 'CS_ENGAGED' },
          ctx.user,
        );
      }
      return getVoipService().initiateCall(input.orderId, ctx.user);
    }),

  /**
   * Get all call logs for a specific order.
   */
  getCallLogs: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVoipService().getCallLogsForOrder(input.orderId);
    }),

  /**
   * Get the latest (most recent) call for an order.
   */
  latestCall: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getVoipService().getLatestCallForOrder(input.orderId);
    }),

  // ── Callback Reschedule Queue ─────────────────────────────

  /**
   * Schedule a callback for an order after "No Answer".
   */
  scheduleCallback: authedProcedure
    .input(
      z.object({
        orderId: z.string().uuid(),
        delayMinutes: z.number().int().min(5).max(10080).optional(), // 5 min to 7 days
        notes: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().scheduleCallback(input.orderId, ctx.user, {
        delayMinutes: input.delayMinutes,
        notes: input.notes,
      });
    }),

  /**
   * Get orders due for callback (scheduled time has passed).
   */
  callbackQueue: permissionProcedure('orders.callbackQueue').query(async () => {
    return getOrdersService().getCallbackQueue();
  }),

  /**
   * Get all scheduled callbacks (including future).
   */
  scheduledCallbacks: permissionProcedure('orders.scheduledCallbacks').query(async () => {
    return getOrdersService().getScheduledCallbacks();
  }),

  // ── Duplicate Order Management ────────────────────────────

  /**
   * Get flagged duplicate orders for review.
   */
  flaggedDuplicates: permissionProcedure('orders.flaggedDuplicates').query(async () => {
    return getOrdersService().getFlaggedDuplicates();
  }),

  /**
   * Merge a duplicate order into the original.
   */
  mergeDuplicate: permissionProcedure('orders.mergeDuplicate')
    .input(
      z.object({
        duplicateId: z.string().uuid(),
        originalId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().mergeDuplicate(input.duplicateId, input.originalId, ctx.user);
    }),

  /**
   * Dismiss a flagged duplicate — mark as legitimate order.
   */
  dismissDuplicate: permissionProcedure('orders.dismissDuplicate')
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().dismissDuplicate(input.orderId, ctx.user);
    }),

  // ── Bulk Order Actions ─────────────────────────────────

  /**
   * Bulk transition multiple orders to a new status.
   * Each order validated individually — partial success allowed.
   */
  bulkTransition: permissionProcedure('orders.bulkTransition')
    .input(
      z.object({
        orderIds: z.array(z.string().uuid()).min(1).max(100),
        newStatus: z.string(),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().bulkTransition(
        input.orderIds,
        input.newStatus,
        input.metadata,
        ctx.user,
      );
    }),

  /**
   * Bulk assign multiple orders to a CS agent.
   */
  bulkAssignToCS: permissionProcedure('orders.bulkAssign')
    .input(
      z.object({
        orderIds: z.array(z.string().uuid()).min(1).max(100),
        csAgentId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().bulkAssignToCS(
        input.orderIds,
        input.csAgentId,
        ctx.user,
      );
    }),
});
