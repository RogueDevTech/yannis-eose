import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { randomBytes } from 'crypto';
import { eq, and, desc, asc, ilike, or, count, ne, inArray, sql } from 'drizzle-orm';
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

    // Preserve SuperAdmin singleton invariant: SUPER_ADMIN can ONLY be created via the public
    // /auth/setup flow (setupSuperAdmin), never via createStaff. Anyone attempting it is blocked.
    if (input.role === 'SUPER_ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message:
          'SUPER_ADMIN is a singleton and cannot be created via staff management. Use the initial setup flow.',
      });
    }

    // Sensitive-role approval flow: anyone other than SuperAdmin attempting to create a sensitive
    // role (ADMIN, FINANCE_OFFICER, etc.) generates a permission_request the SuperAdmin must approve.
    // This covers: HR creating any sensitive role, AND ADMIN creating another ADMIN.
    const isSuperAdmin = actor.role === 'SUPER_ADMIN';
    if (!isSuperAdmin && this.permissionsService.isSensitiveRole(input.role)) {
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

    // Enforce one active HEAD_OF_* per branch
    const HEAD_ROLES = ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS'] as const;
    if (HEAD_ROLES.includes(input.role as typeof HEAD_ROLES[number]) && input.primaryBranchId) {
      const existingHead = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.role, input.role as typeof schema.users.role._.data),
            eq(schema.users.primaryBranchId, input.primaryBranchId),
            eq(schema.users.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      if (existingHead[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Branch already has an active ${input.role.replace(/_/g, ' ').toLowerCase()} (${existingHead[0].name}). Deactivate them first.`,
        });
      }
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

    if (input.role !== 'SUPER_ADMIN' && input.role !== 'ADMIN') {
      if (!input.primaryBranchId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Primary branch is required for non-SuperAdmin users',
        });
      }

      const activeBranchRows = await this.db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(
          and(
            eq(schema.branches.id, input.primaryBranchId),
            eq(schema.branches.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      if (!activeBranchRows[0]) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Primary branch must exist and be active',
        });
      }
    }

    // Auto-generate a secure password for the new user
    const plainPassword = this.generatePassword();
    const passwordHash = await this.authService.hashPassword(plainPassword);

    const user = await this.db.transaction(async (tx) => {
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
          const planRows = await tx
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
      const rows = await tx
        .insert(schema.users)
        .values({
          name: input.name,
          email: input.email.toLowerCase(),
          passwordHash,
          role: input.role,
          status: 'PENDING', // New users stay PENDING until first login (then auth sets ACTIVE)
          capacity: input.capacity ?? 10,
          logisticsLocationId: input.logisticsLocationId ?? null,
          primaryBranchId: input.primaryBranchId ?? null,
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

      const createdUser = rows[0];
      if (!createdUser) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create user',
        });
      }

      if (input.primaryBranchId) {
        await tx
          .insert(schema.userBranches)
          .values({
            userId: createdUser.id,
            branchId: input.primaryBranchId,
            isPrimary: true,
            roleInBranch: null,
          });
      }

      if (input.productIds && input.productIds.length > 0) {
        await tx.insert(schema.userProductAssignments).values(
          input.productIds.map((productId) => ({
            userId: createdUser.id,
            productId,
          })),
        );
      }

      return createdUser;
    });

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

    if (input.productIds && input.productIds.length > 0) {
      this.notificationsService
        .create({
          userId: user.id,
          type: 'account:updated',
          title: 'Your account was updated',
          body: `Product access: ${input.productIds.length} product(s) assigned to your account. Sign in to use the catalog.`,
          data: {
            userId: user.id,
            changedKeys: ['productIds'],
            productCount: input.productIds.length,
          },
        })
        .catch(() => {});
    }

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
        primaryBranchId: schema.users.primaryBranchId,
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

    const assignmentRows = await this.db
      .select({ productId: schema.userProductAssignments.productId })
      .from(schema.userProductAssignments)
      .where(eq(schema.userProductAssignments.userId, user.id));

    const assignedProductIds = [...new Set(assignmentRows.map((r) => r.productId))];

    return {
      ...user,
      phone: this.maskPhone(user.phone),
      branchMemberships,
      assignedProductIds,
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
   * Minimal active-user search for push broadcast recipient picker.
   * Router gates with notifications.broadcast | users.read.
   */
  async searchForPushTarget(
    rawQuery: string,
    limit: number,
    offset: number,
  ): Promise<Array<{ id: string; name: string; email: string; role: string; hasPushSubscription: boolean }>> {
    const q = rawQuery.replace(/[%_\\]/g, ' ').trim();
    const cap = Math.min(25, Math.max(1, limit));
    const skip = Math.max(0, offset);

    const baseWhere = eq(schema.users.status, 'ACTIVE');
    const where =
      q.length > 0
        ? and(baseWhere, or(ilike(schema.users.name, `%${q}%`), ilike(schema.users.email, `%${q}%`)))
        : baseWhere;

    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        hasPushSubscription: sql<boolean>`EXISTS (
          SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = "users"."id"
        )`,
      })
      .from(schema.users)
      .where(where)
      .orderBy(asc(schema.users.name))
      .limit(cap)
      .offset(skip);

    return rows;
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
   * List active users holding a HEAD_OF_* role.
   * Used by the user create/edit forms to warn admins about duplicate heads
   * per branch before submit (the service already blocks the write, this is
   * a proactive UI hint).
   */
  async listActiveHeads(): Promise<Array<{
    id: string;
    name: string;
    role: string;
    primaryBranchId: string | null;
  }>> {
    return this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
        primaryBranchId: schema.users.primaryBranchId,
      })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.role, ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS']),
          eq(schema.users.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(schema.users.name));
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
      .select({
        id: schema.users.id,
        status: schema.users.status,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        capacity: schema.users.capacity,
        logisticsLocationId: schema.users.logisticsLocationId,
        phone: schema.users.phone,
        visibleOrderStatuses: schema.users.visibleOrderStatuses,
        restrictProductAccess: schema.users.restrictProductAccess,
        primaryBranchId: schema.users.primaryBranchId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId))
      .limit(1);

    if (!existingRows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const beforeRow = existingRows[0];
    const assignmentRowsBefore = await this.db
      .select({ productId: schema.userProductAssignments.productId })
      .from(schema.userProductAssignments)
      .where(eq(schema.userProductAssignments.userId, input.userId));
    const beforeProductIds = [...new Set(assignmentRowsBefore.map((r) => r.productId))].sort();

    // DEACTIVATED is permanent: cannot reactivate; admin must re-invite
    const currentStatus = beforeRow.status;
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

    // Sensitive-role approval flow on update — anyone other than SuperAdmin promoting someone to
    // a sensitive role (ADMIN, FINANCE_OFFICER, etc.) creates a permission_request for approval.
    const isSuperAdmin = actor.role === 'SUPER_ADMIN';
    // Additionally block non-SuperAdmins from promoting anyone to SUPER_ADMIN (singleton invariant).
    if (!isSuperAdmin && input.role === 'SUPER_ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the current SuperAdmin can transfer the SUPER_ADMIN role.',
      });
    }
    if (
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

    // Enforce one active HEAD_OF_* per branch on role change or branch change
    const HEAD_ROLES_UPDATE = ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS'] as const;
    const roleBeingSet = input.role ?? beforeRow.role;
    const branchBeingSet = beforeRow.primaryBranchId ?? null;
    if (
      HEAD_ROLES_UPDATE.includes(roleBeingSet as typeof HEAD_ROLES_UPDATE[number]) &&
      branchBeingSet &&
      input.role // only run if role is actually changing
    ) {
      const existingHead = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.role, roleBeingSet as typeof schema.users.role._.data),
            eq(schema.users.primaryBranchId, branchBeingSet),
            eq(schema.users.status, 'ACTIVE'),
            // exclude the user being updated themselves
            sql`${schema.users.id} != ${input.userId}`,
          ),
        )
        .limit(1);

      if (existingHead[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Branch already has an active ${roleBeingSet.replace(/_/g, ' ').toLowerCase()} (${existingHead[0].name}). Deactivate them first.`,
        });
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
        visibleOrderStatuses: schema.users.visibleOrderStatuses,
        restrictProductAccess: schema.users.restrictProductAccess,
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

    const afterProductIds =
      input.productIds !== undefined
        ? [...new Set(input.productIds)].sort()
        : beforeProductIds;

    this.notifyTargetUserAfterStaffUpdate({
      targetUserId: input.userId,
      before: {
        name: beforeRow.name,
        email: beforeRow.email,
        role: beforeRow.role,
        capacity: beforeRow.capacity,
        logisticsLocationId: beforeRow.logisticsLocationId,
        status: beforeRow.status,
        phone: beforeRow.phone,
        visibleOrderStatuses: beforeRow.visibleOrderStatuses,
        restrictProductAccess: beforeRow.restrictProductAccess,
      },
      beforeProductIds,
      after: {
        name: updated.name,
        email: updated.email,
        role: updated.role,
        capacity: updated.capacity,
        logisticsLocationId: updated.logisticsLocationId,
        status: updated.status,
        phone: updated.phone,
        visibleOrderStatuses: updated.visibleOrderStatuses,
        restrictProductAccess: updated.restrictProductAccess,
      },
      afterProductIds,
    });

    return {
      ...updated,
      phone: this.maskPhone(updated.phone),
      emailChangePending: emailChangePending || undefined,
    };
  }

  /**
   * Deactivate a staff member. Permanent (no reactivation).
   * - SuperAdmin may deactivate anyone (except themselves).
   * - Admin may deactivate non-admin-level users only.
   * - Others: forbidden.
   */
  async deactivate(userId: string, actor: SessionUser) {
    if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'ADMIN') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Super Admins and Admins can deactivate users.',
      });
    }
    if (userId === actor.id) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot deactivate your own account',
      });
    }
    // Admins cannot deactivate other admin-level users. Only SuperAdmin can do that.
    if (actor.role === 'ADMIN') {
      const [target] = await this.db
        .select({ role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);
      if (target && (target.role === 'SUPER_ADMIN' || target.role === 'ADMIN')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admins cannot deactivate another Admin or the SuperAdmin. Only the SuperAdmin can.',
        });
      }
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

    this.notificationsService
      .create({
        userId,
        type: 'account:security',
        title: 'Your account was deactivated',
        body: 'Your account has been deactivated. You can no longer sign in. Contact your administrator if you believe this is an error.',
        data: { userId, event: 'deactivated' },
      })
      .catch(() => {});

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

    this.notificationsService
      .create({
        userId: input.userId,
        type: 'account:security',
        title: 'Your password was reset',
        body: 'An administrator reset your password. Use the new credentials you were given. Contact support if you did not expect this.',
        data: { userId: input.userId, event: 'password_reset' },
      })
      .catch(() => {});

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

    const body =
      input.action === 'APPROVED'
        ? `Your login email was updated to ${req.requestedNewEmail}. Use this address to sign in from now on.`
        : `Your email change request was not approved. Reason: ${input.reason}`;

    this.notificationsService
      .create({
        userId: req.userId,
        type: 'account:updated',
        title:
          input.action === 'APPROVED' ? 'Your email was updated' : 'Email change request declined',
        body,
        data: {
          userId: req.userId,
          changedKeys: input.action === 'APPROVED' ? ['email'] : [],
          emailChangeAction: input.action,
        },
      })
      .catch(() => {});

    return { success: true, action: input.action };
  }

  /**
   * Notify the affected user after staff profile/access fields change (one notification per save).
   */
  private notifyTargetUserAfterStaffUpdate(params: {
    targetUserId: string;
    before: {
      name: string;
      email: string;
      role: string;
      capacity: number;
      logisticsLocationId: string | null;
      status: string;
      phone: string | null;
      visibleOrderStatuses: unknown;
      restrictProductAccess: boolean;
    };
    beforeProductIds: string[];
    after: {
      name: string;
      email: string;
      role: string;
      capacity: number;
      logisticsLocationId: string | null;
      status: string;
      phone: string | null;
      visibleOrderStatuses: unknown;
      restrictProductAccess: boolean;
    };
    afterProductIds: string[];
  }): void {
    const { targetUserId, before, after, beforeProductIds, afterProductIds } = params;

    const normJson = (v: unknown) => JSON.stringify(v ?? null);
    const changedKeys: string[] = [];
    if (before.name !== after.name) changedKeys.push('name');
    if (before.email !== after.email) changedKeys.push('email');
    if (before.role !== after.role) changedKeys.push('role');
    if (before.capacity !== after.capacity) changedKeys.push('capacity');
    if (before.logisticsLocationId !== after.logisticsLocationId) {
      changedKeys.push('logisticsLocationId');
    }
    if (before.status !== after.status) changedKeys.push('status');
    if (before.phone !== after.phone) changedKeys.push('phone');
    if (normJson(before.visibleOrderStatuses) !== normJson(after.visibleOrderStatuses)) {
      changedKeys.push('visibleOrderStatuses');
    }
    if (before.restrictProductAccess !== after.restrictProductAccess) {
      changedKeys.push('restrictProductAccess');
    }
    const productsChanged = beforeProductIds.join('\0') !== afterProductIds.join('\0');
    if (productsChanged) changedKeys.push('productIds');

    if (changedKeys.length === 0) return;

    const lines: string[] = [];
    if (changedKeys.includes('name')) lines.push('Your display name was updated.');
    if (changedKeys.includes('email')) lines.push('Your login email was changed.');
    if (changedKeys.includes('role')) lines.push(`Your role was updated to ${after.role}.`);
    if (changedKeys.includes('capacity')) lines.push(`Your order capacity was set to ${after.capacity}.`);
    if (changedKeys.includes('logisticsLocationId')) {
      lines.push('Your logistics location assignment was updated.');
    }
    if (changedKeys.includes('status')) {
      lines.push(`Your account status is now ${after.status}.`);
    }
    if (changedKeys.includes('phone')) lines.push('Your phone number on file was updated.');
    if (changedKeys.includes('visibleOrderStatuses')) {
      lines.push('Your visible order statuses preference was updated.');
    }
    if (changedKeys.includes('restrictProductAccess')) {
      lines.push(
        after.restrictProductAccess
          ? 'Product access is now limited to assigned products only.'
          : 'Product access restriction was turned off.',
      );
    }
    if (changedKeys.includes('productIds')) {
      const n = afterProductIds.length;
      lines.push(
        n === 0
          ? 'Your product assignments were cleared; catalog access follows your role defaults.'
          : `Your product access was updated (${n} product(s) assigned).`,
      );
    }

    const becameDeactivated = before.status !== 'DEACTIVATED' && after.status === 'DEACTIVATED';
    const type = becameDeactivated ? 'account:security' : 'account:updated';
    const title = becameDeactivated ? 'Your account was deactivated' : 'Your account was updated';

    this.notificationsService
      .create({
        userId: targetUserId,
        type,
        title,
        body: lines.join(' '),
        data: {
          userId: targetUserId,
          changedKeys,
          ...(becameDeactivated ? { event: 'deactivated' as const } : {}),
        },
      })
      .catch(() => {});
  }

  /** Current saved theme preference from DB (null = org default). */
  async getAppThemePreference(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ appTheme: schema.users.appTheme })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row?.appTheme ?? null;
  }

  /**
   * Persists the current user's appearance theme. `null` = follow org default (`client_ui_config`).
   */
  async updateMyAppTheme(appTheme: string | null, actor: SessionUser): Promise<{ appTheme: string | null }> {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const [row] = await this.db
      .update(schema.users)
      .set({ appTheme, updatedAt: new Date() })
      .where(eq(schema.users.id, actor.id))
      .returning({ appTheme: schema.users.appTheme });

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return { appTheme: row.appTheme ?? null };
  }

  /** Current saved font scale preference from DB (null = base). */
  async getFontScalePreference(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ fontScale: schema.users.fontScale })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row?.fontScale ?? null;
  }

  /**
   * Persists the current user's font scale. `null` = reset to base.
   */
  async updateMyFontScale(fontScale: string | null, actor: SessionUser): Promise<{ fontScale: string | null }> {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`;

    const [row] = await this.db
      .update(schema.users)
      .set({ fontScale, updatedAt: new Date() })
      .where(eq(schema.users.id, actor.id))
      .returning({ fontScale: schema.users.fontScale });

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    return { fontScale: row.fontScale ?? null };
  }
}
