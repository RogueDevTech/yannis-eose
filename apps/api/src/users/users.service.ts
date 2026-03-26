import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { randomBytes } from 'crypto';
import { eq, and, desc, asc, ilike, or, count, ne, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type {
  SetupSuperAdminInput,
  CreateStaffInput,
  UpdateStaffInput,
  ListUsersInput,
  ResetPasswordInput,
} from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { AuthService } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly authService: AuthService,
    private readonly notificationsService: NotificationsService,
    private readonly permissionsService: PermissionsService,
  ) {}

  /**
   * Generate a secure random password.
   */
  private generatePassword(length = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    const bytes = randomBytes(length);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  }

  /**
   * Mask a phone number for API responses (Lead Fortress).
   * 08031234567 → 0803****4567
   */
  private maskPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    if (phone.length < 8) return '****';
    return phone.substring(0, 4) + '****' + phone.substring(phone.length - 4);
  }

  private async getUserBranchMemberships(userIds: string[]): Promise<Map<string, Array<{
    branchId: string;
    branchName: string;
    branchCode: string;
    isPrimary: boolean;
    roleInBranch: string | null;
  }>>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        userId: schema.userBranches.userId,
        branchId: schema.userBranches.branchId,
        branchName: schema.branches.name,
        branchCode: schema.branches.code,
        isPrimary: schema.userBranches.isPrimary,
        roleInBranch: schema.userBranches.roleInBranch,
      })
      .from(schema.userBranches)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.userBranches.branchId))
      .where(inArray(schema.userBranches.userId, userIds))
      .orderBy(desc(schema.userBranches.isPrimary), asc(schema.branches.name));

    const membershipsByUser = new Map<string, Array<{
      branchId: string;
      branchName: string;
      branchCode: string;
      isPrimary: boolean;
      roleInBranch: string | null;
    }>>();
    for (const row of rows) {
      const existing = membershipsByUser.get(row.userId) ?? [];
      existing.push({
        branchId: row.branchId,
        branchName: row.branchName,
        branchCode: row.branchCode,
        isPrimary: row.isPrimary,
        roleInBranch: row.roleInBranch ?? null,
      });
      membershipsByUser.set(row.userId, existing);
    }
    return membershipsByUser;
  }

  /**
   * One-time SuperAdmin setup.
   * Only works when no users exist in the database.
   */
  async setupSuperAdmin(input: SetupSuperAdminInput) {
    const existingRows = await this.db
      .select({ count: count() })
      .from(schema.users);

    const existingCount = existingRows[0]?.count ?? 0;
    if (existingCount > 0) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Setup has already been completed. A SuperAdmin already exists.',
      });
    }

    const passwordHash = await this.authService.hashPassword(input.password);

    const rows = await this.db
      .insert(schema.users)
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        capacity: 100,
      })
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        createdAt: schema.users.createdAt,
      });

    const user = rows[0];
    if (!user) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create SuperAdmin',
      });
    }

    return user;
  }

  /**
   * Check if the system has been set up (any users exist).
   */
  async isSetupComplete(): Promise<boolean> {
    const rows = await this.db
      .select({ count: count() })
      .from(schema.users);

    return (rows[0]?.count ?? 0) > 0;
  }

  /**
   * Internal: Create user from payload. Used when SuperAdmin approves a USER_CREATION request.
   * Same logic as createStaff but bypasses HR scope checks.
   */
  async createStaffFromPayload(input: CreateStaffInput, actor: SessionUser) {
    return this.createStaff(input, actor);
  }

  /**
   * Create a new staff member with full settings.
   * Handles: product assignments, inline commission plan, phone masking.
   * If actor is HR (non-SuperAdmin) and role is sensitive, creates permission_request instead.
   */
  async createStaff(input: CreateStaffInput, actor: SessionUser) {
    // Set actor for audit trail
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    // HR scope check: if HR (has users.create but not SuperAdmin) and role is sensitive, create request
    const isSuperAdmin = actor.role === 'SUPER_ADMIN';
    const hasUsersCreate =
      isSuperAdmin || (actor.permissions ?? []).includes('users.create');
    if (hasUsersCreate && !isSuperAdmin && this.permissionsService.isSensitiveRole(input.role)) {
      const [req] = await this.db
        .insert(schema.permissionRequests)
        .values({
          type: 'USER_CREATION',
          status: 'PENDING',
          requesterId: actor.id,
          requestedRole: input.role,
          reason: `HR requested creation of user with role ${input.role}`,
          payload: input as unknown as Record<string, unknown>,
        })
        .returning({ id: schema.permissionRequests.id });

      if (req?.id) {
        this.notificationsService
          .createForRole('SUPER_ADMIN', {
            type: 'approval:permission_request',
            title: 'Permission request pending',
            body: `HR requested to create user "${input.name}" (${input.email}) with role ${input.role}.`,
            data: { requestId: req.id, type: 'USER_CREATION' },
          })
          .catch(() => {});

        return {
          requiresApproval: true,
          requestId: req.id,
          message: 'User creation request submitted. SuperAdmin will review.',
        };
      }
    }

    // Check for duplicate email
    const existingRows = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, input.email.toLowerCase()))
      .limit(1);

    if (existingRows[0]) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A user with this email already exists',
      });
    }

    // Check for duplicate phone
    if (input.phone) {
      const phoneRows = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.phone, input.phone))
        .limit(1);

      if (phoneRows[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A user with this phone number already exists',
        });
      }
    }

    // Auto-generate a secure password for the new user
    const plainPassword = this.generatePassword();
    const passwordHash = await this.authService.hashPassword(plainPassword);

    // If inline compensation provided, create a commission plan first
    let commissionPlanId = input.commissionPlanId ?? null;
    if (input.compensation && !commissionPlanId) {
      const comp = input.compensation;
      const hasAnyCompensation =
        (comp.fixedSalary && comp.fixedSalary > 0) ||
        (comp.bonus && comp.bonus > 0) ||
        (comp.commissionValue && comp.commissionValue > 0) ||
        (comp.upsellCommissionValue && comp.upsellCommissionValue > 0);

      if (hasAnyCompensation) {
        const planRows = await this.db
          .insert(schema.commissionPlans)
          .values({
            role: input.role,
            planName: `${input.name} - ${input.role} Plan`,
            rules: {
              baseSalary: comp.fixedSalary ?? 0,
              bonus: comp.bonus ?? 0,
              perOrderRate: comp.commissionType === 'PERCENTAGE' ? 0 : (comp.commissionValue ?? 0),
              perOrderPercentage: comp.commissionType === 'PERCENTAGE' ? (comp.commissionValue ?? 0) : 0,
              commissionType: comp.commissionType ?? 'FLAT',
              upsellCommissionType: comp.upsellCommissionType ?? 'FLAT',
              upsellCommissionValue: comp.upsellCommissionValue ?? 0,
              salesTargetEnabled: comp.salesTargetEnabled ?? false,
              salesTargetPercentage: comp.salesTargetPercentage ?? 0,
            },
            effectiveFrom: new Date(),
            createdBy: actor.id,
          })
          .returning({ id: schema.commissionPlans.id });

        commissionPlanId = planRows[0]?.id ?? null;
      }
    }

    // Insert user with all fields
    const rows = await this.db
      .insert(schema.users)
      .values({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        role: input.role,
        status: 'PENDING', // New users stay PENDING until first login (then auth sets ACTIVE)
        capacity: input.capacity ?? 10,
        logisticsLocationId: input.logisticsLocationId ?? null,
        phone: input.phone ?? null,
        visibleOrderStatuses: input.visibleOrderStatuses ?? null,
        restrictProductAccess: input.restrictProductAccess ?? false,
        commissionPlanId,
      })
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        capacity: schema.users.capacity,
        logisticsLocationId: schema.users.logisticsLocationId,
        phone: schema.users.phone,
        createdAt: schema.users.createdAt,
      });

    const user = rows[0];
    if (!user) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create user',
      });
    }

    // Insert product assignments if provided
    if (input.productIds && input.productIds.length > 0) {
      await this.db.insert(schema.userProductAssignments).values(
        input.productIds.map((productId) => ({
          userId: user.id,
          productId,
        })),
      );
    }

    // Send invite email with login credentials (non-blocking)
    const loginUrl = process.env['APP_URL'] ?? 'http://localhost:4001';
    this.notificationsService
      .sendInviteEmail({
        to: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        password: plainPassword,
        loginUrl: `${loginUrl}/auth`,
      })
      .then((sent) => {
        if (sent) {
          this.logger.log(`Invite email sent to ${input.email}`);
        } else {
          this.logger.warn(`Invite email not sent to ${input.email} (SendGrid may not be configured)`);
        }
      })
      .catch((err) => {
        this.logger.error(`Failed to send invite email to ${input.email}: ${err}`);
      });

    return {
      ...user,
      phone: this.maskPhone(user.phone),
    };
  }

  /**
   * Get a single user by ID.
   * Never returns passwordHash. Phone is masked.
   */
  async getById(userId: string) {
    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        capacity: schema.users.capacity,
        logisticsLocationId: schema.users.logisticsLocationId,
        phone: schema.users.phone,
        visibleOrderStatuses: schema.users.visibleOrderStatuses,
        restrictProductAccess: schema.users.restrictProductAccess,
        commissionPlanId: schema.users.commissionPlanId,
        createdAt: schema.users.createdAt,
        updatedAt: schema.users.updatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const user = rows[0];
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const membershipsByUser = await this.getUserBranchMemberships([user.id]);
    const branchMemberships = membershipsByUser.get(user.id) ?? [];

    return {
      ...user,
      phone: this.maskPhone(user.phone),
      branchMemberships,
    };
  }

  /**
   * List users with filtering, search, and pagination.
   * Phone numbers are masked in responses.
   */
  async list(input: ListUsersInput) {
    const conditions = [];

    // Default: exclude DEACTIVATED (record stays in DB; only visible when filter status=DEACTIVATED)
    if (!input.status) {
      conditions.push(ne(schema.users.status, 'DEACTIVATED'));
    }

    if (input.role) {
      conditions.push(eq(schema.users.role, input.role));
    }
    if (input.status) {
      conditions.push(eq(schema.users.status, input.status));
    }
    if (input.search) {
      conditions.push(
        or(
          ilike(schema.users.name, `%${input.search}%`),
          ilike(schema.users.email, `%${input.search}%`),
        ),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderByColumn = {
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      createdAt: schema.users.createdAt,
    }[input.sortBy];

    const orderDirection = input.sortOrder === 'asc' ? asc : desc;
    const offset = (input.page - 1) * input.limit;

    const [users, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          role: schema.users.role,
          status: schema.users.status,
          capacity: schema.users.capacity,
          logisticsLocationId: schema.users.logisticsLocationId,
          phone: schema.users.phone,
          createdAt: schema.users.createdAt,
        })
        .from(schema.users)
        .where(whereClause)
        .orderBy(orderDirection(orderByColumn))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.users)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;
    const membershipsByUser = await this.getUserBranchMemberships(users.map((u) => u.id));

    return {
      users: users.map((u) => ({
        ...u,
        phone: this.maskPhone(u.phone),
        branchMemberships: membershipsByUser.get(u.id) ?? [],
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
   * List CS team members (HEAD_OF_CS + CS_AGENT) for Team page.
   * Gated by cs.teamOverview; does not require users.read.
   */
  async listCSTeam(): Promise<Array<{
    id: string;
    name: string;
    role: string;
    branchMemberships: Array<{
      branchId: string;
      branchName: string;
      branchCode: string;
      isPrimary: boolean;
      roleInBranch: string | null;
    }>;
  }>> {
    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
      })
      .from(schema.users)
      .where(
        and(
          or(eq(schema.users.role, 'CS_AGENT'), eq(schema.users.role, 'HEAD_OF_CS')),
          eq(schema.users.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(schema.users.name));

    const membershipsByUser = await this.getUserBranchMemberships(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      branchMemberships: membershipsByUser.get(r.id) ?? [],
    }));
  }

  /**
   * Update a staff member's details.
   * If actor is HR and requested role is sensitive, creates permission_request instead.
   */
  async update(input: UpdateStaffInput, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    if (input.userId === actor.id && input.role) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot change your own role',
      });
    }

    const existingRows = await this.db
      .select({ id: schema.users.id, status: schema.users.status })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);

    if (!existingRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    // DEACTIVATED is permanent: cannot reactivate; admin must re-invite
    const currentStatus = existingRows[0].status;
    if (
      currentStatus === 'DEACTIVATED' &&
      input.status !== undefined &&
      input.status !== 'DEACTIVATED'
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Deactivated accounts cannot be reactivated. Re-invite the user to create a new account.',
      });
    }

    // HR scope check: if HR and role change to sensitive, create request
    const isSuperAdmin = actor.role === 'SUPER_ADMIN';
    const hasUsersUpdate =
      isSuperAdmin || (actor.permissions ?? []).includes('users.update');
    if (
      hasUsersUpdate &&
      !isSuperAdmin &&
      input.role &&
      this.permissionsService.isSensitiveRole(input.role)
    ) {
      // Self-grant prevention: HR cannot request role change for themselves
      if (input.userId === actor.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot request sensitive role for yourself',
        });
      }

      const [req] = await this.db
        .insert(schema.permissionRequests)
        .values({
          type: 'ROLE_CHANGE',
          status: 'PENDING',
          requesterId: actor.id,
          targetUserId: input.userId,
          requestedRole: input.role,
          reason: `HR requested role change to ${input.role}`,
          payload: input as unknown as Record<string, unknown>,
        })
        .returning({ id: schema.permissionRequests.id });

      if (req?.id) {
        this.notificationsService
          .createForRole('SUPER_ADMIN', {
            type: 'approval:permission_request',
            title: 'Permission request pending',
            body: `HR requested to change user role to ${input.role}.`,
            data: { requestId: req.id, type: 'ROLE_CHANGE', targetUserId: input.userId },
          })
          .catch(() => {});

        return {
          requiresApproval: true,
          requestId: req.id,
          message: 'Role change request submitted. SuperAdmin will review.',
        };
      }
    }

    let emailChangePending = false;

    // Email changes require SuperAdmin approval — create request instead of applying
    if (input.email) {
      const newEmail = input.email.toLowerCase();
      const emailRows = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, newEmail))
        .limit(1);

      if (emailRows[0] && emailRows[0].id !== input.userId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A user with this email already exists',
        });
      }

      // Cancel any existing PENDING request for this user
      await this.db
        .update(schema.emailChangeRequests)
        .set({ status: 'REJECTED', updatedAt: new Date(), approvalReason: 'Superseded by new request' })
        .where(
          and(
            eq(schema.emailChangeRequests.userId, input.userId),
            eq(schema.emailChangeRequests.status, 'PENDING'),
          ),
        );

      // Create new email change request
      const requestRows = await this.db
        .insert(schema.emailChangeRequests)
        .values({
          userId: input.userId,
          requestedNewEmail: newEmail,
          requesterId: actor.id,
          status: 'PENDING',
        })
        .returning({ id: schema.emailChangeRequests.id });

      const requestId = requestRows[0]?.id;
      if (requestId) {
        this.notificationsService
          .createForRole('SUPER_ADMIN', {
            type: 'approval:email_change',
            title: 'Email change approval required',
            body: `A user has requested an email change. Approval needed.`,
            data: { requestId, userId: input.userId, requestedNewEmail: newEmail },
          })
          .catch((err) => this.logger.warn(`Failed to notify SuperAdmin: ${err}`));
      }

      emailChangePending = true;
      // Do NOT apply email in this update — it will be applied when SuperAdmin approves
      delete (input as { email?: string }).email;
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateFields['name'] = input.name;
    if (input.email !== undefined) updateFields['email'] = input.email.toLowerCase();
    if (input.role !== undefined) updateFields['role'] = input.role;
    if (input.capacity !== undefined) updateFields['capacity'] = input.capacity;
    if (input.logisticsLocationId !== undefined) updateFields['logisticsLocationId'] = input.logisticsLocationId;
    if (input.status !== undefined) updateFields['status'] = input.status;
    if (input.phone !== undefined) {
      if (input.phone) {
        const phoneRows = await this.db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.phone, input.phone), ne(schema.users.id, input.userId)))
          .limit(1);

        if (phoneRows[0]) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A user with this phone number already exists',
          });
        }
      }
      updateFields['phone'] = input.phone;
    }
    if (input.visibleOrderStatuses !== undefined) updateFields['visibleOrderStatuses'] = input.visibleOrderStatuses;
    if (input.restrictProductAccess !== undefined) updateFields['restrictProductAccess'] = input.restrictProductAccess;

    const updatedRows = await this.db
      .update(schema.users)
      .set(updateFields)
      .where(eq(schema.users.id, input.userId))
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        capacity: schema.users.capacity,
        logisticsLocationId: schema.users.logisticsLocationId,
        phone: schema.users.phone,
        updatedAt: schema.users.updatedAt,
      });

    const updated = updatedRows[0];
    if (!updated) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update user',
      });
    }

    // Update product assignments if provided
    if (input.productIds !== undefined) {
      // Delete existing assignments
      await this.db
        .delete(schema.userProductAssignments)
        .where(eq(schema.userProductAssignments.userId, input.userId));

      // Insert new ones
      if (input.productIds.length > 0) {
        await this.db.insert(schema.userProductAssignments).values(
          input.productIds.map((productId) => ({
            userId: input.userId,
            productId,
          })),
        );
      }
    }

    if (input.status === 'INACTIVE' || input.status === 'ARCHIVED' || input.status === 'DEACTIVATED') {
      await this.authService.killUserSessions(input.userId);
    }

    return {
      ...updated,
      phone: this.maskPhone(updated.phone),
      emailChangePending: emailChangePending || undefined,
    };
  }

  /**
   * Deactivate a staff member. SuperAdmin only; permanent (no reactivation).
   */
  async deactivate(userId: string, actor: SessionUser) {
    if (actor.role !== 'SUPER_ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Super Admins can deactivate users.',
      });
    }
    if (userId === actor.id) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot deactivate your own account',
      });
    }

    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const updatedRows = await this.db
      .update(schema.users)
      .set({ status: 'DEACTIVATED', updatedAt: new Date() })
      .where(eq(schema.users.id, userId))
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        status: schema.users.status,
      });

    const updated = updatedRows[0];
    if (!updated) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    await this.authService.killUserSessions(userId);

    return updated;
  }

  /**
   * Reset a user's password (admin action).
   */
  async resetPassword(input: ResetPasswordInput, actor: SessionUser) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const passwordHash = await this.authService.hashPassword(input.newPassword);

    const updatedRows = await this.db
      .update(schema.users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(schema.users.id, input.userId))
      .returning({ id: schema.users.id });

    if (!updatedRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    await this.authService.killUserSessions(input.userId);

    return { success: true };
  }

  /**
   * Get pending email change request for a user (SuperAdmin only).
   */
  async getPendingEmailChangeForUser(userId: string) {
    const rows = await this.db
      .select()
      .from(schema.emailChangeRequests)
      .where(
        and(
          eq(schema.emailChangeRequests.userId, userId),
          eq(schema.emailChangeRequests.status, 'PENDING'),
        ),
      )
      .orderBy(desc(schema.emailChangeRequests.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Approve or reject an email change request (SuperAdmin only).
   */
  async processEmailChange(
    input: { requestId: string; action: 'APPROVED' | 'REJECTED'; reason: string },
    actor: SessionUser,
  ) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const rows = await this.db
      .select()
      .from(schema.emailChangeRequests)
      .where(eq(schema.emailChangeRequests.id, input.requestId))
      .limit(1);

    const req = rows[0];
    if (!req) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Email change request not found' });
    }
    if (req.status !== 'PENDING') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request already processed' });
    }

    if (input.action === 'APPROVED') {
      // Check new email is not taken
      const existing = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, req.requestedNewEmail))
        .limit(1);

      if (existing[0] && existing[0].id !== req.userId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A user with this email already exists',
        });
      }

      await this.db
        .update(schema.users)
        .set({ email: req.requestedNewEmail, updatedAt: new Date() })
        .where(eq(schema.users.id, req.userId));
    }

    await this.db
      .update(schema.emailChangeRequests)
      .set({
        status: input.action,
        approverId: actor.id,
        approvalReason: input.reason,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.emailChangeRequests.id, input.requestId));

    return { success: true, action: input.action };
  }
}
