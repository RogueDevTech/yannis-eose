import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import { randomUUID, createHash } from 'crypto';
import { eq, and, desc, asc, sql, ilike, or, count, gte, lte, inArray, notInArray, exists, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type Redis from 'ioredis';
import { db as schema } from '@yannis/shared';
import {
  type CreateOrderInput,
  type CreateOfflineOrderInput,
  type TransitionOrderInput,
  type UpdateOrderInput,
  type RequestOrderLinePriceChangeInput,
  type RequestOrderDeletionInput,
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
import { isAdminLevel } from '../common/authz';
import { permissionRequestTypeTextEq } from '../common/db/permission-request-type-sql';
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

/** Pre-confirmation orders only — avoids inventory side effects on soft-archive. */
const ARCHIVABLE_ORDER_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'] as const;

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
  private async assertCanManualAssignToCs(
    actor: SessionUser,
    csCloserId: string,
    orderBranchId: string,
    orderStatus: string,
  ): Promise<void> {
    const hasReassign =
      (actor.permissions ?? [])
        .map((p) => canonicalPermissionCode(p))
        .includes(canonicalPermissionCode('orders.reassign'));
    if (actor.role === 'SUPER_ADMIN' || hasReassign) return;
    if (!actor.currentBranchId || actor.currentBranchId !== orderBranchId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You cannot assign orders outside your active branch.',
      });
    }
    if (orderStatus !== 'UNPROCESSED' && orderStatus !== 'CS_ASSIGNED') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Team supervisors may only assign orders that are unprocessed or CS-assigned.',
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

  /**
   * Forces submitted line items to existing DB unit prices (per line), recomputes total.
   * Used when the actor may change quantities but not pricing.
   */
  private async clampOrderItemsToExistingUnitPrices(
    orderId: string,
    items: NonNullable<UpdateOrderInput['items']>,
  ): Promise<{ items: NonNullable<UpdateOrderInput['items']>; totalAmount: number }> {
    const dbRows = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, orderId))
      .orderBy(asc(schema.orderItems.id));

    if (dbRows.length !== items.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You cannot add or remove products on this order. Adjust quantities only, or ask a supervisor to change pricing.',
      });
    }

    const used = new Set<number>();
    const nextItems: NonNullable<UpdateOrderInput['items']> = items.map((it) => {
      const idx = dbRows.findIndex((r, i) => !used.has(i) && r.productId === it.productId);
      if (idx === -1) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Line items must match the current products on the order.',
        });
      }
      used.add(idx);
      const row = dbRows[idx]!;
      const unit = parseFloat(String(row.unitPrice));
      if (Number.isNaN(unit)) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Invalid stored unit price' });
      }
      return {
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: unit,
        offerLabel: it.offerLabel ?? (row.offerLabel ?? undefined),
      };
    });

    // unitPrice is the offer/line total (not per-unit) — do not multiply by quantity
    const totalAmount = nextItems.reduce((sum, row) => sum + row.unitPrice, 0);
    return { items: nextItems, totalAmount };
  }

  /** PENDING permission_request for this order's line price change (if any). */
  async findPendingOrderLinePriceRequestId(orderId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.permissionRequests.id })
      .from(schema.permissionRequests)
      .where(
        and(
          eq(schema.permissionRequests.status, 'PENDING'),
          permissionRequestTypeTextEq(schema.permissionRequests.type, 'ORDER_LINE_PRICE_CHANGE'),
          sql`(${schema.permissionRequests.payload}->>'orderId') = ${orderId}`,
        ),
      )
      .limit(1);
    return row?.id ?? null;
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
    }
    return false;
  }

  private async notifyOrderLinePriceChangeApprovers(params: {
    requestId: string;
    orderId: string;
    branchId: string | null;
    requesterName: string | null;
    excludeUserId: string;
  }): Promise<void> {
    const short = params.orderId.slice(0, 8).toUpperCase();
    const title = 'Order line price change — approval needed';
    const body = `${params.requesterName ?? 'A teammate'} requested updated unit prices on order ${short}. Review it under Permission Requests.`;
    const data: Record<string, string> = {
      requestId: params.requestId,
      orderId: params.orderId,
      permissionRequestKind: 'order_line_price',
    };

    // Three independent recipient lookups — run them in one parallel wave
    // instead of three sequential round-trips. The Set dedupes, so result
    // ordering doesn't matter. Org-wide HoLogistics often has no primary_branch
    // match to the order branch, so notify every active Head of Logistics.
    const recipientIds = new Set<string>();
    const [admins, heads, hoLogistics] = await Promise.all([
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.status, 'ACTIVE'), inArray(schema.users.role, ['SUPER_ADMIN', 'ADMIN']))),
      params.branchId
        ? this.db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(
              and(
                eq(schema.users.status, 'ACTIVE'),
                inArray(schema.users.role, ['HEAD_OF_CS', 'BRANCH_ADMIN']),
                eq(schema.users.primaryBranchId, params.branchId),
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

    // Three independent recipient lookups in one parallel wave (Set dedupes).
    const recipientIds = new Set<string>();
    const [admins, heads, hoLogisticsDeletion] = await Promise.all([
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.status, 'ACTIVE'), inArray(schema.users.role, ['SUPER_ADMIN', 'ADMIN']))),
      params.branchId
        ? this.db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(
              and(
                eq(schema.users.status, 'ACTIVE'),
                inArray(schema.users.role, ['HEAD_OF_CS', 'BRANCH_ADMIN']),
                eq(schema.users.primaryBranchId, params.branchId),
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
  async requestLinePriceChangeApproval(input: RequestOrderLinePriceChangeInput, actor: SessionUser) {
    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, input.orderId), isNull(schema.orders.deletedAt)))
      .limit(1);
    const order = existingRows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    const allowedStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED'];
    if (!allowedStatuses.includes(order.status)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Order items cannot be adjusted once the order has been dispatched.',
      });
    }

    await this.assertActorMayUpdateOrder(actor, {
      branchId: order.branchId ?? null,
      assignedCsId: order.assignedCsId ?? null,
      status: order.status,
    });

    const mayEditPrices = await this.canActorEditOrderLinePrices(actor, {
      branchId: order.branchId ?? null,
      assignedCsId: order.assignedCsId ?? null,
    });
    if (mayEditPrices) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You can change line prices directly on this order — no approval request is needed.',
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

    const differs = await this.proposedLineItemPricingDiffersFromDatabase(input.orderId, input.items);
    if (!differs) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'At least one unit price must differ from the current order to submit an approval request.',
      });
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
        message: 'A price-change request is already pending for this order.',
      });
    }

    const payload = {
      orderId: input.orderId,
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
      branchId: order.branchId ?? null,
    });

    void this.notifyOrderLinePriceChangeApprovers({
      requestId: req.id,
      orderId: input.orderId,
      branchId: order.branchId ?? null,
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

    const payload = { orderId: input.orderId };

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
      requesterName: actor.name ?? null,
      excludeUserId: actor.id,
    });

    return { success: true as const, requestId: req.id };
  }

  /**
   * Soft-delete (archive): sets `deleted_at`; order row and temporal history remain. Privileged roles only.
   */
  async softDeleteOrder(
    orderId: string,
    actor: SessionUser,
    opts?: { approverNote?: string },
  ): Promise<{ success: true }> {
    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
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

    const mayArchive = await this.canActorEditOrderLinePrices(actor, {
      branchId: order.branchId ?? null,
      assignedCsId: order.assignedCsId ?? null,
    });
    if (!mayArchive) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          'Only Head of CS, Head of Logistics, Branch Admin, a Sales team supervisor for the assignee, or an Admin may archive this order.',
      });
    }

    await this.assertActorMayUpdateOrder(actor, {
      branchId: order.branchId ?? null,
      assignedCsId: order.assignedCsId ?? null,
      status: order.status,
    });

    const note = opts?.approverNote?.trim();
    const actorLabel = actor.name ?? 'Staff';
    const description = note
      ? `Order archived (removed from active lists). Note: ${note.slice(0, 500)}`
      : `Order archived (removed from active lists) by ${actorLabel}.`;

    await withActor(this.db, actor, async (tx) => {
      const updatedRows = await tx
        .update(schema.orders)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
        .returning({ id: schema.orders.id });
      if (!updatedRows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found or already archived' });
      }
      await tx.insert(schema.orderTimelineEvents).values({
        orderId,
        eventType: 'ORDER_ARCHIVED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description,
        metadata: note ? { note } : null,
        branchId: order.branchId ?? null,
      });
    });

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
    orderSource?: 'edge-form' | null,
  ): Promise<{ id?: string; authorizationUrl?: string; crossFunnelAttempt?: true }> {
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

    const branchId = await this.resolveBranchIdForNewOrder({
      campaignId: orderInput.campaignId ?? null,
      mediaBuyerId: orderInput.mediaBuyerId ?? null,
      fallbackBranchId: null,
    });

    // Cross-funnel attempt detection (Pillar 2 / attribution truth):
    // Records when a different MB's funnel already captured this phone+product
    // within 24h — but NEVER blocks order creation. The cross_funnel_attempts
    // row is informational only; blocking was causing false positives that
    // silently dropped legitimate orders (2026-05-19 incident: detectDuplicates
    // returned stale/phantom matches, every submission for the campaign was
    // rejected as cross-funnel). Orders still get duplicate-flagged below.
    if (orderSource === 'edge-form' && orderInput.mediaBuyerId && orderInput.customerPhoneHash) {
      const productIds = orderInput.items.map((i) => i.productId);
      const existing = await this.detectDuplicates(orderInput.customerPhoneHash, productIds);
      const crossMbWinner = existing.find(
        (o) => o.mediaBuyerId && o.mediaBuyerId !== orderInput.mediaBuyerId,
      );
      if (crossMbWinner) {
        // Record for analytics — but do NOT return early. Let the order be
        // created so CS can see it; the duplicate-flag below will still tag it.
        await this.db.insert(schema.crossFunnelAttempts).values(
          productIds.map((productId) => ({
            customerPhoneHash: orderInput.customerPhoneHash,
            customerName: orderInput.customerName,
            productId,
            mediaBuyerId: orderInput.mediaBuyerId!,
            campaignId: orderInput.campaignId ?? null,
            branchId: branchId ?? null,
            originalOrderId: crossMbWinner.id,
            originalMediaBuyerId: crossMbWinner.mediaBuyerId,
          })),
        ).catch((err) => {
          this.logger.warn({ err, phoneHash: orderInput.customerPhoneHash }, 'cross-funnel attempt insert failed — continuing with order creation');
        });
      }
    }
    // Two-tier duplicate flagging:
    //   24h match → 'FLAGGED' (hard, fresh — likely an accidental resubmission)
    //   24h–30d match → 'POSSIBLY_DUPLICATE' (soft, historical — repeat customer or stale scam)
    //   else → null (clean)
    const recentSamePhoneOrder = orderInput.customerPhoneHash
      ? await this.findRecentPhoneOrder(orderInput.customerPhoneHash)
      : null;
    const historicalSamePhoneOrder =
      !recentSamePhoneOrder && orderInput.customerPhoneHash
        ? await this.findHistoricalSamePhoneOrder(orderInput.customerPhoneHash)
        : null;
    const duplicateFlag: 'FLAGGED' | 'POSSIBLY_DUPLICATE' | null = recentSamePhoneOrder
      ? 'FLAGGED'
      : historicalSamePhoneOrder
        ? 'POSSIBLY_DUPLICATE'
        : null;
    const duplicateOfId =
      recentSamePhoneOrder?.id ?? historicalSamePhoneOrder?.id ?? null;

    const insertOrder = async (
      dbOrTx: PostgresJsDatabase<typeof schema> | Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0],
    ) => {
      const rows = await dbOrTx
        .insert(schema.orders)
        .values({
          campaignId: orderInput.campaignId ?? null,
          mediaBuyerId: orderInput.mediaBuyerId ?? null,
          branchId: branchId ?? null,
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
          paymentMethod: paymentMethod === 'PAY_ONLINE' ? 'PAY_ONLINE' : 'PAY_ON_DELIVERY',
          paymentStatus: paymentMethod === 'PAY_ONLINE' ? 'PENDING' : null,
          paymentProvider: paymentMethod === 'PAY_ONLINE' ? 'PAYSTACK' : null,
          items: orderInput.items,
          totalAmount: orderInput.totalAmount != null ? String(orderInput.totalAmount) : null,
          status: 'UNPROCESSED',
          orderSource: orderSource === 'edge-form' ? 'edge-form' : null,
          customFields: orderInput.customFields ?? null,
          isDuplicate: duplicateFlag,
          duplicateOfId,
          // Back-link to the originating cart so HoCS can filter "Recovered from
          // cart" on /admin/sales/orders (migration 0142). NULL for direct orders.
          cartId: cartId ?? null,
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
            offerLabel: item.offerLabel ?? null,
          })),
        );
      }
      return created;
    };

    const order = actorId
      ? await withActor(this.db, { id: actorId }, insertOrder)
      : await insertOrder(this.db);

    // Emit real-time event for CS dispatch
    this.events.emitNewOrder({
      orderId: order.id,
      productName: 'Order created',
      branchId: order.branchId ?? null,
      mediaBuyerId: order.mediaBuyerId ?? null,
    });

    // Notify Head of CS + Head of Marketing only on new order (not every Sales closer — they get
    // order:assigned when Hot Swap / auto-dispatch / claim assigns them). SuperAdmin excluded (volume).
    this.notifications.enqueueCreateForRole('HEAD_OF_CS', {
      type: 'order:new',
      title: 'New order received',
      body: 'A new order needs attention.',
      data: { orderId: order.id },
    });
    this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
      type: 'order:new',
      title: 'New order received',
      body: 'A new order has been created.',
      data: { orderId: order.id },
    });

    // Notify Media Buyer if order is from their campaign. Body is
    // personalized with the customer name + campaign name so the MB can
    // distinguish multiple notifications stacking up in their bell. Customer
    // name is non-PII (Pillar 2 only protects the phone). Falls back to the
    // generic body if either lookup fails.
    if (order.mediaBuyerId) {
      const campaignName = order.campaignId
        ? (
            await this.db
              .select({ name: schema.campaigns.name })
              .from(schema.campaigns)
              .where(eq(schema.campaigns.id, order.campaignId))
              .limit(1)
          )[0]?.name ?? null
        : null;
      const customerLabel = (order.customerName ?? '').trim() || 'A customer';
      const body = campaignName
        ? `${customerLabel} just placed an order via ${campaignName}.`
        : `${customerLabel} just placed an order from your campaign.`;
      this.notifications.enqueueCreate({
        userId: order.mediaBuyerId,
        type: 'order:new_campaign',
        title: 'New order from your campaign',
        body,
        data: { orderId: order.id, campaignId: order.campaignId ?? null, campaignName, customerName: customerLabel },
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

    // Optional dedup: warn/block if same phone + product in 6h
    const productIds = input.items.map((i) => i.productId);
    const duplicates = await this.detectDuplicates(customerPhoneHash, productIds);
    if (duplicates.length > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Possible duplicate: order(s) with same customer phone in the last 24 hours. Merge or dismiss existing before creating an offline order.',
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

    const branchId = await this.resolveBranchIdForNewOrder({
      campaignId: input.campaignId ?? null,
      mediaBuyerId: input.mediaBuyerId ?? null,
      fallbackBranchId: sessionBranchId ?? null,
    });
    // Same two-tier flagging as the edge-form create path. The strict
    // `detectDuplicates` check above already blocks offline creation when a
    // 24h match exists, so `findRecentPhoneOrder` will normally be null
    // here — `findHistoricalSamePhoneOrder` still tags week-old repeats as
    // POSSIBLY_DUPLICATE for HoCS visibility.
    const recentSamePhoneOrder = await this.findRecentPhoneOrder(customerPhoneHash);
    const historicalSamePhoneOrder = !recentSamePhoneOrder
      ? await this.findHistoricalSamePhoneOrder(customerPhoneHash)
      : null;
    const offlineDuplicateFlag: 'FLAGGED' | 'POSSIBLY_DUPLICATE' | null = recentSamePhoneOrder
      ? 'FLAGGED'
      : historicalSamePhoneOrder
        ? 'POSSIBLY_DUPLICATE'
        : null;
    const offlineDuplicateOfId =
      recentSamePhoneOrder?.id ?? historicalSamePhoneOrder?.id ?? null;

    const order = await withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.orders)
        .values({
          campaignId: input.campaignId ?? null,
          mediaBuyerId: input.mediaBuyerId ?? null,
          branchId: branchId ?? null,
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
          isDuplicate: offlineDuplicateFlag,
          duplicateOfId: offlineDuplicateOfId,
          // Back-link to the cart when this offline order was created from a
          // recovered cart (Assign-from-Modal flow). NULL for direct offline orders.
          cartId: input.cartId ?? null,
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
      mediaBuyerId: order.mediaBuyerId ?? null,
    });
    this.events.emitToUser(actorId, 'order:assigned', { orderId: order.id });
    this.events.emitToRoom('cs-all', 'order:new', { orderId: order.id }, order.branchId ?? null);

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

    return { id: order.id };
  }

  /**
   * Recover an abandoned cart as a real edge-form order.
   * Unlike `createOffline`, this creates the order with `orderSource: 'edge-form'`
   * so the MB gets full attribution and the order counts toward their metrics.
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

    // 3. Create via the standard edge-form path — UNPROCESSED, MB-attributed.
    const result = await this.create(orderInput, actorId, 'edge-form');
    if (!result.id) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Order creation returned no ID' });
    }

    // 4. Convert the cart (fire-and-forget — order is already created).
    this.cartService.convert(cartId, result.id, actorId).catch(() => {});

    return { id: result.id };
  }

  /** SHA-256 hash of phone for offline order creation (server-side only). */
  private hashPhone(phone: string): string {
    return createHash('sha256').update(phone.trim()).digest('hex');
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
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
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
    const [remittanceRow, pendingOrderLinePriceRequestId, pendingOrderDeletionRequestId] =
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
        this.findPendingOrderLinePriceRequestId(orderId),
        this.findPendingOrderDeletionRequestId(orderId),
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
      pendingOrderLinePriceRequestId,
      pendingOrderDeletionRequestId,
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
  }>> {
    const [orderRow] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);
    if (!orderRow) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    const orderItems = await this.db
      .select({
        productId: schema.orderItems.productId,
        quantity: schema.orderItems.quantity,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, orderId));

    if (orderItems.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order has no line items to allocate.' });
    }

    const needsByProduct = new Map<string, { qty: number; name: string }>();
    for (const item of orderItems) {
      const curr = needsByProduct.get(item.productId);
      needsByProduct.set(item.productId, {
        qty: (curr?.qty ?? 0) + item.quantity,
        name: item.productName ?? 'Unknown product',
      });
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
      });
    }

    return results.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name));
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

    // CS can call the customer at any pre-delivery stage: initial engagement, post-confirm
    // upsell/adjustment, or delivery-coordination follow-up after allocation/dispatch.
    // Blocked only once the order is closed out (DELIVERED / RETURNED / CANCELLED / etc.).
    const callableStatuses = ['CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'];
    if (!callableStatuses.includes(order.status)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Cannot reveal phone: order is in ${order.status} status`,
      });
    }

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
   * Plain-text order summary for WhatsApp / logistics. Same read gate as `getById`.
   * Phone line uses the stored `customer_phone` when present; otherwise scans delivery
   * notes, address, and custom field strings for a Nigerian mobile so paste is the
   * full number (not a mask). Nigerian GSM is normalized to compact `+234…` for
   * tap-to-call in WhatsApp/dialers. If nothing is found, paste explains VOIP fallback.
   */
  async getClipboardSummaryText(orderId: string, actor: SessionUser): Promise<string> {
    const detail = await this.getById(orderId);
    this.assertActorMayViewOrderForRead(actor, detail);

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
      status: detail.status,
      customerName: detail.customerName,
      customerPhoneForPaste: phoneForPaste,
      deliveryAddress: detail.deliveryAddress ?? null,
      customerAddress: detail.customerAddress ?? null,
      orderItems: detail.orderItems,
      totalAmount: detail.totalAmount ?? null,
      preferredDeliveryDate: detail.preferredDeliveryDate ?? null,
      logisticsLocationName: detail.logisticsLocationName ?? null,
      paymentStatus: detail.paymentStatus ?? null,
      deliveryNotes: detail.deliveryNotes ?? null,
      campaignCustomFieldDefs: detail.campaignCustomFieldDefs,
      customFields: detail.customFields as Record<string, unknown> | null | undefined,
    });
  }

  /**
   * List orders with filtering, search, and pagination.
   */
  async list(
    input: ListOrdersInput,
    branchId?: string | null,
    listOpts?: { assignedCloserViewerId?: string; searchIncludeCustomerPhone?: boolean },
  ) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];

    if (input.status) {
      conditions.push(eq(schema.orders.status, input.status));
    }
    if (input.statuses?.length) {
      conditions.push(inArray(schema.orders.status, input.statuses));
    }
    // Mirrors `appendOrdersAggregateScopeConditions` / `narrowOrdersAggregateFiltersForViewer`:
    // supervisor OR-scope replaces single-ID filters — AND-ing `assignedCsId` would hide
    // supervised MB funnel rows (`assigned_cs_id` IS NULL) from list/count parity.
    if (input.supervisorScope) {
      const { csUserIds, mediaBuyerIds } = input.supervisorScope;
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
    if (input.search) {
      const trimmed = input.search.trim();
      if (trimmedSearchLooksLikeUuid(trimmed)) {
        // Fast-path: exact ID match can use the PK index (ILIKE would force a scan).
        conditions.push(eq(schema.orders.id, trimmed));
      } else if (trimmed.length > 0) {
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
    if (input.startDate) {
      conditions.push(gte(schema.orders.createdAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      // Bare `YYYY-MM-DD` is interpreted as start-of-day; bump to 23:59:59.999
      // so the inclusive day filter actually covers the whole calendar day.
      // ISO datetimes (`YYYY-MM-DDTHH:MM[:SS]`) carry an explicit moment from
      // the new time-aware filter — leave them as-is so the user gets the
      // exact upper bound they picked.
      if (!input.endDate.includes('T')) end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, end));
    }
    if (branchId) {
      if (
        listOpts?.assignedCloserViewerId &&
        input.assignedCsId &&
        input.assignedCsId === listOpts.assignedCloserViewerId
      ) {
        const branchOrAssigned = or(
          eq(schema.orders.branchId, branchId),
          eq(schema.orders.assignedCsId, input.assignedCsId),
        );
        if (branchOrAssigned) conditions.push(branchOrAssigned);
      } else {
        conditions.push(eq(schema.orders.branchId, branchId));
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

    const [usersRes, itemsRes, campsRes] = await Promise.all([
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
            }>,
          ),
      campaignIds.length > 0
        ? this.db
            .select({ id: schema.campaigns.id, name: schema.campaigns.name })
            .from(schema.campaigns)
            .where(inArray(schema.campaigns.id, campaignIds))
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);

    const userNamesById = new Map<string, string>();
    for (const u of usersRes) userNamesById.set(u.id, u.name);

    const primaryItemByOrder = new Map<
      string,
      { productId: string; productName: string | null; itemCount: number }
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
        });
      } else {
        cur.itemCount += 1;
      }
    }

    const campaignNames = new Map<string, string>();
    for (const c of campsRes) campaignNames.set(c.id, c.name);

    return {
      orders: orders.map((order) => {
        const { customerPhone, ...orderRest } = order;
        const primary = primaryItemByOrder.get(order.id);
        return {
          ...orderRest,
          customerPhoneDisplay: formatOrderCustomerPhoneDisplay(customerPhone, order.customerPhoneHash),
          mediaBuyerName: order.mediaBuyerId ? userNamesById.get(order.mediaBuyerId) ?? null : null,
          assignedCsName: order.assignedCsId ? userNamesById.get(order.assignedCsId) ?? null : null,
          primaryProductId: primary?.productId ?? null,
          primaryProductName: primary?.productName ?? null,
          itemCount: primary?.itemCount ?? 0,
          campaignName: order.campaignId ? campaignNames.get(order.campaignId) ?? null : null,
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
    if (branchId) base.push(eq(schema.orders.branchId, branchId));
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
    // Get current order
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, input.orderId), isNull(schema.orders.deletedAt)))
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

    // Permission gates: short-circuit for SUPER_ADMIN, otherwise resolve the actor's
    // canonical permission set once and reuse across the transition checks below.
    const transitionPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasPerm = (code: string) =>
      actor.role === 'SUPER_ADMIN' || transitionPerms.includes(canonicalPermissionCode(code));
    const sameBranchAsOrder =
      !!order.branchId && !!actor.currentBranchId && order.branchId === actor.currentBranchId;

    // CS-only transitions (engagement, confirm, cancel): assigned Sales closer, anyone with
    // Sales scope (`cs.scope.global`), or branch admin (`branches.manage` + same-branch).
    const csOnlyTransitions =
      (currentStatus === 'UNPROCESSED' && (newStatus === 'CS_ENGAGED' || newStatus === 'CANCELLED')) ||
      (currentStatus === 'CS_ASSIGNED' && (newStatus === 'CS_ENGAGED' || newStatus === 'CANCELLED')) ||
      (currentStatus === 'CS_ENGAGED' && (newStatus === 'CONFIRMED' || newStatus === 'CANCELLED'));
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
      } else if (newStatus === 'CANCELLED') {
        // Cancellation is restricted to Head of CS, a Branch Admin (same branch), or an
        // Admin. The assigned Sales closer can engage and confirm an order but can no
        // longer cancel it themselves (CEO directive 2026-05-20).
        if (!isElevated) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'Only Head of CS, a Branch Admin (same branch), or an Admin can cancel an order.',
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

    // CANCELLED → UNPROCESSED: restore a cancelled order back to the queue. Admin-only —
    // the order was never deleted from the database; it returns to the unassigned pool
    // for re-distribution (closer assignment cleared below). CEO directive 2026-05-20.
    if (currentStatus === 'CANCELLED' && newStatus === 'UNPROCESSED') {
      if (!isAdminLevel(actor)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only an Admin or Super Admin can restore a cancelled order.',
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

    // Clear lock when order moves past CS engagement
    if (
      newStatus === 'CONFIRMED' ||
      newStatus === 'CANCELLED'
    ) {
      updateFields['lockedUntil'] = null;
      updateFields['lockedBy'] = null;
    }

    // Restoring a cancelled order — send it back to the unassigned pool: drop the
    // previous closer + any stale lock so it re-enters CS distribution cleanly.
    if (currentStatus === 'CANCELLED' && newStatus === 'UNPROCESSED') {
      updateFields['assignedCsId'] = null;
      updateFields['lockedUntil'] = null;
      updateFields['lockedBy'] = null;
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
    const timelineType = timelineEventMap[newStatus];
    if (timelineType) {
      const reason = typeof input.metadata?.reason === 'string' ? input.metadata.reason : undefined;
      // Resolve the 3PL location name so the timeline reads
      // "Agent assigned for delivery at <Location>" instead of the generic logistics line.
      let logisticsLocationName: string | undefined;
      let reallocatedFromName: string | undefined;
      if (newStatus === 'AGENT_ASSIGNED' && typeof input.metadata?.logisticsLocationId === 'string') {
        const locRows = await this.db
          .select({ name: schema.logisticsLocations.name })
          .from(schema.logisticsLocations)
          .where(eq(schema.logisticsLocations.id, input.metadata.logisticsLocationId))
          .limit(1);
        logisticsLocationName = locRows[0]?.name ?? undefined;
      }
      if (
        currentStatus === 'AGENT_ASSIGNED' &&
        newStatus === 'AGENT_ASSIGNED' &&
        order.logisticsLocationId
      ) {
        const prevRows = await this.db
          .select({ name: schema.logisticsLocations.name })
          .from(schema.logisticsLocations)
          .where(eq(schema.logisticsLocations.id, order.logisticsLocationId))
          .limit(1);
        reallocatedFromName = prevRows[0]?.name ?? undefined;
      }
      void this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: timelineType,
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: this.buildTransitionActivityDescription(newStatus, {
          reason,
          preferredDeliveryDate:
            typeof input.metadata?.preferredDeliveryDate === 'string'
              ? input.metadata.preferredDeliveryDate
              : undefined,
          logisticsLocationName,
          reallocatedFromName,
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
      // Items may be adjusted any time before the goods physically leave the 3PL (DISPATCHED+).
      // Post-dispatch adjustments would conflict with the rider's pick list / stock already in-transit.
      const allowedStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED'];
      if (!allowedStatuses.includes(order.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Order items cannot be adjusted once the order has been dispatched.',
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
        const clamped = await this.clampOrderItemsToExistingUnitPrices(input.orderId, workingInput.items);
        workingInput = { ...workingInput, items: clamped.items, totalAmount: clamped.totalAmount };
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
        await tx
          .delete(schema.orderItems)
          .where(eq(schema.orderItems.orderId, input.orderId));

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
      void this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: 'ADDRESS_UPDATED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Delivery details updated by ${actorName}`,
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
      const paystackBranchId = await this.resolveBranchIdForNewOrder({
        campaignId: orderInput.campaignId ?? null,
        mediaBuyerId: orderInput.mediaBuyerId ?? null,
        fallbackBranchId: null,
      });

      const order = await withActor(this.db, { id: actorId }, async (tx) => {
        const rows = await tx
          .insert(schema.orders)
          .values({
            campaignId: orderInput.campaignId ?? null,
            mediaBuyerId: orderInput.mediaBuyerId ?? null,
            branchId: paystackBranchId ?? null,
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
        mediaBuyerId: order.mediaBuyerId ?? null,
      });
      this.notifications.enqueueCreateForRole('HEAD_OF_CS', {
        type: 'order:new',
        title: 'New order received',
        body: 'A new order needs attention.',
        data: { orderId: order.id },
      });
      this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
        type: 'order:new',
        title: 'New order received',
        body: 'A new order has been created.',
        data: { orderId: order.id },
      });
      if (order.mediaBuyerId) {
        const campaignNamePay = order.campaignId
          ? (
              await this.db
                .select({ name: schema.campaigns.name })
                .from(schema.campaigns)
                .where(eq(schema.campaigns.id, order.campaignId))
                .limit(1)
            )[0]?.name ?? null
          : null;
        const customerLabelPay = (order.customerName ?? '').trim() || 'A customer';
        const bodyPay = campaignNamePay
          ? `${customerLabelPay} just placed an order via ${campaignNamePay}.`
          : `${customerLabelPay} just placed an order from your campaign.`;
        this.notifications.enqueueCreate({
          userId: order.mediaBuyerId,
          type: 'order:new_campaign',
          title: 'New order from your campaign',
          body: bodyPay,
          data: { orderId: order.id, campaignId: order.campaignId ?? null, campaignName: campaignNamePay, customerName: customerLabelPay },
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
  async assignToCS(orderId: string, csCloserId: string, actor: SessionUser) {
    const existingRows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);

    if (!existingRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }
    const orderRow = existingRows[0];
    const ob = orderRow.branchId;
    if (!ob) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order has no branch context' });
    }
    await this.assertCanManualAssignToCs(actor, csCloserId, ob, orderRow.status);

    const updated = await withActor(this.db, actor, async (tx) => {
      const updatedRows = await tx
        .update(schema.orders)
        .set({
          assignedCsId: csCloserId,
          status: 'CS_ASSIGNED',
          updatedAt: new Date(),
        })
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
    // Notify cs-all so CS overview (Head of CS) refreshes
    this.events.emitToRoom('cs-all', 'order:assigned', {
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

    // Timeline event: manually assigned (or reassigned if a previous owner existed)
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
    const verb = isReassignment ? 'Reassigned' : 'Assigned';
    const fromClause = isReassignment ? ` from ${previousAgentName ?? previousCsAgentId}` : '';
    void this.writeTimelineEvent({
      orderId,
      eventType: isReassignment ? 'ORDER_REASSIGNED' : 'ORDER_MANUALLY_ASSIGNED',
      actorId: actor.id,
      actorName: actor.name ?? null,
      description: `${verb} to ${agentName ?? csCloserId}${fromClause} by ${actor.name ?? 'Head of CS'}`,
      metadata: isReassignment
        ? { csCloserId, fromAgentId: previousCsAgentId, toAgentId: csCloserId }
        : { csCloserId },
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
  async listCSClosers(actor: SessionUser): Promise<Array<{ agentId: string; agentName: string }>> {
    const hasReassign =
      (actor.permissions ?? [])
        .map((p) => canonicalPermissionCode(p))
        .includes(canonicalPermissionCode('orders.reassign'));
    if (actor.role === 'SUPER_ADMIN' || hasReassign) {
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

  /**
   * Get order counts by status — for dashboard stats.
   * Optional mediaBuyerId filters to that buyer's orders (for Marketing Orders page).
   * Optional assignedCsId filters to that Sales closer's orders (for Sales Orders page).
   * Optional logisticsLocationId filters to that 3PL location (for Logistics Orders page / TPL_MANAGER scoping).
   * Optional startDate/endDate filter by orders.createdAt (when provided: counts = orders created in period).
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
  ) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];
    appendOrdersAggregateScopeConditions(conditions, {
      mediaBuyerId,
      assignedCsId,
      supervisorScope,
    });
    if (logisticsLocationId) conditions.push(eq(schema.orders.logisticsLocationId, logisticsLocationId));
    if (statuses?.length) conditions.push(inArray(schema.orders.status, statuses));
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));
    if (startDate) conditions.push(gte(schema.orders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      if (!endDate.includes('T')) end.setHours(23, 59, 59, 999);
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
   * Get order pipeline chart data — Volume, Unconfirmed, Confirmed, Logistics distributed, Delivered.
   * For the CEO Executive Overview order funnel chart. Same date filter as getStatusCounts (created_at).
   */
  async getOrderPipelineChart(startDate?: string, endDate?: string, branchId?: string | null): Promise<{
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
    );
    const volume = Object.values(counts).reduce((sum, c) => sum + (c ?? 0), 0);
    return {
      volume,
      unconfirmed: counts['CS_ENGAGED'] ?? 0,
      confirmed: counts['CONFIRMED'] ?? 0,
      logisticsDistributed: (counts['AGENT_ASSIGNED'] ?? 0) + (counts['DISPATCHED'] ?? 0),
      delivered: counts['DELIVERED'] ?? 0,
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
  ): Promise<Record<string, number>> {
    const conditions: Parameters<typeof and>[0][] = [
      inArray(schema.orderTimelineEvents.eventType, ['ORDER_CONFIRMED', 'ORDER_CANCELLED']),
      sql`(timezone('Africa/Lagos', ${schema.orderTimelineEvents.createdAt}))::date = (timezone('Africa/Lagos', now()))::date`,
      sql`${schema.orders.assignedCsId} IS NOT NULL`,
      isNull(schema.orders.deletedAt),
    ];
    if (branchId) {
      conditions.push(eq(schema.orders.branchId, branchId));
    }
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
    opts?: { pendingCountsAcrossAllBranches?: boolean },
  ) {
    const pendingCountsAcrossAllBranches = opts?.pendingCountsAcrossAllBranches === true;

    const agentsPromise = branchId
      ? this.db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            capacity: schema.users.capacity,
            lastActionAt: schema.users.lastActionAt,
          })
          .from(schema.users)
          .innerJoin(
            schema.userBranches,
            and(
              eq(schema.userBranches.userId, schema.users.id),
              eq(schema.userBranches.branchId, branchId),
            ),
          )
          .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE')))
      : this.db
          .select({
            id: schema.users.id,
            name: schema.users.name,
            capacity: schema.users.capacity,
            lastActionAt: schema.users.lastActionAt,
          })
          .from(schema.users)
          .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE')));

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
            ...(branchId && !pendingCountsAcrossAllBranches ? [eq(schema.orders.branchId, branchId)] : []),
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
  async getCloserWorkloadOrdersWithItems(agentId: string, branchId?: string | null) {
    const workloadStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'] as const;
    const conditions = [
      eq(schema.orders.assignedCsId, agentId),
      inArray(schema.orders.status, [...workloadStatuses]),
    ];
    if (branchId) {
      conditions.push(eq(schema.orders.branchId, branchId));
    }

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
  async getDeliveredOrdersTimeSeries(startDate?: string, endDate?: string, branchId?: string | null): Promise<{ date: string; revenue: number; orderCount: number }[]> {
    const conditions: Parameters<typeof and>[0][] = [
      eq(schema.orders.status, 'DELIVERED'),
      sql`${schema.orders.deliveredAt} IS NOT NULL`,
    ];
    if (startDate) conditions.push(gte(schema.orders.deliveredAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.deliveredAt, end));
    }
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));
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
  async getDeliveriesByProduct(branchId?: string | null): Promise<
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
      eq(schema.orders.status, 'DELIVERED'),
      gte(schema.orders.deliveredAt, monthStartUtc), // bounds scan to current month
    ];
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));

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
  async getRevenueByPeriod(branchId?: string | null): Promise<{
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
      eq(schema.orders.status, 'DELIVERED'),
      gte(schema.orders.deliveredAt, monthStartUtc), // bounds scan to current month
    ];
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));

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
  ): Promise<{ date: string; deliveredCount: number }[]> {
    const conditions: Parameters<typeof and>[0][] = [
      isNull(schema.orders.deletedAt),
      eq(schema.orders.status, 'DELIVERED'),
      sql`${schema.orders.deliveredAt} IS NOT NULL`,
    ];
    if (startDate) conditions.push(gte(schema.orders.deliveredAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.deliveredAt, end));
    }
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));
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
  ): Promise<{ date: string; orderCount: number; deliveredCount: number }[]> {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];
    if (startDate) conditions.push(gte(schema.orders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      // Skip the end-of-day bump for ISO datetimes — see listOrders for full reasoning.
      if (!endDate.includes('T')) end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, end));
    }
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));
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
      this.getOrdersTimeSeriesByDelivered(startDate, endDate, branchId, extra),
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
  async getInactiveAgents(thresholdMinutes = 10, branchId?: string | null) {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const agents = await (branchId
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
              eq(schema.userBranches.branchId, branchId),
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
          ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
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
  ) {
    const useCustomRange = startDate && endDate;
    const periodStart = useCustomRange
      ? new Date(startDate)
      : period === 'this_month'
        ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        : null;
    let periodEnd: Date | null = useCustomRange ? new Date(endDate) : null;
    if (periodEnd) periodEnd.setHours(23, 59, 59, 999);

    const agents = await (branchId
      ? this.db
          .select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .innerJoin(
            schema.userBranches,
            and(
              eq(schema.userBranches.userId, schema.users.id),
              eq(schema.userBranches.branchId, branchId),
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
    const cancelledStatus = sql`${schema.orders.status} = 'CANCELLED'`;
    const deliveredOrRemitted = sql`${schema.orders.status} IN ('DELIVERED','REMITTED')`;
    const callCompleted = sql`${schema.callLogs.callStatus} = 'COMPLETED'`;

    // Date range conditions reused inside each grouped query's WHERE clause.
    const orderDateFilter = periodStart
      ? periodEnd
        ? and(gte(schema.orders.createdAt, periodStart), lte(schema.orders.createdAt, periodEnd))
        : gte(schema.orders.createdAt, periodStart)
      : undefined;
    const deliveredDateFilter = periodStart
      ? periodEnd
        ? and(gte(schema.orders.deliveredAt, periodStart), lte(schema.orders.deliveredAt, periodEnd))
        : gte(schema.orders.deliveredAt, periodStart)
      : undefined;
    const callLogsDateFilter = periodStart
      ? periodEnd
        ? and(gte(schema.callLogs.startedAt, periodStart), lte(schema.callLogs.startedAt, periodEnd))
        : gte(schema.callLogs.startedAt, periodStart)
      : undefined;

    const orderWhere = and(
      inArray(schema.orders.assignedCsId, agentIds),
      ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
      ...(orderDateFilter ? [orderDateFilter] : []),
    );
    const deliveredWhere = and(
      inArray(schema.orders.assignedCsId, agentIds),
      deliveredOrRemitted,
      ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
      ...(deliveredDateFilter ? [deliveredDateFilter] : []),
    );

    const [orderRows, deliveredRows, callRows] = await Promise.all([
      this.db
        .select({
          agentId: schema.orders.assignedCsId,
          engaged: sql<number>`COUNT(*)::int`,
          confirmed: sql<number>`COUNT(*) FILTER (WHERE ${confirmedOrBeyond})::int`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${cancelledStatus})::int`,
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
                eq(schema.orders.branchId, branchId),
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

      const engagedOrCancelled = ord.confirmed + ord.cancelled;
      const confirmationRate = engagedOrCancelled > 0 ? (ord.confirmed / engagedOrCancelled) * 100 : 0;
      const deliveryRate = ord.confirmed > 0 ? (ordersDelivered / ord.confirmed) * 100 : 0;

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
    const workloads = await this.getCSCloserWorkloads(servicingBranchId ?? undefined, {
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
    this.events.emitToRoom('cs-all', 'order:assigned', { orderId }, orderRow?.branchId ?? null);
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
      // Claim mode: leave order in UNPROCESSED, broadcast to claim queue
      this.events.emitToRoom('cs-all', 'order:claim_available', { orderId }, branchId);
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
      .select({ customerName: schema.orders.customerName, branchId: schema.orders.branchId })
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
    }, claimedRow?.branchId ?? actor.currentBranchId ?? null);
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
      branchId: claimedRow?.branchId ?? actor.currentBranchId ?? null,
    });

    return { success: true };
  }

  /**
   * Get all UNPROCESSED orders available for claiming (claim mode only).
   * Sorted oldest-first so longer-waiting orders are visible first.
   */
  async getClaimQueue(branchId?: string | null): Promise<Array<{
    id: string;
    customerName: string;
    createdAt: Date;
    status: string;
    totalAmount: string | null;
    productSummary: string;
  }>> {
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
          ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
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
        break;
      }

      case 'CANCELLED': {
        if (previousOrder.status === 'CONFIRMED') {
          for (const item of orderItems) {
            await this.db.insert(schema.stockMovements).values({
              productId: item.productId,
              movementType: 'ADJUSTMENT',
              quantity: item.quantity,
              referenceId: updatedOrder.id,
              reason: `Released: order ${updatedOrder.id} cancelled`,
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
      // Auto-cancel: max callback attempts reached
      await withActor(this.db, actor, async (tx) =>
        tx
          .update(schema.orders)
          .set({
            status: 'CANCELLED',
            callbackScheduledAt: null,
            callbackNotes: `Auto-cancelled: max callback attempts (${maxAttempts}) reached`,
            updatedAt: new Date(),
          })
          .where(eq(schema.orders.id, orderId)),
      );

      this.events.emitOrderStatusChange({
        orderId,
        oldStatus: order.status,
        newStatus: 'CANCELLED',
        assignedCsId: order.assignedCsId,
        mediaBuyerId: order.mediaBuyerId,
        logisticsLocationId: order.logisticsLocationId,
        riderId: order.riderId,
        branchId: order.branchId ?? null,
      });

      // Notify Head of CS about max-retry cancellation
      this.events.emitToRoom('cs-all', 'callback:max_reached', {
        orderId,
        customerName: order.customerName,
        attempts: currentAttempts,
      }, order.branchId ?? null);
      void this.writeTimelineEvent({
        orderId,
        eventType: 'ORDER_CANCELLED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Order cancelled after ${currentAttempts} callback attempts`,
        branchId: order.branchId ?? null,
      });

      return { action: 'auto_cancelled', attempts: currentAttempts, maxAttempts };
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
  async getScheduledCallbacks(branchId?: string | null) {
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
          ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
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
   * Uses a Redis set to avoid duplicate notifications for the same order.
   */
  @Cron('0 */2 * * * *')
  async handleDueCallbacks(): Promise<void> {
    try {
      const dueOrders = await this.getCallbackQueue();
      for (const order of dueOrders) {
        if (!order.assignedCsId) continue;

        // Prevent duplicate notifications — Redis key expires after 30 minutes
        const dedupKey = `callback_notified:${order.id}:${order.callbackAttempts ?? 0}`;
        const alreadyNotified = await this.redis.get(dedupKey);
        if (alreadyNotified) continue;

        await this.redis.set(dedupKey, '1', 'EX', 1800);

        this.notifications.enqueueCreate({
          userId: order.assignedCsId,
          type: 'order:callback_due',
          title: 'Callback due now',
          body: `Order ${order.id.slice(0, 8)}... is due for a callback. Attempt ${order.callbackAttempts ?? 0}/3.`,
          data: { orderId: order.id },
        });

        // Also push to the CS room so the queue tab refreshes
        this.events.emitToRoom('cs-all', 'order:callback_due', { orderId: order.id }, order.branchId ?? null);
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
  async getFlaggedDuplicates(branchId?: string | null) {
    const flagged = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          inArray(schema.orders.isDuplicate, ['FLAGGED', 'POSSIBLY_DUPLICATE']),
          ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
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
            ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
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

  private async findRecentPhoneOrder(phoneHash: string) {
    const [recent] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerPhoneHash, phoneHash),
          sql`${schema.orders.createdAt} >= NOW() - INTERVAL '24 hours'`,
          sql`${schema.orders.status} != 'CANCELLED'`,
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(1);
    return recent ?? null;
  }

  /**
   * Soft-duplicate detection: same phone, non-cancelled order older than the
   * 24h hard-flag window but within the past 30 days. Lets HoCS still spot
   * "this customer ordered something a week ago, is this a real new order or
   * a confused resubmission?" without the rapid-fire urgency of FLAGGED.
   */
  private async findHistoricalSamePhoneOrder(phoneHash: string) {
    const [recent] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerPhoneHash, phoneHash),
          sql`${schema.orders.createdAt} < NOW() - INTERVAL '24 hours'`,
          sql`${schema.orders.createdAt} >= NOW() - INTERVAL '30 days'`,
          sql`${schema.orders.status} != 'CANCELLED'`,
        ),
      )
      .orderBy(desc(schema.orders.createdAt))
      .limit(1);
    return recent ?? null;
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
    const order = await this.getById(orderId);
    this.assertActorMayViewOrderForRead(actor, order);

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
      reallocatedFromName?: string;
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
      case 'UNPROCESSED':
        return 'Cancelled order restored to the unprocessed queue';
      case 'AGENT_ASSIGNED':
        if (
          options?.reallocatedFromName &&
          options?.logisticsLocationName
        ) {
          return `Delivery assignment moved from ${options.reallocatedFromName} to ${options.logisticsLocationName}`;
        }
        return options?.logisticsLocationName
          ? `Agent assigned for delivery at ${options.logisticsLocationName}`
          : 'Agent assigned for delivery (logistics)';
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
   */
  async getBranchBreakdown(startDate?: string, endDate?: string): Promise<Array<{
    branchId: string;
    branchName: string;
    branchCode: string;
    totalOrders: number;
    deliveredOrders: number;
    activeOrders: number;
  }>> {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];
    if (startDate) conditions.push(gte(schema.orders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, end));
    }
    const whereClause = and(...conditions);

    // Join orders with branches to get per-branch counts
    const rows = await this.db
      .select({
        branchId: schema.branches.id,
        branchName: schema.branches.name,
        branchCode: schema.branches.code,
        status: schema.orders.status,
        orderCount: count(),
      })
      .from(schema.orders)
      .innerJoin(schema.branches, eq(schema.orders.branchId, schema.branches.id))
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
      if (row.status === 'DELIVERED') entry.deliveredOrders += row.orderCount;
      if (ACTIVE_STATUSES.has(row.status)) entry.activeOrders += row.orderCount;
    }

    return Array.from(byBranch.values()).sort((a, b) => b.totalOrders - a.totalOrders);
  }
}
