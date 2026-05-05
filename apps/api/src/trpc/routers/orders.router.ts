import {
  createOrderSchema,
  createOfflineOrderSchema,
  EDGE_FORM_ACTOR_ID,
  transitionOrderSchema,
  updateOrderSchema,
  requestOrderLinePriceChangeSchema,
  requestOrderDeletionSchema,
  assignOrderSchema,
  bulkReassignSchema,
  listOrdersSchema,
  scheduleCalendarHeatSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, permissionProcedure, publicProcedure } from '../trpc';
import { getBranchTeamsService } from './branches.router';
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

/** Exported for cross-router reads that must share the same `OrdersService` singleton (e.g. finance invoice gates). */
export function getOrdersService(): OrdersService {
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

/**
 * Session branch for orders list / statusCounts / timeSeries: non-null = restrict to that branch;
 * null = org-wide (all branches). Applies to admin-class and org-wide department heads the same
 * as everyone else — previously these roles forced null and ignored the branch switcher.
 */
function orderListBranchId(_user: { role: string }, sessionBranchId: string | null): string | null {
  return sessionBranchId;
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
   * Create an offline order (CS manual entry). Creator is set as assignee.
   * Phase 21: gated by `orders.createOffline` permission so a custom role can be granted just this capability
   * without inheriting all of CS_AGENT.
   */
  createOffline: permissionProcedure('orders.createOffline')
    .meta({ branchScopedMutation: true })
    .input(createOfflineOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...offlineInput } = input;
      return getOrdersService().createOffline(offlineInput, ctx.user.id, branchId ?? ctx.currentBranchId);
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
      getOrdersService().assertActorMayViewOrderForRead(ctx.user, order);
      const ob = order.branchId ?? null;
      const as = order.assignedCsId ?? null;
      const cb = ctx.user.currentBranchId ?? null;
      const [viewerCanEditOrderLinePrices, viewerIsCsTeamSupervisor] = await Promise.all([
        getOrdersService().canActorEditOrderLinePrices(ctx.user, { branchId: ob, assignedCsId: as }),
        ob && cb === ob
          ? as
            ? getOrdersService().isActorCsTeamSupervisor(ctx.user.id, as, ob)
            : getBranchTeamsService().isActorCsSupervisorOnBranch(ctx.user.id, ob)
          : Promise.resolve(false),
      ]);
      return { ...order, viewerCanEditOrderLinePrices, viewerIsCsTeamSupervisor };
    }),

  listAllocatableLocations: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().listAllocatableLocations(input.orderId, ctx.user.role);
    }),

  /**
   * List orders with filtering and pagination.
   * Allows:
   * - orders.read (full access)
   * - marketing.orders (scoped: Media Buyer = own only, Head of Marketing = all)
   * - logistics.read (logistics lists)
   */
  list: authedProcedure
    .input(listOrdersSchema)
    .query(async ({ input, ctx }) => {
      const branchId = orderListBranchId(ctx.user, ctx.currentBranchId);
      if (ctx.user.role === 'SUPER_ADMIN') {
        return getOrdersService().list(input, branchId);
      }
      const perms = ctx.user.permissions ?? [];
      const hasOrdersRead = perms.includes('orders.read');
      const hasMarketingOrders = perms.includes('marketing.orders');
      const hasLogisticsRead = perms.includes('logistics.read');
      // Org-wide scope holders see everything (admin via ALL_PERMISSION_CODES, org-wide heads via *.scope.global).
      const hasOrgWideScope =
        perms.includes('cs.scope.global') ||
        perms.includes('marketing.scope.global') ||
        perms.includes('logistics.scope.global');
      if (!hasOrdersRead && !hasMarketingOrders && !hasLogisticsRead && !hasOrgWideScope) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Missing orders.read, marketing.orders, or logistics.read permission',
        });
      }
      if (hasOrgWideScope) {
        return getOrdersService().list(input, branchId);
      }
      let effectiveInput = input;
      if (!hasOrdersRead && hasMarketingOrders && ctx.user.role === 'MEDIA_BUYER') {
        effectiveInput = { ...input, mediaBuyerId: ctx.user.id };
      }
      if (hasOrdersRead && ctx.user.role === 'CS_AGENT') {
        effectiveInput = { ...effectiveInput, assignedCsId: ctx.user.id };
      }
      return getOrdersService().list(effectiveInput, branchId);
    }),

  /**
   * CS schedule calendar: per-day callback + ISO delivery-date counts (Africa/Lagos for callbacks).
   * Same auth / branch / CS_AGENT / Media Buyer scoping as `orders.list`.
   */
  scheduleCalendarHeat: authedProcedure
    .input(scheduleCalendarHeatSchema)
    .query(async ({ input, ctx }) => {
      const branchId = orderListBranchId(ctx.user, ctx.currentBranchId);
      if (ctx.user.role === 'SUPER_ADMIN') {
        return getOrdersService().scheduleCalendarHeat(input, branchId);
      }
      const perms = ctx.user.permissions ?? [];
      const hasOrdersRead = perms.includes('orders.read');
      const hasMarketingOrders = perms.includes('marketing.orders');
      const hasLogisticsRead = perms.includes('logistics.read');
      const hasOrgWideScope =
        perms.includes('cs.scope.global') ||
        perms.includes('marketing.scope.global') ||
        perms.includes('logistics.scope.global');
      if (!hasOrdersRead && !hasMarketingOrders && !hasLogisticsRead && !hasOrgWideScope) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Missing orders.read, marketing.orders, or logistics.read permission',
        });
      }
      if (hasOrgWideScope) {
        return getOrdersService().scheduleCalendarHeat(input, branchId);
      }
      let effectiveInput = input;
      if (!hasOrdersRead && hasMarketingOrders && ctx.user.role === 'MEDIA_BUYER') {
        effectiveInput = { ...input, mediaBuyerId: ctx.user.id };
      }
      if (hasOrdersRead && ctx.user.role === 'CS_AGENT') {
        effectiveInput = { ...effectiveInput, assignedCsId: ctx.user.id };
      }
      return getOrdersService().scheduleCalendarHeat(effectiveInput, branchId);
    }),

  /**
   * Transition an order to a new status.
   * Enforces the state machine + gates.
   */
  transition: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(transitionOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...transitionInput } = input;
      return getOrdersService().transition(transitionInput, ctx.user);
    }),

  /**
   * Update order details (address, items, notes).
   */
  update: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(updateOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...updateInput } = input;
      return getOrdersService().update(updateInput, ctx.user);
    }),

  /**
   * Submit proposed line prices for approval (actors who cannot apply prices via `orders.update`).
   */
  requestLinePriceChangeApproval: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(requestOrderLinePriceChangeSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...body } = input;
      return getOrdersService().requestLinePriceChangeApproval(body, ctx.user);
    }),

  /**
   * Request soft-delete (archive) approval — CS and others without direct archive authority.
   */
  requestOrderDeletionApproval: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(requestOrderDeletionSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...body } = input;
      return getOrdersService().requestOrderDeletionApproval(body, ctx.user);
    }),

  /**
   * Soft-delete (archive) immediately — Head of CS / HoLogistics / Branch Admin / supervisors / admins.
   */
  softDeleteOrder: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(requestOrderDeletionSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, reason, orderId } = input;
      return getOrdersService().softDeleteOrder(orderId, ctx.user, { approverNote: reason });
    }),

  /**
   * Assign an order to a CS agent.
   * `orders.reassign` (HoCS / Admin) or branch CS team supervisor for in-team agents (UNPROCESSED / CS_ASSIGNED only).
   */
  assignToCS: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(assignOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().assignToCS(input.orderId, input.csAgentId, ctx.user);
    }),

  /**
   * Bulk reassign orders (Hot Swap).
   * Restricted to Head of CS and SuperAdmin.
   */
  bulkReassign: permissionProcedure('orders.reassign')
    .meta({ branchScopedMutation: true })
    .input(bulkReassignSchema.extend({ branchId: z.string().uuid().optional() }))
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
    .meta({ branchScopedMutation: true })
    .input(z.object({ agentId: z.string().uuid(), branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().redistributeOrdersFromAgent(input.agentId, ctx.user);
    }),

  /**
   * Distribute all UNPROCESSED (unassigned) orders to CS agents using the dispatch algorithm.
   * Manual fallback when auto-assignment on order creation did not run. Restricted to Head of CS and SuperAdmin.
   */
  distributeUnassignedOrders: permissionProcedure('orders.reassign')
    .meta({ branchScopedMutation: true })
    .input(z.object({ branchId: z.string().uuid().optional() }).optional())
    .mutation(async ({ ctx }) => {
      return getOrdersService().distributeUnassignedOrders(ctx.user);
    }),

  /**
   * List CS agents for assign dropdowns — full roster with `orders.reassign`, else supervised team agents only.
   */
  listCSAgents: authedProcedure.query(async ({ ctx }) => {
    return getOrdersService().listCSAgents(ctx.user);
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
          statuses: z.array(z.enum([
            'UNPROCESSED',
            'CS_ASSIGNED',
            'CS_ENGAGED',
            'CONFIRMED',
            'CANCELLED',
            'AGENT_ASSIGNED',
            'DISPATCHED',
            'IN_TRANSIT',
            'DELIVERED',
            'PARTIALLY_DELIVERED',
            'RETURNED',
            'RESTOCKED',
            'WRITTEN_OFF',
            'REMITTED',
          ])).min(1).optional(),
          startDate: z.string().date().optional(),
          endDate: z.string().date().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return getOrdersService().getStatusCounts(
        input?.mediaBuyerId,
        input?.startDate,
        input?.endDate,
        input?.assignedCsId,
        input?.logisticsLocationId,
        orderListBranchId(ctx.user, ctx.currentBranchId),
        input?.statuses,
      );
    }),

  /**
   * Daily order volume (by `created_at`) plus delivered count (by `delivered_at`, DELIVERED only)
   * for the "View data in chart" trend on Marketing / CS / Logistics order lists. Mirrors the
   * same scoping filters as `statusCounts`.
   * Returns: [{ date: 'YYYY-MM-DD', orderCount, deliveredCount }] sorted ascending by date.
   */
  timeSeriesByCreated: authedProcedure
    .input(
      z
        .object({
          mediaBuyerId: z.string().uuid().optional(),
          assignedCsId: z.string().uuid().optional(),
          logisticsLocationId: z.string().uuid().optional(),
          status: z.string().optional(),
          statuses: z.array(z.enum([
            'UNPROCESSED',
            'CS_ASSIGNED',
            'CS_ENGAGED',
            'CONFIRMED',
            'CANCELLED',
            'AGENT_ASSIGNED',
            'DISPATCHED',
            'IN_TRANSIT',
            'DELIVERED',
            'PARTIALLY_DELIVERED',
            'RETURNED',
            'RESTOCKED',
            'WRITTEN_OFF',
            'REMITTED',
          ])).min(1).optional(),
          startDate: z.string().date().optional(),
          endDate: z.string().date().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return getOrdersService().getOrdersTimeSeriesByCreated(
        input?.startDate,
        input?.endDate,
        orderListBranchId(ctx.user, ctx.currentBranchId),
        {
          mediaBuyerId: input?.mediaBuyerId,
          csAgentId: input?.assignedCsId,
          logisticsLocationId: input?.logisticsLocationId,
          status: input?.status,
          statuses: input?.statuses,
        },
      );
    }),

  /**
   * Get CS agent workloads — for dispatch dashboard.
   * Restricted to Head of CS and SuperAdmin.
   */
  csWorkloads: permissionProcedure('orders.csWorkloads').query(async ({ ctx }) => {
    return getOrdersService().getCSAgentWorkloads(ctx.currentBranchId);
  }),

  /**
   * Pending orders + line items for one closer (CS queue workload modal).
   */
  closerWorkloadOrders: permissionProcedure('orders.csWorkloads')
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().getCloserWorkloadOrdersWithItems(input.agentId, ctx.currentBranchId);
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
    .meta({ branchScopedMutation: true })
    .input(z.object({ orderId: z.string().uuid(), branchId: z.string().uuid().optional() }))
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
    .meta({ branchScopedMutation: true })
    .input(
      z.object({
        orderId: z.string().uuid(),
        delayMinutes: z.number().int().min(5).max(10080).optional(), // 5 min to 7 days
        notes: z.string().max(500).optional(),
        branchId: z.string().uuid().optional(),
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
    .meta({ branchScopedMutation: true })
    .input(
      z.object({
        duplicateId: z.string().uuid(),
        originalId: z.string().uuid(),
        branchId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().mergeDuplicate(input.duplicateId, input.originalId, ctx.user);
    }),

  /**
   * Dismiss a flagged duplicate — mark as legitimate order.
   */
  dismissDuplicate: permissionProcedure('orders.dismissDuplicate')
    .meta({ branchScopedMutation: true })
    .input(z.object({ orderId: z.string().uuid(), branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().dismissDuplicate(input.orderId, ctx.user);
    }),

  // ── Bulk Order Actions ─────────────────────────────────

  /**
   * Bulk transition multiple orders to a new status.
   * Each order validated individually — partial success allowed.
   */
  bulkTransition: permissionProcedure('orders.bulkTransition')
    .meta({ branchScopedMutation: true })
    .input(
      z.object({
        orderIds: z.array(z.string().uuid()).min(1).max(100),
        newStatus: z.string(),
        metadata: z.record(z.unknown()).optional(),
        branchId: z.string().uuid().optional(),
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
   * Bulk assign multiple orders to a CS agent (same gates as assignToCS).
   */
  bulkAssignToCS: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(
      z.object({
        orderIds: z.array(z.string().uuid()).min(1).max(100),
        csAgentId: z.string().uuid(),
        branchId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().bulkAssignToCS(
        input.orderIds,
        input.csAgentId,
        ctx.user,
      );
    }),

  // ── Order Timeline ─────────────────────────────────────

  /**
   * Get the timeline of events for a specific order.
   * Role-filtered: CS agents only see CS-relevant events; Logistics only see logistics events; etc.
   * Requires orders.read or marketing.orders permission.
   */
  getTimeline: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().getOrderTimeline(input.orderId, ctx.user);
    }),

  // ── Claim Mode ────────────────────────────────────────

  /**
   * Get the claim queue — UNPROCESSED orders available for CS agents to claim.
   * Only relevant when CS_DISPATCH_STRATEGY = 'claim'.
   */
  claimQueue: permissionProcedure('orders.read')
    .query(async () => {
      return getOrdersService().getClaimQueue();
    }),

  /**
   * Claim an order from the claim queue. Atomic — only one agent can claim at a time.
   */
  claimOrder: permissionProcedure('orders.read')
    .meta({ branchScopedMutation: true })
    .input(z.object({ orderId: z.string().uuid(), branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().claimOrder(input.orderId, ctx.user);
    }),
});
