import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import { randomUUID, createHash } from 'crypto';
import { eq, and, desc, asc, sql, ilike, or, count, gte, lte, inArray, exists, isNull } from 'drizzle-orm';
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
  type OrderStatus,
  customFormFieldSchema,
  getMissingRequiredCustomFormLabels,
  z,
} from '@yannis/shared';
import { EDGE_FORM_ACTOR_ID, canonicalPermissionCode } from '@yannis/shared';
import { DRIZZLE, REDIS } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
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

const PENDING_PAYMENT_PREFIX = 'pending_payment:';
const PENDING_PAYMENT_TTL_SECONDS = 3600; // 1 hour

/** Pre-confirmation orders only — avoids inventory side effects on soft-archive. */
const ARCHIVABLE_ORDER_STATUSES = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED'] as const;

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
  ) {}

  /** HoCS / Admin / `orders.reassign`, or CS team supervisor for same-branch team (supervisor: UNPROCESSED / CS_ASSIGNED only). */
  private async assertCanManualAssignToCs(
    actor: SessionUser,
    csAgentId: string,
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
    const ok = await this.branchTeams.isCsSupervisorOf(actor.id, csAgentId, orderBranchId);
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
   * `logistics.scope.global` → any branch; otherwise same-branch only; CS team supervisors
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

  /** Branch CS team: actor is a supervisor row for this assignee on this branch. */
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

    // CS team supervisor for the assignee in same branch.
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

    const totalAmount = nextItems.reduce((sum, row) => sum + row.quantity * row.unitPrice, 0);
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

    const recipientIds = new Set<string>();
    const admins = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.status, 'ACTIVE'), inArray(schema.users.role, ['SUPER_ADMIN', 'ADMIN'])));
    for (const r of admins) {
      if (r.id !== params.excludeUserId) recipientIds.add(r.id);
    }

    if (params.branchId) {
      const heads = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.status, 'ACTIVE'),
            inArray(schema.users.role, ['HEAD_OF_CS', 'HEAD_OF_LOGISTICS', 'BRANCH_ADMIN']),
            eq(schema.users.primaryBranchId, params.branchId),
          ),
        );
      for (const r of heads) {
        if (r.id !== params.excludeUserId) recipientIds.add(r.id);
      }
    }

    for (const userId of recipientIds) {
      await this.notifications
        .create({
          userId,
          type: 'approval:permission_request',
          title,
          body,
          data,
        })
        .catch(() => {});
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

    const recipientIds = new Set<string>();
    const admins = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.status, 'ACTIVE'), inArray(schema.users.role, ['SUPER_ADMIN', 'ADMIN'])));
    for (const r of admins) {
      if (r.id !== params.excludeUserId) recipientIds.add(r.id);
    }

    if (params.branchId) {
      const heads = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.status, 'ACTIVE'),
            inArray(schema.users.role, ['HEAD_OF_CS', 'HEAD_OF_LOGISTICS', 'BRANCH_ADMIN']),
            eq(schema.users.primaryBranchId, params.branchId),
          ),
        );
      for (const r of heads) {
        if (r.id !== params.excludeUserId) recipientIds.add(r.id);
      }
    }

    for (const userId of recipientIds) {
      await this.notifications
        .create({
          userId,
          type: 'approval:permission_request',
          title,
          body,
          data,
        })
        .catch(() => {});
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

    const allowedStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'ALLOCATED'];
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

    const sumLines = input.items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
    if (Math.abs(sumLines - input.totalAmount) > 0.02) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Total amount must match the sum of quantity × unit price for all lines.',
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
          'Only Head of CS, Head of Logistics, Branch Admin, a CS team supervisor for the assignee, or an Admin may archive this order.',
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

    const branchId = await this.resolveBranchIdForNewOrder({
      campaignId: orderInput.campaignId ?? null,
      mediaBuyerId: orderInput.mediaBuyerId ?? null,
      fallbackBranchId: null,
    });

    // Cross-funnel attempt detection (Pillar 2 / attribution truth):
    // If an order with the same phone+product already exists in the last 6h via a
    // DIFFERENT Media Buyer, do NOT create a new order. Record the attempt in
    // cross_funnel_attempts so the second MB can see their funnel got traction —
    // but the original MB keeps attribution. CS never sees this row; it does not
    // count in any order metric. Only applies to edge-form submissions with a
    // mediaBuyerId. Direct API callers (admin/CS offline entry) skip this path.
    if (orderSource === 'edge-form' && orderInput.mediaBuyerId && orderInput.customerPhoneHash) {
      const productIds = orderInput.items.map((i) => i.productId);
      const existing = await this.detectDuplicates(orderInput.customerPhoneHash, productIds);
      const crossMbWinner = existing.find(
        (o) => o.mediaBuyerId && o.mediaBuyerId !== orderInput.mediaBuyerId,
      );
      if (crossMbWinner) {
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
        );
        return { crossFunnelAttempt: true };
      }
    }
    const recentSamePhoneOrder = orderInput.customerPhoneHash
      ? await this.findRecentPhoneOrder(orderInput.customerPhoneHash)
      : null;

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
          isDuplicate: recentSamePhoneOrder ? 'FLAGGED' : null,
          duplicateOfId: recentSamePhoneOrder?.id ?? null,
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

    // Notify Head of CS + Head of Marketing only on new order (not every CS agent — they get
    // order:assigned when Hot Swap / auto-dispatch / claim assigns them). SuperAdmin excluded (volume).
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
      this.notifications
        .create({
          userId: order.mediaBuyerId,
          type: 'order:new_campaign',
          title: 'New order from your campaign',
          body,
          data: { orderId: order.id, campaignId: order.campaignId ?? null, campaignName, customerName: customerLabel },
        })
        .catch(() => {});
    }

    // Auto-dispatch to least-loaded CS agent
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

    this.writeTimelineEvent({
      orderId: order.id,
      eventType: 'ORDER_RECEIVED',
      actorId: receivedActorId,
      actorName: receivedActorName,
      description: receivedDescription,
      metadata:
        mediaBuyerName && order.mediaBuyerId
          ? { mediaBuyerId: order.mediaBuyerId, mediaBuyerName }
          : undefined,
    });

    // Mark cart as CONVERTED if cartId was provided (same actor as order create for audit)
    if (cartId) {
      await this.cartService.convert(cartId, order.id, actorId ?? undefined);
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
          'Possible duplicate: order(s) with same customer phone in the last 6 hours. Merge or dismiss existing before creating an offline order.',
      });
    }

    const branchId = await this.resolveBranchIdForNewOrder({
      campaignId: input.campaignId ?? null,
      mediaBuyerId: input.mediaBuyerId ?? null,
      fallbackBranchId: sessionBranchId ?? null,
    });
    const recentSamePhoneOrder = await this.findRecentPhoneOrder(customerPhoneHash);

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
          isDuplicate: recentSamePhoneOrder ? 'FLAGGED' : null,
          duplicateOfId: recentSamePhoneOrder?.id ?? null,
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

    this.events.emitNewOrder({
      orderId: order.id,
      productName: 'Offline order created',
      branchId: order.branchId ?? null,
      mediaBuyerId: order.mediaBuyerId ?? null,
    });
    this.events.emitToUser(actorId, 'order:assigned', { orderId: order.id });
    this.events.emitToRoom('cs-all', 'order:new', { orderId: order.id }, order.branchId ?? null);

    this.notifications
      .create({
        userId: actorId,
        type: 'order:assigned',
        title: 'Offline order created',
        body: 'You created an offline order. It is assigned to you.',
        data: { orderId: order.id },
      })
      .catch(() => {});

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

    this.writeTimelineEvent({
      orderId: order.id,
      eventType: 'ORDER_RECEIVED',
      actorId: actorId,
      actorName,
      description: `Offline order created${mbSuffix}`,
      metadata:
        mediaBuyerName && order.mediaBuyerId
          ? { mediaBuyerId: order.mediaBuyerId, mediaBuyerName }
          : undefined,
    });

    return { id: order.id };
  }

  /** SHA-256 hash of phone for offline order creation (server-side only). */
  private hashPhone(phone: string): string {
    return createHash('sha256').update(phone.trim()).digest('hex');
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
  async getById(orderId: string) {
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
      .limit(1);

    const order = rows[0];
    if (!order) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    }

    // Get order items with product name
    const itemRows = await this.db
      .select({
        id: schema.orderItems.id,
        orderId: schema.orderItems.orderId,
        productId: schema.orderItems.productId,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, orderId));

    const items = itemRows.map((row) => ({
      id: row.id,
      orderId: row.orderId,
      productId: row.productId,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      productName: row.productName ?? null,
    }));

    // Get call logs
    const calls = await this.db
      .select()
      .from(schema.callLogs)
      .where(eq(schema.callLogs.orderId, orderId))
      .orderBy(desc(schema.callLogs.startedAt));

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

    const [userRows, campaignRow, providerRow, locationRow] = await Promise.all([
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

    // Look up delivery remittance status for this order (if any)
    const remittanceRow = await this.db
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
      .limit(1);

    const remittanceStatus = remittanceRow[0]?.remittanceStatus ?? null;
    const remittanceId = remittanceRow[0]?.remittanceId ?? null;

    const pendingOrderLinePriceRequestId = await this.findPendingOrderLinePriceRequestId(orderId);
    const pendingOrderDeletionRequestId = await this.findPendingOrderDeletionRequestId(orderId);

    const { customerPhone: _rawPhone, ...orderSafe } = order;
    return {
      ...orderSafe,
      customerPhoneDisplay: this.maskPhone(order.customerPhoneHash),
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

  async listAllocatableLocations(
    orderId: string,
    viewerRole?: string | null,
  ): Promise<Array<{
    id: string;
    name: string;
    address: string | null;
    whatsappGroupLink: string | null;
    providerName: string | null;
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
      })
      .from(schema.logisticsLocations)
      .leftJoin(
        schema.logisticsProviders,
        eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId),
      )
      .where(eq(schema.logisticsLocations.status, 'ACTIVE'))
      .orderBy(asc(schema.logisticsLocations.name));

    // CS_AGENT must NOT see remaining-stock numbers (per CEO directive). Hide both the
    // per-product availability array AND the leaky "have X" details inside the reason text.
    // Everyone else with allocate authority (HoCS, HoLogistics, LogisticsManager, TPL_MANAGER,
    // BranchAdmin, StockManager, Admin, SuperAdmin, ...) sees the full breakdown.
    const hideStockCounts = viewerRole === 'CS_AGENT';

    type LocationResult = {
      id: string;
      name: string;
      address: string | null;
      whatsappGroupLink: string | null;
      providerName: string | null;
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

    for (const location of locations) {
      const isLocked = await this.inventoryService.isDispatchLocked(location.id);
      if (isLocked) {
        results.push({
          ...location,
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
        const levelRows = await this.db
          .select({
            stockCount: schema.inventoryLevels.stockCount,
            reservedCount: schema.inventoryLevels.reservedCount,
          })
          .from(schema.inventoryLevels)
          .where(and(
            eq(schema.inventoryLevels.productId, productId),
            eq(schema.inventoryLevels.locationId, location.id),
          ))
          .limit(1);

        const level = levelRows[0];
        const available = level ? level.stockCount - level.reservedCount : 0;
        availabilityByProduct.push({
          productId,
          productName: need.name,
          needed: need.qty,
          available,
        });

        if (detailedReason == null) {
          if (!level) {
            detailedReason = `No inventory row for ${need.name}. Receive stock first.`;
            genericReason = 'No inventory at this location.';
          } else if (available < need.qty) {
            detailedReason = `Insufficient ${need.name} stock (need ${need.qty}, have ${available}).`;
            genericReason = 'Insufficient stock for one or more products.';
          }
        }
      }

      results.push({
        ...location,
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
      await this.transition(
        { orderId, newStatus: 'CS_ENGAGED' },
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
    const callableStatuses = ['CS_ENGAGED', 'CONFIRMED', 'ALLOCATED', 'DISPATCHED', 'IN_TRANSIT'];
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
   * List orders with filtering, search, and pagination.
   */
  async list(input: ListOrdersInput, branchId?: string | null) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];

    if (input.status) {
      conditions.push(eq(schema.orders.status, input.status));
    }
    if (input.statuses?.length) {
      conditions.push(inArray(schema.orders.status, input.statuses));
    }
    if (input.assignedCsId) {
      conditions.push(eq(schema.orders.assignedCsId, input.assignedCsId));
    }
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.orders.mediaBuyerId, input.mediaBuyerId));
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
    if (input.search) {
      conditions.push(
        or(
          ilike(schema.orders.customerName, `%${input.search}%`),
          ilike(schema.orders.id, `%${input.search}%`),
        ),
      );
    }
    if (input.startDate) {
      conditions.push(gte(schema.orders.createdAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, end));
    }
    if (branchId) {
      conditions.push(eq(schema.orders.branchId, branchId));
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

    const [orders, totalRows] = await Promise.all([
      this.db
        .select()
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

    const mediaBuyerIds = [...new Set(orders.map((o) => o.mediaBuyerId).filter(Boolean))] as string[];
    let mediaBuyerNames: Map<string, string> = new Map();
    if (mediaBuyerIds.length > 0) {
      const users = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, mediaBuyerIds));
      users.forEach((u) => mediaBuyerNames.set(u.id, u.name));
    }

    const assignedCsIds = [...new Set(orders.map((o) => o.assignedCsId).filter(Boolean))] as string[];
    let assignedCsNames: Map<string, string> = new Map();
    if (assignedCsIds.length > 0) {
      const csUsers = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, assignedCsIds));
      csUsers.forEach((u) => assignedCsNames.set(u.id, u.name));
    }

    return {
      orders: orders.map((order) => ({
        ...order,
        customerPhoneDisplay: this.maskPhone(order.customerPhoneHash),
        mediaBuyerName: order.mediaBuyerId ? mediaBuyerNames.get(order.mediaBuyerId) ?? null : null,
        assignedCsName: order.assignedCsId ? assignedCsNames.get(order.assignedCsId) ?? null : null,
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

    // CS-only transitions (engagement, confirm, cancel): assigned CS agent, anyone with
    // CS scope (`cs.scope.global`), or branch admin (`branches.manage` + same-branch).
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
      } else {
        const isAssignedCs = order.assignedCsId === actor.id;
        if (!isElevated && !isAssignedCs) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message:
              'Only the assigned CS agent, anyone with CS scope, a Branch Admin (same branch), or an Admin may perform this transition.',
          });
        }
      }
    }

    // CONFIRMED → ALLOCATED: assigned CS agent (CS-as-rider-proxy), anyone with logistics
    // capability (`logistics.read` covers HoLogistics + LogisticsManager), or org-wide CS scope.
    if (currentStatus === 'CONFIRMED' && newStatus === 'ALLOCATED') {
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
          message: 'Only the assigned CS agent, Logistics, or an Admin can allocate this order to a 3PL location.',
        });
      }
    }

    // {ALLOCATED|DISPATCHED|IN_TRANSIT} → DELIVERED/PARTIALLY_DELIVERED:
    //   - anyone holding `orders.delivery.confirm` (HoLogistics, CS, TPL_MANAGER w/ receipt, Admin via ALL),
    //   - assigned CS agent (rider-proxy follow-up call),
    //   - TPL_MANAGER specifically requires the receipt to be present (resolveReceiptUrl).
    //   3PL isn't in-app yet, so CS / HoLogistics marks delivered directly after ALLOCATED.
    if (
      (currentStatus === 'ALLOCATED' || currentStatus === 'DISPATCHED' || currentStatus === 'IN_TRANSIT') &&
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

    // Save preferred delivery date on CONFIRMED (set by CS agent via confirm modal)
    if (newStatus === 'CONFIRMED' && input.metadata?.preferredDeliveryDate) {
      updateFields['preferredDeliveryDate'] = input.metadata.preferredDeliveryDate;
    }

    // Clear lock when order moves past CS engagement
    if (
      newStatus === 'CONFIRMED' ||
      newStatus === 'CANCELLED'
    ) {
      updateFields['lockedUntil'] = null;
      updateFields['lockedBy'] = null;
    }

    // Update agent's lastActionAt for dispatch tiebreaker + inactivity tracking.
    // Tracked for anyone with CS scope (CS agents, anyone with cs.scope.global, etc.).
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
    }
    if (input.metadata?.riderId) {
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
        await this.autoCreateInvoiceForOrder(order.id, actor);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Auto-invoice for order ${order.id} failed: ${message}`);
      }
    }

    // Timeline event for this status transition
    const timelineEventMap: Partial<Record<string, string>> = {
      CS_ENGAGED: 'CALL_INITIATED',
      CONFIRMED: 'ORDER_CONFIRMED',
      CANCELLED: 'ORDER_CANCELLED',
      ALLOCATED: 'ORDER_ALLOCATED',
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
      // "Order allocated to <Location>" instead of the generic "…logistics".
      let logisticsLocationName: string | undefined;
      if (newStatus === 'ALLOCATED' && typeof input.metadata?.logisticsLocationId === 'string') {
        const locRows = await this.db
          .select({ name: schema.logisticsLocations.name })
          .from(schema.logisticsLocations)
          .where(eq(schema.logisticsLocations.id, input.metadata.logisticsLocationId))
          .limit(1);
        logisticsLocationName = locRows[0]?.name ?? undefined;
      }
      this.writeTimelineEvent({
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
        }),
        metadata: input.metadata as Record<string, unknown> | undefined,
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
      const allowedStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'ALLOCATED'];
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

    const actorName = actor.name ?? 'CS agent';
    if (
      workingInput.customerAddress !== undefined ||
      workingInput.deliveryAddress !== undefined ||
      workingInput.deliveryNotes !== undefined ||
      workingInput.deliveryState !== undefined ||
      workingInput.preferredDeliveryDate !== undefined ||
      workingInput.customFields !== undefined
    ) {
      this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: 'ADDRESS_UPDATED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Delivery details updated by ${actorName}`,
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
      this.writeTimelineEvent({
        orderId: input.orderId,
        eventType: 'QUANTITY_UPDATED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Order quantity updated from ${oldQty} to ${newQty} by ${actorName}`,
      });
    }

    return {
      ...updated,
      customerPhoneDisplay: this.maskPhone(updated.customerPhoneHash),
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
        const sum = payload.items.reduce(
          (acc, item) => acc + (Number(item.quantity) || 0) * (parseFloat(String(item.unitPrice)) || 0),
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
      this.notifications.createForRole('HEAD_OF_CS', { type: 'order:new', title: 'New order received', body: 'A new order needs attention.', data: { orderId: order.id } }).catch(() => {});
      this.notifications.createForRole('HEAD_OF_MARKETING', { type: 'order:new', title: 'New order received', body: 'A new order has been created.', data: { orderId: order.id } }).catch(() => {});
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
        this.notifications
          .create({
            userId: order.mediaBuyerId,
            type: 'order:new_campaign',
            title: 'New order from your campaign',
            body: bodyPay,
            data: { orderId: order.id, campaignId: order.campaignId ?? null, campaignName: campaignNamePay, customerName: customerLabelPay },
          })
          .catch(() => {});
      }
      const mediaBuyerNamePay = order.mediaBuyerId
        ? await this.resolveUserNameById(order.mediaBuyerId)
        : null;
      const mbSuffixPay = mediaBuyerNamePay
        ? ` — attributed to media buyer ${mediaBuyerNamePay}`
        : '';
      this.autoDispatchToCS(order.id).catch(() => {});
      this.writeTimelineEvent({
        orderId: order.id,
        eventType: 'ORDER_RECEIVED',
        actorId: actorId,
        actorName: 'Edge form',
        description: `Order received from sales form${mbSuffixPay}`,
        metadata:
          mediaBuyerNamePay && order.mediaBuyerId
            ? { mediaBuyerId: order.mediaBuyerId, mediaBuyerName: mediaBuyerNamePay }
            : undefined,
      });
      this.writeTimelineEvent({
        orderId: order.id,
        eventType: 'PAYMENT_RECEIVED',
        actorId: actorId,
        actorName: 'Paystack',
        description: 'Online payment received',
        metadata: { paymentReference: reference },
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
      .select({ totalAmount: schema.orders.totalAmount, paymentStatus: schema.orders.paymentStatus })
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
    this.writeTimelineEvent({
      orderId,
      eventType: 'PAYMENT_RECEIVED',
      actorId: null,
      actorName: 'Paystack',
      description: 'Online payment received',
      metadata: { paymentReference: reference },
    });
    return { orderId, success: true };
  }

  /**
   * Manually assign an order to a CS agent.
   * Callers with `orders.reassign` (HoCS / Admin), or a branch CS team supervisor for in-team agents
   * on orders in UNPROCESSED or CS_ASSIGNED (supervisors only).
   */
  async assignToCS(orderId: string, csAgentId: string, actor: SessionUser) {
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
    await this.assertCanManualAssignToCs(actor, csAgentId, ob, orderRow.status);

    const updated = await withActor(this.db, actor, async (tx) => {
      const updatedRows = await tx
        .update(schema.orders)
        .set({
          assignedCsId: csAgentId,
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
    this.events.emitToUser(csAgentId, 'order:assigned', {
      orderId,
      customerName: updated.customerName,
    });
    // Notify cs-all so CS overview (Head of CS) refreshes
    this.events.emitToRoom('cs-all', 'order:assigned', {
      orderId,
      customerName: updated.customerName,
    }, updated.branchId ?? null);
    this.notifications
      .create({
        userId: csAgentId,
        type: 'order:assigned',
        title: 'Order assigned to you',
        body: 'An order has been assigned to you. Please attend to it.',
        data: { orderId },
      })
      .catch(() => {});

    // Timeline event: manually assigned
    const agentRow = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, csAgentId))
      .limit(1);
    const agentName = agentRow[0]?.name ?? null;
    this.writeTimelineEvent({
      orderId,
      eventType: 'ORDER_MANUALLY_ASSIGNED',
      actorId: actor.id,
      actorName: actor.name ?? null,
      description: `Assigned to ${agentName ?? csAgentId} by ${actor.name ?? 'Head of CS'}`,
      metadata: { csAgentId },
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
      this.writeTimelineEvent({
        orderId: changed.id,
        eventType: 'ORDER_REASSIGNED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Reassigned to ${toAgentName} by ${actor.name ?? 'Head of CS'}`,
        metadata: { fromAgentId, toAgentId },
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

    const workloads = await this.getCSAgentWorkloads();
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
      const leaderboard = await this.getCSAgentLeaderboard('this_month');
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
      const available = workloads
        .map((w) => {
          const state = workloadMap.get(w.agentId)!;
          return { agentId: w.agentId, ...state };
        })
        .filter((s) => s.pendingCount < s.capacity);

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
   * load-balanced or performance strategy. Used from CS Team page (Head of CS). Excludes the source
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

    const workloads = await this.getCSAgentWorkloads();
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
      const leaderboard = await this.getCSAgentLeaderboard('this_month');
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
      const available = targetWorkloads
        .map((w) => {
          const state = workloadMap.get(w.agentId)!;
          return { agentId: w.agentId, ...state };
        })
        .filter((s) => s.pendingCount < s.capacity);

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
      this.notifications
        .create({
          userId: agentId,
          type: 'order:reassigned',
          title: 'Orders redistributed',
          body: `${redistributed} order(s) have been redistributed to other agents.`,
          data: { count: redistributed },
        })
        .catch(() => {});
      for (const [toAgentId, orderIds] of ordersByTarget) {
        this.events.emitToUser(toAgentId, 'order:assigned_bulk', {
          count: orderIds.length,
          fromAgentId: agentId,
          orderIds,
        });
        this.notifications
          .create({
            userId: toAgentId,
            type: 'order:assigned_bulk',
            title: 'Orders assigned to you',
            body: `${orderIds.length} order(s) have been reassigned to you.`,
            data: { count: orderIds.length, fromAgentId: agentId, orderIds },
          })
          .catch(() => {});
      }
      this.events.emitToRoom('cs-all', 'order:assignments_changed', { redistributed }, actor.currentBranchId ?? null);
    }

    return { redistributed };
  }

  /**
   * List active CS agents (id + name) for Hot Swap dropdowns (HoCS/SuperAdmin only).
   * Agent-initiated order transfers have been removed — reassignment is management-only.
   */
  async listCSAgents(actor: SessionUser): Promise<Array<{ agentId: string; agentName: string }>> {
    const hasReassign =
      (actor.permissions ?? [])
        .map((p) => canonicalPermissionCode(p))
        .includes(canonicalPermissionCode('orders.reassign'));
    if (actor.role === 'SUPER_ADMIN' || hasReassign) {
      const agents = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(and(eq(schema.users.role, 'CS_AGENT'), eq(schema.users.status, 'ACTIVE')));
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
   * Optional assignedCsId filters to that CS agent's orders (for CS Orders page).
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
  ) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];
    if (mediaBuyerId) conditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
    if (assignedCsId) conditions.push(eq(schema.orders.assignedCsId, assignedCsId));
    if (logisticsLocationId) conditions.push(eq(schema.orders.logisticsLocationId, logisticsLocationId));
    if (statuses?.length) conditions.push(inArray(schema.orders.status, statuses));
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));
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
   * Get order pipeline chart data — Volume, CS Engaged, Confirmed, Logistics distributed, Delivered.
   * For the CEO Executive Overview order funnel chart. Same date filter as getStatusCounts (created_at).
   */
  async getOrderPipelineChart(startDate?: string, endDate?: string, branchId?: string | null): Promise<{
    volume: number;
    csEngaged: number;
    confirmed: number;
    logisticsDistributed: number;
    delivered: number;
  }> {
    const counts = await this.getStatusCounts(undefined, startDate, endDate, undefined, undefined, branchId);
    const volume = Object.values(counts).reduce((sum, c) => sum + (c ?? 0), 0);
    return {
      volume,
      csEngaged: counts['CS_ENGAGED'] ?? 0,
      confirmed: counts['CONFIRMED'] ?? 0,
      logisticsDistributed: (counts['ALLOCATED'] ?? 0) + (counts['DISPATCHED'] ?? 0),
      delivered: counts['DELIVERED'] ?? 0,
    };
  }

  /**
   * Get CS agent workload — for dispatch algorithm and dashboard.
   * Single aggregation query + user list (no N+1).
   */
  async getCSAgentWorkloads(branchId?: string | null) {
    const [agents, pendingByAgent] = await Promise.all([
      this.db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          capacity: schema.users.capacity,
          lastActionAt: schema.users.lastActionAt,
        })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.role, 'CS_AGENT'),
            eq(schema.users.status, 'ACTIVE'),
          ),
        ),
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
            ...(branchId ? [eq(schema.orders.branchId, branchId)] : []),
          ),
        )
        .groupBy(schema.orders.assignedCsId),
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
      lastActionAt: agent.lastActionAt,
    }));
  }

  /**
   * Pending workload orders for a CS agent (same status/branch rules as getCSAgentWorkloads),
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
   * Get workload for the current CS agent — for \"My Orders\" page.
   * Returns null for non–CS agents or inactive users.
   */
  async getMyCSWorkload(actor: SessionUser) {
    if (actor.role !== 'CS_AGENT') {
      return null;
    }

    const userRows = await this.db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.id, actor.id),
          eq(schema.users.role, 'CS_AGENT'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const user = userRows[0];
    if (!user) {
      return null;
    }

    const pendingRows = await this.db
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
      );

    return {
      agentId: user.id,
      agentName: user.name,
      capacity: user.capacity ?? 10,
      pendingCount: pendingRows[0]?.count ?? 0,
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
   * Daily delivered count by `delivered_at` (status DELIVERED only — same as CEO
   * `getDeliveredOrdersTimeSeries`), with the same scope filters as `getOrdersTimeSeriesByCreated`.
   */
  private async getOrdersTimeSeriesByDelivered(
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    extra?: {
      mediaBuyerId?: string;
      csAgentId?: string;
      logisticsLocationId?: string;
      status?: string;
      statuses?: Array<(typeof schema.orders.$inferSelect)['status']>;
    },
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
    if (extra?.mediaBuyerId) conditions.push(eq(schema.orders.mediaBuyerId, extra.mediaBuyerId));
    if (extra?.csAgentId) conditions.push(eq(schema.orders.assignedCsId, extra.csAgentId));
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
   * Optional `mediaBuyerId` / `csAgentId` / `status` filters mirror the matching filters on
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
    extra?: {
      mediaBuyerId?: string;
      csAgentId?: string;
      logisticsLocationId?: string;
      status?: string;
      statuses?: Array<(typeof schema.orders.$inferSelect)['status']>;
    },
  ): Promise<{ date: string; orderCount: number; deliveredCount: number }[]> {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.orders.deletedAt)];
    if (startDate) conditions.push(gte(schema.orders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.orders.createdAt, end));
    }
    if (branchId) conditions.push(eq(schema.orders.branchId, branchId));
    if (extra?.mediaBuyerId) conditions.push(eq(schema.orders.mediaBuyerId, extra.mediaBuyerId));
    if (extra?.csAgentId) conditions.push(eq(schema.orders.assignedCsId, extra.csAgentId));
    if (extra?.logisticsLocationId) conditions.push(eq(schema.orders.logisticsLocationId, extra.logisticsLocationId));
    if (extra?.status) {
      conditions.push(eq(schema.orders.status, extra.status as (typeof schema.orders.$inferSelect)['status']));
    }
    if (extra?.statuses?.length) {
      conditions.push(inArray(schema.orders.status, extra.statuses));
    }
    const dateTrunc = sql`DATE_TRUNC('day', ${schema.orders.createdAt})::date`;

    let query = this.db
      .select({
        date: dateTrunc,
        orderCount: count(),
      })
      .from(schema.orders)
      .$dynamic();
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    const createdRows = await query.groupBy(dateTrunc).orderBy(asc(dateTrunc));

    const created = createdRows.map((r) => ({
      date: typeof r.date === 'string' ? r.date.split('T')[0]! : (r.date as Date).toISOString().split('T')[0]!,
      orderCount: r.orderCount ?? 0,
    }));

    const delivered = await this.getOrdersTimeSeriesByDelivered(startDate, endDate, branchId, extra);

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
          isNull(schema.orders.deletedAt),
          eq(schema.orders.assignedCsId, agent.id),
          or(
            eq(schema.orders.status, 'UNPROCESSED'),
            eq(schema.orders.status, 'CS_ASSIGNED'),
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
   * period: 'this_month' (default) or 'all_time'; optional startDate/endDate override for custom range.
   */
  async getCSAgentLeaderboard(period: 'this_month' | 'all_time' = 'this_month', startDate?: string, endDate?: string) {
    const useCustomRange = startDate && endDate;
    const periodStart = useCustomRange
      ? new Date(startDate)
      : period === 'this_month'
        ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        : null;
    let periodEnd: Date | null = useCustomRange ? new Date(endDate) : null;
    if (periodEnd) periodEnd.setHours(23, 59, 59, 999);

    const agents = await this.db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'CS_AGENT'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

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

    const leaderboard = await Promise.all(
      agents.map(async (agent) => {
        const agentId = agent.id;
        const baseOrderConditions = orderDateFilter
          ? and(eq(schema.orders.assignedCsId, agentId), orderDateFilter)
          : eq(schema.orders.assignedCsId, agentId);

        const deliveredOrCompleted = or(eq(schema.orders.status, 'DELIVERED'), eq(schema.orders.status, 'COMPLETED'));
        const deliveredWhere = deliveredDateFilter
          ? and(
              eq(schema.orders.assignedCsId, agentId),
              deliveredOrCompleted,
              deliveredDateFilter,
            )
          : and(
              eq(schema.orders.assignedCsId, agentId),
              deliveredOrCompleted,
            );

        const callLogsWhere = callLogsDateFilter
          ? and(eq(schema.callLogs.agentId, agentId), callLogsDateFilter)
          : eq(schema.callLogs.agentId, agentId);

        const callLogsAvgWhere = callLogsDateFilter
          ? and(
              eq(schema.callLogs.agentId, agentId),
              eq(schema.callLogs.callStatus, 'COMPLETED'),
              callLogsDateFilter,
            )
          : and(
              eq(schema.callLogs.agentId, agentId),
              eq(schema.callLogs.callStatus, 'COMPLETED'),
            );

        // Count orders that *passed through* each stage (not just current status).
        // Any order assigned to this agent counts as "engaged".
        // Orders that reached CONFIRMED or beyond (except CANCELLED) count as "confirmed".
        // CANCELLED orders are counted separately.
        const confirmedOrBeyond = or(
          eq(schema.orders.status, 'CONFIRMED'),
          eq(schema.orders.status, 'ALLOCATED'),
          eq(schema.orders.status, 'DISPATCHED'),
          eq(schema.orders.status, 'IN_TRANSIT'),
          eq(schema.orders.status, 'DELIVERED'),
          eq(schema.orders.status, 'PARTIALLY_DELIVERED'),
          eq(schema.orders.status, 'COMPLETED'),
          eq(schema.orders.status, 'RETURNED'),
          eq(schema.orders.status, 'RESTOCKED'),
          eq(schema.orders.status, 'WRITTEN_OFF'),
        );

        const [engagedRows, confirmedRows, cancelledRows, deliveredRows, callCountRows, avgCallRows] = await Promise.all([
          // ordersEngaged = all orders assigned to this agent (any status except UNPROCESSED)
          this.db
            .select({ count: count() })
            .from(schema.orders)
            .where(baseOrderConditions),
          // ordersConfirmed = orders that reached CONFIRMED or beyond
          this.db
            .select({ count: count() })
            .from(schema.orders)
            .where(and(baseOrderConditions, confirmedOrBeyond)),
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
   * Assign a single UNPROCESSED order to the best available CS agent using the configured
   * dispatch strategy. Used by auto-dispatch on creation and by distributeUnassignedOrders.
   * Returns true if the order was assigned, false if no capacity.
   */
  private async assignOrderToBestAvailableAgent(orderId: string): Promise<boolean> {
    const [orderRow] = await this.db
      .select({ branchId: schema.orders.branchId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);

    const workloads = await this.getCSAgentWorkloads();
    const available = workloads.filter((w) => w.pendingCount < w.capacity);
    if (available.length === 0) return false;

    const dispatchSetting = await this.settingsService.get('CS_DISPATCH_STRATEGY');
    const strategy = dispatchSetting?.strategy === 'performance' ? 'performance' : 'load_balanced';

    if (strategy === 'performance') {
      const leaderboard = await this.getCSAgentLeaderboard('this_month');
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
    this.notifications
      .create({
        userId: targetAgent.agentId,
        type: 'order:assigned',
        title: 'Order assigned to you',
        body: 'A new order has been assigned to you. Please attend to it.',
        data: { orderId },
      })
      .catch(() => {});

    // Timeline event: auto-assigned
    this.writeTimelineEvent({
      orderId,
      eventType: 'ORDER_AUTO_ASSIGNED',
      actorId: targetAgent.agentId,
      actorName: targetAgent.agentName,
      description: `Auto-assigned to ${targetAgent.agentName}`,
      metadata: { agentId: targetAgent.agentId, strategy },
    });

    return true;
  }

  /**
   * Auto-dispatch a new order to a CS agent.
   * Strategy is configurable via system setting CS_DISPATCH_STRATEGY:
   * - manual (default): no auto-assignment; orders sit UNPROCESSED until HoCS assigns them.
   * - load_balanced: lowest pending count first, then most idle.
   * - performance: prioritise agents with higher delivery rate and confirmation rate (this month).
   * - claim: no auto-assignment; orders stay UNPROCESSED in the claim queue for agents to grab.
   */
  private async autoDispatchToCS(orderId: string) {
    await this.releaseExpiredLocks();

    const dispatchSetting = await this.settingsService.get('CS_DISPATCH_STRATEGY');
    const strategy = (dispatchSetting?.strategy as string | undefined) ?? 'manual';

    if (strategy === 'manual') {
      // Manual mode: no auto-assignment and no claim broadcast. Order remains UNPROCESSED
      // in the HoCS unassigned queue for manual assignment via Hot Swap.
      return;
    }

    if (strategy === 'claim') {
      // Claim mode: leave order in UNPROCESSED, broadcast to claim queue
      const [orderRow] = await this.db
        .select({ branchId: schema.orders.branchId })
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);
      this.events.emitToRoom('cs-all', 'order:claim_available', { orderId }, orderRow?.branchId ?? null);
      return;
    }

    await this.assignOrderToBestAvailableAgent(orderId);
  }

  /**
   * Claim an order from the claim queue. Atomic lock prevents double-claiming.
   * Agent must have capacity (pending orders < claim_cap) to claim.
   */
  async claimOrder(orderId: string, actor: SessionUser): Promise<{ success: boolean; message?: string }> {
    if (actor.role !== 'CS_AGENT') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only CS agents can claim orders' });
    }

    // Check claim cap
    const capSetting = await this.settingsService.get('CS_CLAIM_CAP');
    const claimCap = typeof capSetting?.cap === 'number' ? capSetting.cap : 2;

    const pendingCounts = await this.db
      .select({ count: count() })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.assignedCsId, actor.id),
          inArray(schema.orders.status, ['CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED']),
        ),
      );

    const currentPending = pendingCounts[0]?.count ?? 0;
    if (currentPending >= claimCap) {
      return { success: false, message: `Claim cap reached (${claimCap} active orders). Confirm or cancel existing orders first.` };
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

    this.notifications
      .create({
        userId: actor.id,
        type: 'order:assigned',
        title: 'Order assigned to you',
        body: 'You claimed this order from the queue. Please attend to it.',
        data: { orderId },
      })
      .catch(() => {});

    this.writeTimelineEvent({
      orderId,
      eventType: 'ORDER_CLAIMED',
      actorId: actor.id,
      actorName: actor.name,
      description: `${actor.name} claimed this order`,
      metadata: { agentId: actor.id, mode: 'claim' },
    });

    return { success: true };
  }

  /**
   * Get all UNPROCESSED orders available for claiming (claim mode only).
   * Sorted oldest-first so longer-waiting orders are visible first.
   */
  async getClaimQueue(): Promise<Array<{
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
   * Distribute all UNPROCESSED (unassigned) orders to CS agents using the same algorithm as
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
        const voipSetting = await this.settingsService.get('VOIP_ENABLED');
        const isVoipEnabled = voipSetting?.['enabled'] === true;

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

        // Org-wide CS scope (e.g. HoCS) may confirm using any rep's qualifying call on the order.
        const hoCsOversightPath = hasConfirmPerm('cs.scope.global') && !!order.branchId;

        if (!bypassCallGate) {
          if (hoCsOversightPath) {
            // Head of CS may confirm using any rep's qualifying call on this order (oversight path).
            if (isVoipEnabled) {
              const qualifying = await this.db
                .select()
                .from(schema.callLogs)
                .where(
                  and(
                    eq(schema.callLogs.orderId, order.id),
                    gte(schema.callLogs.durationSeconds, 15),
                  ),
                )
                .orderBy(desc(schema.callLogs.startedAt))
                .limit(1);
              if (!qualifying[0]) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message:
                    'Cannot confirm: no qualifying VOIP call (≥ 15 seconds) on this order yet. Have a rep complete a call first.',
                });
              }
            } else {
              const anyCall = await this.db
                .select()
                .from(schema.callLogs)
                .where(eq(schema.callLogs.orderId, order.id))
                .orderBy(desc(schema.callLogs.startedAt))
                .limit(1);
              if (!anyCall[0]) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Cannot confirm: no call has been logged on this order yet.',
                });
              }
            }
          } else {
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
              if (!lastCall || (lastCall.durationSeconds ?? 0) < 15) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Cannot confirm: VOIP call duration must be at least 15 seconds',
                });
              }
            } else {
              if (!lastCall) {
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'Cannot confirm: you must click Call before confirming',
                });
              }
            }
          }
        }

        await this.inventoryService.assertGlobalAvailabilityForOrder(order.id);
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
        const locationId = metadata.logisticsLocationId as string;
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
  ): Promise<void> {
    // Idempotency check
    const existingRows = await this.db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.orderId, orderId))
      .limit(1);
    if (existingRows[0]) return;

    // Hydrate the order + items + product names for descriptive line items.
    const orderRows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    const ord = orderRows[0];
    if (!ord) return;

    const items = await this.db
      .select({
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        offerLabel: schema.orderItems.offerLabel,
        productName: schema.products.name,
      })
      .from(schema.orderItems)
      .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(eq(schema.orderItems.orderId, orderId));

    if (items.length === 0) {
      this.logger.warn(`autoCreateInvoiceForOrder: order ${orderId} has no items, skipping`);
      return;
    }

    const lineItems = items.map((it) => ({
      description: `${it.productName ?? 'Product'}${it.offerLabel ? ` (${it.offerLabel})` : ''}`,
      quantity: it.quantity,
      unitPrice: String(it.unitPrice),
    }));

    const totalAmount = items.reduce(
      (sum, it) => sum + it.quantity * Number(it.unitPrice),
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
        let totalLandedCost = 0;

        await withActor(this.db, actor, async (tx) => {
          for (const item of orderItems) {
            await tx.insert(schema.stockMovements).values({
              productId: item.productId,
              movementType: 'RESERVATION',
              quantity: item.quantity,
              referenceId: updatedOrder.id,
              reason: `Stock reserved for order ${updatedOrder.id}`,
              actorId: actor.id,
            });

            const batches = await tx
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

          await tx
            .update(schema.orders)
            .set({ landedCost: totalLandedCost.toFixed(2) })
            .where(eq(schema.orders.id, updatedOrder.id));
        });
        break;
      }

      case 'ALLOCATED': {
        const locationId =
          updatedOrder.logisticsLocationId ??
          (typeof metadata?.logisticsLocationId === 'string' ? metadata.logisticsLocationId : undefined);
        if (locationId) {
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
            message: 'Cannot record delivery: order has no fulfillment location (allocate to a 3PL first).',
          });
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
            reason: `Restocked at 3PL: order ${updatedOrder.id}`,
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
            await this.inventoryService.checkLowStockAndNotify(item.productId, updatedOrder.logisticsLocationId);
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
      this.writeTimelineEvent({
        orderId,
        eventType: 'ORDER_CANCELLED',
        actorId: actor.id,
        actorName: actor.name ?? null,
        description: `Order cancelled after ${currentAttempts} callback attempts`,
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
      this.notifications.create({
        userId: order.assignedCsId,
        type: 'order:callback_scheduled',
        title: 'Callback scheduled',
        body: `Order ${orderId.slice(0, 8)}... callback scheduled for ${timeLabel}. Attempt ${currentAttempts + 1}/${maxAttempts}.`,
        data: { orderId, scheduledAt: scheduledAt.toISOString() },
      }).catch(() => {});
    }
    const noteSuffix =
      options?.notes && options.notes.trim().length > 0
        ? ` (${options.notes.trim()})`
        : '';
    this.writeTimelineEvent({
      orderId,
      eventType: 'CALLBACK_SCHEDULED',
      actorId: actor.id,
      actorName: actor.name ?? null,
      description: `Callback scheduled for ${scheduledAt.toLocaleString('en-NG')}${noteSuffix}`,
      metadata: { scheduledAt: scheduledAt.toISOString(), delayMinutes },
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
            eq(schema.orders.status, 'CS_ASSIGNED'),
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
            eq(schema.orders.status, 'CS_ASSIGNED'),
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
   * Cron: every 2 minutes, check for callbacks that are due and notify the assigned CS agent.
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

        this.notifications.create({
          userId: order.assignedCsId,
          type: 'order:callback_due',
          title: 'Callback due now',
          body: `Order ${order.id.slice(0, 8)}... is due for a callback. Attempt ${order.callbackAttempts ?? 0}/3.`,
          data: { orderId: order.id },
        }).catch(() => {});

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
   * Checks for orders with the same phone hash + product within 6 hours.
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

  private async findRecentPhoneOrder(phoneHash: string) {
    const [recent] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.customerPhoneHash, phoneHash),
          sql`${schema.orders.createdAt} >= NOW() - INTERVAL '6 hours'`,
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

  /**
   * Get the order timeline for a specific order, filtered by the actor's role.
   * CS roles see: ORDER_RECEIVED, ORDER_AUTO_ASSIGNED, ORDER_MANUALLY_ASSIGNED, ORDER_REASSIGNED,
   *   ORDER_CLAIMED, CALL_INITIATED, CALL_COMPLETED, CALL_NO_ANSWER, CALL_FAILED,
   *   MANUAL_CALL_LOGGED, SMS_SENT, WHATSAPP_SENT, ORDER_CONFIRMED, ORDER_CANCELLED,
   *   ADDRESS_UPDATED, QUANTITY_UPDATED, CALLBACK_SCHEDULED, SUPERVISOR_WATCHING.
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
    ]);
    const LOGISTICS_EVENTS = new Set([
      'ORDER_ALLOCATED', 'ORDER_DISPATCHED', 'ORDER_IN_TRANSIT', 'ORDER_DELIVERED',
      'ORDER_PARTIALLY_DELIVERED', 'ORDER_RETURNED', 'ORDER_RESTOCKED', 'ORDER_WRITTEN_OFF',
      'ORDER_ARCHIVED',
    ]);

    const rows = await this.db
      .select()
      .from(schema.orderTimelineEvents)
      .where(eq(schema.orderTimelineEvents.orderId, orderId))
      .orderBy(asc(schema.orderTimelineEvents.createdAt));

    const hasOrderReceived = rows.some((r) => r.eventType === 'ORDER_RECEIVED');
    let mergedRows = rows;
    if (!hasOrderReceived) {
      const [ord] = await this.db
        .select({
          id: schema.orders.id,
          createdAt: schema.orders.createdAt,
          orderSource: schema.orders.orderSource,
          mediaBuyerId: schema.orders.mediaBuyerId,
          assignedCsId: schema.orders.assignedCsId,
        })
        .from(schema.orders)
        .where(and(eq(schema.orders.id, orderId), isNull(schema.orders.deletedAt)))
        .limit(1);
      if (ord) {
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
                branchId: null,
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
                branchId: null,
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
      actor.role === 'CS_AGENT';

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
   * Fire-and-forget — never throws so it does not interrupt the calling flow.
   */
  writeTimelineEvent(params: {
    orderId: string;
    eventType: string;
    actorId?: string | null;
    actorName?: string | null;
    description: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.db
      .insert(schema.orderTimelineEvents)
      .values({
        orderId: params.orderId,
        eventType: params.eventType as (typeof schema.orderTimelineEvents.$inferInsert)['eventType'],
        actorId: params.actorId ?? null,
        actorName: params.actorName ?? null,
        description: params.description,
        metadata: params.metadata ?? null,
      })
      .catch(() => {});
  }

  private buildTransitionActivityDescription(
    newStatus: string,
    options?: { reason?: string; preferredDeliveryDate?: string; logisticsLocationName?: string },
  ): string {
    const reasonSuffix = options?.reason ? ` (${options.reason})` : '';
    switch (newStatus) {
      case 'CS_ENGAGED':
        return 'CS started customer engagement';
      case 'CONFIRMED':
        return options?.preferredDeliveryDate
          ? `Order confirmed for delivery on ${options.preferredDeliveryDate}`
          : 'Order confirmed';
      case 'CANCELLED':
        return `Order cancelled${reasonSuffix}`;
      case 'ALLOCATED':
        return options?.logisticsLocationName
          ? `Order allocated to ${options.logisticsLocationName}`
          : 'Order allocated to logistics';
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

    const ACTIVE_STATUSES = new Set(['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'ALLOCATED', 'DISPATCHED', 'IN_TRANSIT']);

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
