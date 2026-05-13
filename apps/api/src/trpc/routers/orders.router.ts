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
  createCsRoutingRuleSchema,
  updateCsRoutingRuleSchema,
  deleteCsRoutingRuleSchema,
  listCsRoutingRulesSchema,
  getCsRoutingBranchSettingsSchema,
  setCsRoutingRelationshipModeSchema,
  type ListOrdersInput,
  type ScheduleCalendarHeatInput,
  type OrderStatus,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { canonicalPermissionCode } from '@yannis/shared';
import { router, authedProcedure, permissionProcedure, publicProcedure } from '../trpc';
import { getBranchTeamsService } from './branches.router';
import { getUsersService } from './users.router';
import { getProductsService } from './products.router';
import { getLogisticsService } from './logistics.router';
import { getInventoryService } from './inventory.router';
import {
  OrdersService,
  type OrdersAggregateSupervisorScope,
} from '../../orders/orders.service';
import { CsOrderRoutingService } from '../../orders/cs-order-routing.service';
import type { VoipService } from '../../voip/voip.service';
import { isAdminLevel } from '../../common/authz';
import type { SessionUser } from '../../common/decorators/current-user.decorator';
import { CacheService } from '../../common/cache/cache.service';

// We need to pass the service instance through context or create it inline.
// Since tRPC routers in this architecture are static, we use a factory pattern.
let ordersServiceInstance: OrdersService | null = null;
let voipServiceInstance: VoipService | null = null;
let ordersCacheService: CacheService | null = null;
let csOrderRoutingInstance: CsOrderRoutingService | null = null;

export function setOrdersService(service: OrdersService) {
  ordersServiceInstance = service;
}

export function setCsOrderRoutingService(service: CsOrderRoutingService) {
  csOrderRoutingInstance = service;
}

export function setVoipService(service: VoipService) {
  voipServiceInstance = service;
}

export function setOrdersCacheService(service: CacheService) {
  ordersCacheService = service;
}

const ORDERS_AGG_TTL_SECONDS = 15;

async function invalidateOrdersAggregatesCache(): Promise<void> {
  if (!ordersCacheService) return;
  await ordersCacheService.delPattern('cache:orders:aggregates:*').catch(() => {});
}

/**
 * Drop the cached `orders.getById` payload for a single order. Must be called
 * by every mutation that changes order state, items, assignments, callbacks,
 * remittances, or any field surfaced in the order-detail UI.
 *
 * The cache key is built by `OrdersService.buildOrderDetailCacheKey` so the
 * service and router stay aligned without exporting the prefix.
 */
async function invalidateOrderDetailCache(orderId: string | null | undefined): Promise<void> {
  if (!ordersCacheService || !orderId) return;
  await ordersCacheService
    .del(OrdersService.buildOrderDetailCacheKey(orderId))
    .catch(() => {});
}

/**
 * Drop the cached `orders.getById` payloads for many orders at once — used by
 * bulk mutations (`bulkTransition`, `bulkReassign`, `bulkAssignToCS`,
 * `redistributeOrdersFromAgent`, `distributeUnassignedOrders`,
 * `redistributeCSOrders`).
 */
async function invalidateOrderDetailCacheMany(orderIds: ReadonlyArray<string>): Promise<void> {
  if (!ordersCacheService || orderIds.length === 0) return;
  await Promise.all(orderIds.map((id) => invalidateOrderDetailCache(id)));
}

/**
 * Wipe every per-order detail cache entry. Used as the safe fallback when a
 * bulk mutation does not return the precise list of touched orders (e.g.
 * `redistributeCSOrders`, `releaseExpiredLocks`).
 */
async function invalidateAllOrderDetailCache(): Promise<void> {
  if (!ordersCacheService) return;
  await ordersCacheService.delPattern('cache:orders:detail:*').catch(() => {});
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

function getCsOrderRoutingService(): CsOrderRoutingService {
  if (!csOrderRoutingInstance) {
    throw new Error('CsOrderRoutingService not initialized. Call setCsOrderRoutingService() first.');
  }
  return csOrderRoutingInstance;
}

/** HoCS / Branch Admin branch scope for CS routing settings (mirrors CsOrderRoutingService). */
function assertCsRoutingBranchAccess(actor: SessionUser, ownerBranchId: string): void {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN') return;
  if (actor.role === 'HEAD_OF_CS') return;
  if (actor.role === 'BRANCH_ADMIN') {
    if (!actor.currentBranchId || actor.currentBranchId !== ownerBranchId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Branch admins may only access CS routing for their active branch.',
      });
    }
    return;
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to access CS order routing' });
}

/**
 * Session branch for orders list / statusCounts / timeSeries: non-null = restrict to that branch;
 * null = org-wide (all branches). Applies to admin-class and org-wide department heads the same
 * as everyone else — previously these roles forced null and ignored the branch switcher.
 */

function csCloserSelfQueueListOpts(
  user: { id: string; role: string },
  input: { assignedCsId?: string },
):
  | { assignedCloserViewerId: string }
  | undefined {
  if (user.role === 'CS_CLOSER' && input.assignedCsId === user.id) {
    return { assignedCloserViewerId: user.id };
  }
  return undefined;
}

