import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import { randomUUID, createHash } from 'crypto';
import { eq, and, desc, asc, sql, ilike, or, count, gte, lte, inArray, notInArray, exists, isNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import {
  type CreateOrderInput,
  type CreateOfflineOrderInput,
  type ImportOrderInput,
  type TransitionOrderInput,
  type UpdateOrderInput,
  type RequestOrderLinePriceChangeInput,
  type RequestOrderDeletionInput,
  type RequestDeliveredOrderDeletionInput,
  type ListOrdersInput,
  type ScheduleCalendarHeatInput,
  type OrderStatus,
  customFormFieldSchema,
  getMissingRequiredCustomFormLabels,
  z,
} from '@yannis/shared';
import { EDGE_FORM_ACTOR_ID, canonicalPermissionCode, buildOrderClipboardSummaryText, formatNigerianPhoneForClipboardPaste, formatOrderCustomerPhoneDisplay, resolveOrderClipboardPhone } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { withActor, withActorAndBranch } from '../common/db/with-actor';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';
import { isAdminLevel } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import { permissionRequestTypeTextEq } from '../common/db/permission-request-type-sql';
import { branchScopeCondition } from '../common/db/branch-scope-condition';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  isTransitionAllowed,
  getAllowedNextStatuses,
  TRANSITION_TIMESTAMPS,
} from './order-state-machine';
import { CartService } from '../cart/cart.service';
import { PaystackService } from '../payments/paystack.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { CsOrderRoutingService } from './cs-order-routing.service';
import { CacheService } from '../common/cache/cache.service';
import { trimmedSearchLooksLikeUuid } from '../common/utils/uuid-search';

/**
 * OR-substrings for `customer_phone` ILIKE — DB often stores `0803…` while users search `+234803…`.
 * (Edge/API still persist plaintext `customer_phone` when provided; hash-only rows stay name-only.)
 */
export function expandCustomerPhoneSearchDigitRuns(digitRun: string): string[] {
  if (digitRun.length < 7 || digitRun.length > 24) return [];
  const runs = new Set<string>([digitRun]);
  if (digitRun.startsWith('234') && digitRun.length >= 12 && digitRun.length <= 13) {
    const rest = digitRun.slice(3);
    if (rest.length === 10) runs.add(`0${rest}`);
  }
  if (digitRun.startsWith('0') && digitRun.length === 11) {
    runs.add(`234${digitRun.slice(1)}`);
  }
  if (digitRun.length === 10 && /^[789]\d{9}$/.test(digitRun)) {
    runs.add(`0${digitRun}`);
    runs.add(`234${digitRun}`);
  }
  return [...runs];
}

const PENDING_PAYMENT_PREFIX = 'pending_payment:';
const PENDING_PAYMENT_TTL_SECONDS = 3600; // 1 hour

/** Pre-confirmation + CANCELLED orders — avoids inventory side effects on soft-delete. */
const ARCHIVABLE_ORDER_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CANCELLED'] as const;

/** ISO YYYY-MM-DD on `preferred_delivery_date` (excludes edge-form option strings). */
const PREFERRED_DELIVERY_ISO_SQL = sql`${schema.orders.preferredDeliveryDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`;

const CALLBACK_PRECONFIRM_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'] as const;

/** OR-scope for aggregate queries — mirrors `listOrders` when `supervisorScope` is set. */
export type OrdersAggregateSupervisorScope = {
  csUserIds: string[];
  mediaBuyerIds: string[];
};

export type OrdersAggregateScopeFilters = {
  mediaBuyerId?: string;
  csCloserId?: string;
  logisticsLocationId?: string;
  status?: string;
  statuses?: Array<(typeof schema.orders.$inferSelect)['status']>;
  supervisorScope?: OrdersAggregateSupervisorScope;
};

/** Applies single-ID filters or supervisor OR-scope — mutually exclusive with supervisorScope vs bare IDs. */
export function appendOrdersAggregateScopeConditions(
  conditions: Parameters<typeof and>[0][],
  opts: {
    mediaBuyerId?: string;
    assignedCsId?: string;
    supervisorScope?: OrdersAggregateSupervisorScope;
  },
): void {
  if (opts.supervisorScope) {
    const { csUserIds, mediaBuyerIds } = opts.supervisorScope;
    const orParts: ReturnType<typeof inArray>[] = [];
    if (csUserIds.length > 0) orParts.push(inArray(schema.orders.assignedCsId, csUserIds));
    if (mediaBuyerIds.length > 0) orParts.push(inArray(schema.orders.mediaBuyerId, mediaBuyerIds));
    if (orParts.length === 0) conditions.push(sql`FALSE`);
    else {
      const combined = or(...orParts);
      if (combined) conditions.push(combined);
    }
    return;
  }
  if (opts.mediaBuyerId) conditions.push(eq(schema.orders.mediaBuyerId, opts.mediaBuyerId));
  if (opts.assignedCsId) conditions.push(eq(schema.orders.assignedCsId, opts.assignedCsId));
}

/** Undelivered vs preferred date: exclude terminal / returned rows (OrdersService.list delivery_overdue). */
const DELIVERY_OVERDUE_EXCLUDED_STATUSES = [
  'DELIVERED',
  'REMITTED',
  'CANCELLED',
  'DELETED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  'PARTIALLY_DELIVERED',
] as const;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly cartService: CartService,
    private readonly inventoryService: InventoryService,
    private readonly paystackService: PaystackService,
    private readonly branchTeams: BranchTeamsService,
    private readonly cache: CacheService,
    private readonly csOrderRouting: CsOrderRoutingService,
  ) {}

  /** Per-order detail cache key used by `getById`. Kept here so the router-side
   *  invalidator (`invalidateOrderDetailCache`) can target the same key without
   *  reaching back into this service. */
  private static readonly ORDER_DETAIL_CACHE_KEY = (orderId: string) =>
    `cache:orders:detail:${orderId}`;
  private static readonly ORDER_DETAIL_CACHE_TTL_SECONDS = 60;

  /** HoCS / Admin / `orders.reassign`, or Sales team supervisor for same-branch team (supervisor: UNPROCESSED / CS_ASSIGNED only). */
  /**
   * Order statuses that block any CS-reassignment regardless of permission —
   * the row is administratively done (cancelled, soft-deleted, written off,
   * restocked back to inventory). Reattributing these would lie about who
   * owns work that no longer counts.
   */
  private static readonly CS_REASSIGN_TERMINAL_BLOCK = new Set([
    'CANCELLED',
    'DELETED',
    'RESTOCKED',
    'WRITTEN_OFF',
  ]);

  /**
   * Statuses where a `assignToCS` call should ALSO flip `status` to CS_ASSIGNED.
   * Past these, an assignee swap is a late-stage credit-attribution fix and the
   * existing status MUST be preserved.
   */
  private static readonly CS_REASSIGN_PRE_ENGAGEMENT = new Set([
    'UNPROCESSED',
    'CS_ASSIGNED',
    'CS_ENGAGED',
  ]);

  private async assertCanManualAssignToCs(
    actor: SessionUser,
    csCloserId: string,
    orderBranchId: string,
    orderStatus: string,
  ): Promise<void> {
    if (OrdersService.CS_REASSIGN_TERMINAL_BLOCK.has(orderStatus)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Orders in ${orderStatus} state cannot be reassigned — they are administratively closed.`,
      });
    }

    const perms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasReassign = perms.includes(canonicalPermissionCode('orders.reassign'));
    const hasLateStageTransfer = perms.includes(canonicalPermissionCode('orders.cs.transfer_any_status'));
    const isLateStage = !OrdersService.CS_REASSIGN_PRE_ENGAGEMENT.has(orderStatus);

    if (actor.role === 'SUPER_ADMIN') return;

    // Late-stage transfers (post-CS_ENGAGED) require the dedicated capability.
    // HoCS / SuperAdmin hold it by default; Admin inherits via snapshot.
    if (isLateStage) {
      if (!hasLateStageTransfer) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Only Head of CS or Super Admin may transfer an order to a different Sales closer at this status.',
        });
      }
      return;
    }

    if (hasReassign) return;
    if (!actor.currentBranchId || actor.currentBranchId !== orderBranchId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You cannot assign orders outside your active branch.',
      });
    }
    const ok = await this.branchTeams.isCsSupervisorOf(actor.id, csCloserId, orderBranchId);
    if (!ok) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Head of CS, Admin, or a CS supervisor for this agent may assign orders.',
      });
    }
  }

  /**
   * True when the actor may change line unit prices (and derived totals) on this order.
   *
   * Capability gate: caller must hold `orders.line_price.edit`. SuperAdmin bypasses.
   * Scope gate (runs after capability passes): org-wide via `cs.scope.global` /
   * `logistics.scope.global` → any branch; otherwise same-branch only; Sales team supervisors
   * additionally pass for the orders of agents they supervise.
   */
  async canActorEditOrderLinePrices(
    actor: SessionUser,
    order: { branchId: string | null; assignedCsId: string | null },
  ): Promise<boolean> {
    if (actor.role === 'SUPER_ADMIN') return true;
    const perms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    if (!perms.includes(canonicalPermissionCode('orders.line_price.edit'))) return false;
    const ob = order.branchId;
    if (!ob) return false;
    // Global scope (org-wide heads + admin who hold scope.global codes) → any branch.
    if (
      perms.includes(canonicalPermissionCode('cs.scope.global')) ||
      perms.includes(canonicalPermissionCode('logistics.scope.global'))
    ) {
      return true;
    }
    const cb = actor.currentBranchId ?? null;
    if (!cb || ob !== cb) return false;
    // Same-branch capability holders (e.g. Branch Admin) pass; otherwise fall back to
    // the supervisor relationship for CS-team supervisors who only hold the capability.
    if (perms.includes(canonicalPermissionCode('branches.manage'))) return true;
    if (order.assignedCsId) {
      return this.branchTeams.isCsSupervisorOf(actor.id, order.assignedCsId, ob);
    }
    return false;
  }

  /** Branch Sales team: actor is a supervisor row for this assignee on this branch. */
  async isActorCsTeamSupervisor(actorId: string, assignedCsId: string, branchId: string): Promise<boolean> {
    return this.branchTeams.isCsSupervisorOf(actorId, assignedCsId, branchId);
  }

  private async assertActorMayUpdateOrder(
    actor: SessionUser,
    order: { branchId: string | null; assignedCsId: string | null; status: string },
  ): Promise<void> {
    if (actor.role === 'SUPER_ADMIN') return;

    const perms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const has = (code: string) => perms.includes(canonicalPermissionCode(code));
    const ob = order.branchId;

    // Branchless orders require explicit any_branch capability.
    if (!ob) {
      if (has('orders.update.any_branch')) return;
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This order has no branch context and you lack the org-wide update capability.',
      });
    }

    // Org-wide scope on branched orders.
    if (
      has('orders.update.any_branch') ||
      has('cs.scope.global') ||
      has('logistics.scope.global')
    ) {
      return;
    }

    // Same-branch admin (Branch Admin).
    if (has('branches.manage') && actor.currentBranchId === ob) return;

    // Sales team supervisor for the assignee in same branch.
    if (order.assignedCsId && actor.currentBranchId === ob) {
      const sup = await this.branchTeams.isCsSupervisorOf(actor.id, order.assignedCsId, ob);
      if (sup) return;
    }

    // Contextual ownership: assignee themselves, or claiming an unprocessed pool order.
    if (order.assignedCsId === actor.id) return;
    if (order.status === 'UNPROCESSED' && !order.assignedCsId && has('orders.read')) return;

    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not allowed to update this order.',
    });
  }

  /** PENDING permission_request for this order's line price change (if any). */
  async findPendingOrderLinePriceRequest(orderId: string): Promise<{ id: string; payload: unknown; reason: string; requesterName: string | null } | null> {
    const [row] = await this.db
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
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'ORDER_LINE_PRICE_CHANGE'),
          sql`(${schema.permissionRequests.payload}->>'orderId') = ${orderId}`,
        ),
      )
      .limit(1);
    if (!row) return null;
    // Resolve requester name
    let requesterName: string | null = null;
    if (row.requesterId) {
      const [u] = await this.db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, row.requesterId)).limit(1);
      requesterName = u?.name ?? null;
    }
    return { id: row.id, payload: row.payload, reason: row.reason, requesterName };
  }

  /** PENDING permission_request to archive (soft-delete) this order (if any). */
  async findPendingOrderDeletionRequestId(orderId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.permissionRequests.id })
      .from(schema.permissionRequests)
      .where(
        and(
          eq(schema.permissionRequests.status, 'PENDING'),
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'ORDER_DELETION'),
          sql`(${schema.permissionRequests.payload}->>'orderId') = ${orderId}`,
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  async findPendingDeliveredOrderDeletionRequestId(orderId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.permissionRequests.id })
      .from(schema.permissionRequests)
      .where(
        and(
          eq(schema.permissionRequests.status, 'PENDING'),
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'DELIVERED_ORDER_DELETION'),
          sql`(${schema.permissionRequests.payload}->>'orderId') = ${orderId}`,
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  private async proposedLineItemPricingDiffersFromDatabase(
    orderId: string,
    items: RequestOrderLinePriceChangeInput['items'],
  ): Promise<boolean> {
    const dbRows = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .orderBy(asc(schema.orderItems.id));
    if (dbRows.length !== items.length) return true;
    const used = new Set<number>();
    for (const it of items) {
      const idx = dbRows.findIndex((r, i) => !used.has(i) && r.productId === it.productId);
      if (idx === -1) return true;
      used.add(idx);
      const row = dbRows[idx]!;
      const dbp = parseFloat(String(row.unitPrice));
      if (Number.isNaN(dbp) || Math.abs(dbp - it.unitPrice) > 0.0001) return true;
      // Also detect offer label or quantity changes — CS closers switching
      // offer tiers must go through the same approval flow even if the price
      // happens to remain identical (CEO directive 2026-05-28).
      if ((it.offerLabel ?? null) !== (row.offerLabel ?? null)) return true;
      if (it.quantity !== row.quantity) return true;
    }
    return false;
  }

  private async notifyOrderLinePriceChangeApprovers(params: {
    requestId: string;
    orderId: string;
    branchId: string | null;
    servicingBranchId: string | null;
    requesterName: string | null;
    excludeUserId: string;
  }): Promise<void> {
    const short = params.orderId.slice(0, 8).toUpperCase();
    const title = 'Order item change — approval needed';
    const body = `${params.requesterName ?? 'A teammate'} requested changes to items on order ${short}. Review it under Permission Requests.`;
    const data: Record<string, string> = {
      requestId: params.requestId,
      orderId: params.orderId,
      permissionRequestKind: 'order_line_price',
    };

    // Collect both marketing + servicing branch IDs — HoCS is matched by
    // servicing branch (where they work), BRANCH_ADMIN by either.
    const branchIdSet = new Set<string>();
    if (params.branchId) branchIdSet.add(params.branchId);
    if (params.servicingBranchId) branchIdSet.add(params.servicingBranchId);
    const branchIds = [...branchIdSet];

    const recipientIds = new Set<string>();
    const [admins, heads, hoLogistics] = await Promise.all([
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.status, 'ACTIVE'), inArray(schema.users.role, ['SUPER_ADMIN', 'ADMIN']))),
      branchIds.length > 0
        ? this.db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(
              and(
                eq(schema.users.status, 'ACTIVE'),
                inArray(schema.users.role, ['HEAD_OF_CS', 'BRANCH_ADMIN']),
                inArray(schema.users.primaryBranchId, branchIds),
              ),
            )
        : Promise.resolve([] as Array<{ id: string }>),
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.status, 'ACTIVE'), eq(schema.users.role, 'HEAD_OF_LOGISTICS'))),
    ]);
    for (const r of [...admins, ...heads, ...hoLogistics]) {
      if (r.id !== params.excludeUserId) recipientIds.add(r.id);
    }

    for (const userId of recipientIds) {
      this.notifications.enqueueCreate({
        userId,
        type: 'approval:permission_request',
        title,
        body,
        data,
      });
    }
  }

  private async notifyOrderDeletionApprovers(params: {
    requestId: string;
    orderId: string;
    branchId: string | null;
    servicingBranchId: string | null;
    requesterName: string | null;
    excludeUserId: string;
  }): Promise<void> {
    const short = params.orderId.slice(0, 8).toUpperCase();
    const title = 'Order archive — approval needed';
    const body = `${params.requesterName ?? 'A teammate'} requested to archive (soft-delete) order ${short}. Review under Permission Requests.`;
    const data: Record<string, string> = {
      requestId: params.requestId,
      orderId: params.orderId,
      permissionRequestKind: 'order_deletion',
    };

    const branchIdSet = new Set<string>();
    if (params.branchId) branchIdSet.add(params.branchId);
    if (params.servicingBranchId) branchIdSet.add(params.servicingBranchId);
    const branchIds = [...branchIdSet];

    const recipientIds = new Set<string>();
    const [admins, heads, hoLogisticsDeletion] = await Promise.all([
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.status, 'ACTIVE'), inArray(schema.users.role, ['SUPER_ADMIN', 'ADMIN']))),
      branchIds.length > 0
        ? this.db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(
              and(
                eq(schema.users.status, 'ACTIVE'),
                inArray(schema.users.role, ['HEAD_OF_CS', 'BRANCH_ADMIN']),
                inArray(schema.users.primaryBranchId, branchIds),
              ),
            )
        : Promise.resolve([] as Array<{ id: string }>),
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.status, 'ACTIVE'), eq(schema.users.role, 'HEAD_OF_LOGISTICS'))),
    ]);
    for (const r of [...admins, ...heads, ...hoLogisticsDeletion]) {
      if (r.id !== params.excludeUserId) recipientIds.add(r.id);
    }

    for (const userId of recipientIds) {
      this.notifications.enqueueCreate({
        userId,
        type: 'approval:permission_request',
        title,
        body,
        data,
      });
    }
  }

  /**
   * CS (and others who cannot set prices directly) submit a permission_request; an approver applies `orders.update`.
   */
  async requestLinePriceChangeApproval(
    input: RequestOrderLinePriceChangeInput,
    actor: SessionUser,
    orderType?: 'followUp' | 'cart',
  ) {
    let orderBranchId: string | null = null;
    let orderStatus: string = '';
    let orderNumber: number | null = null;
    let orderAssignedCsId: string | null = null;

    if (orderType === 'followUp') {
      const [fu] = await this.db
        .select({ id: schema.followUpOrders.id, status: schema.followUpOrders.status, branchId: schema.followUpOrders.branchId, servicingBranchId: schema.followUpOrders.servicingBranchId, assignedCsId: schema.followUpOrders.assignedCsId, orderNumber: schema.followUpOrders.orderNumber })
        .from(schema.followUpOrders)
        .where(eq(schema.followUpOrders.id, input.orderId))
        .limit(1);
      if (!fu) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });
      orderBranchId = fu.servicingBranchId ?? fu.branchId ?? null;
      orderStatus = fu.status;
      orderNumber = fu.orderNumber;
      orderAssignedCsId = fu.assignedCsId ?? null;
    } else if (orderType === 'cart') {
      const [co] = await this.db
        .select({ id: schema.cartOrders.id, status: schema.cartOrders.status, branchId: schema.cartOrders.branchId, servicingBranchId: schema.cartOrders.servicingBranchId, assignedCsId: schema.cartOrders.assignedCsId, orderNumber: schema.cartOrders.orderNumber })
        .from(schema.cartOrders)
        .where(eq(schema.cartOrders.id, input.orderId))
        .limit(1);
      if (!co) throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart order not found' });
      orderBranchId = co.servicingBranchId ?? co.branchId ?? null;
      orderStatus = co.status;
      orderNumber = co.orderNumber;
      orderAssignedCsId = co.assignedCsId ?? null;
    } else {
      const existingRows = await this.db
        .select()
        .from(schema.orders)
        .where(and(eq(schema.orders.id, input.orderId), isNull(schema.orders.deletedAt)))
        .limit(1);
      const order = existingRows[0];
      if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      orderBranchId = order.branchId ?? null;
      orderStatus = order.status;
      orderNumber = order.orderNumber ?? null;
      orderAssignedCsId = order.assignedCsId ?? null;
    }

    const blockedStatuses = ['DELIVERED', 'REMITTED'];
    if (blockedStatuses.includes(orderStatus)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Order items cannot be adjusted after delivery.',
      });
    }

    // Skip assertActorMayUpdateOrder for follow-up/cart — the permission procedure already gates access
    if (!orderType) {
      await this.assertActorMayUpdateOrder(actor, {
        branchId: orderBranchId,
        assignedCsId: orderAssignedCsId,
        status: orderStatus,
      });
    }

    const mayEditPrices = await this.canActorEditOrderLinePrices(actor, {
      branchId: orderBranchId,
      assignedCsId: orderAssignedCsId,
    });
    if (mayEditPrices) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You can change order items directly — no approval request is needed.',
      });
    }

    // unitPrice is the offer/line total (not per-unit) — sum directly
    const sumLines = input.items.reduce((s, it) => s + it.unitPrice, 0);
    if (Math.abs(sumLines - input.totalAmount) > 0.02) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Total amount must match the sum of line prices.',
      });
    }

    // proposedLineItemPricingDiffersFromDatabase only works for the main orders table
    if (!orderType) {
      const differs = await this.proposedLineItemPricingDiffersFromDatabase(input.orderId, input.items);
      if (!differs) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one item must differ (price, offer, or quantity) from the current order to submit an approval request.',
        });
      }
    }

    const [duplicate] = await this.db
      .select({ id: schema.permissionRequests.id })
      .from(schema.permissionRequests)
      .where(
        and(
          eq(schema.permissionRequests.status, 'PENDING'),
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'ORDER_LINE_PRICE_CHANGE'),
          sql`(${schema.permissionRequests.payload}->>'orderId') = ${input.orderId}`,
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'An item change request is already pending for this order.',
      });
    }

    const payload = {
      orderId: input.orderId,
      orderNo: orderNumber ?? null,
      ...(orderType ? { orderType } : {}),
      items: input.items,
      totalAmount: input.totalAmount,
    };

    const [req] = await withActor(this.db, actor, async (tx) =>
      tx
        .insert(schema.permissionRequests)
        .values({
          type: 'ORDER_LINE_PRICE_CHANGE',
          status: 'PENDING',
          requesterId: actor.id,
          reason: input.reason,
          payload: payload as unknown as Record<string, unknown>,
        })
        .returning({ id: schema.permissionRequests.id }),
    );

    if (!req?.id) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create approval request' });
    }

    // Surface the request on the order timeline so the Sales rep, HoCS, and any approver
    // can see "<actor> proposed price change pending approval" right alongside the
    // other order events. Without this, the request was completely invisible on the
    // detail page until the approver acted on it.
    const proposedTotalForTimeline = Math.round(input.totalAmount * 100) / 100;
    const reasonSnippet =
      input.reason.length > 80 ? `${input.reason.slice(0, 77)}…` : input.reason;
    // Only write timeline event for normal orders — follow-up/cart have separate timeline tables
    if (!orderType) {
      void this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: 'LINE_PRICE_CHANGE_REQUESTED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description:
          `${actor.name ?? 'Staff'} proposed a line price change pending approval — ` +
          `new total ₦${proposedTotalForTimeline.toLocaleString('en-NG')}. Reason: "${reasonSnippet}"`,
        metadata: {
          permissionRequestId: req.id,
          proposedItems: input.items,
          proposedTotalAmount: input.totalAmount,
          reason: input.reason,
        },
        branchId: orderBranchId,
      });
    }

    void this.notifyOrderLinePriceChangeApprovers({
      requestId: req.id,
      orderId: input.orderId,
      branchId: orderBranchId,
      servicingBranchId: orderBranchId,
      requesterName: actor.name ?? null,
      excludeUserId: actor.id,
    });

    return { success: true as const, requestId: req.id };
  }

  /**
   * CS (and others without archive authority) request soft-delete; approver sets `deleted_at` (row kept).
   */
  async requestOrderDeletionApproval(input: RequestOrderDeletionInput, actor: SessionUser) {
    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, input.orderId), isNull(schema.orders.deletedAt)))
      .limit(1);
    const order = existingRows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    if (!ARCHIVABLE_ORDER_STATUSES.includes(order.status as (typeof ARCHIVABLE_ORDER_STATUSES)[number])) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Only unprocessed or CS-stage orders can be archived this way. Cancel the order first if it is already confirmed.',
      });
    }

    await this.assertActorMayUpdateOrder(actor, {
      branchId: order.branchId ?? null,
      assignedCsId: order.assignedCsId ?? null,
      status: order.status,
    });

    const mayArchiveDirectly = await this.canActorEditOrderLinePrices(actor, {
      branchId: order.branchId ?? null,
      assignedCsId: order.assignedCsId ?? null,
    });
    if (mayArchiveDirectly) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You can archive this order immediately from the order page — no approval request is needed.',
      });
    }

    const [duplicate] = await this.db
      .select({ id: schema.permissionRequests.id })
      .from(schema.permissionRequests)
      .where(
        and(
          eq(schema.permissionRequests.status, 'PENDING'),
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'ORDER_DELETION'),
          sql`(${schema.permissionRequests.payload}->>'orderId') = ${input.orderId}`,
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'An archive request is already pending for this order.',
      });
    }

    const payload = { orderId: input.orderId, orderNo: order.orderNumber ?? null };

    const [req] = await withActor(this.db, actor, async (tx) =>
      tx
        .insert(schema.permissionRequests)
        .values({
          type: 'ORDER_DELETION',
          status: 'PENDING',
          requesterId: actor.id,
          reason: input.reason,
          payload: payload as unknown as Record<string, unknown>,
        })
        .returning({ id: schema.permissionRequests.id }),
    );

    if (!req?.id) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create approval request' });
    }

    void this.notifyOrderDeletionApprovers({
      requestId: req.id,
      orderId: input.orderId,
      branchId: order.branchId ?? null,
      servicingBranchId: order.servicingBranchId ?? null,
      requesterName: actor.name ?? null,
      excludeUserId: actor.id,
    });

    return { success: true as const, requestId: req.id };
  }

  /**
   * Soft-delete: transitions order to DELETED status and sets `deleted_at`.
   * DELETED orders are excluded from ALL metrics/counts but the row stays in
   * the DB for audit trail. Admin/SuperAdmin can restore to UNPROCESSED.
   * The `deleted_at` timestamp is also set for backward compat with existing
   * `isNull(deleted_at)` filters throughout the codebase.
   */
  async softDeleteOrder(
    orderId: string,
    actor: SessionUser,
    opts?: { approverNote?: string },
  ): Promise<{ success: true }> {
    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    const order = existingRows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    if (order.status === 'DELETED') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order is already deleted.' });
    }

    if (!ARCHIVABLE_ORDER_STATUSES.includes(order.status as (typeof ARCHIVABLE_ORDER_STATUSES)[number])) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Only pre-confirmation or cancelled orders can be deleted. Orders past confirmation have inventory side effects.',
      });
    }

    // Permission-gated: `orders.delete` — Admin/SuperAdmin by default, can be
    // delegated to other roles via the permission matrix (CEO directive 2026-05-23).
    const perms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    if (!isAdminLevel(actor) && !perms.includes(canonicalPermissionCode('orders.delete'))) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to delete orders. Contact an Admin to get the orders.delete permission.',
      });
    }

    const note = opts?.approverNote?.trim();
    const actorLabel = actor.name ?? 'Staff';
    const description = note
      ? `Order deleted (removed from metrics). Note: ${note.slice(0, 500)}`
      : `Order deleted (removed from metrics) by ${actorLabel}.`;

    const now = new Date();
    await withActor(this.db, actor, async (tx) => {
      const updatedRows = await tx
        .update(schema.orders)
        .set({ status: 'DELETED', deletedAt: now, updatedAt: now })
        .where(eq(schema.orders.id, orderId))
        .returning({ id: schema.orders.id });
      if (!updatedRows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
      }
      await tx.insert(schema.orderTimelineEvents).values({
        orderId,
        eventType: 'ORDER_DELETED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description,
        metadata: note ? { note } : null,
        branchId: order.branchId ?? null,
      });
    });

    // The order just dropped out of the active set — bust the status-count /
    // time-series cache so marketing/CS overview strips don't keep counting
    // it. The tRPC `softDeleteOrder` procedure also invalidates, but archiving
    // via the order-deletion approval flow goes straight through this service
    // method, bypassing that router call. Mirrors `invalidateOrdersAggregatesCache`.
    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    return { success: true };
  }

  // ============================================
  // Delivered Order Deletion — Finance-initiated, dual-approval (HoCS + HoL)
  // ============================================

  /** Statuses eligible for Finance-initiated deletion (post-delivery duplicates). */
  private static readonly DELIVERED_DELETION_STATUSES = ['DELIVERED', 'REMITTED'] as const;

  /**
   * Finance requests deletion of a DELIVERED/REMITTED order. Creates a
   * DELIVERED_ORDER_DELETION permission request requiring dual approval
   * from both HoCS and HoL before the order is soft-deleted + stock reversed.
   */
  async requestDeliveredOrderDeletion(
    input: RequestDeliveredOrderDeletionInput,
    actor: SessionUser,
  ) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, input.orderId), isNull(schema.orders.deletedAt)))
      .limit(1);
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    if (
      !OrdersService.DELIVERED_DELETION_STATUSES.includes(
        order.status as (typeof OrdersService.DELIVERED_DELETION_STATUSES)[number],
      )
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only delivered or remitted orders can be requested for deletion via this flow.',
      });
    }

    // Permission gate: orders.deletion.request or finance access
    const perms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    if (
      !isAdminLevel(actor) &&
      !perms.includes(canonicalPermissionCode('orders.deletion.request')) &&
      !hasFinanceAccess(actor)
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to request delivered order deletion.',
      });
    }

    // Check for existing pending request
    const [duplicate] = await this.db
      .select({ id: schema.permissionRequests.id })
      .from(schema.permissionRequests)
      .where(
        and(
          eq(schema.permissionRequests.status, 'PENDING'),
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'DELIVERED_ORDER_DELETION'),
          sql`(${schema.permissionRequests.payload}->>'orderId') = ${input.orderId}`,
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A deletion request is already pending for this order.',
      });
    }

    const payload = {
      orderId: input.orderId,
      orderNo: order.orderNumber ?? null,
      orderStatus: order.status,
    };

    const [req] = await withActor(this.db, actor, async (tx) =>
      tx
        .insert(schema.permissionRequests)
        .values({
          type: 'DELIVERED_ORDER_DELETION',
          status: 'PENDING',
          requesterId: actor.id,
          reason: input.reason,
          payload: payload as unknown as Record<string, unknown>,
        })
        .returning({ id: schema.permissionRequests.id }),
    );

    if (!req?.id) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create deletion request',
      });
    }

    void this.notifyOrderDeletionApprovers({
      requestId: req.id,
      orderId: input.orderId,
      branchId: order.branchId ?? null,
      servicingBranchId: order.servicingBranchId ?? null,
      requesterName: actor.name ?? null,
      excludeUserId: actor.id,
    });

    return { success: true as const, requestId: req.id };
  }

  /**
   * Soft-delete a DELIVERED/REMITTED order after dual approval.
   * Sets status to DELETED, reverses stock via inventory ADJUSTMENT movements,
   * and logs the full dual-approval context in the timeline.
   */
  async softDeleteDeliveredOrder(
    orderId: string,
    actor: SessionUser,
    opts?: { approverNote?: string; csApproverName?: string; logiApproverName?: string },
  ): Promise<{ success: true }> {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }
    if (order.status === 'DELETED') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order is already deleted.' });
    }

    const note = opts?.approverNote?.trim();
    const csLabel = opts?.csApproverName ?? 'CS Head';
    const logiLabel = opts?.logiApproverName ?? 'Logistics Head';
    const description = [
      'Order deleted via dual-approval (Finance request).',
      `CS approved by ${csLabel}.`,
      `Logistics approved by ${logiLabel}.`,
      ...(note ? [`Note: ${note.slice(0, 500)}`] : []),
    ].join(' ');

    const now = new Date();
    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.orders)
        .set({ status: 'DELETED', deletedAt: now, updatedAt: now })
        .where(eq(schema.orders.id, orderId));
      await tx.insert(schema.orderTimelineEvents).values({
        orderId,
        eventType: 'ORDER_DELETED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description,
        metadata: { dualApproval: true, ...(note ? { note } : {}) },
        branchId: order.branchId ?? null,
      });
    });

    // Reverse stock: create ADJUSTMENT movements to undo the DELIVERY deduction
    try {
      await this.inventoryService.reverseDeliveryForOrder(orderId, actor);
    } catch (err) {
      // Stock reversal is critical but shouldn't block the deletion.
      // Log the error — manual inventory correction may be needed.
      console.error(
        `[softDeleteDeliveredOrder] Stock reversal failed for order ${orderId}:`,
        err,
      );
    }

    await this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

    return { success: true };
  }

  /**
   * Resolves `branch_id` for a newly created order: campaign branch wins, else media buyer's
   * primary branch from `user_branches`, else explicit fallback (e.g. session branch).
   */
  private async resolveBranchIdForNewOrder(params: {
    campaignId?: string | null;
    mediaBuyerId?: string | null;
    fallbackBranchId?: string | null;
  }): Promise<string | null> {
    if (params.campaignId) {
      const [row] = await this.db
        .select({ branchId: schema.campaigns.branchId })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, params.campaignId))
        .limit(1);
      if (row?.branchId) return row.branchId;
    }
    if (params.mediaBuyerId) {
      const [row] = await this.db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.userId, params.mediaBuyerId))
        .orderBy(desc(schema.userBranches.isPrimary))
        .limit(1);
      if (row?.branchId) return row.branchId;
    }
    return params.fallbackBranchId ?? null;
  }

  /** Edge tamper gate: order lines must match allowlisted tiers for this campaign (templates or legacy base price). */
  private async assertEdgeFormLineItemsAllowlisted(orderInput: CreateOrderInput): Promise<void> {
    const campaignId = orderInput.campaignId;
    if (!campaignId) return;

    const [camp] = await this.db
      .select({
        productIds: schema.campaigns.productIds,
        formConfig: schema.campaigns.formConfig,
        offerGroupId: schema.campaigns.offerGroupId,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    const priceNearlyEq = (a: number, b: number) => Math.abs(a - b) < 0.02;

    if (camp?.offerGroupId) {
      const rows = await this.db
        .select({
          productId: schema.offerGroupItems.productId,
          label: schema.offerGroupItems.label,
          price: schema.offerGroupItems.price,
          quantity: schema.offerGroupItems.quantity,
        })
        .from(schema.offerGroupItems)
        .where(
          and(
            eq(schema.offerGroupItems.offerGroupId, camp.offerGroupId),
            eq(schema.offerGroupItems.status, 'ACTIVE'),
          ),
        );

      if (rows.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This campaign offer has no active items.',
        });
      }

      for (const item of orderInput.items) {
        const tierCandidates = rows.filter(
          (r) =>
            r.productId === item.productId &&
            (r.quantity ?? 1) === item.quantity &&
            priceNearlyEq(Number(r.price), Number(item.unitPrice)),
        );

        let ok = false;
        const labelTrim = (item.offerLabel ?? '').trim();
        if (labelTrim.length > 0) {
          ok = tierCandidates.some((t) => t.label.trim() === labelTrim);
        } else if (tierCandidates.length === 1) {
          ok = true;
        }

        if (!ok) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Offer selection does not match this form.',
          });
        }
      }
      return;
    }

    const campaignProductId = ((camp?.productIds ?? []) as string[])[0];
    if (!campaignProductId) return;

    const selectedIds = (
      camp?.formConfig as { selectedOfferTemplateIds?: string[] } | null | undefined
    )?.selectedOfferTemplateIds;

    const tmplConds = [
      eq(schema.offerTemplates.productId, campaignProductId),
      eq(schema.offerTemplates.status, 'ACTIVE'),
    ];
    if (selectedIds?.length) {
      tmplConds.push(inArray(schema.offerTemplates.id, selectedIds));
    }

    const allowList = await this.db
      .select({
        name: schema.offerTemplates.name,
        price: schema.offerTemplates.price,
        quantity: schema.offerTemplates.quantity,
      })
      .from(schema.offerTemplates)
      .where(and(...tmplConds));

    let synthetic: typeof allowList = [];

    if (allowList.length === 0) {
      const [p] = await this.db
        .select({
          baseSalePrice: schema.products.baseSalePrice,
          offers: schema.products.offers,
        })
        .from(schema.products)
        .where(eq(schema.products.id, campaignProductId))
        .limit(1);
      if (!p) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Product not found for this campaign.',
        });
      }
      const embedded = p.offers as Array<{ label?: string; qty?: number; price?: string | number }> | null;
      if (Array.isArray(embedded) && embedded.length > 0) {
        synthetic = embedded.map((o) => ({
          name: typeof o.label === 'string' ? o.label : 'Offer',
          price: String(o.price ?? p.baseSalePrice),
          quantity: typeof o.qty === 'number' && o.qty >= 1 ? o.qty : 1,
        }));
      } else {
        synthetic = [{ name: 'Standard', price: String(p.baseSalePrice), quantity: 1 }];
      }
    }

    const tiers = synthetic.length ? synthetic : allowList;

    for (const item of orderInput.items) {
      if (item.productId !== campaignProductId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Product does not match this campaign.',
        });
      }

      const unitNum = Number(item.unitPrice);
      const templateQty = item.quantity;
      const labelTrim = (item.offerLabel ?? '').trim();

      const candidates = tiers.filter(
        (t) =>
          (t.quantity ?? 1) === templateQty && priceNearlyEq(Number(t.price), unitNum),
      );

      let ok = false;
      if (labelTrim.length > 0) {
        ok = candidates.some((t) => t.name.trim() === labelTrim);
      } else if (candidates.length === 1) {
        ok = true;
      }

      if (!ok) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Offer selection does not match this form.',
        });
      }
    }
  }

  /**
   * Campaign-scoped offer tiers for each product on an order. Powers the
   * "select an offer" picker in the Adjust order items modal — picking a tier
   * sets quantity + unit price together so a bundled discount applies instead
   * of hand-editing the amount. Tier resolution mirrors the edge-form tamper
   * gate (`assertEdgeFormLineItemsAllowlisted`): offer group → campaign-selected
   * offer templates → embedded product offers → a single "Standard" base tier.
   * Returns an empty tier list for products with no offers (UI falls back to
   * manual "Custom" entry).
   */
  async listOrderItemOffers(orderId: string, actor: SessionUser) {
    const [order] = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }
    this.assertActorMayViewOrderForRead(actor, order);

    const itemRows = await this.db
      .select({ productId: schema.orderItems.productId })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId));
    const orderProductIds = [...new Set(itemRows.map((r) => r.productId))];
    if (orderProductIds.length === 0) return [];

    type Tier = { label: string; quantity: number; unitPrice: number };
    const tiersByProduct = new Map<string, Tier[]>();

    if (order.campaignId) {
      const [camp] = await this.db
        .select({
          productIds: schema.campaigns.productIds,
          formConfig: schema.campaigns.formConfig,
          offerGroupId: schema.campaigns.offerGroupId,
        })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, order.campaignId))
        .limit(1);

      if (camp?.offerGroupId) {
        const rows = await this.db
          .select({
            productId: schema.offerGroupItems.productId,
            label: schema.offerGroupItems.label,
            price: schema.offerGroupItems.price,
            quantity: schema.offerGroupItems.quantity,
          })
          .from(schema.offerGroupItems)
          .where(
            and(
              eq(schema.offerGroupItems.offerGroupId, camp.offerGroupId),
              eq(schema.offerGroupItems.status, 'ACTIVE'),
            ),
          );
        for (const r of rows) {
          const list = tiersByProduct.get(r.productId) ?? [];
          list.push({ label: r.label, quantity: r.quantity ?? 1, unitPrice: Number(r.price) });
          tiersByProduct.set(r.productId, list);
        }
      } else {
        const campaignProductId = ((camp?.productIds ?? []) as string[])[0];
        if (campaignProductId) {
          const selectedIds = (
            camp?.formConfig as { selectedOfferTemplateIds?: string[] } | null | undefined
          )?.selectedOfferTemplateIds;
          const tmplConds = [
            eq(schema.offerTemplates.productId, campaignProductId),
            eq(schema.offerTemplates.status, 'ACTIVE'),
          ];
          if (selectedIds?.length) {
            tmplConds.push(inArray(schema.offerTemplates.id, selectedIds));
          }
          const templates = await this.db
            .select({
              name: schema.offerTemplates.name,
              price: schema.offerTemplates.price,
              quantity: schema.offerTemplates.quantity,
            })
            .from(schema.offerTemplates)
            .where(and(...tmplConds));

          let tiers: Tier[] = templates.map((t) => ({
            label: t.name,
            quantity: t.quantity ?? 1,
            unitPrice: Number(t.price),
          }));

          if (tiers.length === 0) {
            const [p] = await this.db
              .select({
                baseSalePrice: schema.products.baseSalePrice,
                offers: schema.products.offers,
              })
              .from(schema.products)
              .where(eq(schema.products.id, campaignProductId))
              .limit(1);
            const embedded = (p?.offers ?? []) as Array<{
              label?: string;
              qty?: number;
              price?: string | number;
            }>;
            if (Array.isArray(embedded) && embedded.length > 0) {
              tiers = embedded.map((o) => ({
                label: typeof o.label === 'string' ? o.label : 'Offer',
                quantity: typeof o.qty === 'number' && o.qty >= 1 ? o.qty : 1,
                unitPrice: Number(o.price ?? p?.baseSalePrice ?? 0),
              }));
            } else if (p) {
              tiers = [{ label: 'Standard', quantity: 1, unitPrice: Number(p.baseSalePrice) }];
            }
          }
          if (tiers.length > 0) {
            tiersByProduct.set(campaignProductId, tiers);
          }
        }
      }
    }

    // Fallback for products without campaign-scoped offers (e.g. offline orders):
    // load offer templates or embedded product offers.
    const missingProductIds = orderProductIds.filter((id) => !tiersByProduct.has(id));
    if (missingProductIds.length > 0) {
      // Try offer templates first
      const templates = await this.db
        .select({
          productId: schema.offerTemplates.productId,
          name: schema.offerTemplates.name,
          price: schema.offerTemplates.price,
          quantity: schema.offerTemplates.quantity,
        })
        .from(schema.offerTemplates)
        .where(
          and(
            inArray(schema.offerTemplates.productId, missingProductIds),
            eq(schema.offerTemplates.status, 'ACTIVE'),
          ),
        );
      for (const t of templates) {
        const list = tiersByProduct.get(t.productId) ?? [];
        list.push({ label: t.name, quantity: t.quantity ?? 1, unitPrice: Number(t.price) });
        tiersByProduct.set(t.productId, list);
      }

      // For any still missing, fall back to embedded product offers
      const stillMissing = missingProductIds.filter((id) => !tiersByProduct.has(id));
      if (stillMissing.length > 0) {
        const products = await this.db
          .select({
            id: schema.products.id,
            baseSalePrice: schema.products.baseSalePrice,
            offers: schema.products.offers,
          })
          .from(schema.products)
          .where(inArray(schema.products.id, stillMissing));
        for (const p of products) {
          const embedded = (p.offers ?? []) as Array<{
            label?: string;
            qty?: number;
            price?: string | number;
          }>;
          if (Array.isArray(embedded) && embedded.length > 0) {
            tiersByProduct.set(
              p.id,
              embedded.map((o) => ({
                label: typeof o.label === 'string' ? o.label : 'Offer',
                quantity: typeof o.qty === 'number' && o.qty >= 1 ? o.qty : 1,
                unitPrice: Number(o.price ?? p.baseSalePrice ?? 0),
              })),
            );
          }
        }
      }
    }

    return orderProductIds.map((productId) => ({
      productId,
      offers: tiersByProduct.get(productId) ?? [],
    }));
  }

  /**
   * Create a new order with status UNPROCESSED.
   * Called by Edge Worker or admin manual entry.
   * When paymentMethod is PAY_ONLINE, initializes Paystack and returns authorizationUrl for redirect.
   */
  async create(
    input: CreateOrderInput & { cartId?: string },
    actorId: string | null,
    orderSource?: 'edge-form' | 'offline' | null,
    opts?: { isFollowUp?: boolean },
  ): Promise<{ id?: string; authorizationUrl?: string; duplicateRecorded?: true }> {
    const { cartId, ...orderInput } = input;
    const paymentMethod = orderInput.paymentMethod ?? 'PAY_ON_DELIVERY';

    if (paymentMethod === 'PAY_ONLINE' && (!orderInput.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(orderInput.customerEmail))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email is required for Pay online. Please provide a valid email address.',
      });
    }

    if (orderInput.campaignId) {
      const [campaignRow] = await this.db
        .select({ formConfig: schema.campaigns.formConfig })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, orderInput.campaignId))
        .limit(1);
      const customFieldsRaw = (campaignRow?.formConfig as { customFields?: unknown } | null | undefined)?.customFields;
      if (Array.isArray(customFieldsRaw) && customFieldsRaw.length > 0) {
        const parsed = z.array(customFormFieldSchema).safeParse(customFieldsRaw);
        if (parsed.success) {
          const missing = getMissingRequiredCustomFormLabels(parsed.data, orderInput.customFields);
          if (missing.length > 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Please complete: ${missing.join(', ')}`,
            });
          }
        } else {
          this.logger.debug(
            { campaignId: orderInput.campaignId, zodError: parsed.error.flatten() },
            'Campaign formConfig.customFields failed schema — skipping required-field API check',
          );
        }
      }
    }

    if (orderSource === 'edge-form' && orderInput.campaignId) {
      await this.assertEdgeFormLineItemsAllowlisted(orderInput);
    }

    // Idempotency check for edge-form orders — duplicate-order protection is
    // the API's job (the edge worker no longer keeps its own KV dedup). A
    // double-tap / refresh / retry / QStash replay can deliver the identical
    // submission more than once; if an identical order already landed in the
    // last 24 hours, return THAT order instead of inserting a second. We
    // return idempotently, never reject: rejecting edge-form orders is what
    // caused the 2026-05-19 false-positive incident, and an idempotent return
    // cannot lose a sale. Window extended from 15 min → 24h (CEO 2026-05-24).
    //
    // RACE CONDITION FIX (2026-05-24, hardened 2026-05-29):
    // Concurrent edge-form submissions for the same phone can race past the
    // dedup SELECT before either INSERT commits. We acquire a PostgreSQL
    // advisory lock keyed on the phone hash BEFORE the dedup check.
    // If the lock is contended, we spin-retry up to 5×200ms so the second
    // request sees the first's INSERT. Advisory locks only affect same-phone.
    let advisoryLockAcquired = false;
    let advisoryLockKey1 = 0;
    let advisoryLockKey2 = 0;
    // Declared here so they're accessible after the try/finally block.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let order!: any;
    let servicingBranchId: string | null = null;
    if (orderSource === 'edge-form' && orderInput.customerPhoneHash) {
      const hashHex = orderInput.customerPhoneHash.slice(0, 16);
      advisoryLockKey1 = parseInt(hashHex.slice(0, 8), 16) | 0;
      advisoryLockKey2 = parseInt(hashHex.slice(8, 16), 16) | 0;
      // Spin-retry advisory lock (YNS-12351/12352 fix, 2026-05-29):
      // The old code used a single try_advisory_lock and proceeded immediately
      // on failure, letting both concurrent requests race past the dedup SELECT.
      // Now we retry up to 5×200ms so the second request waits for the first
      // to INSERT, then the dedup SELECT catches it.
      const lockResult = await this.db.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_lock(${advisoryLockKey1}, ${advisoryLockKey2}) AS acquired`,
      );
      const lockRows = Array.isArray(lockResult) ? lockResult : (lockResult as unknown as { rows: Array<{ acquired: boolean }> })?.rows ?? [];
      advisoryLockAcquired = lockRows[0]?.acquired === true;
      if (!advisoryLockAcquired) {
        // Another request for the same phone is in-flight. Instead of
        // proceeding immediately (which caused the YNS-12351/12352 race on
        // 2026-05-29), wait for it to finish its INSERT so our dedup SELECT
        // will see the row. Retry the lock up to 5 times with 200ms delays.
        for (let attempt = 0; attempt < 5 && !advisoryLockAcquired; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          const retryResult = await this.db.execute<{ acquired: boolean }>(
            sql`SELECT pg_try_advisory_lock(${advisoryLockKey1}, ${advisoryLockKey2}) AS acquired`,
          );
          const retryRows = Array.isArray(retryResult) ? retryResult : (retryResult as unknown as { rows: Array<{ acquired: boolean }> })?.rows ?? [];
          advisoryLockAcquired = retryRows[0]?.acquired === true;
        }
        if (!advisoryLockAcquired) {
          // Still couldn't acquire after ~1s. The first request should have
          // committed by now, so our dedup SELECT will likely catch it.
          // Log for monitoring.
          this.logger.warn(
            { phoneHash: orderInput.customerPhoneHash.slice(0, 12) + '…' },
            'advisory lock contended after 5 retries — proceeding with dedup SELECT only',
          );
        }
      }
    }
    try {
    // MARKETING branch — the campaign/form branch this order is attributed to.
    const branchId = await this.resolveBranchIdForNewOrder({
      campaignId: orderInput.campaignId ?? null,
      mediaBuyerId: orderInput.mediaBuyerId ?? null,
      fallbackBranchId: null,
    });

    // CS SERVICING branch — which branch's CS team works this order.
    servicingBranchId = branchId;
    if (branchId) {
      const primaryProductId = orderInput.items[0]?.productId ?? null;
      const servicingBranch = await this.csOrderRouting.resolveServicingBranchForProduct(
        branchId,
        primaryProductId,
      );
      if (servicingBranch) {
        servicingBranchId = servicingBranch;
      }
    }

    // Universal 7-day dedup (CEO directive 2026-05-26):
    // Same phone + any overlapping product within 7 days = duplicate.
    // Any MB, any campaign, any offer. One order per customer×product per week.
    // Duplicates are recorded in cross_funnel_attempts for MB visibility.
    // Customer always sees success (pixel fires, redirect works).
    if (orderSource === 'edge-form' && orderInput.customerPhoneHash) {
      const productIds = orderInput.items.map((i) => i.productId);
      const winner = await this.findExistingOrderForDedup(
        orderInput.customerPhoneHash,
        productIds,
      );
      this.logger.log(
        { phoneHash: orderInput.customerPhoneHash.slice(0, 12) + '…', productIds, winnerFound: !!winner, winnerId: winner?.id },
        'universal dedup check result',
      );
      if (winner) {
        // Always record the cross-funnel attempt — even without mediaBuyerId.
        // Use the winner's MB as fallback so the CFA row is never orphaned.
        const cfaMbId = orderInput.mediaBuyerId ?? winner.mediaBuyerId ?? null;
        if (cfaMbId) {
          try {
            await this.recordCrossFunnelAttempt({
              customerPhoneHash: orderInput.customerPhoneHash,
              customerPhone: orderInput.customerPhone ?? null,
              customerName: orderInput.customerName,
              productIds,
              mediaBuyerId: cfaMbId,
              campaignId: orderInput.campaignId ?? null,
              branchId: branchId ?? null,
              winner: { id: winner.id, mediaBuyerId: winner.mediaBuyerId ?? '' },
            });
          } catch (cfaErr) {
            this.logger.error(
              { err: cfaErr instanceof Error ? cfaErr.message : String(cfaErr) },
              'cross-funnel attempt insert failed — dedup still blocks the order',
            );
          }
        }
        // Convert the cart so it doesn't linger as an abandonment — the customer
        // did submit, even though the order was a duplicate.
        if (cartId) {
          await this.cartService.convert(cartId, winner.id, actorId ?? undefined).catch(() => {});
        } else if (orderInput.campaignId && orderInput.customerPhoneHash && productIds[0]) {
          await this.cartService.convertByPhoneAndProduct(
            orderInput.campaignId,
            orderInput.customerPhoneHash,
            productIds[0],
            winner.id,
            actorId ?? undefined,
          ).catch(() => {});
        }
        this.logger.log(
          {
            winnerId: winner.id,
            winnerStatus: winner.status,
            submittingMbId: orderInput.mediaBuyerId,
            phoneHash: orderInput.customerPhoneHash,
          },
          'universal dedup: duplicate blocked — recorded in cross_funnel_attempts, cart converted',
        );
        return { duplicateRecorded: true as const };
      }
    }

    // Strip null bytes (\0) from all string fields — Postgres rejects 0x00 in
    // UTF-8 text columns. Edge-form submissions occasionally carry null bytes
    // from malformed form data or copy-paste artefacts, which causes
    // INTERNAL_SERVER_ERROR and lands orders in the QStash DLQ.
    const strip0 = (v: string | null | undefined): string | null | undefined =>
      typeof v === 'string' ? v.replace(/\0/g, '') : v;
    // Deep-strip null bytes from jsonb values (customFields, items).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deepStrip0 = <T>(v: T): T => {
      if (typeof v === 'string') return v.replace(/\0/g, '') as unknown as T;
      if (Array.isArray(v)) return v.map(deepStrip0) as unknown as T;
      if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v)) out[k] = deepStrip0(val);
        return out as T;
      }
      return v;
    };

    const insertOrder = async (
      dbOrTx: PostgresJsDatabase<typeof schema> | Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0],
    ) => {
      // Explicitly compute order_number instead of relying on DEFAULT nextval().
      // After backfills/restores the sequence can fall behind existing rows, causing
      // permanent collisions. This picks MAX(order_number)+1 across all three tables
      // and also advances the sequence so follow_up_orders/cart_orders stay in sync.
      const [{ next_num }] = await dbOrTx.execute<{ next_num: number }>(sql`
        SELECT setval('order_number_seq',
          GREATEST(
            nextval('order_number_seq'),
            COALESCE((SELECT MAX(order_number) FROM orders), 0) + 1,
            COALESCE((SELECT MAX(order_number) FROM follow_up_orders), 0) + 1,
            COALESCE((SELECT MAX(order_number) FROM cart_orders), 0) + 1
          )) AS next_num
      `) as unknown as [{ next_num: number }];

      const rows = await dbOrTx
        .insert(schema.orders)
        .values({
          orderNumber: next_num,
          campaignId: orderInput.campaignId ?? null,
          mediaBuyerId: orderInput.mediaBuyerId ?? null,
          branchId: branchId ?? null,
          servicingBranchId: servicingBranchId ?? null,
          customerName: strip0(orderInput.customerName) ?? orderInput.customerName,
          customerPhoneHash: orderInput.customerPhoneHash,
          customerPhone: strip0(orderInput.customerPhone) ?? null,
          customerAddress: strip0(orderInput.customerAddress) ?? null,
          deliveryAddress: strip0(orderInput.deliveryAddress) ?? null,
          deliveryNotes: strip0(orderInput.deliveryNotes) ?? null,
          deliveryState: strip0(orderInput.deliveryState) ?? null,
          customerGender: orderInput.customerGender ?? null,
          preferredDeliveryDate: orderInput.preferredDeliveryDate ?? null,
          customerEmail: strip0(orderInput.customerEmail) ?? null,
          paymentMethod: paymentMethod === 'PAY_ONLINE' ? 'PAY_ONLINE' : 'PAY_ON_DELIVERY',
          paymentStatus: paymentMethod === 'PAY_ONLINE' ? 'PENDING' : null,
          paymentProvider: paymentMethod === 'PAY_ONLINE' ? 'PAYSTACK' : null,
          items: deepStrip0(orderInput.items),
          totalAmount: orderInput.totalAmount != null ? String(orderInput.totalAmount) : null,
          status: 'UNPROCESSED',
          orderSource: orderSource === 'edge-form' ? 'edge-form' : orderSource === 'offline' ? 'offline' : null,
          customFields: orderInput.customFields ? deepStrip0(orderInput.customFields) : null,
          // Back-link to the originating cart so HoCS can filter "Recovered from
          // cart" on /admin/sales/orders (migration 0142). NULL for direct orders.
          cartId: cartId ?? null,
          // Cart-recovered orders are follow-up from birth — never appear in main CS queue.
          ...(opts?.isFollowUp ? { isFollowUp: true } : {}),
        })
        .returning();
      const created = rows[0];
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create order' });
      }
      if (orderInput.items.length > 0) {
        await dbOrTx.insert(schema.orderItems).values(
          orderInput.items.map((item) => ({
            orderId: created.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: String(item.unitPrice),
            offerLabel: strip0(item.offerLabel) ?? null,
          })),
        );
      }
      return created;
    };

    // Retry up to 3 times on order_number sequence collision (rare under
    // concurrency when multiple edge-form submissions hit simultaneously).
    const MAX_ORDER_NUMBER_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_ORDER_NUMBER_RETRIES; attempt++) {
      try {
        order = actorId
          ? await withActor(this.db, { id: actorId }, insertOrder)
          : await insertOrder(this.db);
        break; // success
      } catch (err: unknown) {
        const isSeqCollision =
          err instanceof Error &&
          err.message?.includes('orders_order_number_unique');
        if (!isSeqCollision || attempt === MAX_ORDER_NUMBER_RETRIES - 1) throw err;
        this.logger.warn(`order_number collision — retry ${attempt + 1}/${MAX_ORDER_NUMBER_RETRIES}`);
      }
    }
    } finally {
      // Release advisory lock now that the order row is committed. Concurrent
      // requests for the same phone hash will now see it via findRecentIdenticalOrder.
      if (advisoryLockAcquired) {
        await this.db.execute(sql`SELECT pg_advisory_unlock(${advisoryLockKey1}, ${advisoryLockKey2})`).catch(() => {});
      }
    }

    // Emit real-time event for CS dispatch
    this.events.emitNewOrder({
      orderId: order.id,
      productName: 'Order created',
      branchId: order.branchId ?? null,
      servicingBranchId: servicingBranchId ?? null,
      mediaBuyerId: order.mediaBuyerId ?? null,
    });

    // Notify Head of CS + Head of Marketing only on new order (not every Sales closer — they get
    // order:assigned when Hot Swap / auto-dispatch / claim assigns them). SuperAdmin excluded (volume).
    const orderLabel = `YNS-${String(order.orderNumber).padStart(5, '0')}`;
    const customerLabel = (order.customerName ?? '').trim() || 'A customer';
    const campaignName = order.campaignId
      ? (
          await this.db
            .select({ name: schema.campaigns.name })
            .from(schema.campaigns)
            .where(eq(schema.campaigns.id, order.campaignId))
            .limit(1)
        )[0]?.name ?? null
      : null;

    this.notifications.enqueueCreateForRole('HEAD_OF_CS', {
      type: 'order:new',
      title: `New order ${orderLabel}`,
      body: `${customerLabel} placed an order${campaignName ? ` via ${campaignName}` : ''}.`,
      data: { orderId: order.id, orderNumber: order.orderNumber, customerName: customerLabel },
    });
    this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
      type: 'order:new',
      title: `New order ${orderLabel}`,
      body: `${customerLabel} placed an order${campaignName ? ` via ${campaignName}` : ''}.`,
      data: { orderId: order.id, orderNumber: order.orderNumber, customerName: customerLabel },
    });

    // Notify Media Buyer if order is from their campaign.
    if (order.mediaBuyerId) {
      const body = campaignName
        ? `${customerLabel} just placed an order via ${campaignName}.`
        : `${customerLabel} just placed an order from your campaign.`;
      this.notifications.enqueueCreate({
        userId: order.mediaBuyerId,
        type: 'order:new_campaign',
        title: `New order ${orderLabel}`,
        body,
        data: { orderId: order.id, orderNumber: order.orderNumber, campaignId: order.campaignId ?? null, campaignName, customerName: customerLabel },
      });
    }

    // Auto-dispatch to least-loaded Sales closer
    await this.autoDispatchToCS(order.id);

    const mediaBuyerName = order.mediaBuyerId
      ? await this.resolveUserNameById(order.mediaBuyerId)
      : null;
    const mbSuffix = mediaBuyerName
      ? ` — attributed to media buyer ${mediaBuyerName}`
      : '';
    const isEdgeSubmission =
      orderSource === 'edge-form' ||
      actorId === EDGE_FORM_ACTOR_ID ||
      actorId === null;
    let receivedActorId: string | null;
    let receivedActorName: string | null;
    let receivedDescription: string;
    if (isEdgeSubmission) {
      receivedActorId = actorId ?? EDGE_FORM_ACTOR_ID;
      receivedActorName = 'Edge form';
      receivedDescription = `Order received from sales form${mbSuffix}`;
    } else {
      receivedActorId = actorId;
      receivedActorName = actorId ? await this.resolveUserNameById(actorId) : null;
      receivedDescription = `Order created${mbSuffix}`;
    }

    void this.writeTimelineEvent({
      orderId: order.id,
      eventType: 'ORDER_RECEIVED',
      actorId: receivedActorId,
      actorName: receivedActorName,
      description: receivedDescription,
      metadata:
        mediaBuyerName && order.mediaBuyerId
          ? { mediaBuyerId: order.mediaBuyerId, mediaBuyerName }
          : undefined,
      branchId: order.branchId ?? null,
    });

    // Mark cart as CONVERTED — use cartId if available, otherwise fall back to
    // phone+product lookup so the live activity feed shows "Order placed" even
    // when the edge worker's cart save didn't complete before submission.
    if (cartId) {
      await this.cartService.convert(cartId, order.id, actorId ?? undefined).catch(() => {});
    } else if (orderInput.campaignId && orderInput.customerPhoneHash && orderInput.items?.[0]?.productId) {
      await this.cartService
        .convertByPhoneAndProduct(
          orderInput.campaignId,
          orderInput.customerPhoneHash,
          orderInput.items[0].productId,
          order.id,
          actorId ?? undefined,
        )
        .catch(() => {});
    }

    let authorizationUrl: string | undefined;
    if (paymentMethod === 'PAY_ONLINE' && orderInput.customerEmail && this.paystackService.isConfigured()) {
      const totalAmount = orderInput.totalAmount != null ? Number(orderInput.totalAmount) : 0;
      const amountInKobo = Math.round(totalAmount * 100); // NGN to kobo
      const callbackBase = process.env.PAYSTACK_CALLBACK_API_URL || process.env.API_URL || 'http://localhost:4444';
      const callbackUrl = `${callbackBase.replace(/\/$/, '')}/payments/complete`;
      const result = await this.paystackService.initializeTransaction({
        email: orderInput.customerEmail,
        amountInKobo: amountInKobo > 0 ? amountInKobo : 10000, // fallback 100 NGN if missing
        reference: `order-${order.id}`,
        callbackUrl,
        metadata: { orderId: order.id },
      });
      if (result) {
        authorizationUrl = result.authorizationUrl;
        const updatePayRef = async (
          dbOrTx: PostgresJsDatabase<typeof schema> | Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0],
        ) => {
          await dbOrTx
            .update(schema.orders)
            .set({ paymentReference: result.reference })
            .where(eq(schema.orders.id, order.id));
        };
        if (actorId) {
          await withActor(this.db, { id: actorId }, updatePayRef);
        } else {
          await updatePayRef(this.db);
        }
      }
    }

    return { id: order.id, authorizationUrl };
  }

  /**
   * Create an offline order (CS manual entry). Creator is set as assignee; no auto-dispatch.
   * Hashes customer phone server-side. Optionally checks for duplicate (same phone + product in 6h).
   */
  async createOffline(
    input: CreateOfflineOrderInput,
    actorId: string,
    sessionBranchId?: string | null,
  ): Promise<{ id: string }> {
    const customerPhoneHash = this.hashPhone(input.customerPhone);
    const paymentMethod = input.paymentMethod ?? 'PAY_ON_DELIVERY';

    if (paymentMethod === 'PAY_ONLINE' && (!input.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail))) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email is required for Pay online. Please provide a valid email address.',
      });
    }

    // Universal 7-day dedup — same phone + overlapping product within 7 days
    // blocks the offline order outright (CEO 2026-05-26). Previously only
    // edge-form orders were blocked; offline relied on a 2h cron, which let
    // duplicates slip through to logistics before being caught.
    const productIds = input.items.map((i) => i.productId);
    const existingWinner = await this.findExistingOrderForDedup(customerPhoneHash, productIds);
    if (existingWinner) {
      await this.recordCrossFunnelAttempt({
        customerPhoneHash,
        customerPhone: input.customerPhone,
        customerName: input.customerName,
        productIds,
        mediaBuyerId: input.mediaBuyerId ?? actorId,
        campaignId: input.campaignId ?? null,
        branchId: null,
        winner: { id: existingWinner.id, mediaBuyerId: existingWinner.mediaBuyerId ?? actorId },
      });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          `Duplicate: an order for this customer and product already exists (${existingWinner.id.slice(0, 8)}…, status: ${existingWinner.status}). Please check existing orders before creating a new one.`,
      });
    }

    // When recovering from a cart, pull attribution (MB + campaign) from the
    // cart row if the Sales rep didn't explicitly set it on the modal.
    if (input.cartId && (!input.campaignId || !input.mediaBuyerId)) {
      const cartRows = await this.db
        .select({
          campaignId: schema.cartAbandonments.campaignId,
          mediaBuyerId: schema.cartAbandonments.mediaBuyerId,
        })
        .from(schema.cartAbandonments)
        .where(eq(schema.cartAbandonments.id, input.cartId))
        .limit(1);
      const cart = cartRows[0];
      if (cart) {
        if (!input.campaignId && cart.campaignId) input.campaignId = cart.campaignId;
        if (!input.mediaBuyerId && cart.mediaBuyerId) input.mediaBuyerId = cart.mediaBuyerId;
      }
    }

    // MARKETING branch — attribution. Set once, never changes.
    const branchId = await this.resolveBranchIdForNewOrder({
      campaignId: input.campaignId ?? null,
      mediaBuyerId: input.mediaBuyerId ?? null,
      fallbackBranchId: sessionBranchId ?? null,
    });

    // CS SERVICING branch — routing may service the order in a different
    // branch, but must NEVER overwrite the marketing `branchId` (migration 0150).
    let servicingBranchId = branchId;
    if (branchId) {
      const primaryProductId = input.items?.[0]?.productId ?? null;
      const servicingBranch = await this.csOrderRouting.resolveServicingBranchForProduct(
        branchId,
        primaryProductId,
      );
      if (servicingBranch) {
        servicingBranchId = servicingBranch;
      }
    }

    const order = await withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.orders)
        .values({
          campaignId: input.campaignId ?? null,
          mediaBuyerId: input.mediaBuyerId ?? null,
          branchId: branchId ?? null,
          servicingBranchId: servicingBranchId ?? null,
          assignedCsId: actorId,
          customerName: input.customerName,
          customerPhoneHash,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress ?? null,
          deliveryAddress: input.deliveryAddress ?? null,
          deliveryNotes: input.deliveryNotes ?? null,
          deliveryState: input.deliveryState ?? null,
          customerGender: input.customerGender ?? null,
          preferredDeliveryDate: input.preferredDeliveryDate ?? null,
          customerEmail: input.customerEmail ?? null,
          paymentMethod: paymentMethod === 'PAY_ONLINE' ? 'PAY_ONLINE' : 'PAY_ON_DELIVERY',
          paymentStatus: paymentMethod === 'PAY_ONLINE' ? 'PENDING' : null,
          paymentProvider: paymentMethod === 'PAY_ONLINE' ? 'PAYSTACK' : null,
          items: input.items,
          totalAmount: input.totalAmount != null ? String(input.totalAmount) : null,
          status: 'CS_ASSIGNED',
          orderSource: 'offline',
          // Back-link to the cart when this offline order was created from a
          // recovered cart (Assign-from-Modal flow). NULL for direct offline orders.
          cartId: input.cartId ?? null,
          customFields: input.customFields ?? null,
        })
        .returning();

      const created = rows[0];
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create offline order' });
      }

      await tx.insert(schema.orderItems).values(
        input.items.map((item) => ({
          orderId: created.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
          offerLabel: item.offerLabel ?? null,
        })),
      );
      return created;
    });

    // If recovered from a cart, flip the cart row to CONVERTED + link.
    if (input.cartId) {
      this.cartService.convert(input.cartId, order.id, actorId).catch(() => {});
    }

    this.events.emitNewOrder({
      orderId: order.id,
      productName: 'Offline order created',
      branchId: order.branchId ?? null,
      servicingBranchId: servicingBranchId ?? null,
      mediaBuyerId: order.mediaBuyerId ?? null,
    });
    this.events.emitToUser(actorId, 'order:assigned', { orderId: order.id });
    this.events.emitToRoom('cs-all', 'order:new', { orderId: order.id }, servicingBranchId ?? null);

    this.notifications.enqueueCreate({
      userId: actorId,
      type: 'order:assigned',
      title: 'Offline order created',
      body: 'You created an offline order. It is assigned to you.',
      data: { orderId: order.id },
    });

    const [actorRow, mediaBuyerName] = await Promise.all([
      this.db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, actorId))
        .limit(1),
      order.mediaBuyerId ? this.resolveUserNameById(order.mediaBuyerId) : Promise.resolve(null),
    ]);
    const actorName = actorRow[0]?.name ?? null;
    const mbSuffix = mediaBuyerName ? ` — attributed to media buyer ${mediaBuyerName}` : '';

    void this.writeTimelineEvent({
      orderId: order.id,
      eventType: 'ORDER_RECEIVED',
      actorId: actorId,
      actorName,
      description: `Offline order created${mbSuffix}`,
      metadata:
        mediaBuyerName && order.mediaBuyerId
          ? { mediaBuyerId: order.mediaBuyerId, mediaBuyerName }
          : undefined,
      branchId: order.branchId ?? null,
    });

    // Auto-assigned to creator — log the assignment event.
    void this.writeTimelineEvent({
      orderId: order.id,
      eventType: 'ORDER_MANUALLY_ASSIGNED',
      actorId: actorId,
      actorName,
      description: `Assigned to ${actorName ?? 'creator'} (auto-assigned on offline creation)`,
      branchId: order.branchId ?? null,
    });

    return { id: order.id };
  }

  /**
   * Import a single order from an external CRM export (SuperAdmin only).
   * Simplified version of createOffline that:
   * - Skips dedup (historical data would trigger false positives)
   * - Skips CS routing (branch is explicitly provided)
   * - Skips notifications and events (no need for historical imports)
   * - Sets status directly to targetStatus (CS_ASSIGNED or REMITTED)
   * - Preserves original createdAt from the CRM export
   */
  async importOrder(
    input: ImportOrderInput,
    actorId: string,
  ): Promise<{ id: string }> {
    const customerPhoneHash = this.hashPhone(input.customerPhone);

    // Parse createdAt override — fall back to now if not provided or invalid
    let createdAtDate: Date | undefined;
    if (input.createdAtOverride) {
      const parsed = new Date(input.createdAtOverride);
      if (!isNaN(parsed.getTime())) createdAtDate = parsed;
    }

    // Build timestamp overrides for terminal statuses
    const statusTimestamps: Record<string, Date | undefined> = {};
    if (input.targetStatus === 'REMITTED' && createdAtDate) {
      statusTimestamps.confirmedAt = createdAtDate;
      statusTimestamps.allocatedAt = createdAtDate;
      statusTimestamps.dispatchedAt = createdAtDate;
      statusTimestamps.deliveredAt = createdAtDate;
    }

    const order = await withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.orders)
        .values({
          mediaBuyerId: input.mediaBuyerId ?? null,
          branchId: input.branchId,
          servicingBranchId: input.branchId,
          assignedCsId: input.assignedCsId,
          customerName: input.customerName,
          customerPhoneHash,
          customerPhone: input.customerPhone,
          customerAddress: input.customerAddress ?? null,
          deliveryAddress: input.deliveryAddress ?? input.customerAddress ?? null,
          deliveryNotes: input.deliveryNotes ?? null,
          deliveryState: input.deliveryState ?? null,
          customerGender: input.customerGender ?? null,
          customerEmail: input.customerEmail ?? null,
          paymentMethod: 'PAY_ON_DELIVERY',
          items: input.items,
          totalAmount: input.totalAmount != null ? String(input.totalAmount) : null,
          status: input.targetStatus,
          orderSource: 'offline',
          customFields: input.customFields ?? null,
          ...(createdAtDate ? { createdAt: createdAtDate } : {}),
          ...statusTimestamps,
        })
        .returning();

      const created = rows[0];
      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to import order' });
      }

      await tx.insert(schema.orderItems).values(
        input.items.map((item) => ({
          orderId: created.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: String(item.unitPrice),
          offerLabel: item.offerLabel ?? null,
        })),
      );
      return created;
    });

    // Minimal timeline event for audit trail
    const actorRow = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, actorId))
      .limit(1);
    const actorName = actorRow[0]?.name ?? null;

    void this.writeTimelineEvent({
      orderId: order.id,
      eventType: 'ORDER_RECEIVED',
      actorId,
      actorName,
      description: `Imported from external CRM (status: ${input.targetStatus})`,
      branchId: input.branchId,
    });

    return { id: order.id };
  }

  /**
   * Recover an abandoned cart as an offline order (CEO 2026-06-09).
   * Cart-recovered orders use `orderSource: 'offline'` so they are excluded from
   * marketing CR/DR/CPA metrics. MB attribution (mediaBuyerId) is preserved for
   * reference but the order only surfaces in CS/offline metrics.
   * CS can supplement missing fields (address, items, etc.) from the modal.
   */
  async recoverFromCart(
    cartId: string,
    overrides: {
      customerAddress?: string;
      deliveryAddress?: string;
      deliveryNotes?: string;
      deliveryState?: string;
      customerGender?: string;
      preferredDeliveryDate?: string;
      paymentMethod?: 'PAY_ON_DELIVERY' | 'PAY_ONLINE';
      customerEmail?: string;
      items?: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
      totalAmount?: number;
    },
    actorId: string,
  ): Promise<{ id: string }> {
    // 1. Read the cart row for attribution + customer data.
    const [cart] = await this.db
      .select()
      .from(schema.cartAbandonments)
      .where(eq(schema.cartAbandonments.id, cartId))
      .limit(1);
    if (!cart) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Cart not found' });
    }
    if (cart.status === 'CONVERTED') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This cart has already been converted to an order' });
    }
    if (!cart.customerPhone) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cart has no phone number — cannot create order' });
    }

    // 2. Build order input from cart + CS overrides.
    const phoneHash = this.hashPhone(cart.customerPhone);
    let items: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
    if (overrides.items && overrides.items.length > 0) {
      items = overrides.items;
    } else if (cart.productId) {
      // No CS override — synthesize from the cart. We MUST resolve the real tier price,
      // otherwise create() rejects it: orderSource='edge-form' runs
      // `assertEdgeFormLineItemsAllowlisted`, which compares item.unitPrice against the
      // campaign's allowlisted tiers; a placeholder 0 never matches and the recovery fails
      // with "Offer selection does not match this form."
      const quantity = cart.quantity ?? 1;
      const unitPrice = await this.resolveCartTierPrice({
        campaignId: cart.campaignId,
        productId: cart.productId,
        offerLabel: cart.offerLabel,
        quantity,
      });
      items = [{ productId: cart.productId, quantity, unitPrice, offerLabel: cart.offerLabel ?? undefined }];
    } else {
      items = [];
    }
    if (items.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'At least one item is required' });
    }

    const orderInput: CreateOrderInput & { cartId: string } = {
      cartId,
      campaignId: cart.campaignId ?? undefined,
      mediaBuyerId: cart.mediaBuyerId ?? undefined,
      customerName: cart.customerName,
      customerPhoneHash: phoneHash,
      customerPhone: cart.customerPhone,
      customerAddress: overrides.customerAddress ?? cart.customerAddress ?? undefined,
      deliveryAddress: overrides.deliveryAddress ?? cart.deliveryAddress ?? undefined,
      deliveryNotes: overrides.deliveryNotes ?? cart.deliveryNotes ?? undefined,
      deliveryState: overrides.deliveryState ?? cart.deliveryState ?? undefined,
      customerGender: overrides.customerGender ?? cart.customerGender ?? undefined,
      preferredDeliveryDate: overrides.preferredDeliveryDate ?? cart.preferredDeliveryDate ?? undefined,
      paymentMethod: overrides.paymentMethod ?? (cart.paymentMethod as 'PAY_ON_DELIVERY' | 'PAY_ONLINE') ?? 'PAY_ON_DELIVERY',
      customerEmail: overrides.customerEmail ?? cart.customerEmail ?? undefined,
      items,
      totalAmount: overrides.totalAmount,
    };

    // 3. Create as offline order (CEO 2026-06-09: cart recovery is CS-only,
    // should not pollute marketing metrics). MB attribution is preserved via
    // mediaBuyerId on the order; orderSource='offline' excludes it from
    // marketing CR/DR/CPA. If campaign tier validation fails (offers changed
    // after cart was abandoned), retry without the campaign.
    // 3. Create as offline follow-up order — isFollowUp=true from birth so
    // the order NEVER appears in the main CS queue. CEO 2026-06-09: cart
    // recovery goes exclusively through Follow-Up assignment.
    let result: { id?: string };
    try {
      result = await this.create(orderInput, actorId, 'offline', { isFollowUp: true });
    } catch {
      const { campaignId: _dropped, ...inputWithoutCampaign } = orderInput;
      result = await this.create(inputWithoutCampaign, actorId, 'offline', { isFollowUp: true });
    }
    if (!result.id) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Order creation returned no ID' });
    }

    // 5. Convert the cart — mark as CONVERTED so it disappears from the abandonment list.
    try {
      await this.cartService.convert(cartId, result.id, actorId);
    } catch (err) {
      this.logger.warn(`Failed to mark cart ${cartId} as CONVERTED: ${err instanceof Error ? err.message : err}`);
    }

    // 6. Timeline event — record that this order was recovered from an abandoned cart.
    await this.db.insert(schema.orderTimelineEvents).values({
      orderId: result.id,
      eventType: 'ORDER_RESTORED' as const,
      actorId,
      actorName: null,
      description: `Order recovered from abandoned cart.`,
      metadata: { cartId, customerName: cart.customerName },
      branchId: null,
    });

    return { id: result.id };
  }

  /**
   * Bulk-recover abandoned carts — optimised for speed.
   *  1. Fetches all carts + product prices in batch (2 queries)
   *  2. Resolves branches in batch
   *  3. Inserts all orders + items + timeline in ONE withActor transaction
   *  4. Converts carts fire-and-forget
   *  5. Skips auto-dispatch, notifications, dedup (batch handles assignment)
   */
  async bulkRecoverCarts(
    cartIds: string[],
    actorId: string,
  ): Promise<{ succeeded: number; failed: number; orderIds: string[] }> {
    if (cartIds.length === 0) return { succeeded: 0, failed: 0, orderIds: [] };

    // ── 1. Batch-fetch carts + products ──────────────────────────
    const carts = await this.db
      .select()
      .from(schema.cartAbandonments)
      .where(inArray(schema.cartAbandonments.id, cartIds));

    const productIds = [...new Set(carts.map((c) => c.productId).filter(Boolean))] as string[];
    const products = productIds.length > 0
      ? await this.db
          .select({ id: schema.products.id, baseSalePrice: schema.products.baseSalePrice })
          .from(schema.products)
          .where(inArray(schema.products.id, productIds))
      : [];
    const priceMap = new Map(products.map((p) => [p.id, Number(p.baseSalePrice ?? 0)]));

    // ── 2. Batch-resolve branches (campaign → branch) ────────────
    const campaignIds = [...new Set(carts.map((c) => c.campaignId).filter(Boolean))] as string[];
    const campaignBranches = campaignIds.length > 0
      ? await this.db
          .select({ id: schema.campaigns.id, branchId: schema.campaigns.branchId })
          .from(schema.campaigns)
          .where(inArray(schema.campaigns.id, campaignIds))
      : [];
    const campaignBranchMap = new Map(campaignBranches.map((c) => [c.id, c.branchId]));

    // ── 3. Build valid cart rows ─────────────────────────────────
    type PreparedCart = {
      cart: (typeof carts)[0];
      phoneHash: string;
      items: Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>;
      branchId: string | null;
    };
    const prepared: PreparedCart[] = [];
    let failed = 0;
    const cartMap = new Map(carts.map((c) => [c.id, c]));

    for (const cartId of cartIds) {
      const cart = cartMap.get(cartId);
      if (!cart || cart.status === 'CONVERTED' || !cart.customerPhone || !cart.productId) {
        failed++;
        continue;
      }
      const quantity = cart.quantity ?? 1;
      const unitPrice = priceMap.get(cart.productId) ?? 0;
      prepared.push({
        cart,
        phoneHash: this.hashPhone(cart.customerPhone),
        items: [{ productId: cart.productId, quantity, unitPrice, offerLabel: cart.offerLabel ?? undefined }],
        branchId: cart.campaignId ? (campaignBranchMap.get(cart.campaignId) ?? null) : null,
      });
    }

    if (prepared.length === 0) return { succeeded: 0, failed, orderIds: [] };

    // ── 4. Single transaction: insert all orders + items + timeline ──
    const orderIds = await withActor(this.db, { id: actorId }, async (tx) => {
      const ids: string[] = [];
      // Bulk insert orders
      const orderRows = await tx
        .insert(schema.orders)
        .values(
          prepared.map((p) => ({
            campaignId: p.cart.campaignId ?? null,
            mediaBuyerId: p.cart.mediaBuyerId ?? null,
            branchId: p.branchId,
            servicingBranchId: p.branchId,
            customerName: p.cart.customerName,
            customerPhoneHash: p.phoneHash,
            customerPhone: p.cart.customerPhone ?? null,
            customerAddress: p.cart.customerAddress ?? null,
            deliveryAddress: p.cart.deliveryAddress ?? null,
            deliveryNotes: p.cart.deliveryNotes ?? null,
            deliveryState: p.cart.deliveryState ?? null,
            customerGender: p.cart.customerGender ?? null,
            preferredDeliveryDate: p.cart.preferredDeliveryDate ?? null,
            customerEmail: p.cart.customerEmail ?? null,
            paymentMethod: (p.cart.paymentMethod as 'PAY_ON_DELIVERY' | 'PAY_ONLINE') ?? 'PAY_ON_DELIVERY',
            items: p.items,
            totalAmount: p.items[0] ? String(p.items[0].unitPrice) : null,
            status: 'UNPROCESSED' as const,
            orderSource: 'offline' as const,
            isFollowUp: true,
            cartId: p.cart.id,
            customFields: null,
          })),
        )
        .returning({ id: schema.orders.id });

      for (const row of orderRows) ids.push(row.id);

      // Bulk insert order_items
      const allItems: Array<{ orderId: string; productId: string; quantity: number; unitPrice: string; offerLabel: string | null }> = [];
      for (let i = 0; i < prepared.length; i++) {
        const orderId = ids[i];
        if (!orderId) continue;
        for (const item of prepared[i]!.items) {
          allItems.push({
            orderId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: String(item.unitPrice),
            offerLabel: item.offerLabel ?? null,
          });
        }
      }
      if (allItems.length > 0) {
        await tx.insert(schema.orderItems).values(allItems);
      }

      // Bulk insert timeline events
      const timelineRows = prepared.map((p, i) => ({
        orderId: ids[i]!,
        eventType: 'ORDER_RESTORED' as const,
        actorId,
        actorName: null as string | null,
        description: 'Order recovered from abandoned cart.',
        metadata: { cartId: p.cart.id, customerName: p.cart.customerName },
        branchId: null as string | null,
      })).filter((r) => r.orderId);
      if (timelineRows.length > 0) {
        await tx.insert(schema.orderTimelineEvents).values(timelineRows);
      }

      return ids;
    });

    // ── 5. Fire-and-forget: convert carts ────────────────────────
    for (let i = 0; i < prepared.length; i++) {
      const orderId = orderIds[i];
      if (orderId) {
        void this.cartService.convert(prepared[i]!.cart.id, orderId, actorId).catch(() => {});
      }
    }

    return { succeeded: orderIds.length, failed, orderIds };
  }

  /** SHA-256 hash of phone for offline order creation (server-side only). */
  /**
   * Hash a phone number for dedup / cross-funnel matching.
   * Must produce the SAME hash as the edge-worker's `hashPhone()`:
   *   sha256("yannis:phone:" + normalizedDigits)
   * Nigerian local format (0XXXXXXXXXX) is normalized to international (234XXXXXXXXXX)
   * so the same physical phone always matches regardless of how the customer typed it.
   */
  private hashPhone(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    // Nigerian local: 0XXXXXXXXXX (11 digits) → 234XXXXXXXXXX
    if (digits.length === 11 && digits.startsWith('0')) {
      digits = '234' + digits.slice(1);
    }
    return createHash('sha256').update(`yannis:phone:${digits}`).digest('hex');
  }

  /**
   * Cart recovery: pull the tier price for (campaign, product, offerLabel, quantity).
   * Mirrors the source-of-truth lookup in `assertEdgeFormLineItemsAllowlisted` so the
   * synthesized line items pass the same allowlist gate.
   *
   * Lookup order matches the gate: campaign offer_group → product offer_templates →
   * product.offers JSON → product.baseSalePrice. If nothing matches the label/qty,
   * falls back to product.baseSalePrice (the cart predates the current tier list).
   */
  private async resolveCartTierPrice(params: {
    campaignId: string;
    productId: string;
    offerLabel: string | null | undefined;
    quantity: number;
  }): Promise<number> {
    const { campaignId, productId, offerLabel, quantity } = params;
    const labelTrim = (offerLabel ?? '').trim();

    const [camp] = await this.db
      .select({
        offerGroupId: schema.campaigns.offerGroupId,
        formConfig: schema.campaigns.formConfig,
      })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (camp?.offerGroupId) {
      const rows = await this.db
        .select({
          label: schema.offerGroupItems.label,
          price: schema.offerGroupItems.price,
          quantity: schema.offerGroupItems.quantity,
        })
        .from(schema.offerGroupItems)
        .where(
          and(
            eq(schema.offerGroupItems.offerGroupId, camp.offerGroupId),
            eq(schema.offerGroupItems.productId, productId),
            eq(schema.offerGroupItems.status, 'ACTIVE'),
          ),
        );
      const match = rows.find(
        (r) =>
          (r.quantity ?? 1) === quantity &&
          (labelTrim ? r.label.trim() === labelTrim : true),
      ) ?? rows[0];
      if (match) return Number(match.price);
    }

    const selectedIds = (camp?.formConfig as { selectedOfferTemplateIds?: string[] } | null | undefined)
      ?.selectedOfferTemplateIds;
    const tmplConds = [
      eq(schema.offerTemplates.productId, productId),
      eq(schema.offerTemplates.status, 'ACTIVE'),
    ];
    if (selectedIds?.length) {
      tmplConds.push(inArray(schema.offerTemplates.id, selectedIds));
    }
    const templates = await this.db
      .select({
        name: schema.offerTemplates.name,
        price: schema.offerTemplates.price,
        quantity: schema.offerTemplates.quantity,
      })
      .from(schema.offerTemplates)
      .where(and(...tmplConds));
    const tmplMatch =
      templates.find(
        (t) =>
          (t.quantity ?? 1) === quantity &&
          (labelTrim ? t.name.trim() === labelTrim : true),
      ) ?? templates[0];
    if (tmplMatch) return Number(tmplMatch.price);

    const [product] = await this.db
      .select({ baseSalePrice: schema.products.baseSalePrice, offers: schema.products.offers })
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    const embedded = product?.offers as
      | Array<{ label?: string; qty?: number; price?: string | number }>
      | null
      | undefined;
    if (Array.isArray(embedded)) {
      const embMatch =
        embedded.find(
          (o) =>
            (typeof o.qty === 'number' ? o.qty : 1) === quantity &&
            (labelTrim ? String(o.label ?? '').trim() === labelTrim : true),
        ) ?? embedded[0];
      if (embMatch?.price != null) return Number(embMatch.price);
    }
    return Number(product?.baseSalePrice ?? 0);
  }

  /**
   * Prepare Paystack payment for PAY_ONLINE: do NOT create order yet.
   * Store payload in Redis; redirect user to Paystack. Order is created only after payment (in completePaymentByReference).
   */
  async preparePaystackOrder(input: CreateOrderInput & { cartId?: string }, _actorId: string | null): Promise<{ authorizationUrl: string; reference: string }> {
    if (input.paymentMethod !== 'PAY_ONLINE') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'preparePaystackOrder is only for PAY_ONLINE. Use orders.create for Pay on delivery.',
      });
    }
    if (!input.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email is required for Pay online. Please provide a valid email address.',
      });
    }
    if (!this.paystackService.isConfigured()) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Online payment is not configured. Please try Pay on delivery.',
      });
    }

    const reference = randomUUID();
    const payload = {
      ...input,
      source: 'edge-form' as const,
      paymentMethod: 'PAY_ONLINE' as const,
    };
    await this.redis.setex(
      PENDING_PAYMENT_PREFIX + reference,
      PENDING_PAYMENT_TTL_SECONDS,
      JSON.stringify(payload),
    );

    const totalAmount = input.totalAmount != null ? Number(input.totalAmount) : 0;
    const amountInKobo = Math.round(totalAmount * 100) || 10000;
    const callbackBase = process.env.PAYSTACK_CALLBACK_API_URL || process.env.API_URL || 'http://localhost:4444';
    const callbackUrl = `${callbackBase.replace(/\/$/, '')}/payments/complete`;

    const result = await this.paystackService.initializeTransaction({
      email: input.customerEmail,
      amountInKobo,
      reference,
      callbackUrl,
      metadata: { reference },
    });

    if (!result) {
      await this.redis.del(PENDING_PAYMENT_PREFIX + reference);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Could not initialize payment. Please try again or use Pay on delivery.',
      });
    }

    return { authorizationUrl: result.authorizationUrl, reference: result.reference };
  }

  /**
   * Get a single order by ID with masked phone.
   */
  /**
   * Per-order detail cache key — exposed via the static helper so the tRPC
   * router can build the same key for explicit invalidation on every order
   * mutation (transition, update, softDelete, assignToCS, bulkReassign,
   * scheduleCallback, etc.).
   */
  static buildOrderDetailCacheKey(orderId: string): string {
    return OrdersService.ORDER_DETAIL_CACHE_KEY(orderId);
  }

  /**
   * Loads the full order-detail payload (order row, items, call logs, resolved
   * names, remittance status, pending-request ids, allowed transitions) for a
   * given order id.
   *
   * Wrapped in a 60s Redis cache (`cache:orders:detail:${orderId}`). The base
   * payload is actor-independent — viewer-specific flags
   * (`viewerCanEditOrderLinePrices`, `viewerIsCsTeamSupervisor`) are computed
   * AFTER the cache lookup in the tRPC `orders.getById` procedure, and the
   * finance-stripping middleware runs after that. The customer phone is
   * stripped *inside* this method before the cache value is set, so PII never
   * touches the cache.
   *
   * Cache invalidation is explicit: every mutation that changes order state,
   * assignments, items, or remittance must call `invalidateOrderDetailCache`
   * in `apps/api/src/trpc/routers/orders.router.ts`.
   *
   * Note on serialisation: tRPC v11 in this codebase has no superjson
   * transformer, so the over-the-wire payload is plain JSON anyway — Date
   * fields become ISO strings on transit. The cache stores the same JSON
   * roundtrip; downstream consumers (finance.ensureInvoiceForOrder, etc.)
   * already accept `string | Date | null` shapes for date columns.
   */
  async getById(orderId: string): ReturnType<OrdersService['loadOrderDetailPayload']> {
    return this.cache.getOrSet(
      OrdersService.ORDER_DETAIL_CACHE_KEY(orderId),
      OrdersService.ORDER_DETAIL_CACHE_TTL_SECONDS,
      () => this.loadOrderDetailPayload(orderId),
    );
  }

  private async loadOrderDetailPayload(orderId: string) {
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // Get allowed next statuses for UI button state
    const allowedTransitions = getAllowedNextStatuses(order.status as OrderStatus);

    // Resolve display names for users, campaign, logistics (so UI shows names instead of IDs)
    const userIds = [
      order.assignedCsId,
      order.mediaBuyerId,
      order.riderId,
      order.lockedBy,
    ].filter((id): id is string => Boolean(id));
    const uniqueUserIds = [...new Set(userIds)];

    // One parallel wave. Order items + call logs are keyed only on `orderId`
    // and independent of the name-resolution queries, so they run alongside
    // them rather than as two extra sequential round-trips beforehand.
    const [itemRows, calls, userRows, campaignRow, providerRow, locationRow] = await Promise.all([
      this.db
        .select({
          id: schema.orderItems.id,
          orderId: schema.orderItems.orderId,
          productId: schema.orderItems.productId,
          quantity: schema.orderItems.quantity,
          unitPrice: schema.orderItems.unitPrice,
          offerLabel: schema.orderItems.offerLabel,
          productName: schema.products.name,
        })
        .from(schema.orderItems)
        .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
        .where(eq(schema.orderItems.orderId, orderId)),
      this.db
        .select()
        .from(schema.callLogs)
        .where(eq(schema.callLogs.orderId, orderId))
        .orderBy(desc(schema.callLogs.startedAt)),
      uniqueUserIds.length > 0
        ? this.db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, uniqueUserIds))
        : Promise.resolve([]),
      order.campaignId
        ? this.db
            // Pull formConfig too — the order-detail UI needs `formConfig.customFields[]`
            // to map the saved `orders.custom_fields` response object back into labelled
            // rows ("Shirt size: Large"). Without the field definitions all the UI has is
            // an opaque { fieldId: value } map.
            .select({ id: schema.campaigns.id, name: schema.campaigns.name, formConfig: schema.campaigns.formConfig })
            .from(schema.campaigns)
            .where(eq(schema.campaigns.id, order.campaignId))
            .limit(1)
        : Promise.resolve([]),
      order.logisticsProviderId
        ? this.db
            .select({ id: schema.logisticsProviders.id, name: schema.logisticsProviders.name })
            .from(schema.logisticsProviders)
            .where(eq(schema.logisticsProviders.id, order.logisticsProviderId))
            .limit(1)
        : Promise.resolve([]),
      order.logisticsLocationId
        ? this.db
            .select({ id: schema.logisticsLocations.id, name: schema.logisticsLocations.name })
            .from(schema.logisticsLocations)
            .where(eq(schema.logisticsLocations.id, order.logisticsLocationId))
            .limit(1)
        : Promise.resolve([]),
    ]);

    const items = itemRows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      productId: row.productId,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      offerLabel: row.offerLabel ?? null,
      productName: row.productName ?? null,
    }));

    const userNames = new Map(userRows.map((r) => [r.id, r.name]));
    const assignedCsName = order.assignedCsId ? userNames.get(order.assignedCsId) ?? null : null;
    const mediaBuyerName = order.mediaBuyerId ? userNames.get(order.mediaBuyerId) ?? null : null;
    const riderName = order.riderId ? userNames.get(order.riderId) ?? null : null;
    const lockedByName = order.lockedBy ? userNames.get(order.lockedBy) ?? null : null;
    const campaignName = campaignRow[0]?.name ?? null;
    /**
     * Field definitions for the campaign's form-builder custom fields. Returned alongside
     * the order so order-detail UIs can render `label: value` pairs from the response object
     * stored in `orders.custom_fields`. Empty array when the campaign has no custom fields
     * (or when the order has no campaign at all).
     */
    const campaignCustomFieldDefs: Array<{
      id: string;
      type: string;
      label: string;
      order: number;
      options?: string[];
    }> = (() => {
      const fc = campaignRow[0]?.formConfig as { customFields?: unknown } | undefined | null;
      if (!fc || !Array.isArray(fc.customFields)) return [];
      return (fc.customFields as Array<{ id: string; type: string; label: string; order: number; options?: string[] }>)
        .filter((f) => f && typeof f.id === 'string')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    })();
    const logisticsProviderName = providerRow[0]?.name ?? null;
    const logisticsLocationName = locationRow[0]?.name ?? null;

    // Final wave — three independent lookups keyed only on `orderId`:
    //   1) delivery remittance status for this order (if any),
    //   2) pending permission_request to change a line price,
    //   3) pending permission_request to archive (soft-delete) the order.
    // Previously these ran sequentially (3 RTTs); fanning out collapses them
    // to a single wall-clock round-trip on the cache-miss detail load.
    const [remittanceRow, pendingPriceRequest, pendingOrderDeletionRequestId, pendingDeliveredOrderDeletionRequestId] =
      await Promise.all([
        this.db
          .select({
            remittanceId: schema.deliveryRemittances.id,
            remittanceStatus: schema.deliveryRemittances.status,
          })
          .from(schema.deliveryRemittanceOrders)
          .innerJoin(
            schema.deliveryRemittances,
            eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, schema.deliveryRemittances.id),
          )
          .where(eq(schema.deliveryRemittanceOrders.orderId, orderId))
          .limit(1),
        this.findPendingOrderLinePriceRequest(orderId),
        this.findPendingOrderDeletionRequestId(orderId),
        this.findPendingDeliveredOrderDeletionRequestId(orderId),
      ]);

    const remittanceStatus = remittanceRow[0]?.remittanceStatus ?? null;
    const remittanceId = remittanceRow[0]?.remittanceId ?? null;

    const { customerPhone: _rawPhone, ...orderSafe } = order;
    return {
      ...orderSafe,
      customerPhoneDisplay: formatOrderCustomerPhoneDisplay(order.customerPhone, order.customerPhoneHash),
      orderItems: items,
      callLogs: calls,
      allowedTransitions,
      assignedCsName,
      mediaBuyerName,
      campaignName,
      campaignCustomFieldDefs,
      logisticsProviderName,
      logisticsLocationName,
      riderName,
      lockedByName,
      remittanceStatus,
      remittanceId,
      pendingOrderLinePriceRequestId: pendingPriceRequest?.id ?? null,
      pendingLinePriceChangeProposal: pendingPriceRequest ? {
        items: ((pendingPriceRequest.payload as Record<string, unknown>)?.items ?? []) as Array<{ productId: string; quantity: number; unitPrice: number; offerLabel?: string }>,
        totalAmount: Number((pendingPriceRequest.payload as Record<string, unknown>)?.totalAmount ?? 0),
        reason: pendingPriceRequest.reason,
        requesterName: pendingPriceRequest.requesterName,
      } : null,
      pendingOrderDeletionRequestId,
      pendingDeliveredOrderDeletionRequestId,
    };
  }

  /**
   * Same rules as tRPC `orders.getById` — call after loading an order row before returning
   * order-scoped payloads (e.g. `finance.getInvoiceByOrder`).
   */
  assertActorMayViewOrderForRead(
    actor: SessionUser,
    order: { mediaBuyerId: string | null },
  ): void {
    if (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN') return;
    const perms = actor.permissions ?? [];
    const hasOrdersView = perms.some((p) => canonicalPermissionCode(p) === 'orders.view');
    if (hasOrdersView) return;

    const hasMarketingOrdersView = perms.some(
      (p) => canonicalPermissionCode(p) === 'marketing.orders.view',
    );
    if (!hasMarketingOrdersView) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to view this order',
      });
    }
    if (actor.role !== 'HEAD_OF_MARKETING' && order.mediaBuyerId !== actor.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Not authorized to view this order',
      });
    }
  }

  /**
   * Batch customer names for inventory DELIVERY movement labels. Same visibility as
   * `orders.getById` + `assertActorMayViewOrderForRead`; rows the actor cannot read are omitted.
   */
  async listCustomerNamesByOrderIds(
    actor: SessionUser,
    orderIds: string[],
  ): Promise<Array<{ orderId: string; customerName: string }>> {
    const unique = [...new Set(orderIds)];
    if (unique.length === 0) return [];

    const rows = await this.db
      .select({
        id: schema.orders.id,
        mediaBuyerId: schema.orders.mediaBuyerId,
        customerName: schema.orders.customerName,
      })
      .from(schema.orders)
      .where(and(inArray(schema.orders.id, unique), isNull(schema.orders.deletedAt)));

    const out: Array<{ orderId: string; customerName: string }> = [];
    for (const row of rows) {
      try {
        this.assertActorMayViewOrderForRead(actor, { mediaBuyerId: row.mediaBuyerId });
        out.push({ orderId: row.id, customerName: row.customerName });
      } catch {
        /* same as failed per-order getById — omit */
      }
    }
    return out;
  }

  /**
   * Stock-band threshold for the CS_CLOSER allocate dropdown — they're not
   * allowed to see exact counts (CEO directive), but a coarse "Above 50 /
   * Below 50" hint is enough for them to spot hubs that are running low
   * before they assign.
   */
  private static readonly CS_STOCK_BAND_THRESHOLD = 50;

  async listAllocatableLocations(
    orderId: string,
    viewerRole?: string | null,
  ): Promise<Array<{
    id: string;
    name: string;
    address: string | null;
    whatsappGroupLink: string | null;
    providerName: string | null;
    /** `WAREHOUSE` = internal hub; `THIRD_PARTY` = external 3PL. */
    providerKind: string | null;
    eligible: boolean;
    reason: string | null;
    availabilityByProduct: Array<{
      productId: string;
      productName: string;
      needed: number;
      available: number;
    }> | null;
    /**
     * Coarse stock-level hint for viewers who aren't allowed to see exact
     * counts (CS_CLOSER). `null` for everyone else — they get exact numbers
     * via `availabilityByProduct`. Band threshold lives in `CS_STOCK_BAND_THRESHOLD`.
     */
    stockBandByProduct: Array<{
      productId: string;
      productName: string;
      band: 'ABOVE_THRESHOLD' | 'BELOW_THRESHOLD';
    }> | null;
  }>> {
    // Check orders table first, then fall back to follow_up_orders
    let orderItems: Array<{ productId: string; quantity: number; productName: string | null }>;

    const [orderRow] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);

    if (orderRow) {
      orderItems = await this.db
        .select({
          productId: schema.orderItems.productId,
          quantity: schema.orderItems.quantity,
          productName: schema.products.name,
        })
        .from(schema.orderItems)
        .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
        .where(eq(schema.orderItems.orderId, orderId));
    } else {
      // Fallback: follow-up order
      const [fuRow] = await this.db
        .select({ id: schema.followUpOrders.id })
        .from(schema.followUpOrders)
        .where(and(eq(schema.followUpOrders.id, orderId), isNull(schema.followUpOrders.deletedAt)))
        .limit(1);
      if (!fuRow) {
        // Fallback: cart order
        const [coRow] = await this.db
          .select({ id: schema.cartOrders.id })
          .from(schema.cartOrders)
          .where(and(eq(schema.cartOrders.id, orderId), isNull(schema.cartOrders.deletedAt)))
          .limit(1);
        if (!coRow) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
        }
        orderItems = await this.db
          .select({
            productId: schema.cartOrderItems.productId,
            quantity: schema.cartOrderItems.quantity,
            productName: schema.products.name,
          })
          .from(schema.cartOrderItems)
          .leftJoin(schema.products, eq(schema.cartOrderItems.productId, schema.products.id))
          .where(eq(schema.cartOrderItems.cartOrderId, orderId));
      } else {
        orderItems = await this.db
          .select({
            productId: schema.followUpOrderItems.productId,
            quantity: schema.followUpOrderItems.quantity,
            productName: schema.products.name,
          })
          .from(schema.followUpOrderItems)
          .leftJoin(schema.products, eq(schema.followUpOrderItems.productId, schema.products.id))
          .where(eq(schema.followUpOrderItems.followUpOrderId, orderId));
      }
    }

    if (orderItems.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order has no line items to allocate.' });
    }

    // Expand bundle products into their components for allocation eligibility.
    // The order item shows the bundle name, but stock lives on the components.
    const rawProductIds = [...new Set(orderItems.map((i) => i.productId))];
    const bundleRows = rawProductIds.length > 0
      ? await this.db
          .select({
            bundleProductId: schema.productBundleComponents.bundleProductId,
            componentProductId: schema.productBundleComponents.componentProductId,
            quantity: schema.productBundleComponents.quantity,
          })
          .from(schema.productBundleComponents)
          .where(inArray(schema.productBundleComponents.bundleProductId, rawProductIds))
      : [];
    const bundleComponentMap = new Map<string, Array<{ componentProductId: string; quantity: number }>>();
    for (const row of bundleRows) {
      let comps = bundleComponentMap.get(row.bundleProductId);
      if (!comps) { comps = []; bundleComponentMap.set(row.bundleProductId, comps); }
      comps.push({ componentProductId: row.componentProductId, quantity: row.quantity });
    }

    // Resolve component product names if needed
    const componentIds = new Set<string>();
    for (const comps of bundleComponentMap.values()) {
      for (const c of comps) componentIds.add(c.componentProductId);
    }
    const componentNameMap = new Map<string, string>();
    if (componentIds.size > 0) {
      const nameRows = await this.db
        .select({ id: schema.products.id, name: schema.products.name })
        .from(schema.products)
        .where(inArray(schema.products.id, [...componentIds]));
      for (const r of nameRows) componentNameMap.set(r.id, r.name);
    }

    // Build the needs map — expanding bundles into component products
    const needsByProduct = new Map<string, { qty: number; name: string }>();
    for (const item of orderItems) {
      const components = bundleComponentMap.get(item.productId);
      if (components) {
        for (const comp of components) {
          const need = item.quantity * comp.quantity;
          const curr = needsByProduct.get(comp.componentProductId);
          needsByProduct.set(comp.componentProductId, {
            qty: (curr?.qty ?? 0) + need,
            name: componentNameMap.get(comp.componentProductId) ?? 'Unknown product',
          });
        }
      } else {
        const curr = needsByProduct.get(item.productId);
        needsByProduct.set(item.productId, {
          qty: (curr?.qty ?? 0) + item.quantity,
          name: item.productName ?? 'Unknown product',
        });
      }
    }

    const locations = await this.db
      .select({
        id: schema.logisticsLocations.id,
        name: schema.logisticsLocations.name,
        address: schema.logisticsLocations.address,
        whatsappGroupLink: schema.logisticsLocations.whatsappGroupLink,
        providerName: schema.logisticsProviders.name,
        providerKind: schema.logisticsProviders.kind,
        dispatchLocked: schema.logisticsLocations.dispatchLocked,
      })
      .from(schema.logisticsLocations)
      .leftJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(eq(schema.logisticsLocations.status, 'ACTIVE'))
      .orderBy(asc(schema.logisticsLocations.name));

    // CS_CLOSER must NOT see remaining-stock numbers (per CEO directive). Hide both the
    // per-product availability array AND the leaky "have X" details inside the reason text.
    // Everyone else with allocate authority (HoCS, HoLogistics, LogisticsManager, TPL_MANAGER,
    // BranchAdmin, StockManager, Admin, SuperAdmin, ...) sees the full breakdown.
    const hideStockCounts = viewerRole === 'CS_CLOSER';

    type LocationResult = {
      id: string;
      name: string;
      address: string | null;
      whatsappGroupLink: string | null;
      providerName: string | null;
      providerKind: string | null;
      eligible: boolean;
      reason: string | null;
      availabilityByProduct: Array<{
        productId: string;
        productName: string;
        needed: number;
        available: number;
      }> | null;
      stockBandByProduct: Array<{
        productId: string;
        productName: string;
        band: 'ABOVE_THRESHOLD' | 'BELOW_THRESHOLD';
      }> | null;
    };
    const results: LocationResult[] = [];
    const productIds = [...needsByProduct.keys()];

    // Batch availability across ALL active locations in one query to avoid N×round-trips
    // (which regularly times out on remote DBs and makes the UI show an empty list).
    const locationIds = locations.map((l) => l.id);
    const shelfAgg =
      productIds.length === 0 || locationIds.length === 0
        ? []
        : await this.db
            .select({
              locationId: schema.inventoryLevels.locationId,
              productId: schema.inventoryLevels.productId,
              available: sql<number>`COALESCE(
                SUM(${schema.inventoryLevels.stockCount} - ${schema.inventoryLevels.reservedCount}),
                0
              )::int`,
            })
            .from(schema.inventoryLevels)
            .where(
              and(
                inArray(schema.inventoryLevels.locationId, locationIds),
                inArray(schema.inventoryLevels.productId, productIds),
              ),
            )
            .groupBy(schema.inventoryLevels.locationId, schema.inventoryLevels.productId);

    const availableByLocationProduct = new Map<string, number>();
    for (const row of shelfAgg) {
      availableByLocationProduct.set(`${row.locationId}:${row.productId}`, Number(row.available) || 0);
    }

    for (const location of locations) {
      if (location.dispatchLocked) {
        results.push({
          id: location.id,
          name: location.name,
          address: location.address,
          whatsappGroupLink: location.whatsappGroupLink,
          providerName: location.providerName ?? null,
          providerKind: location.providerKind ?? null,
          eligible: false,
          reason: 'Dispatch locked at this location. Resolve stock reconciliations first.',
          availabilityByProduct: null,
          stockBandByProduct: null,
        });
        continue;
      }

      const availabilityByProduct: Array<{
        productId: string;
        productName: string;
        needed: number;
        available: number;
      }> = [];
      let detailedReason: string | null = null;
      let genericReason: string | null = null;

      for (const [productId, need] of needsByProduct) {
        const available = availableByLocationProduct.get(`${location.id}:${productId}`) ?? 0;
        availabilityByProduct.push({
          productId,
          productName: need.name,
          needed: need.qty,
          available,
        });

        if (detailedReason == null) {
          if (available <= 0) {
            detailedReason = `No sellable shelf stock for ${need.name} at this hub. Receive stock first.`;
            genericReason = 'No inventory at this location.';
          } else if (available < need.qty) {
            detailedReason = `Insufficient ${need.name} stock (need ${need.qty}, have ${available}).`;
            genericReason = 'Insufficient stock for one or more products.';
          }
        }
      }

      // CS_CLOSER gets a coarse band per product instead of exact counts — enough
      // signal to spot a hub that's running low, no precise leakage.
      const stockBandByProduct = hideStockCounts
        ? availabilityByProduct.map((p) => ({
            productId: p.productId,
            productName: p.productName,
            band:
              p.available >= OrdersService.CS_STOCK_BAND_THRESHOLD
                ? ('ABOVE_THRESHOLD' as const)
                : ('BELOW_THRESHOLD' as const),
          }))
        : null;

      results.push({
        id: location.id,
        name: location.name,
        address: location.address,
        whatsappGroupLink: location.whatsappGroupLink,
        providerName: location.providerName ?? null,
        providerKind: location.providerKind ?? null,
        eligible: detailedReason == null,
        reason: hideStockCounts ? genericReason : detailedReason,
        availabilityByProduct: hideStockCounts ? null : availabilityByProduct,
        stockBandByProduct,
      });
    }

    // Sort: eligible first, then by total available stock descending (locations
    // with more stock surface first so CS picks the best-stocked hub), then alphabetical.
    return results.sort((a, b) => {
      const eligibleDiff = Number(b.eligible) - Number(a.eligible);
      if (eligibleDiff !== 0) return eligibleDiff;
      // Sum available stock across all products at each location
      const aStock = a.availabilityByProduct?.reduce((sum, p) => sum + p.available, 0) ?? 0;
      const bStock = b.availabilityByProduct?.reduce((sum, p) => sum + p.available, 0) ?? 0;
      if (bStock !== aStock) return bStock - aStock;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Get the customer contact for manual calling (VOIP off).
   * Only works when VOIP feature flag is OFF. Does NOT insert MANUAL_CALL — that is recorded
   * when the agent clicks "Copy number" or "Call on my phone" in the UI (via initiateCall).
   * When the order was created via the edge form, customer_phone_hash stores a one-way hash,
   * so the real number cannot be revealed; we return isDialable: false and the UI shows a message.
   */
  async revealPhoneForManualCall(orderId: string, actor: SessionUser): Promise<{ phone: string; isDialable: boolean }> {
    const voipSetting = await this.settingsService.get('VOIP_ENABLED');
    const isVoipEnabled = voipSetting?.['enabled'] === true;
    if (isVoipEnabled) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'VOIP is enabled. Phone numbers cannot be revealed. Use the VOIP call button instead.',
      });
    }

    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    let order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    if (order.status === 'UNPROCESSED' || order.status === 'CS_ASSIGNED') {
      // Pass `engagementMethod: 'phone_revealed'` so the timeline records the EXACT
      // action the Sales rep took (revealed + copied the customer's phone for a manual
      // dial) instead of the generic "started customer engagement" line.
      await this.transition(
        {
          orderId,
          newStatus: 'CS_ENGAGED',
          metadata: { engagementMethod: 'phone_revealed' },
        },
        actor,
      );

      const refreshedRows = await this.db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);
      const refreshed = refreshedRows[0];
      if (!refreshed) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found after engagement transition' });
      }
      order = refreshed;
    }

    // Phone is always available regardless of status — no re-masking after first call.
    // VOIP gate + role/assignment gate above are sufficient.

    const elevatedPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const isElevated =
      actor.role === 'SUPER_ADMIN' ||
      elevatedPerms.includes(canonicalPermissionCode('cs.scope.global')) ||
      elevatedPerms.includes(canonicalPermissionCode('orders.update.any_branch'));
    if (!isElevated && order.assignedCsId !== actor.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not assigned to this order',
      });
    }

    // Prefer stored raw phone (set by Edge on create) so CS can copy/dial when VOIP is off
    const rawPhone = order.customerPhone?.trim();
    if (rawPhone) {
      return { phone: rawPhone, isDialable: true };
    }

    const value = order.customerPhoneHash;
    // Edge form may send only SHA-256 hash (64 hex chars); we cannot reveal the real number
    const isDialable = !/^[a-f0-9]{64}$/i.test(value ?? '');
    return { phone: value ?? '', isDialable };
  }

  /**
   * Read-only phone lookup for the order detail loader. Returns the callable phone
   * when VOIP is off and the viewer is authorised; `null` otherwise. No side effects
   * — the CS_ENGAGED transition + MANUAL_CALL log happen via `initiateCall` on click.
   */
  async getCallablePhoneForViewer(
    orderId: string,
    actor: SessionUser,
  ): Promise<{ phone: string; isDialable: boolean } | null> {
    const voipSetting = await this.settingsService.get('VOIP_ENABLED');
    if (voipSetting?.['enabled'] === true) return null;

    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    const order = rows[0];
    if (!order) return null;

    // Phone is always visible once loaded — no status restriction.
    // VOIP gate + role/assignment gate above are sufficient.

    const elevatedPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const isElevated =
      actor.role === 'SUPER_ADMIN' ||
      elevatedPerms.includes(canonicalPermissionCode('cs.scope.global')) ||
      elevatedPerms.includes(canonicalPermissionCode('orders.update.any_branch'));
    if (!isElevated && order.assignedCsId !== actor.id) return null;

    const rawPhone = order.customerPhone?.trim();
    if (rawPhone) return { phone: rawPhone, isDialable: true };

    const value = order.customerPhoneHash;
    const isDialable = !/^[a-f0-9]{64}$/i.test(value ?? '');
    return { phone: value ?? '', isDialable };
  }

  /**
   * Plain-text order summary for WhatsApp / logistics. Same read gate as `getById`.
   * Phone line uses the stored `customer_phone` when present; otherwise scans delivery
   * notes, address, and custom field strings for a Nigerian mobile so paste is the
   * full number (not a mask). Nigerian GSM is normalized to compact `+234…` for
   * tap-to-call in WhatsApp/dialers. If nothing is found, paste explains VOIP fallback.
   */
  async getClipboardSummaryText(orderId: string, actor: SessionUser): Promise<string> {
    let detail: Awaited<ReturnType<typeof this.getById>>;
    try {
      detail = await this.getById(orderId);
      this.assertActorMayViewOrderForRead(actor, detail);
    } catch {
      // Fallback: try follow_up_orders, then cart_orders
      try {
        return await this.getFollowUpClipboardSummaryText(orderId);
      } catch {
        return await this.getCartOrderClipboardSummaryText(orderId, actor);
      }
    }

    const [phoneRow] = await this.db
      .select({
        customerPhone: schema.orders.customerPhone,
        customerPhoneHash: schema.orders.customerPhoneHash,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);

    const resolved = resolveOrderClipboardPhone({
      customerPhone: phoneRow?.customerPhone,
      deliveryNotes: detail.deliveryNotes,
      customerAddress: detail.customerAddress,
      customFields: detail.customFields as Record<string, unknown> | null | undefined,
    });

    const phoneForPaste =
      resolved != null
        ? formatNigerianPhoneForClipboardPaste(resolved.trim())
        : 'Not available — full phone was not found on this order. Use VOIP from the order screen to contact the customer.';

    return buildOrderClipboardSummaryText({
      id: detail.id,
      orderNumber: detail.orderNumber,
      status: detail.status,
      customerName: detail.customerName,
      customerPhoneForPaste: phoneForPaste,
      deliveryAddress: detail.deliveryAddress ?? null,
      customerAddress: detail.customerAddress ?? null,
      deliveryState: detail.deliveryState ?? null,
      orderItems: detail.orderItems,
      totalAmount: detail.totalAmount ?? null,
      createdAt: detail.createdAt ? String(detail.createdAt) : null,
      preferredDeliveryDate: detail.preferredDeliveryDate ?? null,
      logisticsLocationName: detail.logisticsLocationName ?? null,
      logisticsProviderName: detail.logisticsProviderName ?? null,
      paymentStatus: detail.paymentStatus ?? null,
      deliveryNotes: detail.deliveryNotes ?? null,
      assignedCsName: detail.assignedCsName ?? null,
      campaignCustomFieldDefs: detail.campaignCustomFieldDefs,
      customFields: detail.customFields as Record<string, unknown> | null | undefined,
    });
  }

  /** Clipboard summary for a follow-up order (lives in follow_up_orders, not orders). */
  private async getFollowUpClipboardSummaryText(orderId: string): Promise<string> {
    const [fu] = await this.db.select().from(schema.followUpOrders).where(eq(schema.followUpOrders.id, orderId)).limit(1);
    if (!fu) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });

    const [items, closerName] = await Promise.all([
      this.db
        .select({ productId: schema.followUpOrderItems.productId, quantity: schema.followUpOrderItems.quantity, unitPrice: schema.followUpOrderItems.unitPrice, offerLabel: schema.followUpOrderItems.offerLabel, productName: schema.products.name })
        .from(schema.followUpOrderItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.followUpOrderItems.productId))
        .where(eq(schema.followUpOrderItems.followUpOrderId, orderId)),
      fu.assignedCsId
        ? this.db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, fu.assignedCsId)).limit(1).then((r) => r[0]?.name ?? null)
        : Promise.resolve(null),
    ]);

    const resolved = resolveOrderClipboardPhone({
      customerPhone: fu.customerPhone,
      deliveryNotes: fu.deliveryNotes,
      customerAddress: fu.customerAddress,
      customFields: fu.customFields as Record<string, unknown> | null | undefined,
    });
    const phoneForPaste = resolved != null
      ? formatNigerianPhoneForClipboardPaste(resolved.trim())
      : 'Not available';

    return buildOrderClipboardSummaryText({
      id: fu.id,
      orderNumber: fu.orderNumber,
      status: fu.status,
      customerName: fu.customerName,
      customerPhoneForPaste: phoneForPaste,
      deliveryAddress: fu.deliveryAddress ?? null,
      customerAddress: fu.customerAddress ?? null,
      deliveryState: fu.deliveryState ?? null,
      orderItems: items.map((it) => ({ id: it.productId, productId: it.productId, quantity: it.quantity, unitPrice: it.unitPrice, productName: it.productName, offerLabel: it.offerLabel })),
      totalAmount: fu.totalAmount ?? null,
      createdAt: fu.createdAt ? String(fu.createdAt) : null,
      preferredDeliveryDate: fu.preferredDeliveryDate ?? null,
      logisticsLocationName: null,
      logisticsProviderName: null,
      paymentStatus: fu.paymentStatus ?? null,
      deliveryNotes: fu.deliveryNotes ?? null,
      assignedCsName: closerName,
      campaignCustomFieldDefs: [],
      customFields: fu.customFields as Record<string, unknown> | null | undefined,
    });
  }

  /** Clipboard summary for a cart order (lives in cart_orders, not orders). */
  private async getCartOrderClipboardSummaryText(orderId: string, _actor: SessionUser): Promise<string> {
    const [co] = await this.db.select().from(schema.cartOrders).where(and(eq(schema.cartOrders.id, orderId), isNull(schema.cartOrders.deletedAt))).limit(1);
    if (!co) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });

    const [items, closerName] = await Promise.all([
      this.db
        .select({ productId: schema.cartOrderItems.productId, quantity: schema.cartOrderItems.quantity, unitPrice: schema.cartOrderItems.unitPrice, offerLabel: schema.cartOrderItems.offerLabel, productName: schema.products.name })
        .from(schema.cartOrderItems)
        .innerJoin(schema.products, eq(schema.products.id, schema.cartOrderItems.productId))
        .where(eq(schema.cartOrderItems.cartOrderId, orderId)),
      co.assignedCsId
        ? this.db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, co.assignedCsId)).limit(1).then((r) => r[0]?.name ?? null)
        : Promise.resolve(null),
    ]);

    const resolved = resolveOrderClipboardPhone({
      customerPhone: co.customerPhone,
      deliveryNotes: co.deliveryNotes,
      customerAddress: co.customerAddress,
      customFields: co.customFields as Record<string, unknown> | null | undefined,
    });
    const phoneForPaste = resolved != null
      ? formatNigerianPhoneForClipboardPaste(resolved.trim())
      : 'Not available';

    return buildOrderClipboardSummaryText({
      id: co.id,
      orderNumber: co.orderNumber,
      status: co.status,
      customerName: co.customerName,
      customerPhoneForPaste: phoneForPaste,
      deliveryAddress: co.deliveryAddress ?? null,
      customerAddress: co.customerAddress ?? null,
      deliveryState: co.deliveryState ?? null,
      orderItems: items.map((it) => ({ id: it.productId, productId: it.productId, quantity: it.quantity, unitPrice: it.unitPrice, productName: it.productName, offerLabel: it.offerLabel })),
      totalAmount: co.totalAmount ?? null,
      createdAt: co.createdAt ? String(co.createdAt) : null,
      preferredDeliveryDate: co.preferredDeliveryDate ?? null,
      logisticsLocationName: null,
      logisticsProviderName: null,
      paymentStatus: co.paymentStatus ?? null,
      deliveryNotes: co.deliveryNotes ?? null,
      assignedCsName: closerName,
      campaignCustomFieldDefs: [],
      customFields: co.customFields as Record<string, unknown> | null | undefined,
    });
  }

  /**
   * List orders with filtering, search, and pagination.
   */
  async list(
    input: ListOrdersInput,
    branchId?: string | null,
    listOpts?: {
      assignedCloserViewerId?: string;
      searchIncludeCustomerPhone?: boolean;
      /** Branch scoping — see `orderBranchScopeCondition`. `'marketing'` filters
       *  by `orders.branch_id` (campaign branch); `'servicing'` (default) by
       *  `orders.servicing_branch_id` (CS branch). Marketing viewers pass
       *  `'marketing'`. */
      branchScope?: 'servicing' | 'marketing';
      effectiveBranchIds?: string[] | null;
      /** When true, strictly exclude graduated follow-up and cart orders.
       *  CS surfaces pass true so closers only see orders they worked. */
      excludeGraduated?: boolean;
    },
  ) {
    // Skip the exclusion gate when explicitly querying DELETED orders —
    // otherwise the isNull(deletedAt) + status != CANCELLED filter would exclude them.
    // CEO directive 2026-05-23: CANCELLED is legacy-deleted, excluded from default views.
    const wantsDeleted =
      input.status === 'DELETED' || (input.statuses?.includes('DELETED') ?? false);
    const conditions: Parameters<typeof and>[0][] = wantsDeleted
      ? []
      : [isNull(schema.orders.deletedAt), sql`${schema.orders.status} != 'CANCELLED'`];

    // Follow-up / cart-graduated isolation.
    if (listOpts?.excludeGraduated) {
      // Strict exclusion: no follow-up orders, no cart-graduated orders.
      // CS surfaces use this so closers don't get credit for follow-up
      // and cart recovery deliveries (CEO 2026-06-30).
      conditions.push(eq(schema.orders.isFollowUp, false));
      conditions.push(sql`${schema.orders.cartId} IS NULL`);
    } else if (input.isFollowUp) {
      // Show ONLY follow-ups (follow-up batch detail page).
      conditions.push(eq(schema.orders.isFollowUp, true));
    } else if (input.excludeFollowUp !== false) {
      // Default: exclude follow-ups but let delivered/remitted ones "graduate"
      // into normal views for marketing metrics (CEO 2026-06-09).
      conditions.push(
        sql`(${schema.orders.isFollowUp} = false OR (${schema.orders.isFollowUp} = true AND ${schema.orders.status} IN ('DELIVERED', 'REMITTED')))`,
      );
    }

    // Frozen filter — 'frozen' = only frozen orders, 'active' = only non-frozen
    if (input.frozenFilter === 'frozen') {
      conditions.push(eq(schema.orders.frozenForFollowUp, true));
    } else if (input.frozenFilter === 'active') {
      conditions.push(eq(schema.orders.frozenForFollowUp, false));
    }

    if (input.status) {
      // CEO directive 2026-05-23: CANCELLED is legacy — merge into DELETED tab.
      // When user requests DELETED, show both DELETED and legacy CANCELLED.
      if (input.status === 'DELETED') {
        conditions.push(inArray(schema.orders.status, ['DELETED', 'CANCELLED']));
      } else {
        conditions.push(eq(schema.orders.status, input.status));
      }
    }
    if (input.statuses?.length) {
      // Expand DELETED → [DELETED, CANCELLED] in multi-status queries too.
      const expanded = input.statuses.includes('DELETED')
        ? [...new Set([...input.statuses, 'CANCELLED' as typeof input.statuses[number]])]
        : input.statuses;
      conditions.push(inArray(schema.orders.status, expanded));
    }
    // Mirrors `appendOrdersAggregateScopeConditions` / `narrowOrdersAggregateFiltersForViewer`:
    // supervisor OR-scope replaces single-ID filters — AND-ing `assignedCsId` would hide
    // supervised MB funnel rows (`assigned_cs_id` IS NULL) from list/count parity.
    if (input.supervisorScope) {
      const { csUserIds, mediaBuyerIds } = input.supervisorScope;
      // When a specific mediaBuyerId filter is also present (e.g. supervisor viewing
      // a team member's orders from Team Analysis), narrow to that single MB within
      // the team boundary instead of showing all team orders.
      if (input.mediaBuyerId && mediaBuyerIds.includes(input.mediaBuyerId)) {
        conditions.push(eq(schema.orders.mediaBuyerId, input.mediaBuyerId));
      } else {
        // Supervisor "my team only" scope (Phase B) — OR across the two dimensions:
        // assigned to a Sales team agent OR created by a supervised MB. Both lists also
        // include the actor's own id so a supervisor sees their own work.
        const orParts = [];
        if (csUserIds.length > 0) orParts.push(inArray(schema.orders.assignedCsId, csUserIds));
        if (mediaBuyerIds.length > 0) orParts.push(inArray(schema.orders.mediaBuyerId, mediaBuyerIds));
        if (orParts.length === 0) {
          conditions.push(sql`FALSE`);
        } else {
          const combined = or(...orParts);
          if (combined) conditions.push(combined);
        }
      }
    } else {
      if (input.assignedCsId) {
        conditions.push(eq(schema.orders.assignedCsId, input.assignedCsId));
      }
      if (input.mediaBuyerId) {
        conditions.push(eq(schema.orders.mediaBuyerId, input.mediaBuyerId));
      }
    }
    if (input.campaignId) {
      conditions.push(eq(schema.orders.campaignId, input.campaignId));
    }
    if (input.productId) {
      conditions.push(
        exists(
          this.db
            .select({ one: sql`1` })
            .from(schema.orderItems)
            .where(
              and(
                eq(schema.orderItems.orderId, schema.orders.id),
                eq(schema.orderItems.productId, input.productId),
              ),
            ),
        ),
      );
    }
    if (input.riderId) {
      conditions.push(eq(schema.orders.riderId, input.riderId));
    }
    if (input.logisticsLocationId) {
      conditions.push(eq(schema.orders.logisticsLocationId, input.logisticsLocationId));
    }
    if (input.fromCart) {
      // Recovered-from-cart filter — orders.cart_id back-link populated when
      // the order was created from an abandoned/converted cart. Index lives on
      // the partial index `orders_cart_id_idx` (migration 0142).
      conditions.push(sql`${schema.orders.cartId} IS NOT NULL`);
    }
    if (input.testOrders) {
      // Same whole-word "test" match as TestOrderPurgeService.
      conditions.push(sql`btrim(${schema.orders.customerName}) ~* '^test([^[:alpha:]]|$)'`);
    }
    if (input.orderSource) {
      if (input.orderSource === 'edge-form') {
        // edge-form includes legacy orders with NULL orderSource (pre-migration)
        // plus cart-graduated orders ('online') so recovered carts appear on Marketing Orders.
        conditions.push(sql`(${schema.orders.orderSource} IS NULL OR ${schema.orders.orderSource} = 'edge-form' OR ${schema.orders.orderSource} = 'online')`);
      } else {
        conditions.push(eq(schema.orders.orderSource, input.orderSource));
      }
    }
    if (input.search) {
      const trimmed = input.search.trim();
      if (trimmedSearchLooksLikeUuid(trimmed)) {
        // Fast-path: exact ID match can use the PK index (ILIKE would force a scan).
        conditions.push(eq(schema.orders.id, trimmed));
      } else if (trimmed.length > 0) {
        // Check if search looks like an order number: "YNS-00123", "YNS00123", or bare "00123"
        const orderNumMatch = trimmed.match(/^(?:YNS[- ]?)?(\d{1,7})$/i);
        const parsedOrderNum = orderNumMatch?.[1] ? parseInt(orderNumMatch[1], 10) : NaN;

        if (!Number.isNaN(parsedOrderNum) && parsedOrderNum > 0) {
          // Could be an order number OR a name/phone — OR them so both paths work.
          const numCondition = eq(schema.orders.orderNumber, parsedOrderNum);
          const nameMatch = ilike(schema.orders.customerName, `%${trimmed}%`);
          const combined = or(numCondition, nameMatch);
          if (combined) conditions.push(combined);
        } else {
          const nameMatch = ilike(schema.orders.customerName, `%${trimmed}%`);
          const digitRun = trimmed.replace(/\D/g, '');
          const canMatchStoredPhone =
            listOpts?.searchIncludeCustomerPhone === true &&
            digitRun.length >= 7 &&
            digitRun.length <= 24;
          if (canMatchStoredPhone) {
            const runs = expandCustomerPhoneSearchDigitRuns(digitRun);
            const phoneParts = runs.map((r) => ilike(schema.orders.customerPhone, `%${r}%`));
            const phoneOr = phoneParts.length > 1 ? or(...phoneParts) : phoneParts[0];
            const combined = phoneOr ? or(nameMatch, phoneOr) : nameMatch;
            if (combined) conditions.push(combined);
          } else {
            conditions.push(nameMatch);
          }
        }
      }
    }
    if (input.startDate) {
      conditions.push(gte(schema.orders.createdAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.orders.createdAt, nigeriaDayEnd(input.endDate)));
    }
    {
      const scope = listOpts?.branchScope ?? 'servicing';
      const eIds = listOpts?.effectiveBranchIds;
      if (
        branchId &&
        listOpts?.assignedCloserViewerId &&
        input.assignedCsId &&
        input.assignedCsId === listOpts.assignedCloserViewerId
      ) {
        // CS-closer "my servicing branch OR assigned to me" path — a closer
        // sees the pool of orders their branch services, plus any order
        // assigned to them even if attributed/serviced elsewhere.
        const branchOrAssigned = or(
          eq(schema.orders.servicingBranchId, branchId),
          eq(schema.orders.assignedCsId, input.assignedCsId),
        );
        if (branchOrAssigned) conditions.push(branchOrAssigned);
      } else {
        const cond = this.orderBranchScopeCondition(branchId, scope, eIds);
        if (cond) conditions.push(cond);
      }
    }

    if (input.scheduleKind === 'callback_due') {
      conditions.push(sql`${schema.orders.callbackScheduledAt} IS NOT NULL`);
      conditions.push(sql`${schema.orders.callbackScheduledAt} <= NOW()`);
      conditions.push(inArray(schema.orders.status, [...CALLBACK_PRECONFIRM_STATUSES]));
    } else if (input.scheduleKind === 'callback_on_day' && input.scheduleDate) {
      conditions.push(sql`${schema.orders.callbackScheduledAt} IS NOT NULL`);
      conditions.push(sql`${schema.orders.callbackAttempts} > 0`);
      conditions.push(inArray(schema.orders.status, [...CALLBACK_PRECONFIRM_STATUSES]));
      // Lagos wall date — org ops default (same as scheduleCalendarHeat).
      conditions.push(
        sql`(${schema.orders.callbackScheduledAt} AT TIME ZONE 'Africa/Lagos')::date = ${input.scheduleDate}::date`,
      );
    } else if (input.scheduleKind === 'delivery_on_day' && input.scheduleDate) {
      conditions.push(PREFERRED_DELIVERY_ISO_SQL);
      conditions.push(eq(schema.orders.preferredDeliveryDate, input.scheduleDate));
    } else if (input.scheduleKind === 'delivery_overdue') {
      conditions.push(PREFERRED_DELIVERY_ISO_SQL);
      conditions.push(
        sql`(${schema.orders.preferredDeliveryDate})::date < (timezone('Africa/Lagos', now()))::date`,
      );
      conditions.push(notInArray(schema.orders.status, [...DELIVERY_OVERDUE_EXCLUDED_STATUSES]));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderByColumn = {
      createdAt: schema.orders.createdAt,
      updatedAt: schema.orders.updatedAt,
      status: schema.orders.status,
      totalAmount: schema.orders.totalAmount,
      preferredDeliveryDate: schema.orders.preferredDeliveryDate,
    }[input.sortBy];

    const orderDirection = input.sortOrder === 'asc' ? asc : desc;

    // For preferredDeliveryDate, push NULLs to the end so orders with a date come first
    const orderByClauses =
      input.sortBy === 'preferredDeliveryDate'
        ? [
            sql`${schema.orders.preferredDeliveryDate} IS NULL ASC`,
            orderDirection(orderByColumn),
          ]
        : [orderDirection(orderByColumn)];

    const offset = (input.page - 1) * input.limit;

    // List pages only need a narrow subset of the order row (avoid pulling heavy JSON/text
    // columns like `items` / `custom_fields` that are used only on detail screens).
    const ordersListSelect = {
      id: schema.orders.id,
      orderNumber: schema.orders.orderNumber,
      status: schema.orders.status,
      customerName: schema.orders.customerName,
      customerPhoneHash: schema.orders.customerPhoneHash,
      customerPhone: schema.orders.customerPhone,
      totalAmount: schema.orders.totalAmount,
      createdAt: schema.orders.createdAt,
      updatedAt: schema.orders.updatedAt,
      preferredDeliveryDate: schema.orders.preferredDeliveryDate,
      callbackScheduledAt: schema.orders.callbackScheduledAt,
      assignedCsId: schema.orders.assignedCsId,
      mediaBuyerId: schema.orders.mediaBuyerId,
      campaignId: schema.orders.campaignId,
      branchId: schema.orders.branchId,
      logisticsProviderId: schema.orders.logisticsProviderId,
      logisticsLocationId: schema.orders.logisticsLocationId,
      riderId: schema.orders.riderId,
      // Back-link to the abandoned cart this order was recovered from (migration 0142).
      // Surfaced so list rows can offer a "View cart" quick-detail action.
      cartId: schema.orders.cartId,
      // Duplicate flag — shown as a badge on the orders list table.
      isDuplicate: schema.orders.isDuplicate,
      // Follow-up flag — shown as a badge when order was reopened via Follow Up page.
      isFollowUp: schema.orders.isFollowUp,
      // Frozen flag — order pulled into follow-up pipeline, no further mutations.
      frozenForFollowUp: schema.orders.frozenForFollowUp,
      // Delivery address — used in exports.
      deliveryAddress: schema.orders.deliveryAddress,
    } as const;

    const [orders, totalRows] = await Promise.all([
      this.db
        .select(ordersListSelect)
        .from(schema.orders)
        .where(whereClause)
        .orderBy(...orderByClauses)
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Enrichment fan-out: 3 independent queries that previously ran serially (~4 RTTs to a
    // remote DB). Now collapsed into one Promise.all batch (1 wall-clock RTT) and the two
    // `users` lookups (mediaBuyer + assignedCs) merged into a single IN-list query.
    //   1) users — names for media buyers + assigned CS in one shot
    //   2) order_items — used to surface the "primary product" + item count per row
    //   3) campaigns — campaign names for the Form column in marketing views
    const mediaBuyerIds = [...new Set(orders.map((o) => o.mediaBuyerId).filter(Boolean))] as string[];
    const assignedCsIds = [...new Set(orders.map((o) => o.assignedCsId).filter(Boolean))] as string[];
    const userIdsToLookup = [...new Set([...mediaBuyerIds, ...assignedCsIds])];
    const orderIds = orders.map((o) => o.id);
    const campaignIds = [...new Set(orders.map((o) => o.campaignId).filter(Boolean))] as string[];

    const [usersRes, itemsRes, campsRes, commentsRes] = await Promise.all([
      userIdsToLookup.length > 0
        ? this.db
            .select({ id: schema.users.id, name: schema.users.name })
            .from(schema.users)
            .where(inArray(schema.users.id, userIdsToLookup))
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      orderIds.length > 0
        ? this.db
            .select({
              orderId: schema.orderItems.orderId,
              itemId: schema.orderItems.id,
              productId: schema.orderItems.productId,
              productName: schema.products.name,
              quantity: schema.orderItems.quantity,
            })
            .from(schema.orderItems)
            .leftJoin(schema.products, eq(schema.products.id, schema.orderItems.productId))
            .where(inArray(schema.orderItems.orderId, orderIds))
            .orderBy(asc(schema.orderItems.orderId), asc(schema.orderItems.id))
        : Promise.resolve(
            [] as Array<{
              orderId: string | null;
              itemId: string;
              productId: string;
              productName: string | null;
              quantity: number;
            }>,
          ),
      campaignIds.length > 0
        ? this.db
            .select({ id: schema.campaigns.id, name: schema.campaigns.name })
            .from(schema.campaigns)
            .where(inArray(schema.campaigns.id, campaignIds))
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      // 4) Last CS comment per order — for the list view comment indicator.
      orderIds.length > 0
        ? this.db
            .select({
              orderId: schema.orderTimelineEvents.orderId,
              eventType: schema.orderTimelineEvents.eventType,
              description: schema.orderTimelineEvents.description,
              actorName: schema.orderTimelineEvents.actorName,
              createdAt: schema.orderTimelineEvents.createdAt,
              metadata: schema.orderTimelineEvents.metadata,
            })
            .from(schema.orderTimelineEvents)
            .where(
              and(
                inArray(schema.orderTimelineEvents.orderId, orderIds),
                inArray(schema.orderTimelineEvents.eventType, ['CS_ORDER_COMMENT', 'CALLBACK_SCHEDULED']),
              ),
            )
            .orderBy(desc(schema.orderTimelineEvents.createdAt))
        : Promise.resolve(
            [] as Array<{
              orderId: string;
              eventType: string;
              description: string;
              actorName: string | null;
              createdAt: Date;
              metadata: unknown;
            }>,
          ),
    ]);

    const userNamesById = new Map<string, string>();
    for (const u of usersRes) userNamesById.set(u.id, u.name);

    const primaryItemByOrder = new Map<
      string,
      { productId: string; productName: string | null; itemCount: number; items: Array<{ name: string | null; qty: number }> }
    >();
    for (const item of itemsRes) {
      const oid = item.orderId;
      if (!oid) continue;
      const cur = primaryItemByOrder.get(oid);
      if (!cur) {
        primaryItemByOrder.set(oid, {
          productId: item.productId,
          productName: item.productName,
          itemCount: 1,
          items: [{ name: item.productName, qty: item.quantity }],
        });
      } else {
        cur.itemCount += 1;
        cur.items.push({ name: item.productName, qty: item.quantity });
      }
    }

    const campaignNames = new Map<string, string>();
    for (const c of campsRes) campaignNames.set(c.id, c.name);

    // Build last-comment map (first occurrence per order = most recent, since ordered DESC).
    const lastCommentByOrder = new Map<string, { comment: string; actorName: string | null; at: Date }>();
    for (const c of commentsRes) {
      if (lastCommentByOrder.has(c.orderId)) continue;
      let comment: string;
      if (c.eventType === 'CALLBACK_SCHEDULED') {
        // Extract just the note from "Callback scheduled for ... (note)" or use full description
        const noteMatch = c.description.match(/\(([^)]+)\)\s*$/);
        comment = noteMatch ? `Callback: ${noteMatch[1]}` : c.description;
      } else {
        const meta = c.metadata as { commentBody?: string } | null;
        comment = meta?.commentBody ?? c.description.replace(/^Comment:\s*/, '');
      }
      lastCommentByOrder.set(c.orderId, { comment, actorName: c.actorName, at: c.createdAt });
    }

    return {
      orders: orders.map((order) => {
        const { customerPhone, ...orderRest } = order;
        const primary = primaryItemByOrder.get(order.id);
        const lastComment = lastCommentByOrder.get(order.id) ?? null;
        return {
          ...orderRest,
          customerPhoneDisplay: formatOrderCustomerPhoneDisplay(customerPhone, order.customerPhoneHash),
          mediaBuyerName: order.mediaBuyerId ? userNamesById.get(order.mediaBuyerId) ?? null : null,
          assignedCsName: order.assignedCsId ? userNamesById.get(order.assignedCsId) ?? null : null,
          primaryProductId: primary?.productId ?? null,
          primaryProductName: primary?.productName ?? null,
          itemCount: primary?.itemCount ?? 0,
          productLines: primary?.items.map((i) => `${i.name ?? 'Unknown'} x${i.qty}`).join('; ') ?? '',
          campaignName: order.campaignId ? campaignNames.get(order.campaignId) ?? null : null,
          lastCsComment: lastComment,
        };
      }),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Per-day counts for CS schedule heat: ISO `preferred_delivery_date` + scheduled callbacks
   * (`callback_attempts > 0`, pre-confirm statuses), callback days in Africa/Lagos.
   */
  async scheduleCalendarHeat(
    input: ScheduleCalendarHeatInput,
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
  ): Promise<
    Array<{ date: string; callbackCount: number; deliveryCount: number; deliveredCount: number }>
  > {
    const [yearStr, monthStr] = input.yearMonth.split('-');
    const year = parseInt(yearStr!, 10);
    const month = parseInt(monthStr!, 10);
    const pad = (n: number) => String(n).padStart(2, '0');
    const firstDay = `${year}-${pad(month)}-01`;
    const lastDayNum = new Date(year, month, 0).getDate();
    const lastDay = `${year}-${pad(month)}-${pad(lastDayNum)}`;

    const base: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];
    // CS schedule calendar — scope by the servicing branch (migration 0150).
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) base.push(bCond);
    if (input.supervisorScope) {
      const { csUserIds, mediaBuyerIds } = input.supervisorScope;
      const orParts = [];
      if (csUserIds.length > 0) orParts.push(inArray(schema.orders.assignedCsId, csUserIds));
      if (mediaBuyerIds.length > 0) orParts.push(inArray(schema.orders.mediaBuyerId, mediaBuyerIds));
      if (orParts.length === 0) {
        base.push(sql`FALSE`);
      } else {
        const combined = or(...orParts);
        if (combined) base.push(combined);
      }
    } else {
      if (input.assignedCsId) base.push(eq(schema.orders.assignedCsId, input.assignedCsId));
      if (input.mediaBuyerId) base.push(eq(schema.orders.mediaBuyerId, input.mediaBuyerId));
    }
    if (input.status) base.push(eq(schema.orders.status, input.status));

    const deliveryWhere = and(
      ...base,
      PREFERRED_DELIVERY_ISO_SQL,
      gte(schema.orders.preferredDeliveryDate, firstDay),
      lte(schema.orders.preferredDeliveryDate, lastDay),
    );

    const deliveryRows = await this.db
      .select({
        date: schema.orders.preferredDeliveryDate,
        deliveryCount: count(),
        deliveredCount: sql<number>`sum(case when ${schema.orders.status} in ('DELIVERED', 'REMITTED', 'PARTIALLY_DELIVERED') then 1 else 0 end)::int`,
      })
      .from(schema.orders)
      .where(deliveryWhere)
      .groupBy(schema.orders.preferredDeliveryDate);

    const lagosDayExpr = sql`(${schema.orders.callbackScheduledAt} AT TIME ZONE 'Africa/Lagos')::date`;

    const callbackWhere = and(
      ...base,
      sql`${schema.orders.callbackScheduledAt} IS NOT NULL`,
      sql`${schema.orders.callbackAttempts} > 0`,
      inArray(schema.orders.status, [...CALLBACK_PRECONFIRM_STATUSES]),
      sql`${lagosDayExpr} >= ${firstDay}::date`,
      sql`${lagosDayExpr} <= ${lastDay}::date`,
    );

    const callbackRows = await this.db
      .select({
        date: lagosDayExpr,
        callbackCount: count(),
      })
      .from(schema.orders)
      .where(callbackWhere)
      .groupBy(lagosDayExpr);

    const normalizeDate = (d: unknown): string => {
      if (typeof d === 'string') return d.split('T')[0]!;
      if (d instanceof Date) return d.toISOString().split('T')[0]!;
      return String(d);
    };

    const map = new Map<
      string,
      { date: string; callbackCount: number; deliveryCount: number; deliveredCount: number }
    >();
    for (const row of deliveryRows) {
      if (!row.date) continue;
      const date = row.date;
      map.set(date, {
        date,
        deliveryCount: Number(row.deliveryCount ?? 0),
        deliveredCount: Number(row.deliveredCount ?? 0),
        callbackCount: 0,
      });
    }
    for (const row of callbackRows) {
      const date = normalizeDate(row.date);
      const existing = map.get(date);
      if (existing) {
        existing.callbackCount = Number(row.callbackCount ?? 0);
      } else {
        map.set(date, {
          date,
          callbackCount: Number(row.callbackCount ?? 0),
          deliveryCount: 0,
          deliveredCount: 0,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Batched line labels + campaign + branch names for marketing CSV export (avoids N+1).
   */
  async getMarketingExportEnrichment(orderIds: string[]): Promise<
    Map<string, { productLines: string; campaignName: string; branchName: string }>
  > {
    const out = new Map<string, { productLines: string; campaignName: string; branchName: string }>();
    if (orderIds.length === 0) return out;
    const unique = [...new Set(orderIds)];
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 400) chunks.push(unique.slice(i, i + 400));

    for (const chunk of chunks) {
      const lineRows = await this.db
        .select({
          orderId: schema.orderItems.orderId,
          productLines:
            sql<string>`string_agg(${schema.products.name} || ' x' || ${schema.orderItems.quantity}::text, '; ' ORDER BY ${schema.orderItems.id})`.as(
              'product_lines',
            ),
        })
        .from(schema.orderItems)
        .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
        .where(inArray(schema.orderItems.orderId, chunk))
        .groupBy(schema.orderItems.orderId);

      const metaRows = await this.db
        .select({
          id: schema.orders.id,
          campaignName: schema.campaigns.name,
          branchName: schema.branches.name,
        })
        .from(schema.orders)
        .leftJoin(schema.campaigns, eq(schema.orders.campaignId, schema.campaigns.id))
        .leftJoin(schema.branches, eq(schema.orders.branchId, schema.branches.id))
        .where(and(inArray(schema.orders.id, chunk), isNull(schema.orders.deletedAt)));

      const metaById = new Map(metaRows.map((r) => [r.id, r]));
      const linesByOrder = new Map(lineRows.map((r) => [r.orderId, r.productLines]));

      for (const id of chunk) {
        const meta = metaById.get(id);
        out.set(id, {
          productLines: linesByOrder.get(id) ?? '—',
          campaignName: meta?.campaignName ?? '—',
          branchName: meta?.branchName ?? '—',
        });
      }
    }

    return out;
  }

  /**
   * Transition an order to a new status.
   * Enforces the state machine, gates, and side effects.
   */
  async transition(input: TransitionOrderInput, actor: SessionUser) {
    // Get current order. We intentionally do NOT filter `isNull(deletedAt)` here:
    // DELETED rows still need to be selectable so Admin/SuperAdmin can run the
    // explicit `DELETED → UNPROCESSED` restore branch handled below (the state
    // machine + status-based permission gates control which transitions are
    // valid, so other status changes from DELETED are still blocked).
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, input.orderId))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // Frozen orders cannot be transitioned (follow-up config or manual freeze).
    if (order.frozenForFollowUp) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This order is frozen. No further changes allowed.' });
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

    // Permission gates: short-circuit for SUPER_ADMIN, otherwise resolve the actor's
    // canonical permission set once and reuse across the transition checks below.
    const transitionPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasPerm = (code: string) =>
      actor.role === 'SUPER_ADMIN' || transitionPerms.includes(canonicalPermissionCode(code));
    const sameBranchAsOrder =
      !!order.branchId && !!actor.currentBranchId && order.branchId === actor.currentBranchId;

    // Retrack guard: backward transitions (e.g. CONFIRMED → CS_ENGAGED) are
    // restricted to HoCS, HoLogistics, Admin, SuperAdmin, Support. A regular
    // CS_CLOSER must not be able to roll an order back — only forward or engage.
    const RETRACK_LIFECYCLE: Record<string, number> = {
      UNPROCESSED: 0, CS_ASSIGNED: 1, CS_ENGAGED: 2, CONFIRMED: 3,
      AGENT_ASSIGNED: 4, DISPATCHED: 5, IN_TRANSIT: 6, DELIVERED: 7, REMITTED: 8,
    };
    const isBackward =
      (RETRACK_LIFECYCLE[currentStatus] ?? -1) > (RETRACK_LIFECYCLE[newStatus] ?? -1) &&
      newStatus !== 'UNPROCESSED'; // DELETED→UNPROCESSED is a restore, handled separately
    if (isBackward) {
      const canRetrack =
        actor.role === 'SUPER_ADMIN' ||
        actor.role === 'ADMIN' ||
        actor.role === 'SUPPORT' ||
        actor.role === 'HEAD_OF_CS' ||
        actor.role === 'HEAD_OF_LOGISTICS';
      if (!canRetrack) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only Head of CS, Head of Logistics, or an Admin can retrack an order to an earlier status.',
        });
      }
    }

    // CS-only transitions (engagement, confirm): assigned Sales closer, anyone with
    // Sales scope (`cs.scope.global`), or branch admin (`branches.manage` + same-branch).
    const csOnlyTransitions =
      (currentStatus === 'UNPROCESSED' && newStatus === 'CS_ENGAGED') ||
      (currentStatus === 'CS_ASSIGNED' && newStatus === 'CS_ENGAGED') ||
      (currentStatus === 'CS_ENGAGED' && newStatus === 'CONFIRMED');
    if (csOnlyTransitions) {
      const isElevated =
        actor.role === 'SUPER_ADMIN' ||
        hasPerm('cs.scope.global') ||
        (hasPerm('branches.manage') && sameBranchAsOrder);
      if ((currentStatus === 'UNPROCESSED' || currentStatus === 'CS_ASSIGNED') && newStatus === 'CS_ENGAGED') {
        // Anyone with CS read access can engage an order from the pool.
        if (!isElevated && !hasPerm('orders.read')) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have CS access required to take this order.',
          });
        }
      } else {
        const isAssignedCs = order.assignedCsId === actor.id;
        if (!isElevated && !isAssignedCs) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'Only the assigned Sales closer, anyone with Sales scope, a Branch Admin (same branch), or an Admin may perform this transition.',
          });
        }
      }
    }

    // {UNPROCESSED|CS_ASSIGNED|CS_ENGAGED|CANCELLED} → DELETED: soft-delete.
    // Permission-gated via `orders.delete` — HoCS gets it by default (requires Admin
    // approval via permission request). CEO directive 2026-05-23: no more CANCELLED,
    // only DELETED. Replaces the old cancel flow entirely.
    if (newStatus === 'DELETED') {
      if (!isAdminLevel(actor) && !hasPerm('orders.delete')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have permission to delete orders. Request the orders.delete permission from an Admin.',
        });
      }
    }

    // CANCELLED → UNPROCESSED: restore legacy cancelled orders. Admin-only.
    if (currentStatus === 'CANCELLED' && newStatus === 'UNPROCESSED') {
      if (!isAdminLevel(actor)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only an Admin or Super Admin can restore a cancelled order.',
        });
      }
    }

    // DELETED → UNPROCESSED: restore a deleted order back to the queue.
    if (currentStatus === 'DELETED' && newStatus === 'UNPROCESSED') {
      if (!isAdminLevel(actor)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only an Admin or Super Admin can restore a deleted order.',
        });
      }
    }

    // CONFIRMED → ALLOCATED: assigned Sales closer (CS-as-rider-proxy), anyone with logistics
    // capability (`logistics.read` covers HoLogistics + LogisticsManager), or org-wide Sales scope.
    if (currentStatus === 'CONFIRMED' && newStatus === 'AGENT_ASSIGNED') {
      const isAssignedCs = order.assignedCsId === actor.id;
      const isAuthorized =
        actor.role === 'SUPER_ADMIN' ||
        hasPerm('cs.scope.global') ||
        hasPerm('logistics.scope.global') ||
        hasPerm('logistics.read') ||
        isAssignedCs;
      if (!isAuthorized) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the assigned Sales closer, Logistics, or an Admin can allocate this order to a 3PL location.',
        });
      }
    }

    // ALLOCATED → ALLOCATED: reassign to a different 3PL hub (same actor rules as first allocation).
    if (currentStatus === 'AGENT_ASSIGNED' && newStatus === 'AGENT_ASSIGNED') {
      const isAssignedCs = order.assignedCsId === actor.id;
      const isAuthorized =
        actor.role === 'SUPER_ADMIN' ||
        hasPerm('cs.scope.global') ||
        hasPerm('logistics.scope.global') ||
        hasPerm('logistics.read') ||
        isAssignedCs;
      if (!isAuthorized) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the assigned Sales closer, Logistics, or an Admin can reallocate this order to another 3PL location.',
        });
      }
    }

    // {ALLOCATED|DISPATCHED|IN_TRANSIT} → DELIVERED/PARTIALLY_DELIVERED:
    //   - anyone holding `orders.delivery.confirm` (HoLogistics, CS, TPL_MANAGER w/ receipt, Admin via ALL),
    //   - assigned Sales closer (rider-proxy follow-up call),
    //   - TPL_MANAGER specifically requires the receipt to be present (resolveReceiptUrl).
    //   3PL isn't in-app yet, so CS / HoLogistics marks delivered directly after ALLOCATED.
    if (
      (currentStatus === 'AGENT_ASSIGNED' || currentStatus === 'DISPATCHED' || currentStatus === 'IN_TRANSIT') &&
      (newStatus === 'DELIVERED' || newStatus === 'PARTIALLY_DELIVERED')
    ) {
      const hasResolveReceipt = !!order.resolveReceiptUrl?.trim();
      const isAssignedCs = order.assignedCsId === actor.id;
      // TPL_MANAGER specifically must have a resolve receipt — they're off-platform partners
      // who can only mark delivered after the resolve flow attached the receipt.
      const tplBlockedWithoutReceipt = actor.role === 'TPL_MANAGER' && !hasResolveReceipt;
      const isAuthorized =
        actor.role === 'SUPER_ADMIN' ||
        hasPerm('logistics.scope.global') ||
        (hasPerm('orders.delivery.confirm') && !tplBlockedWithoutReceipt) ||
        isAssignedCs;
      if (!isAuthorized) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Delivery confirmation requires Head of Logistics approval. Submit a delivery confirmation request instead.',
        });
      }
      // Delivery note is optional (CEO directive 2026-04-24 reversed the prior mandatory rule).
      // The note + screenshot fields are still persisted when provided.
    }

    // Block ALL forward transitions while a line-item change approval is
    // pending. CEO directive 2026-06-10: "All edit must seek permission …
    // if the order is not approved they should not be able to move forward."
    // Price AND product changes go through the same ORDER_LINE_PRICE_CHANGE
    // request type, so one check covers both.
    const forwardStatuses: string[] = [
      'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED',
    ];
    if (forwardStatuses.includes(newStatus) && newStatus !== currentStatus) {
      const pendingPriceReq = await this.findPendingOrderLinePriceRequest(order.id);
      const pendingPriceReqId = pendingPriceReq?.id ?? null;
      if (pendingPriceReqId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'This order has a pending item/price change approval. It cannot move forward until the change is approved or rejected.',
        });
      }
    }

    // Validate gates based on the transition
    await this.validateTransitionGates(order, newStatus, input.metadata, actor);

    let allocationProviderId: string | undefined;
    if (newStatus === 'AGENT_ASSIGNED' && typeof input.metadata?.logisticsLocationId === 'string') {
      const locRow = await this.db
        .select({ providerId: schema.logisticsLocations.providerId })
        .from(schema.logisticsLocations)
        .where(eq(schema.logisticsLocations.id, input.metadata.logisticsLocationId))
        .limit(1);
      allocationProviderId = locRow[0]?.providerId ?? undefined;
    }

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

    // Retrack: when rolling back to an earlier status, clear timestamps of
    // all later lifecycle stages so the order doesn't carry stale dates.
    // The timeline / activity log is untouched — it records every event permanently.
    const LIFECYCLE_ORDER: Array<{ status: string; tsField: string }> = [
      { status: 'CONFIRMED', tsField: 'confirmedAt' },
      { status: 'AGENT_ASSIGNED', tsField: 'allocatedAt' },
      { status: 'DISPATCHED', tsField: 'dispatchedAt' },
      { status: 'DELIVERED', tsField: 'deliveredAt' },
    ];
    const targetIdx = LIFECYCLE_ORDER.findIndex((s) => s.status === newStatus);
    const currentIdx = LIFECYCLE_ORDER.findIndex((s) => s.status === currentStatus);
    if (currentIdx > targetIdx) {
      // Rolling backward — clear all timestamp fields after the target status
      const startClear = targetIdx < 0 ? 0 : targetIdx + 1;
      for (let i = startClear; i < LIFECYCLE_ORDER.length; i++) {
        updateFields[LIFECYCLE_ORDER[i]!.tsField] = null;
      }
    }

    // 15-min order lock on CS_ENGAGED (agent clicks Call)
    if (newStatus === 'CS_ENGAGED') {
      const lockExpiry = new Date(Date.now() + 15 * 60 * 1000);
      updateFields['lockedUntil'] = lockExpiry;
      updateFields['lockedBy'] = actor.id;
    }

    // Save preferred delivery date on CONFIRMED (required — set by CS via confirm modal)
    if (newStatus === 'CONFIRMED') {
      updateFields['preferredDeliveryDate'] = String(
        input.metadata?.preferredDeliveryDate ?? '',
      ).trim();
    }

    // Clear lock when order moves past CS engagement.
    if (
      newStatus === 'CONFIRMED' ||
      newStatus === 'CANCELLED'
    ) {
      updateFields['lockedUntil'] = null;
      updateFields['lockedBy'] = null;
    }

    // Any status change clears the scheduled callback — once the closer acts
    // on the order (confirm, engage, transition, delete, etc.) the reminder
    // is no longer relevant.
    if (newStatus !== currentStatus) {
      updateFields['callbackScheduledAt'] = null;
    }

    // Restoring a cancelled or deleted order — send it back to the unassigned pool:
    // drop the previous closer + any stale lock so it re-enters CS distribution cleanly.
    if ((currentStatus === 'CANCELLED' || currentStatus === 'DELETED') && newStatus === 'UNPROCESSED') {
      updateFields['assignedCsId'] = null;
      updateFields['lockedUntil'] = null;
      updateFields['lockedBy'] = null;
      updateFields['deletedAt'] = null;
    }

    // Soft-delete: set deletedAt for backward compat with isNull(deletedAt) filters.
    if (newStatus === 'DELETED') {
      updateFields['deletedAt'] = new Date();
    }

    // Update agent's lastActionAt for dispatch tiebreaker + inactivity tracking.
    // Tracked for anyone with Sales scope (Sales closers, anyone with cs.scope.global, etc.).
    if (
      transitionPerms.includes(canonicalPermissionCode('orders.read')) &&
      (transitionPerms.includes(canonicalPermissionCode('cs.leaderboard')) ||
        transitionPerms.includes(canonicalPermissionCode('cs.scope.global')) ||
        transitionPerms.includes(canonicalPermissionCode('cs.teamOverview')))
    ) {
      await withActor(this.db, actor, async (tx) => {
        await tx
          .update(schema.users)
          .set({ lastActionAt: new Date() })
          .where(eq(schema.users.id, actor.id));
      });
    }

    // Generate OTP on DISPATCHED (single-use, sent to customer)
    if (newStatus === 'DISPATCHED') {
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      updateFields['deliveryOtp'] = otp;
    }

    // Persist GPS and clear OTP on DELIVERED (v2 may reintroduce OTP)
    if (newStatus === 'DELIVERED') {
      if (input.metadata?.gpsLat !== undefined) {
        updateFields['deliveryGpsLat'] = input.metadata.gpsLat.toString();
      }
      if (input.metadata?.gpsLng !== undefined) {
        updateFields['deliveryGpsLng'] = input.metadata.gpsLng.toString();
      }
      updateFields['deliveryOtp'] = null;
    }

    // v1: persist delivery proof URL when 3PL marks DELIVERED or PARTIALLY_DELIVERED
    if ((newStatus === 'DELIVERED' || newStatus === 'PARTIALLY_DELIVERED') && input.metadata?.deliveryProofUrl) {
      updateFields['deliveryProofUrl'] = String(input.metadata.deliveryProofUrl).trim();
    }

    // Persist the delivery note when provided on DELIVERED/PARTIALLY_DELIVERED (currently required
    // for CS-triggered confirmations; optional when elevated roles mark it).
    if ((newStatus === 'DELIVERED' || newStatus === 'PARTIALLY_DELIVERED') && input.metadata?.deliveryNote) {
      updateFields['deliveryNotes'] = String(input.metadata.deliveryNote).trim();
    }

    // Delivery fee add-on when marking DELIVERED or PARTIALLY_DELIVERED (3PL records delivery cost; required in v1)
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

    // Delivery discount when marking DELIVERED or PARTIALLY_DELIVERED (3PL can reduce order total at delivery)
    if (
      (newStatus === 'DELIVERED' || newStatus === 'PARTIALLY_DELIVERED') &&
      input.metadata?.deliveryDiscountAmount !== undefined
    ) {
      const discount = Number(input.metadata.deliveryDiscountAmount);
      if (!Number.isNaN(discount) && discount >= 0) {
        const currentTotal = parseFloat(String(order.totalAmount ?? 0)) || 0;
        const newTotal = Math.max(0, currentTotal - discount);
        updateFields['totalAmount'] = newTotal.toFixed(2);
        updateFields['deliveryDiscountAmount'] = discount.toFixed(2);
      }
    }

    // Set assignment fields based on transition metadata
    if (input.metadata?.logisticsLocationId) {
      updateFields['logisticsLocationId'] = input.metadata.logisticsLocationId;
    }
    if (input.metadata?.logisticsProviderId) {
      updateFields['logisticsProviderId'] = input.metadata.logisticsProviderId;
    } else if (allocationProviderId) {
      updateFields['logisticsProviderId'] = allocationProviderId;
    }
    if (currentStatus === 'AGENT_ASSIGNED' && newStatus === 'AGENT_ASSIGNED') {
      updateFields['riderId'] = null;
      updateFields['deliveryOtp'] = null;
    }
    if (input.metadata?.riderId && !(currentStatus === 'AGENT_ASSIGNED' && newStatus === 'AGENT_ASSIGNED')) {
      updateFields['riderId'] = input.metadata.riderId;
    }

    // Perform the update — wrapped in withActor so the temporal-audit trigger sees the actor.
    const updatedRows = await withActor(this.db, actor, async (tx) =>
      tx
        .update(schema.orders)
        .set(updateFields)
        .where(eq(schema.orders.id, input.orderId))
        .returning(),
    );

    const updated = updatedRows[0];
    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update order' });
    }

    // Execute side effects (stock reservation, deduction, etc.)
    await this.executeTransitionSideEffects(newStatus, order, updated, actor, input.metadata);

    // Auto-generate a draft invoice the first time an order is CONFIRMED. Idempotent
    // (skips if an invoice for this orderId already exists). Failures don't block the
    // status transition — they're logged so an admin can manually create the invoice.
    if (newStatus === 'CONFIRMED') {
      try {
        // Pass the already-loaded order through so the helper doesn't
        // re-fetch it on the hot CONFIRM path.
        await this.autoCreateInvoiceForOrder(order.id, actor, updated);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Auto-invoice for order ${order.id} failed: ${message}`);
      }
    }

    // Timeline event for this status transition
    // Maps `order_status` (the new value after the transition) to the
    // `event_type` enum value persisted on `order_timeline_events`. The
    // event_type enum still uses the legacy `ORDER_ALLOCATED` label so
    // existing audit rows stay valid; only the lookup key was renamed in
    // step with the status enum (`ALLOCATED` → `AGENT_ASSIGNED` per
    // CEO directive 2026-05-04, migration 0110). Without this rename the
    // map lookup returned `undefined` for re-allocations and we silently
    // dropped the timeline event for "Reassign to another location".
    const timelineEventMap: Partial<Record<string, string>> = {
      CS_ENGAGED: 'CALL_INITIATED',
      CONFIRMED: 'ORDER_CONFIRMED',
      CANCELLED: 'ORDER_CANCELLED',
      UNPROCESSED: 'ORDER_RESTORED',
      AGENT_ASSIGNED: 'ORDER_ALLOCATED',
      DISPATCHED: 'ORDER_DISPATCHED',
      IN_TRANSIT: 'ORDER_IN_TRANSIT',
      DELIVERED: 'ORDER_DELIVERED',
      PARTIALLY_DELIVERED: 'ORDER_PARTIALLY_DELIVERED',
      RETURNED: 'ORDER_RETURNED',
      RESTOCKED: 'ORDER_RESTOCKED',
      WRITTEN_OFF: 'ORDER_WRITTEN_OFF',
    };
    // Detect retrack (backward transition) by lifecycle position
    const LIFECYCLE_POSITION: Record<string, number> = {
      UNPROCESSED: 0, CS_ASSIGNED: 1, CS_ENGAGED: 2, CONFIRMED: 3,
      AGENT_ASSIGNED: 4, DISPATCHED: 5, IN_TRANSIT: 6, DELIVERED: 7, REMITTED: 8,
    };
    const isRetrack =
      (LIFECYCLE_POSITION[currentStatus] ?? -1) > (LIFECYCLE_POSITION[newStatus] ?? -1) &&
      newStatus !== 'UNPROCESSED'; // DELETED→UNPROCESSED is a restore, not a retrack

    const timelineType = isRetrack ? 'ORDER_RETRACKED' : timelineEventMap[newStatus];
    if (timelineType) {
      const reason = typeof input.metadata?.reason === 'string' ? input.metadata.reason : undefined;
      // Resolve the 3PL location name so the timeline reads
      // "Agent assigned for delivery at <Location>" instead of the generic logistics line.
      let logisticsLocationName: string | undefined;
      let logisticsProviderName: string | undefined;
      let reallocatedFromName: string | undefined;
      let reallocatedFromProviderName: string | undefined;
      if (newStatus === 'AGENT_ASSIGNED' && typeof input.metadata?.logisticsLocationId === 'string') {
        const locRows = await this.db
          .select({
            locationName: schema.logisticsLocations.name,
            providerName: schema.logisticsProviders.name,
          })
          .from(schema.logisticsLocations)
          .innerJoin(
            schema.logisticsProviders,
            eq(schema.logisticsLocations.providerId, schema.logisticsProviders.id),
          )
          .where(eq(schema.logisticsLocations.id, input.metadata.logisticsLocationId))
          .limit(1);
        logisticsLocationName = locRows[0]?.locationName ?? undefined;
        logisticsProviderName = locRows[0]?.providerName ?? undefined;
      }
      if (
        currentStatus === 'AGENT_ASSIGNED' &&
        newStatus === 'AGENT_ASSIGNED' &&
        order.logisticsLocationId
      ) {
        const prevRows = await this.db
          .select({
            locationName: schema.logisticsLocations.name,
            providerName: schema.logisticsProviders.name,
          })
          .from(schema.logisticsLocations)
          .innerJoin(
            schema.logisticsProviders,
            eq(schema.logisticsLocations.providerId, schema.logisticsProviders.id),
          )
          .where(eq(schema.logisticsLocations.id, order.logisticsLocationId))
          .limit(1);
        reallocatedFromName = prevRows[0]?.locationName ?? undefined;
        reallocatedFromProviderName = prevRows[0]?.providerName ?? undefined;
      }
      void this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: timelineType,
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: isRetrack
          ? `Order retracked from ${currentStatus.replace(/_/g, ' ')} to ${newStatus.replace(/_/g, ' ')}${reason ? ` — ${reason}` : ''}`
          : this.buildTransitionActivityDescription(newStatus, {
          reason,
          preferredDeliveryDate:
            typeof input.metadata?.preferredDeliveryDate === 'string'
              ? input.metadata.preferredDeliveryDate
              : undefined,
          logisticsLocationName,
          logisticsProviderName,
          reallocatedFromName,
          reallocatedFromProviderName,
          engagementMethod:
            typeof input.metadata?.engagementMethod === 'string'
              ? input.metadata.engagementMethod
              : undefined,
        }),
        metadata: input.metadata as Record<string, unknown> | undefined,
        branchId: updated.branchId ?? null,
      });
    }

    // Emit real-time event
    this.events.emitOrderStatusChange({
      orderId: order.id,
      oldStatus: currentStatus,
      newStatus,
      assignedCsId: updated.assignedCsId,
      mediaBuyerId: updated.mediaBuyerId,
      logisticsLocationId: updated.logisticsLocationId,
      riderId: updated.riderId,
      branchId: updated.branchId ?? null,
      servicingBranchId: updated.servicingBranchId ?? null,
    });

    // Persistent notifications for logistics flow
    if (newStatus === 'AGENT_ASSIGNED' && updated.logisticsLocationId) {
      this.notifications.enqueueCreateForLocation(updated.logisticsLocationId, {
        type: 'order:allocated',
        title: 'Agent-assigned order at your location',
        body: 'An order was assigned for delivery here. Please assign a rider.',
        data: { orderId: order.id },
      });
    }
    if (newStatus === 'DISPATCHED' && updated.riderId) {
      this.notifications.enqueueCreate({
        userId: updated.riderId,
        type: 'delivery:assigned',
        title: 'Delivery assigned to you',
        body: 'A delivery has been assigned to you. Please pick up and deliver.',
        data: { orderId: order.id },
      });
    }

    const { customerPhone: transitionPhone, ...updatedSafe } = updated;
    return {
      ...updatedSafe,
      customerPhoneDisplay: formatOrderCustomerPhoneDisplay(transitionPhone, updated.customerPhoneHash),
      allowedTransitions: getAllowedNextStatuses(newStatus),
    };
  }

  /**
   * Update order details (address, items, notes).
   * The temporal table automatically preserves old values.
   */
  async update(input: UpdateOrderInput, actor: SessionUser) {
    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, input.orderId), isNull(schema.orders.deletedAt)))
      .limit(1);

    const order = existingRows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    if (input.items !== undefined) {
      // Items may be adjusted at any status before delivery.
      const blockedStatuses = ['DELIVERED', 'REMITTED'];
      if (blockedStatuses.includes(order.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Order items cannot be adjusted after delivery.',
        });
      }
    }

    // 3PL operators (e.g. TPL_MANAGER who hold `orders.delivery.confirm` but no
    // generic update capability) may update preferred delivery date, optional
    // delivery fee/discount, and required receipt (Resolve order). They bypass
    // the generic update gate via the narrow shape below.
    const actorPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const isLogisticsResolveOnly =
      actor.role !== 'SUPER_ADMIN' &&
      actorPerms.includes(canonicalPermissionCode('orders.delivery.confirm')) &&
      !actorPerms.includes(canonicalPermissionCode('orders.update.any_branch')) &&
      !actorPerms.includes(canonicalPermissionCode('cs.scope.global')) &&
      !actorPerms.includes(canonicalPermissionCode('logistics.scope.global')) &&
      !actorPerms.includes(canonicalPermissionCode('branches.manage'));

    let workingInput: UpdateOrderInput = isLogisticsResolveOnly
      ? {
          orderId: input.orderId,
          preferredDeliveryDate: input.preferredDeliveryDate,
          deliveryFeeAddOn: input.deliveryFeeAddOn,
          deliveryDiscountAmount: input.deliveryDiscountAmount,
          resolveReceiptUrl: input.resolveReceiptUrl,
        }
      : input;

    if (!isLogisticsResolveOnly) {
      await this.assertActorMayUpdateOrder(actor, {
        branchId: order.branchId ?? null,
        assignedCsId: order.assignedCsId ?? null,
        status: order.status,
      });
    }

    if (!isLogisticsResolveOnly && workingInput.items) {
      const mayPrice = await this.canActorEditOrderLinePrices(actor, {
        branchId: order.branchId ?? null,
        assignedCsId: order.assignedCsId ?? null,
      });
      if (!mayPrice) {
        // CEO directive 2026-06-10: CS closers cannot directly edit items at
        // all — price, product, quantity, or offer changes must ALL go through
        // requestLinePriceChangeApproval. Reject the direct update outright.
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Item changes require approval. Use "Submit change for approval" instead of saving directly.',
        });
      }
    } else if (
      !isLogisticsResolveOnly &&
      workingInput.totalAmount !== undefined &&
      workingInput.items === undefined
    ) {
      const mayPrice = await this.canActorEditOrderLinePrices(actor, {
        branchId: order.branchId ?? null,
        assignedCsId: order.assignedCsId ?? null,
      });
      if (!mayPrice) {
        const { totalAmount: _ignored, ...rest } = workingInput;
        workingInput = rest;
      }
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (workingInput.customerAddress !== undefined) updateFields['customerAddress'] = workingInput.customerAddress;
    if (workingInput.deliveryAddress !== undefined) updateFields['deliveryAddress'] = workingInput.deliveryAddress;
    if (workingInput.deliveryNotes !== undefined) updateFields['deliveryNotes'] = workingInput.deliveryNotes;
    if (workingInput.deliveryState !== undefined) updateFields['deliveryState'] = workingInput.deliveryState;
    if (workingInput.customerGender !== undefined) updateFields['customerGender'] = workingInput.customerGender;
    if (workingInput.preferredDeliveryDate !== undefined) updateFields['preferredDeliveryDate'] = workingInput.preferredDeliveryDate;
    if (workingInput.customFields !== undefined) updateFields['customFields'] = workingInput.customFields;

    // Delivery fee add-on (Resolve order / TPL)
    if (workingInput.deliveryFeeAddOn !== undefined) {
      const addOn = Number(workingInput.deliveryFeeAddOn);
      if (!Number.isNaN(addOn) && addOn >= 0) {
        const current = parseFloat(String(order.deliveryFee ?? 0)) || 0;
        updateFields['deliveryFee'] = (current + addOn).toFixed(2);
      }
    }
    // Delivery discount (Resolve order / TPL) — reduces total and stores amount
    if (workingInput.deliveryDiscountAmount !== undefined) {
      const discount = Number(workingInput.deliveryDiscountAmount);
      if (!Number.isNaN(discount) && discount >= 0) {
        const currentTotal = parseFloat(String(order.totalAmount ?? 0)) || 0;
        const newTotal = Math.max(0, currentTotal - discount);
        updateFields['totalAmount'] = newTotal.toFixed(2);
        updateFields['deliveryDiscountAmount'] = discount.toFixed(2);
      }
    }
    // Resolve order receipt (required when TPL resolves)
    if (workingInput.resolveReceiptUrl !== undefined) {
      updateFields['resolveReceiptUrl'] = workingInput.resolveReceiptUrl.trim();
    }
    if (workingInput.paymentMethod !== undefined) updateFields['paymentMethod'] = workingInput.paymentMethod;
    if (workingInput.customerEmail !== undefined) updateFields['customerEmail'] = workingInput.customerEmail;
    if (workingInput.totalAmount !== undefined) updateFields['totalAmount'] = String(workingInput.totalAmount);
    if (workingInput.items !== undefined) updateFields['items'] = workingInput.items;

    const updated = await withActor(this.db, actor, async (tx) => {
      const updatedRows = await tx
        .update(schema.orders)
        .set(updateFields)
        .where(eq(schema.orders.id, input.orderId))
        .returning();

      const row = updatedRows[0];
      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update order' });
      }

      if (workingInput.items) {
        const deletedItems = await tx
          .delete(schema.orderItems)
          .where(eq(schema.orderItems.orderId, input.orderId))
          .returning({ id: schema.orderItems.id });
        this.logger.log(`orders.update: deleted ${deletedItems.length} existing items for ${input.orderId}`);

        await tx.insert(schema.orderItems).values(
          workingInput.items.map((item) => ({
            orderId: input.orderId,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: String(item.unitPrice),
            ...(item.offerLabel != null && item.offerLabel !== ''
              ? { offerLabel: item.offerLabel }
              : {}),
          })),
        );
        this.logger.log(`orders.update: inserted ${workingInput.items.length} new items for ${input.orderId}`);
      }
      return row;
    });

    const actorName = actor.name ?? 'Sales closer';
    if (
      workingInput.customerAddress !== undefined ||
      workingInput.deliveryAddress !== undefined ||
      workingInput.deliveryNotes !== undefined ||
      workingInput.deliveryState !== undefined ||
      workingInput.preferredDeliveryDate !== undefined ||
      workingInput.customFields !== undefined
    ) {
      // Build a more descriptive message when the delivery date changes.
      let description = `Delivery details updated by ${actorName}`;
      if (workingInput.preferredDeliveryDate !== undefined) {
        const oldDate = order.preferredDeliveryDate
          ? new Date(order.preferredDeliveryDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'not set';
        const newDate = workingInput.preferredDeliveryDate
          ? new Date(workingInput.preferredDeliveryDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'removed';
        description = `Delivery date changed from ${oldDate} to ${newDate} by ${actorName}`;
      }
      void this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: 'ADDRESS_UPDATED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description,
        branchId: updated.branchId ?? null,
      });
    }
    if (workingInput.items !== undefined) {
      const oldQty = Array.isArray(order.items)
        ? order.items.reduce((sum: number, item: unknown) => {
            if (item && typeof item === 'object' && 'quantity' in item) {
              const qty = Number((item as { quantity?: unknown }).quantity);
              return Number.isNaN(qty) ? sum : sum + qty;
            }
            return sum;
          }, 0)
        : 0;
      const newQty = workingInput.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      void this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: 'QUANTITY_UPDATED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Order quantity updated from ${oldQty} to ${newQty} by ${actorName}`,
        branchId: updated.branchId ?? null,
      });
    }

    const { customerPhone: updatedPhone, ...updatedForResponse } = updated;
    return {
      ...updatedForResponse,
      customerPhoneDisplay: formatOrderCustomerPhoneDisplay(updatedPhone, updated.customerPhoneHash),
    };
  }

  /**
   * Verify Paystack transaction by reference and mark order as PAID.
   * If reference was from preparePaystackOrder (payment-first), creates the order from Redis payload then deletes the key.
   * If order already existed (legacy flow), updates payment_status to PAID. Idempotent.
   */
  async completePaymentByReference(reference: string): Promise<{ orderId: string; success: boolean } | null> {
    if (!this.paystackService.isConfigured()) return null;
    const verified = await this.paystackService.verifyTransaction(reference);
    if (!verified || verified.status !== 'success') return null;

    // Payment-first flow: create order from pending payload stored in Redis
    const pendingKey = PENDING_PAYMENT_PREFIX + reference;
    const pendingRaw = await this.redis.get(pendingKey);
    if (pendingRaw) {
      let payload: CreateOrderInput & { cartId?: string };
      try {
        payload = JSON.parse(pendingRaw) as CreateOrderInput & { cartId?: string };
      } catch {
        await this.redis.del(pendingKey);
        return null;
      }
      // Derive order amount from payload (totalAmount or sum of items) for verification
      let orderAmountKobo = Math.round((parseFloat(String(payload.totalAmount ?? 0)) || 0) * 100);
      if (orderAmountKobo <= 0 && payload.items?.length) {
        // unitPrice is the offer/line total — sum directly without multiplying by quantity
        const sum = payload.items.reduce(
          (acc, item) => acc + (parseFloat(String(item.unitPrice)) || 0),
          0,
        );
        orderAmountKobo = Math.round(sum * 100);
      }
      if (verified.amount !== orderAmountKobo && verified.amount > 0 && orderAmountKobo > 0) {
        return null;
      }
      const actorId = EDGE_FORM_ACTOR_ID;

      const { cartId, ...orderInput } = payload;
      // MARKETING branch — attribution. Set once, never changes.
      const paystackBranchId = await this.resolveBranchIdForNewOrder({
        campaignId: orderInput.campaignId ?? null,
        mediaBuyerId: orderInput.mediaBuyerId ?? null,
        fallbackBranchId: null,
      });

      // CS SERVICING branch — routing may service the order elsewhere, but must
      // NEVER overwrite the marketing `branchId` (migration 0150).
      let paystackServicingBranchId = paystackBranchId;
      if (paystackBranchId) {
        const primaryProductId = orderInput.items?.[0]?.productId ?? null;
        const servicingBranch = await this.csOrderRouting.resolveServicingBranchForProduct(
          paystackBranchId,
          primaryProductId,
        );
        if (servicingBranch) {
          paystackServicingBranchId = servicingBranch;
        }
      }

      const order = await withActor(this.db, { id: actorId }, async (tx) => {
        const rows = await tx
          .insert(schema.orders)
          .values({
            campaignId: orderInput.campaignId ?? null,
            mediaBuyerId: orderInput.mediaBuyerId ?? null,
            branchId: paystackBranchId ?? null,
            servicingBranchId: paystackServicingBranchId ?? null,
            customerName: orderInput.customerName,
            customerPhoneHash: orderInput.customerPhoneHash,
            customerPhone: orderInput.customerPhone ?? null,
            customerAddress: orderInput.customerAddress ?? null,
            deliveryAddress: orderInput.deliveryAddress ?? null,
            deliveryNotes: orderInput.deliveryNotes ?? null,
            deliveryState: orderInput.deliveryState ?? null,
            customerGender: orderInput.customerGender ?? null,
            preferredDeliveryDate: orderInput.preferredDeliveryDate ?? null,
            customerEmail: orderInput.customerEmail ?? null,
            paymentMethod: 'PAY_ONLINE',
            paymentStatus: 'PAID',
            paymentReference: reference,
            paymentProvider: 'PAYSTACK',
            items: orderInput.items,
            totalAmount: orderInput.totalAmount != null ? String(orderInput.totalAmount) : null,
            status: 'UNPROCESSED',
          })
          .returning();

        const created = rows[0];
        if (!created) return null;

        if (orderInput.items.length > 0) {
          await tx.insert(schema.orderItems).values(
            orderInput.items.map((item) => ({
              orderId: created.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: String(item.unitPrice),
              offerLabel: item.offerLabel ?? null,
            })),
          );
        }
        return created;
      });

      if (!order) {
        return null;
      }

      await this.redis.del(pendingKey);

      this.events.emitNewOrder({
        orderId: order.id,
        productName: 'Order created',
        branchId: order.branchId ?? null,
        servicingBranchId: paystackServicingBranchId ?? null,
        mediaBuyerId: order.mediaBuyerId ?? null,
      });
      const orderLabelPay = `YNS-${String(order.orderNumber).padStart(5, '0')}`;
      const customerLabelPay = (order.customerName ?? '').trim() || 'A customer';
      const campaignNamePay = order.campaignId
        ? (
            await this.db
              .select({ name: schema.campaigns.name })
              .from(schema.campaigns)
              .where(eq(schema.campaigns.id, order.campaignId))
              .limit(1)
          )[0]?.name ?? null
        : null;

      this.notifications.enqueueCreateForRole('HEAD_OF_CS', {
        type: 'order:new',
        title: `New order ${orderLabelPay}`,
        body: `${customerLabelPay} placed an order${campaignNamePay ? ` via ${campaignNamePay}` : ''}.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, customerName: customerLabelPay },
      });
      this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
        type: 'order:new',
        title: `New order ${orderLabelPay}`,
        body: `${customerLabelPay} placed an order${campaignNamePay ? ` via ${campaignNamePay}` : ''}.`,
        data: { orderId: order.id, orderNumber: order.orderNumber, customerName: customerLabelPay },
      });
      if (order.mediaBuyerId) {
        const bodyPay = campaignNamePay
          ? `${customerLabelPay} just placed an order via ${campaignNamePay}.`
          : `${customerLabelPay} just placed an order from your campaign.`;
        this.notifications.enqueueCreate({
          userId: order.mediaBuyerId,
          type: 'order:new_campaign',
          title: `New order ${orderLabelPay}`,
          body: bodyPay,
          data: { orderId: order.id, orderNumber: order.orderNumber, campaignId: order.campaignId ?? null, campaignName: campaignNamePay, customerName: customerLabelPay },
        });
      }
      const mediaBuyerNamePay = order.mediaBuyerId
        ? await this.resolveUserNameById(order.mediaBuyerId)
        : null;
      const mbSuffixPay = mediaBuyerNamePay
        ? ` — attributed to media buyer ${mediaBuyerNamePay}`
        : '';
      this.autoDispatchToCS(order.id).catch(() => {});
      void this.writeTimelineEvent({
        orderId: order.id,
        eventType: 'ORDER_RECEIVED',
        actorId: actorId,
        actorName: 'Edge form',
        description: `Order received from sales form${mbSuffixPay}`,
        metadata:
          mediaBuyerNamePay && order.mediaBuyerId
            ? { mediaBuyerId: order.mediaBuyerId, mediaBuyerName: mediaBuyerNamePay }
            : undefined,
        branchId: order.branchId ?? null,
      });
      void this.writeTimelineEvent({
        orderId: order.id,
        eventType: 'PAYMENT_RECEIVED',
        actorId: actorId,
        actorName: 'Paystack',
        description: 'Online payment received',
        metadata: { paymentReference: reference },
        branchId: order.branchId ?? null,
      });
      if (cartId) {
        this.cartService.convert(cartId, order.id, actorId).catch(() => {});
      }

      return { orderId: order.id, success: true };
    }

    // Legacy flow: order was already created with payment_reference
    let orderId: string | null = null;
    const byRef = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.paymentReference, reference))
      .limit(1);
    if (byRef[0]) orderId = byRef[0].id;
    else if (reference.startsWith('order-')) {
      const id = reference.slice(6);
      const byId = await this.db.select({ id: schema.orders.id }).from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
      if (byId[0]) orderId = byId[0].id;
    }
    if (!orderId) return null;

    const orderRow = await this.db
      .select({
        totalAmount: schema.orders.totalAmount,
        paymentStatus: schema.orders.paymentStatus,
        branchId: schema.orders.branchId,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    const order = orderRow[0];
    if (!order) return null;
    if (order.paymentStatus === 'PAID') return { orderId, success: true };

    const orderAmountKobo = Math.round((parseFloat(String(order.totalAmount ?? 0)) || 0) * 100);
    if (verified.amount !== orderAmountKobo && verified.amount > 0) return null;

    await this.db
      .update(schema.orders)
      .set({ paymentStatus: 'PAID', updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));
    void this.writeTimelineEvent({
      orderId,
      eventType: 'PAYMENT_RECEIVED',
      actorId: null,
      actorName: 'Paystack',
      description: 'Online payment received',
      metadata: { paymentReference: reference },
      branchId: order.branchId ?? null,
    });
    return { orderId, success: true };
  }

  /**
   * Manually assign an order to a Sales closer.
   * Callers with `orders.reassign` (HoCS / Admin), or a branch Sales team supervisor for in-team agents
   * on orders in UNPROCESSED or CS_ASSIGNED (supervisors only).
   */
  async assignToCS(
    orderId: string,
    csCloserId: string,
    actor: SessionUser,
    options?: { reason?: string },
  ) {
    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);

    if (!existingRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }
    const orderRow = existingRows[0];

    // Block assignment of test orders — they should be purged, not worked.
    if (/^test([^a-zA-Z]|$)/i.test(orderRow.customerName?.trim() ?? '')) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Test orders cannot be assigned to closers. Delete them from the Test orders filter instead.',
      });
    }

    const ob = orderRow.branchId;
    if (!ob) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order has no branch context' });
    }
    await this.assertCanManualAssignToCs(actor, csCloserId, ob, orderRow.status);

    const isLateStageTransfer = !OrdersService.CS_REASSIGN_PRE_ENGAGEMENT.has(orderRow.status);
    const trimmedReason = options?.reason?.trim() ?? '';

    // Late-stage transfers must carry an audit reason — the CEO directive
    // requires "Absolute Accountability" for any change after engagement.
    if (isLateStageTransfer && trimmedReason.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'A short reason is required when transferring an order at this status.',
      });
    }

    const updated = await withActor(this.db, actor, async (tx) => {
      // Preserve status when this is a late-stage credit-attribution transfer.
      // Resetting a DELIVERED/REMITTED order back to CS_ASSIGNED would corrupt
      // the financial timeline and re-trigger downstream events.
      const patch: Partial<typeof schema.orders.$inferInsert> = {
        assignedCsId: csCloserId,
        updatedAt: new Date(),
      };
      if (!isLateStageTransfer) {
        patch.status = 'CS_ASSIGNED';
      }
      const updatedRows = await tx
        .update(schema.orders)
        .set(patch)
        .where(eq(schema.orders.id, orderId))
        .returning();

      const row = updatedRows[0];
      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to assign order' });
      }
      return row;
    });

    // Notify the assigned agent (real-time + persistent)
    this.events.emitToUser(csCloserId, 'order:assigned', {
      orderId,
      customerName: updated.customerName,
    });
    // Notify cs-all so CS overview (Head of CS) refreshes — servicing branch
    this.events.emitToRoom('cs-all', 'order:assigned', {
      orderId,
      customerName: updated.customerName,
    }, updated.servicingBranchId ?? null);
    // Notify marketing-all so HoM stat strip (Unassigned count) refreshes
    this.events.emitToRoom('marketing-all', 'order:assigned', {
      orderId,
      customerName: updated.customerName,
    }, updated.branchId ?? null);
    this.notifications.enqueueCreate({
      userId: csCloserId,
      type: 'order:assigned',
      title: 'Order assigned to you',
      body: this.formatAssignedOrderBody({
        customerName: updated.customerName,
        totalAmount: updated.totalAmount,
      }),
      data: {
        orderId,
        customerName: updated.customerName,
        totalAmount: updated.totalAmount,
        assignedBy: actor.name ?? null,
      },
    });

    // Timeline event: manually assigned (or reassigned if a previous owner existed).
    // Late-stage reassignments reuse the existing `ORDER_REASSIGNED` enum value
    // (the timeline_event_type pgEnum doesn't include a dedicated marker, and
    // inserting one without a migration silently fails inside writeTimelineEvent).
    // We differentiate via metadata (`lateStage: true`, `statusAtTransfer`,
    // `reason`) and a distinct description format that the timeline renderer
    // falls through to as plain text — preserving the reason in the visible row.
    const previousCsAgentId = orderRow.assignedCsId;
    const isReassignment = !!previousCsAgentId && previousCsAgentId !== csCloserId;
    const namesNeeded = isReassignment ? [csCloserId, previousCsAgentId!] : [csCloserId];
    const nameRows = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, namesNeeded));
    const nameById = new Map(nameRows.map((r) => [r.id, r.name]));
    const agentName = nameById.get(csCloserId) ?? null;
    const previousAgentName = previousCsAgentId ? nameById.get(previousCsAgentId) ?? null : null;
    const actorName = actor.name ?? 'Head of CS';

    let description: string;
    if (isLateStageTransfer) {
      // Distinct shape — does NOT match the timeline renderer's
      // `^Reassigned to (.+?) by (.+)$` regex, so it falls back to plain-text
      // rendering and the reason stays visible on the order timeline panel.
      const fromClause = previousAgentName ?? previousCsAgentId
        ? ` from ${previousAgentName ?? previousCsAgentId}`
        : '';
      description = `Closer reassigned${fromClause} to ${agentName ?? csCloserId} by ${actorName} at status ${orderRow.status} — ${trimmedReason}`;
    } else {
      const verb = isReassignment ? 'Reassigned' : 'Assigned';
      const fromClause = isReassignment ? ` from ${previousAgentName ?? previousCsAgentId}` : '';
      description = `${verb} to ${agentName ?? csCloserId}${fromClause} by ${actorName}`;
    }

    const eventType = isReassignment || isLateStageTransfer ? 'ORDER_REASSIGNED' : 'ORDER_MANUALLY_ASSIGNED';
    void this.writeTimelineEvent({
      orderId,
      eventType,
      actorId: actor.id,
      actorName: actor.name ?? null,
      description,
      metadata: {
        csCloserId,
        toAgentId: csCloserId,
        ...(previousCsAgentId ? { fromAgentId: previousCsAgentId } : {}),
        statusAtTransfer: orderRow.status,
        ...(isLateStageTransfer ? { reason: trimmedReason, lateStage: true } : {}),
      },
      branchId: updated.branchId ?? null,
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
    const updated = await withActor(this.db, actor, async (tx) =>
      tx
        .update(schema.orders)
        .set({
          assignedCsId: toAgentId,
          status: 'CS_ASSIGNED',
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(schema.orders.id, orderIds),
            eq(schema.orders.assignedCsId, fromAgentId),
          ),
        )
        .returning(),
    );

    // Notify both agents (real-time + persistent)
    this.events.emitToUser(fromAgentId, 'order:reassigned', {
      count: updated.length,
      toAgentId,
    });
    this.events.emitToUser(toAgentId, 'order:assigned_bulk', {
      count: updated.length,
      fromAgentId,
    });
    // Total value of the reassigned batch — gives the receiving rep a sense of priority
    // ("3 orders · ₦45,000" lands harder than "3 order(s) reassigned to you").
    const bulkTotal = updated.reduce((sum, o) => {
      const n = Number(o.totalAmount ?? 0);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
    const formattedTotal =
      bulkTotal > 0 ? `₦${Math.round(bulkTotal).toLocaleString('en-NG')}` : null;
    const noun = updated.length === 1 ? 'order' : 'orders';

    this.notifications.enqueueCreate({
      userId: fromAgentId,
      type: 'order:reassigned',
      title: 'Orders reassigned',
      body: `${updated.length} ${noun}${formattedTotal ? ` (${formattedTotal})` : ''} moved off your queue.`,
      data: { count: updated.length, toAgentId },
    });
    this.notifications.enqueueCreate({
      userId: toAgentId,
      type: 'order:assigned_bulk',
      title: 'Orders assigned to you',
      body: `${updated.length} ${noun}${formattedTotal ? ` · ${formattedTotal}` : ''} added to your queue — tap to start calling.`,
      data: { count: updated.length, fromAgentId, orderIds: updated.map((o) => o.id) },
    });

    // Notify cs-all so CS overview refreshes
    this.events.emitToRoom('cs-all', 'order:reassigned', {
      count: updated.length,
      fromAgentId,
      toAgentId,
    }, actor.currentBranchId ?? null);
    this.events.emitToRoom('cs-all', 'order:assigned_bulk', {
      count: updated.length,
      fromAgentId,
      toAgentId,
    }, actor.currentBranchId ?? null);
    const toNameRow = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, toAgentId))
      .limit(1);
    const toAgentName = toNameRow[0]?.name ?? toAgentId;
    for (const changed of updated) {
      void this.writeTimelineEvent({
        orderId: changed.id,
        eventType: 'ORDER_REASSIGNED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Reassigned to ${toAgentName} by ${actor.name ?? 'Head of CS'}`,
        metadata: { fromAgentId, toAgentId },
        branchId: changed.branchId ?? null,
      });
    }

    return { reassignedCount: updated.length };
  }

  /**
   * Redistribute CS_ASSIGNED orders across agents using the same load-balanced or
   * performance strategy as auto-dispatch. Only Head of CS or SuperAdmin.
   * Returns the number of orders whose assignment was changed.
   */
  async redistributeCSOrders(actor: SessionUser): Promise<{ redistributed: number }> {
    await this.releaseExpiredLocks(actor.id);

    const workloads = await this.getCSCloserWorkloads();
    const workloadMap = new Map(
      workloads.map((w) => [
        w.agentId,
        { pendingCount: w.pendingCount, capacity: w.capacity, lastActionAt: w.lastActionAt },
      ]),
    );

    const csAssignedOrders = await this.db
      .select({
        id: schema.orders.id,
        assignedCsId: schema.orders.assignedCsId,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.status, 'CS_ASSIGNED'))
      .orderBy(asc(schema.orders.createdAt));

    if (csAssignedOrders.length === 0) {
      return { redistributed: 0 };
    }

    const dispatchSetting = await this.settingsService.get('CS_DISPATCH_STRATEGY');
    const strategy = dispatchSetting?.strategy === 'performance' ? 'performance' : 'load_balanced';
    let perfMap: Map<string, { deliveryRate: number; confirmationRate: number }> = new Map();
    if (strategy === 'performance') {
      const leaderboard = await this.getCSCloserLeaderboard('this_month');
      perfMap = new Map(
        leaderboard.map((e) => [e.agentId, { deliveryRate: e.deliveryRate, confirmationRate: e.confirmationRate }]),
      );
    }

    function sortAvailable(
      available: Array<{ agentId: string; pendingCount: number; capacity: number; lastActionAt: Date | null }>,
    ) {
      if (strategy === 'performance') {
        available.sort((a, b) => {
          const aPerf = perfMap.get(a.agentId) ?? { deliveryRate: 0, confirmationRate: 0 };
          const bPerf = perfMap.get(b.agentId) ?? { deliveryRate: 0, confirmationRate: 0 };
          if (bPerf.deliveryRate !== aPerf.deliveryRate) return bPerf.deliveryRate - aPerf.deliveryRate;
          if (bPerf.confirmationRate !== aPerf.confirmationRate)
            return bPerf.confirmationRate - aPerf.confirmationRate;
          if (a.pendingCount !== b.pendingCount) return a.pendingCount - b.pendingCount;
          const aTime = a.lastActionAt?.getTime() ?? 0;
          const bTime = b.lastActionAt?.getTime() ?? 0;
          return aTime - bTime;
        });
      } else {
        available.sort((a, b) => {
          if (a.pendingCount !== b.pendingCount) return a.pendingCount - b.pendingCount;
          const aTime = a.lastActionAt?.getTime() ?? 0;
          const bTime = b.lastActionAt?.getTime() ?? 0;
          return aTime - bTime;
        });
      }
    }

    let redistributed = 0;
    for (const order of csAssignedOrders) {
      const currentAssignedId = order.assignedCsId ?? null;
      const available = workloads.map((w) => {
        const state = workloadMap.get(w.agentId)!;
        return { agentId: w.agentId, ...state };
      });

      sortAvailable(available);
      const target = available[0];
      if (!target || target.agentId === currentAssignedId) continue;

      await this.assignToCS(order.id, target.agentId, actor);

      if (currentAssignedId) {
        const prev = workloadMap.get(currentAssignedId);
        if (prev) workloadMap.set(currentAssignedId, { ...prev, pendingCount: Math.max(0, prev.pendingCount - 1) });
      }
      const next = workloadMap.get(target.agentId);
      if (next) workloadMap.set(target.agentId, { ...next, pendingCount: next.pendingCount + 1 });
      redistributed++;
    }

    if (redistributed > 0) {
      this.events.emitToRoom('cs-all', 'order:assignments_changed', { redistributed }, actor.currentBranchId ?? null);
    }
    return { redistributed };
  }

  /**
   * Redistribute one agent's CS_ASSIGNED and CS_ENGAGED orders to other agents using the same
   * load-balanced or performance strategy. Used from Sales Team page (Head of CS). Excludes the source
   * agent from receiving orders. Returns the number of orders reassigned.
   */
  async redistributeOrdersFromAgent(agentId: string, actor: SessionUser): Promise<{ redistributed: number }> {
    await this.releaseExpiredLocks(actor.id);

    const orders = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.assignedCsId, agentId),
          inArray(schema.orders.status, ['CS_ASSIGNED', 'CS_ENGAGED']),
        ),
      )
      .orderBy(asc(schema.orders.createdAt));

    if (orders.length === 0) {
      return { redistributed: 0 };
    }

    const workloads = await this.getCSCloserWorkloads();
    const targetWorkloads = workloads.filter((w) => w.agentId !== agentId);
    const workloadMap = new Map(
      targetWorkloads.map((w) => [
        w.agentId,
        { pendingCount: w.pendingCount, capacity: w.capacity, lastActionAt: w.lastActionAt },
      ]),
    );

    const dispatchSetting = await this.settingsService.get('CS_DISPATCH_STRATEGY');
    const strategy = dispatchSetting?.strategy === 'performance' ? 'performance' : 'load_balanced';
    let perfMap: Map<string, { deliveryRate: number; confirmationRate: number }> = new Map();
    if (strategy === 'performance') {
      const leaderboard = await this.getCSCloserLeaderboard('this_month');
      perfMap = new Map(
        leaderboard.map((e) => [e.agentId, { deliveryRate: e.deliveryRate, confirmationRate: e.confirmationRate }]),
      );
    }

    function sortAvailable(
      available: Array<{ agentId: string; pendingCount: number; capacity: number; lastActionAt: Date | null }>,
    ) {
      if (strategy === 'performance') {
        available.sort((a, b) => {
          const aPerf = perfMap.get(a.agentId) ?? { deliveryRate: 0, confirmationRate: 0 };
          const bPerf = perfMap.get(b.agentId) ?? { deliveryRate: 0, confirmationRate: 0 };
          if (bPerf.deliveryRate !== aPerf.deliveryRate) return bPerf.deliveryRate - aPerf.deliveryRate;
          if (bPerf.confirmationRate !== aPerf.confirmationRate)
            return bPerf.confirmationRate - aPerf.confirmationRate;
          if (a.pendingCount !== b.pendingCount) return a.pendingCount - b.pendingCount;
          const aTime = a.lastActionAt?.getTime() ?? 0;
          const bTime = b.lastActionAt?.getTime() ?? 0;
          return aTime - bTime;
        });
      } else {
        available.sort((a, b) => {
          if (a.pendingCount !== b.pendingCount) return a.pendingCount - b.pendingCount;
          const aTime = a.lastActionAt?.getTime() ?? 0;
          const bTime = b.lastActionAt?.getTime() ?? 0;
          return aTime - bTime;
        });
      }
    }

    let redistributed = 0;
    const ordersByTarget = new Map<string, string[]>();

    for (const order of orders) {
      const available = targetWorkloads.map((w) => {
        const state = workloadMap.get(w.agentId)!;
        return { agentId: w.agentId, ...state };
      });

      sortAvailable(available);
      const target = available[0];
      if (!target) continue;

      await this.assignToCS(order.id, target.agentId, actor);

      const prev = workloadMap.get(target.agentId);
      if (prev) workloadMap.set(target.agentId, { ...prev, pendingCount: prev.pendingCount + 1 });
      const list = ordersByTarget.get(target.agentId) ?? [];
      list.push(order.id);
      ordersByTarget.set(target.agentId, list);
      redistributed++;
    }

    if (redistributed > 0) {
      this.events.emitToUser(agentId, 'order:reassigned', {
        count: redistributed,
        toAgentId: undefined,
      });
      this.notifications.enqueueCreate({
        userId: agentId,
        type: 'order:reassigned',
        title: 'Orders redistributed',
        body: `${redistributed} ${redistributed === 1 ? 'order' : 'orders'} moved off your queue and spread across the team.`,
        data: { count: redistributed },
      });
      for (const [toAgentId, orderIds] of ordersByTarget) {
        this.events.emitToUser(toAgentId, 'order:assigned_bulk', {
          count: orderIds.length,
          fromAgentId: agentId,
          orderIds,
        });
        const noun = orderIds.length === 1 ? 'order' : 'orders';
        this.notifications.enqueueCreate({
          userId: toAgentId,
          type: 'order:assigned_bulk',
          title: 'Orders assigned to you',
          body: `${orderIds.length} ${noun} added to your queue — tap to start calling.`,
          data: { count: orderIds.length, fromAgentId: agentId, orderIds },
        });
      }
      this.events.emitToRoom('cs-all', 'order:assignments_changed', { redistributed }, actor.currentBranchId ?? null);
    }

    return { redistributed };
  }

  /**
   * List active Sales closers (id + name) for Hot Swap dropdowns (HoCS/SuperAdmin only).
   * Agent-initiated order transfers have been removed — reassignment is management-only.
   */
  async listCSClosers(actor: SessionUser, effectiveBranchIds?: string[] | null): Promise<Array<{ agentId: string; agentName: string }>> {
    const hasReassign =
      (actor.permissions ?? [])
        .map((p) => canonicalPermissionCode(p))
        .includes(canonicalPermissionCode('orders.reassign'));
    if (actor.role === 'SUPER_ADMIN' || hasReassign) {
      // When group-scoped, only return closers belonging to branches in the active group
      if (effectiveBranchIds && effectiveBranchIds.length > 0) {
        const agents = await this.db
          .selectDistinct({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .innerJoin(schema.userBranches, eq(schema.userBranches.userId, schema.users.id))
          .where(and(
            eq(schema.users.role, 'CS_CLOSER'),
            eq(schema.users.status, 'ACTIVE'),
            inArray(schema.userBranches.branchId, effectiveBranchIds),
          ));
        return agents.map((a) => ({ agentId: a.id, agentName: a.name }));
      }
      const agents = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE')));
      return agents.map((a) => ({ agentId: a.id, agentName: a.name }));
    }
    const branchId = actor.currentBranchId;
    if (!branchId) return [];
    const ids = await this.branchTeams.listSupervisedUserIds(actor.id, branchId, 'CS');
    if (ids.length === 0) return [];
    const agents = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(and(inArray(schema.users.id, ids), eq(schema.users.status, 'ACTIVE')));
    return agents.map((a) => ({ agentId: a.id, agentName: a.name }));
  }

  /** Like listCSClosers but includes branch memberships for filtering in the UI. */
  async listCSClosersWithBranches(actor: SessionUser, effectiveBranchIds?: string[] | null): Promise<Array<{
    agentId: string;
    agentName: string;
    branches: Array<{ branchId: string; branchName: string }>;
  }>> {
    const closers = await this.listCSClosers(actor, effectiveBranchIds);
    if (closers.length === 0) return [];

    const agentIds = closers.map((c) => c.agentId);
    const memberships = await this.db
      .select({
        userId: schema.userBranches.userId,
        branchId: schema.userBranches.branchId,
        branchName: schema.branches.name,
      })
      .from(schema.userBranches)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.userBranches.branchId))
      .where(inArray(schema.userBranches.userId, agentIds));

    const branchesByUser = new Map<string, Array<{ branchId: string; branchName: string }>>();
    for (const m of memberships) {
      const list = branchesByUser.get(m.userId) ?? [];
      list.push({ branchId: m.branchId, branchName: m.branchName });
      branchesByUser.set(m.userId, list);
    }

    return closers.map((c) => ({
      ...c,
      branches: branchesByUser.get(c.agentId) ?? [],
    }));
  }

  /**
   * Branch-scoping WHERE fragment for order queries (migration 0150).
   *
   * - `'servicing'` (default): the CS branch that works the order —
   *   `orders.servicing_branch_id`. Correct for CS / Sales / Logistics surfaces.
   * - `'marketing'`: the campaign/form branch the order is attributed to —
   *   `orders.branch_id`. Used by Marketing surfaces (MB / HoM) so an order
   *   CS-routed to a different servicing branch still counts under the branch
   *   that actually ran the campaign. `orders.branch_id` is stamped once at
   *   creation and never changes, so past orders correctly stay in their
   *   original marketing branch even after the campaign is moved.
   */
  private orderBranchScopeCondition(
    branchId: string | null | undefined,
    scope: 'servicing' | 'marketing',
    effectiveBranchIds?: string[] | null,
  ): SQL | null {
    const col = scope === 'marketing' ? schema.orders.branchId : schema.orders.servicingBranchId;
    return branchScopeCondition(col, branchId, effectiveBranchIds);
  }

  /**
   * Get order counts by status — for dashboard stats.
   * Optional mediaBuyerId filters to that buyer's orders (for Marketing Orders page).
   * Optional assignedCsId filters to that Sales closer's orders (for Sales Orders page).
   * Optional logisticsLocationId filters to that 3PL location (for Logistics Orders page / TPL_MANAGER scoping).
   * Optional startDate/endDate filter by orders.createdAt (when provided: counts = orders created in period).
   * `branchScope` — see `orderBranchScopeCondition`. Marketing viewers pass `'marketing'`.
   */
  async getStatusCounts(
    mediaBuyerId?: string,
    startDate?: string,
    endDate?: string,
    assignedCsId?: string,
    logisticsLocationId?: string,
    branchId?: string | null,
    statuses?: Array<(typeof schema.orders.$inferSelect)['status']>,
    supervisorScope?: OrdersAggregateSupervisorScope,
    branchScope: 'servicing' | 'marketing' = 'servicing',
    effectiveBranchIds?: string[] | null,
    /** When true, count only follow-up orders. When false, exclude them. When undefined, count all. */
    isFollowUp?: boolean,
    /** When true, exclude offline-created orders from counts. Marketing surfaces pass true. */
    excludeOffline?: boolean,
    /** When true, strictly exclude graduated follow-up orders AND graduated cart
     *  orders. CS surfaces pass true so closers don't get credit for follow-up
     *  and cart recovery deliveries (CEO 2026-06-30). */
    excludeGraduated?: boolean,
  ) {
    // Status counts always include every status (including DELETED) so the
    // stat strip can show the Deleted count. CANCELLED is merged into DELETED
    // post-query (CEO directive 2026-05-23). The frontend excludes DELETED
    // from the "Total" by using `total` from listOrders (which filters them).
    const conditions: Parameters<typeof and>[0][] = [];

    if (excludeGraduated) {
      // Strict exclusion: no follow-up orders, no cart-graduated orders.
      // These have their own funnels (Follow-Up Orders, Cart Orders).
      conditions.push(eq(schema.orders.isFollowUp, false));
      conditions.push(sql`${schema.orders.cartId} IS NULL`);
    } else if (isFollowUp === true) {
      conditions.push(eq(schema.orders.isFollowUp, true));
    } else if (isFollowUp === false) {
      // Follow-up isolation: delivered/remitted follow-ups "graduate" into
      // normal counts so marketing metrics stay accurate (CEO 2026-06-09).
      conditions.push(
        sql`(${schema.orders.isFollowUp} = false OR (${schema.orders.isFollowUp} = true AND ${schema.orders.status} IN ('DELIVERED', 'REMITTED')))`,
      );
    }
    if (excludeOffline) {
      // Match the edge-form filter in orders.list — only count orders from the
      // sales form (NULL = legacy pre-migration, 'edge-form' = explicit) plus
      // cart-graduated orders ('online') so recovered carts count for the MB.
      conditions.push(sql`(${schema.orders.orderSource} IS NULL OR ${schema.orders.orderSource} = 'edge-form' OR ${schema.orders.orderSource} = 'online')`);
    }
    appendOrdersAggregateScopeConditions(conditions, {
      mediaBuyerId,
      assignedCsId,
      supervisorScope,
    });
    if (logisticsLocationId) conditions.push(eq(schema.orders.logisticsLocationId, logisticsLocationId));
    if (statuses?.length) conditions.push(inArray(schema.orders.status, statuses));
    const bCond = this.orderBranchScopeCondition(branchId, branchScope, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    if (startDate) conditions.push(gte(schema.orders.createdAt, nigeriaDayStart(startDate)));
    if (endDate) conditions.push(lte(schema.orders.createdAt, nigeriaDayEnd(endDate)));
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
    // CEO directive 2026-05-23: merge legacy CANCELLED into DELETED count.
    if (counts['CANCELLED']) {
      counts['DELETED'] = (counts['DELETED'] ?? 0) + counts['CANCELLED'];
      delete counts['CANCELLED'];
    }
    return counts;
  }

  /**
   * Supplementary counts for the stat strip: offline-created orders and flagged duplicates.
   * Uses the same scope as `getStatusCounts` so numbers are consistent.
   */
  async getSupplementaryCounts(
    mediaBuyerId?: string,
    startDate?: string,
    endDate?: string,
    assignedCsId?: string,
    branchId?: string | null,
    supervisorScope?: OrdersAggregateSupervisorScope,
    branchScope: 'servicing' | 'marketing' = 'servicing',
    effectiveBranchIds?: string[] | null,
  ): Promise<{ offlineCount: number; duplicateCount: number }> {
    const conditions: Parameters<typeof and>[0][] = [
      eq(schema.orders.isFollowUp, false),
    ];
    appendOrdersAggregateScopeConditions(conditions, { mediaBuyerId, assignedCsId, supervisorScope });
    const bCond = this.orderBranchScopeCondition(branchId, branchScope, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    if (startDate) conditions.push(gte(schema.orders.createdAt, nigeriaDayStart(startDate)));
    if (endDate) conditions.push(lte(schema.orders.createdAt, nigeriaDayEnd(endDate)));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Offline count includes:
    //  1. Normal offline orders (isFollowUp=false, orderSource='offline')
    //  2. Delivered follow-up offline orders (cart-recovered, CEO 2026-06-09)
    //     — these are invisible to normal metrics but count once delivered.
    const deliveredFollowUpOfflineConditions: Parameters<typeof and>[0][] = [
      eq(schema.orders.isFollowUp, true),
      eq(schema.orders.orderSource, 'offline'),
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
    ];
    appendOrdersAggregateScopeConditions(deliveredFollowUpOfflineConditions, { mediaBuyerId, assignedCsId, supervisorScope });
    if (bCond) deliveredFollowUpOfflineConditions.push(bCond);
    if (startDate) deliveredFollowUpOfflineConditions.push(gte(schema.orders.createdAt, nigeriaDayStart(startDate)));
    if (endDate) deliveredFollowUpOfflineConditions.push(lte(schema.orders.createdAt, nigeriaDayEnd(endDate)));
    const deliveredFollowUpOfflineWhere = and(...deliveredFollowUpOfflineConditions);

    const [offlineRows, deliveredFollowUpOfflineRows, duplicateRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(and(whereClause, eq(schema.orders.orderSource, 'offline'))),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(deliveredFollowUpOfflineWhere),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(and(whereClause, sql`${schema.orders.isDuplicate} IS NOT NULL AND ${schema.orders.isDuplicate} != ''`)),
    ]);

    return {
      // Merge delivered follow-up offline orders into the offline count so they
      // surface in the "Offline orders" stat strip tile (CEO 2026-06-09).
      offlineCount: (offlineRows[0]?.count ?? 0) + (deliveredFollowUpOfflineRows[0]?.count ?? 0),
      duplicateCount: duplicateRows[0]?.count ?? 0,
    };
  }

  /**
   * Get order pipeline chart data — Volume, Unconfirmed, Confirmed, Logistics distributed, Delivered.
   * For the CEO Executive Overview order funnel chart. Same date filter as getStatusCounts (created_at).
   */
  async getOrderPipelineChart(startDate?: string, endDate?: string, branchId?: string | null, effectiveBranchIds?: string[] | null): Promise<{
    volume: number;
    unconfirmed: number;
    confirmed: number;
    logisticsDistributed: number;
    delivered: number;
  }> {
    const counts = await this.getStatusCounts(
      undefined,
      startDate,
      endDate,
      undefined,
      undefined,
      branchId,
      undefined,
      undefined,
      'servicing',
      effectiveBranchIds,
    );
    // `volume` is the funnel's top-of-stack count. DELETED orders are editorial
    // removals (test/fake/mistake), never real business volume — exclude them.
    // `getStatusCounts` intentionally returns DELETED so the strip can show its
    // own pill, but every aggregate over `counts` must filter it out here.
    const volume = Object.entries(counts).reduce(
      (sum, [status, c]) => (status === 'DELETED' ? sum : sum + (c ?? 0)),
      0,
    );
    return {
      volume,
      unconfirmed: counts['CS_ENGAGED'] ?? 0,
      confirmed: counts['CONFIRMED'] ?? 0,
      logisticsDistributed: (counts['AGENT_ASSIGNED'] ?? 0) + (counts['DISPATCHED'] ?? 0),
      delivered: (counts['DELIVERED'] ?? 0) + (counts['REMITTED'] ?? 0),
    };
  }

  /**
   * Distinct orders per assigned Sales closer whose CS stage closed today (Africa/Lagos calendar).
   * Uses timeline ORDER_CONFIRMED / ORDER_CANCELLED joined to orders by assigned_cs_id (display-only).
   * Attribution uses current assigned_cs_id — rare reassignment after close could mis-attribute.
   */
  private async getTodayCsStageCloseCountsByAgent(
    branchId?: string | null,
    onlyAgentId?: string,
    effectiveBranchIds?: string[] | null,
  ): Promise<Record<string, number>> {
    // Include follow-up orders — CS confirms/cancels on follow-up orders
    // count toward daily performance (CEO 2026-06-09).
    const conditions: Parameters<typeof and>[0][] = [
      inArray(schema.orderTimelineEvents.eventType, ['ORDER_CONFIRMED', 'ORDER_CANCELLED']),
      sql`(timezone('Africa/Lagos', ${schema.orderTimelineEvents.createdAt}))::date = (timezone('Africa/Lagos', now()))::date`,
      sql`${schema.orders.assignedCsId} IS NOT NULL`,
      isNull(schema.orders.deletedAt),
    ];
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    if (onlyAgentId) {
      conditions.push(eq(schema.orders.assignedCsId, onlyAgentId));
    }

    const rows = await this.db
      .select({
        assignedCsId: schema.orders.assignedCsId,
        cnt: sql<number>`COUNT(DISTINCT ${schema.orders.id})::int`,
      })
      .from(schema.orderTimelineEvents)
      .innerJoin(schema.orders, eq(schema.orderTimelineEvents.orderId, schema.orders.id))
      .where(and(...conditions))
      .groupBy(schema.orders.assignedCsId);

    const map: Record<string, number> = {};
    for (const row of rows) {
      if (row.assignedCsId) map[row.assignedCsId] = Number(row.cnt ?? 0);
    }
    return map;
  }

  /**
   * Get Sales closer workload — for dispatch algorithm and dashboard.
   * Single aggregation query + user list (no N+1).
   */
  async getCSCloserWorkloads(
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
    opts?: { pendingCountsAcrossAllBranches?: boolean },
  ) {
    const pendingCountsAcrossAllBranches = opts?.pendingCountsAcrossAllBranches === true;

    const agentCols = {
      id: schema.users.id,
      name: schema.users.name,
      capacity: schema.users.capacity,
      lastActionAt: schema.users.lastActionAt,
    };

    const agentsPromise = branchId
      ? this.db
          .select(agentCols)
          .from(schema.users)
          .innerJoin(
            schema.userBranches,
            and(
              eq(schema.userBranches.userId, schema.users.id),
              eq(schema.userBranches.branchId, branchId),
            ),
          )
          .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE')))
      : effectiveBranchIds?.length
        ? this.db
            .select(agentCols)
            .from(schema.users)
            .innerJoin(
              schema.userBranches,
              and(
                eq(schema.userBranches.userId, schema.users.id),
                inArray(schema.userBranches.branchId, effectiveBranchIds),
              ),
            )
            .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE')))
            .groupBy(schema.users.id, schema.users.name, schema.users.capacity, schema.users.lastActionAt)
        : this.db
            .select(agentCols)
            .from(schema.users)
            .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE')));

    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);

    const [agents, pendingByAgent, closesTodayMap] = await Promise.all([
      agentsPromise,
      this.db
        .select({
          assignedCsId: schema.orders.assignedCsId,
          count: count(),
        })
        .from(schema.orders)
        .where(
          and(
            isNull(schema.orders.deletedAt),
            inArray(schema.orders.status, ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED']),
            ...(!pendingCountsAcrossAllBranches && bCond ? [bCond] : []),
          ),
        )
        .groupBy(schema.orders.assignedCsId),
      this.getTodayCsStageCloseCountsByAgent(branchId),
    ]);

    const pendingMap: Record<string, number> = {};
    for (const row of pendingByAgent) {
      if (row.assignedCsId) pendingMap[row.assignedCsId] = row.count;
    }

    return agents.map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      capacity: agent.capacity ?? 10,
      pendingCount: pendingMap[agent.id] ?? 0,
      todayClosesCount: closesTodayMap[agent.id] ?? 0,
      lastActionAt: agent.lastActionAt,
    }));
  }

  /**
   * Pending workload orders for a Sales closer (same status/branch rules as getCSCloserWorkloads),
   * with line items for HoCS queue modal. Sorted by updatedAt desc (most recently touched first).
   */
  async getCloserWorkloadOrdersWithItems(agentId: string, branchId?: string | null, effectiveBranchIds?: string[] | null) {
    const workloadStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'] as const;
    const conditions: Parameters<typeof and>[0][] = [
      eq(schema.orders.assignedCsId, agentId),
      inArray(schema.orders.status, [...workloadStatuses]),
    ];
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);

    const orderRows = await this.db
      .select({
        id: schema.orders.id,
        status: schema.orders.status,
        customerName: schema.orders.customerName,
        createdAt: schema.orders.createdAt,
        updatedAt: schema.orders.updatedAt,
        totalAmount: schema.orders.totalAmount,
      })
      .from(schema.orders)
      .where(and(...conditions))
      .orderBy(desc(schema.orders.updatedAt));

    if (orderRows.length === 0) {
      return [];
    }

    const orderIds = orderRows.map((o) => o.id);
    const itemRows = await this.db
      .select({
        orderId: schema.orderItems.orderId,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        offerLabel: schema.orderItems.offerLabel,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(inArray(schema.orderItems.orderId, orderIds));

    type ItemRow = (typeof itemRows)[number];
    const itemsByOrder = new Map<string, ItemRow[]>();
    for (const row of itemRows) {
      const list = itemsByOrder.get(row.orderId) ?? [];
      list.push(row);
      itemsByOrder.set(row.orderId, list);
    }

    return orderRows.map((o) => ({
      id: o.id,
      status: o.status,
      customerName: o.customerName,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      totalAmount: o.totalAmount != null ? String(o.totalAmount) : null,
      items: (itemsByOrder.get(o.id) ?? []).map((row) => ({
        productName: row.productName ?? null,
        quantity: row.quantity,
        unitPrice: String(row.unitPrice),
        offerLabel: row.offerLabel ?? null,
      })),
    }));
  }

  /**
   * Get workload for the current Sales closer — for \"My Orders\" page.
   * Returns null for non–Sales closers or inactive users.
   */
  async getMyCSWorkload(actor: SessionUser) {
    if (actor.role !== 'CS_CLOSER') {
      return null;
    }

    const userRows = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, actor.id),
          eq(schema.users.role, 'CS_CLOSER'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const user = userRows[0];
    if (!user) {
      return null;
    }

    const [pendingRows, closesTodayMap] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.assignedCsId, actor.id),
            or(
              eq(schema.orders.status, 'UNPROCESSED'),
              eq(schema.orders.status, 'CS_ASSIGNED'),
              eq(schema.orders.status, 'CS_ENGAGED'),
            ),
          ),
        ),
      this.getTodayCsStageCloseCountsByAgent(undefined, actor.id),
    ]);

    return {
      agentId: user.id,
      agentName: user.name,
      capacity: user.capacity ?? 10,
      pendingCount: pendingRows[0]?.count ?? 0,
      todayClosesCount: closesTodayMap[actor.id] ?? 0,
      lastActionAt: user.lastActionAt,
    };
  }

  /**
   * Get delivered orders aggregated by day — for CEO overview time-series chart.
   * Returns { date: YYYY-MM-DD, revenue, orderCount }[] for the given date range (delivered_at).
   */
  async getDeliveredOrdersTimeSeries(startDate?: string, endDate?: string, branchId?: string | null, effectiveBranchIds?: string[] | null): Promise<{ date: string; revenue: number; orderCount: number }[]> {
    const conditions: Parameters<typeof and>[0][] = [
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
      sql`${schema.orders.deliveredAt} IS NOT NULL`,
    ];
    if (startDate) conditions.push(gte(schema.orders.deliveredAt, nigeriaDayStart(startDate)));
    if (endDate) conditions.push(lte(schema.orders.deliveredAt, nigeriaDayEnd(endDate)));
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    const whereClause = and(...conditions);
    const dateTrunc = sql`DATE_TRUNC('day', ${schema.orders.deliveredAt})::date`;

    const rows = await this.db
      .select({
        date: dateTrunc,
        revenue: sql<string>`COALESCE(SUM(CAST(${schema.orders.totalAmount} AS numeric)), 0)`,
        orderCount: count(),
      })
      .from(schema.orders)
      .where(whereClause)
      .groupBy(dateTrunc)
      .orderBy(asc(dateTrunc));

    return rows.map((r) => ({
      date: typeof r.date === 'string' ? r.date.split('T')[0]! : (r.date as Date).toISOString().split('T')[0]!,
      revenue: Number(r.revenue ?? 0),
      orderCount: r.orderCount ?? 0,
    }));
  }

  /**
   * Lagos-timezone period boundaries (today / this week Mon-Sun / this month).
   * Nigeria does not observe DST so the +01:00 offset is constant.
   */
  private static lagosPeriodBoundaries() {
    const LAGOS_OFFSET_MS = 1 * 60 * 60 * 1000; // UTC+1
    const lagosNow = new Date(Date.now() + LAGOS_OFFSET_MS);

    const todayStart = new Date(lagosNow);
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartUtc = new Date(todayStart.getTime() - LAGOS_OFFSET_MS);

    const weekStart = new Date(lagosNow);
    const dow = weekStart.getUTCDay() || 7; // Sunday=0 → 7 so we go back to Monday
    weekStart.setUTCDate(weekStart.getUTCDate() - dow + 1);
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekStartUtc = new Date(weekStart.getTime() - LAGOS_OFFSET_MS);

    const monthStart = new Date(lagosNow);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartUtc = new Date(monthStart.getTime() - LAGOS_OFFSET_MS);

    return { todayStartUtc, weekStartUtc, monthStartUtc };
  }

  /**
   * Deliveries grouped by product (brand) — CEO dashboard widget.
   * Returns delivery counts for today, this week, and this month per product/brand.
   * Bounded to the current month for index-friendly scans.
   */
  async getDeliveriesByProduct(branchId?: string | null, effectiveBranchIds?: string[] | null): Promise<
    Array<{
      productId: string;
      productName: string;
      brandName: string | null;
      today: number;
      thisWeek: number;
      thisMonth: number;
    }>
  > {
    const { todayStartUtc, weekStartUtc, monthStartUtc } = OrdersService.lagosPeriodBoundaries();
    // Pre-serialise to ISO strings — raw `sql\`\`` templates don't carry the
    // column-type hint that `gte()` / `lte()` do, so postgres-js can't bind a
    // Date instance and throws "Received an instance of Date".
    const todayIso = todayStartUtc.toISOString();
    const weekIso = weekStartUtc.toISOString();

    const conditions: Parameters<typeof and>[0][] = [
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
      gte(schema.orders.deliveredAt, monthStartUtc), // bounds scan to current month
    ];
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);

    const rows = await this.db
      .select({
        productId: schema.orderItems.productId,
        productName: schema.products.name,
        brandName: schema.productCategories.brandName,
        today: sql<number>`COUNT(*) FILTER (WHERE ${schema.orders.deliveredAt} >= ${todayIso}::timestamptz)::int`,
        thisWeek: sql<number>`COUNT(*) FILTER (WHERE ${schema.orders.deliveredAt} >= ${weekIso}::timestamptz)::int`,
        thisMonth: sql<number>`COUNT(*)::int`,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .leftJoin(schema.productCategories, eq(schema.products.categoryId, schema.productCategories.id))
      .where(and(...conditions))
      .groupBy(schema.orderItems.productId, schema.products.name, schema.productCategories.brandName)
      .orderBy(sql`COUNT(*) DESC`);

    return rows.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      brandName: r.brandName ?? null,
      today: r.today ?? 0,
      thisWeek: r.thisWeek ?? 0,
      thisMonth: r.thisMonth ?? 0,
    }));
  }

  /**
   * Revenue breakdown by day/week/month — CEO dashboard hero stat.
   * Bounded to current month for index-friendly scans; CASE expressions
   * compute the narrower today/week buckets within that range.
   */
  async getRevenueByPeriod(branchId?: string | null, effectiveBranchIds?: string[] | null): Promise<{
    today: number;
    thisWeek: number;
    thisMonth: number;
  }> {
    const { todayStartUtc, weekStartUtc, monthStartUtc } = OrdersService.lagosPeriodBoundaries();
    // See note in getDeliveriesByProduct — Date interpolation into raw `sql\`\``
    // breaks the postgres-js parameter binder; ISO string + ::timestamptz cast
    // is the safe path.
    const todayIso = todayStartUtc.toISOString();
    const weekIso = weekStartUtc.toISOString();

    const conditions: Parameters<typeof and>[0][] = [
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
      gte(schema.orders.deliveredAt, monthStartUtc), // bounds scan to current month
    ];
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);

    const [row] = await this.db
      .select({
        today: sql<string>`COALESCE(SUM(CASE WHEN ${schema.orders.deliveredAt} >= ${todayIso}::timestamptz THEN CAST(${schema.orders.totalAmount} AS numeric) ELSE 0 END), 0)`,
        thisWeek: sql<string>`COALESCE(SUM(CASE WHEN ${schema.orders.deliveredAt} >= ${weekIso}::timestamptz THEN CAST(${schema.orders.totalAmount} AS numeric) ELSE 0 END), 0)`,
        thisMonth: sql<string>`COALESCE(SUM(CAST(${schema.orders.totalAmount} AS numeric)), 0)`,
      })
      .from(schema.orders)
      .where(and(...conditions));

    return {
      today: Number(row?.today ?? 0),
      thisWeek: Number(row?.thisWeek ?? 0),
      thisMonth: Number(row?.thisMonth ?? 0),
    };
  }

  /**
   * Daily delivered count by `delivered_at` (status DELIVERED only — same as CEO
   * `getDeliveredOrdersTimeSeries`), with the same scope filters as `getOrdersTimeSeriesByCreated`.
   */
  private async getOrdersTimeSeriesByDelivered(
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    extra?: OrdersAggregateScopeFilters,
    branchScope: 'servicing' | 'marketing' = 'servicing',
    effectiveBranchIds?: string[] | null,
  ): Promise<{ date: string; deliveredCount: number }[]> {
    const conditions: Parameters<typeof and>[0][] = [
      isNull(schema.orders.deletedAt),
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
      sql`${schema.orders.deliveredAt} IS NOT NULL`,
    ];
    if (startDate) conditions.push(gte(schema.orders.deliveredAt, nigeriaDayStart(startDate)));
    if (endDate) conditions.push(lte(schema.orders.deliveredAt, nigeriaDayEnd(endDate)));
    const bCond = this.orderBranchScopeCondition(branchId, branchScope, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    appendOrdersAggregateScopeConditions(conditions, {
      mediaBuyerId: extra?.mediaBuyerId,
      assignedCsId: extra?.csCloserId,
      supervisorScope: extra?.supervisorScope,
    });
    if (extra?.logisticsLocationId) conditions.push(eq(schema.orders.logisticsLocationId, extra.logisticsLocationId));
    // NOTE: intentionally do NOT apply extra.status / extra.statuses here.
    // The delivered line shows delivery throughput regardless of which status
    // tab the user is viewing. Adding e.g. `status = 'AGENT_ASSIGNED'` would
    // conflict with the `IN ('DELIVERED','REMITTED')` condition above and
    // return zero rows.
    const dateTrunc = sql`DATE_TRUNC('day', ${schema.orders.deliveredAt})::date`;

    const rows = await this.db
      .select({
        date: dateTrunc,
        deliveredCount: count(),
      })
      .from(schema.orders)
      .where(and(...conditions))
      .groupBy(dateTrunc)
      .orderBy(asc(dateTrunc));

    return rows.map((r) => ({
      date: typeof r.date === 'string' ? r.date.split('T')[0]! : (r.date as Date).toISOString().split('T')[0]!,
      deliveredCount: r.deliveredCount ?? 0,
    }));
  }

  /**
   * Get order volume by creation date plus delivered count by delivery date — used by the CEO
   * overview time-series chart and the "View data in chart" toggle on the per-role order list
   * pages (Marketing / CS / Logistics).
   *
   * Optional `mediaBuyerId` / `csCloserId` / `status` filters mirror the matching filters on
   * `listOrders` so each list page can request a daily series scoped to the table filters.
   *
   * - `orderCount`: grouped by `created_at` (unchanged).
   * - `deliveredCount`: grouped by `delivered_at`, `status = DELIVERED`, same filters and date
   *   window on `delivered_at` (CEO-style delivery throughput; can differ from rows created in
   *   the same window).
   *
   * Returns merged `{ date, orderCount, deliveredCount }[]` sorted ascending by date.
   */
  async getOrdersTimeSeriesByCreated(
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    extra?: OrdersAggregateScopeFilters,
    branchScope: 'servicing' | 'marketing' = 'servicing',
    effectiveBranchIds?: string[] | null,
  ): Promise<{ date: string; orderCount: number; deliveredCount: number }[]> {
    // CEO directive 2026-05-23: exclude both DELETED and legacy CANCELLED from default views.
    const conditions: Parameters<typeof and>[0][] = [
      isNull(schema.orders.deletedAt),
      sql`${schema.orders.status} != 'CANCELLED'`,
    ];
    if (startDate) conditions.push(gte(schema.orders.createdAt, nigeriaDayStart(startDate)));
    if (endDate) conditions.push(lte(schema.orders.createdAt, nigeriaDayEnd(endDate)));
    const bCond = this.orderBranchScopeCondition(branchId, branchScope, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    appendOrdersAggregateScopeConditions(conditions, {
      mediaBuyerId: extra?.mediaBuyerId,
      assignedCsId: extra?.csCloserId,
      supervisorScope: extra?.supervisorScope,
    });
    if (extra?.logisticsLocationId) conditions.push(eq(schema.orders.logisticsLocationId, extra.logisticsLocationId));
    if (extra?.status) {
      conditions.push(eq(schema.orders.status, extra.status as (typeof schema.orders.$inferSelect)['status']));
    }
    if (extra?.statuses?.length) {
      conditions.push(inArray(schema.orders.status, extra.statuses));
    }
    const dateTrunc = sql`DATE_TRUNC('day', ${schema.orders.createdAt})::date`;

    let createdQuery = this.db
      .select({
        date: dateTrunc,
        orderCount: count(),
      })
      .from(schema.orders)
      .$dynamic();
    if (conditions.length > 0) {
      createdQuery = createdQuery.where(and(...conditions));
    }

    // Created-day counts and delivered-day counts touch the same `orders` table but on
    // independent filters (created_at vs delivered_at) and grouped on different columns,
    // so we run them in parallel rather than sequentially. On a remote DB (~120 ms RTT)
    // this halves the wall-clock for the trend chart endpoint that powers the marketing /
    // CS / logistics order pages — previously the slowest call in the secondary fan-out
    // because it was a single 1-RTT-per-step waterfall with `db ≈ total`.
    const [createdRows, delivered] = await Promise.all([
      createdQuery.groupBy(dateTrunc).orderBy(asc(dateTrunc)),
      this.getOrdersTimeSeriesByDelivered(startDate, endDate, branchId, extra, branchScope, effectiveBranchIds),
    ]);

    const created = createdRows.map((r) => ({
      date: typeof r.date === 'string' ? r.date.split('T')[0]! : (r.date as Date).toISOString().split('T')[0]!,
      orderCount: r.orderCount ?? 0,
    }));

    const byDate = new Map<string, { date: string; orderCount: number; deliveredCount: number }>();
    for (const row of created) {
      byDate.set(row.date, { date: row.date, orderCount: row.orderCount, deliveredCount: 0 });
    }
    for (const row of delivered) {
      const existing = byDate.get(row.date);
      if (existing) {
        existing.deliveredCount = row.deliveredCount;
      } else {
        byDate.set(row.date, { date: row.date, orderCount: 0, deliveredCount: row.deliveredCount });
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Release expired order locks (called periodically or before dispatch).
   * Orders locked for > 15 min are auto-released.
   * When actorId is provided (e.g. from tRPC), audit trail records that user; otherwise system/cron.
   */
  async releaseExpiredLocks(actorId?: string | null): Promise<{ releasedCount: number }> {
    const run = async (
      dbOrTx: PostgresJsDatabase<typeof schema> | Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0],
    ) =>
      dbOrTx
        .update(schema.orders)
        .set({ lockedUntil: null, lockedBy: null, updatedAt: new Date() })
        .where(
          and(
            sql`${schema.orders.lockedUntil} IS NOT NULL`,
            sql`${schema.orders.lockedUntil} < NOW()`,
          ),
        )
        .returning();

    const released = actorId
      ? await withActor(this.db, { id: actorId }, run)
      : await run(this.db);

    return { releasedCount: released.length };
  }

  /**
   * Check for inactive Sales closers (no action for > 10 min).
   * Returns agent IDs that should receive an inactivity alert.
   *
   * Implementation note (perf): previously this issued **one COUNT per agent**
   * inside a sequential `for` loop, so on a Mac dev box hitting a remote DB
   * with 12 active agents it spent 12 × ~120ms RTT before returning. Called
   * from `dashboard.quickOverview` on every admin landing — the latency hit
   * the SuperAdmin/Admin home page directly.
   *
   * The rewrite collapses everything into **2 queries in parallel**:
   *   1) all active CS_CLOSER rows (id, name, lastActionAt),
   *   2) one grouped COUNT keyed on `assigned_cs_id` for orders in pending
   *      CS statuses, restricted to the same agent set via `IN (...)`.
   * Constant 2 RTTs regardless of agent count.
   */
  async getInactiveAgents(thresholdMinutes = 10, branchId?: string | null, effectiveBranchIds?: string[] | null) {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const needsBranchJoin = branchId || (!branchId && effectiveBranchIds?.length);
    const agents = await (needsBranchJoin
      ? this.db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            lastActionAt: schema.users.lastActionAt,
          })
          .from(schema.users)
          .innerJoin(
            schema.userBranches,
            and(
              eq(schema.userBranches.userId, schema.users.id),
              ...(branchId
                ? [eq(schema.userBranches.branchId, branchId)]
                : effectiveBranchIds?.length
                  ? [inArray(schema.userBranches.branchId, effectiveBranchIds)]
                  : []),
            ),
          )
          .where(
            and(
              eq(schema.users.role, 'CS_CLOSER'),
              eq(schema.users.status, 'ACTIVE'),
            ),
          )
      : this.db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            lastActionAt: schema.users.lastActionAt,
          })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.role, 'CS_CLOSER'),
              eq(schema.users.status, 'ACTIVE'),
            ),
          ));

    if (agents.length === 0) return [];

    const agentIds = agents.map((a) => a.id);
    const pendingRows = await this.db
      .select({
        agentId: schema.orders.assignedCsId,
        count: count(),
      })
      .from(schema.orders)
      .where(
        and(
          isNull(schema.orders.deletedAt),
          inArray(schema.orders.assignedCsId, agentIds),
          inArray(schema.orders.status, ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED']),
          ...(branchId ? [eq(schema.orders.servicingBranchId, branchId)] : []),
        ),
      )
      .groupBy(schema.orders.assignedCsId);

    const pendingByAgent = new Map<string, number>();
    for (const row of pendingRows) {
      if (row.agentId) pendingByAgent.set(row.agentId, Number(row.count) || 0);
    }

    const inactive: Array<{
      agentId: string;
      agentName: string;
      lastActionAt: Date | null;
      pendingCount: number;
    }> = [];
    for (const agent of agents) {
      const pendingCount = pendingByAgent.get(agent.id) ?? 0;
      const hasPending = pendingCount > 0;
      const isIdle = !agent.lastActionAt || agent.lastActionAt < threshold;
      if (hasPending && isIdle) {
        inactive.push({
          agentId: agent.id,
          agentName: agent.name,
          lastActionAt: agent.lastActionAt,
          pendingCount,
        });
      }
    }

    return inactive;
  }

  /**
   * Get Sales closer leaderboard — performance metrics for ranking.
   * period: 'this_month' (default) or 'all_time'; optional startDate/endDate override for custom range.
   *
   * Implementation note (perf): previously this issued **6 queries per agent**
   * (engaged, confirmed, cancelled, delivered, call count, avg call duration)
   * inside a `Promise.all(agents.map(...))`, so leaderboard latency grew
   * linearly with the active CS_CLOSER count and routinely dominated the CS
   * dashboard load (~22s `db` time observed in dev logs).
   *
   * The rewrite collapses everything into **3 grouped aggregations** by
   * `assigned_cs_id` / `agent_id` using Postgres `FILTER (WHERE …)` clauses:
   *   1) order metrics by created_at window (engaged / confirmed / cancelled),
   *   2) delivered metrics by delivered_at window,
   *   3) call metrics (count + AVG duration of COMPLETED calls).
   * Total round-trips: 3 (in parallel) regardless of how many agents exist.
   * Output shape, sort, and counted-status semantics are unchanged.
   */
  async getCSCloserLeaderboard(
    period: 'this_month' | 'all_time' = 'this_month',
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
  ) {
    const useCustomRange = startDate && endDate;
    const periodStart = useCustomRange
      ? nigeriaDayStart(startDate)
      : period === 'this_month'
        ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        : null;
    const periodEnd: Date | null = useCustomRange ? nigeriaDayEnd(endDate) : null;

    const needsBranchJoin = branchId || (!branchId && effectiveBranchIds?.length);
    const agents = await (needsBranchJoin
      ? this.db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .innerJoin(
            schema.userBranches,
            and(
              eq(schema.userBranches.userId, schema.users.id),
              ...(branchId
                ? [eq(schema.userBranches.branchId, branchId)]
                : effectiveBranchIds?.length
                  ? [inArray(schema.userBranches.branchId, effectiveBranchIds)]
                  : []),
            ),
          )
          .where(
            and(
              eq(schema.users.role, 'CS_CLOSER'),
              eq(schema.users.status, 'ACTIVE'),
            ),
          )
      : this.db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(
            and(
              eq(schema.users.role, 'CS_CLOSER'),
              eq(schema.users.status, 'ACTIVE'),
            ),
          ));

    if (agents.length === 0) return [];
    const agentIds = agents.map((a) => a.id);

    // Predicate templates — Postgres `FILTER (WHERE …)` evaluates per row inside
    // a single grouped aggregate, so we never materialize per-agent subqueries.
    const confirmedOrBeyond = sql`${schema.orders.status} IN ('CONFIRMED','AGENT_ASSIGNED','DISPATCHED','IN_TRANSIT','DELIVERED','PARTIALLY_DELIVERED','REMITTED','RETURNED','RESTOCKED','WRITTEN_OFF')`;
    // DELETED is an editorial action (test/fake/mistake orders), never a business
    // outcome — it must NOT appear in any rate's numerator or denominator. We still
    // surface legacy CANCELLED rejections (pre-2026-05-23 directive) as a real outcome.
    const legacyCancelled = sql`${schema.orders.status} = 'CANCELLED'`;
    const notDeleted = sql`${schema.orders.status} <> 'DELETED'`;
    const deliveredOrRemitted = sql`${schema.orders.status} IN ('DELIVERED','REMITTED')`;
    const callCompleted = sql`${schema.callLogs.callStatus} = 'COMPLETED'`;

    // Date range conditions reused inside each grouped query's WHERE clause.
    // Cohort semantics: both engaged and delivered count by `createdAt` so DR
    // is bounded by 100%. Counting deliveries by `deliveredAt` while engaged
    // counts by `createdAt` let cross-period deliveries push DR past 100% and
    // unfairly inflated agents in performance-mode dispatch ranking.
    const orderDateFilter = periodStart
      ? periodEnd
        ? and(gte(schema.orders.createdAt, periodStart), lte(schema.orders.createdAt, periodEnd))
        : gte(schema.orders.createdAt, periodStart)
      : undefined;
    const callLogsDateFilter = periodStart
      ? periodEnd
        ? and(gte(schema.callLogs.startedAt, periodStart), lte(schema.callLogs.startedAt, periodEnd))
        : gte(schema.callLogs.startedAt, periodStart)
      : undefined;

    // Include all orders (normal + follow-up) in agent metrics so that
    // delivered follow-up orders count toward CS delivery performance and
    // the engaged denominator stays consistent (CEO 2026-06-09).
    const orderWhere = and(
      inArray(schema.orders.assignedCsId, agentIds),
      ...(branchId ? [eq(schema.orders.servicingBranchId, branchId)] : []),
      ...(orderDateFilter ? [orderDateFilter] : []),
    );
    const deliveredWhere = and(
      inArray(schema.orders.assignedCsId, agentIds),
      deliveredOrRemitted,
      ...(branchId ? [eq(schema.orders.servicingBranchId, branchId)] : []),
      ...(orderDateFilter ? [orderDateFilter] : []),
    );

    const [orderRows, deliveredRows, callRows] = await Promise.all([
      this.db
        .select({
          agentId: schema.orders.assignedCsId,
          // `engaged` = all orders this CS handled in period, with DELETED excluded.
          // Without the filter, DELETED test/fake orders silently inflate the
          // workload denominator and drag every CS's CR down.
          engaged: sql<number>`COUNT(*) FILTER (WHERE ${notDeleted})::int`,
          confirmed: sql<number>`COUNT(*) FILTER (WHERE ${confirmedOrBeyond})::int`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${legacyCancelled})::int`,
        })
        .from(schema.orders)
        .where(orderWhere)
        .groupBy(schema.orders.assignedCsId),
      this.db
        .select({
          agentId: schema.orders.assignedCsId,
          delivered: sql<number>`COUNT(*)::int`,
        })
        .from(schema.orders)
        .where(deliveredWhere)
        .groupBy(schema.orders.assignedCsId),
      branchId
        ? this.db
            .select({
              agentId: schema.callLogs.agentId,
              callsMade: sql<number>`COUNT(*)::int`,
              // AVG over only COMPLETED calls (matches the prior callLogsAvgWhere semantics).
              avgDuration: sql<number>`COALESCE(AVG(${schema.callLogs.durationSeconds}) FILTER (WHERE ${callCompleted}), 0)::numeric`,
            })
            .from(schema.callLogs)
            .innerJoin(schema.orders, eq(schema.callLogs.orderId, schema.orders.id))
            .where(
              and(
                inArray(schema.callLogs.agentId, agentIds),
                eq(schema.orders.servicingBranchId, branchId),
                ...(callLogsDateFilter ? [callLogsDateFilter] : []),
              ),
            )
            .groupBy(schema.callLogs.agentId)
        : this.db
            .select({
              agentId: schema.callLogs.agentId,
              callsMade: sql<number>`COUNT(*)::int`,
              // AVG over only COMPLETED calls (matches the prior callLogsAvgWhere semantics).
              avgDuration: sql<number>`COALESCE(AVG(${schema.callLogs.durationSeconds}) FILTER (WHERE ${callCompleted}), 0)::numeric`,
            })
            .from(schema.callLogs)
            .where(
              and(
                inArray(schema.callLogs.agentId, agentIds),
                ...(callLogsDateFilter ? [callLogsDateFilter] : []),
              ),
            )
            .groupBy(schema.callLogs.agentId),
    ]);

    type OrderAgg = { engaged: number; confirmed: number; cancelled: number };
    const orderByAgent = new Map<string, OrderAgg>();
    for (const r of orderRows) {
      if (!r.agentId) continue;
      orderByAgent.set(r.agentId, {
        engaged: Number(r.engaged) || 0,
        confirmed: Number(r.confirmed) || 0,
        cancelled: Number(r.cancelled) || 0,
      });
    }
    const deliveredByAgent = new Map<string, number>();
    for (const r of deliveredRows) {
      if (!r.agentId) continue;
      deliveredByAgent.set(r.agentId, Number(r.delivered) || 0);
    }
    type CallAgg = { callsMade: number; avgDurationSeconds: number };
    const callsByAgent = new Map<string, CallAgg>();
    for (const r of callRows) {
      if (!r.agentId) continue;
      callsByAgent.set(r.agentId, {
        callsMade: Number(r.callsMade) || 0,
        avgDurationSeconds: Number(r.avgDuration) || 0,
      });
    }

    const leaderboard = agents.map((agent) => {
      const ord = orderByAgent.get(agent.id) ?? { engaged: 0, confirmed: 0, cancelled: 0 };
      const ordersDelivered = deliveredByAgent.get(agent.id) ?? 0;
      const callAgg = callsByAgent.get(agent.id) ?? { callsMade: 0, avgDurationSeconds: 0 };

      // CR = confirmed (includes delivered+remitted) / total real workload
      // (DELETED already excluded from `engaged`).
      // DR = delivered / total — same denominator as CR for consistency.
      const confirmationRate = ord.engaged > 0 ? (ord.confirmed / ord.engaged) * 100 : 0;
      const deliveryRate = ord.engaged > 0 ? (ordersDelivered / ord.engaged) * 100 : 0;

      return {
        agentId: agent.id,
        agentName: agent.name,
        ordersEngaged: ord.engaged,
        ordersConfirmed: ord.confirmed,
        ordersCancelled: ord.cancelled,
        ordersDelivered,
        callsMade: callAgg.callsMade,
        confirmationRate,
        deliveryRate,
        avgCallDurationSeconds: Math.round(callAgg.avgDurationSeconds),
      };
    });

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
   * Effective CS_DISPATCH_STRATEGY + CS_CLAIM_CAP for a CS squad (`branch_team_settings`), else system defaults.
   */
  private async getEffectiveCsDispatchStrategy(teamId: string | null): Promise<{
    strategy: string;
    claimCap: number;
  }> {
    const [globalStrategyRow, globalCapRow] = await Promise.all([
      this.settingsService.get('CS_DISPATCH_STRATEGY'),
      this.settingsService.get('CS_CLAIM_CAP'),
    ]);
    const globalStrategy = (globalStrategyRow?.strategy as string | undefined) ?? 'manual';
    const globalCap = typeof globalCapRow?.cap === 'number' ? globalCapRow.cap : 2;

    if (!teamId) {
      return { strategy: globalStrategy, claimCap: globalCap };
    }

    const [stratEff, capEff] = await Promise.all([
      this.settingsService.getEffectiveTeamSetting(teamId, 'CS_DISPATCH_STRATEGY'),
      this.settingsService.getEffectiveTeamSetting(teamId, 'CS_CLAIM_CAP'),
    ]);

    const strategy =
      stratEff.value?.strategy !== undefined && stratEff.value?.strategy !== null
        ? String(stratEff.value.strategy)
        : globalStrategy;

    const capRaw = capEff.value?.cap;
    const claimCap = typeof capRaw === 'number' ? capRaw : globalCap;

    return { strategy, claimCap };
  }

  /**
   * Assign a single UNPROCESSED order to the best available Sales closer using the configured
   * dispatch strategy. Used by auto-dispatch on creation and by distributeUnassignedOrders.
   * Returns true if the order was assigned, false if no eligible closer was found.
   */
  private async assignOrderToBestAvailableAgent(orderId: string): Promise<boolean> {
    const [orderRow] = await this.db
      .select({
        branchId: schema.orders.branchId,
        customerName: schema.orders.customerName,
        totalAmount: schema.orders.totalAmount,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const branchId = orderRow?.branchId ?? null;

    const [firstLine] = await this.db
      .select({ productId: schema.orderItems.productId })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .orderBy(asc(schema.orderItems.createdAt))
      .limit(1);
    const primaryProductId = firstLine?.productId ?? null;

    const routing =
      branchId != null
        ? await this.csOrderRouting.resolveRoutingForDispatch(branchId, primaryProductId, orderId)
        : null;

    // Routing winner: when a routing rule resolved (`routing != null`), respect
    // its `servicingBranchId` — including an explicit `null` which means
    // "org-wide pool" (SPLIT_ALL_BRANCHES). Only fall back to the order's own
    // branch when no routing was resolved at all (e.g., orders without a
    // branch_id where `resolveRoutingForDispatch` short-circuits to null).
    const servicingBranchId: string | null = routing
      ? routing.servicingBranchId
      : (branchId ?? null);
    const workloads = await this.getCSCloserWorkloads(servicingBranchId ?? undefined, null, {
      pendingCountsAcrossAllBranches: routing?.crossBranchServicing === true,
    });
    let available = [...workloads];
    if (available.length === 0) return false;

    const restrict = routing?.restrictToCloserIds;
    if (Array.isArray(restrict) && restrict.length > 0) {
      const rs = new Set(restrict);
      const narrowed = available.filter((w) => rs.has(w.agentId));
      if (narrowed.length > 0) available = narrowed;
    }

    const { strategy: dispatchMode } = await this.getEffectiveCsDispatchStrategy(
      routing?.dispatchSettingsTeamId ?? null,
    );
    if (dispatchMode === 'manual' || dispatchMode === 'claim') {
      return false;
    }

    const strategy = dispatchMode === 'performance' ? 'performance' : 'load_balanced';

    if (strategy === 'performance') {
      const leaderboard = await this.getCSCloserLeaderboard('this_month');
      const perfMap = new Map(
        leaderboard.map((e) => [e.agentId, { deliveryRate: e.deliveryRate, confirmationRate: e.confirmationRate }]),
      );
      available.sort((a, b) => {
        const aPerf = perfMap.get(a.agentId) ?? { deliveryRate: 0, confirmationRate: 0 };
        const bPerf = perfMap.get(b.agentId) ?? { deliveryRate: 0, confirmationRate: 0 };
        if (bPerf.deliveryRate !== aPerf.deliveryRate) return bPerf.deliveryRate - aPerf.deliveryRate;
        if (bPerf.confirmationRate !== aPerf.confirmationRate) return bPerf.confirmationRate - aPerf.confirmationRate;
        if (a.pendingCount !== b.pendingCount) return a.pendingCount - b.pendingCount;
        const aTime = a.lastActionAt?.getTime() ?? 0;
        const bTime = b.lastActionAt?.getTime() ?? 0;
        return aTime - bTime;
      });
    } else {
      available.sort((a, b) => {
        if (a.pendingCount !== b.pendingCount) return a.pendingCount - b.pendingCount;
        const aTime = a.lastActionAt?.getTime() ?? 0;
        const bTime = b.lastActionAt?.getTime() ?? 0;
        return aTime - bTime;
      });
    }

    const targetAgent = available[0];
    if (!targetAgent) return false;

    await this.db
      .update(schema.orders)
      .set({ assignedCsId: targetAgent.agentId, status: 'CS_ASSIGNED', updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    this.events.emitToUser(targetAgent.agentId, 'order:assigned', { orderId });
    this.events.emitToRoom('cs-all', 'order:assigned', { orderId }, servicingBranchId ?? null);
    this.notifications.enqueueCreate({
      userId: targetAgent.agentId,
      type: 'order:assigned',
      title: 'Order assigned to you',
      body: this.formatAssignedOrderBody({
        customerName: orderRow?.customerName ?? null,
        totalAmount: orderRow?.totalAmount ?? null,
      }),
      data: {
        orderId,
        customerName: orderRow?.customerName ?? null,
        totalAmount: orderRow?.totalAmount ?? null,
        assignedBy: 'Auto-dispatch',
      },
    });

    // Timeline event: auto-assigned
    void this.writeTimelineEvent({
      orderId,
      eventType: 'ORDER_AUTO_ASSIGNED',
      actorId: targetAgent.agentId,
      actorName: targetAgent.agentName,
      description: `Auto-assigned to ${targetAgent.agentName}`,
      metadata: { agentId: targetAgent.agentId, strategy },
      branchId: orderRow?.branchId ?? null,
    });

    return true;
  }

  /**
   * Auto-dispatch a new order to a Sales closer.
   * Strategy is configurable via system setting CS_DISPATCH_STRATEGY:
   * - manual (default): no auto-assignment; orders sit UNPROCESSED until HoCS assigns them.
   * - load_balanced: lowest pending count first, then most idle.
   * - performance: prioritise agents with higher delivery rate and confirmation rate (this month).
   * - claim: no auto-assignment; orders stay UNPROCESSED in the claim queue for agents to grab.
   */
  private async autoDispatchToCS(orderId: string) {
    await this.releaseExpiredLocks();

    const [orderRow] = await this.db
      .select({ branchId: schema.orders.branchId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    const branchId = orderRow?.branchId ?? null;

    const [firstLine] = await this.db
      .select({ productId: schema.orderItems.productId })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .orderBy(asc(schema.orderItems.createdAt))
      .limit(1);
    const primaryProductId = firstLine?.productId ?? null;

    const routing =
      branchId != null
        ? await this.csOrderRouting.resolveRoutingForDispatch(branchId, primaryProductId, orderId)
        : null;
    const { strategy } = await this.getEffectiveCsDispatchStrategy(routing?.dispatchSettingsTeamId ?? null);

    if (strategy === 'manual') {
      // Manual mode: no auto-assignment and no claim broadcast. Order remains UNPROCESSED
      // in the HoCS unassigned queue for manual assignment via Hot Swap.
      return;
    }

    if (strategy === 'claim') {
      // Claim mode: leave order in UNPROCESSED, broadcast to claim queue.
      // Scope to the servicing branch the routing rule resolved (falls back to
      // the order's owner branch when no rule matched).
      this.events.emitToRoom(
        'cs-all',
        'order:claim_available',
        { orderId },
        routing?.servicingBranchId ?? branchId,
      );
      return;
    }

    await this.assignOrderToBestAvailableAgent(orderId);
  }

  /**
   * Claim an order from the claim queue. Atomic lock prevents double-claiming.
   */
  async claimOrder(orderId: string, actor: SessionUser): Promise<{ success: boolean; message?: string }> {
    if (actor.role !== 'CS_CLOSER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Sales closers can claim orders' });
    }

    // Atomic claim using Postgres row lock (FOR UPDATE SKIP LOCKED)
    const now = new Date();
    const lockExpiry = new Date(now.getTime() + 15 * 60 * 1000);

    let claimedOrder: Array<{ id: string }> = [];
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);
      claimedOrder = await tx.execute<{ id: string }>(
        sql`
          UPDATE orders
          SET
            assigned_cs_id = ${actor.id},
            status = 'CS_ASSIGNED',
            locked_by = ${actor.id},
            locked_until = ${lockExpiry},
            updated_at = NOW()
          WHERE id = ${orderId}
            AND status = 'UNPROCESSED'
            AND (locked_until IS NULL OR locked_until < NOW())
          RETURNING id
        `,
      );
    });

    if (!claimedOrder || claimedOrder.length === 0) {
      return { success: false, message: 'Order already claimed by another agent or no longer available.' };
    }

    const [claimedRow] = await this.db
      .select({
        customerName: schema.orders.customerName,
        servicingBranchId: schema.orders.servicingBranchId,
      })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    this.events.emitToUser(actor.id, 'order:assigned', {
      orderId,
      customerName: claimedRow?.customerName ?? undefined,
    });
    this.events.emitToRoom('cs-all', 'order:assigned', {
      orderId,
      customerName: claimedRow?.customerName ?? undefined,
    }, claimedRow?.servicingBranchId ?? actor.currentBranchId ?? null);
    this.events.emitToRoom('cs-all', 'order:status_changed', {
      orderId,
      oldStatus: 'UNPROCESSED',
      newStatus: 'CS_ASSIGNED',
      assignedCsId: actor.id,
    }, actor.currentBranchId ?? null);

    this.notifications.enqueueCreate({
      userId: actor.id,
      type: 'order:assigned',
      title: 'Order assigned to you',
      body: 'You claimed this order from the queue. Please attend to it.',
      data: { orderId },
    });

    void this.writeTimelineEvent({
      orderId,
      eventType: 'ORDER_CLAIMED',
      actorId: actor.id,
      actorName: actor.name,
      description: `${actor.name} claimed this order`,
      metadata: { agentId: actor.id, mode: 'claim' },
      branchId: claimedRow?.servicingBranchId ?? actor.currentBranchId ?? null,
    });

    return { success: true };
  }

  /**
   * Get all UNPROCESSED orders available for claiming (claim mode only).
   * Sorted oldest-first so longer-waiting orders are visible first.
   */
  async getClaimQueue(branchId?: string | null, effectiveBranchIds?: string[] | null): Promise<Array<{
    id: string;
    customerName: string;
    createdAt: Date;
    status: string;
    totalAmount: string | null;
    productSummary: string;
  }>> {
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    const orders = await this.db
      .select({
        id: schema.orders.id,
        customerName: schema.orders.customerName,
        createdAt: schema.orders.createdAt,
        status: schema.orders.status,
        totalAmount: schema.orders.totalAmount,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.status, 'UNPROCESSED'),
          sql`(${schema.orders.lockedUntil} IS NULL OR ${schema.orders.lockedUntil} < NOW())`,
          ...(bCond ? [bCond] : []),
        ),
      )
      .orderBy(asc(schema.orders.createdAt))
      .limit(100);

    return orders.map((o) => ({
      ...o,
      totalAmount: o.totalAmount != null ? String(o.totalAmount) : null,
      productSummary: '',
    }));
  }

  /**
   * Distribute all UNPROCESSED (unassigned) orders to Sales closers using the same algorithm as
   * auto-dispatch. Manual fallback when assignment on order creation did not run or failed.
   * Restricted to Head of CS and SuperAdmin.
   */
  async distributeUnassignedOrders(actor: SessionUser): Promise<{ distributed: number }> {
    await this.releaseExpiredLocks(actor.id);

    const unassigned = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(eq(schema.orders.status, 'UNPROCESSED'))
      .orderBy(asc(schema.orders.createdAt));

    let distributed = 0;
    for (const row of unassigned) {
      const assigned = await this.assignOrderToBestAvailableAgent(row.id);
      if (assigned) distributed++;
    }

    if (distributed > 0) {
      this.events.emitToRoom('cs-all', 'order:assignments_changed', { distributed }, actor.currentBranchId ?? null);
    }
    return { distributed };
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
        const rawPreferred = metadata?.preferredDeliveryDate;
        const preferredTrimmed =
          typeof rawPreferred === 'string' ? rawPreferred.trim() : '';
        if (!preferredTrimmed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Scheduled delivery date is required to confirm the order.',
          });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredTrimmed)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Scheduled delivery date must be a valid calendar date (YYYY-MM-DD).',
          });
        }

        const confirmPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
        const hasConfirmPerm = (code: string) =>
          actor.role === 'SUPER_ADMIN' ||
          confirmPerms.includes(canonicalPermissionCode(code));
        const sameBranch =
          !!order.branchId && !!actor.currentBranchId && order.branchId === actor.currentBranchId;
        const bypassCallGate =
          actor.role === 'SUPER_ADMIN' ||
          hasConfirmPerm('orders.confirm.bypass_call_gate') ||
          (hasConfirmPerm('branches.manage') && sameBranch);
        const hoCsOversightPath = hasConfirmPerm('cs.scope.global') && !!order.branchId;

        // Run all the CONFIRMED-gate queries in parallel:
        //   - VOIP setting (Redis-cached, ~free on hit)
        //   - Call-log lookup (only when call gate not bypassed)
        //   - Inventory availability across locations + FIFO batches
        // Each is independent of the others. Previously these ran sequentially
        // and added 2-3 round-trips on a remote DB — combined they now cost a
        // single round-trip wall-time. The result-error checks below run AFTER
        // the parallel fetch, so we still throw the right message.
        const voipPromise = this.settingsService.get('VOIP_ENABLED');
        const inventoryPromise = this.inventoryService.assertGlobalAvailabilityForOrder(order.id);
        const callPromise = bypassCallGate
          ? Promise.resolve(null)
          : hoCsOversightPath
            ? // VOIP-or-not check is settled below — fetch BOTH a 15s+ row and a
              //  any-row in one query (LIMIT 1, ordered by duration desc breaks ties
              //  on startedAt). Cheaper than two separate queries.
              this.db
                .select({
                  startedAt: schema.callLogs.startedAt,
                  durationSeconds: schema.callLogs.durationSeconds,
                })
                .from(schema.callLogs)
                .where(eq(schema.callLogs.orderId, order.id))
                .orderBy(desc(schema.callLogs.startedAt))
                .limit(1)
                .then((rows) => rows[0] ?? null)
            : this.db
                .select({
                  startedAt: schema.callLogs.startedAt,
                  durationSeconds: schema.callLogs.durationSeconds,
                })
                .from(schema.callLogs)
                .where(
                  and(
                    eq(schema.callLogs.orderId, order.id),
                    eq(schema.callLogs.agentId, actor.id),
                  ),
                )
                .orderBy(desc(schema.callLogs.startedAt))
                .limit(1)
                .then((rows) => rows[0] ?? null);

        // Capture inventory rejection reason without throwing immediately so
        // we can report the right error in priority (call gate first).
        const [voipSetting, callRow, inventoryError] = await Promise.all([
          voipPromise,
          callPromise,
          inventoryPromise.then(() => null).catch((err: unknown) => err),
        ]);
        const isVoipEnabled = voipSetting?.['enabled'] === true;

        if (!bypassCallGate) {
          if (hoCsOversightPath) {
            if (isVoipEnabled) {
              if (!callRow || (callRow.durationSeconds ?? 0) < 15) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message:
                    'Cannot confirm: no qualifying VOIP call (≥ 15 seconds) on this order yet. Have a rep complete a call first.',
                });
              }
            } else if (!callRow) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot confirm: no call has been logged on this order yet.',
              });
            }
          } else if (isVoipEnabled) {
            if (!callRow || (callRow.durationSeconds ?? 0) < 15) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Cannot confirm: VOIP call duration must be at least 15 seconds',
              });
            }
          } else if (!callRow) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Cannot confirm: you must click Call before confirming',
            });
          }
        }

        // Re-throw the inventory error after the call gate has cleared.
        if (inventoryError) throw inventoryError;
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

      case 'AGENT_ASSIGNED': {
        if (!metadata?.logisticsLocationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Must specify a logistics location for allocation',
          });
        }
        const locationId = metadata.logisticsLocationId as string;
        if (order.status === 'AGENT_ASSIGNED') {
          if (!order.logisticsLocationId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Order is marked allocated but has no logistics location — contact support.',
            });
          }
          if (order.logisticsLocationId === locationId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Order is already allocated to this logistics location. Pick a different location to reallocate.',
            });
          }
        }
        const isLocked = await this.inventoryService.isDispatchLocked(locationId);
        if (isLocked) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              'Dispatch is locked at this location. Resolve pending stock reconciliations in Returns & Restock to unlock.',
          });
        }
        await this.inventoryService.assertLocationCanFulfillOrder(order.id, locationId);
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
        // 3PL marks delivered independently; proof/cost collected later in delivery remittance
        if (metadata?.deliveryProofUrl && typeof metadata.deliveryProofUrl === 'string' && metadata.deliveryProofUrl.trim() !== '') {
          try {
            new URL(metadata.deliveryProofUrl as string);
          } catch {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Delivery proof must be a valid URL (upload the screenshot first).',
            });
          }
        }
        if (metadata?.deliveryFeeAddOn !== undefined && metadata.deliveryFeeAddOn !== null) {
          const cost = Number(metadata.deliveryFeeAddOn);
          if (Number.isNaN(cost) || cost < 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Delivery cost must be a number greater than or equal to 0.',
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
        if (metadata?.deliveryProofUrl && typeof metadata.deliveryProofUrl === 'string' && metadata.deliveryProofUrl.trim() !== '') {
          try {
            new URL(metadata.deliveryProofUrl as string);
          } catch {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Delivery proof must be a valid URL (upload the screenshot first).',
            });
          }
        }
        if (metadata?.deliveryFeeAddOn !== undefined && metadata.deliveryFeeAddOn !== null) {
          const costPartial = Number(metadata.deliveryFeeAddOn);
          if (Number.isNaN(costPartial) || costPartial < 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Delivery cost must be a number greater than or equal to 0.',
            });
          }
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
  /**
   * Generate a draft invoice for an order on first CONFIRMED transition.
   * Idempotent: checks for an existing invoice tied to the orderId before inserting.
   * Pulls customer info + line items from the order; tax rate/due date stay null
   * (an admin can edit the draft from the Finance page before sending).
   */
  private async autoCreateInvoiceForOrder(
    orderId: string,
    actor: SessionUser,
    preloadedOrder?: typeof schema.orders.$inferSelect,
  ): Promise<void> {
    // Run the idempotency check + items+products fetch in parallel. The
    // caller passes `preloadedOrder` so we skip a re-fetch entirely on the
    // CONFIRM hot path. Worst case (no invoice yet) we pay one RTT for both
    // queries instead of four sequential.
    const [existingRows, items] = await Promise.all([
      this.db
        .select({ id: schema.invoices.id })
        .from(schema.invoices)
        .where(eq(schema.invoices.orderId, orderId))
        .limit(1),
      this.db
        .select({
          quantity: schema.orderItems.quantity,
          unitPrice: schema.orderItems.unitPrice,
          offerLabel: schema.orderItems.offerLabel,
          productName: schema.products.name,
        })
        .from(schema.orderItems)
        .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
        .where(eq(schema.orderItems.orderId, orderId)),
    ]);

    // Idempotent — skip if an invoice already exists. The items fetch above is
    // wasted in this case but it's cheap and only fires on every CONFIRM, and
    // running it in parallel saves a round-trip in the common (first-confirm)
    // path which is the perf-sensitive one.
    if (existingRows[0]) return;

    let ord = preloadedOrder;
    if (!ord) {
      const orderRows = await this.db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);
      ord = orderRows[0];
      if (!ord) return;
    }

    if (items.length === 0) {
      this.logger.warn(`autoCreateInvoiceForOrder: order ${orderId} has no items, skipping`);
      return;
    }

    const lineItems = items.map((it) => ({
      description: `${it.productName ?? 'Product'}${it.offerLabel ? ` (${it.offerLabel})` : ''}`,
      quantity: it.quantity,
      unitPrice: String(it.unitPrice),
    }));

    // unitPrice is the offer/line total — sum directly
    const totalAmount = items.reduce(
      (sum, it) => sum + Number(it.unitPrice),
      0,
    );

    await withActor(this.db, actor, async (tx) => {
      await tx.insert(schema.invoices).values({
        orderId: ord.id,
        recipientInfo: {
          name: ord.customerName,
          address: ord.customerAddress ?? undefined,
        },
        lineItems,
        taxRate: null,
        totalAmount: totalAmount.toFixed(2),
        dueDate: null,
        status: 'DRAFT',
      });
    });
  }

  private async executeTransitionSideEffects(
    newStatus: OrderStatus,
    previousOrder: typeof schema.orders.$inferSelect,
    updatedOrder: typeof schema.orders.$inferSelect,
    actor: SessionUser,
    metadata: TransitionOrderInput['metadata'] | undefined,
  ) {
    const orderItems = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, updatedOrder.id));

    switch (newStatus) {
      case 'CONFIRMED': {
        await withActor(this.db, actor, async (tx) => {
          const movementValues = orderItems.map((item) => ({
            productId: item.productId,
            movementType: 'RESERVATION' as const,
            quantity: item.quantity,
            referenceId: updatedOrder.id,
            reason: `Stock reserved for order ${updatedOrder.id}`,
            actorId: actor.id,
          }));
          if (movementValues.length > 0) {
            await tx.insert(schema.stockMovements).values(movementValues);
          }

          const qtyByProduct = new Map<string, number>();
          for (const item of orderItems) {
            qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
          }

          let totalLandedCost = 0;
          for (const [productId, qty] of qtyByProduct) {
            totalLandedCost += await this.inventoryService.computeFifoLandedCostForQuantityInTx(
              tx,
              productId,
              qty,
            );
          }

          await tx
            .update(schema.orders)
            .set({ landedCost: totalLandedCost.toFixed(2) })
            .where(eq(schema.orders.id, updatedOrder.id));
        });
        break;
      }

      case 'AGENT_ASSIGNED': {
        const locationId =
          updatedOrder.logisticsLocationId ??
          (typeof metadata?.logisticsLocationId === 'string' ? metadata.logisticsLocationId : undefined);
        if (locationId) {
          const prevLoc = previousOrder.logisticsLocationId;
          const isReallocate =
            previousOrder.status === 'AGENT_ASSIGNED' && !!prevLoc && prevLoc !== locationId;
          if (isReallocate) {
            await this.inventoryService.releaseAllocationReserveAtLocation(
              previousOrder.id,
              prevLoc,
              actor,
            );
          }
          await this.inventoryService.reserveForAllocateWithMovements(updatedOrder.id, locationId, actor);

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
              const flatFee = parseFloat(String(rateCard.deliveryFee ?? rateCard.delivery_fee ?? '0'));
              const perItemRate = parseFloat(String(rateCard.perItemRate ?? rateCard.per_item_rate ?? '0'));

              let deliveryFee = flatFee;
              if (perItemRate > 0) {
                const totalQty = orderItems.reduce((sum, item) => sum + item.quantity, 0);
                deliveryFee = perItemRate * totalQty;
              }

              if (deliveryFee > 0) {
                await withActor(this.db, actor, async (tx) => {
                  await tx
                    .update(schema.orders)
                    .set({ deliveryFee: deliveryFee.toFixed(2) })
                    .where(eq(schema.orders.id, updatedOrder.id));
                });
              }
            }
          }
        }
        break;
      }

      case 'DELIVERED': {
        const fulfillmentLocationId = updatedOrder.logisticsLocationId;
        if (!fulfillmentLocationId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot record delivery: order has no fulfillment location (allocate to a Logistics provider first).',
          });
        }
        // The Sales rep can pick a different logistics provider at delivery time (because
        // a different provider may have actually delivered). When that happens, the
        // ALLOCATED reserve still sits at the original location — release it before
        // depleting stock at the actual delivering location, otherwise we'd silently
        // double-count the reserved units (one stuck reserve + one delivery decrement).
        const previouslyAllocatedLocationId = previousOrder.logisticsLocationId;
        if (
          previouslyAllocatedLocationId &&
          previouslyAllocatedLocationId !== fulfillmentLocationId
        ) {
          await this.inventoryService.releaseAllocationReserveAtLocation(
            updatedOrder.id,
            previouslyAllocatedLocationId,
            actor,
          );
        }
        await this.inventoryService.completeDeliveryInventory(
          updatedOrder.id,
          fulfillmentLocationId,
          actor,
        );
        // Safety net: ensure an invoice exists by the time the order is DELIVERED.
        // The primary creation point is the CONFIRMED transition, but it can silently
        // fail (logged, not thrown). Without an invoice the order shows "No invoice"
        // on the delivery-remittance page — this back-fill closes that gap.
        try {
          await this.autoCreateInvoiceForOrder(updatedOrder.id, actor, updatedOrder);
        } catch (err) {
          this.logger.warn(`Auto-invoice backfill on DELIVERED for order ${updatedOrder.id} failed: ${err instanceof Error ? err.message : err}`);
        }
        break;
      }

      case 'CANCELLED':
      case 'DELETED': {
        if (previousOrder.status === 'CONFIRMED') {
          for (const item of orderItems) {
            await this.db.insert(schema.stockMovements).values({
              productId: item.productId,
              movementType: 'ADJUSTMENT',
              quantity: item.quantity,
              referenceId: updatedOrder.id,
              reason: `Released: order ${updatedOrder.id} deleted`,
              actorId: actor.id,
            });
          }
        }
        break;
      }

      case 'RETURNED': {
        for (const item of orderItems) {
          await this.db.insert(schema.stockMovements).values({
            productId: item.productId,
            movementType: 'RETURN',
            quantity: item.quantity,
            toLocationId: updatedOrder.logisticsLocationId ?? undefined,
            referenceId: updatedOrder.id,
            reason: `Returned: order ${updatedOrder.id}`,
            actorId: actor.id,
          });
        }
        break;
      }

      case 'RESTOCKED': {
        for (const item of orderItems) {
          await this.db.insert(schema.stockMovements).values({
            productId: item.productId,
            movementType: 'RESTOCK',
            quantity: item.quantity,
            toLocationId: updatedOrder.logisticsLocationId ?? undefined,
            referenceId: updatedOrder.id,
            reason: `Restocked at logistics company: order ${updatedOrder.id}`,
            actorId: actor.id,
          });
        }
        break;
      }

      case 'WRITTEN_OFF': {
        for (const item of orderItems) {
          await this.db.insert(schema.stockMovements).values({
            productId: item.productId,
            movementType: 'WRITE_OFF',
            quantity: -item.quantity,
            fromLocationId: updatedOrder.logisticsLocationId ?? undefined,
            referenceId: updatedOrder.id,
            reason: `Written off: order ${updatedOrder.id}`,
            actorId: actor.id,
          });

          if (updatedOrder.logisticsLocationId) {
            this.inventoryService.scheduleLowStockCheck(item.productId, updatedOrder.logisticsLocationId);
          }
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
      // Auto-delete: max callback attempts reached (CEO directive 2026-05-23: DELETED replaces CANCELLED)
      await withActor(this.db, actor, async (tx) =>
        tx
          .update(schema.orders)
          .set({
            status: 'DELETED',
            deletedAt: new Date(),
            callbackScheduledAt: null,
            callbackNotes: `Auto-deleted: max callback attempts (${maxAttempts}) reached`,
            updatedAt: new Date(),
          })
          .where(eq(schema.orders.id, orderId)),
      );

      this.events.emitOrderStatusChange({
        orderId,
        oldStatus: order.status,
        newStatus: 'DELETED',
        assignedCsId: order.assignedCsId,
        mediaBuyerId: order.mediaBuyerId,
        logisticsLocationId: order.logisticsLocationId,
        riderId: order.riderId,
        branchId: order.branchId ?? null,
        servicingBranchId: order.servicingBranchId ?? null,
      });

      // Notify Head of CS about max-retry deletion
      this.events.emitToRoom('cs-all', 'callback:max_reached', {
        orderId,
        customerName: order.customerName,
        attempts: currentAttempts,
      }, order.servicingBranchId ?? null);
      void this.writeTimelineEvent({
        orderId,
        eventType: 'ORDER_DELETED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Order deleted after ${currentAttempts} callback attempts`,
        branchId: order.branchId ?? null,
      });

      return { action: 'auto_deleted', attempts: currentAttempts, maxAttempts };
    }

    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000);

    await withActor(this.db, actor, async (tx) =>
      tx
        .update(schema.orders)
        .set({
          callbackScheduledAt: scheduledAt,
          callbackAttempts: currentAttempts + 1,
          callbackNotes: options?.notes ?? null,
          // Preserve the order's current status. Rescheduling a callback is a
          // post-engagement action — the agent already spoke (or tried to) with
          // the customer. Reverting to CS_ASSIGNED erases the engagement event
          // from the audit trail and makes the UI flip-flop. We only release
          // the lock so the agent isn't blocked from working other orders.
          lockedUntil: null,
          lockedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId)),
    );

    // Status didn't change — do NOT emit a status-change event. The callback
    // notification + timeline event below are the right signals.

    // Notify assigned agent about the scheduled callback
    if (order.assignedCsId) {
      const timeLabel = scheduledAt.toLocaleString('en-NG', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      this.notifications.enqueueCreate({
        userId: order.assignedCsId,
        type: 'order:callback_scheduled',
        title: 'Callback scheduled',
        body: `Order ${orderId.slice(0, 8)}... callback scheduled for ${timeLabel}. Attempt ${currentAttempts + 1}/${maxAttempts}.`,
        data: { orderId, scheduledAt: scheduledAt.toISOString() },
      });
    }
    const noteSuffix =
      options?.notes && options.notes.trim().length > 0
        ? ` (${options.notes.trim()})`
        : '';
    void this.writeTimelineEvent({
      orderId,
      eventType: 'CALLBACK_SCHEDULED',
      actorId: actor.id,
      actorName: actor.name ?? null,
      description: `Callback scheduled for ${scheduledAt.toLocaleString('en-NG')}${noteSuffix}`,
      metadata: { scheduledAt: scheduledAt.toISOString(), delayMinutes },
      branchId: order.branchId ?? null,
    });

    return {
      action: 'scheduled',
      scheduledAt: scheduledAt.toISOString(),
      attempt: currentAttempts + 1,
      maxAttempts,
    };
  }

  /**
   * Append a manual CS note to the order timeline (does not change order status).
   */
  async addCsOrderComment(orderId: string, actor: SessionUser, body: { comment: string }) {
    const trimmed = body.comment.trim();
    if (trimmed.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Comment cannot be empty' });
    }
    if (trimmed.length > 2000) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Comment must be at most 2000 characters' });
    }

    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    await this.assertActorMayUpdateOrder(actor, {
      branchId: order.branchId ?? null,
      assignedCsId: order.assignedCsId ?? null,
      status: order.status,
    });

    const description = `Comment: ${trimmed}`;

    await withActor(this.db, actor, async (tx) => {
      await tx.insert(schema.orderTimelineEvents).values({
        orderId,
        eventType: 'CS_ORDER_COMMENT',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description,
        metadata: { source: 'cs_manual', commentBody: trimmed },
        branchId: order.branchId ?? null,
      });
    });

    return { success: true as const };
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
            eq(schema.orders.status, 'CS_ASSIGNED'),
            eq(schema.orders.status, 'CS_ENGAGED'),
          ),
        ),
      )
      .orderBy(asc(schema.orders.callbackScheduledAt));

    return orders.map((order) => {
      const { customerPhone, ...rest } = order;
      return {
        ...rest,
        customerPhoneDisplay: formatOrderCustomerPhoneDisplay(customerPhone, order.customerPhoneHash),
      };
    });
  }

  /**
   * Get all orders with scheduled callbacks (including future ones).
   */
  async getScheduledCallbacks(branchId?: string | null, effectiveBranchIds?: string[] | null) {
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    const orders = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          sql`${schema.orders.callbackScheduledAt} IS NOT NULL`,
          sql`${schema.orders.callbackAttempts} > 0`,
          or(
            eq(schema.orders.status, 'UNPROCESSED'),
            eq(schema.orders.status, 'CS_ASSIGNED'),
            eq(schema.orders.status, 'CS_ENGAGED'),
          ),
          ...(bCond ? [bCond] : []),
        ),
      )
      .orderBy(asc(schema.orders.callbackScheduledAt));

    return orders.map((order) => {
      const { customerPhone, ...rest } = order;
      return {
        ...rest,
        customerPhoneDisplay: formatOrderCustomerPhoneDisplay(customerPhone, order.customerPhoneHash),
      };
    });
  }

  /**
   * Cron: every 2 minutes, check for callbacks that are due and notify the assigned Sales closer.
   * Max 3 reminders per callback schedule — after 3 the callback is auto-cleared.
   */
  @Cron('0 */2 * * * *')
  async handleDueCallbacks(): Promise<void> {
    const MAX_REMINDERS = 3;
    try {
      const dueOrders = await this.getCallbackQueue();
      for (const order of dueOrders) {
        if (!order.assignedCsId) continue;

        // Track how many reminders have been sent for this callback schedule.
        // Key resets when a new callback is scheduled (callbackAttempts changes).
        const counterKey = `callback_reminders:${order.id}:${order.callbackAttempts ?? 0}`;
        const sent = Number(await this.redis.get(counterKey) ?? 0);

        if (sent >= MAX_REMINDERS) {
          // Max reminders reached — clear the callback so cron stops picking it up.
          await this.db
            .update(schema.orders)
            .set({ callbackScheduledAt: null })
            .where(eq(schema.orders.id, order.id));
          await this.redis.del(counterKey);
          continue;
        }

        // Reminder gap scales with the original callback delay:
        // gap = delay / 3, floored at 5 min, capped at 30 min.
        // e.g. 10-min callback → reminders every ~3 min; 2-hr callback → every 30 min.
        const callbackDue = order.callbackScheduledAt ? new Date(order.callbackScheduledAt).getTime() : 0;
        const updatedMs = order.updatedAt ? new Date(order.updatedAt).getTime() : callbackDue;
        const originalDelayMs = Math.max(callbackDue - updatedMs, 0);
        const gapSeconds = Math.max(300, Math.min(1800, Math.round(originalDelayMs / 3 / 1000)));

        const dedupKey = `callback_notified:${order.id}:${order.callbackAttempts ?? 0}`;
        const alreadyNotified = await this.redis.get(dedupKey);
        if (alreadyNotified) continue;

        await this.redis.set(dedupKey, '1', 'EX', gapSeconds);
        await this.redis.incr(counterKey);
        // Expire counter after 24h as a safety net
        await this.redis.expire(counterKey, 86400);

        const reminderNum = sent + 1;
        this.notifications.enqueueCreate({
          userId: order.assignedCsId,
          type: 'order:callback_due',
          title: 'Callback due now',
          body: `Order ${order.id.slice(0, 8)}… is due for a callback (reminder ${reminderNum}/${MAX_REMINDERS}).`,
          data: { orderId: order.id },
        });

        // Also push to the CS room so the queue tab refreshes
        this.events.emitToRoom('cs-all', 'order:callback_due', { orderId: order.id }, order.servicingBranchId ?? null);
      }
    } catch {
      // Cron failure is non-fatal — will retry in 2 minutes
    }
  }

  // ============================================
  // Duplicate Order Merge/Dismiss
  // ============================================

  /**
   * Flag an order as a potential duplicate of another order.
   */
  async flagDuplicate(orderId: string, duplicateOfId: string, actorId: string) {
    await withActor(this.db, { id: actorId }, async (tx) =>
      tx
        .update(schema.orders)
        .set({
          isDuplicate: 'FLAGGED',
          duplicateOfId,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId)),
    );

    return { flagged: true };
  }

  /**
   * Get all flagged duplicate orders for review.
   *
   * Batched lookup: previously this issued one `SELECT` per flagged row to fetch its
   * original (`duplicate_of_id`). Now we collect distinct non-null original ids and
   * pull them in a single `WHERE id IN (...)` query, then merge in memory. Saves
   * (N − 1) round-trips on the remote DB.
   */
  /**
   * Return raw customer phones for a legitimate duplicate pair so the comparison
   * modal can show them side-by-side. Validates that the two IDs form an actual
   * FLAGGED/POSSIBLY_DUPLICATE relationship — prevents abuse as an arbitrary
   * phone lookup. Permission gate is at the tRPC layer.
   */
  async getDuplicateComparisonPhones(
    orderId: string,
    originalOrderId: string,
  ): Promise<{ orderPhone: string; originalPhone: string }> {
    const rows = await this.db
      .select({
        id: schema.orders.id,
        customerPhone: schema.orders.customerPhone,
        customerPhoneHash: schema.orders.customerPhoneHash,
        isDuplicate: schema.orders.isDuplicate,
        duplicateOfId: schema.orders.duplicateOfId,
      })
      .from(schema.orders)
      .where(inArray(schema.orders.id, [orderId, originalOrderId]));

    const dupRow = rows.find((r) => r.id === orderId);
    const origRow = rows.find((r) => r.id === originalOrderId);

    // Validate this is a legitimate pair
    if (
      !dupRow ||
      !origRow ||
      !['FLAGGED', 'POSSIBLY_DUPLICATE'].includes(dupRow.isDuplicate ?? '') ||
      dupRow.duplicateOfId !== originalOrderId
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid duplicate pair — cannot retrieve comparison phones.',
      });
    }

    const resolve = (phone: string | null, hash: string | null) => {
      if (phone?.trim()) return phone.trim();
      if (hash && !/^[a-f0-9]{64}$/i.test(hash)) return hash;
      return 'Hidden';
    };

    return {
      orderPhone: resolve(dupRow.customerPhone, dupRow.customerPhoneHash),
      originalPhone: resolve(origRow.customerPhone, origRow.customerPhoneHash),
    };
  }

  async getFlaggedDuplicates(branchId?: string | null, effectiveBranchIds?: string[] | null) {
    const bCond = branchScopeCondition(schema.orders.servicingBranchId, branchId, effectiveBranchIds);
    const flagged = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          inArray(schema.orders.isDuplicate, ['FLAGGED', 'POSSIBLY_DUPLICATE']),
          ...(bCond ? [bCond] : []),
        ),
      )
      .orderBy(desc(schema.orders.createdAt));

    if (flagged.length === 0) return [];

    const originalIds = [...new Set(flagged.map((d) => d.duplicateOfId).filter(Boolean))] as string[];
    const originalById = new Map<string, (typeof flagged)[number]>();
    if (originalIds.length > 0) {
      const originalRows = await this.db
        .select()
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.id, originalIds),
            ...(branchId ? [eq(schema.orders.servicingBranchId, branchId)] : []),
          ),
        );
      for (const row of originalRows) originalById.set(row.id, row);
    }

    return flagged.map((dup) => {
      const origRow = dup.duplicateOfId ? originalById.get(dup.duplicateOfId) ?? null : null;
      const original = (() => {
        if (!origRow) return null;
        const { customerPhone, ...o } = origRow;
        return {
          ...o,
          customerPhoneDisplay: formatOrderCustomerPhoneDisplay(customerPhone, origRow.customerPhoneHash),
        };
      })();
      const { customerPhone: dupPhone, ...dupRest } = dup;
      return {
        duplicate: {
          ...dupRest,
          customerPhoneDisplay: formatOrderCustomerPhoneDisplay(dupPhone, dup.customerPhoneHash),
        },
        original,
        flagKind: (dup.isDuplicate === 'POSSIBLY_DUPLICATE' ? 'POSSIBLY_DUPLICATE' : 'FLAGGED') as
          | 'FLAGGED'
          | 'POSSIBLY_DUPLICATE',
      };
    });
  }

  /**
   * Merge a duplicate order into the original (combine quantities).
   */
  async mergeDuplicate(duplicateId: string, originalId: string, actor: SessionUser) {
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

    await withActor(this.db, actor, async (tx) => {
      // Merge quantities: for matching products add quantities, for new products add items
      for (const dupItem of dupItems) {
        const matchingOrig = origItems.find((oi) => oi.productId === dupItem.productId);
        if (matchingOrig) {
          // Add quantities
          await tx
            .update(schema.orderItems)
            .set({ quantity: matchingOrig.quantity + dupItem.quantity })
            .where(eq(schema.orderItems.id, matchingOrig.id));
        } else {
          // Add new item to original order
          await tx.insert(schema.orderItems).values({
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
      await tx
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
      await tx
        .update(schema.orders)
        .set({
          isDuplicate: 'MERGED',
          duplicateOfId: originalId,
          status: 'CANCELLED',
          deliveryNotes: `Merged into order ${originalId}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, duplicateId));
    });

    this.events.emitToRoom('cs-all', 'cs:duplicates_changed', {}, actor.currentBranchId ?? null);
    return { merged: true, originalId, duplicateId };
  }

  /**
   * Dismiss a flagged duplicate — mark as legitimate new order.
   */
  async dismissDuplicate(orderId: string, actor: SessionUser) {
    await withActor(this.db, actor, async (tx) =>
      tx
        .update(schema.orders)
        .set({
          isDuplicate: 'DISMISSED',
          duplicateOfId: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId)),
    );

    this.events.emitToRoom('cs-all', 'cs:duplicates_changed', {}, actor.currentBranchId ?? null);
    return { dismissed: true };
  }

  /**
   * Detect potential duplicates for a new order.
   * Checks for orders with the same phone hash + product within 24 hours.
   */
  async detectDuplicates(phoneHash: string, productIds: string[]) {
    if (productIds.length === 0) return [];
    const potential = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerPhoneHash, phoneHash),
          exists(
            this.db
              .select({ one: sql`1` })
              .from(schema.orderItems)
              .where(
                and(
                  eq(schema.orderItems.orderId, schema.orders.id),
                  inArray(schema.orderItems.productId, productIds),
                ),
              ),
          ),
          sql`${schema.orders.createdAt} >= NOW() - INTERVAL '24 hours'`,
          sql`${schema.orders.isDuplicate} IS NULL OR ${schema.orders.isDuplicate} = 'DISMISSED'`,
          sql`${schema.orders.status} != 'CANCELLED'`,
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(5);

    return potential.map((order) => {
      const { customerPhone, ...rest } = order;
      return {
        ...rest,
        customerPhoneDisplay: formatOrderCustomerPhoneDisplay(customerPhone, order.customerPhoneHash),
      };
    });
  }


  /**
   * Record one `cross_funnel_attempts` row per product when the new order
   * collides with a prior different-MB winner. Idempotency is not guaranteed
   * by the table (no unique index) — callers gate via `findCrossFunnelCandidates`.
   *
   * Insert failures are logged at `error` level (not swallowed) — these rows
   * are the audit trail for Pillar 2 / attribution truth, and a silent drop
   * is exactly what masked the 2026-05-24 incident.
   */

  /**
   * Universal 7-day dedup: same phone + any overlapping product within 7 days.
   * Ignores MB, campaign, offer label, quantity — pure phone×product match.
   * Winner: highest lifecycle status, ties → oldest createdAt.
   */
  private async findExistingOrderForDedup(
    phoneHash: string,
    productIds: string[],
  ): Promise<{ id: string; mediaBuyerId: string | null; status: string; createdAt: Date } | null> {
    if (!phoneHash || productIds.length === 0) return null;

    // Use Drizzle query builder (not raw SQL) for reliable parameter binding.
    // Step 1: find orders with same phone hash in last 7 days (index-backed, fast).
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const candidates = await this.db
      .select({
        id: schema.orders.id,
        mediaBuyerId: schema.orders.mediaBuyerId,
        status: schema.orders.status,
        createdAt: schema.orders.createdAt,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerPhoneHash, phoneHash),
          gte(schema.orders.createdAt, sevenDaysAgo),
          notInArray(schema.orders.status, ['CANCELLED', 'DELETED']),
          isNull(schema.orders.deletedAt),
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(20);

    if (candidates.length === 0) return null;

    // Step 2: check which candidates have overlapping products.
    const candidateIds = candidates.map((c) => c.id);
    const matchingItems = await this.db
      .select({ orderId: schema.orderItems.orderId })
      .from(schema.orderItems)
      .where(
        and(
          inArray(schema.orderItems.orderId, candidateIds),
          inArray(schema.orderItems.productId, productIds),
        ),
      )
      .limit(1);

    if (matchingItems.length === 0) return null;

    // Step 3: pick the winner — the candidate whose order ID matched.
    // Since candidates are sorted by createdAt DESC, find the best one
    // (highest lifecycle status, then oldest).
    const matchingOrderIds = new Set(matchingItems.map((m) => m.orderId));
    const STATUS_RANK: Record<string, number> = {
      REMITTED: 10, DELIVERED: 9, PARTIALLY_DELIVERED: 8, IN_TRANSIT: 7,
      DISPATCHED: 6, AGENT_ASSIGNED: 5, CONFIRMED: 4, CS_ENGAGED: 3,
      CS_ASSIGNED: 2, UNPROCESSED: 1,
    };
    const matches = candidates
      .filter((c) => matchingOrderIds.has(c.id))
      .sort((a, b) => {
        const rankDiff = (STATUS_RANK[b.status] ?? 0) - (STATUS_RANK[a.status] ?? 0);
        if (rankDiff !== 0) return rankDiff;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });

    const winner = matches[0];
    if (!winner) return null;
    return {
      id: winner.id,
      mediaBuyerId: winner.mediaBuyerId,
      status: winner.status,
      createdAt: winner.createdAt,
    };
  }

  private async recordCrossFunnelAttempt(args: {
    customerPhoneHash: string;
    customerPhone: string | null;
    customerName: string;
    productIds: string[];
    mediaBuyerId: string;
    campaignId: string | null;
    branchId: string | null;
    winner: { id: string; mediaBuyerId: string };
  }): Promise<void> {
    try {
      await this.db.insert(schema.crossFunnelAttempts).values(
        args.productIds.map((productId) => ({
          customerPhoneHash: args.customerPhoneHash,
          customerPhone: args.customerPhone,
          customerName: args.customerName,
          productId,
          mediaBuyerId: args.mediaBuyerId,
          campaignId: args.campaignId,
          branchId: args.branchId,
          originalOrderId: args.winner.id,
          originalMediaBuyerId: args.winner.mediaBuyerId,
        })),
      );
      // Info log so monitoring can verify detection is firing without waiting
      // for someone to open the cross-funnel UI.
      this.logger.log(
        {
          runnerUpMbId: args.mediaBuyerId,
          winnerMbId: args.winner.mediaBuyerId,
          winnerOrderId: args.winner.id,
          productCount: args.productIds.length,
        },
        'cross-funnel attempt recorded',
      );
    } catch (err) {
      this.logger.error(
        {
          err,
          phoneHash: args.customerPhoneHash,
          runnerUpMbId: args.mediaBuyerId,
          winnerMbId: args.winner.mediaBuyerId,
          winnerOrderId: args.winner.id,
        },
        'cross-funnel attempt insert FAILED — runner-up not recorded',
      );
    }
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
   * Bulk assign multiple orders to one or more Sales closers.
   * - One agent: every order goes to that agent (same as before).
   * - Multiple agents: each order is assigned to a uniformly random pick from the list.
   */
  async bulkAssignToCS(
    orderIds: string[],
    csCloserIds: string[],
    actor: SessionUser,
  ) {
    const agents = [...new Set(csCloserIds)].filter(Boolean);
    if (agents.length === 0) {
      throw new Error('At least one closer is required');
    }

    const results: Array<{
      orderId: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const orderId of orderIds) {
      try {
        const idx = Math.floor(Math.random() * agents.length);
        await this.assignToCS(orderId, agents[idx]!, actor);
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
   * Build a meaningful notification body for "order assigned to you" pings — replaces
   * the legacy "An order has been assigned to you. Please attend to it." stub. Includes
   * customer name + amount so the Sales rep can prioritise without opening the order.
   */
  private formatAssignedOrderBody(input: {
    customerName: string | null;
    totalAmount: string | number | null;
    branchName?: string | null;
  }): string {
    const parts: string[] = [];
    const name = input.customerName?.trim();
    if (name) parts.push(name);
    const amt =
      typeof input.totalAmount === 'string'
        ? Number(input.totalAmount)
        : input.totalAmount;
    if (typeof amt === 'number' && Number.isFinite(amt) && amt > 0) {
      parts.push(`₦${Math.round(amt).toLocaleString('en-NG')}`);
    }
    if (input.branchName?.trim()) parts.push(input.branchName.trim());
    if (parts.length === 0) {
      return 'A new order is in your queue. Tap to call the customer.';
    }
    return `${parts.join(' • ')} — tap to call the customer.`;
  }

  /**
   * Get the order timeline for a specific order, filtered by the actor's role.
   * CS roles see: ORDER_RECEIVED, ORDER_AUTO_ASSIGNED, ORDER_MANUALLY_ASSIGNED, ORDER_REASSIGNED,
   *   ORDER_CLAIMED, CALL_INITIATED, CALL_COMPLETED, CALL_NO_ANSWER, CALL_FAILED,
   *   MANUAL_CALL_LOGGED, SMS_SENT, WHATSAPP_SENT, ORDER_CONFIRMED, ORDER_CANCELLED,
   *   ADDRESS_UPDATED, QUANTITY_UPDATED, CALLBACK_SCHEDULED, SUPERVISOR_WATCHING,
   *   CS_ORDER_COMMENT.
   * Logistics roles see: ORDER_ALLOCATED, ORDER_DISPATCHED, ORDER_IN_TRANSIT, ORDER_DELIVERED,
   *   ORDER_PARTIALLY_DELIVERED, ORDER_RETURNED, ORDER_RESTOCKED, ORDER_WRITTEN_OFF.
   * Marketing/Finance/SuperAdmin see all events.
   */
  async getOrderTimeline(orderId: string, actor: SessionUser) {
    const CS_EVENTS = new Set([
      'ORDER_RECEIVED', 'ORDER_AUTO_ASSIGNED', 'ORDER_MANUALLY_ASSIGNED', 'ORDER_REASSIGNED',
      'ORDER_CLAIMED', 'ORDER_VIEWED', 'CALL_INITIATED', 'CALL_COMPLETED', 'CALL_NO_ANSWER',
      'CALL_FAILED', 'MANUAL_CALL_LOGGED', 'SMS_SENT', 'WHATSAPP_SENT', 'ORDER_CONFIRMED',
      'ORDER_CANCELLED', 'ADDRESS_UPDATED', 'QUANTITY_UPDATED', 'CALLBACK_SCHEDULED',
      'SUPERVISOR_WATCHING', 'PAYMENT_RECEIVED', 'ORDER_ARCHIVED',
      'LINE_PRICE_CHANGE_REQUESTED', 'LINE_PRICE_CHANGE_APPROVED', 'LINE_PRICE_CHANGE_REJECTED',
      'CS_ORDER_COMMENT',
    ]);
    const LOGISTICS_EVENTS = new Set([
      'ORDER_ALLOCATED', 'ORDER_DISPATCHED', 'ORDER_IN_TRANSIT', 'ORDER_DELIVERED',
      'ORDER_PARTIALLY_DELIVERED', 'ORDER_RETURNED', 'ORDER_RESTOCKED', 'ORDER_WRITTEN_OFF',
      'ORDER_ARCHIVED',
    ]);

    // Match the same visibility rules as `orders.getById` (which is what the
    // order detail page itself uses). Relying on RLS alone here caused a
    // confusing "No timeline events yet" empty state for branch-scoped users
    // when `order_timeline_events.branch_id` (or the synthetic ORDER_RECEIVED)
    // didn't match their active branch session.
    let order: Awaited<ReturnType<typeof this.getById>>;
    try {
      order = await this.getById(orderId);
    } catch {
      // Fallback: the ID may be a follow-up order — return its timeline from
      // the follow_up_order_timeline_events table instead.
      const fuRows = await this.db
        .select()
        .from(schema.followUpOrderTimelineEvents)
        .where(eq(schema.followUpOrderTimelineEvents.followUpOrderId, orderId))
        .orderBy(asc(schema.followUpOrderTimelineEvents.createdAt));
      const isCloser = actor.role === 'CS_CLOSER';
      return fuRows.map((r) => ({
        ...r,
        orderId,
        actorName: r.actorName ?? null,
        // Closers see a generic message — no source order reference
        ...(isCloser && r.eventType === 'ORDER_RECEIVED' ? {
          description: 'Order received for follow-up.',
          metadata: null,
        } : {}),
      }));
    }
    this.assertActorMayViewOrderForRead(actor, order);

    // CS_CLOSER viewing a follow-up order sees it as a fresh order — no prior history.
    // HoCS / Admin / SuperAdmin still see the full timeline.
    if (actor.role === 'CS_CLOSER' && order.isFollowUp) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(schema.orderTimelineEvents)
      .where(eq(schema.orderTimelineEvents.orderId, orderId))
      .orderBy(asc(schema.orderTimelineEvents.createdAt));

    const hasOrderReceived = rows.some((r) => r.eventType === 'ORDER_RECEIVED');
    let mergedRows = rows;
    if (!hasOrderReceived) {
      // Use the already-authorized order row as the source of truth.
      // Important: `order_timeline_events` is branch-scoped, so stamp the
      // synthetic ORDER_RECEIVED with the order's branchId (not null) to keep it
      // visible under branch-scoped RLS.
      const ord = {
        id: order.id,
        createdAt: order.createdAt,
        orderSource: order.orderSource,
        mediaBuyerId: order.mediaBuyerId,
        assignedCsId: order.assignedCsId,
        branchId: order.branchId ?? null,
      };
      {
        const [mediaBuyerName, assignedCsName] = await Promise.all([
          ord.mediaBuyerId ? this.resolveUserNameById(ord.mediaBuyerId) : Promise.resolve(null),
          ord.orderSource === 'offline' && ord.assignedCsId
            ? this.resolveUserNameById(ord.assignedCsId)
            : Promise.resolve(null),
        ]);
        const mbSuffix = mediaBuyerName ? ` — attributed to media buyer ${mediaBuyerName}` : '';
        const synthetic =
          ord.orderSource === 'offline'
            ? ({
                id: `derived:${ord.id}:order_received`,
                orderId: ord.id,
                eventType: 'ORDER_RECEIVED' as const,
                actorId: ord.assignedCsId,
                actorName: assignedCsName,
                description: `Offline order created${mbSuffix}`,
                metadata: {
                  derivedFromOrderRow: true,
                  ...(mediaBuyerName && ord.mediaBuyerId
                    ? { mediaBuyerId: ord.mediaBuyerId, mediaBuyerName }
                    : {}),
                },
                branchId: ord.branchId,
                createdAt: ord.createdAt,
              } satisfies (typeof rows)[number])
            : ({
                id: `derived:${ord.id}:order_received`,
                orderId: ord.id,
                eventType: 'ORDER_RECEIVED' as const,
                actorId: EDGE_FORM_ACTOR_ID,
                actorName: 'Edge form',
                description: `Order received from sales form${mbSuffix}`,
                metadata: {
                  derivedFromOrderRow: true,
                  ...(mediaBuyerName && ord.mediaBuyerId
                    ? { mediaBuyerId: ord.mediaBuyerId, mediaBuyerName }
                    : {}),
                },
                branchId: ord.branchId,
                createdAt: ord.createdAt,
              } satisfies (typeof rows)[number]);
        mergedRows = [...rows, synthetic].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      }
    }

    // Permission-based filtering. Anyone with broad audit access sees everything;
    // CS-scope actors and logistics-scope actors see CS+logistics events; marketing
    // sees lifecycle events but not supervisor mirror events.
    const eventPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasEventPerm = (code: string) =>
      actor.role === 'SUPER_ADMIN' || eventPerms.includes(canonicalPermissionCode(code));
    const seesAll =
      actor.role === 'SUPER_ADMIN' ||
      hasEventPerm('audit.read') ||
      hasEventPerm('finance.read') ||
      hasEventPerm('hr.read');
    const seesCsAndLogistics =
      hasEventPerm('cs.scope.global') ||
      hasEventPerm('logistics.scope.global') ||
      hasEventPerm('cs.leaderboard') ||
      hasEventPerm('logistics.read') ||
      actor.role === 'CS_CLOSER';

    return mergedRows.filter((row) => {
      const eventType = row.eventType as string;
      if (seesAll) return true;
      if (seesCsAndLogistics) {
        return CS_EVENTS.has(eventType) || LOGISTICS_EVENTS.has(eventType);
      }
      // Marketing and other roles — see order lifecycle but not supervisor events
      return eventType !== 'SUPERVISOR_WATCHING';
    });
  }

  private async resolveUserNameById(userId: string): Promise<string | null> {
    const row = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row[0]?.name ?? null;
  }

  /**
   * Append an event to the order_timeline_events table.
   * Best-effort — never throws so it does not interrupt the calling flow.
   *
   * Critical: `order_timeline_events` is branch-scoped. Always persist `branchId` so the
   * timeline remains visible under RLS when the viewer has a branch session selected.
   */
  async writeTimelineEvent(params: {
    orderId: string;
    eventType: string;
    actorId?: string | null;
    actorName?: string | null;
    description: string;
    metadata?: Record<string, unknown>;
    branchId?: string | null;
  }): Promise<void> {
    const actorId = params.actorId ?? EDGE_FORM_ACTOR_ID;
    const branchId = params.branchId ?? null;

    // We open a tiny transaction so we can reliably set both session variables
    // on the same pinned connection for branch-scoped insert policies.
    await withActorAndBranch(
      this.db,
      { id: actorId, currentBranchId: branchId },
      async (tx) => {
        await tx.insert(schema.orderTimelineEvents).values({
          orderId: params.orderId,
          eventType: params.eventType as (typeof schema.orderTimelineEvents.$inferInsert)['eventType'],
          actorId: params.actorId ?? null,
          actorName: params.actorName ?? null,
          description: params.description,
          metadata: params.metadata ?? null,
          branchId,
        });
      },
    ).catch(() => {});
  }

  private buildTransitionActivityDescription(
    newStatus: string,
    options?: {
      reason?: string;
      preferredDeliveryDate?: string;
      logisticsLocationName?: string;
      /** Provider (3PL company) that owns `logisticsLocationName`. When present the
       *  timeline reads "Agent assigned for delivery at Ikeja (GIG Logistics)". */
      logisticsProviderName?: string;
      reallocatedFromName?: string;
      reallocatedFromProviderName?: string;
      /** What action triggered the CS_ENGAGED transition — drives a precise timeline line
       *  ("revealed phone for manual call" vs "started VOIP call" vs generic). */
      engagementMethod?: string;
    },
  ): string {
    const reasonSuffix = options?.reason ? ` (${options.reason})` : '';
    switch (newStatus) {
      case 'CS_ENGAGED':
        switch (options?.engagementMethod) {
          case 'phone_revealed':
            return 'CS revealed and copied the customer phone for a manual call';
          case 'voip_call_started':
            return 'CS started a VOIP call to the customer';
          case 'manual_call_logged':
            return 'CS logged a manual call to the customer';
          default:
            return 'CS started customer engagement';
        }
      case 'CONFIRMED':
        return options?.preferredDeliveryDate
          ? `Order confirmed for delivery on ${options.preferredDeliveryDate}`
          : 'Order confirmed';
      case 'CANCELLED':
        return `Order cancelled${reasonSuffix}`;
      case 'DELETED':
        return `Order deleted${reasonSuffix}`;
      case 'UNPROCESSED':
        return 'Order restored to the unprocessed queue';
      case 'AGENT_ASSIGNED': {
        // Render "Location (Provider)" when both are known so a reader sees the
        // 3PL company name, not just the warehouse / pickup point. CEO directive
        // 2026-05-24 — provider was previously invisible on the timeline.
        const formatLocation = (loc?: string, provider?: string) =>
          loc && provider ? `${loc} (${provider})` : loc ?? '';
        if (options?.reallocatedFromName && options?.logisticsLocationName) {
          const from = formatLocation(options.reallocatedFromName, options.reallocatedFromProviderName);
          const to = formatLocation(options.logisticsLocationName, options.logisticsProviderName);
          return `Delivery assignment moved from ${from} to ${to}`;
        }
        if (options?.logisticsLocationName) {
          return `Agent assigned for delivery at ${formatLocation(options.logisticsLocationName, options.logisticsProviderName)}`;
        }
        return 'Agent assigned for delivery (logistics)';
      }
      case 'DISPATCHED':
        return 'Order dispatched to rider';
      case 'IN_TRANSIT':
        return 'Order marked in transit';
      case 'DELIVERED':
        return 'Order marked delivered';
      case 'PARTIALLY_DELIVERED':
        return 'Order marked partially delivered';
      case 'RETURNED':
        return `Order marked returned${reasonSuffix}`;
      case 'RESTOCKED':
        return 'Returned order restocked';
      case 'WRITTEN_OFF':
        return `Order written off${reasonSuffix}`;
      default:
        return `Order moved to ${newStatus.replace(/_/g, ' ').toLowerCase()}`;
    }
  }

  /**
   * Get per-branch order and revenue breakdown for the CEO dashboard.
   * SuperAdmin only — bypasses RLS, queries all branches directly.
   * Returns branches sorted by total orders descending.
   *
   * `branchScope` picks which column drives the grouping:
   *   - `'marketing'` (default) → `orders.branch_id` (campaign / form attribution)
   *   - `'servicing'`           → `orders.servicing_branch_id` (CS team that worked the order)
   *
   * Same order can land in two different rows depending on the scope (e.g. funnel
   * branded to Lagos but CS-routed to Abuja). The split exists because migration
   * 0150 separated attribution from servicing — see `cs_routing_sets_branch` memory.
   */
  async getBranchBreakdown(
    startDate?: string,
    endDate?: string,
    branchScope: 'marketing' | 'servicing' = 'marketing',
    effectiveBranchIds?: string[] | null,
  ): Promise<Array<{
    branchId: string;
    branchName: string;
    branchCode: string;
    totalOrders: number;
    deliveredOrders: number;
    activeOrders: number;
  }>> {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt), eq(schema.orders.isFollowUp, false)];
    if (startDate) conditions.push(gte(schema.orders.createdAt, nigeriaDayStart(startDate)));
    if (endDate) conditions.push(lte(schema.orders.createdAt, nigeriaDayEnd(endDate)));

    const branchJoinColumn =
      branchScope === 'servicing' ? schema.orders.servicingBranchId : schema.orders.branchId;

    // Scope to the active branch group when set
    const bCond = branchScopeCondition(branchJoinColumn, null, effectiveBranchIds);
    if (bCond) conditions.push(bCond);

    const whereClause = and(...conditions);

    // Join orders with branches to get per-branch counts. Scope determines whether
    // we group by marketing branch (attribution) or servicing branch (CS work).
    const rows = await this.db
      .select({
        branchId: schema.branches.id,
        branchName: schema.branches.name,
        branchCode: schema.branches.code,
        status: schema.orders.status,
        orderCount: count(),
      })
      .from(schema.orders)
      .innerJoin(schema.branches, eq(branchJoinColumn, schema.branches.id))
      .where(whereClause)
      .groupBy(schema.branches.id, schema.branches.name, schema.branches.code, schema.orders.status);

    // Aggregate counts per branch
    const byBranch = new Map<string, {
      branchId: string;
      branchName: string;
      branchCode: string;
      totalOrders: number;
      deliveredOrders: number;
      activeOrders: number;
    }>();

    const ACTIVE_STATUSES = new Set(['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT']);

    for (const row of rows) {
      let entry = byBranch.get(row.branchId);
      if (!entry) {
        entry = { branchId: row.branchId, branchName: row.branchName, branchCode: row.branchCode, totalOrders: 0, deliveredOrders: 0, activeOrders: 0 };
        byBranch.set(row.branchId, entry);
      }
      entry.totalOrders += row.orderCount;
      if (row.status === 'DELIVERED' || row.status === 'REMITTED') {
        entry.deliveredOrders += row.orderCount;
      }
      if (ACTIVE_STATUSES.has(row.status)) entry.activeOrders += row.orderCount;
    }

    return Array.from(byBranch.values()).sort((a, b) => b.totalOrders - a.totalOrders);
  }

  /**
   * Move orders to a different branch. Resets status to UNPROCESSED, clears CS
   * assignment. MB credit preserved. Timeline history stays intact.
   * Used by HoCS/Admin for inter-branch routing.
   */
  async moveOrdersToBranch(
    orderIds: string[],
    targetBranchId: string,
    actor: SessionUser,
    opts?: { clearMediaBuyer?: boolean },
  ) {
    const results: Array<{ orderId: string; success: boolean; error?: string }> = [];

    // Resolve target branch name for timeline descriptions
    const [targetBranch] = await this.db
      .select({ name: schema.branches.name })
      .from(schema.branches)
      .where(eq(schema.branches.id, targetBranchId))
      .limit(1);
    const targetBranchName = targetBranch?.name ?? 'unknown branch';

    for (const orderId of orderIds) {
      try {
        const [order] = await this.db
          .select({
            id: schema.orders.id,
            servicingBranchId: schema.orders.servicingBranchId,
            status: schema.orders.status,
          })
          .from(schema.orders)
          .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
          .limit(1);

        if (!order) {
          results.push({ orderId, success: false, error: 'Order not found' });
          continue;
        }

        // Inter-branch CS routing moves the *servicing* branch only — marketing
        // attribution (`branch_id` + media buyer credit) is preserved. Migration 0150.
        // CEO directive 2026-05-25: preserve status and records on branch transfer.
        // Only clear CS assignment for pre-confirmation statuses (closer belongs to old branch).
        const preConfirmStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'];
        const isPreConfirm = preConfirmStatuses.includes(order.status as string);
        const updateFields: Record<string, unknown> = {
          servicingBranchId: targetBranchId,
          updatedAt: new Date(),
        };
        // Pre-confirmation: reset to UNPROCESSED + clear CS so the new branch pool picks it up.
        // Post-confirmation: keep status + assignment intact — order has progressed past CS.
        if (isPreConfirm) {
          updateFields.status = 'UNPROCESSED';
          updateFields.assignedCsId = null;
        }
        if (opts?.clearMediaBuyer) {
          updateFields.mediaBuyerId = null;
        }

        await withActorAndBranch(
          this.db,
          { id: actor.id, currentBranchId: targetBranchId },
          async (tx) => {
            await tx
              .update(schema.orders)
              .set(updateFields)
              .where(eq(schema.orders.id, orderId));
          },
        );

        const eventType = opts?.clearMediaBuyer ? 'FOLLOW_UP_REASSIGNED' : 'BRANCH_MOVED';
        const actorDisplay = actor.name ?? 'unknown';
        const description = opts?.clearMediaBuyer
          ? `Order reassigned for follow-up by ${actorDisplay}. Previous status: ${order.status}.`
          : isPreConfirm
            ? `Transferred to ${targetBranchName} by ${actorDisplay}. Status reset to Unprocessed.`
            : `Transferred to ${targetBranchName} by ${actorDisplay}. Status preserved: ${order.status}.`;

        await this.writeTimelineEvent({
          orderId,
          eventType: eventType as 'STATUS_CHANGED',
          actorId: actor.id,
          actorName: actor.name ?? null,
          description,
          metadata: {
            previousServicingBranchId: order.servicingBranchId,
            targetServicingBranchId: targetBranchId,
            previousStatus: order.status,
            clearMediaBuyer: opts?.clearMediaBuyer ?? false,
          },
          branchId: targetBranchId,
        });

        results.push({ orderId, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({ orderId, success: false, error: message });
      }
    }

    return {
      results,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      total: orderIds.length,
    };
  }

  /**
   * Create follow-up copies of existing orders. The originals are NEVER mutated.
   * Each copy gets a new order number (YNS-XXXXX), isFollowUp = true, and a
   * follow_up_source_order_id linking back to the original. Customer data,
   * items, and amounts are copied. The copy starts as UNPROCESSED.
   *
   * Returns the newly created order IDs (not the originals).
   */
  async reopenForFollowUp(
    orderIds: string[],
    actor: SessionUser,
    opts?: { targetBranchId?: string },
  ) {
    const unique = [...new Set(orderIds)];
    if (unique.length === 0) return { results: [], succeeded: 0, failed: 0, total: 0 };

    // 1. Read full original orders
    const originals = await this.db
      .select()
      .from(schema.orders)
      .where(inArray(schema.orders.id, unique));

    const orderMap = new Map(originals.map((o) => [o.id, o]));

    // 2. Read all order items for originals
    const originalItems = originals.length > 0
      ? await this.db
          .select()
          .from(schema.orderItems)
          .where(inArray(schema.orderItems.orderId, unique))
      : [];
    const itemsByOrder = new Map<string, typeof originalItems>();
    for (const item of originalItems) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }

    const targetBranch = opts?.targetBranchId;
    const results: Array<{ orderId: string; newOrderId: string; success: boolean; error?: string }> = [];

    // 3. Create copies one by one (each gets a new auto-incremented order_number)
    for (const sourceId of unique) {
      const orig = orderMap.get(sourceId);
      if (!orig) { results.push({ orderId: sourceId, newOrderId: '', success: false, error: 'Order not found' }); continue; }

      try {
        const [newOrder] = await withActorAndBranch(
          this.db,
          { id: actor.id, currentBranchId: targetBranch ?? actor.currentBranchId },
          async (tx) => {
            return tx
              .insert(schema.orders)
              .values({
                // Copy customer + product data from original
                customerName: orig.customerName,
                customerPhoneHash: orig.customerPhoneHash,
                customerPhone: orig.customerPhone,
                customerAddress: orig.customerAddress,
                deliveryAddress: orig.deliveryAddress,
                deliveryNotes: orig.deliveryNotes,
                deliveryState: orig.deliveryState,
                customerGender: orig.customerGender,
                customerEmail: orig.customerEmail,
                totalAmount: orig.totalAmount,
                items: orig.items,
                paymentMethod: orig.paymentMethod,
                preferredDeliveryDate: orig.preferredDeliveryDate,
                customFields: orig.customFields,
                orderSource: 'follow-up',
                // Follow-up specific
                isFollowUp: true,
                followUpSourceOrderId: sourceId,
                status: 'UNPROCESSED',
                // Branch: use target or original's servicing branch
                servicingBranchId: targetBranch ?? orig.servicingBranchId,
                branchId: orig.branchId,
                // Keep marketing attribution for tracking
                campaignId: orig.campaignId,
                mediaBuyerId: orig.mediaBuyerId,
              })
              .returning({ id: schema.orders.id, orderNumber: schema.orders.orderNumber });
          },
        );

        // 4. Copy order items
        const sourceItems = itemsByOrder.get(sourceId) ?? [];
        if (sourceItems.length > 0 && newOrder) {
          await this.db.insert(schema.orderItems).values(
            sourceItems.map((item) => ({
              orderId: newOrder.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              offerLabel: item.offerLabel,
            })),
          );
        }

        // 5. Write timeline event on the NEW order
        if (newOrder) {
          await this.db.insert(schema.orderTimelineEvents).values({
            orderId: newOrder.id,
            eventType: 'ORDER_RECEIVED' as const,
            actorId: actor.id,
            actorName: actor.name ?? null,
            description: `Follow-up order created from original YNS-${String(orig.orderNumber).padStart(5, '0')}. Original status: ${orig.status}.`,
            metadata: {
              sourceOrderId: sourceId,
              sourceOrderNumber: orig.orderNumber,
              sourceStatus: orig.status,
            },
            branchId: targetBranch ?? orig.servicingBranchId,
          });
        }

        results.push({ orderId: sourceId, newOrderId: newOrder?.id ?? '', success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        results.push({ orderId: sourceId, newOrderId: '', success: false, error: message });
      }
    }

    return {
      results,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      total: unique.length,
    };
  }

  // ── Follow-Up Batches ──────────────────────────────────────

  /**
   * Create a follow-up batch with its items. Called after reopenForFollowUp
   * or bulkRecoverCarts succeeds.
   */
  async createFollowUpBatch(input: {
    name: string;
    source: 'orders' | 'carts';
    branchId?: string;
    createdById: string;
    items: Array<{ orderId: string; originalStatus: string }>;
    groupId?: string;
    assignmentMode?: 'EQUAL' | 'MANUAL';
  }) {
    const mode = input.assignmentMode ?? 'MANUAL';
    const [batch] = await this.db
      .insert(schema.followUpBatches)
      .values({
        name: input.name,
        source: input.source,
        branchId: input.branchId ?? null,
        createdById: input.createdById,
        orderCount: input.items.length,
        groupId: input.groupId ?? null,
        assignmentMode: mode,
      })
      .returning({ id: schema.followUpBatches.id });

    if (input.items.length > 0) {
      await this.db.insert(schema.followUpBatchItems).values(
        input.items.map((item) => ({
          batchId: batch!.id,
          orderId: item.orderId,
          originalStatus: item.originalStatus,
        })),
      );
    }

    // Auto-assign if mode is EQUAL and a group is set
    if (mode === 'EQUAL' && input.groupId) {
      await this.autoAssignBatchItems(batch!.id, input.groupId);
    }

    return batch!;
  }

  /** List all follow-up batches with summary stats. */
  async listFollowUpBatches(input: { page: number; limit: number; startDate?: string; endDate?: string; includeReverted?: boolean }, effectiveBranchIds?: string[] | null) {
    const offset = (input.page - 1) * input.limit;
    const conditions: SQL[] = [];
    if (!input.includeReverted) conditions.push(eq(schema.followUpBatches.status, 'ACTIVE'));
    if (input.startDate) conditions.push(gte(schema.followUpBatches.createdAt, new Date(`${input.startDate}T00:00:00+01:00`)));
    if (input.endDate) conditions.push(lte(schema.followUpBatches.createdAt, new Date(`${input.endDate}T23:59:59+01:00`)));

    // Company-group isolation: filter batches by their branchId
    const bCond = branchScopeCondition(schema.followUpBatches.branchId, null, effectiveBranchIds);
    if (bCond) conditions.push(bCond);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [batches, countRows] = await Promise.all([
      this.db
        .select({
          id: schema.followUpBatches.id,
          name: schema.followUpBatches.name,
          source: schema.followUpBatches.source,
          branchId: schema.followUpBatches.branchId,
          groupId: schema.followUpBatches.groupId,
          createdById: schema.followUpBatches.createdById,
          orderCount: schema.followUpBatches.orderCount,
          batchStatus: schema.followUpBatches.status,
          createdAt: schema.followUpBatches.createdAt,
        })
        .from(schema.followUpBatches)
        .where(whereClause)
        .orderBy(desc(schema.followUpBatches.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.followUpBatches)
        .where(whereClause),
    ]);

    const total = countRows[0]?.count ?? 0;

    // Enrich with creator names, branch names, and group names
    const creatorIds = [...new Set(batches.map((b) => b.createdById))];
    const branchIds = [...new Set(batches.map((b) => b.branchId).filter(Boolean))] as string[];
    const groupIds = [...new Set(batches.map((b) => b.groupId).filter(Boolean))] as string[];

    const [creators, branchRows, groupRows] = await Promise.all([
      creatorIds.length > 0
        ? this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, creatorIds))
        : Promise.resolve([]),
      branchIds.length > 0
        ? this.db.select({ id: schema.branches.id, name: schema.branches.name }).from(schema.branches).where(inArray(schema.branches.id, branchIds))
        : Promise.resolve([]),
      groupIds.length > 0
        ? this.db.select({ id: schema.followUpGroups.id, name: schema.followUpGroups.name }).from(schema.followUpGroups).where(inArray(schema.followUpGroups.id, groupIds))
        : Promise.resolve([]),
    ]);

    const creatorNames = new Map(creators.map((u) => [u.id, u.name]));
    const branchNames = new Map(branchRows.map((b) => [b.id, b.name]));
    const groupNames = new Map(groupRows.map((g) => [g.id, g.name]));

    // Get per-batch order status breakdown in one query
    const batchIds = batches.map((b) => b.id);
    const statusBreakdown = batchIds.length > 0
      ? await this.db
          .select({
            batchId: schema.followUpBatchItems.batchId,
            status: schema.orders.status,
            count: sql<number>`count(*)::int`,
            revenue: sql<string>`coalesce(sum(${schema.orders.totalAmount}), 0)::text`,
          })
          .from(schema.followUpBatchItems)
          .innerJoin(schema.orders, eq(schema.orders.id, schema.followUpBatchItems.orderId))
          .where(inArray(schema.followUpBatchItems.batchId, batchIds))
          .groupBy(schema.followUpBatchItems.batchId, schema.orders.status)
      : [];

    const breakdownByBatch = new Map<string, Record<string, { count: number; revenue: string }>>();
    for (const row of statusBreakdown) {
      let map = breakdownByBatch.get(row.batchId);
      if (!map) { map = {}; breakdownByBatch.set(row.batchId, map); }
      map[row.status] = { count: row.count, revenue: row.revenue };
    }

    return {
      batches: batches.map((b) => {
        const breakdown = breakdownByBatch.get(b.id) ?? {};
        const confirmed = (breakdown.CONFIRMED?.count ?? 0) + (breakdown.AGENT_ASSIGNED?.count ?? 0) +
          (breakdown.DISPATCHED?.count ?? 0) + (breakdown.IN_TRANSIT?.count ?? 0) +
          (breakdown.DELIVERED?.count ?? 0) + (breakdown.REMITTED?.count ?? 0);
        const delivered = (breakdown.DELIVERED?.count ?? 0) + (breakdown.REMITTED?.count ?? 0);
        const deliveredRevenue =
          Number(breakdown.DELIVERED?.revenue ?? 0) + Number(breakdown.REMITTED?.revenue ?? 0);

        return {
          id: b.id,
          name: b.name,
          source: b.source,
          branchName: b.branchId ? branchNames.get(b.branchId) ?? null : null,
          groupName: b.groupId ? groupNames.get(b.groupId) ?? null : null,
          createdByName: creatorNames.get(b.createdById) ?? null,
          orderCount: b.orderCount,
          batchStatus: b.batchStatus,
          confirmed,
          delivered,
          deliveredRevenue: String(deliveredRevenue),
          confirmationRate: b.orderCount > 0 ? Math.round((confirmed / b.orderCount) * 100) : 0,
          deliveryRate: b.orderCount > 0 ? Math.round((delivered / b.orderCount) * 100) : 0,
          createdAt: b.createdAt,
        };
      }),
      pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    };
  }

  /** Get detail for a single follow-up batch: order list + analytics. */
  async getFollowUpBatchDetail(batchId: string) {
    const [batch] = await this.db
      .select()
      .from(schema.followUpBatches)
      .where(eq(schema.followUpBatches.id, batchId))
      .limit(1);

    if (!batch) return null;

    // Get all items with current order data
    const items = await this.db
      .select({
        itemId: schema.followUpBatchItems.id,
        orderId: schema.followUpBatchItems.orderId,
        originalStatus: schema.followUpBatchItems.originalStatus,
        assignedCsId: schema.followUpBatchItems.assignedCsId,
        addedAt: schema.followUpBatchItems.createdAt,
        orderStatus: schema.orders.status,
        orderNumber: schema.orders.orderNumber,
        customerName: schema.orders.customerName,
        totalAmount: schema.orders.totalAmount,
        orderCreatedAt: schema.orders.createdAt,
        followUpSourceOrderId: schema.orders.followUpSourceOrderId,
      })
      .from(schema.followUpBatchItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.followUpBatchItems.orderId))
      .where(eq(schema.followUpBatchItems.batchId, batchId))
      .orderBy(desc(schema.orders.createdAt));

    // Creator + branch + group names
    const [creator] = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, batch.createdById))
      .limit(1);

    let branchName: string | null = null;
    if (batch.branchId) {
      const [br] = await this.db
        .select({ name: schema.branches.name })
        .from(schema.branches)
        .where(eq(schema.branches.id, batch.branchId))
        .limit(1);
      branchName = br?.name ?? null;
    }

    let groupName: string | null = null;
    let groupMembers: Array<{ userId: string; userName: string }> = [];
    if (batch.groupId) {
      const [grp] = await this.db
        .select({ name: schema.followUpGroups.name })
        .from(schema.followUpGroups)
        .where(eq(schema.followUpGroups.id, batch.groupId))
        .limit(1);
      groupName = grp?.name ?? null;

      groupMembers = await this.db
        .select({ userId: schema.followUpGroupMembers.userId, userName: schema.users.name })
        .from(schema.followUpGroupMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.followUpGroupMembers.userId))
        .where(eq(schema.followUpGroupMembers.groupId, batch.groupId));
    }

    // Resolve assigned CS names for batch items
    const assignedCsIds = [...new Set(items.map((i) => i.assignedCsId).filter(Boolean))] as string[];
    const assignedCsNames = assignedCsIds.length > 0
      ? new Map(
          (await this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, assignedCsIds)))
            .map((u) => [u.id, u.name]),
        )
      : new Map<string, string>();

    // Compute funnel
    const statusCounts: Record<string, number> = {};
    let totalRevenue = 0;
    let deliveredRevenue = 0;
    for (const item of items) {
      statusCounts[item.orderStatus] = (statusCounts[item.orderStatus] ?? 0) + 1;
      const amt = Number(item.totalAmount) || 0;
      totalRevenue += amt;
      if (item.orderStatus === 'DELIVERED' || item.orderStatus === 'REMITTED') {
        deliveredRevenue += amt;
      }
    }

    const confirmed = (statusCounts.CONFIRMED ?? 0) + (statusCounts.AGENT_ASSIGNED ?? 0) +
      (statusCounts.DISPATCHED ?? 0) + (statusCounts.IN_TRANSIT ?? 0) +
      (statusCounts.DELIVERED ?? 0) + (statusCounts.REMITTED ?? 0);
    const delivered = (statusCounts.DELIVERED ?? 0) + (statusCounts.REMITTED ?? 0);

    return {
      id: batch.id,
      name: batch.name,
      source: batch.source,
      branchName,
      createdByName: creator?.name ?? null,
      orderCount: items.length,
      assignmentMode: batch.assignmentMode,
      batchStatus: batch.status,
      groupId: batch.groupId,
      groupName,
      groupMembers,
      createdAt: batch.createdAt,
      items: items.map((item) => ({
        ...item,
        assignedCsName: item.assignedCsId ? assignedCsNames.get(item.assignedCsId) ?? null : null,
      })),
      analytics: {
        statusCounts,
        confirmed,
        delivered,
        confirmationRate: items.length > 0 ? Math.round((confirmed / items.length) * 100) : 0,
        deliveryRate: items.length > 0 ? Math.round((delivered / items.length) * 100) : 0,
        totalRevenue: String(totalRevenue),
        deliveredRevenue: String(deliveredRevenue),
      },
    };
  }

  /** Next auto-generated batch name: "Follow Up #N". */
  async nextFollowUpBatchName(): Promise<string> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.followUpBatches);
    return `Follow Up #${(row?.count ?? 0) + 1}`;
  }

  /**
   * Delete a follow-up batch. Reverts untouched orders (UNPROCESSED/CS_ASSIGNED)
   * to their original state. Orders that have progressed beyond CS_ASSIGNED are
   * left as-is — you can't un-confirm a real order.
   */
  /**
   * Delete a follow-up batch. Since batch items now point to COPY orders
   * (not originals), we soft-delete untouched copies and keep worked ones.
   * Original orders are NEVER touched.
   */
  async deleteFollowUpBatch(batchId: string) {
    const [batch] = await this.db
      .select()
      .from(schema.followUpBatches)
      .where(eq(schema.followUpBatches.id, batchId))
      .limit(1);
    if (!batch) throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch not found' });

    const items = await this.db
      .select({
        orderId: schema.followUpBatchItems.orderId,
        orderStatus: schema.orders.status,
      })
      .from(schema.followUpBatchItems)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.followUpBatchItems.orderId))
      .where(eq(schema.followUpBatchItems.batchId, batchId));

    const UNTOUCHED = new Set(['UNPROCESSED', 'CS_ASSIGNED']);
    const untouched = items.filter((i) => UNTOUCHED.has(i.orderStatus));
    const worked = items.filter((i) => !UNTOUCHED.has(i.orderStatus));

    // Soft-delete untouched copy orders
    const now = new Date();
    for (const item of untouched) {
      await this.db
        .update(schema.orders)
        .set({ status: 'DELETED', deletedAt: now })
        .where(eq(schema.orders.id, item.orderId));
    }

    // Worked copies stay as-is — work remains with the closer

    // Mark batch as REVERTED
    await this.db
      .update(schema.followUpBatches)
      .set({ status: 'REVERTED' })
      .where(eq(schema.followUpBatches.id, batchId));

    return { deleted: untouched.length, kept: worked.length };
  }

  // ── Follow-Up Groups ────────────────────────────────────────

  async createFollowUpGroup(input: { name: string; memberIds: string[]; createdById: string }) {
    const [group] = await this.db
      .insert(schema.followUpGroups)
      .values({ name: input.name, createdById: input.createdById })
      .returning({ id: schema.followUpGroups.id, name: schema.followUpGroups.name });

    if (input.memberIds.length > 0) {
      await this.db.insert(schema.followUpGroupMembers).values(
        input.memberIds.map((userId) => ({ groupId: group!.id, userId })),
      );
    }

    return { ...group!, memberCount: input.memberIds.length };
  }

  async updateFollowUpGroup(groupId: string, input: { name?: string; memberIds?: string[] }) {
    if (input.name) {
      await this.db
        .update(schema.followUpGroups)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(schema.followUpGroups.id, groupId));
    }

    if (input.memberIds !== undefined) {
      // Replace all members
      await this.db.delete(schema.followUpGroupMembers).where(eq(schema.followUpGroupMembers.groupId, groupId));
      if (input.memberIds.length > 0) {
        await this.db.insert(schema.followUpGroupMembers).values(
          input.memberIds.map((userId) => ({ groupId, userId })),
        );
      }
    }

    return { success: true };
  }

  async deleteFollowUpGroup(groupId: string, transferTo?: { branchId?: string; groupId?: string }) {
    // Check if any rules target this group
    const rulesUsingGroup = await this.db
      .select({ id: schema.followUpRules.id })
      .from(schema.followUpRules)
      .where(eq(schema.followUpRules.targetGroupId, groupId));

    if (rulesUsingGroup.length > 0) {
      if (transferTo?.branchId) {
        // Transfer rules to target a branch instead
        await this.db
          .update(schema.followUpRules)
          .set({ targetGroupId: null, targetBranchId: transferTo.branchId })
          .where(eq(schema.followUpRules.targetGroupId, groupId));
      } else if (transferTo?.groupId) {
        // Transfer rules to another group
        await this.db
          .update(schema.followUpRules)
          .set({ targetGroupId: transferTo.groupId })
          .where(eq(schema.followUpRules.targetGroupId, groupId));
      } else {
        // Clear the group target — rules become "All branches"
        await this.db
          .update(schema.followUpRules)
          .set({ targetGroupId: null, targetBranchId: null })
          .where(eq(schema.followUpRules.targetGroupId, groupId));
      }
    }

    // Clear group reference on any batches
    await this.db
      .update(schema.followUpBatches)
      .set({ groupId: null })
      .where(eq(schema.followUpBatches.groupId, groupId));

    await this.db.delete(schema.followUpGroups).where(eq(schema.followUpGroups.id, groupId));
    return { success: true };
  }

  async listFollowUpGroups(effectiveBranchIds?: string[] | null) {
    const groups = await this.db
      .select({
        id: schema.followUpGroups.id,
        name: schema.followUpGroups.name,
        createdById: schema.followUpGroups.createdById,
        createdAt: schema.followUpGroups.createdAt,
      })
      .from(schema.followUpGroups)
      .orderBy(desc(schema.followUpGroups.createdAt));

    // Get member counts + member details
    const groupIds = groups.map((g) => g.id);
    const members = groupIds.length > 0
      ? await this.db
          .select({
            groupId: schema.followUpGroupMembers.groupId,
            userId: schema.followUpGroupMembers.userId,
            userName: schema.users.name,
          })
          .from(schema.followUpGroupMembers)
          .innerJoin(schema.users, eq(schema.users.id, schema.followUpGroupMembers.userId))
          .where(inArray(schema.followUpGroupMembers.groupId, groupIds))
      : [];

    // When group-scoped, find user IDs that belong to branches in the active group
    // and filter groups to those with at least one matching member.
    let allowedUserIds: Set<string> | null = null;
    if (effectiveBranchIds && effectiveBranchIds.length > 0 && members.length > 0) {
      const memberUserIds = [...new Set(members.map((m) => m.userId))];
      const branchMembers = await this.db
        .select({ userId: schema.userBranches.userId })
        .from(schema.userBranches)
        .where(and(
          inArray(schema.userBranches.userId, memberUserIds),
          inArray(schema.userBranches.branchId, effectiveBranchIds),
        ));
      allowedUserIds = new Set(branchMembers.map((r) => r.userId));
    }

    const membersByGroup = new Map<string, Array<{ userId: string; userName: string }>>();
    for (const m of members) {
      const list = membersByGroup.get(m.groupId) ?? [];
      list.push({ userId: m.userId, userName: m.userName });
      membersByGroup.set(m.groupId, list);
    }

    // Creator names
    const creatorIds = [...new Set(groups.map((g) => g.createdById))];
    const creators = creatorIds.length > 0
      ? await this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, creatorIds))
      : [];
    const creatorNames = new Map(creators.map((u) => [u.id, u.name]));

    const result = groups.map((g) => ({
      id: g.id,
      name: g.name,
      createdByName: creatorNames.get(g.createdById) ?? null,
      memberCount: membersByGroup.get(g.id)?.length ?? 0,
      members: membersByGroup.get(g.id) ?? [],
      createdAt: g.createdAt,
    }));

    // When group-scoped, only return groups that have at least one member in the active group's branches.
    if (allowedUserIds) {
      return result.filter((g) =>
        g.members.some((m) => allowedUserIds!.has(m.userId)),
      );
    }
    return result;
  }

  async getFollowUpGroup(groupId: string) {
    const [group] = await this.db
      .select()
      .from(schema.followUpGroups)
      .where(eq(schema.followUpGroups.id, groupId))
      .limit(1);
    if (!group) return null;

    const members = await this.db
      .select({
        userId: schema.followUpGroupMembers.userId,
        userName: schema.users.name,
      })
      .from(schema.followUpGroupMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.followUpGroupMembers.userId))
      .where(eq(schema.followUpGroupMembers.groupId, groupId));

    return { ...group, members };
  }

  /** Auto-assign batch items equally to group members (round-robin). */
  async autoAssignBatchItems(batchId: string, groupId: string) {
    const members = await this.db
      .select({ userId: schema.followUpGroupMembers.userId })
      .from(schema.followUpGroupMembers)
      .where(eq(schema.followUpGroupMembers.groupId, groupId));

    if (members.length === 0) return;

    const items = await this.db
      .select({ id: schema.followUpBatchItems.id, orderId: schema.followUpBatchItems.orderId })
      .from(schema.followUpBatchItems)
      .where(eq(schema.followUpBatchItems.batchId, batchId))
      .orderBy(asc(schema.followUpBatchItems.createdAt));

    if (items.length === 0) return;

    // Round-robin assignment
    for (let i = 0; i < items.length; i++) {
      const member = members[i % members.length]!;
      await this.db
        .update(schema.followUpBatchItems)
        .set({ assignedCsId: member.userId })
        .where(eq(schema.followUpBatchItems.id, items[i]!.id));

      // Also set assignedCsId on the order itself so CS sees it in their queue
      await this.db
        .update(schema.orders)
        .set({ assignedCsId: member.userId, status: 'CS_ASSIGNED' })
        .where(eq(schema.orders.id, items[i]!.orderId));
    }
  }

  /** Manually assign a batch item to a CS closer. */
  async assignBatchItem(batchItemId: string, csCloserId: string) {
    const [item] = await this.db
      .select({ id: schema.followUpBatchItems.id, orderId: schema.followUpBatchItems.orderId })
      .from(schema.followUpBatchItems)
      .where(eq(schema.followUpBatchItems.id, batchItemId))
      .limit(1);
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Batch item not found' });

    await this.db
      .update(schema.followUpBatchItems)
      .set({ assignedCsId: csCloserId })
      .where(eq(schema.followUpBatchItems.id, batchItemId));

    await this.db
      .update(schema.orders)
      .set({ assignedCsId: csCloserId, status: 'CS_ASSIGNED' })
      .where(eq(schema.orders.id, item.orderId));

    return { success: true };
  }

  /** Bulk assign batch items to CS closers (round-robin across provided closerIds). */
  async bulkAssignBatchItems(itemIds: string[], csCloserIds: string[]) {
    if (csCloserIds.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No closers provided' });

    const items = await this.db
      .select({ id: schema.followUpBatchItems.id, orderId: schema.followUpBatchItems.orderId })
      .from(schema.followUpBatchItems)
      .where(inArray(schema.followUpBatchItems.id, itemIds));

    for (let i = 0; i < items.length; i++) {
      const closerId = csCloserIds[i % csCloserIds.length]!;
      await this.db
        .update(schema.followUpBatchItems)
        .set({ assignedCsId: closerId })
        .where(eq(schema.followUpBatchItems.id, items[i]!.id));

      await this.db
        .update(schema.orders)
        .set({ assignedCsId: closerId, status: 'CS_ASSIGNED' })
        .where(eq(schema.orders.id, items[i]!.orderId));
    }

    return { succeeded: items.length };
  }
}
