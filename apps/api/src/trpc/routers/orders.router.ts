import {
  createOrderSchema,
  createOfflineOrderSchema,
  importOrderSchema,
  orderItemSchema,
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
  createFollowUpRuleSchema,
  updateFollowUpRuleSchema,
  deleteFollowUpRuleSchema,
  listFollowUpRulesSchema,
  listFollowUpSyncLogsSchema,
  listFollowUpOrdersSchema,
  followUpOrderDetailSchema,
  assignFollowUpOrderSchema,
  bulkAssignFollowUpOrdersSchema,
  transitionFollowUpOrderSchema,
} from '@yannis/shared';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { canonicalPermissionCode } from '@yannis/shared';
import { router, authedProcedure, permissionProcedure, publicProcedure } from '../trpc';
import { getBranchTeamsService } from './branches.router';
import { getUsersService } from './users.router';
import { getProductsService } from './products.router';
import { getLogisticsService } from './logistics.router';
import { getCartService } from './cart.router';
import { getInventoryService } from './inventory.router';
import { getFinanceService } from './finance.router';
import {
  OrdersService,
  type OrdersAggregateSupervisorScope,
} from '../../orders/orders.service';
import { CsOrderRoutingService } from '../../orders/cs-order-routing.service';
import { TestOrderPurgeService } from '../../orders/test-order-purge.service';
import { FollowUpConfigService } from '../../orders/follow-up-config.service';
import type { VoipService } from '../../voip/voip.service';
import { isAdminLevel, isSuperAdminOnly } from '../../common/authz';
import type { SessionUser } from '../../common/decorators/current-user.decorator';
import { CacheService } from '../../common/cache/cache.service';

// We need to pass the service instance through context or create it inline.
// Since tRPC routers in this architecture are static, we use a factory pattern.
let ordersServiceInstance: OrdersService | null = null;
let voipServiceInstance: VoipService | null = null;
let ordersCacheService: CacheService | null = null;
let csOrderRoutingInstance: CsOrderRoutingService | null = null;
let testOrderPurgeInstance: TestOrderPurgeService | null = null;
let followUpConfigInstance: FollowUpConfigService | null = null;

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

export function setTestOrderPurgeService(service: TestOrderPurgeService) {
  testOrderPurgeInstance = service;
}

export function setFollowUpConfigService(service: FollowUpConfigService) {
  followUpConfigInstance = service;
}

export function getFollowUpConfigService(): FollowUpConfigService {
  if (!followUpConfigInstance) {
    throw new Error('FollowUpConfigService not initialized. Call setFollowUpConfigService() first.');
  }
  return followUpConfigInstance;
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
        message: 'Branch admins may only access Sales routing for their active branch.',
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
):
  | {
      assignedCloserViewerId?: string;
      searchIncludeCustomerPhone?: boolean;
      branchScope?: 'servicing' | 'marketing';
      effectiveBranchIds?: string[] | null;
    }
  | undefined {
  const closer = csCloserSelfQueueListOpts(user, input);
  const perms = user.permissions ?? [];
  // Session stamps canonical codes (`orders.view`); legacy snapshots may still hold `orders.read`.
  const searchIncludeCustomerPhone =
    perms.some((p) => canonicalPermissionCode(p) === 'orders.view') || isAdminLevel(user);
  const out: {
    assignedCloserViewerId?: string;
    searchIncludeCustomerPhone?: boolean;
    branchScope?: 'servicing' | 'marketing';
  } = {};
  if (closer) Object.assign(out, closer);
  if (searchIncludeCustomerPhone) out.searchIncludeCustomerPhone = true;
  // Head of Marketing's order lists scope by the *marketing* branch
  // (`orders.branch_id`), not the CS servicing branch — see OrdersService.list.
  if (user.role === 'HEAD_OF_MARKETING' || user.role === 'MEDIA_BUYER') out.branchScope = 'marketing';
  return Object.keys(out).length > 0 ? out : undefined;
}

function orderListBranchId(_user: { role: string }, sessionBranchId: string | null): string | null {
  return sessionBranchId;
}

/**
 * `orders.list` for a CS_CLOSER self-query expands the branch predicate to
 * `(servicing_branch_id = :branchId OR assigned_cs_id = me)` so the closer
 * also sees orders assigned to them that were CS-routed to a different
 * servicing branch (or have a NULL `servicing_branch_id` — possible for older
 * rows pre-migration 0150). Aggregate queries (`getStatusCounts`,
 * `getOrdersTimeSeriesByCreated`, `scheduleCalendarHeat`) don't support that
 * OR-expansion — they AND a single branch filter — so without this carve-out
 * the strip pill counts would silently disagree with the list rows.
 *
 * `assigned_cs_id = me` is already an exact ownership scope, so dropping the
 * branch filter when the closer is self-querying yields the same row set as
 * the list's OR-expansion. Returns `null` (no branch filter) in that case;
 * otherwise returns `branchId` unchanged.
 */
function aggregateBranchIdForCloserSelfQuery(
  user: { id: string; role: string },
  narrowedAssignedCsId: string | undefined,
  branchId: string | null,
): string | null {
  if (user.role === 'CS_CLOSER' && narrowedAssignedCsId === user.id) return null;
  return branchId;
}

/**
 * Branch filter for endpoints that ALSO scope Media Buyers by ownership
 * (`media_buyer_id = me`). A Media Buyer's branch is their header data lens:
 *   - currentBranchId = a branch  → their orders attributed to that branch
 *   - currentBranchId = null ("All Branches") → all their orders, every branch
 * The ownership filter stays exact either way, so selecting a branch the buyer
 * was since removed from still surfaces only their own historical orders there.
 *
 * SAFETY: every caller MUST apply the MB ownership scope — directly
 * (`orders.list`) or via `narrowOrdersAggregateFiltersForViewer`. Without that,
 * a non-null branch here would let a buyer read another buyer's orders.
 */
/**
 * True when the viewer has org-wide marketing visibility — they may read any
 * media buyer's orders across every branch. Head of Marketing is org-wide for
 * marketing per the RBAC matrix; admin-class sees everything.
 */
export function isOrgWideMarketingViewer(user: { role: string }): boolean {
  return isAdminLevel(user) || user.role === 'HEAD_OF_MARKETING';
}