/** CS / ops list: self-queue pin + optional customer_phone substring search (orders.read holders). */
export function buildOrdersListOpts(
  user: SessionUser,
  input: Partial<Pick<ListOrdersInput, 'assignedCsId'>> = {},
): { assignedCloserViewerId?: string; searchIncludeCustomerPhone?: boolean } | undefined {
  const closer = csCloserSelfQueueListOpts(user, input);
  const perms = user.permissions ?? [];
  // Session stamps canonical codes (`orders.view`); legacy snapshots may still hold `orders.read`.
  const searchIncludeCustomerPhone =
    perms.some((p) => canonicalPermissionCode(p) === 'orders.view') || isAdminLevel(user);
  const out: { assignedCloserViewerId?: string; searchIncludeCustomerPhone?: boolean } = {};
  if (closer) Object.assign(out, closer);
  if (searchIncludeCustomerPhone) out.searchIncludeCustomerPhone = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

function orderListBranchId(_user: { role: string }, sessionBranchId: string | null): string | null {
  return sessionBranchId;
}

/** Mirrors Remix `requirePermissionOrRoles` on `/admin/inventory` for movement customer labels. */
function canAccessDeliveryMovementCustomerNames(user: SessionUser): boolean {
  if (isAdminLevel(user)) return true;
  if (user.role === 'HEAD_OF_MARKETING' || user.role === 'HEAD_OF_CS') return true;
  const inv = canonicalPermissionCode('inventory.read');
  return (user.permissions ?? []).some((p) => canonicalPermissionCode(p) === inv);
}

/**
 * Phase B supervisor scoping: when the viewer is a non-org-wide branch supervisor
 * on the active branch, restrict the list to:
 *   - orders **assigned to** their CS team members (assignedCsIds), AND
 *   - orders **created by** their MB team members (mediaBuyerIds).
 * Org-wide scope, admin-class, and the role-restricted CS_CLOSER / MEDIA_BUYER
 * paths short-circuit before this helper. Their own id is always in the set so
 * a supervisor still sees their own work.
 *
 * Returns the input unchanged when there's no active branch or the viewer is
 * not a supervisor on it.
 */
/** Inputs that accept router-injected `supervisorScope` (`orders.list`, `scheduleCalendarHeat`). */
export type SupervisorScopeListInput = ListOrdersInput | ScheduleCalendarHeatInput;

/** Exported for marketing page bundles that call `OrdersService.list` with the same narrowing as `orders.list`. */
export async function applySupervisorScope<T extends SupervisorScopeListInput>(
  ctx: { user: SessionUser; currentBranchId: string | null },
  input: T,
  branchId: string | null,
): Promise<T> {
  if (!branchId) return input;
  if (input.supervisorScope) return input; // explicit override wins
  const perms = ctx.user.permissions ?? [];
  const hasOrgWideScope =
    perms.includes('cs.scope.global') ||
    perms.includes('marketing.scope.global') ||
    perms.includes('logistics.scope.global');
  if (hasOrgWideScope) return input;
  if (isAdminLevel(ctx.user)) return input;
  // Trust the session flag first — it's set by `attachTeamSupervisorSessionFlags`
  // which checks supervisor STATUS (not supervisee count) so a fresh supervisor
  // of an empty team still gets scope = [self]. Without this, the call below
  // returned `isSupervisor=false` and the empty-team supervisor saw the full
  // branch-wide list (because the MEDIA_BUYER / CS_CLOSER pin had been
  // dropped by `narrowOrdersAggregateFiltersForViewer`).
  const flagOn =
    ctx.user.isMarketingTeamSupervisorOnActiveBranch === true ||
    ctx.user.isCsTeamSupervisorOnActiveBranch === true;
  const scope = await getBranchTeamsService().listSupervisorScopeIds(ctx.user.id, branchId);
  if (!scope.isSupervisor && !flagOn) return input;
  return {
    ...input,
    supervisorScope: {
      csUserIds: scope.csUserIds,
      mediaBuyerIds: scope.marketingUserIds,
    },
  };
}

/** Output filters for `getStatusCounts` / `getOrdersTimeSeriesByCreated` after viewer-safe narrowing. */
export type NarrowedOrdersAggregateFilters = {
  mediaBuyerId?: string;
  assignedCsId?: string;
  supervisorScope?: OrdersAggregateSupervisorScope;
  logisticsLocationId?: string;
  statuses?: OrderStatus[];
  startDate?: string;
  endDate?: string;
  status?: string;
};

/**
 * Mirrors `orders.list` narrowing so aggregate endpoints cannot return branch-wide counts for
 * MEDIA_BUYER / CS_CLOSER without supervisor OR-scope.
 */
export async function narrowOrdersAggregateFiltersForViewer(
  ctx: { user: SessionUser; currentBranchId: string | null },
  branchId: string | null,
  partial: NarrowedOrdersAggregateFilters,
): Promise<NarrowedOrdersAggregateFilters> {
  if (ctx.user.role === 'SUPER_ADMIN') {
    return { ...partial };
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
    return { ...partial };
  }

  let merged: Record<string, unknown> = { ...partial };

  if (ctx.user.role === 'MEDIA_BUYER') {
    if (merged.mediaBuyerId && merged.mediaBuyerId !== ctx.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot query another media buyer orders',
      });
    }
    merged.mediaBuyerId = ctx.user.id;
  }

  if (hasOrdersRead && ctx.user.role === 'CS_CLOSER') {
    merged.assignedCsId = ctx.user.id;
  }

  const withSupervisor = await applySupervisorScope(
    ctx,
    merged as unknown as ListOrdersInput,
    branchId,
  );

  const out = { ...withSupervisor } as Record<string, unknown>;
  if (out.supervisorScope && typeof out.supervisorScope === 'object') {
    delete out.mediaBuyerId;
    delete out.assignedCsId;
  }

  const supervisorScope = out.supervisorScope as OrdersAggregateSupervisorScope | undefined;

  return {
    startDate: partial.startDate,
    endDate: partial.endDate,
    logisticsLocationId: partial.logisticsLocationId,
    statuses: partial.statuses,
    status: partial.status,
    ...(supervisorScope ? { supervisorScope } : {}),
    ...(!supervisorScope && typeof out.mediaBuyerId === 'string' ? { mediaBuyerId: out.mediaBuyerId } : {}),
    ...(!supervisorScope && typeof out.assignedCsId === 'string' ? { assignedCsId: out.assignedCsId } : {}),
  };
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
      const res = await getOrdersService().create(
        { ...orderInput, cartId: input.cartId },
        actorId,
        source,
      );
      await invalidateOrdersAggregatesCache();
      return res;
    }),

  /**
   * Create an offline order (CS manual entry). Creator is set as assignee.
   * Phase 21: gated by `orders.createOffline` permission so a custom role can be granted just this capability
   * without inheriting all of CS_CLOSER.
   */
  createOffline: permissionProcedure('orders.createOffline')
    .meta({ branchScopedMutation: true })
    .input(createOfflineOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId, ...offlineInput } = input;
      const res = await getOrdersService().createOffline(
        offlineInput,
        ctx.user.id,
        branchId ?? ctx.currentBranchId,
      );
      await invalidateOrdersAggregatesCache();
      return res;
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

  /**
   * Full-field plain-text order summary for clipboard (includes stored customer phone when present).
   * Same visibility as `orders.getById` — does not bypass Lead Fortress for hash-only intakes.
   */
  clipboardSummary: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => ({
      text: await getOrdersService().getClipboardSummaryText(input.orderId, ctx.user),
    })),

  /**
   * Single round-trip for inventory DELIVERY rows: customer names only.
   * Gated like `/admin/inventory`; per-order visibility matches `orders.getById`.
   */
  deliveryMovementCustomerNames: authedProcedure
    .input(z.object({ orderIds: z.array(z.string().uuid()).min(1).max(50) }))
    .query(async ({ input, ctx }) => {
      if (!canAccessDeliveryMovementCustomerNames(ctx.user)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      return getOrdersService().listCustomerNamesByOrderIds(ctx.user, input.orderIds);
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
        return getOrdersService().list(input, branchId, buildOrdersListOpts(ctx.user, input));
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
      const marketingTeamSupervisorOrders =
        ctx.user.isMarketingTeamSupervisorOnActiveBranch === true && !!ctx.currentBranchId;
      if (
        !hasOrdersRead &&
        !hasMarketingOrders &&
        !hasLogisticsRead &&
        !hasOrgWideScope &&
        !marketingTeamSupervisorOrders
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Missing orders.read, marketing.orders, or logistics.read permission',
        });
      }
      if (hasOrgWideScope) {
        return getOrdersService().list(input, branchId, buildOrdersListOpts(ctx.user, input));
      }
      let effectiveInput = input;
      if (ctx.user.role === 'MEDIA_BUYER') {
        effectiveInput = { ...effectiveInput, mediaBuyerId: ctx.user.id };
      }
      if (hasOrdersRead && ctx.user.role === 'CS_CLOSER') {
        effectiveInput = { ...effectiveInput, assignedCsId: ctx.user.id };
      }
      // Supervisor scoping (Phase B): non-org-wide branch supervisors only see
      // orders assigned to their CS team agents OR created by their MB team
      // members. Their own work is always included.
      effectiveInput = await applySupervisorScope(ctx, effectiveInput, branchId);
      return getOrdersService().list(effectiveInput, branchId, buildOrdersListOpts(ctx.user, effectiveInput));
    }),

  /**
   * CS schedule calendar: per-day callback + ISO delivery-date counts (Africa/Lagos for callbacks).
   * Same auth / branch / CS_CLOSER / Media Buyer scoping as `orders.list`.
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
      const marketingTeamSupervisorOrders =
        ctx.user.isMarketingTeamSupervisorOnActiveBranch === true && !!ctx.currentBranchId;
      if (
        !hasOrdersRead &&
        !hasMarketingOrders &&
        !hasLogisticsRead &&
        !hasOrgWideScope &&
        !marketingTeamSupervisorOrders
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Missing orders.read, marketing.orders, or logistics.read permission',
        });
      }
      if (hasOrgWideScope) {
        return getOrdersService().scheduleCalendarHeat(input, branchId);
      }
      let effectiveInput = input;
      if (ctx.user.role === 'MEDIA_BUYER') {
        effectiveInput = { ...effectiveInput, mediaBuyerId: ctx.user.id };
      }
      if (hasOrdersRead && ctx.user.role === 'CS_CLOSER') {
        effectiveInput = { ...effectiveInput, assignedCsId: ctx.user.id };
      }
      effectiveInput = await applySupervisorScope(ctx, effectiveInput, branchId);
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
      const res = await getOrdersService().transition(transitionInput, ctx.user);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCache(input.orderId),
      ]);
      return res;
    }),

  /**
   * Update order details (address, items, notes).
   */
  update: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(updateOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...updateInput } = input;
      const res = await getOrdersService().update(updateInput, ctx.user);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCache(input.orderId),
      ]);
      return res;
    }),

  /**
   * Submit proposed line prices for approval (actors who cannot apply prices via `orders.update`).
   */
  requestLinePriceChangeApproval: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(requestOrderLinePriceChangeSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...body } = input;
      const res = await getOrdersService().requestLinePriceChangeApproval(body, ctx.user);
      // The cached `pendingOrderLinePriceRequestId` flips after this — drop the
      // detail cache so the next viewer sees the new pending-request hint.
      await invalidateOrderDetailCache(input.orderId);
      return res;
    }),

  /**
   * Request soft-delete (archive) approval — CS and others without direct archive authority.
   */
  requestOrderDeletionApproval: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(requestOrderDeletionSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...body } = input;
      const res = await getOrdersService().requestOrderDeletionApproval(body, ctx.user);
      // Same reasoning as `requestLinePriceChangeApproval` — the cached
      // `pendingOrderDeletionRequestId` field flips after the mutation.
      await invalidateOrderDetailCache(input.orderId);
      return res;
    }),

  /**
   * Soft-delete (archive) immediately — Head of CS / HoLogistics / Branch Admin / supervisors / admins.
   */
  softDeleteOrder: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(requestOrderDeletionSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, reason, orderId } = input;
      const res = await getOrdersService().softDeleteOrder(orderId, ctx.user, { approverNote: reason });
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCache(orderId),
      ]);
      return res;
    }),

  /**
   * Assign an order to a CS closer.
   * `orders.reassign` (HoCS / Admin) or branch CS team supervisor for in-team agents (UNPROCESSED / CS_ASSIGNED only).
   */
  assignToCS: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(assignOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().assignToCS(input.orderId, input.csCloserId, ctx.user);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCache(input.orderId),
      ]);
      return res;
    }),

  /**
   * Bulk reassign orders (Hot Swap).
   * Restricted to Head of CS and SuperAdmin.
   */
  bulkReassign: permissionProcedure('orders.reassign')
    .meta({ branchScopedMutation: true })
    .input(bulkReassignSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().bulkReassign(
        input.orderIds,
        input.fromAgentId,
        input.toAgentId,
        ctx.user,
      );
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  /**
   * Redistribute CS_ASSIGNED orders across agents (load-balanced or performance strategy).
   * Restricted to Head of CS and SuperAdmin.
   */
  redistributeCSOrders: permissionProcedure('orders.reassign').mutation(async ({ ctx }) => {
    const res = await getOrdersService().redistributeCSOrders(ctx.user);
    await Promise.all([invalidateOrdersAggregatesCache(), invalidateAllOrderDetailCache()]);
    return res;
  }),

  /**
   * Redistribute one agent's CS_ASSIGNED and CS_ENGAGED orders to other agents (from CS Team page).
   * Restricted to Head of CS and SuperAdmin.
   */
  redistributeOrdersFromAgent: permissionProcedure('orders.reassign')
    .meta({ branchScopedMutation: true })
    .input(z.object({ agentId: z.string().uuid(), branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().redistributeOrdersFromAgent(input.agentId, ctx.user);
      await Promise.all([invalidateOrdersAggregatesCache(), invalidateAllOrderDetailCache()]);
      return res;
    }),

  /**
   * Distribute all UNPROCESSED (unassigned) orders to CS closers using the dispatch algorithm.
   * Manual fallback when auto-assignment on order creation did not run. Restricted to Head of CS and SuperAdmin.
   */
  distributeUnassignedOrders: permissionProcedure('orders.reassign')
    .meta({ branchScopedMutation: true })
    .input(z.object({ branchId: z.string().uuid().optional() }).optional())
    .mutation(async ({ ctx }) => {
      const res = await getOrdersService().distributeUnassignedOrders(ctx.user);
      await Promise.all([invalidateOrdersAggregatesCache(), invalidateAllOrderDetailCache()]);
      return res;
    }),

  /**
   * List CS closers for assign dropdowns — full roster with `orders.reassign`, else supervised team agents only.
   */
  listCSClosers: authedProcedure.query(async ({ ctx }) => {
    return getOrdersService().listCSClosers(ctx.user);
  }),

  /**
   * Get order counts by status — for dashboard stats.
   * Optional mediaBuyerId filters to that buyer's orders (for Marketing Orders page).
   * Optional assignedCsId filters to that CS closer's orders (for CS Orders page).
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
          // Accept ISO datetime in addition to date — see listOrdersSchema.
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const effectiveBranchId = orderListBranchId(ctx.user, ctx.currentBranchId);
      const narrowed = await narrowOrdersAggregateFiltersForViewer(ctx, effectiveBranchId, {
        mediaBuyerId: input?.mediaBuyerId,
        assignedCsId: input?.assignedCsId,
        logisticsLocationId: input?.logisticsLocationId,
        statuses: input?.statuses,
        startDate: input?.startDate,
        endDate: input?.endDate,
      });

      if (!ordersCacheService) {
        return getOrdersService().getStatusCounts(
          narrowed.mediaBuyerId,
          narrowed.startDate,
          narrowed.endDate,
          narrowed.assignedCsId,
          narrowed.logisticsLocationId,
          effectiveBranchId,
          narrowed.statuses,
          narrowed.supervisorScope,
        );
      }

      const key =
        'cache:orders:aggregates:statusCounts:' +
        CacheService.hashInput({
          branchId: effectiveBranchId,
          viewerId: ctx.user.id,
          viewerRole: ctx.user.role,
          narrowed,
        });

      return ordersCacheService.getOrSet(key, ORDERS_AGG_TTL_SECONDS, () =>
        getOrdersService().getStatusCounts(
          narrowed.mediaBuyerId,
          narrowed.startDate,
          narrowed.endDate,
          narrowed.assignedCsId,
          narrowed.logisticsLocationId,
          effectiveBranchId,
          narrowed.statuses,
          narrowed.supervisorScope,
        ),
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
          // Accept ISO datetime alongside date — see listOrdersSchema.
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const effectiveBranchId = orderListBranchId(ctx.user, ctx.currentBranchId);
      const narrowed = await narrowOrdersAggregateFiltersForViewer(ctx, effectiveBranchId, {
        mediaBuyerId: input?.mediaBuyerId,
        assignedCsId: input?.assignedCsId,
        logisticsLocationId: input?.logisticsLocationId,
        statuses: input?.statuses,
        startDate: input?.startDate,
        endDate: input?.endDate,
        status: input?.status,
      });

      const filters = {
        mediaBuyerId: narrowed.mediaBuyerId,
        csCloserId: narrowed.assignedCsId,
        logisticsLocationId: narrowed.logisticsLocationId,
        status: narrowed.status,
        statuses: narrowed.statuses,
        supervisorScope: narrowed.supervisorScope,
      };

      if (!ordersCacheService) {
        return getOrdersService().getOrdersTimeSeriesByCreated(
          narrowed.startDate,
          narrowed.endDate,
          effectiveBranchId,
          filters,
        );
      }

      const key =
        'cache:orders:aggregates:timeSeriesByCreated:' +
        CacheService.hashInput({
          branchId: effectiveBranchId,
          viewerId: ctx.user.id,
          viewerRole: ctx.user.role,
          narrowed,
        });

      return ordersCacheService.getOrSet(key, ORDERS_AGG_TTL_SECONDS, () =>
        getOrdersService().getOrdersTimeSeriesByCreated(
          narrowed.startDate,
          narrowed.endDate,
          effectiveBranchId,
          filters,
        ),
      );
    }),

  /**
   * Get CS closer workloads — for dispatch dashboard.
   * Restricted to Head of CS and SuperAdmin.
   */
  csWorkloads: permissionProcedure('orders.csWorkloads').query(async ({ ctx }) => {
    return getOrdersService().getCSCloserWorkloads(ctx.currentBranchId);
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
   * Get workload for the current CS closer — for \"My Orders\" page.
   * Non–CS closers receive null.
   */
  myCSWorkload: authedProcedure.query(async ({ ctx }) => {
    return getOrdersService().getMyCSWorkload(ctx.user);
  }),

  /**
   * Release expired order locks.
   * Can be called periodically or on-demand.
   */
  releaseExpiredLocks: permissionProcedure('orders.releaseLocks').mutation(async ({ ctx }) => {
    const res = await getOrdersService().releaseExpiredLocks(ctx.user?.id ?? null);
    // Locks live on the order row (`locked_by`, `locked_at`) and are part of
    // the cached payload — release applies across many rows so wipe wholesale.
    if (res.releasedCount > 0) {
      await invalidateAllOrderDetailCache();
    }
    return res;
  }),

  /**
   * Get inactive CS closers (no action for > threshold minutes).
   * Used by Head of CS to monitor agent activity.
   */
  inactiveAgents: permissionProcedure('orders.inactiveAgents')
    .input(z.object({ thresholdMinutes: z.number().min(1).default(10) }).optional())
    .query(async ({ input, ctx }) => {
      return getOrdersService().getInactiveAgents(input?.thresholdMinutes ?? 10, ctx.currentBranchId);
    }),

  /**
   * Get CS closer leaderboard — performance metrics for ranking.
   * Restricted to Head of CS, SuperAdmin, and CS_CLOSER (gamification).
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
    .query(async ({ input, ctx }) =>
      getOrdersService().getCSCloserLeaderboard(
        input.period ?? 'this_month',
        input.startDate,
        input.endDate,
        ctx.currentBranchId,
      ),
    ),

  /**
   * Single-request bundle for the `/admin/cs/orders` secondary fan-out.
   *
   * Replaces up to 7 parallel loader calls — `orders.statusCounts`,
   * `orders.myCSWorkload` (CS_CLOSER only), `orders.timeSeriesByCreated`,
   * `orders.scheduleCalendarHeat`, `products.list` (offline order modal),
   * `orders.csWorkloads` (HoCS / Admin column), `logistics.locationOptions`
   * (HoCS / Admin bulk allocate). Same fan-out, single HTTP round-trip and one
   * pass through auth + branch resolution.
   *
   * Permission gate matches the page (`orders.read`).
   */
  csOrdersPageBundle: permissionProcedure('orders.read')
    .input(
      z.object({
        // Counts scope (mirrors orders.statusCounts).
        countsAssignedCsId: z.string().uuid().optional(),
        countsStartDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/)
          .optional(),
        countsEndDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/)
          .optional(),
        // Trend scope (mirrors orders.timeSeriesByCreated). The trend chart can
        // additionally filter on `status` (e.g. delivered-only line).
        trendStatus: z.string().optional(),
        // Schedule heat — yearMonth is YYYY-MM.
        heatYearMonth: z.string().regex(/^\d{4}-\d{2}$/),
        heatStatus: z
          .enum([
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
          ])
          .optional(),
        // Capability flags from the loader.
        isCSCloser: z.boolean().optional().default(false),
        showCSCloserColumn: z.boolean().optional().default(false),
        canCreateOffline: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ input, ctx }) => {
      const branchId = orderListBranchId(ctx.user, ctx.currentBranchId);
      const scope = await narrowOrdersAggregateFiltersForViewer(ctx, branchId, {
        assignedCsId: input.countsAssignedCsId,
        startDate: input.countsStartDate,
        endDate: input.countsEndDate,
      });

      const trendFilters = {
        mediaBuyerId: scope.mediaBuyerId,
        csCloserId: scope.assignedCsId,
        supervisorScope: scope.supervisorScope,
        status: input.trendStatus,
      };

      const scheduleHeatInput =
        scope.supervisorScope != null
          ? {
              yearMonth: input.heatYearMonth,
              supervisorScope: scope.supervisorScope,
              status: input.heatStatus,
            }
          : {
              yearMonth: input.heatYearMonth,
              ...(scope.assignedCsId ? { assignedCsId: scope.assignedCsId } : {}),
              ...(scope.mediaBuyerId ? { mediaBuyerId: scope.mediaBuyerId } : {}),
              status: input.heatStatus,
            };

      const [
        statusCounts,
        myWorkload,
        dailyCounts,
        scheduleHeat,
        csClosersForFilter,
        logisticsLocationsForBulk,
        productsForOfflineOrder,
      ] = await Promise.all([
        getOrdersService().getStatusCounts(
          scope.mediaBuyerId,
          scope.startDate,
          scope.endDate,
          scope.assignedCsId,
          undefined,
          branchId,
          undefined,
          scope.supervisorScope,
        ),
        input.isCSCloser ? getOrdersService().getMyCSWorkload(ctx.user) : Promise.resolve(null),
        getOrdersService().getOrdersTimeSeriesByCreated(scope.startDate, scope.endDate, branchId, trendFilters),
        getOrdersService().scheduleCalendarHeat(scheduleHeatInput, branchId),
        // csWorkloads requires `orders.csWorkloads` permission. Defense-in-depth
        // — bundle gate is `orders.read` so we re-check before exposing the
        // agent roster.
        input.showCSCloserColumn &&
        (ctx.user.permissions ?? []).includes('orders.csWorkloads')
          ? getOrdersService().getCSCloserWorkloads(branchId)
          : Promise.resolve([]),
        input.showCSCloserColumn
          ? getLogisticsService().listLocationOptions({ status: 'ACTIVE', providerKind: 'THIRD_PARTY' })
          : Promise.resolve([]),
        input.canCreateOffline
          ? getProductsService().list(
              { page: 1, limit: 100, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' },
              ctx.user.id,
              ctx.user.role,
            )
          : Promise.resolve(null),
      ]);

      return {
        statusCounts,
        myWorkload,
        dailyCounts,
        scheduleHeat,
        csClosersForFilter: (csClosersForFilter as Array<{ agentId: string; agentName: string }>).map(
          (w) => ({ agentId: w.agentId, agentName: w.agentName }),
        ),
        logisticsLocationsForBulk: (
          logisticsLocationsForBulk as Array<{ id: string; name: string; providerName: string | null }>
        ).map((loc) => ({
          id: loc.id,
          name: loc.name,
          providerName: loc.providerName ?? null,
        })),
        productsForOfflineOrder: productsForOfflineOrder?.products ?? [],
      };
    }),

  /**
   * Single-request bundle for the `/admin/cs/team` page.
   *
   * Replaces 4 parallel loader calls — `users.listCSTeam`,
   * `orders.csWorkloads`, `orders.csLeaderboard`, `orders.inactiveAgents` — with
   * a single HTTP round-trip. The four service calls still run in parallel on
   * the API side. Permission gate matches the page (`cs.teamOverview`).
   */
  csTeamPageBundle: permissionProcedure('cs.teamOverview')
    .input(
      z.object({
        period: z.enum(['this_month', 'all_time']).optional().default('this_month'),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        inactiveThresholdMinutes: z.number().int().min(1).optional().default(10),
      }),
    )
    .query(async ({ input, ctx }) => {
      const branchId = ctx.currentBranchId;
      const [team, workloads, leaderboard, inactiveAgents] = await Promise.all([
        getUsersService().listCSTeam(branchId),
        getOrdersService().getCSCloserWorkloads(branchId),
        getOrdersService().getCSCloserLeaderboard(
          input.period,
          input.startDate,
          input.endDate,
          branchId,
        ),
        getOrdersService().getInactiveAgents(input.inactiveThresholdMinutes, branchId),
      ]);
      return { team, workloads, leaderboard, inactiveAgents };
    }),

  /**
   * Single-request bundle for the `/tpl` 3PL dashboard.
   *
   * Replaces 4 parallel loader calls — `orders.list`, `orders.statusCounts`,
   * `inventory.transfers`, `inventory.returnedOrders` — with one HTTP round-trip.
   * Same fan-out runs server-side via `Promise.all`. Permission gate is
   * `authedProcedure` because the page is reachable by any 3PL-side user; we
   * scope visibility through the location filter the same way the standalone
   * calls do.
   */
  tplDashboardBundle: authedProcedure
    .input(
      z.object({
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        logisticsLocationId: z.string().uuid().optional(),
        recentLimit: z.number().int().min(1).max(50).default(8),
      }),
    )
    .query(async ({ input, ctx }) => {
      const branchId = orderListBranchId(ctx.user, ctx.currentBranchId);
      const locationFilter = input.logisticsLocationId;

      const listInput: Parameters<typeof OrdersService.prototype.list>[0] = {
        page: 1,
        limit: input.recentLimit,
        sortBy: 'preferredDeliveryDate',
        sortOrder: 'asc',
        ...(input.startDate && { startDate: input.startDate }),
        ...(input.endDate && { endDate: input.endDate }),
        ...(locationFilter && { logisticsLocationId: locationFilter }),
      };

      const [ordersResult, statusCounts, transfers, returnedOrders] =
        await Promise.all([
          getOrdersService().list(listInput, branchId, buildOrdersListOpts(ctx.user, listInput)),
          getOrdersService().getStatusCounts(
            undefined,
            input.startDate,
            input.endDate,
            undefined,
            locationFilter,
            branchId,
            undefined,
          ),
          getInventoryService().listTransfers(undefined, ctx.user),
          getInventoryService().listReturnedOrders(locationFilter),
        ]);

      const inTransitTransfers = (transfers as Array<{ transferStatus: string }>).filter(
        (t) => t.transferStatus === 'IN_TRANSIT',
      ).length;

      type RecentOrder = {
        id: string;
        customerName: string;
        status: string;
        totalAmount: string | null;
        createdAt: string | Date;
        preferredDeliveryDate: string | Date | null;
      };
      const recentOrders = (ordersResult.orders as Array<RecentOrder>).map((o) => ({
        id: o.id,
        customerName: o.customerName,
        status: o.status,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        preferredDeliveryDate: o.preferredDeliveryDate,
      }));

      return {
        recentOrders,
        statusCounts,
        totalOrders: ordersResult.pagination?.total ?? 0,
        inTransitTransfers,
        returnsQueue: (returnedOrders as Array<unknown>).length,
      };
    }),

  /**
   * Single-request bundle for `/tpl/orders` (the 3PL Orders page).
   *
   * Replaces 4 parallel loader calls — `orders.list`, `orders.statusCounts`,
   * `logistics.listLocations`, `logistics.listRiders` — with one HTTP
   * round-trip. Same fan-out runs server-side. Permission gate matches
   * the page (caller must hold `logistics.read` OR be a TPL_MANAGER).
   */
  tplOrdersPageBundle: authedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(40),
        status: z
          .enum([
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
          ])
          .optional(),
        statuses: z
          .array(
            z.enum([
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
            ]),
          )
          .optional(),
        search: z.string().optional(),
        startDate: z.string().date().optional(),
        endDate: z.string().date().optional(),
        logisticsLocationId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const perms = ctx.user.permissions ?? [];
      const isTplManager = ctx.user.role === 'TPL_MANAGER';
      if (
        !isAdminLevel(ctx.user) &&
        !isTplManager &&
        !perms.includes('logistics.read')
      ) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'logistics.read required' });
      }

      const branchId = orderListBranchId(ctx.user, ctx.currentBranchId);

      const listInput: Parameters<typeof OrdersService.prototype.list>[0] = {
        page: input.page,
        limit: input.limit,
        sortBy: 'preferredDeliveryDate',
        sortOrder: 'asc',
        ...(input.status && { status: input.status }),
        ...(input.statuses?.length && { statuses: input.statuses }),
        ...(input.search && { search: input.search }),
        ...(input.startDate && { startDate: input.startDate }),
        ...(input.endDate && { endDate: input.endDate }),
        ...(input.logisticsLocationId && { logisticsLocationId: input.logisticsLocationId }),
      };

      const [ordersResult, statusCounts, locationsResult, ridersResult] =
        await Promise.all([
          getOrdersService().list(listInput, branchId, buildOrdersListOpts(ctx.user, listInput)),
          getOrdersService().getStatusCounts(
            undefined,
            input.startDate,
            input.endDate,
            undefined,
            input.logisticsLocationId,
            branchId,
            input.statuses?.length ? input.statuses : undefined,
          ),
          getLogisticsService().listLocations({ page: 1, limit: 20, status: 'ACTIVE' }),
          getLogisticsService().listRiders(),
        ]);

      return {
        orders: ordersResult.orders,
        pagination: ordersResult.pagination,
        statusCounts,
        locations: (locationsResult as { locations?: unknown[] }).locations ?? [],
        riders: (ridersResult as Array<{ id: string; name: string; logisticsLocationId: string | null }>).map(
          (r) => ({
            id: r.id,
            name: r.name,
            logisticsLocationId: r.logisticsLocationId ?? null,
          }),
        ),
      };
    }),

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
      const res = await getOrdersService().revealPhoneForManualCall(input.orderId, ctx.user);
      // May have transitioned UNPROCESSED → CS_ENGAGED inside the service; the
      // cached payload's status / engagement timestamps are now stale.
      await invalidateOrderDetailCache(input.orderId);
      return res;
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
      const res = await getVoipService().initiateCall(input.orderId, ctx.user);
      // A new call_log row may exist (and the order may have transitioned).
      // Both are part of the cached payload — drop it.
      await invalidateOrderDetailCache(input.orderId);
      return res;
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
      const res = await getOrdersService().scheduleCallback(input.orderId, ctx.user, {
        delayMinutes: input.delayMinutes,
        notes: input.notes,
      });
      // Callback timestamps + status may have changed on the order row.
      await invalidateOrderDetailCache(input.orderId);
      return res;
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
  scheduledCallbacks: permissionProcedure('orders.scheduledCallbacks').query(async ({ ctx }) => {
    return getOrdersService().getScheduledCallbacks(ctx.currentBranchId);
  }),

  // ── Duplicate Order Management ────────────────────────────

  /**
   * Get flagged duplicate orders for review.
   */
  flaggedDuplicates: permissionProcedure('orders.flaggedDuplicates').query(async ({ ctx }) => {
    return getOrdersService().getFlaggedDuplicates(ctx.currentBranchId);
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
      const res = await getOrdersService().mergeDuplicate(input.duplicateId, input.originalId, ctx.user);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCache(input.duplicateId),
        invalidateOrderDetailCache(input.originalId),
      ]);
      return res;
    }),

  /**
   * Dismiss a flagged duplicate — mark as legitimate order.
   */
  dismissDuplicate: permissionProcedure('orders.dismissDuplicate')
    .meta({ branchScopedMutation: true })
    .input(z.object({ orderId: z.string().uuid(), branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().dismissDuplicate(input.orderId, ctx.user);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCache(input.orderId),
      ]);
      return res;
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
      const res = await getOrdersService().bulkTransition(
        input.orderIds,
        input.newStatus,
        input.metadata,
        ctx.user,
      );
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  /**
   * Bulk assign multiple orders to a CS closer (same gates as assignToCS).
   */
  bulkAssignToCS: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(
      z
        .object({
          orderIds: z.array(z.string().uuid()).min(1).max(100),
          csCloserId: z.string().uuid().optional(),
          csCloserIds: z.array(z.string().uuid()).min(1).max(50).optional(),
          branchId: z.string().uuid().optional(),
        })
        .superRefine((val, ctx) => {
          const fromMulti = val.csCloserIds && val.csCloserIds.length > 0;
          const fromSingle = Boolean(val.csCloserId);
          if (!fromMulti && !fromSingle) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Provide csCloserId or csCloserIds',
              path: ['csCloserId'],
            });
          }
          if (fromMulti && fromSingle) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Use either csCloserId or csCloserIds, not both',
              path: ['csCloserIds'],
            });
          }
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const csCloserIds =
        input.csCloserIds && input.csCloserIds.length > 0
          ? input.csCloserIds
          : input.csCloserId
            ? [input.csCloserId]
            : [];
      const res = await getOrdersService().bulkAssignToCS(input.orderIds, csCloserIds, ctx.user);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  // ── Order Timeline ─────────────────────────────────────

  /**
   * Get the timeline of events for a specific order.
   * Role-filtered: CS closers only see CS-relevant events; Logistics only see logistics events; etc.
   * Requires orders.read or marketing.orders permission.
   */
  getTimeline: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().getOrderTimeline(input.orderId, ctx.user);
    }),

  /**
   * Append a manual CS note to the order timeline (no status change).
   */
  addCsOrderComment: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(
      z.object({
        orderId: z.string().uuid(),
        comment: z.string().min(1).max(2000),
        branchId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...rest } = input;
      const res = await getOrdersService().addCsOrderComment(rest.orderId, ctx.user, {
        comment: rest.comment,
      });
      await invalidateOrderDetailCache(input.orderId);
      return res;
    }),

  // ── Claim Mode ────────────────────────────────────────

  /**
   * Get the claim queue — UNPROCESSED orders available for CS closers to claim.
   * Only relevant when CS_DISPATCH_STRATEGY = 'claim'.
   */
  claimQueue: permissionProcedure('orders.read')
    .query(async ({ ctx }) => {
      return getOrdersService().getClaimQueue(ctx.currentBranchId);
    }),

  /**
   * Claim an order from the claim queue. Atomic — only one agent can claim at a time.
   */
  claimOrder: permissionProcedure('orders.read')
    .meta({ branchScopedMutation: true })
    .input(z.object({ orderId: z.string().uuid(), branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().claimOrder(input.orderId, ctx.user);
      // Claim assigns the order + transitions UNPROCESSED → CS_ENGAGED — both
      // status and assignedCsId fields in the cached payload need refreshing.
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCache(input.orderId),
      ]);
      return res;
    }),

  // ── CS order routing (auto-dispatch pools) ─────────────

  listCsRoutingRules: permissionProcedure('orders.routing')
    .input(listCsRoutingRulesSchema)
    .query(async ({ input, ctx }) => {
      assertCsRoutingBranchAccess(ctx.user, input.ownerBranchId);
      return getCsOrderRoutingService().listRules(input.ownerBranchId);
    }),

  createCsRoutingRule: permissionProcedure('orders.routing')
    .input(createCsRoutingRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getCsOrderRoutingService().createRule(ctx.user, input);
    }),

  updateCsRoutingRule: permissionProcedure('orders.routing')
    .input(updateCsRoutingRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getCsOrderRoutingService().updateRule(ctx.user, input);
    }),

  deleteCsRoutingRule: permissionProcedure('orders.routing')
    .input(deleteCsRoutingRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getCsOrderRoutingService().deleteRule(ctx.user, input.ruleId);
    }),

  getCsRoutingBranchSettings: permissionProcedure('orders.routing')
    .input(getCsRoutingBranchSettingsSchema)
    .query(async ({ input, ctx }) => {
      assertCsRoutingBranchAccess(ctx.user, input.ownerBranchId);
      const relationshipMode = await getCsOrderRoutingService().getRelationshipMode(input.ownerBranchId);
      return { relationshipMode };
    }),

  setCsRoutingRelationshipMode: permissionProcedure('orders.routing')
    .input(setCsRoutingRelationshipModeSchema)
    .mutation(async ({ input, ctx }) => {
      return getCsOrderRoutingService().setRelationshipMode(
        ctx.user,
        input.ownerBranchId,
        input.relationshipMode,
      );
    }),
});
