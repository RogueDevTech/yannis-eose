import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, desc } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { CreateStaffInput, UpdateStaffInput, UpdateOrderInput } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { withActor } from '../common/db/with-actor';
import { canonicalPermissionCode } from '@yannis/shared';
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
};

/** True when `viewer.permissions` contains `code` (canonical-aware). */
function viewerHasPermission(viewer: SessionUser, code: string): boolean {
  const target = canonicalPermissionCode(code);
  return (viewer.permissions ?? [])
    .map((p) => canonicalPermissionCode(p))
    .includes(target);
}

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
    if (req.type === 'ORDER_LINE_PRICE_CHANGE' || req.type === 'ORDER_DELETION') {
      const payload = req.payload as { orderId?: string } | null;
      const orderId = payload?.orderId;
      if (!orderId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            req.type === 'ORDER_DELETION'
              ? 'Invalid order archive request payload.'
              : 'Invalid price-change request payload.',
        });
      }
      const [order] = await this.db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1);
      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Order referenced by this request was not found.' });
      }
      if (order.deletedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This order has already been archived.' });
      }
      const allowed = await this.ordersService.canActorEditOrderLinePrices(approver, {
        branchId: order.branchId ?? null,
        assignedCsId: order.assignedCsId ?? null,
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
   * (so a CS Agent can track their own price-change asks).
   *
   * Permission-first: a viewer sees a type iff they hold its approve code (or are
   * admin-class). Adding a new request type is a one-line change to
   * `APPROVE_PERMISSION_BY_TYPE` plus a default grant in `permission-catalog.ts`.
   */
  private viewableTypesForViewer(viewer: SessionUser): Set<string> {
    if (viewer.role === 'SUPER_ADMIN') {
      return new Set(Object.keys(APPROVE_PERMISSION_BY_TYPE));
    }
    const types = new Set<string>();
    for (const [type, code] of Object.entries(APPROVE_PERMISSION_BY_TYPE)) {
      if (viewerHasPermission(viewer, code)) types.add(type);
    }
    return types;
  }

  /**
   * List all PENDING permission requests. Kept for backwards compatibility; thin wrapper
   * around {@link list} — new callers should use `list({ status: 'PENDING' })` directly.
   */
  async listPending(viewer?: SessionUser) {
    return this.list({ status: 'PENDING' }, viewer);
  }

  /**
   * List permission requests with an optional status filter.
   * Returns the full history (PENDING + APPROVED + REJECTED) when `status` is 'ALL' or omitted.
   * Enriched with requester, target, and approver names so the UI can show the full audit trail.
   *
   * When `viewer` is supplied, the result is scoped to:
   *   - rows the viewer submitted (any type), AND
   *   - rows of types the viewer is allowed to approve.
   * SuperAdmin / Admin pass through unfiltered.
   */
  async list(
    options?: { status?: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' },
    viewer?: SessionUser,
  ) {
    const statusFilter = options?.status ?? 'PENDING';

    const baseQuery = this.db
      .select({
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
        createdAt: schema.permissionRequests.createdAt,
      })
      .from(schema.permissionRequests);

    const allRows = statusFilter === 'ALL'
      ? await baseQuery.orderBy(desc(schema.permissionRequests.createdAt))
      : await baseQuery
          .where(eq(schema.permissionRequests.status, statusFilter))
          .orderBy(desc(schema.permissionRequests.createdAt));

    // Viewer-scope: when a viewer is supplied (every web call passes one), drop
    // rows the caller has no business seeing. Admin-class users see everything;
    // approvers see types they can approve; everyone else only sees rows they
    // submitted personally. Without this, a CS Agent typing /admin/permission-requests
    // could read every HR USER_CREATION, ORDER_DELETION reason, etc.
    const rows = viewer && viewer.role !== 'SUPER_ADMIN'
      ? (() => {
          const viewableTypes = this.viewableTypesForViewer(viewer);
          return allRows.filter(
            (r) => r.requesterId === viewer.id || viewableTypes.has(r.type),
          );
        })()
      : allRows;

    const enriched = await Promise.all(
      rows.map(async (row) => {
        const [requester, targetUser, approver] = await Promise.all([
          row.requesterId
            ? this.db
                .select({ name: schema.users.name, email: schema.users.email })
                .from(schema.users)
                .where(eq(schema.users.id, row.requesterId))
                .limit(1)
            : [],
          row.targetUserId
            ? this.db
                .select({ name: schema.users.name, email: schema.users.email })
                .from(schema.users)
                .where(eq(schema.users.id, row.targetUserId))
                .limit(1)
            : [],
          row.approverId
            ? this.db
                .select({ name: schema.users.name })
                .from(schema.users)
                .where(eq(schema.users.id, row.approverId))
                .limit(1)
            : [],
        ]);

        return {
          ...row,
          requesterName: requester[0]?.name ?? 'Unknown',
          requesterEmail: requester[0]?.email ?? '',
          targetUserName: targetUser[0]?.name ?? null,
          targetUserEmail: targetUser[0]?.email ?? null,
          approverName: approver[0]?.name ?? null,
        };
      }),
    );

    return enriched;
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
        items?: UpdateOrderInput['items'];
        totalAmount?: number;
      } | null;
      const orderId = payload?.orderId;
      const items = payload?.items;
      const totalAmount = payload?.totalAmount;
      if (!orderId || !items?.length || totalAmount == null || Number.isNaN(Number(totalAmount))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid payload for order line price change.',
        });
      }
      await this.ordersService.update(
        { orderId, items, totalAmount: Number(totalAmount) },
        approver,
      );
      // Surface the approval on the order timeline. The underlying `update` call writes
      // a `QUANTITY_UPDATED` event when items change, but that doesn't tell the CS rep
      // (or auditor) that this was specifically an approval of THEIR pending request.
      const approvedTotal = Math.round(Number(totalAmount) * 100) / 100;
      this.ordersService.writeTimelineEvent({
        orderId,
        eventType: 'LINE_PRICE_CHANGE_APPROVED',
        actorId: approver.id,
        actorName: approver.name ?? null,
        description:
          `${approver.name ?? 'Approver'} approved the line price change — ` +
          `new total ₦${approvedTotal.toLocaleString('en-NG')}.`,
        metadata: {
          permissionRequestId: requestId,
          approvedItems: items,
          approvedTotalAmount: Number(totalAmount),
          approvalReason: reason,
        },
      });
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
    const priceOrderId =
      req.type === 'ORDER_LINE_PRICE_CHANGE'
        ? ((req.payload as { orderId?: string } | null)?.orderId ?? '')
        : '';
    const deletionOrderId =
      req.type === 'ORDER_DELETION' ? ((req.payload as { orderId?: string } | null)?.orderId ?? '') : '';
    const approvalBody =
      req.type === 'PRODUCT_ARCHIVE' && productName
        ? `Your request to archive product "${productName}" was approved.`
        : req.type === 'ORDER_LINE_PRICE_CHANGE' && priceOrderId
          ? `Your request to change line prices on order ${priceOrderId.slice(0, 8).toUpperCase()} was approved.`
          : req.type === 'ORDER_DELETION' && deletionOrderId
            ? `Your request to archive order ${deletionOrderId.slice(0, 8).toUpperCase()} was approved.`
            : `Your request (${req.type}) was approved.`;

    // Notify requester
    await this.notificationsService
      .create({
        userId: req.requesterId,
        type: 'approval:permission_request',
        title: 'Permission request approved',
        body: approvalBody,
        data: { requestId, action: 'APPROVED' },
      })
      .catch(() => {});

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
      (found.type === 'ORDER_LINE_PRICE_CHANGE' || found.type === 'ORDER_DELETION');
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
    const rejectBody =
      req.type === 'PRODUCT_ARCHIVE' && rejectProductName
        ? `Your request to archive product "${rejectProductName}" was rejected. Reason: ${reason}`
        : `Your request (${req.type}) was rejected. Reason: ${reason}`;

    // Notify requester
    await this.notificationsService
      .create({
        userId: req.requesterId,
        type: 'approval:permission_request',
        title: 'Permission request rejected',
        body: rejectBody,
        data: { requestId, action: 'REJECTED' },
      })
      .catch(() => {});

    return { success: true, action: 'REJECTED' };
  }
}
