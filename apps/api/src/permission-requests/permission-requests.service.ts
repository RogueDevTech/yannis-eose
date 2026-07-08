import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, desc, count, and, or, inArray, sql, type SQL } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { CreateStaffInput, UpdateStaffInput, UpdateOrderInput, TransitionOrderInput } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel, isOrgWideDepartmentHead } from '../common/authz';
import { withActor } from '../common/db/with-actor';
import { canonicalPermissionCode, formatOrderNumber } from '@yannis/shared';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';

/**
 * Map of `permission_request.type` → the permission code that grants approve rights.
 * Source of truth for both the queue-visibility filter and the approver gate. New
 * request types added here are immediately surfaced in the approver matrix.
 */
const APPROVE_PERMISSION_BY_TYPE: Record<string, string> = {
  USER_CREATION: 'permission_requests.user_creation.approve',
  ROLE_CHANGE: 'permission_requests.role_change.approve',
  PERMISSION_GRANT: 'permission_requests.permission_grant.approve',
  PRODUCT_ARCHIVE: 'permission_requests.product_archive.approve',
  ORDER_LINE_PRICE_CHANGE: 'permission_requests.order_line_price.approve',
  ORDER_DELETION: 'permission_requests.order_deletion.approve',
  DELIVERED_ORDER_DELETION: 'permission_requests.delivered_order_deletion.approve',
  ORDER_STATUS_RETRACK: 'permission_requests.order_retrack.approve',
};

/** True when `viewer.permissions` contains `code` (canonical-aware). */
function viewerHasPermission(viewer: SessionUser, code: string): boolean {
  const target = canonicalPermissionCode(code);
  return (viewer.permissions ?? [])
    .map((p) => canonicalPermissionCode(p))
    .includes(target);
}

type PermissionRequestRowType = InferSelectModel<typeof schema.permissionRequests>['type'];

