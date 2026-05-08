import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import * as bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'crypto';
import { eq, and, desc, asc, ilike, or, count, ne, inArray, sql, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  SetupSuperAdminInput,
  CreateStaffInput,
  UpdateStaffInput,
  ListUsersInput,
  ResetPasswordInput,
} from '@yannis/shared';
import {
  canonicalPermissionCode,
  mergePermissionSnapshot,
  defaultProbationUntilFromNow,
  isRoleProbationEligible,
} from '@yannis/shared';
import type {
  SetProbationInput,
  ExtendProbationInput,
  MarkProbationPermanentInput,
  TerminateProbationInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { AuthService } from '../auth/auth.service';
import { UserBundleCacheService } from '../auth/user-bundle-cache.service';
import { withActor } from '../common/db/with-actor';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../permissions/permissions.service';
import { EventsService } from '../events/events.service';
import { resolveRoleTemplateBaselineCodes } from '../permissions/role-template-baseline';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevelRole } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';

type DbTx = Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0];

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly authService: AuthService,
    private readonly notificationsService: NotificationsService,
    private readonly permissionsService: PermissionsService,
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => UserBundleCacheService))
    private readonly userBundleCache: UserBundleCacheService,
  ) {}

  private defaultScopeForRole(role: string): { scopeGlobal: boolean; scopeOrgWideHead: boolean } {
    if (isAdminLevelRole(role)) {
      return { scopeGlobal: true, scopeOrgWideHead: false };
    }
    if (role === 'HEAD_OF_CS' || role === 'HEAD_OF_MARKETING' || role === 'HEAD_OF_LOGISTICS') {
      return { scopeGlobal: false, scopeOrgWideHead: true };
    }
    return { scopeGlobal: false, scopeOrgWideHead: false };
  }

  private async resolveRoleTemplateIdForEnumRole(role: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: schema.roleTemplates.id })
      .from(schema.roleTemplates)
      .where(
        and(
          eq(schema.roleTemplates.kind, 'SYSTEM'),
          eq(schema.roleTemplates.mappedRole, role as never),
          isNull(schema.roleTemplates.validTo),
        ),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /**
   * Stamp merged template ∪ overrides onto `user_permissions` (snapshot model).
   * Replaces all current rows for the user; runtime gates read only these rows (+ SuperAdmin catalog).
   */
  private async replaceUserPermissionSnapshot(
    tx: DbTx,
    params: {
      userId: string;
      roleTemplateId: string;
      role: string;
      overrides: Record<string, boolean>;
      actorId: string;
    },
  ): Promise<void> {
    const templateCodes = await resolveRoleTemplateBaselineCodes(tx, params.roleTemplateId, params.role);
    if (templateCodes.length === 0 && params.role !== 'SUPER_ADMIN') {
      this.logger.warn(
        `replaceUserPermissionSnapshot: empty baseline for user ${params.userId} (role=${params.role}, template=${params.roleTemplateId}). ` +
          'Check permission seed / role_template_permissions / role_permissions.',
      );
    }
    const { granted, revoked } = mergePermissionSnapshot(templateCodes, params.overrides);

    await tx
      .delete(schema.userPermissions)
      .where(and(eq(schema.userPermissions.userId, params.userId), isNull(schema.userPermissions.validTo)));

    const allCodes = [...new Set([...granted, ...revoked])];
    if (allCodes.length === 0) return;

    // Single-round-trip stamp. Replaces the prior 2-step "SELECT permissions WHERE
    // code IN (...)" + "INSERT VALUES" pattern, which spent an extra RTT just to
    // resolve permission_id. On Aiven (high latency to the DB region) this shaves
    // ~150-500ms off the create path. UUIDs are generated client-side to match
    // the `uuidv7Pk` schema default — `user_permissions.id` has no DB-level
    // `DEFAULT gen_random_uuid()`.
    const grantedSet = new Set(granted);
    const codeFlagPairs = allCodes.map((code) => ({
      // crypto.randomUUID() (v4) is fine here — the v7-ness in `uuidv7Pk` is for
      // insert locality, but stamps go in one batch so locality is irrelevant.
      // Avoids pulling the `uuidv7` package into apps/api.
      id: randomUUID(),
      code,
      granted: grantedSet.has(code),
    }));
    const valuesSql = sql.join(
      codeFlagPairs.map(
        (pair) => sql`(${pair.id}::uuid, ${pair.code}::text, ${pair.granted}::boolean)`,
      ),
      sql`, `,
    );
    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO user_permissions (id, user_id, permission_id, granted, granted_by)
      SELECT
        v.id,
        ${params.userId}::uuid,
        p.id,
        v.granted,
        ${params.actorId}::uuid
      FROM (VALUES ${valuesSql}) AS v(id, code, granted)
      INNER JOIN permissions p
        ON p.code = v.code
        AND p.valid_to IS NULL
      RETURNING id
    `);

    if (inserted.length !== codeFlagPairs.length) {
      // Some codes didn't resolve to a permission row — typically a stale catalog.
      // Identify the gap so the error names the bad codes (matches prior behaviour).
      const knownCodes = await tx
        .select({ code: schema.permissions.code })
        .from(schema.permissions)
        .where(inArray(schema.permissions.code, allCodes));
      const known = new Set(knownCodes.map((r) => canonicalPermissionCode(r.code)));
      const missing = allCodes.filter((c) => !known.has(c));
      if (missing.length > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Unknown permission code(s): ${missing.join(', ')}`,
        });
      }
    }
  }

  /**
   * Generate a secure random password.
   */
  private generatePassword(length = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    const bytes = randomBytes(length);
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  }

  /**
   * Mask a phone number for API responses.
   *
   * The Lead Fortress pillar (CLAUDE.md) protects **customer** phone numbers absolutely —
   * those never leave the server unmasked except via the VOIP bridge. This helper is for
   * **staff** phone numbers, where the policy is different: staff need to call/text each
   * other, so HR-class viewers, admins, and heads (viewing their direct reports) see the
   * raw value, while peers fall back to a masked display.
   *
   * 08031234567 → 0803****4567
   */
  private maskPhone(phone: string | null | undefined): string | null {
    if (!phone) return null;
    if (phone.length < 8) return '****';
    return phone.substring(0, 4) + '****' + phone.substring(phone.length - 4);
  }

  /**
   * Decide whether the actor should see the unmasked staff phone for `target`.
   *
   * Visible to: the user themselves, admin-class roles, HR managers, anyone with
   * `users.read` / `hr.read` permission, and heads viewing their direct-report role
   * scope. Other authenticated users see the masked form.
   *
   * Note: this gates the *staff* phone field on `users.phone`. Customer phone numbers
   * (on `orders`, `cart_submissions`, etc.) are governed by the column-level masking
   * + VOIP bridge rules and never reach this helper.
   */
  private canSeeStaffPhone(
    actor: { id: string; role: string; permissions?: string[] } | null | undefined,
    target: { id: string; role: string },
  ): boolean {
    if (!actor) return false;
    if (actor.id === target.id) return true;
    if (actor.role === 'SUPER_ADMIN') return true;

    const perms = actor.permissions ?? [];
    if (perms.includes('users.read') || perms.includes('hr.read') || perms.includes('hr.write'))
      return true;

    if ((perms.includes('cs.teamOverview') || perms.includes('team.supervise_cs')) && target.role === 'CS_AGENT')
      return true;
    if (
      (perms.includes('marketing.teamOverview') || perms.includes('team.supervise_marketing')) &&
      target.role === 'MEDIA_BUYER'
    )
      return true;
    if (
      perms.includes('team.supervise_logistics') &&
      ['LOGISTICS_MANAGER', 'TPL_MANAGER', 'TPL_RIDER', 'STOCK_MANAGER'].includes(target.role)
    ) {
      return true;
    }
    return false;
  }

  /** Returns the raw phone when the actor is authorized; otherwise the masked form. */
  private resolveStaffPhone(
    actor: { id: string; role: string; permissions?: string[] } | null | undefined,
    target: { id: string; role: string; phone: string | null },
  ): string | null {
    return this.canSeeStaffPhone(actor, target) ? target.phone : this.maskPhone(target.phone);
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
      const [req] = await withActor(this.db, actor, async (tx) =>
        tx
          .insert(schema.permissionRequests)
          .values({
            type: 'USER_CREATION',
            status: 'PENDING',
            requesterId: actor.id,
            requestedRole: input.role,
            reason: `HR requested creation of user with role ${input.role}`,
            payload: input as unknown as Record<string, unknown>,
          })
          .returning({ id: schema.permissionRequests.id }),
      );

      if (req?.id) {
        this.notificationsService.enqueueCreateForRole('SUPER_ADMIN', {
          type: 'approval:permission_request',
          title: 'Permission request pending',
          body: `HR requested to create user "${input.name}" (${input.email}) with role ${input.role}.`,
          data: { requestId: req.id, type: 'USER_CREATION' },
        });

        return {
          requiresApproval: true,
          requestId: req.id,
          message: 'User creation request submitted. SuperAdmin will review.',
        };
      }
    }

    // Phone + branch payload are validated synchronously (no DB) so we can short-circuit
    // before the round-trip pre-flight queries below. This trims ~1 RTT off the timeout
    // budget when the user submits an obviously-invalid form.
    if (!input.phone) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Phone number is required.',
      });
    }
    const requestedBranchIds = [...new Set(input.branchIds ?? [])];
    if (input.primaryBranchId && !requestedBranchIds.includes(input.primaryBranchId)) {
      requestedBranchIds.push(input.primaryBranchId);
    }
    if (requestedBranchIds.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'At least one branch is required',
      });
    }
    if (!input.primaryBranchId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Primary branch is required',
      });
    }

    // Run the pre-flight DB checks in parallel — they're independent, and on
    // a high-latency Aiven link the sequential version cost extra RTTs
    // before the transaction even opened. Promise.all collapses to ~1 RTT total.
    //
    // CEO directive 2026-05-03: org-wide head roles (HEAD_OF_CS / HEAD_OF_MARKETING
    // / HEAD_OF_LOGISTICS) and per-branch HR_MANAGER are NO LONGER singletons.
    // Permissions gate capability; multiple holders are allowed (e.g. handover
    // periods, co-heads, regional heads). The DB unique indexes were dropped in
    // migration 0108. The frontend still surfaces a soft warning so admins can
    // see existing holders and confirm intent — see UserCreatePage / users.router.
    const [existingRows, phoneRows, activeBranchRows] = await Promise.all([
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, input.email.toLowerCase()))
        .limit(1),
      this.db
        .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.phone, input.phone))
        .limit(1),
      this.db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(
          and(
            inArray(schema.branches.id, requestedBranchIds),
            eq(schema.branches.status, 'ACTIVE'),
          ),
        ),
    ]);

    if (existingRows[0]) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A user with this email already exists',
      });
    }

    if (phoneRows[0]) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: `Phone number already in use by ${phoneRows[0].name} (${phoneRows[0].email}). Each user must have a unique number.`,
      });
    }

    if (activeBranchRows.length !== requestedBranchIds.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'One or more selected branches are missing or inactive',
      });
    }

    // Auto-generate a secure password for the new user
    const plainPassword = this.generatePassword();
    const passwordHash = await this.authService.hashPassword(plainPassword);

    const defaults = this.defaultScopeForRole(input.role);
    const roleTemplateId =
      input.roleTemplateId ?? (await this.resolveRoleTemplateIdForEnumRole(input.role));
    if (!roleTemplateId) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          'Role templates are not initialized for this environment. Run migrations + `pnpm db:seed-permissions`.',
      });
    }

    const scopeGlobal = input.scopeGlobal ?? defaults.scopeGlobal;
    const scopeOrgWideHead = input.scopeOrgWideHead ?? defaults.scopeOrgWideHead;
    const scopeTeamSupervisor = input.scopeTeamSupervisor ?? false;

    const user = await this.db.transaction(async (tx) => {
      // Audit actor for this transaction — must be INSIDE the transaction because
      // `SET LOCAL` is scoped to the current transaction's connection (see with-actor.ts).
      await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);

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

      // Probation flag — only honoured when the role is eligible. Admin-tier users
      // can never be on probation (CEO directive 2026-05-08).
      const wantsProbation = input.isProbation === true;
      if (wantsProbation && !isRoleProbationEligible(input.role)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Role ${input.role} is not eligible for probation.`,
        });
      }
      const probationUntil = wantsProbation
        ? input.probationUntil ?? defaultProbationUntilFromNow()
        : null;

      // Insert user with all fields
      const rows = await tx
        .insert(schema.users)
        .values({
          name: input.name,
          email: input.email.toLowerCase(),
          passwordHash,
          role: input.role,
          roleTemplateId,
          scopeGlobal,
          scopeOrgWideHead,
          scopeTeamSupervisor,
          status: 'PENDING', // New users stay PENDING until first login (then auth sets ACTIVE)
          capacity: input.capacity ?? 10,
          logisticsLocationId: input.logisticsLocationId ?? null,
          primaryBranchId: input.primaryBranchId ?? null,
          phone: input.phone ?? null,
          visibleOrderStatuses: input.visibleOrderStatuses ?? null,
          restrictProductAccess: input.restrictProductAccess ?? false,
          commissionPlanId,
          isProbation: wantsProbation,
          probationStartedAt: wantsProbation ? new Date() : null,
          probationStartedBy: wantsProbation ? actor.id : null,
          probationUntil,
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

      await tx.insert(schema.userBranches).values(
        requestedBranchIds.map((branchId) => ({
          userId: createdUser.id,
          branchId,
          isPrimary: branchId === input.primaryBranchId,
          roleInBranch: null,
        })),
      );

      if (input.productIds && input.productIds.length > 0) {
        await tx.insert(schema.userProductAssignments).values(
          input.productIds.map((productId) => ({
            userId: createdUser.id,
            productId,
          })),
        );
      }

      if (input.role !== 'SUPER_ADMIN') {
        await this.replaceUserPermissionSnapshot(tx, {
          userId: createdUser.id,
          roleTemplateId,
          role: input.role,
          overrides: input.permissionOverrides ?? {},
          actorId: actor.id,
        });
      }

      return createdUser;
    });

    // Drop the cached user bundle (perms + role/scope/template) so the next
    // tRPC call by this user picks up the freshly stamped permissions
    // immediately instead of waiting up to the 60s TTL.
    void this.userBundleCache.invalidate(user.id);

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
      this.notificationsService.enqueueCreate({
        userId: user.id,
        type: 'account:updated',
        title: 'Your account was updated',
        body: `Product access: ${input.productIds.length} product(s) assigned to your account. Sign in to use the catalog.`,
        data: {
          userId: user.id,
          changedKeys: ['productIds'],
          productCount: input.productIds.length,
        },
      });
    }

    return {
      ...user,
      // Caller is the creator (passed `users.create` gate) — they always see the raw phone
      // for the staff record they just created. Customer phones never flow through this path.
      phone: user.phone,
    };
  }

  /**
   * Get a single user by ID.
   * Never returns passwordHash. Staff phone is unmasked for authorized viewers
   * (self, admins, HR, heads viewing direct reports); masked for everyone else.
   */
  async getById(
    userId: string,
    actor: { id: string; role: string; permissions?: string[] } | null = null,
  ) {
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
        roleTemplateId: schema.users.roleTemplateId,
        scopeGlobal: schema.users.scopeGlobal,
        scopeOrgWideHead: schema.users.scopeOrgWideHead,
        scopeTeamSupervisor: schema.users.scopeTeamSupervisor,
        loginCount: schema.users.loginCount,
        lastLoginAt: schema.users.lastLoginAt,
        isProbation: schema.users.isProbation,
        probationStartedAt: schema.users.probationStartedAt,
        probationStartedBy: schema.users.probationStartedBy,
        probationUntil: schema.users.probationUntil,
        terminatedAt: schema.users.terminatedAt,
        terminatedBy: schema.users.terminatedBy,
        originalRole: schema.users.originalRole,
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
      phone: this.resolveStaffPhone(actor, { id: user.id, role: user.role, phone: user.phone }),
      branchMemberships,
      assignedProductIds,
    };
  }

  /**
   * List users with filtering, search, and pagination.
   *
   * Staff phone is unmasked for callers who pass `canSeeStaffPhone`. The router gates the
   * procedure on `users.read` so any direct caller already qualifies, but the per-row check
   * still runs so a future caller without that permission falls back to the masked form.
   */
  async list(
    input: ListUsersInput,
    actor: { id: string; role: string; permissions?: string[] } | null = null,
    currentBranchId: string | null = null,
  ) {
    const conditions = [];

    // When the caller asks for a specific set of IDs (e.g. resolving buyer names behind ad-spend
    // rows), match exactly those — and bypass the default "hide DEACTIVATED" filter so names
    // still render for historical records owned by since-removed users.
    if (input.userIds && input.userIds.length > 0) {
      conditions.push(inArray(schema.users.id, input.userIds));
    } else if (!input.status) {
      // Default: exclude DEACTIVATED (record stays in DB; only visible when filter status=DEACTIVATED)
      conditions.push(ne(schema.users.status, 'DEACTIVATED'));
    }

    if (input.role) {
      conditions.push(eq(schema.users.role, input.role));
    }
    if (input.status) {
      conditions.push(eq(schema.users.status, input.status));
    }
    // Branch scoping (CEO directive 2026-04-26: branch isolation):
    //  - userIds set        → skip branch filter (name-resolution path)
    //  - allBranches + admin → skip branch filter (admin opt-in for /admin/branches/:id picker)
    //  - input.branchId     → filter to that branch (legacy explicit override)
    //  - ctx.currentBranchId → auto-scope to caller's active branch
    //  - admin in global mode (currentBranchId = NULL) → unscoped
    // `allBranches` opt-in is reserved for callers who can already see all branches —
    // SuperAdmin (always) or anyone whose session resolved unscoped (e.g. admin holding
    // every permission, or an org-wide head with `currentBranchId === null`).
    const actorPerms = (actor?.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const canViewAllBranches =
      !!actor && (
        actor.role === 'SUPER_ADMIN' ||
        actorPerms.includes(canonicalPermissionCode('branches.manage')) ||
        actorPerms.includes(canonicalPermissionCode('cs.scope.global')) ||
        actorPerms.includes(canonicalPermissionCode('marketing.scope.global')) ||
        actorPerms.includes(canonicalPermissionCode('logistics.scope.global'))
      );
    const skipBranchScope =
      (input.userIds && input.userIds.length > 0) ||
      (input.allBranches === true && canViewAllBranches);
    const branchFilter = skipBranchScope
      ? input.branchId
      : (input.branchId ?? currentBranchId ?? undefined);

    if (branchFilter) {
      conditions.push(
        sql<boolean>`EXISTS (
          SELECT 1
          FROM user_branches ub
          WHERE ub.user_id = ${schema.users.id}
            AND ub.branch_id = ${branchFilter}
        )`,
      );
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
    const perms = (actor?.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const includePayoutFields =
      !!actor &&
      (hasFinanceAccess(actor) || perms.includes(canonicalPermissionCode('finance.read')));

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
          payoutBankName: schema.users.payoutBankName,
          payoutAccountName: schema.users.payoutAccountName,
          payoutAccountNumber: schema.users.payoutAccountNumber,
          payoutBankCode: schema.users.payoutBankCode,
          isProbation: schema.users.isProbation,
          probationUntil: schema.users.probationUntil,
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
      users: users.map((u) => {
        const { payoutBankName, payoutAccountName, payoutAccountNumber, payoutBankCode, ...rest } = u;
        return {
          ...rest,
          phone: this.resolveStaffPhone(actor, { id: u.id, role: u.role, phone: u.phone }),
          branchMemberships: membershipsByUser.get(u.id) ?? [],
          ...(includePayoutFields
            ? {
                payoutBankName: payoutBankName ?? null,
                payoutAccountName: payoutAccountName ?? null,
                payoutAccountNumber: payoutAccountNumber ?? null,
                payoutBankCode: payoutBankCode ?? null,
              }
            : {}),
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
          eq(schema.users.status, 'ACTIVE'),
          or(
            eq(schema.users.role, 'CS_AGENT'),
            eq(schema.users.role, 'HEAD_OF_CS'),
            sql<boolean>`EXISTS (
              SELECT 1
              FROM branch_team_members btm
              INNER JOIN branch_teams bt ON bt.id = btm.team_id
              WHERE btm.user_id = ${schema.users.id}
                AND bt.department = 'CS'
            )`,
          ),
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
   * List active users holding a HEAD_OF_* role or HR_MANAGER.
   *
   * CEO directive 2026-05-03: these roles are NO LONGER singletons. Permissions
   * gate capability and multiple holders are allowed (handovers, co-heads,
   * regional splits). This endpoint now powers the soft warning + confirm-to-
   * proceed flow on the user create/edit forms — admins still see existing
   * holders so the choice to add another is intentional, not accidental.
   */
  async listActiveHeads(): Promise<Array<{
    id: string;
    name: string;
    role: string;
    primaryBranchId: string | null;
    status: string;
  }>> {
    // Returns BOTH active and pending holders so admins can see invited-but-
    // not-yet-logged-in heads in the conflict warning too.
    return this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
        primaryBranchId: schema.users.primaryBranchId,
        status: schema.users.status,
      })
      .from(schema.users)
      .where(
        and(
          inArray(schema.users.status, ['ACTIVE', 'PENDING']),
          or(
            inArray(schema.users.role, ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS', 'HR_MANAGER']),
            eq(schema.users.scopeOrgWideHead, true),
          ),
        ),
      )
      .orderBy(asc(schema.users.name));
  }

  /**
   * Update a staff member's details.
   * If actor is HR and requested role is sensitive, creates permission_request instead.
   */
  async update(input: UpdateStaffInput, actor: SessionUser) {
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
        roleTemplateId: schema.users.roleTemplateId,
        scopeGlobal: schema.users.scopeGlobal,
        scopeOrgWideHead: schema.users.scopeOrgWideHead,
        scopeTeamSupervisor: schema.users.scopeTeamSupervisor,
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
    const existingMembershipRows = await this.db
      .select({ branchId: schema.userBranches.branchId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, input.userId));
    const existingBranchIds = [...new Set(existingMembershipRows.map((r) => r.branchId))];
    const nextBranchIds =
      input.branchIds !== undefined ? [...new Set(input.branchIds)] : [...existingBranchIds];
    if (input.primaryBranchId && !nextBranchIds.includes(input.primaryBranchId)) {
      nextBranchIds.push(input.primaryBranchId);
    }
    const nextPrimaryBranchId = input.primaryBranchId ?? beforeRow.primaryBranchId ?? null;
    if (nextBranchIds.length > 0 && nextPrimaryBranchId && !nextBranchIds.includes(nextPrimaryBranchId)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Primary branch must be one of the selected branches.',
      });
    }

    const effectiveRole = input.role ?? beforeRow.role;
    if (effectiveRole !== 'SUPER_ADMIN' && nextBranchIds.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'At least one branch is required.',
      });
    }
    if (
      effectiveRole !== 'SUPER_ADMIN' &&
      (input.branchIds !== undefined || input.primaryBranchId !== undefined) &&
      !nextPrimaryBranchId
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Primary branch is required.',
      });
    }
    if (nextBranchIds.length > 0) {
      const activeBranchRows = await this.db
        .select({ id: schema.branches.id })
        .from(schema.branches)
        .where(
          and(
            inArray(schema.branches.id, nextBranchIds),
            eq(schema.branches.status, 'ACTIVE'),
          ),
        );
      if (activeBranchRows.length !== nextBranchIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'One or more selected branches are missing or inactive.',
        });
      }
    }

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

    // Scoped team-lead edits: anyone holding `users.staff.update_supervised` can narrow-edit
    // their direct reports (capacity, productIds, visibleOrderStatuses). The supervised role
    // resolution still uses the team-supervision codes (cs.teamOverview, team.supervise_cs, etc.)
    // so a CS-domain supervisor edits CS Agents and a marketing-domain supervisor edits MBs.
    // Cannot change role, status, email, phone, name, logistics location, commission plan, etc.
    // Team-leads cannot edit each other or themselves — that stays admin territory.
    const p = (actor.permissions ?? []).map((c) => canonicalPermissionCode(c));
    const has = (code: string) => p.includes(canonicalPermissionCode(code));
    const supervisedScope = has('users.staff.update_supervised');
    const actorIsCsLead =
      supervisedScope &&
      (has('cs.teamOverview') || has('team.supervise_cs') || actor.scopeTeamSupervisor === true);
    const actorIsMarketingLead =
      supervisedScope &&
      (has('marketing.teamOverview') ||
        has('team.supervise_marketing') ||
        actor.scopeTeamSupervisor === true);

    const actorIsTeamLead = actorIsCsLead || actorIsMarketingLead;
    const targetFitsTeamLeadScope =
      (actorIsCsLead && beforeRow.role === 'CS_AGENT') ||
      (actorIsMarketingLead && beforeRow.role === 'MEDIA_BUYER');
    const sameBranch =
      !!actor.currentBranchId &&
      beforeRow.primaryBranchId === actor.currentBranchId;

    // Admin-class viewers already get full edit via `canEditUser`; their permission snapshots
    // may still include supervise/update_supervised codes — do not treat them as branch team leads.
    if (actorIsTeamLead && !isAdminLevelRole(actor.role)) {
      if (!targetFitsTeamLeadScope) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: actorIsCsLead
            ? 'You can only edit CS Agents on your team. Contact an administrator for anything else.'
            : 'You can only edit Media Buyers on your team. Contact an administrator for anything else.',
        });
      }
      if (!sameBranch) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only edit team members in your own branch.',
        });
      }
      if (input.userId === actor.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot edit your own account here.' });
      }

      // Whitelist of fields a team-lead may change. Everything else must be undefined.
      const allowedByTeamLead = new Set<keyof UpdateStaffInput>([
        'userId', 'capacity', 'productIds', 'visibleOrderStatuses', 'restrictProductAccess',
      ]);
      for (const key of Object.keys(input) as Array<keyof UpdateStaffInput>) {
        if (!allowedByTeamLead.has(key) && input[key] !== undefined) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Team leads cannot change "${String(key)}" — contact an administrator.`,
          });
        }
      }
      // Fall through to the main update logic below; the field-level whitelist above means
      // downstream admin-only paths (role change, deactivation, email change, etc.) won't
      // trigger because their triggering fields are all undefined for team-lead callers.
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

      const [req] = await withActor(this.db, actor, async (tx) =>
        tx
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
          .returning({ id: schema.permissionRequests.id }),
      );

      if (req?.id) {
        this.notificationsService.enqueueCreateForRole('SUPER_ADMIN', {
          type: 'approval:permission_request',
          title: 'Permission request pending',
          body: `HR requested to change user role to ${input.role}.`,
          data: { requestId: req.id, type: 'ROLE_CHANGE', targetUserId: input.userId },
        });

        return {
          requiresApproval: true,
          requestId: req.id,
          message: 'Role change request submitted. SuperAdmin will review.',
        };
      }
    }

    // CEO directive 2026-05-03: org-wide head roles and per-branch HR_MANAGER
    // are no longer singletons — multiple holders are allowed. The previous
    // CONFLICT throws on this update path are removed alongside the matching
    // create-path check + the DB indexes (migration 0108). The frontend
    // surfaces a soft warning (existing holders shown to the admin) so role
    // collisions stay visible without blocking the save.

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

      const requestId = await withActor(this.db, actor, async (tx) => {
        await tx
          .update(schema.emailChangeRequests)
          .set({ status: 'REJECTED', updatedAt: new Date(), approvalReason: 'Superseded by new request' })
          .where(
            and(
              eq(schema.emailChangeRequests.userId, input.userId),
              eq(schema.emailChangeRequests.status, 'PENDING'),
            ),
          );

        const requestRows = await tx
          .insert(schema.emailChangeRequests)
          .values({
            userId: input.userId,
            requestedNewEmail: newEmail,
            requesterId: actor.id,
            status: 'PENDING',
          })
          .returning({ id: schema.emailChangeRequests.id });

        return requestRows[0]?.id;
      });
      if (requestId) {
        this.notificationsService.enqueueCreateForRole('SUPER_ADMIN', {
          type: 'approval:email_change',
          title: 'Email change approval required',
          body: `A user has requested an email change. Approval needed.`,
          data: { requestId, userId: input.userId, requestedNewEmail: newEmail },
        });
      }

      emailChangePending = true;
      // Do NOT apply email in this update — it will be applied when SuperAdmin approves
      delete (input as { email?: string }).email;
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updateFields['name'] = input.name;
    if (input.email !== undefined) updateFields['email'] = input.email.toLowerCase();
    if (input.role !== undefined) updateFields['role'] = input.role;

    // Permission templates + explicit scope flags
    if (input.roleTemplateId !== undefined) {
      updateFields['roleTemplateId'] = input.roleTemplateId;
    } else if (input.role !== undefined) {
      const tplId = await this.resolveRoleTemplateIdForEnumRole(input.role);
      if (tplId) updateFields['roleTemplateId'] = tplId;
    }

    if (input.scopeGlobal !== undefined) updateFields['scopeGlobal'] = input.scopeGlobal;
    if (input.scopeOrgWideHead !== undefined) updateFields['scopeOrgWideHead'] = input.scopeOrgWideHead;
    if (input.scopeTeamSupervisor !== undefined) updateFields['scopeTeamSupervisor'] = input.scopeTeamSupervisor;

    if (input.role !== undefined) {
      const d = this.defaultScopeForRole(input.role);
      if (input.scopeGlobal === undefined) updateFields['scopeGlobal'] = d.scopeGlobal;
      if (input.scopeOrgWideHead === undefined) updateFields['scopeOrgWideHead'] = d.scopeOrgWideHead;
    }

    if (input.capacity !== undefined) updateFields['capacity'] = input.capacity;
    if (input.logisticsLocationId !== undefined) updateFields['logisticsLocationId'] = input.logisticsLocationId;
    if (input.status !== undefined) updateFields['status'] = input.status;
    if (input.phone !== undefined) {
      if (input.phone) {
        const phoneRows = await this.db
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(and(eq(schema.users.phone, input.phone), ne(schema.users.id, input.userId)))
          .limit(1);

        if (phoneRows[0]) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Phone number already in use by ${phoneRows[0].name} (${phoneRows[0].email}). Each user must have a unique number.`,
          });
        }
      }
      updateFields['phone'] = input.phone;
    }
    if (input.visibleOrderStatuses !== undefined) updateFields['visibleOrderStatuses'] = input.visibleOrderStatuses;
    if (input.restrictProductAccess !== undefined) updateFields['restrictProductAccess'] = input.restrictProductAccess;
    if (input.primaryBranchId !== undefined) updateFields['primaryBranchId'] = input.primaryBranchId;

    let nextRoleTemplateIdForSnapshot: string | null = beforeRow.roleTemplateId ?? null;
    if (input.roleTemplateId !== undefined) {
      nextRoleTemplateIdForSnapshot = input.roleTemplateId;
    } else if (input.role !== undefined) {
      const resolvedTpl = await this.resolveRoleTemplateIdForEnumRole(input.role);
      if (resolvedTpl) nextRoleTemplateIdForSnapshot = resolvedTpl;
    }

    const overridesPayloadPresent = input.permissionOverrides !== undefined;
    const roleChanged = input.role !== undefined && input.role !== beforeRow.role;
    const templateDirectChanged =
      input.roleTemplateId !== undefined &&
      input.roleTemplateId !== (beforeRow.roleTemplateId ?? null);
    const shouldRematerializePermissions =
      beforeRow.role !== 'SUPER_ADMIN' &&
      (overridesPayloadPresent || roleChanged || templateDirectChanged);
    const overridesForSnapshot = overridesPayloadPresent ? (input.permissionOverrides ?? {}) : {};

    let permissionOverridesChanged = false;
    if (overridesPayloadPresent && beforeRow.role !== 'SUPER_ADMIN') {
      const priorSparse = await this.getSparsePermissionOverridesForUser(input.userId);
      permissionOverridesChanged =
        this.stableOverrideRecordJson(priorSparse) !==
        this.stableOverrideRecordJson(
          (input.permissionOverrides ?? {}) as Record<string, boolean>,
        );
    }

    const beforeMembershipBranchIds = [...existingBranchIds].sort((a, b) => a.localeCompare(b));
    const branchesOrPrimaryPayloadTouched =
      input.branchIds !== undefined || input.primaryBranchId !== undefined;
    const afterMembershipBranchIds = branchesOrPrimaryPayloadTouched
      ? [...new Set(nextBranchIds)].sort((a, b) => a.localeCompare(b))
      : beforeMembershipBranchIds;

    const updatedRows = await this.db.transaction(async (tx) => {
      // Audit actor for this transaction (see with-actor.ts for why SET LOCAL must be inside).
      await tx.execute(sql`SELECT set_config('yannis.current_user_id', ${actor.id}, true)`);
      const updatedRowsTx = await tx
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
          primaryBranchId: schema.users.primaryBranchId,
          roleTemplateId: schema.users.roleTemplateId,
          updatedAt: schema.users.updatedAt,
        });
      if (input.branchIds !== undefined || input.primaryBranchId !== undefined) {
        await tx
          .delete(schema.userBranches)
          .where(eq(schema.userBranches.userId, input.userId));
        await tx.insert(schema.userBranches).values(
          nextBranchIds.map((branchId) => ({
            userId: input.userId,
            branchId,
            isPrimary: branchId === nextPrimaryBranchId,
            roleInBranch: null,
          })),
        );
      }
      if (shouldRematerializePermissions && nextRoleTemplateIdForSnapshot) {
        const snapshotRole = input.role !== undefined ? input.role : beforeRow.role;
        await this.replaceUserPermissionSnapshot(tx, {
          userId: input.userId,
          roleTemplateId: nextRoleTemplateIdForSnapshot,
          role: snapshotRole,
          overrides: overridesForSnapshot,
          actorId: actor.id,
        });
      }
      return updatedRowsTx;
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
      await withActor(this.db, actor, async (tx) => {
        // Delete existing assignments
        await tx
          .delete(schema.userProductAssignments)
          .where(eq(schema.userProductAssignments.userId, input.userId));

        // Insert new ones
        if (input.productIds && input.productIds.length > 0) {
          await tx.insert(schema.userProductAssignments).values(
            input.productIds.map((productId) => ({
              userId: input.userId,
              productId,
            })),
          );
        }
      });
    }

    if (input.status === 'INACTIVE' || input.status === 'ARCHIVED' || input.status === 'DEACTIVATED') {
      await this.authService.killUserSessions(input.userId);
    }

    // Role / template / scope / permission overrides may have changed — drop
    // the cached user bundle so the next tRPC call sees the latest snapshot.
    void this.userBundleCache.invalidate(input.userId);

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
        primaryBranchId: beforeRow.primaryBranchId ?? null,
        roleTemplateId: beforeRow.roleTemplateId ?? null,
      },
      beforeProductIds,
      beforeBranchIds: beforeMembershipBranchIds,
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
        primaryBranchId: updated.primaryBranchId ?? null,
        roleTemplateId: updated.roleTemplateId ?? null,
      },
      afterProductIds,
      afterBranchIds: afterMembershipBranchIds,
      permissionOverridesChanged,
    });

    return {
      ...updated,
      // Caller passed the `users.update | cs.teamOverview | marketing.teamOverview` gate to
      // edit this staff record — they always see the raw phone for the user they just saved.
      phone: updated.phone,
      emailChangePending: emailChangePending || undefined,
    };
  }

  /**
   * Re-stamp `user_permissions` from the current template baseline plus any
   * existing per-user overrides. Idempotent — safe to call repeatedly.
   *
   * Use case: a user was created during a window when `role_template_permissions`
   * was empty (or before the snapshot model was active), so they have zero
   * `user_permissions` rows and every permission check fails. The stale-user
   * fix.
   *
   * Reads the user's CURRENT `role_template_id` and CURRENT sparse overrides
   * from `user_permissions`, then re-runs `replaceUserPermissionSnapshot` with
   * the same merge logic that `createStaff` and `update` use — so the
   * resulting set is consistent with the rest of the codebase.
   *
   * Returns counts of granted / revoked rows written so the caller can
   * surface a meaningful confirmation toast.
   */
  async restampPermissions(
    userId: string,
    actor: SessionUser,
  ): Promise<{ stampedGranted: number; stampedRevoked: number; templateBaselineCount: number }> {
    const result = await withActor(this.db, actor, async (tx) => {
      const [target] = await tx
        .select({
          id: schema.users.id,
          role: schema.users.role,
          roleTemplateId: schema.users.roleTemplateId,
        })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      if ((target.role as string) === 'SUPER_ADMIN') {
        // SuperAdmin gets the full catalog at runtime via short-circuit; stamping
        // is meaningless and would be deleted on next call anyway.
        return { stampedGranted: 0, stampedRevoked: 0, templateBaselineCount: 0 };
      }

      // Resolve the template (fall back to the SYSTEM template for the role
      // when `role_template_id` is null — same logic createStaff uses).
      const roleTemplateId =
        target.roleTemplateId ?? (await this.resolveRoleTemplateIdForEnumRole(target.role as string));
      if (!roleTemplateId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'No role template found for this user. Run `pnpm db:seed-permissions` (or restart the API) and try again.',
        });
      }

      // Read existing sparse overrides from `user_permissions` so we preserve
      // any explicit per-user grants/revokes the admin set on this user before
      // re-stamping. This makes the re-stamp idempotent: if a user is already
      // properly stamped, the writes will be a no-op delta.
      const existingRows = await tx
        .select({
          code: schema.permissions.code,
          granted: schema.userPermissions.granted,
        })
        .from(schema.userPermissions)
        .innerJoin(schema.permissions, eq(schema.userPermissions.permissionId, schema.permissions.id))
        .where(
          and(eq(schema.userPermissions.userId, userId), isNull(schema.userPermissions.validTo)),
        );

      const templateCodes = await resolveRoleTemplateBaselineCodes(
        tx,
        roleTemplateId,
        target.role as string,
      );
      const templateSet = new Set(templateCodes.map((c) => canonicalPermissionCode(c)));

      const overrides: Record<string, boolean> = {};
      for (const row of existingRows) {
        const code = canonicalPermissionCode(row.code);
        const inTpl = templateSet.has(code);
        if (row.granted) {
          // explicit grant only when the code is NOT in the template (otherwise it's just inherited)
          if (!inTpl) overrides[code] = true;
        } else if (inTpl) {
          // explicit revoke of a template default
          overrides[code] = false;
        }
      }

      await this.replaceUserPermissionSnapshot(tx, {
        userId,
        roleTemplateId,
        role: target.role as string,
        overrides,
        actorId: actor.id,
      });

      // Re-read to count what landed (granted=true and granted=false rows).
      const stampedRows = await tx
        .select({ granted: schema.userPermissions.granted })
        .from(schema.userPermissions)
        .where(
          and(eq(schema.userPermissions.userId, userId), isNull(schema.userPermissions.validTo)),
        );
      let stampedGranted = 0;
      let stampedRevoked = 0;
      for (const row of stampedRows) {
        if (row.granted) stampedGranted++;
        else stampedRevoked++;
      }

      this.logger.log(
        `restampPermissions(${userId}) by ${actor.id}: template=${roleTemplateId} baseline=${templateCodes.length} → ${stampedGranted} granted, ${stampedRevoked} revoked`,
      );

      return {
        stampedGranted,
        stampedRevoked,
        templateBaselineCount: templateCodes.length,
      };
    });

    // Permissions snapshot was rewritten — drop the cached user bundle so the
    // next tRPC call sees the new snapshot.
    void this.userBundleCache.invalidate(userId);

    return result;
  }

  /**
   * Deactivate a staff member. Permanent (no reactivation).
   * - SuperAdmin may deactivate anyone (except themselves).
   * - Admin may deactivate non-admin-level users only.
   * - Others: forbidden.
   */
  async deactivate(userId: string, actor: SessionUser) {
    const can =
      actor.role === 'SUPER_ADMIN' || (actor.permissions ?? []).includes('users.deactivate');
    if (!can) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Missing users.deactivate permission.',
      });
    }
    if (userId === actor.id) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot deactivate your own account',
      });
    }
    const [targetRoleRow] = await this.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (actor.role !== 'SUPER_ADMIN' && targetRoleRow && isAdminLevelRole(targetRoleRow.role as string)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only SuperAdmin can deactivate admin-level accounts.',
      });
    }

    const updated = await withActor(this.db, actor, async (tx) => {
      const rows = await tx
        .update(schema.users)
        .set({ status: 'DEACTIVATED', updatedAt: new Date() })
        .where(eq(schema.users.id, userId))
        .returning({
          id: schema.users.id,
          name: schema.users.name,
          status: schema.users.status,
        });

      const result = rows[0];
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      return result;
    });

    await this.authService.killUserSessions(userId);

    // Drop the cached user bundle so any in-flight tRPC call from a still-mounted
    // browser tab can't slip through with cached permissions before the session
    // gets force-cleared by the socket event below.
    void this.userBundleCache.invalidate(userId);

    // Tell any open browser tabs the user has to log out immediately. The
    // session is already revoked server-side (above) — Remix loaders + tRPC
    // mutations on the next call would 401, but the user can still click
    // around within their already-rendered UI without triggering a server
    // call. The socket event forces the browser to clear local state and
    // redirect to /auth even when the tab is idle.
    //
    // We deliberately do NOT create an in-app notification — the user can't
    // act on it (they're being logged out), it just clutters the bell + push
    // logs for an account that's no longer using the system.
    this.eventsService.emitToUser(userId, 'auth:session_revoked', {
      reason: 'deactivated',
    });

    return updated;
  }

  /**
   * Reset a user's password (admin action).
   */
  async resetPassword(input: ResetPasswordInput, actor: SessionUser) {
    const passwordHash = await this.authService.hashPassword(input.newPassword);

    await withActor(this.db, actor, async (tx) => {
      const updatedRows = await tx
        .update(schema.users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(schema.users.id, input.userId))
        .returning({ id: schema.users.id });

      if (!updatedRows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
    });

    await this.authService.killUserSessions(input.userId);

    this.notificationsService.enqueueCreate({
      userId: input.userId,
      type: 'account:security',
      title: 'Your password was reset',
      body: 'An administrator reset your password. Use the new credentials you were given. Contact support if you did not expect this.',
      data: { userId: input.userId, event: 'password_reset' },
    });

    return { success: true };
  }

  /**
   * Resend invite email for a PENDING user — generates a fresh password,
   * updates the hash, and re-sends the invite email with new credentials.
   */
  async resendInvite(userId: string, actor: SessionUser) {
    // Fetch the user and verify they are still PENDING
    const existing = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const user = existing[0];
    if (!user) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }
    if (user.status !== 'PENDING') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Can only resend invite for users with PENDING status',
      });
    }

    // Generate a new password and update the hash
    const plainPassword = this.generatePassword();
    const passwordHash = await this.authService.hashPassword(plainPassword);

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(schema.users.id, userId));
    });

    // Send the invite email with the fresh credentials (non-blocking)
    const loginUrl = process.env['APP_URL'] ?? 'http://localhost:4001';
    this.notificationsService
      .sendInviteEmail({
        to: user.email,
        name: user.name,
        role: user.role,
        password: plainPassword,
        loginUrl: `${loginUrl}/auth`,
      })
      .then((sent) => {
        if (sent) {
          this.logger.log(`Invite email re-sent to ${user.email}`);
        } else {
          this.logger.warn(`Invite email not re-sent to ${user.email} (SendGrid may not be configured)`);
        }
      })
      .catch((err) => {
        this.logger.error(`Failed to re-send invite email to ${user.email}: ${err}`);
      });

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
    const req = await withActor(this.db, actor, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.emailChangeRequests)
        .where(eq(schema.emailChangeRequests.id, input.requestId))
        .limit(1);

      const found = rows[0];
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Email change request not found' });
      }
      if (found.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request already processed' });
      }

      if (input.action === 'APPROVED') {
        // Check new email is not taken
        const existing = await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, found.requestedNewEmail))
          .limit(1);

        if (existing[0] && existing[0].id !== found.userId) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A user with this email already exists',
          });
        }

        await tx
          .update(schema.users)
          .set({ email: found.requestedNewEmail, updatedAt: new Date() })
          .where(eq(schema.users.id, found.userId));
      }

      await tx
        .update(schema.emailChangeRequests)
        .set({
          status: input.action,
          approverId: actor.id,
          approvalReason: input.reason,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.emailChangeRequests.id, input.requestId));

      return found;
    });

    const body =
      input.action === 'APPROVED'
        ? `Your login email was updated to ${req.requestedNewEmail}. Use this address to sign in from now on.`
        : `Your email change request was not approved. Reason: ${input.reason}`;

    this.notificationsService.enqueueCreate({
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
    });

    return { success: true, action: input.action };
  }

  /** Canonical JSON for comparing permission-matrix payloads (sorted keys). */
  private stableOverrideRecordJson(record: Record<string, boolean>): string {
    const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
    const sorted: Record<string, boolean> = {};
    for (const key of keys) {
      sorted[key] = record[key]!;
    }
    return JSON.stringify(sorted);
  }

  /**
   * Sparse permission deltas vs template baseline — same shape as `permissions.getUserMatrix`
   * `userOverrides` (grants off-template + revokes on-template).
   */
  private async getSparsePermissionOverridesForUser(userId: string): Promise<Record<string, boolean>> {
    const [user] = await this.db
      .select({
        role: schema.users.role,
        roleTemplateId: schema.users.roleTemplateId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) return {};

    const overrideRows = await this.db
      .select({
        code: schema.permissions.code,
        granted: schema.userPermissions.granted,
      })
      .from(schema.userPermissions)
      .innerJoin(schema.permissions, eq(schema.userPermissions.permissionId, schema.permissions.id))
      .where(and(eq(schema.userPermissions.userId, userId), isNull(schema.userPermissions.validTo)));

    let templateId: string | null = user.roleTemplateId;
    if (!templateId && user.role) {
      const [fallback] = await this.db
        .select({ id: schema.roleTemplates.id })
        .from(schema.roleTemplates)
        .where(
          and(
            eq(schema.roleTemplates.mappedRole, user.role),
            eq(schema.roleTemplates.kind, 'SYSTEM'),
            isNull(schema.roleTemplates.validTo),
          ),
        )
        .limit(1);
      templateId = fallback?.id ?? null;
    }

    const templateCodesCanon = await resolveRoleTemplateBaselineCodes(
      this.db,
      templateId,
      user.role ?? '',
    );
    const templateSet = new Set(templateCodesCanon);

    const userOverrides: Record<string, boolean> = {};
    for (const row of overrideRows) {
      const code = canonicalPermissionCode(row.code);
      const inTpl = templateSet.has(code);
      if (row.granted) {
        if (!inTpl) userOverrides[code] = true;
      } else if (inTpl) {
        userOverrides[code] = false;
      }
    }

    return userOverrides;
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
      primaryBranchId: string | null;
      roleTemplateId: string | null;
    };
    beforeProductIds: string[];
    beforeBranchIds: string[];
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
      primaryBranchId: string | null;
      roleTemplateId: string | null;
    };
    afterProductIds: string[];
    afterBranchIds: string[];
    permissionOverridesChanged: boolean;
  }): void {
    const {
      targetUserId,
      before,
      after,
      beforeProductIds,
      afterProductIds,
      beforeBranchIds,
      afterBranchIds,
      permissionOverridesChanged,
    } = params;

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
    if (before.primaryBranchId !== after.primaryBranchId) {
      changedKeys.push('primaryBranchId');
    }
    if ((before.roleTemplateId ?? null) !== (after.roleTemplateId ?? null)) {
      changedKeys.push('roleTemplateId');
    }
    if (beforeBranchIds.join('\0') !== afterBranchIds.join('\0')) {
      changedKeys.push('branchIds');
    }
    if (permissionOverridesChanged) {
      changedKeys.push('permissionOverrides');
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
    if (changedKeys.includes('branchIds')) {
      lines.push('Your branch memberships were updated.');
    }
    if (changedKeys.includes('primaryBranchId')) {
      lines.push('Your default (primary) branch was updated.');
    }
    if (changedKeys.includes('roleTemplateId')) {
      lines.push('Your permission template assignment was updated.');
    }
    if (changedKeys.includes('permissionOverrides')) {
      lines.push('Your individual permission overrides were updated.');
    }

    const becameDeactivated = before.status !== 'DEACTIVATED' && after.status === 'DEACTIVATED';

    // Deactivation is a "session revoke + browser-side logout" event, not a
    // notification. The user can't act on a notification while being signed
    // out, and it just clutters the bell of an account that's no longer
    // using the system. Force-log out their open tabs via socket + return.
    if (becameDeactivated) {
      this.eventsService.emitToUser(targetUserId, 'auth:session_revoked', {
        reason: 'deactivated',
      });
      return;
    }

    this.notificationsService.enqueueCreate({
      userId: targetUserId,
      type: 'account:updated',
      title: 'Your account was updated',
      body: lines.join(' '),
      data: { userId: targetUserId, changedKeys },
    });
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
    const result = await withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.users)
        .set({ appTheme, updatedAt: new Date() })
        .where(eq(schema.users.id, actor.id))
        .returning({ appTheme: schema.users.appTheme });

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      return { appTheme: row.appTheme ?? null };
    });

    // Theme is part of the cached bundle — drop it so /auth/me returns fresh.
    void this.userBundleCache.invalidate(actor.id);

    return result;
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
    const row = await withActor(this.db, actor, async (tx) => {
      const [r] = await tx
        .update(schema.users)
        .set({ fontScale, updatedAt: new Date() })
        .where(eq(schema.users.id, actor.id))
        .returning({ fontScale: schema.users.fontScale });

      if (!r) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      return r;
    });

    // Font scale is part of the cached bundle — drop it so /auth/me returns fresh.
    void this.userBundleCache.invalidate(actor.id);

    return { fontScale: row.fontScale ?? null };
  }

  /**
   * Read the calling user's notification preferences map.
   * Missing keys / empty map = all types enabled by default.
   */
  async getMyNotificationPreferences(
    userId: string,
  ): Promise<Record<string, boolean>> {
    const [row] = await this.db
      .select({ prefs: schema.users.notificationPreferences })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return (row?.prefs as Record<string, boolean>) ?? {};
  }

  /**
   * Persist the calling user's notification preferences. Map of type → enabled.
   * Only `false` entries are meaningful (they opt the user out); `true` entries are
   * stored but equivalent to the default. Wipes nothing — the caller is expected
   * to send the full intended map.
   */
  async updateMyNotificationPreferences(
    preferences: Record<string, boolean>,
    actor: SessionUser,
  ): Promise<{ preferences: Record<string, boolean> }> {
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.users)
        .set({ notificationPreferences: preferences, updatedAt: new Date() })
        .where(eq(schema.users.id, actor.id))
        .returning({ prefs: schema.users.notificationPreferences });

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      return { preferences: (row.prefs as Record<string, boolean>) ?? {} };
    });
  }

  /**
   * Update the calling user's display name. Self-edit on the Settings → Account tab.
   * Phone / role / branch are NOT editable here — those go through admin update.
   */
  async updateMyProfile(input: { name: string }, actor: SessionUser): Promise<{ id: string; name: string }> {
    const trimmed = input.name.trim();
    if (trimmed.length < 2) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Name must be at least 2 characters',
      });
    }
    return withActor(this.db, actor, async (tx) => {
      const [row] = await tx
        .update(schema.users)
        .set({ name: trimmed, updatedAt: new Date() })
        .where(eq(schema.users.id, actor.id))
        .returning({ id: schema.users.id, name: schema.users.name });

      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      return row;
    });
  }

  /**
   * Change the calling user's password. Verifies the current password first; the new hash is
   * written through `withActor` so the temporal-audit trigger records who changed it.
   */
  async changeMyPassword(
    input: { currentPassword: string; newPassword: string },
    actor: SessionUser,
  ): Promise<{ success: true }> {
    if (input.newPassword.length < 8) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'New password must be at least 8 characters',
      });
    }

    const [current] = await this.db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, actor.id))
      .limit(1);

    if (!current) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const ok = await bcrypt.compare(input.currentPassword, current.passwordHash);
    if (!ok) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Current password is incorrect' });
    }

    const newHash = await this.authService.hashPassword(input.newPassword);
    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(schema.users.id, actor.id));
    });

    this.notificationsService.enqueueCreate({
      userId: actor.id,
      type: 'account:security',
      title: 'Password changed',
      body: 'Your password was successfully changed. If this wasn’t you, contact your administrator immediately.',
      data: {},
    });

    return { success: true };
  }

  // ============================================
  // Probation — set / extend / mark permanent / terminate
  // ============================================
  // Authority: SUPER_ADMIN or HR_MANAGER. ADMIN is intentionally NOT included
  // (CEO directive 2026-05-08 — only HR + SuperAdmin can move probation state).

  /** True when `actor` may set/unset/extend/terminate probation on any user. */
  private canManageProbation(actor: SessionUser): boolean {
    return actor.role === 'SUPER_ADMIN' || actor.role === 'HR_MANAGER';
  }

  private requireProbationAuthority(actor: SessionUser): void {
    if (!this.canManageProbation(actor)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only SuperAdmin and HR Manager can manage probation status.',
      });
    }
  }

  private async loadProbationTarget(userId: string) {
    const [row] = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        role: schema.users.role,
        status: schema.users.status,
        primaryBranchId: schema.users.primaryBranchId,
        isProbation: schema.users.isProbation,
        probationStartedAt: schema.users.probationStartedAt,
        probationUntil: schema.users.probationUntil,
        terminatedAt: schema.users.terminatedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }
    if (row.terminatedAt) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This user has already been terminated.',
      });
    }
    return row;
  }

  /**
   * Compute the live "termination blockers" snapshot. The UI calls this on the
   * Terminate Probation modal so HR sees exactly which open items must be cleared.
   * Returned counts must all be zero before `terminateProbation` will succeed.
   *
   * Locked rules (CEO directive 2026-05-08):
   *  - No active orders (any non-terminal CS / dispatch state) assigned to them
   *  - No scheduled callbacks (callback_scheduled_at IS NOT NULL on any of their assigned orders)
   *  - No payouts in DRAFT / PENDING_APPROVAL / APPROVED — must all be PAID or REJECTED
   */
  async getTerminationBlockers(userId: string, actor: SessionUser) {
    this.requireProbationAuthority(actor);

    const target = await this.loadProbationTarget(userId);
    if (!target.isProbation) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This user is not on probation.',
      });
    }

    type OrderStatus = (typeof schema.orders.status.enumValues)[number];
    type PayoutStatus = (typeof schema.payoutRecords.status.enumValues)[number];
    const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
      'UNPROCESSED',
      'CS_ASSIGNED',
      'CS_ENGAGED',
      'CONFIRMED',
      'AGENT_ASSIGNED',
      'DISPATCHED',
      'IN_TRANSIT',
    ];
    const OPEN_PAYOUT_STATUSES: PayoutStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];

    const [activeOrderRows, callbackRows, openPayoutRows] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            or(
              eq(schema.orders.assignedCsId, userId),
              eq(schema.orders.riderId, userId),
              eq(schema.orders.mediaBuyerId, userId),
            ),
            inArray(schema.orders.status, ACTIVE_ORDER_STATUSES),
            isNull(schema.orders.deletedAt),
          ),
        ),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(
          and(
            or(
              eq(schema.orders.assignedCsId, userId),
              eq(schema.orders.riderId, userId),
            ),
            sql`${schema.orders.callbackScheduledAt} IS NOT NULL`,
            inArray(schema.orders.status, ACTIVE_ORDER_STATUSES),
            isNull(schema.orders.deletedAt),
          ),
        ),
      this.db
        .select({ count: count() })
        .from(schema.payoutRecords)
        .where(
          and(
            eq(schema.payoutRecords.staffId, userId),
            inArray(schema.payoutRecords.status, OPEN_PAYOUT_STATUSES),
          ),
        ),
    ]);

    const activeOrderCount = Number(activeOrderRows[0]?.count ?? 0);
    const pendingCallbackCount = Number(callbackRows[0]?.count ?? 0);
    const pendingPayoutCount = Number(openPayoutRows[0]?.count ?? 0);

    return {
      target: {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        probationStartedAt: target.probationStartedAt,
        probationUntil: target.probationUntil,
      },
      activeOrderCount,
      pendingCallbackCount,
      pendingPayoutCount,
      canTerminate:
        activeOrderCount === 0 && pendingCallbackCount === 0 && pendingPayoutCount === 0,
    };
  }

  /** Place an existing user on probation. Default review window is 90 days. */
  async setProbation(input: SetProbationInput, actor: SessionUser) {
    this.requireProbationAuthority(actor);
    const target = await this.loadProbationTarget(input.userId);

    if (!isRoleProbationEligible(target.role)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Role ${target.role} is not eligible for probation.`,
      });
    }
    if (target.isProbation) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User is already on probation.',
      });
    }

    const probationUntil = input.probationUntil ?? defaultProbationUntilFromNow();
    const now = new Date();

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.users)
        .set({
          isProbation: true,
          probationStartedAt: now,
          probationStartedBy: actor.id,
          probationUntil,
          updatedAt: now,
        })
        .where(eq(schema.users.id, target.id));
    });

    void this.userBundleCache.invalidate(target.id);

    this.notificationsService.enqueueCreate({
      userId: target.id,
      type: 'account:probation_assigned',
      title: 'You are on probation',
      body: `Your account is on probation until ${probationUntil.toISOString().slice(0, 10)}. Speak to HR if you have questions.`,
      data: { userId: target.id, probationUntil: probationUntil.toISOString() },
    });

    return { success: true, probationUntil: probationUntil.toISOString() };
  }

  /** Move the probation review date later (or earlier — HR's call). */
  async extendProbation(input: ExtendProbationInput, actor: SessionUser) {
    this.requireProbationAuthority(actor);
    const target = await this.loadProbationTarget(input.userId);

    if (!target.isProbation) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User is not on probation.',
      });
    }

    const now = new Date();
    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.users)
        .set({ probationUntil: input.probationUntil, updatedAt: now })
        .where(eq(schema.users.id, target.id));
    });

    this.notificationsService.enqueueCreate({
      userId: target.id,
      type: 'account:probation_extended',
      title: 'Probation review date updated',
      body: `Your probation review date is now ${input.probationUntil.toISOString().slice(0, 10)}.`,
      data: { userId: target.id, probationUntil: input.probationUntil.toISOString() },
    });

    return { success: true };
  }

  /** Graduate the user off probation — they become a permanent staff member. */
  async markProbationPermanent(input: MarkProbationPermanentInput, actor: SessionUser) {
    this.requireProbationAuthority(actor);
    const target = await this.loadProbationTarget(input.userId);

    if (!target.isProbation) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User is not on probation.',
      });
    }

    const now = new Date();
    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.users)
        .set({
          isProbation: false,
          probationStartedAt: null,
          probationStartedBy: null,
          probationUntil: null,
          updatedAt: now,
        })
        .where(eq(schema.users.id, target.id));
    });

    void this.userBundleCache.invalidate(target.id);

    this.notificationsService.enqueueCreate({
      userId: target.id,
      type: 'account:probation_passed',
      title: 'Probation passed — welcome aboard',
      body: 'Your probation period has been cleared. You are now a permanent member of the team.',
      data: { userId: target.id },
    });

    return { success: true };
  }

  /**
   * Terminate a probation user.
   *
   * 1. Re-validate the blockers list (race protection — UI may have shown a stale snapshot).
   * 2. Insert a permanent `probation_terminations` row (the carve-out's audit record).
   * 3. UPDATE the `users` row to scrub PII — the temporal trigger captures the pre-scrub
   *    snapshot into `users_history` (still containing PII at that point).
   * 4. Run a SECONDARY scrub against `users_history` to NULL the PII columns on every prior
   *    version of this user's row. This is the ONE Pillar 4 carve-out — only allowed via
   *    this exact code path. The non-PII history (id, role, scope, timestamps) survives.
   * 5. Kill all active sessions in Redis.
   * 6. Notify HR_MANAGER + SUPER_ADMIN that the termination happened (the user themselves
   *    is being scrubbed, so there's nobody to notify on the target side).
   */
  async terminateProbation(input: TerminateProbationInput, actor: SessionUser) {
    this.requireProbationAuthority(actor);

    const target = await this.loadProbationTarget(input.userId);
    if (!target.isProbation) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User is not on probation.',
      });
    }

    if (input.confirmName.trim().toLowerCase() !== target.name.trim().toLowerCase()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Confirmation name does not match the user.',
      });
    }

    // Re-validate blockers under the actor's view (race protection).
    const blockers = await this.getTerminationBlockers(target.id, actor);
    if (!blockers.canTerminate) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message:
          `Cannot terminate — open items remain: ` +
          `${blockers.activeOrderCount} active order(s), ` +
          `${blockers.pendingCallbackCount} scheduled callback(s), ` +
          `${blockers.pendingPayoutCount} unpaid payout(s).`,
      });
    }

    const anonymizedSequence = Date.now();
    const anonymizedName = `Terminated probation user #${anonymizedSequence}`;
    const anonymizedEmail = `terminated-${target.id}@anonymized.local`;
    const now = new Date();

    await withActor(this.db, actor, async (tx) => {
      // (2) Permanent record of the termination act — survives the scrub.
      await tx.insert(schema.probationTerminations).values({
        userId: target.id,
        terminatedAt: now,
        terminatedBy: actor.id,
        reason: input.reason,
        originalRole: target.role,
        originalBranchId: target.primaryBranchId ?? null,
        blockersResolved: {
          activeOrderCount: blockers.activeOrderCount,
          pendingCallbackCount: blockers.pendingCallbackCount,
          pendingPayoutCount: blockers.pendingPayoutCount,
          currentMonthPayrollPaid: true,
        },
      });

      // (3) Scrub the live row. Temporal trigger captures pre-scrub snapshot into users_history.
      await tx
        .update(schema.users)
        .set({
          name: anonymizedName,
          email: anonymizedEmail,
          phone: null,
          passwordHash: '__terminated__',
          payoutBankName: null,
          payoutAccountName: null,
          payoutAccountNumber: null,
          payoutBankCode: null,
          status: 'DEACTIVATED',
          isProbation: false,
          probationStartedAt: null,
          probationStartedBy: null,
          probationUntil: null,
          terminatedAt: now,
          terminatedBy: actor.id,
          originalRole: target.role,
          updatedAt: now,
        })
        .where(eq(schema.users.id, target.id));

      // (4) PILLAR 4 CARVE-OUT — scrub PII columns from every users_history row for this user.
      // Only this code path may mutate users_history. The audit of the act itself lives in
      // probation_terminations (just inserted above).
      await tx.execute(sql`
        UPDATE users_history
           SET name = NULL,
               email = NULL,
               phone = NULL,
               password_hash = NULL,
               payout_bank_name = NULL,
               payout_account_name = NULL,
               payout_account_number = NULL,
               payout_bank_code = NULL
         WHERE id = ${target.id}::uuid
      `);
    });

    // (5) Kill open sessions.
    await this.authService.killUserSessions(target.id);
    void this.userBundleCache.invalidate(target.id);

    // (6) Notify HR + SuperAdmin (target user no longer has a meaningful identity).
    const announcementBody =
      `${target.role} probation user terminated by ${actor.role} on ${now.toISOString().slice(0, 10)}. Reason: ${input.reason}`;
    this.notificationsService.enqueueCreateForRole('HR_MANAGER', {
      type: 'account:probation_terminated',
      title: 'Probation user terminated',
      body: announcementBody,
      data: { userId: target.id, terminatedBy: actor.id },
    });
    this.notificationsService.enqueueCreateForRole('SUPER_ADMIN', {
      type: 'account:probation_terminated',
      title: 'Probation user terminated',
      body: announcementBody,
      data: { userId: target.id, terminatedBy: actor.id },
    });

    this.eventsService.emitToUser(target.id, 'auth:session_revoked', {
      reason: 'terminated',
    });

    return { success: true, terminatedAt: now.toISOString() };
  }

  /**
   * Cron-driven scan for probation review windows that fall due in the next 7 days.
   * Fires `account:probation_review_due` once per upcoming window so HR is reminded
   * to make a decision (Mark Permanent or Terminate) before the window expires.
   */
  async sendProbationReviewReminders(): Promise<{ remindersSent: number }> {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 7);

    const dueRows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
        probationUntil: schema.users.probationUntil,
      })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.isProbation, true),
          sql`${schema.users.probationUntil} IS NOT NULL`,
          sql`${schema.users.probationUntil} <= ${horizon}`,
          sql`${schema.users.terminatedAt} IS NULL`,
        ),
      );

    for (const user of dueRows) {
      const dueDate = user.probationUntil ? new Date(user.probationUntil).toISOString().slice(0, 10) : 'soon';
      this.notificationsService.enqueueCreateForRole('HR_MANAGER', {
        type: 'account:probation_review_due',
        title: 'Probation review due',
        body: `${user.name} (${user.role}) — probation review window closes ${dueDate}. Mark permanent or terminate.`,
        data: { userId: user.id, probationUntil: user.probationUntil?.toISOString() ?? null },
      });
    }

    return { remindersSent: dueRows.length };
  }

  /**
   * Cron: once a day at 04:00 — fan out probation-review reminders to HR_MANAGER for any
   * probation user whose review window closes within the next 7 days.
   *
   * The reminder is idempotent at the recipient level (notifications dedup happens
   * downstream in NotificationsService), so re-running on the same day is harmless.
   */
  @Cron('0 0 4 * * *')
  async handleProbationReviewReminders(): Promise<void> {
    try {
      const { remindersSent } = await this.sendProbationReviewReminders();
      if (remindersSent > 0) {
        this.logger.log(`Probation review reminders dispatched: ${remindersSent}`);
      }
    } catch (err) {
      this.logger.error(
        `Probation review reminder cron failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
