import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type { CreateStaffInput, UpdateStaffInput } from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class PermissionRequestsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * List all PENDING permission requests (SuperAdmin only).
   */
  async listPending() {
    const rows = await this.db
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
        createdAt: schema.permissionRequests.createdAt,
      })
      .from(schema.permissionRequests)
      .where(eq(schema.permissionRequests.status, 'PENDING'))
      .orderBy(desc(schema.permissionRequests.createdAt));

    // Enrich with requester and target user names
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const [requester, targetUser] = await Promise.all([
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
        ]);

        return {
          ...row,
          requesterName: requester[0]?.name ?? 'Unknown',
          requesterEmail: requester[0]?.email ?? '',
          targetUserName: targetUser[0]?.name ?? null,
          targetUserEmail: targetUser[0]?.email ?? null,
        };
      }),
    );

    return enriched;
  }

  /**
   * Approve a permission request. SuperAdmin only.
   * Applies the change: creates user (USER_CREATION) or updates role (ROLE_CHANGE).
   */
  async approve(requestId: string, approver: SessionUser, reason: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${approver.id}, true)`;

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

    await this.db
      .update(schema.permissionRequests)
      .set({
        status: 'APPROVED',
        approverId: approver.id,
        approvalReason: reason,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.permissionRequests.id, requestId));

    // Notify requester
    await this.notificationsService
      .create({
        userId: req.requesterId,
        type: 'approval:permission_request',
        title: 'Permission request approved',
        body: `Your request (${req.type}) was approved by SuperAdmin.`,
        data: { requestId, action: 'APPROVED' },
      })
      .catch(() => {});

    return { success: true, action: 'APPROVED' };
  }

  /**
   * Reject a permission request. SuperAdmin only.
   */
  async reject(requestId: string, approver: SessionUser, reason: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${approver.id}, true)`;

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

    await this.db
      .update(schema.permissionRequests)
      .set({
        status: 'REJECTED',
        approverId: approver.id,
        approvalReason: reason,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.permissionRequests.id, requestId));

    // Notify requester
    await this.notificationsService
      .create({
        userId: req.requesterId,
        type: 'approval:permission_request',
        title: 'Permission request rejected',
        body: `Your request (${req.type}) was rejected. Reason: ${reason}`,
        data: { requestId, action: 'REJECTED' },
      })
      .catch(() => {});

    return { success: true, action: 'REJECTED' };
  }
}