@Injectable()
export class PermissionRequestsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Permission-first approver gate.
   *
   * Step 1 — capability: SuperAdmin always passes; otherwise the approver must hold
   * the `permission_requests.<type>.approve` code (granted on SYSTEM templates by
   * default, overridable per user via the permission matrix).
   *
   * Step 2 — context (order-domain types only): for ORDER_LINE_PRICE_CHANGE and
   * ORDER_DELETION the approver must additionally pass the per-order branch/assignee
   * check (`canActorEditOrderLinePrices`) so a HoCS in Branch A can't approve a
   * price change on Branch B's order. Holding the permission grants the *capability*;
   * this second gate enforces the *scope*.
   */
  private async assertApproverMayProcessRequest(
    approver: SessionUser,
    req: InferSelectModel<typeof schema.permissionRequests>,
  ): Promise<void> {
    // SuperAdmin bypasses both gates (locked CEO directive).
    if (approver.role === 'SUPER_ADMIN') return;

    const requiredCode = APPROVE_PERMISSION_BY_TYPE[req.type];
    if (!requiredCode) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Unknown permission_request type: ${req.type}`,
      });
    }

    if (!viewerHasPermission(approver, requiredCode)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `You do not have permission to approve this request type. Requires \`${requiredCode}\`.`,
      });
    }

    // Step 2 — order-domain contextual check.
    if (req.type === 'ORDER_LINE_PRICE_CHANGE' || req.type === 'ORDER_DELETION' || req.type === 'DELIVERED_ORDER_DELETION') {
      const payload = req.payload as { orderId?: string; orderType?: 'followUp' | 'cart' } | null;
      const orderId = payload?.orderId;
      const orderType = payload?.orderType;
      if (!orderId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            req.type === 'ORDER_DELETION'
              ? 'Invalid order archive request payload.'
              : 'Invalid price-change request payload.',
        });
      }

      // Resolve the order from the correct table based on orderType
      let orderRef: { branchId: string | null; assignedCsId: string | null; deletedAt: Date | null } | null = null;
      if (orderType === 'followUp') {
        const [fu] = await this.db
          .select({ branchId: schema.followUpOrders.servicingBranchId, assignedCsId: schema.followUpOrders.assignedCsId, deletedAt: schema.followUpOrders.deletedAt })
          .from(schema.followUpOrders)
          .where(eq(schema.followUpOrders.id, orderId))
          .limit(1);
        orderRef = fu ?? null;
      } else if (orderType === 'cart') {
        const [co] = await this.db
          .select({ branchId: schema.cartOrders.servicingBranchId, assignedCsId: schema.cartOrders.assignedCsId, deletedAt: schema.cartOrders.deletedAt })
          .from(schema.cartOrders)
          .where(eq(schema.cartOrders.id, orderId))
          .limit(1);
        orderRef = co ?? null;
      } else {
        const [order] = await this.db
          .select({ branchId: schema.orders.branchId, assignedCsId: schema.orders.assignedCsId, deletedAt: schema.orders.deletedAt })
          .from(schema.orders)
          .where(eq(schema.orders.id, orderId))
          .limit(1);
        orderRef = order ?? null;
      }

      if (!orderRef) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order referenced by this request was not found.' });
      }
      if (orderRef.deletedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This order has already been archived.' });
      }
      const allowed = await this.ordersService.canActorEditOrderLinePrices(approver, {
        branchId: orderRef.branchId ?? null,
        assignedCsId: orderRef.assignedCsId ?? null,
      });
      if (!allowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'You hold the approve permission but this order is outside your scope (different branch / not your team\'s assignee).',
        });
      }
    }
  }

  /**
   * Returns the set of permission_request types the viewer is allowed to see in the
   * approval queue. Drives the server-side row filter — types the viewer can't
   * approve are hidden, but rows the viewer personally submitted always surface
   * (so a Sales Closer can track their own price-change asks).
   *
   * Permission-first: a viewer sees a type iff they hold its approve code (or are
   * admin-class). Adding a new request type is a one-line change to
   * `APPROVE_PERMISSION_BY_TYPE` plus a default grant in `permission-catalog.ts`.
   */
  private viewableTypesForViewer(viewer: SessionUser): Set<string> {
    if (viewer.role === 'SUPER_ADMIN' || viewer.role === 'SUPPORT') {
      return new Set(Object.keys(APPROVE_PERMISSION_BY_TYPE));
    }
    const types = new Set<string>();
    for (const [type, code] of Object.entries(APPROVE_PERMISSION_BY_TYPE)) {
      if (viewerHasPermission(viewer, code)) types.add(type);
    }
    return types;
  }

  /**
   * Same row visibility as {@link list}: SuperAdmin sees all; everyone else sees
   * requests they submitted or whose type they may approve.
   */
  private viewerScopeWhere(viewer: SessionUser): SQL | undefined {
    if (viewer.role === 'SUPER_ADMIN' || viewer.role === 'SUPPORT') return undefined;
    const viewableTypes = this.viewableTypesForViewer(viewer);
    const typeList = [...viewableTypes] as PermissionRequestRowType[];
    if (typeList.length === 0) {
      return eq(schema.permissionRequests.requesterId, viewer.id);
    }
    return or(
      eq(schema.permissionRequests.requesterId, viewer.id),
      inArray(schema.permissionRequests.type, typeList),
    );
  }

  /**
   * Company-group isolation for permission requests. Org-wide heads and admins
   * see requests from ALL branches in their company group (not just their
   * personally assigned branches). Returns undefined when no filter is needed.
   */
  private async companyGroupFilter(viewer: SessionUser, effectiveBranchIds?: string[] | null): Promise<SQL | undefined> {
    if (!effectiveBranchIds || effectiveBranchIds.length === 0) return undefined;

    // Org-wide heads may only be assigned to a subset of company branches,
    // but they need to see requests from ALL branches in the company.
    // Expand to all branches in the same group(s).
    if (isAdminLevel(viewer) || isOrgWideDepartmentHead(viewer)) {
      const groupRows = await this.db
        .selectDistinct({ groupId: schema.branches.groupId })
        .from(schema.branches)
        .where(inArray(schema.branches.id, effectiveBranchIds));
      const groupIds = groupRows.map((r) => r.groupId).filter(Boolean) as string[];
      if (groupIds.length > 0) {
        return sql`${schema.permissionRequests.requesterId} IN (
          SELECT DISTINCT ub.user_id FROM user_branches ub
          JOIN branches b ON b.id = ub.branch_id
          WHERE b.group_id IN (${sql.join(groupIds.map(id => sql`${id}`), sql`, `)})
        )`;
      }
      return undefined;
    }

    // Branch-scoped users: filter to requesters in their assigned branches
    return sql`${schema.permissionRequests.requesterId} IN (
      SELECT DISTINCT user_id FROM user_branches
      WHERE branch_id IN (${sql.join(effectiveBranchIds.map(id => sql`${id}`), sql`, `)})
    )`;
  }

  /** Combines optional status filter with the same viewer scope as {@link list}. */
  private buildListWhere(
    statusFilter: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED',
    viewer: SessionUser | undefined,
  ): SQL | undefined {
    const parts: SQL[] = [];
    if (statusFilter !== 'ALL') {
      parts.push(eq(schema.permissionRequests.status, statusFilter));
    }
    if (viewer && viewer.role !== 'SUPER_ADMIN') {
      const scope = this.viewerScopeWhere(viewer);
      if (scope) parts.push(scope);
    }
    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return and(...parts);
  }

  private async enrichPermissionRequestRows(
    rows: Array<{
      id: string;
      type: InferSelectModel<typeof schema.permissionRequests>['type'];
      status: InferSelectModel<typeof schema.permissionRequests>['status'];
      requesterId: string;
      targetUserId: string | null;
      requestedRole: string | null;
      permissionCode: string | null;
      reason: string;
      payload: unknown;
      approverId: string | null;
      approvalReason: string | null;
      approvedAt: Date | string | null;
      csApprovedBy?: string | null;
      csApprovedAt?: Date | string | null;
      csNote?: string | null;
      logiApprovedBy?: string | null;
      logiApprovedAt?: Date | string | null;
      logiNote?: string | null;
      createdAt: Date | string;
    }>,
  ) {
    if (rows.length === 0) return [];

    const idSet = new Set<string>();
    for (const r of rows) {
      idSet.add(r.requesterId);
      if (r.targetUserId) idSet.add(r.targetUserId);
      if (r.approverId) idSet.add(r.approverId);
      if (r.csApprovedBy) idSet.add(r.csApprovedBy);
      if (r.logiApprovedBy) idSet.add(r.logiApprovedBy);
    }
    const ids = [...idSet];
    const userRows =
      ids.length > 0
        ? await this.db
            .select({
              id: schema.users.id,
              name: schema.users.name,
              email: schema.users.email,
            })
            .from(schema.users)
            .where(inArray(schema.users.id, ids))
        : [];
    const byId = new Map(userRows.map((u) => [u.id, u]));

    return rows.map((row) => {
      const reqU = byId.get(row.requesterId);
      const tgtU = row.targetUserId ? byId.get(row.targetUserId) : undefined;
      const appU = row.approverId ? byId.get(row.approverId) : undefined;
      const csU = row.csApprovedBy ? byId.get(row.csApprovedBy) : undefined;
      const logiU = row.logiApprovedBy ? byId.get(row.logiApprovedBy) : undefined;
      return {
        ...row,
        requesterName: reqU?.name ?? 'Unknown',
        requesterEmail: reqU?.email ?? '',
        targetUserName: tgtU?.name ?? null,
        targetUserEmail: tgtU?.email ?? null,
        approverName: appU?.name ?? null,
        csApproverName: csU?.name ?? null,
        logiApproverName: logiU?.name ?? null,
      };
    });
  }

  /** Per-status totals for tab badges — scoped identically to {@link list}. */
  async statusCounts(viewer: SessionUser, effectiveBranchIds?: string[] | null): Promise<{
    pending: number;
    approved: number;
    rejected: number;
    all: number;
  }> {
    const scope = this.viewerScopeWhere(viewer);
    const groupFilter = await this.companyGroupFilter(viewer, effectiveBranchIds);

    const countWhere = async (status: 'PENDING' | 'APPROVED' | 'REJECTED') => {
      const cond = and(
        eq(schema.permissionRequests.status, status),
        ...[scope, groupFilter].filter(Boolean) as SQL[],
      );
      const [row] = await this.db
        .select({ c: count() })
        .from(schema.permissionRequests)
        .where(cond);
      return Number(row?.c ?? 0);
    };

    const [pending, approved, rejected] = await Promise.all([
      countWhere('PENDING'),
      countWhere('APPROVED'),
      countWhere('REJECTED'),
    ]);
    return { pending, approved, rejected, all: pending + approved + rejected };
  }

  /**
   * List all PENDING permission requests. Kept for backwards compatibility; thin wrapper
   * around {@link list} — new callers should use `list({ status: 'PENDING' })` directly.
   */
  /** First page of pending only (limit 100); use {@link list} for full pagination. */
  async listPending(viewer?: SessionUser) {
    const res = await this.list({ status: 'PENDING', page: 1, limit: 100 }, viewer);
    return res.items;
  }

  /**
   * List permission requests with optional status filter and SQL pagination.
   * Enriched with requester, target, and approver names (batched user lookups per page).
   *
   * When `viewer` is supplied, the result is scoped to:
   *   - rows the viewer submitted (any type), AND
   *   - rows of types the viewer is allowed to approve.
   * SuperAdmin sees all rows (no scope filter).
   */
  async list(
    options?: {
      status?: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED';
      page?: number;
      limit?: number;
    },
    viewer?: SessionUser,
    effectiveBranchIds?: string[] | null,
  ) {
    const statusFilter = options?.status ?? 'PENDING';
    const page = options?.page ?? 1;
    const limit = Math.min(Math.max(1, options?.limit ?? 20), 100);
    const offset = (page - 1) * limit;

    let whereClause = this.buildListWhere(statusFilter, viewer);
    if (viewer) {
      const groupFilter = await this.companyGroupFilter(viewer, effectiveBranchIds);
      if (groupFilter) {
        whereClause = whereClause ? and(whereClause, groupFilter) : groupFilter;
      }
    }

    const [countRow] = await (whereClause
      ? this.db.select({ c: count() }).from(schema.permissionRequests).where(whereClause)
      : this.db.select({ c: count() }).from(schema.permissionRequests));
    const total = Number(countRow?.c ?? 0);

    const rowSelect = {
      id: schema.permissionRequests.id,
      type: schema.permissionRequests.type,
      status: schema.permissionRequests.status,
      requesterId: schema.permissionRequests.requesterId,
      targetUserId: schema.permissionRequests.targetUserId,
      requestedRole: schema.permissionRequests.requestedRole,
      permissionCode: schema.permissionRequests.permissionCode,
      reason: schema.permissionRequests.reason,
      payload: schema.permissionRequests.payload,
      approverId: schema.permissionRequests.approverId,
      approvalReason: schema.permissionRequests.approvalReason,
      approvedAt: schema.permissionRequests.approvedAt,
      csApprovedBy: schema.permissionRequests.csApprovedBy,
      csApprovedAt: schema.permissionRequests.csApprovedAt,
      csNote: schema.permissionRequests.csNote,
      logiApprovedBy: schema.permissionRequests.logiApprovedBy,
      logiApprovedAt: schema.permissionRequests.logiApprovedAt,
      logiNote: schema.permissionRequests.logiNote,
      createdAt: schema.permissionRequests.createdAt,
    };

    const rows = await (whereClause
      ? this.db
          .select(rowSelect)
          .from(schema.permissionRequests)
          .where(whereClause)
          .orderBy(desc(schema.permissionRequests.createdAt))
          .limit(limit)
          .offset(offset)
      : this.db
          .select(rowSelect)
          .from(schema.permissionRequests)
          .orderBy(desc(schema.permissionRequests.createdAt))
          .limit(limit)
          .offset(offset));

    const items = await this.enrichPermissionRequestRows(rows);

    return { items, total, page, limit };
  }

  /**
   * Approve a permission request. Gate varies by type (see assertApproverMayProcessRequest).
   * Applies the underlying change, then stamps the request row.
   */
  async approve(requestId: string, approver: SessionUser, reason: string) {
    const [req] = await this.db
      .select()
      .from(schema.permissionRequests)
      .where(eq(schema.permissionRequests.id, requestId))
      .limit(1);

    if (!req) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Permission request not found' });
    }
    if (req.status !== 'PENDING') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request already processed' });
    }

    if (req.requesterId === approver.id) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot approve your own request',
      });
    }

    await this.assertApproverMayProcessRequest(approver, req);

    // Apply the underlying change first (nested service calls manage their own actor via withActor).
    if (req.type === 'USER_CREATION') {
      const payload = req.payload as CreateStaffInput | null;
      if (!payload || !payload.name || !payload.email || !payload.role) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for user creation',
        });
      }
      await this.usersService.createStaffFromPayload(payload, approver);
    } else if (req.type === 'ROLE_CHANGE' && req.targetUserId) {
      const payload = req.payload as UpdateStaffInput | null;
      if (!payload || !payload.role) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for role change',
        });
      }
      await this.usersService.update(
        { ...payload, userId: req.targetUserId },
        approver,
      );
    } else if (req.type === 'PRODUCT_ARCHIVE') {
      const payload = req.payload as { productId?: string; productName?: string } | null;
      const productId = payload?.productId;
      if (!productId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for product archive',
        });
      }
      await this.productsService.archiveProductAsApprover(productId, approver);
    } else if (req.type === 'ORDER_LINE_PRICE_CHANGE') {
      const payload = req.payload as {
        orderId?: string;
        orderType?: 'followUp' | 'cart';
        items?: UpdateOrderInput['items'];
        totalAmount?: number;
      } | null;
      const orderId = payload?.orderId;
      const orderType = payload?.orderType;
      const items = payload?.items;
      const totalAmount = payload?.totalAmount;
      if (!orderId || !items?.length || totalAmount == null || Number.isNaN(Number(totalAmount))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for order line price change.',
        });
      }
      if (orderType === 'followUp') {
        // Dynamic import to avoid circular DI — follow-up service is accessed via the tRPC singleton getter
        const { getFollowUpConfigService } = await import('../trpc/routers/orders.router');
        await getFollowUpConfigService().adjustFollowUpOrderItems(orderId, items, Number(totalAmount), approver);
      } else if (orderType === 'cart') {
        const { getCartOrdersService } = await import('../trpc/routers/cart-orders.router');
        await getCartOrdersService().adjustItems(orderId, items, Number(totalAmount), approver);
      } else {
        await this.ordersService.update(
          { orderId, items, totalAmount: Number(totalAmount) },
          approver,
        );
      }
      // Regenerate invoice after item changes — best-effort
      try {
        const { getFinanceService } = await import('../trpc/routers/finance.router');
        const order = orderType === 'cart'
          ? await (await import('../trpc/routers/cart-orders.router')).getCartOrdersService().getById(orderId)
          : orderType === 'followUp'
            ? null // follow-up invoices handled via order graduation
            : await this.ordersService.getById(orderId);
        if (order) {
          await getFinanceService().ensureInvoiceForOrder({ order: order as never, actorId: approver.id });
        }
      } catch { /* invoice regeneration is best-effort */ }
      // Surface the approval on the order timeline. For normal orders, the underlying
      // `update` call writes a `QUANTITY_UPDATED` event when items change, but that
      // doesn't tell the Sales rep (or auditor) that this was specifically an approval.
      const approvedTotal = Math.round(Number(totalAmount) * 100) / 100;
      if (!orderType) {
        // Only write timeline for normal orders — follow-up/cart have their own timeline
        this.ordersService.writeTimelineEvent({
          orderId,
          eventType: 'LINE_PRICE_CHANGE_APPROVED',
          actorId: approver.id,
          actorName: approver.name ?? null,
          description:
            `${approver.name ?? 'Approver'} approved the line price change. ` +
            `New total ₦${approvedTotal.toLocaleString('en-NG')}.`,
          metadata: {
            permissionRequestId: requestId,
            approvedItems: items,
            approvedTotalAmount: Number(totalAmount),
            approvalReason: reason,
          },
        });
      }
    } else if (req.type === 'ORDER_DELETION') {
      const payload = req.payload as { orderId?: string } | null;
      const orderId = payload?.orderId;
      if (!orderId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for order archive request.',
        });
      }
      await this.ordersService.softDeleteOrder(orderId, approver, { approverNote: reason });
    } else if (req.type === 'DELIVERED_ORDER_DELETION') {
      const payload = req.payload as { orderId?: string; orderNo?: number | null; superAdminOnly?: boolean } | null;
      const orderId = payload?.orderId;
      if (!orderId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for delivered order deletion request.',
        });
      }

      // Finance-initiated requests require only SuperAdmin approval (single).
      if (payload?.superAdminOnly) {
        const isSuperAdmin = approver.role === 'SUPER_ADMIN' || approver.role === 'ADMIN';
        if (!isSuperAdmin) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only SuperAdmin can approve finance-initiated deletion requests.',
          });
        }

        // Execute the deletion with stock reversal
        await this.ordersService.softDeleteDeliveredOrder(orderId, approver, {
          approverNote: reason,
          csApproverName: approver.name ?? undefined,
          logiApproverName: approver.name ?? undefined,
        });

        // Stamp APPROVED on the request
        const now = new Date();
        await withActor(this.db, approver, async (tx) => {
          await tx
            .update(schema.permissionRequests)
            .set({
              status: 'APPROVED',
              approverId: approver.id,
              approvalReason: reason,
              approvedAt: now,
              updatedAt: now,
            })
            .where(eq(schema.permissionRequests.id, requestId));
        });

        const orderLabel = payload?.orderNo != null
          ? formatOrderNumber(payload.orderNo)
          : orderId.slice(0, 8).toUpperCase();

        this.notificationsService.enqueueCreate({
          userId: req.requesterId,
          type: 'approval:permission_request',
          title: 'Deletion request approved',
          body: `Your request to delete delivered order ${orderLabel} was approved by ${approver.name ?? 'Admin'}. The order has been removed and stock reversed.`,
          data: { requestId, action: 'APPROVED' },
        });

        return { success: true, action: 'APPROVED' };
      }

      // Determine which side the approver represents
      const isCSApprover =
        approver.role === 'HEAD_OF_CS' ||
        approver.role === 'BRANCH_ADMIN';
      const isLogiApprover =
        approver.role === 'HEAD_OF_LOGISTICS';
      const isSuperAdmin = approver.role === 'SUPER_ADMIN' || approver.role === 'ADMIN';

      // SuperAdmin/Admin can fill either unfilled side
      let stampCS = false;
      let stampLogi = false;
      if (isSuperAdmin) {
        if (!req.csApprovedBy) stampCS = true;
        else if (!req.logiApprovedBy) stampLogi = true;
        else {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Both sides have already approved.' });
        }
      } else if (isCSApprover) {
        if (req.csApprovedBy) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'CS side has already approved this request.' });
        }
        stampCS = true;
      } else if (isLogiApprover) {
        if (req.logiApprovedBy) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Logistics side has already approved this request.' });
        }
        stampLogi = true;
      } else {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only Head of CS, Head of Logistics, Branch Admin, or Admin can approve delivered order deletion requests.',
        });
      }

      const now = new Date();
      const updateSet: Record<string, unknown> = { updatedAt: now };
      if (stampCS) {
        updateSet.csApprovedBy = approver.id;
        updateSet.csApprovedAt = now;
        updateSet.csNote = reason || null;
      }
      if (stampLogi) {
        updateSet.logiApprovedBy = approver.id;
        updateSet.logiApprovedAt = now;
        updateSet.logiNote = reason || null;
      }

      await withActor(this.db, approver, async (tx) => {
        await tx
          .update(schema.permissionRequests)
          .set(updateSet)
          .where(eq(schema.permissionRequests.id, requestId));
      });

      // Check if both sides are now approved
      const bothApproved =
        (stampCS && !!req.logiApprovedBy) || (stampLogi && !!req.csApprovedBy) || (stampCS && stampLogi);

      if (!bothApproved) {
        // Partial approval — notify the other side and the requester
        const sideLabel = stampCS ? 'CS' : 'Logistics';
        const orderLabel = payload?.orderNo != null
          ? formatOrderNumber(payload.orderNo)
          : orderId.slice(0, 8).toUpperCase();

        this.notificationsService.enqueueCreate({
          userId: req.requesterId,
          type: 'approval:permission_request',
          title: 'Deletion request: partial approval',
          body: `${sideLabel} has approved the deletion of order ${orderLabel}. Awaiting the other department's approval.`,
          data: { requestId, action: 'PARTIAL_APPROVAL' },
        });

        return { success: true, action: 'PARTIAL_APPROVAL' };
      }

      // Both sides approved — resolve approver names for the timeline
      const csApproverId = stampCS ? approver.id : req.csApprovedBy!;
      const logiApproverId = stampLogi ? approver.id : req.logiApprovedBy!;
      const [csUser, logiUser] = await Promise.all([
        csApproverId === approver.id
          ? Promise.resolve({ name: approver.name })
          : this.db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, csApproverId)).limit(1).then((r) => r[0]),
        logiApproverId === approver.id
          ? Promise.resolve({ name: approver.name })
          : this.db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, logiApproverId)).limit(1).then((r) => r[0]),
      ]);

      // Execute the deletion with stock reversal
      await this.ordersService.softDeleteDeliveredOrder(orderId, approver, {
        approverNote: reason,
        csApproverName: csUser?.name ?? undefined,
        logiApproverName: logiUser?.name ?? undefined,
      });

      // Stamp APPROVED on the request
      await withActor(this.db, approver, async (tx) => {
        await tx
          .update(schema.permissionRequests)
          .set({
            status: 'APPROVED',
            approverId: approver.id,
            approvalReason: reason,
            approvedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.permissionRequests.id, requestId));
      });

      const orderLabelFinal = payload?.orderNo != null
        ? formatOrderNumber(payload.orderNo)
        : orderId.slice(0, 8).toUpperCase();

      this.notificationsService.enqueueCreate({
        userId: req.requesterId,
        type: 'approval:permission_request',
        title: 'Deletion request approved',
        body: `Your request to delete delivered order ${orderLabelFinal} was approved by both CS and Logistics. The order has been removed and stock reversed.`,
        data: { requestId, action: 'APPROVED' },
      });

      return { success: true, action: 'APPROVED' };
    } else if (req.type === 'ORDER_STATUS_RETRACK') {
      // ── Dual-approval retrack: HoCS + HoL must both sign off ──
      const payload = req.payload as {
        orderId?: string;
        orderNo?: number | null;
        currentStatus?: string;
        targetStatus?: string;
      } | null;
      const orderId = payload?.orderId;
      const targetStatus = payload?.targetStatus;
      if (!orderId || !targetStatus) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for order retrack request.',
        });
      }

      const isCSApprover =
        approver.role === 'HEAD_OF_CS' ||
        approver.role === 'BRANCH_ADMIN';
      const isLogiApprover =
        approver.role === 'HEAD_OF_LOGISTICS';
      const isSuperAdmin = approver.role === 'SUPER_ADMIN' || approver.role === 'ADMIN';

      let stampCS = false;
      let stampLogi = false;
      if (isSuperAdmin) {
        if (!req.csApprovedBy) stampCS = true;
        else if (!req.logiApprovedBy) stampLogi = true;
        else {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Both sides have already approved.' });
        }
      } else if (isCSApprover) {
        if (req.csApprovedBy) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'CS side has already approved this retrack request.' });
        }
        stampCS = true;
      } else if (isLogiApprover) {
        if (req.logiApprovedBy) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Logistics side has already approved this retrack request.' });
        }
        stampLogi = true;
      } else {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only Head of CS, Head of Logistics, Branch Admin, or Admin can approve retrack requests.',
        });
      }

      const now = new Date();
      const updateSet: Record<string, unknown> = { updatedAt: now };
      if (stampCS) {
        updateSet.csApprovedBy = approver.id;
        updateSet.csApprovedAt = now;
        updateSet.csNote = reason || null;
      }
      if (stampLogi) {
        updateSet.logiApprovedBy = approver.id;
        updateSet.logiApprovedAt = now;
        updateSet.logiNote = reason || null;
      }

      await withActor(this.db, approver, async (tx) => {
        await tx
          .update(schema.permissionRequests)
          .set(updateSet)
          .where(eq(schema.permissionRequests.id, requestId));
      });

      const bothApproved =
        (stampCS && !!req.logiApprovedBy) || (stampLogi && !!req.csApprovedBy) || (stampCS && stampLogi);

      const orderLabel = payload?.orderNo != null
        ? formatOrderNumber(payload.orderNo)
        : orderId.slice(0, 8).toUpperCase();

      if (!bothApproved) {
        const sideLabel = stampCS ? 'CS' : 'Logistics';
        this.notificationsService.enqueueCreate({
          userId: req.requesterId,
          type: 'approval:permission_request',
          title: 'Retrack request: partial approval',
          body: `${sideLabel} has approved the retrack of order ${orderLabel}. Awaiting the other department's approval.`,
          data: { requestId, action: 'PARTIAL_APPROVAL' },
        });
        return { success: true, action: 'PARTIAL_APPROVAL' };
      }

      // Both sides approved — execute the actual retrack transition
      await this.ordersService.transition(
        {
          orderId,
          newStatus: targetStatus as TransitionOrderInput['newStatus'],
          metadata: { reason: `Approved retrack request. ${reason ?? ''}`.trim() },
        },
        approver,
      );

      // Stamp APPROVED on the request
      await withActor(this.db, approver, async (tx) => {
        await tx
          .update(schema.permissionRequests)
          .set({
            status: 'APPROVED',
            approverId: approver.id,
            approvalReason: reason,
            approvedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.permissionRequests.id, requestId));
      });

      this.notificationsService.enqueueCreate({
        userId: req.requesterId,
        type: 'approval:permission_request',
        title: 'Retrack request approved',
        body: `Your request to retrack order ${orderLabel} to ${targetStatus} was approved by both CS and Logistics.`,
        data: { requestId, action: 'APPROVED' },
      });

      return { success: true, action: 'APPROVED' };
    } else if (req.type === 'PERMISSION_GRANT' && req.targetUserId && req.permissionCode) {
      // Phase 2: grant user_permission - for now we don't have the API, skip
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Permission grant approval not yet implemented',
      });
    } else {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid request type or missing data',
      });
    }

    // Then stamp the request itself with proper actor attribution.
    await withActor(this.db, approver, async (tx) => {
      await tx
        .update(schema.permissionRequests)
        .set({
          status: 'APPROVED',
          approverId: approver.id,
          approvalReason: reason,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.permissionRequests.id, requestId));
    });

    const productName =
      req.type === 'PRODUCT_ARCHIVE'
        ? ((req.payload as { productName?: string } | null)?.productName ?? 'product')
        : null;
    const orderPayload = req.payload as { orderId?: string; orderNo?: number | null } | null;
    const orderLabel = orderPayload?.orderNo != null
      ? formatOrderNumber(orderPayload.orderNo)
      : orderPayload?.orderId
        ? orderPayload.orderId.slice(0, 8).toUpperCase()
        : '';
    const approvalBody =
      req.type === 'PRODUCT_ARCHIVE' && productName
        ? `Your request to archive product "${productName}" was approved.`
        : req.type === 'ORDER_LINE_PRICE_CHANGE' && orderLabel
          ? `Your request to change line prices on order ${orderLabel} was approved.`
          : req.type === 'ORDER_DELETION' && orderLabel
            ? `Your request to archive order ${orderLabel} was approved.`
            : `Your request (${req.type}) was approved.`;

    this.notificationsService.enqueueCreate({
      userId: req.requesterId,
      type: 'approval:permission_request',
      title: 'Permission request approved',
      body: approvalBody,
      data: { requestId, action: 'APPROVED' },
    });

    return { success: true, action: 'APPROVED' };
  }

  /**
   * Reject a permission request. Gate varies by type (see assertApproverMayProcessRequest).
   * Requester may withdraw their own pending ORDER_LINE_PRICE_CHANGE or ORDER_DELETION without approver rights.
   */
  async reject(requestId: string, approver: SessionUser, reason: string) {
    const [found] = await this.db
      .select()
      .from(schema.permissionRequests)
      .where(eq(schema.permissionRequests.id, requestId))
      .limit(1);

    if (!found) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Permission request not found' });
    }
    if (found.status !== 'PENDING') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request already processed' });
    }

    const isOwnWithdrawalWithoutApproverRights =
      found.requesterId === approver.id &&
      (found.type === 'ORDER_LINE_PRICE_CHANGE' || found.type === 'ORDER_DELETION' || found.type === 'DELIVERED_ORDER_DELETION');
    if (!isOwnWithdrawalWithoutApproverRights) {
      await this.assertApproverMayProcessRequest(approver, found);
    }

    const req = await withActor(this.db, approver, async (tx) => {
      await tx
        .update(schema.permissionRequests)
        .set({
          status: 'REJECTED',
          approverId: approver.id,
          approvalReason: reason,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.permissionRequests.id, requestId));

      return found;
    });

    // Mirror the rejection on the order timeline so the requester / auditor sees a
    // single source of truth on the order detail page (they shouldn't have to drill
    // into permission-requests to find out what happened to their proposal).
    if (req.type === 'ORDER_LINE_PRICE_CHANGE') {
      const rejectOrderId = (req.payload as { orderId?: string } | null)?.orderId;
      const isWithdrawal = req.requesterId === approver.id;
      if (rejectOrderId) {
        const reasonSnippet = reason.length > 80 ? `${reason.slice(0, 77)}…` : reason;
        this.ordersService.writeTimelineEvent({
          orderId: rejectOrderId,
          eventType: 'LINE_PRICE_CHANGE_REJECTED',
          actorId: approver.id,
          actorName: approver.name ?? null,
          description: isWithdrawal
            ? `${approver.name ?? 'Requester'} withdrew the line price change request. Reason: "${reasonSnippet}"`
            : `${approver.name ?? 'Approver'} rejected the line price change request. Reason: "${reasonSnippet}"`,
          metadata: {
            permissionRequestId: requestId,
            rejectionReason: reason,
            withdrawn: isWithdrawal,
          },
        });
      }
    }

    const rejectProductName =
      req.type === 'PRODUCT_ARCHIVE'
        ? ((req.payload as { productName?: string } | null)?.productName ?? 'product')
        : null;
    const rejectPayload = req.payload as { orderId?: string; orderNo?: number | null } | null;
    const rejectOrderLabel = rejectPayload?.orderNo != null
      ? formatOrderNumber(rejectPayload.orderNo)
      : rejectPayload?.orderId
        ? rejectPayload.orderId.slice(0, 8).toUpperCase()
        : '';
    const rejectBody =
      req.type === 'PRODUCT_ARCHIVE' && rejectProductName
        ? `Your request to archive product "${rejectProductName}" was rejected. Reason: ${reason}`
        : req.type === 'ORDER_LINE_PRICE_CHANGE' && rejectOrderLabel
          ? `Your request to change line prices on order ${rejectOrderLabel} was rejected. Reason: ${reason}`
          : req.type === 'ORDER_DELETION' && rejectOrderLabel
            ? `Your request to archive order ${rejectOrderLabel} was rejected. Reason: ${reason}`
            : `Your request (${req.type}) was rejected. Reason: ${reason}`;

    this.notificationsService.enqueueCreate({
      userId: req.requesterId,
      type: 'approval:permission_request',
      title: 'Permission request rejected',
      body: rejectBody,
      data: { requestId, action: 'REJECTED' },
    });

    return { success: true, action: 'REJECTED' };
  }
}