function orderListBranchIdOwnerAware(
  user: { role: string },
  sessionBranchId: string | null,
  explicitMediaBuyerId?: string | null,
): string | null {
  // A Media Buyer scopes by their header branch lens (see comment above):
  // null currentBranchId = "All Branches" → no branch filter, all their orders.
  if (user.role === 'MEDIA_BUYER') return sessionBranchId;
  // An explicit single-media-buyer filter is itself an exact scope. For an
  // org-wide marketing viewer (HoM / admin) drilling into one buyer — e.g. the
  // "View orders" link from team analysis — keep the result org-wide so it
  // matches the org-wide leaderboard counts instead of hiding the buyer's
  // cross-branch orders behind the viewer's currently-selected branch.
  if (explicitMediaBuyerId && isOrgWideMarketingViewer(user)) return null;
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
 *   - orders **assigned to** their Sales team members (assignedCsIds), AND
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
  // Department heads see all branch orders — they are org-wide, not team-scoped.
  const role = ctx.user.role;
  if (role === 'HEAD_OF_CS' || role === 'HEAD_OF_MARKETING' || role === 'HEAD_OF_LOGISTICS') return input;
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

  // "My Performance" detection: when the caller explicitly passes their own
  // mediaBuyerId (or assignedCsId), the intent is personal-scope — preserve
  // the exact ownership filter and skip the supervisor team-scope expansion.
  // Without this, the supervisor scope would silently replace the personal
  // filter with the full team list and the stat strip wouldn't change on tab
  // switch (the "My Performance" / "Team" toggle bug).
  const isPersonalMediaBuyerScope =
    partial.mediaBuyerId === ctx.user.id;
  const isPersonalCsScope =
    partial.assignedCsId === ctx.user.id;

  const withSupervisor = await applySupervisorScope(
    ctx,
    merged as unknown as ListOrdersInput,
    branchId,
  );

  const out = { ...withSupervisor } as Record<string, unknown>;

  // When supervisorScope is present but the caller explicitly asked for their
  // own data ("My Performance"), drop the team scope and keep the personal
  // ownership filter instead.
  if (out.supervisorScope && typeof out.supervisorScope === 'object') {
    if (isPersonalMediaBuyerScope) {
      delete out.supervisorScope;
      out.mediaBuyerId = ctx.user.id;
    } else if (isPersonalCsScope) {
      delete out.supervisorScope;
      out.assignedCsId = ctx.user.id;
    } else {
      delete out.mediaBuyerId;
      delete out.assignedCsId;
    }
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
   * Import a single order from an external CRM export (SuperAdmin only).
   * Skips dedup, CS routing, and notifications. Sets status + createdAt directly.
   */
  importOrder: authedProcedure
    .input(importOrderSchema)
    .mutation(async ({ input, ctx }) => {
      if (!isSuperAdminOnly(ctx.user)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Super Admin can import orders' });
      }
      const res = await getOrdersService().importOrder(input, ctx.user.id);
      await invalidateOrdersAggregatesCache();
      return res;
    }),

  /**
   * Recover an abandoned cart as a real edge-form order.
   * Creates with `orderSource: 'edge-form'` so the MB gets full attribution.
   * CS can supplement missing fields (address, items, etc.).
   */
  recoverFromCart: permissionProcedure('cart.delete')
    .input(
      z.object({
        cartId: z.string().uuid(),
        customerAddress: z.string().optional(),
        deliveryAddress: z.string().optional(),
        deliveryNotes: z.string().optional(),
        deliveryState: z.string().max(100).optional(),
        customerGender: z.string().max(50).optional(),
        preferredDeliveryDate: z.string().max(100).optional(),
        paymentMethod: z.enum(['PAY_ON_DELIVERY', 'PAY_ONLINE']).optional(),
        customerEmail: z.string().email().max(255).optional(),
        items: z.array(orderItemSchema).optional(),
        totalAmount: z.coerce.number().min(0).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { cartId, ...overrides } = input;
      const res = await getOrdersService().recoverFromCart(cartId, overrides, ctx.user.id);
      await invalidateOrdersAggregatesCache();
      return res;
    }),

  /**
   * Bulk-recover abandoned carts (single HTTP round-trip).
   * Uses a lean path: skips auto-dispatch + notifications (batch handles assignment).
   */
  bulkRecoverCarts: permissionProcedure('cart.delete')
    .input(
      z.object({
        cartIds: z.array(z.string().uuid()).min(1).max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await getOrdersService().bulkRecoverCarts(input.cartIds, ctx.user.id);
      if (result.orderIds.length > 0) await invalidateOrdersAggregatesCache();
      return result;
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
   * Campaign-scoped offer tiers per product on an order — powers the "select an
   * offer" picker in the Adjust order items modal. Same visibility as `getById`.
   */
  listItemOffers: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().listOrderItemOffers(input.orderId, ctx.user);
    }),

  /**
   * All active products with their offer tiers — powers the product-swap picker
   * in the Adjust order items modal. Group-scoped so only the current company's
   * catalog is shown. Lightweight: name + id + offers only, no inventory data.
   */
  listProductsForAdjust: permissionProcedure('orders.read')
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx }) => {
      const result = await getProductsService().list(
        { page: 1, limit: 200, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' },
        ctx.user.id,
        ctx.user.role,
        ctx.activeGroupId,
      );
      return (result?.products ?? []).map((p: { id: string; name: string; offers?: unknown }) => ({
        id: p.id,
        name: p.name,
        offers: p.offers,
      }));
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
      const branchId = orderListBranchIdOwnerAware(
        ctx.user,
        ctx.currentBranchId,
        input.mediaBuyerId,
      );

      // Resolve scoping (authz + effective filters) BEFORE the cache so a cache
      // hit can never bypass a permission check.
      let effectiveInput = input;
      if (ctx.user.role === 'SUPER_ADMIN') {
        // Org-wide — no scoping narrowing.
      } else {
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
          ctx.user.isMarketingTeamSupervisorOnActiveBranch === true;
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
        if (!hasOrgWideScope) {
          if (ctx.user.role === 'MEDIA_BUYER' && !marketingTeamSupervisorOrders) {
            // This ownership filter is what keeps `orderListBranchIdOwnerAware`
            // safe: an MB scopes by their header branch lens (a branch, or null
            // for "All Branches"), and this `media_buyer_id = me` filter ensures
            // a selected branch only ever exposes the buyer's own orders.
            // Supervisors skip this — they can view specific team members' orders
            // via mediaBuyerId URL param; applySupervisorScope below enforces
            // team-boundary security.
            effectiveInput = { ...effectiveInput, mediaBuyerId: ctx.user.id };
          }
          if (hasOrdersRead && ctx.user.role === 'CS_CLOSER') {
            effectiveInput = { ...effectiveInput, assignedCsId: ctx.user.id };
          }
          // Supervisor scoping (Phase B): non-org-wide branch supervisors only see
          // orders assigned to their Sales team agents OR created by their MB team
          // members. Their own work is always included.
          effectiveInput = await applySupervisorScope(ctx, effectiveInput, branchId);
        }
      }

      const baseOpts = buildOrdersListOpts(ctx.user, effectiveInput) ?? {};
      // Caller-supplied branchScope (e.g. marketing pages pass 'marketing') takes
      // precedence over the role-based default — lets the same endpoint serve both
      // CS (servicing-scoped) and marketing (marketing-scoped) pages correctly.
      if (input.branchScope) baseOpts.branchScope = input.branchScope;
      baseOpts.effectiveBranchIds = ctx.effectiveBranchIds;
      const opts = Object.keys(baseOpts).length > 0 ? baseOpts : undefined;
      const fetchList = () => getOrdersService().list(effectiveInput, branchId, opts);

      // Cache all pages — the 15s TTL keeps the keyspace bounded and every
      // existing `invalidateOrdersAggregatesCache()` call (create / createOffline
      // / transition / bulk / edits) already drops the `cache:orders:aggregates:*`
      // namespace. Extending beyond page 1 avoids the full DB round-trip when
      // users paginate or switch to limit=100.
      if (!ordersCacheService) {
        return fetchList();
      }
      const key =
        'cache:orders:aggregates:list:' +
        CacheService.hashInput({ userId: ctx.user.id, branchId, effectiveInput, opts });
      return ordersCacheService.getOrSet(key, ORDERS_AGG_TTL_SECONDS, fetchList);
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
        return getOrdersService().scheduleCalendarHeat(input, branchId, ctx.effectiveBranchIds);
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
        return getOrdersService().scheduleCalendarHeat(input, branchId, ctx.effectiveBranchIds);
      }
      let effectiveInput = input;
      if (ctx.user.role === 'MEDIA_BUYER') {
        effectiveInput = { ...effectiveInput, mediaBuyerId: ctx.user.id };
      }
      if (hasOrdersRead && ctx.user.role === 'CS_CLOSER') {
        effectiveInput = { ...effectiveInput, assignedCsId: ctx.user.id };
      }
      effectiveInput = await applySupervisorScope(ctx, effectiveInput, branchId);
      return getOrdersService().scheduleCalendarHeat(effectiveInput, branchId, ctx.effectiveBranchIds);
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
    .input(requestOrderLinePriceChangeSchema.extend({
      branchId: z.string().uuid().optional(),
      orderType: z.enum(['followUp', 'cart']).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, orderType, ...body } = input;
      const res = await getOrdersService().requestLinePriceChangeApproval(body, ctx.user, orderType);
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
   * Assign an order to a Sales closer.
   * - Pre-engagement statuses (UNPROCESSED / CS_ASSIGNED / CS_ENGAGED): allowed for
   *   `orders.reassign` (HoCS / Admin) or a branch Sales team supervisor.
   * - Post-engagement (CONFIRMED → REMITTED, plus RETURNED / PARTIALLY_DELIVERED):
   *   requires `orders.cs.transfer_any_status` (HoCS / Admin by default). Status is
   *   preserved on the order; reason is mandatory for the audit trail.
   */
  assignToCS: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(assignOrderSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().assignToCS(input.orderId, input.csCloserId, ctx.user, {
        reason: input.reason,
      });
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
   * Redistribute one agent's CS_ASSIGNED and CS_ENGAGED orders to other agents (from Sales Team page).
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
   * Distribute all UNPROCESSED (unassigned) orders to Sales closers using the dispatch algorithm.
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
   * List Sales closers for assign dropdowns — full roster with `orders.reassign`, else supervised team agents only.
   */
  listCSClosers: authedProcedure.query(async ({ ctx }) => {
    return getOrdersService().listCSClosers(ctx.user, ctx.effectiveBranchIds);
  }),

  /** Like listCSClosers but includes branch memberships — used by follow-up group modal. */
  listCSClosersWithBranches: permissionProcedure('orders.followUp').query(async ({ ctx }) => {
    return getOrdersService().listCSClosersWithBranches(ctx.user, ctx.effectiveBranchIds);
  }),

  /**
   * Get order counts by status — for dashboard stats.
   * Optional mediaBuyerId filters to that buyer's orders (for Marketing Orders page).
   * Optional assignedCsId filters to that Sales closer's orders (for Sales Orders page).
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
            'DELETED',
          ])).min(1).optional(),
          // Accept ISO datetime in addition to date — see listOrdersSchema.
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
          /** When true, return counts for follow-up orders only. When false/omitted, exclude them. */
          isFollowUp: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const effectiveBranchId = orderListBranchIdOwnerAware(ctx.user, ctx.currentBranchId);
      const narrowed = await narrowOrdersAggregateFiltersForViewer(ctx, effectiveBranchId, {
        mediaBuyerId: input?.mediaBuyerId,
        assignedCsId: input?.assignedCsId,
        logisticsLocationId: input?.logisticsLocationId,
        statuses: input?.statuses,
        startDate: input?.startDate,
        endDate: input?.endDate,
      });
      // Marketing roles (HoM + MB) scope by the *marketing* branch (`orders.branch_id`);
      // every other role scopes by the CS servicing branch.
      const branchScope: 'servicing' | 'marketing' =
        ctx.user.role === 'HEAD_OF_MARKETING' || ctx.user.role === 'MEDIA_BUYER' ? 'marketing' : 'servicing';
      // Match `orders.list`'s CS_CLOSER self-query branch expansion so strip
      // counts agree with list row counts. See `aggregateBranchIdForCloserSelfQuery`.
      const countsBranchId = aggregateBranchIdForCloserSelfQuery(
        ctx.user,
        narrowed.assignedCsId,
        effectiveBranchId,
      );

      const isFollowUp = input?.isFollowUp;

      if (!ordersCacheService) {
        return getOrdersService().getStatusCounts(
          narrowed.mediaBuyerId,
          narrowed.startDate,
          narrowed.endDate,
          narrowed.assignedCsId,
          narrowed.logisticsLocationId,
          countsBranchId,
          narrowed.statuses,
          narrowed.supervisorScope,
          branchScope,
          ctx.effectiveBranchIds,
          isFollowUp,
        );
      }

      const key =
        'cache:orders:aggregates:statusCounts:' +
        CacheService.hashInput({
          branchId: countsBranchId,
          viewerId: ctx.user.id,
          viewerRole: ctx.user.role,
          narrowed,
          isFollowUp,
          branchScope,
          effectiveBranchIds: ctx.effectiveBranchIds,
        });

      return ordersCacheService.getOrSet(key, ORDERS_AGG_TTL_SECONDS, () =>
        getOrdersService().getStatusCounts(
          narrowed.mediaBuyerId,
          narrowed.startDate,
          narrowed.endDate,
          narrowed.assignedCsId,
          narrowed.logisticsLocationId,
          countsBranchId,
          narrowed.statuses,
          narrowed.supervisorScope,
          branchScope,
          ctx.effectiveBranchIds,
          isFollowUp,
        ),
      );
    }),

  /** Lightweight offline + duplicate counts for dashboard stat strips. */
  supplementaryCounts: authedProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      const effectiveBranchId = orderListBranchIdOwnerAware(ctx.user, ctx.currentBranchId);
      const narrowed = await narrowOrdersAggregateFiltersForViewer(ctx, effectiveBranchId, {
        startDate: input?.startDate,
        endDate: input?.endDate,
      });
      const branchScope: 'servicing' | 'marketing' =
        ctx.user.role === 'HEAD_OF_MARKETING' || ctx.user.role === 'MEDIA_BUYER' ? 'marketing' : 'servicing';
      const countsBranchId = aggregateBranchIdForCloserSelfQuery(ctx.user, narrowed.assignedCsId, effectiveBranchId);
      return getOrdersService().getSupplementaryCounts(
        narrowed.mediaBuyerId,
        narrowed.startDate,
        narrowed.endDate,
        narrowed.assignedCsId,
        countsBranchId,
        narrowed.supervisorScope,
        branchScope,
        ctx.effectiveBranchIds,
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
            'DELETED',
          ])).min(1).optional(),
          // Accept ISO datetime alongside date — see listOrdersSchema.
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
          endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      const effectiveBranchId = orderListBranchIdOwnerAware(ctx.user, ctx.currentBranchId);
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
      // Marketing roles (HoM + MB) trend follows the marketing branch; everyone else the servicing branch.
      const tsBranchScope: 'servicing' | 'marketing' =
        ctx.user.role === 'HEAD_OF_MARKETING' || ctx.user.role === 'MEDIA_BUYER' ? 'marketing' : 'servicing';

      if (!ordersCacheService) {
        return getOrdersService().getOrdersTimeSeriesByCreated(
          narrowed.startDate,
          narrowed.endDate,
          effectiveBranchId,
          filters,
          tsBranchScope,
          ctx.effectiveBranchIds,
        );
      }

      const key =
        'cache:orders:aggregates:timeSeriesByCreated:' +
        CacheService.hashInput({
          branchId: effectiveBranchId,
          viewerId: ctx.user.id,
          viewerRole: ctx.user.role,
          narrowed,
          tsBranchScope,
          effectiveBranchIds: ctx.effectiveBranchIds,
        });

      return ordersCacheService.getOrSet(key, ORDERS_AGG_TTL_SECONDS, () =>
        getOrdersService().getOrdersTimeSeriesByCreated(
          narrowed.startDate,
          narrowed.endDate,
          effectiveBranchId,
          filters,
          tsBranchScope,
          ctx.effectiveBranchIds,
        ),
      );
    }),

  /**
   * Get Sales closer workloads — for dispatch dashboard.
   * Restricted to Head of CS and SuperAdmin.
   */
  csWorkloads: permissionProcedure('orders.csWorkloads').query(async ({ ctx }) => {
    return getOrdersService().getCSCloserWorkloads(ctx.currentBranchId, ctx.effectiveBranchIds);
  }),

  /**
   * Pending orders + line items for one closer (Sales queue workload modal).
   */
  closerWorkloadOrders: permissionProcedure('orders.csWorkloads')
    .input(z.object({ agentId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().getCloserWorkloadOrdersWithItems(input.agentId, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /**
   * Get workload for the current Sales closer — for \"My Orders\" page.
   * Non–Sales closers receive null.
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
   * Get inactive Sales closers (no action for > threshold minutes).
   * Used by Head of CS to monitor agent activity.
   */
  inactiveAgents: permissionProcedure('orders.inactiveAgents')
    .input(z.object({ thresholdMinutes: z.number().min(1).default(10) }).optional())
    .query(async ({ input, ctx }) => {
      return getOrdersService().getInactiveAgents(input?.thresholdMinutes ?? 10, ctx.currentBranchId, ctx.effectiveBranchIds);
    }),

  /**
   * Get Sales closer leaderboard — performance metrics for ranking.
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
        ctx.effectiveBranchIds,
      ),
    ),

  /**
   * Single-request bundle for the `/admin/sales/orders` secondary fan-out.
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
            'DELETED',
          ])
          .optional(),
        // Capability flags from the loader.
        isCSCloser: z.boolean().optional().default(false),
        showCSCloserColumn: z.boolean().optional().default(false),
        canCreateOffline: z.boolean().optional().default(false),
        // Cart abandonment moved to Follow-Up page only (CEO 2026-06-09).
        // Kept for backward compat with cached clients — always ignored now.
        includeCartAbandonment: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ input, ctx }) => {
      const branchId = orderListBranchIdOwnerAware(ctx.user, ctx.currentBranchId);
      const scope = await narrowOrdersAggregateFiltersForViewer(ctx, branchId, {
        assignedCsId: input.countsAssignedCsId,
        startDate: input.countsStartDate,
        endDate: input.countsEndDate,
      });
      // CS_CLOSER self-query: drop the branch AND so aggregate counts match the
      // list's branch-OR-assignee expansion. See `aggregateBranchIdForCloserSelfQuery`.
      const aggregateBranchId = aggregateBranchIdForCloserSelfQuery(
        ctx.user,
        scope.assignedCsId,
        branchId,
      );

      const trendFilters = {
        mediaBuyerId: scope.mediaBuyerId,
        csCloserId: scope.assignedCsId,
        supervisorScope: scope.supervisorScope,
        status: input.trendStatus,
      };
      // Marketing roles (HoM + MB) scope by the marketing branch; everyone else by the
      // CS servicing branch (matches the standalone statusCounts procedure).
      const bundleBranchScope: 'servicing' | 'marketing' =
        ctx.user.role === 'HEAD_OF_MARKETING' || ctx.user.role === 'MEDIA_BUYER' ? 'marketing' : 'servicing';

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

      const fetchBundle = async () => {
        const [
        statusCounts,
        myWorkload,
        dailyCounts,
        scheduleHeat,
        csClosersForFilter,
        logisticsLocationsForBulk,
        productsForOfflineOrder,
        cartAbandonmentCount,
        supplementaryCounts,
      ] = await Promise.all([
        getOrdersService().getStatusCounts(
          scope.mediaBuyerId,
          scope.startDate,
          scope.endDate,
          scope.assignedCsId,
          undefined,
          aggregateBranchId,
          undefined,
          scope.supervisorScope,
          bundleBranchScope,
          ctx.effectiveBranchIds,
          false, // exclude follow-up orders — matches orders.list default
        ),
        input.isCSCloser ? getOrdersService().getMyCSWorkload(ctx.user) : Promise.resolve(null),
        getOrdersService().getOrdersTimeSeriesByCreated(
          scope.startDate,
          scope.endDate,
          aggregateBranchId,
          trendFilters,
          bundleBranchScope,
          ctx.effectiveBranchIds,
        ),
        getOrdersService().scheduleCalendarHeat(scheduleHeatInput, aggregateBranchId, ctx.effectiveBranchIds),
        // csWorkloads requires `orders.csWorkloads` permission. Defense-in-depth
        // — bundle gate is `orders.read` so we re-check before exposing the
        // agent roster.
        input.showCSCloserColumn &&
        (ctx.user.permissions ?? []).includes('orders.csWorkloads')
          ? getOrdersService().getCSCloserWorkloads(branchId, ctx.effectiveBranchIds)
          : Promise.resolve([]),
        input.showCSCloserColumn
          ? getLogisticsService().listLocationOptions({ status: 'ACTIVE', providerKind: 'THIRD_PARTY' })
          : Promise.resolve([]),
        input.canCreateOffline
          ? getProductsService().list(
              { page: 1, limit: 100, status: 'ACTIVE', sortBy: 'name', sortOrder: 'asc' },
              ctx.user.id,
              ctx.user.role,
              ctx.activeGroupId,
            )
          : Promise.resolve(null),
        getCartService().countAbandoned({
          mediaBuyerId: scope.mediaBuyerId,
          branchId: aggregateBranchId,
          effectiveBranchIds: ctx.effectiveBranchIds,
          startDate: scope.startDate,
          endDate: scope.endDate,
        }),
        getOrdersService().getSupplementaryCounts(
          scope.mediaBuyerId,
          scope.startDate,
          scope.endDate,
          scope.assignedCsId,
          aggregateBranchId,
          scope.supervisorScope,
          bundleBranchScope,
          ctx.effectiveBranchIds,
        ),
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
        cartAbandonmentCount: cartAbandonmentCount ?? 0,
        offlineCount: supplementaryCounts.offlineCount,
      };
      }; // end fetchBundle

      // Cache the bundle — same 15s TTL and `cache:orders:aggregates:*` namespace
      // as the list cache, so `invalidateOrdersAggregatesCache()` drops both.
      if (!ordersCacheService) {
        return fetchBundle();
      }
      const bundleCacheKey =
        'cache:orders:aggregates:csBundle:' +
        CacheService.hashInput({
          userId: ctx.user.id,
          branchId,
          scope,
          trendFilters,
          scheduleHeatInput,
          bundleBranchScope,
          isCSCloser: input.isCSCloser,
          showCSCloserColumn: input.showCSCloserColumn,
          canCreateOffline: input.canCreateOffline,
          includeCartAbandonment: input.includeCartAbandonment,
          effectiveBranchIds: ctx.effectiveBranchIds,
        });
      return ordersCacheService.getOrSet(bundleCacheKey, ORDERS_AGG_TTL_SECONDS, fetchBundle);
    }),

  /**
   * Single-request bundle for the `/admin/sales/team` page.
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
      const eIds = ctx.effectiveBranchIds;
      const [team, workloads, leaderboard, inactiveAgents, supplementary] = await Promise.all([
        getUsersService().listCSTeam(branchId, eIds),
        getOrdersService().getCSCloserWorkloads(branchId, eIds),
        getOrdersService().getCSCloserLeaderboard(
          input.period,
          input.startDate,
          input.endDate,
          branchId,
          eIds,
        ),
        getOrdersService().getInactiveAgents(input.inactiveThresholdMinutes, branchId, eIds),
        getOrdersService().getSupplementaryCounts(
          undefined,
          input.startDate,
          input.endDate,
          undefined,
          branchId,
          undefined,
          'servicing',
          ctx.effectiveBranchIds,
        ),
      ]);
      return { team, workloads, leaderboard, inactiveAgents, offlineCount: supplementary.offlineCount };
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
          getOrdersService().list(listInput, branchId, { ...buildOrdersListOpts(ctx.user, listInput), effectiveBranchIds: ctx.effectiveBranchIds }),
          getOrdersService().getStatusCounts(
            undefined,
            input.startDate,
            input.endDate,
            undefined,
            locationFilter,
            branchId,
            undefined,
            undefined,
            'servicing',
            ctx.effectiveBranchIds,
          ),
          getInventoryService().listTransfers(undefined, ctx.user),
          getInventoryService().listReturnedOrders(locationFilter),
        ]);

      const transferList = (transfers as unknown as { transfers: Array<{ transferStatus: string }> }).transfers ?? [];
      const inTransitTransfers = transferList.filter(
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
            'DELETED',
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
              'DELETED',
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
          getOrdersService().list(listInput, branchId, { ...buildOrdersListOpts(ctx.user, listInput), effectiveBranchIds: ctx.effectiveBranchIds }),
          getOrdersService().getStatusCounts(
            undefined,
            input.startDate,
            input.endDate,
            undefined,
            input.logisticsLocationId,
            branchId,
            input.statuses?.length ? input.statuses : undefined,
            undefined,
            'servicing',
            ctx.effectiveBranchIds,
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

  /**
   * Read-only phone lookup — loaded with the order detail page so the Call
   * Customer modal can copy/dial without a separate reveal fetch.
   */
  getCallablePhone: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().getCallablePhoneForViewer(input.orderId, ctx.user);
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
    return getOrdersService().getScheduledCallbacks(ctx.currentBranchId, ctx.effectiveBranchIds);
  }),

  // ── Duplicate Order Management ────────────────────────────

  /**
   * Get flagged duplicate orders for review.
   */
  flaggedDuplicates: permissionProcedure('orders.flaggedDuplicates').query(async ({ ctx }) => {
    return getOrdersService().getFlaggedDuplicates(ctx.currentBranchId, ctx.effectiveBranchIds);
  }),

  /** Raw phones for a duplicate pair — used by the comparison modal on the order detail page. */
  getDuplicateComparisonPhones: permissionProcedure('orders.flaggedDuplicates')
    .input(z.object({ orderId: z.string().uuid(), originalOrderId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getOrdersService().getDuplicateComparisonPhones(input.orderId, input.originalOrderId);
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
        orderIds: z.array(z.string().uuid()).min(1).max(2000),
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
   * Move orders to a different branch. Resets to UNPROCESSED, clears CS assignment.
   * MB credit kept. HoCS + Admin only.
   */
  moveOrdersToBranch: authedProcedure
    .input(
      z.object({
        orderIds: z.array(z.string().uuid()).min(1).max(100),
        targetBranchId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (
        !isAdminLevel(ctx.user) &&
        ctx.user.role !== 'HEAD_OF_CS'
      ) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Admin or Head of CS can move orders between branches' });
      }
      const res = await getOrdersService().moveOrdersToBranch(
        input.orderIds,
        input.targetBranchId,
        ctx.user,
      );
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  /**
   * Follow-up reassign: move closed orders to a new branch for re-engagement.
   * Clears MB credit, resets to UNPROCESSED. Permission-gated: orders.followUp.
   */
  followUpReassign: permissionProcedure('orders.followUp')
    .input(
      z.object({
        orderIds: z.array(z.string().uuid()).min(1).max(100),
        targetBranchId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().moveOrdersToBranch(
        input.orderIds,
        input.targetBranchId,
        ctx.user,
        { clearMediaBuyer: true },
      );
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  /** Reopen closed/stuck orders for follow-up — resets to UNPROCESSED, optional branch move. */
  reopenForFollowUp: permissionProcedure('orders.followUp')
    .input(
      z.object({
        orderIds: z.array(z.string().uuid()).min(1).max(2000),
        targetBranchId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const res = await getOrdersService().reopenForFollowUp(
        input.orderIds,
        ctx.user,
        { targetBranchId: input.targetBranchId },
      );
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  /**
   * Bulk assign multiple orders to a Sales closer (same gates as assignToCS).
   */
  bulkAssignToCS: authedProcedure
    .meta({ branchScopedMutation: true })
    .input(
      z
        .object({
          orderIds: z.array(z.string().uuid()).min(1).max(2000),
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
   * Role-filtered: Sales closers only see CS-relevant events; Logistics only see logistics events; etc.
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
   * Get the claim queue — UNPROCESSED orders available for Sales closers to claim.
   * Only relevant when CS_DISPATCH_STRATEGY = 'claim'.
   */
  claimQueue: permissionProcedure('orders.read')
    .query(async ({ ctx }) => {
      return getOrdersService().getClaimQueue(ctx.currentBranchId, ctx.effectiveBranchIds);
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

  /**
   * Manually purge test orders (customer name starts with "test").
   * Admin, HoM, and marketing team supervisors. Always runs armed.
   */
  purgeTestOrders: authedProcedure.mutation(async ({ ctx }) => {
    const allowed =
      isAdminLevel(ctx.user) ||
      ctx.user.role === 'HEAD_OF_MARKETING' ||
      ctx.user.isMarketingTeamSupervisorOnActiveBranch === true;
    if (!allowed) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to purge test orders' });
    }
    if (!testOrderPurgeInstance) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'TestOrderPurgeService not initialized' });
    }
    // Manual trigger — scan every order (not just the cron's 48h window).
    return testOrderPurgeInstance.purgeTestOrders(true);
  }),

  // ── Follow-Up Batches ──────────────────────────────────────

  createFollowUpBatch: permissionProcedure('orders.followUp')
    .input(
      z.object({
        name: z.string().min(1).max(200),
        source: z.enum(['orders', 'carts']),
        branchId: z.string().uuid().optional(),
        groupId: z.string().uuid().optional(),
        assignmentMode: z.enum(['EQUAL', 'MANUAL']).default('MANUAL'),
        items: z.array(z.object({
          orderId: z.string().uuid(),
          originalStatus: z.string(),
        })).min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().createFollowUpBatch({
        ...input,
        createdById: ctx.user.id,
      });
    }),

  listFollowUpBatches: permissionProcedure('orders.followUp')
    .input(z.object({
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return getOrdersService().listFollowUpBatches(input, ctx.effectiveBranchIds);
    }),

  getFollowUpBatchDetail: permissionProcedure('orders.followUp')
    .input(z.object({ batchId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getOrdersService().getFollowUpBatchDetail(input.batchId);
    }),

  nextFollowUpBatchName: permissionProcedure('orders.followUp')
    .query(async () => {
      return getOrdersService().nextFollowUpBatchName();
    }),

  deleteFollowUpBatch: permissionProcedure('orders.followUp')
    .input(z.object({ batchId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const result = await getOrdersService().deleteFollowUpBatch(input.batchId);
      await invalidateOrdersAggregatesCache();
      return result;
    }),

  // ── Follow-Up Groups ──────────────────────────────────────

  createFollowUpGroup: permissionProcedure('orders.followUp')
    .input(z.object({
      name: z.string().min(1).max(200),
      memberIds: z.array(z.string().uuid()).min(1).max(100),
    }))
    .mutation(async ({ input, ctx }) => {
      return getOrdersService().createFollowUpGroup({
        ...input,
        createdById: ctx.user.id,
      });
    }),

  updateFollowUpGroup: permissionProcedure('orders.followUp')
    .input(z.object({
      groupId: z.string().uuid(),
      name: z.string().min(1).max(200).optional(),
      memberIds: z.array(z.string().uuid()).max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      return getOrdersService().updateFollowUpGroup(input.groupId, {
        name: input.name,
        memberIds: input.memberIds,
      });
    }),

  deleteFollowUpGroup: permissionProcedure('orders.followUp')
    .input(z.object({
      groupId: z.string().uuid(),
      transferToBranchId: z.string().uuid().optional(),
      transferToGroupId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input }) => {
      return getOrdersService().deleteFollowUpGroup(input.groupId, {
        branchId: input.transferToBranchId,
        groupId: input.transferToGroupId,
      });
    }),

  listFollowUpGroups: permissionProcedure('orders.followUp')
    .query(async ({ ctx }) => {
      return getOrdersService().listFollowUpGroups(ctx.effectiveBranchIds);
    }),

  getFollowUpGroup: permissionProcedure('orders.followUp')
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getOrdersService().getFollowUpGroup(input.groupId);
    }),

  assignBatchItem: permissionProcedure('orders.followUp')
    .input(z.object({
      batchItemId: z.string().uuid(),
      csCloserId: z.string().uuid(),
    }))
    .mutation(async ({ input }) => {
      return getOrdersService().assignBatchItem(input.batchItemId, input.csCloserId);
    }),

  bulkAssignBatchItems: permissionProcedure('orders.followUp')
    .input(z.object({
      itemIds: z.array(z.string().uuid()).min(1).max(2000),
      csCloserIds: z.array(z.string().uuid()).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      return getOrdersService().bulkAssignBatchItems(input.itemIds, input.csCloserIds);
    }),

  // ── Follow-Up Config (Admin only) ─────────────────────────────────

  followUpConfigListRules: permissionProcedure('orders.followUpConfig')
    .input(listFollowUpRulesSchema)
    .query(async ({ input, ctx }) => {
      return getFollowUpConfigService().listRules(input.enabledOnly, ctx.effectiveBranchIds);
    }),

  followUpConfigCreateRule: permissionProcedure('orders.followUpConfig')
    .input(createFollowUpRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().createRule(ctx.user, input);
    }),

  followUpConfigUpdateRule: permissionProcedure('orders.followUpConfig')
    .input(updateFollowUpRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().updateRule(ctx.user, input);
    }),

  followUpConfigDeleteRule: permissionProcedure('orders.followUpConfig')
    .input(deleteFollowUpRuleSchema)
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().deleteRule(ctx.user, input.ruleId);
    }),

  followUpConfigDryRun: permissionProcedure('orders.followUpConfig')
    .query(async () => {
      return getFollowUpConfigService().dryRunSync();
    }),

  followUpConfigSyncNow: permissionProcedure('orders.followUpConfig')
    .mutation(async ({ ctx }) => {
      return getFollowUpConfigService().runSync('manual', ctx.user.id);
    }),

  followUpConfigListSyncLogs: permissionProcedure('orders.followUpConfig')
    .input(listFollowUpSyncLogsSchema)
    .query(async ({ input }) => {
      return getFollowUpConfigService().listSyncLogs(input.page, input.limit);
    }),

  /** Get current sync progress (Redis-backed, survives page refresh). Returns null if no sync running. */
  followUpConfigSyncStatus: permissionProcedure('orders.followUpConfig')
    .query(async () => {
      return getFollowUpConfigService().getSyncProgress();
    }),

  /** Redistribute unprocessed follow-up orders from a branch to remaining active branches. */
  followUpConfigRedistribute: permissionProcedure('orders.followUpConfig')
    .input(z.object({ branchId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const moved = await getFollowUpConfigService().redistributeFromBranch(input.branchId);
      return { moved };
    }),

  transferFollowUpOrder: permissionProcedure('orders.followUp')
    .input(z.object({ orderId: z.string().uuid(), targetBranchId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().transferFollowUpOrder(input.orderId, input.targetBranchId, ctx.user);
    }),

  bulkTransferFollowUpOrders: permissionProcedure('orders.followUp')
    .input(z.object({ orderIds: z.array(z.string().uuid()).min(1).max(2000), targetBranchId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().bulkTransferFollowUpOrders(input.orderIds, input.targetBranchId, ctx.user);
    }),

  bulkTransitionFollowUpOrders: permissionProcedure('orders.followUp')
    .input(z.object({
      orderIds: z.array(z.string().uuid()).min(1).max(2000),
      newStatus: z.string(),
      note: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await getFollowUpConfigService().bulkTransitionFollowUpOrders(
        input.orderIds, input.newStatus, ctx.user, input.note, input.metadata,
      );
      // Auto-generate invoices for orders that transitioned to CONFIRMED
      if (input.newStatus === 'CONFIRMED' && result.succeededIds.length > 0) {
        for (const orderId of result.succeededIds) {
          try {
            const fuDetail = await getFollowUpConfigService().getFollowUpOrderDetail(orderId);
            await getFinanceService().ensureInvoiceForOrder({
              order: {
                id: fuDetail.id,
                confirmedAt: fuDetail.confirmedAt ?? new Date(),
                customerName: fuDetail.customerName,
                customerAddress: fuDetail.customerAddress ?? null,
                orderItems: fuDetail.items.map((it: { quantity: number; unitPrice: string; productName?: string | null; productId: string }) => ({
                  quantity: it.quantity, unitPrice: it.unitPrice, productName: it.productName ?? null, productId: it.productId,
                })),
              },
              actorId: ctx.user.id,
            });
          } catch { /* non-critical */ }
        }
      }
      return { succeeded: result.succeeded, failed: result.failed, total: result.total };
    }),

  unfreezeOrder: permissionProcedure('orders.freeze')
    .input(z.object({ orderId: z.string().uuid(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().unfreezeOrder(input.orderId, ctx.user, input.reason);
    }),

  /**
   * Bulk freeze orders — blocks all status transitions, assignments, and edits.
   * CEO directive 2026-06-23: permission-based, CS group, SuperAdmin default.
   */
  bulkFreezeOrders: permissionProcedure('orders.freeze')
    .input(z.object({
      orderIds: z.array(z.string().uuid()).min(1).max(2000),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const res = await getFollowUpConfigService().bulkFreezeOrders(input.orderIds, ctx.user, input.reason);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  /**
   * Bulk unfreeze orders — clears frozen flag; follow-up copies continue independently.
   * CEO directive 2026-06-23.
   */
  bulkUnfreezeOrders: permissionProcedure('orders.freeze')
    .input(z.object({
      orderIds: z.array(z.string().uuid()).min(1).max(2000),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const res = await getFollowUpConfigService().bulkUnfreezeOrders(input.orderIds, ctx.user, input.reason);
      await Promise.all([
        invalidateOrdersAggregatesCache(),
        invalidateOrderDetailCacheMany(input.orderIds),
      ]);
      return res;
    }),

  /** Branches with an active CS department — for follow-up config dropdowns. */
  listActiveCsBranches: permissionProcedure('orders.followUp')
    .query(async ({ ctx }) => {
      return getFollowUpConfigService().listActiveCsBranches(ctx.effectiveBranchIds);
    }),

  // ── Follow-Up Branches Summary ─────────────────────────────────────

  listFollowUpBranches: permissionProcedure('orders.followUp')
    .input(z.object({ startDate: z.string().optional(), endDate: z.string().optional(), branchId: z.string().uuid().optional() }))
    .query(async ({ input, ctx }) => {
      return getFollowUpConfigService().listFollowUpBranches({
        ...input,
        branchId: input.branchId ?? ctx.currentBranchId ?? undefined,
        effectiveBranchIds: ctx.effectiveBranchIds,
      });
    }),

  // ── Follow-Up Orders (HoCS + Closer) ──────────────────────────────

  followUpOrdersList: permissionProcedure('orders.followUp')
    .input(listFollowUpOrdersSchema)
    .query(async ({ input, ctx }) => {
      const viewerCloserId = ctx.user.role === 'CS_CLOSER' ? ctx.user.id : null;
      return getFollowUpConfigService().listFollowUpOrders(input, ctx.currentBranchId, ctx.effectiveBranchIds, viewerCloserId);
    }),

  followUpOrdersStatusCounts: permissionProcedure('orders.followUp')
    .input(z.object({
      branchId: z.string().uuid().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }).optional().default({}))
    .query(async ({ input, ctx }) => {
      const assignedCsId = ctx.user?.role === 'CS_CLOSER' ? ctx.user.id : null;
      const branchId = input.branchId ?? ctx.currentBranchId ?? undefined;
      const viewerCloserId = ctx.user?.role === 'CS_CLOSER' ? ctx.user.id : null;
      return getFollowUpConfigService().getFollowUpOrderStatusCounts(branchId, assignedCsId, input.startDate, input.endDate, ctx.effectiveBranchIds, viewerCloserId);
    }),

  /** Lightweight follow-up counts for dashboard stat strips (assigned + delivered). */
  followUpDashboardCounts: authedProcedure
    .input(z.object({ startDate: z.string().optional(), endDate: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const role = ctx.user.role;
      const isCloser = role === 'CS_CLOSER';
      return getFollowUpConfigService().getFollowUpDashboardCounts({
        assignedCsId: isCloser ? ctx.user.id : undefined,
        branchId: ctx.currentBranchId ?? undefined,
        effectiveBranchIds: ctx.effectiveBranchIds,
        startDate: input?.startDate,
        endDate: input?.endDate,
        viewerCloserId: isCloser ? ctx.user.id : null,
      });
    }),

  followUpOrdersUpdate: permissionProcedure('orders.followUp')
    .input(z.object({
      orderId: z.string().uuid(),
      customerName: z.string().min(1).optional(),
      deliveryAddress: z.string().nullish(),
      deliveryState: z.string().nullish(),
      deliveryNotes: z.string().nullish(),
      customerEmail: z.string().nullish(),
      preferredDeliveryDate: z.string().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { orderId, ...updates } = input;
      return getFollowUpConfigService().updateFollowUpOrder(orderId, updates, ctx.user);
    }),

  followUpOrdersAdjustItems: permissionProcedure('orders.followUp')
    .input(z.object({
      orderId: z.string().uuid(),
      items: z.array(z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
        offerLabel: z.string().max(100).optional(),
      })).min(1),
      totalAmount: z.coerce.number().min(0),
    }))
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().adjustFollowUpOrderItems(input.orderId, input.items, input.totalAmount, ctx.user);
    }),

  followUpOrdersDetail: permissionProcedure('orders.followUp')
    .input(followUpOrderDetailSchema)
    .query(async ({ input, ctx }) => {
      const detail = await getFollowUpConfigService().getFollowUpOrderDetail(input.id);
      const viewerCanEditOrderLinePrices = await getOrdersService().canActorEditOrderLinePrices(ctx.user, {
        branchId: detail.servicingBranchId ?? detail.branchId ?? null,
        assignedCsId: detail.assignedCsId ?? null,
      });
      return { ...detail, viewerCanEditOrderLinePrices };
    }),

  followUpOrdersAssign: permissionProcedure('orders.followUp')
    .input(assignFollowUpOrderSchema)
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().assignFollowUpOrder(input.orderId, input.closerId, ctx.user, input.force ?? false);
    }),

  followUpOrdersBulkAssign: permissionProcedure('orders.followUp')
    .input(bulkAssignFollowUpOrdersSchema)
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().bulkAssignFollowUpOrders(input.orderIds, input.closerIds, ctx.user);
    }),

  addFollowUpOrderComment: authedProcedure
    .input(z.object({ orderId: z.string().uuid(), comment: z.string().min(1).max(2000) }))
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().addFollowUpOrderComment(input.orderId, input.comment, ctx.user);
    }),

  followUpEnsureInvoice: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const fuDetail = await getFollowUpConfigService().getFollowUpOrderDetail(input.orderId);
      await getFinanceService().ensureInvoiceForOrder({
        order: {
          id: fuDetail.id,
          confirmedAt: fuDetail.confirmedAt ?? new Date(),
          customerName: fuDetail.customerName,
          customerAddress: fuDetail.customerAddress ?? null,
          orderItems: fuDetail.items.map((it: { quantity: number; unitPrice: string; productName?: string | null; productId: string }) => ({
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            productName: it.productName ?? null,
            productId: it.productId,
          })),
        },
        actorId: ctx.user.id,
      });
      return { success: true };
    }),

  followUpOrdersTransition: permissionProcedure('orders.followUp')
    .input(transitionFollowUpOrderSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await getFollowUpConfigService().transitionFollowUpOrderStatus(
        input.orderId,
        input.newStatus,
        ctx.user,
        input.note,
        input.metadata,
      );

      // Auto-generate invoice on CONFIRMED — awaited so it's ready when the page reloads
      if (input.newStatus === 'CONFIRMED') {
        try {
          const fuDetail = await getFollowUpConfigService().getFollowUpOrderDetail(input.orderId);
          await getFinanceService().ensureInvoiceForOrder({
            order: {
              id: fuDetail.id,
              confirmedAt: fuDetail.confirmedAt ?? new Date(),
              customerName: fuDetail.customerName,
              customerAddress: fuDetail.customerAddress ?? null,
              orderItems: fuDetail.items.map((it: { quantity: number; unitPrice: string; productName?: string | null; productId: string }) => ({
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                productName: it.productName ?? null,
                productId: it.productId,
              })),
            },
            actorId: ctx.user.id,
          });
        } catch (err) {
          // Non-critical — user can generate manually via the button
          console.warn(`[FollowUpInvoice] Auto-generate failed for ${input.orderId}:`, err instanceof Error ? err.message : err);
        }
      }

      return result;
    }),

  /** Record a manual call on a follow-up order. Transitions to CS_ENGAGED if pre-engaged,
   *  and always writes a MANUAL_CALL_LOGGED timeline event so the confirm gate is satisfied. */
  followUpRecordCall: authedProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getFollowUpConfigService().recordManualCall(input.orderId, ctx.user);
    }),
});
