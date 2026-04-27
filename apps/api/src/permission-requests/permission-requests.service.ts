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
import { isAdminLevel, isSuperAdminOnly } from '../common/authz';
import { ProductsService } from '../products/products.service';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class PermissionRequestsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly productsService: ProductsService,
    private readonly ordersService: OrdersService,
  ) {}

  private async assertApproverMayProcessRequest(
    approver: SessionUser,
    req: InferSelectModel<typeof schema.permissionRequests>,
  ): Promise<void> {
    if (req.type === 'PRODUCT_ARCHIVE') {
      if (!isSuperAdminOnly(approver)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only SuperAdmin can process product archive requests.',
        });
      }
      return;
    }
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
            'Only Head of CS, Head of Logistics, Branch Admin, a CS team supervisor for the assignee, or an Admin may process this request.',
        });
      }
      return;
    }
    const hasAudit = approver.permissions?.includes('audit.read') ?? false;
    if (!hasAudit && !isAdminLevel(approver)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to process this type of request.',
      });
    }
  }

  /**
   * List all PENDING permission requests. Kept for backwards compatibility; thin wrapper
   * around {@link list} — new callers should use `list({ status: 'PENDING' })` directly.
   */
  async listPending() {
    return this.list({ status: 'PENDING' });
  }

  /**
   * List permission requests with an optional status filter.
   * Returns the full history (PENDING + APPROVED + REJECTED) when `status` is 'ALL' or omitted.
   * Enriched with requester, target, and approver names so the UI can show the full audit trail.
   */
  async list(options?: { status?: 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' }) {
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

    const rows = statusFilter === 'ALL'
      ? await baseQuery.orderBy(desc(schema.permissionRequests.createdAt))
      : await baseQuery
          .where(eq(schema.permissionRequests.status, statusFilter))
          .orderBy(desc(schema.permissionRequests.createdAt));

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
