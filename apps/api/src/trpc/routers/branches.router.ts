import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, count } from 'drizzle-orm';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { db as schema } from '@yannis/shared';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SessionStoreService } from '../../auth/session-store.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { BranchTeamsService } from '../../branches/branch-teams.service';
import type { SettingsService } from '../../settings/settings.service';
import { OVERRIDABLE_TEAM_SETTINGS } from '../../settings/settings.service';
import { canMirror } from '../../common/authz';
import { CacheService } from '../../common/cache/cache.service';

// Service instances injected via factory pattern
let drizzleInstance: PostgresJsDatabase<typeof schema> | null = null;
let sessionStoreInstance: SessionStoreService | null = null;
let notificationsServiceInstance: NotificationsService | null = null;
let branchTeamsServiceInstance: BranchTeamsService | null = null;
let branchesCacheService: CacheService | null = null;
let branchesSettingsService: SettingsService | null = null;

export function setBranchesSettingsService(service: SettingsService) {
  branchesSettingsService = service;
}

function getBranchesSettingsService(): SettingsService {
  if (!branchesSettingsService) throw new Error('SettingsService not initialized for branches router');
  return branchesSettingsService;
}

export function setBranchesDb(db: PostgresJsDatabase<typeof schema>) {
  drizzleInstance = db;
}

export function setBranchesSessionStore(sessionStore: SessionStoreService) {
  sessionStoreInstance = sessionStore;
}

export function setBranchesNotificationsService(service: NotificationsService) {
  notificationsServiceInstance = service;
}

export function setBranchTeamsService(service: BranchTeamsService) {
  branchTeamsServiceInstance = service;
}

export function setBranchesCacheService(service: CacheService) {
  branchesCacheService = service;
}

const BRANCHES_LIST_TTL_SECONDS = 60 * 15;

async function invalidateBranchesListCache(): Promise<void> {
  if (!branchesCacheService) return;
  await branchesCacheService.delPattern('cache:branches:list:*').catch(() => {});
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!drizzleInstance) throw new Error('Branches DB not initialized');
  return drizzleInstance;
}

function getSessionStore(): SessionStoreService {
  if (!sessionStoreInstance) throw new Error('Branches SessionStore not initialized');
  return sessionStoreInstance;
}

function getBranchesNotificationsService(): NotificationsService {
  if (!notificationsServiceInstance) {
    throw new Error('Branches NotificationsService not initialized');
  }
  return notificationsServiceInstance;
}

export function getBranchTeamsService(): BranchTeamsService {
  if (!branchTeamsServiceInstance) throw new Error('BranchTeamsService not initialized');
  return branchTeamsServiceInstance;
}

/**
 * Inline branch list for cross-router bundles. Mirrors `branches.list` (admin
 * sees all, others see their memberships only) and reuses the same Redis cache.
 * Exported so `*PageBundle` procedures can avoid a second HTTP round-trip.
 */
export async function listBranchesForUser(user: {
  id: string;
  role: string;
}): Promise<Array<{ id: string; name: string; code?: string }>> {
  const db = getDb();
  const isAdmin = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN';

  const fetchRows = async (): Promise<Array<{ id: string; name: string; code?: string }>> => {
    if (isAdmin) {
      return db.select().from(schema.branches);
    }
    const memberships = await db
      .select({ branchId: schema.userBranches.branchId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, user.id));
    if (memberships.length === 0) return [];
    const branchIds = memberships.map((m) => m.branchId);
    return db
      .select()
      .from(schema.branches)
      .where(
        branchIds.length === 1
          ? eq(schema.branches.id, branchIds[0]!)
          : inArray(schema.branches.id, branchIds),
      );
  };

  if (!branchesCacheService) return fetchRows();
  const key =
    'cache:branches:list:' +
    CacheService.hashInput({ viewerId: user.id, isAdmin });
  return branchesCacheService.getOrSet(key, BRANCHES_LIST_TTL_SECONDS, fetchRows);
}

const CS_OVERVIEW_ROLES = new Set(['CS_CLOSER', 'HEAD_OF_CS']);
const MARKETING_OVERVIEW_ROLES = new Set(['MEDIA_BUYER', 'HEAD_OF_MARKETING']);
const LOGISTICS_OVERVIEW_ROLES = new Set([
  'LOGISTICS_MANAGER',
  'HEAD_OF_LOGISTICS',
  'TPL_MANAGER',
  'TPL_RIDER',
  'STOCK_MANAGER',
]);

/** Payroll-aligned buckets for branch member filters (see branch overview UI). */
type BranchMemberDepartment = 'CS' | 'MARKETING' | 'LOGISTICS' | 'FINANCE' | 'HR' | 'OTHER';

function departmentForBranchMemberRole(effectiveRole: string): BranchMemberDepartment {
  if (CS_OVERVIEW_ROLES.has(effectiveRole)) return 'CS';
  if (MARKETING_OVERVIEW_ROLES.has(effectiveRole)) return 'MARKETING';
  if (LOGISTICS_OVERVIEW_ROLES.has(effectiveRole)) return 'LOGISTICS';
  if (effectiveRole === 'FINANCE_OFFICER') return 'FINANCE';
  if (effectiveRole === 'HR_MANAGER') return 'HR';
  return 'OTHER';
}

const ACTIVE_ORDER_STATUSES = new Set([
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
]);

type BranchTeamDepartment = 'CS' | 'MARKETING';

function actorCanManageTeamDept(
  perms: ReadonlyArray<string>,
  isSuperAdmin: boolean,
  dept: BranchTeamDepartment,
): boolean {
  if (isSuperAdmin) return true;
  if (perms.includes('branches.manage')) return true;
  return perms.includes(dept === 'CS' ? 'branches.teams.cs' : 'branches.teams.marketing');
}

async function loadTeamDepartment(teamId: string): Promise<BranchTeamDepartment> {
  const db = getDb();
  const [row] = await db
    .select({ department: schema.branchTeams.department })
    .from(schema.branchTeams)
    .where(eq(schema.branchTeams.id, teamId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
  }
  return row.department as BranchTeamDepartment;
}

async function loadBranchDepartmentDept(branchDepartmentId: string): Promise<BranchTeamDepartment> {
  const db = getDb();
  const [row] = await db
    .select({ department: schema.branchDepartments.department })
    .from(schema.branchDepartments)
    .where(eq(schema.branchDepartments.id, branchDepartmentId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
  }
  return row.department as BranchTeamDepartment;
}

function assertCanManageTeamDept(
  ctxUser: { role: string; permissions?: ReadonlyArray<string> | null },
  dept: BranchTeamDepartment,
): void {
  const isSuperAdmin = ctxUser.role === 'SUPER_ADMIN';
  const perms = ctxUser.permissions ?? [];
  if (!actorCanManageTeamDept(perms, isSuperAdmin, dept)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        dept === 'CS'
          ? 'You don’t have permission to manage CS branch teams'
          : 'You don’t have permission to manage Marketing branch teams',
    });
  }
}

export const branchesRouter = router({
  /**
   * List all branches (SuperAdmin) or branches the current user belongs to.
   */
  list: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const isAdmin = ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN';
    if (!branchesCacheService) {
      if (isAdmin) {
        return db.select().from(schema.branches);
      }
      const memberships = await db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.userId, ctx.user.id));
      if (memberships.length === 0) return [];
      const branchIds: string[] = memberships.map((m) => m.branchId);
      return db
        .select()
        .from(schema.branches)
        .where(
          branchIds.length === 1
            ? eq(schema.branches.id, branchIds[0]!)
            : inArray(schema.branches.id, branchIds),
        );
    }

    const key =
      'cache:branches:list:' +
      CacheService.hashInput({
        viewerId: ctx.user.id,
        isAdmin,
      });

    return branchesCacheService.getOrSet(key, BRANCHES_LIST_TTL_SECONDS, async () => {
      if (isAdmin) {
        return db.select().from(schema.branches);
      }
      const memberships = await db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.userId, ctx.user.id));
      if (memberships.length === 0) return [];
      const branchIds: string[] = memberships.map((m) => m.branchId);
      return db
        .select()
        .from(schema.branches)
        .where(
          branchIds.length === 1
            ? eq(schema.branches.id, branchIds[0]!)
            : inArray(schema.branches.id, branchIds),
        );
    });
  }),

  /**
   * Branch overview: flat `members` (+ department bucket), order pipeline counts, campaigns, message templates.
   */
  overview: authedProcedure
    .input(z.object({ branchId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const teams = getBranchTeamsService();
      const isSuperAdmin = ctx.user.role === 'SUPER_ADMIN';
      const overviewPerms = ctx.user.permissions ?? [];
      const hasBranchManagePermission = overviewPerms.includes('branches.manage');
      const hasBranchManageUsersPermission = overviewPerms.includes('branches.manage_users');
      const hasCSTeamsPermission = overviewPerms.includes('branches.teams.cs');
      const hasMarketingTeamsPermission = overviewPerms.includes('branches.teams.marketing');

      const membership = await db
        .select({ branchId: schema.userBranches.branchId })
        .from(schema.userBranches)
        .where(
          and(
            eq(schema.userBranches.userId, ctx.user.id),
            eq(schema.userBranches.branchId, input.branchId),
          ),
        )
        .limit(1);
      if (
        !isSuperAdmin &&
        !hasBranchManagePermission &&
        !hasCSTeamsPermission &&
        !hasMarketingTeamsPermission &&
        !membership[0]
      ) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this branch' });
      }

      const isBranchSupervisor = await teams.isActorSupervisorOnBranch(ctx.user.id, input.branchId);
      const canAccessBranchPage =
        isSuperAdmin ||
        hasBranchManagePermission ||
        hasBranchManageUsersPermission ||
        hasCSTeamsPermission ||
        hasMarketingTeamsPermission ||
        isBranchSupervisor;
      if (!canAccessBranchPage) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to access this branch page' });
      }

      const [branch] = await db
        .select({
          id: schema.branches.id,
          name: schema.branches.name,
          code: schema.branches.code,
          status: schema.branches.status,
          createdAt: schema.branches.createdAt,
        })
        .from(schema.branches)
        .where(eq(schema.branches.id, input.branchId))
        .limit(1);

      if (!branch) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Branch not found' });
      }

      const memberRows = await db
        .select({
          userId: schema.users.id,
          name: schema.users.name,
          globalRole: schema.users.role,
          roleInBranch: schema.userBranches.roleInBranch,
          isPrimary: schema.userBranches.isPrimary,
        })
        .from(schema.userBranches)
        .innerJoin(schema.users, eq(schema.userBranches.userId, schema.users.id))
        .where(eq(schema.userBranches.branchId, input.branchId));

      const members = memberRows.map((row) => {
        const effectiveRole = (row.roleInBranch ?? row.globalRole) as string;
        return {
          userId: row.userId,
          name: row.name,
          effectiveRole,
          isPrimary: row.isPrimary,
          department: departmentForBranchMemberRole(effectiveRole),
        };
      });
      const canManageBranchPage = isSuperAdmin || hasBranchManagePermission || hasBranchManageUsersPermission;
      let visibleMembers = members;
      if (!canManageBranchPage) {
        if (isBranchSupervisor) {
          const [supervisedCs, supervisedMarketing] = await Promise.all([
            teams.listSupervisedUserIds(ctx.user.id, input.branchId, 'CS'),
            teams.listSupervisedUserIds(ctx.user.id, input.branchId, 'MARKETING'),
          ]);
          const visibleIds = new Set([ctx.user.id, ...supervisedCs, ...supervisedMarketing]);
          visibleMembers = members.filter((member) => visibleIds.has(member.userId));
        } else {
          visibleMembers = members.filter((member) => member.userId === ctx.user.id);
        }
      }

      const orderStatRows = await db
        .select({
          status: schema.orders.status,
          orderCount: count(),
        })
        .from(schema.orders)
        .where(eq(schema.orders.branchId, input.branchId))
        .groupBy(schema.orders.status);

      let totalOrders = 0;
      let deliveredOrders = 0;
      let activeOrders = 0;
      for (const row of orderStatRows) {
        const c = Number(row.orderCount);
        totalOrders += c;
        if (row.status === 'DELIVERED') deliveredOrders += c;
        if (row.status && ACTIVE_ORDER_STATUSES.has(row.status)) activeOrders += c;
      }

      const [campaignsRow] = await db
        .select({ c: count() })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.branchId, input.branchId));

      const [templatesRow] = await db
        .select({ c: count() })
        .from(schema.messageTemplates)
        .where(eq(schema.messageTemplates.branchId, input.branchId));

      const canManageCSTeams =
        isSuperAdmin || hasBranchManagePermission || hasCSTeamsPermission;
      const canManageMarketingTeams =
        isSuperAdmin || hasBranchManagePermission || hasMarketingTeamsPermission;

      return {
        branch,
        counts: {
          totalMembers: visibleMembers.length,
          totalOrders,
          deliveredOrders,
          activeOrders,
          campaigns: Number(campaignsRow?.c ?? 0),
          messageTemplates: Number(templatesRow?.c ?? 0),
        },
        members: visibleMembers,
        viewer: {
          canManageBranchPage,
          isSupervisor: isBranchSupervisor,
          canManageCSTeams,
          canManageMarketingTeams,
        },
      };
    }),

  /**
   * Create a new branch. SuperAdmin only.
   */
  create: permissionProcedure('branches.manage')
    .input(
      z.object({
        name: z.string().min(2).max(100),
        code: z.string().min(2).max(20).toUpperCase(),
        settings: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const branchTeams = getBranchTeamsService();
      const rows = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(schema.branches)
          .values({
            name: input.name,
            code: input.code,
            status: 'ACTIVE',
            settings: input.settings ?? null,
          })
          .returning();
        const branch = inserted[0];
        if (!branch) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Branch insert returned no row' });
        }
        await branchTeams.ensureDefaultDepartmentTeams(branch.id, tx);
        return inserted;
      });
      await invalidateBranchesListCache();
      return rows[0];
    }),

  /**
   * Update a branch. SuperAdmin only.
   */
  update: permissionProcedure('branches.manage')
    .input(
      z.object({
        branchId: z.string().uuid(),
        name: z.string().min(2).max(100).optional(),
        // Mirrors `create`'s code validator — short unique label (LGS, ABJ, etc.).
        // Uppercased + trimmed before write so the unique index is case-insensitive
        // by convention even though the column itself is plain text.
        code: z.string().min(2).max(20).toUpperCase().optional(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        settings: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updateFields.name = input.name;
      if (input.code) updateFields.code = input.code;
      if (input.status) updateFields.status = input.status;
      if (input.settings !== undefined) updateFields.settings = input.settings;
      try {
        const rows = await db
          .update(schema.branches)
          .set(updateFields)
          .where(eq(schema.branches.id, input.branchId))
          .returning();
        await invalidateBranchesListCache();
        return rows[0];
      } catch (err) {
        // 23505 = unique_violation. The only unique field we touch on update is
        // `code` — surface a friendly error so the form can show "Code already
        // in use" instead of leaking the raw Postgres message.
        if ((err as { code?: string })?.code === '23505') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'That branch code is already in use. Pick another.',
          });
        }
        throw err;
      }
    }),

  /**
   * Assign a user to a branch. SuperAdmin only.
   */
  assignUser: permissionProcedure('branches.manage')
    .input(
      z.object({
        userId: z.string().uuid(),
        branchId: z.string().uuid(),
        roleInBranch: z.string().optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const notifications = getBranchesNotificationsService();

      // CEO directive 2026-05-10: only Marketing, CS, and Branch Admin roles
      // belong in the branching system. Block server-side so a tampered
      // request can't bypass the UI's role filter.
      const BRANCH_ELIGIBLE_ROLES = new Set([
        'MEDIA_BUYER',
        'HEAD_OF_MARKETING',
        'CS_CLOSER',
        'HEAD_OF_CS',
        'BRANCH_ADMIN',
      ]);
      const userRow = await db
        .select({ role: schema.users.role })
        .from(schema.users)
        .where(eq(schema.users.id, input.userId))
        .limit(1);
      if (!userRow[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      const effectiveRole = input.roleInBranch ?? userRow[0].role;
      if (!BRANCH_ELIGIBLE_ROLES.has(effectiveRole)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Only Marketing, Customer Support, and Branch Admin roles can be assigned to a branch. Other roles are org-wide.',
        });
      }

      const existing = await db
        .select({ userId: schema.userBranches.userId })
        .from(schema.userBranches)
        .where(
          and(
            eq(schema.userBranches.userId, input.userId),
            eq(schema.userBranches.branchId, input.branchId),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return { success: true, alreadyMember: true as const };
      }

      await db.insert(schema.userBranches).values({
        userId: input.userId,
        branchId: input.branchId,
        roleInBranch: (input.roleInBranch as (typeof schema.userBranches.$inferInsert)['roleInBranch']) ?? null,
        isPrimary: input.isPrimary ?? false,
      });
      await invalidateBranchesListCache();

      const branchRows = await db
        .select({ name: schema.branches.name })
        .from(schema.branches)
        .where(eq(schema.branches.id, input.branchId))
        .limit(1);
      const branchName = branchRows[0]?.name ?? 'A branch';

      notifications
        .create({
          userId: input.userId,
          type: 'account:updated',
          title: 'Your account was updated',
          body: `You were added to branch "${branchName}".`,
          data: {
            userId: input.userId,
            changedKeys: ['branch'],
            branchId: input.branchId,
          },
        })
        .catch(() => {});

      return { success: true };
    }),

  /**
   * Remove a user from a branch. SuperAdmin only.
   */
  removeUser: permissionProcedure('branches.manage')
    .input(
      z.object({
        userId: z.string().uuid(),
        branchId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const notifications = getBranchesNotificationsService();

      const branchRows = await db
        .select({ name: schema.branches.name })
        .from(schema.branches)
        .where(eq(schema.branches.id, input.branchId))
        .limit(1);
      const branchName = branchRows[0]?.name ?? 'A branch';

      const removed = await db
        .delete(schema.userBranches)
        .where(
          and(
            eq(schema.userBranches.userId, input.userId),
            eq(schema.userBranches.branchId, input.branchId),
          ),
        )
        .returning({ userId: schema.userBranches.userId });

      if (removed[0]) {
        await invalidateBranchesListCache();
        notifications
          .create({
            userId: input.userId,
            type: 'account:updated',
            title: 'Your account was updated',
            body: `You were removed from branch "${branchName}".`,
            data: {
              userId: input.userId,
              changedKeys: ['branch'],
              branchId: input.branchId,
            },
          })
          .catch(() => {});
      }

      return { success: true };
    }),

  /**
   * Whether the current user may start Mirror Mode for the target user (HoS matrix or branch supervisor graph).
   * When already mirroring (`mirroredBy` set), `allowed` is always false (no nested chains) but
   * `previewEligible` reflects whether the mirrored identity would be allowed to mirror the target
   * so the UI can show a disabled Mirror affordance.
   */
  canMirrorToUser: authedProcedure
    .input(z.object({ targetUserId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const teams = getBranchTeamsService();
      const [target] = await db
        .select({
          id: schema.users.id,
          role: schema.users.role,
          primaryBranchId: schema.users.primaryBranchId,
          status: schema.users.status,
        })
        .from(schema.users)
        .where(eq(schema.users.id, input.targetUserId))
        .limit(1);
      if (!target || target.status !== 'ACTIVE') {
        return {
          allowed: false as const,
          previewEligible: false as const,
          nestedMirrorSession: false as const,
          reason: 'not_found_or_inactive' as const,
        };
      }
      const actor = {
        id: ctx.user.id,
        role: ctx.user.role,
        currentBranchId: ctx.user.currentBranchId ?? null,
        mirroredBy: ctx.user.mirroredBy ?? null,
      };
      const targetPayload = {
        id: target.id,
        role: target.role,
        primaryBranchId: target.primaryBranchId,
      };

      const viaSupervision = await teams.actorCanMirrorViaSupervision(actor, {
        id: target.id,
        role: target.role,
      });

      const previewEligible =
        canMirror({ ...actor, mirroredBy: null }, targetPayload) || viaSupervision;

      const nestedMirrorSession = !!actor.mirroredBy;

      if (!previewEligible) {
        return {
          allowed: false as const,
          previewEligible: false as const,
          nestedMirrorSession,
          reason: 'forbidden' as const,
        };
      }

      if (nestedMirrorSession) {
        return {
          allowed: false as const,
          previewEligible: true as const,
          nestedMirrorSession: true as const,
          reason: 'preview_only_nested_mirror' as const,
        };
      }

      const byMatrix = canMirror({ ...actor, mirroredBy: null }, targetPayload);
      return {
        allowed: true as const,
        previewEligible: true as const,
        nestedMirrorSession: false as const,
        reason: byMatrix ? ('role_matrix' as const) : ('supervision' as const),
      };
    }),

  listTeamsWithMembers: authedProcedure
    .input(z.object({ branchId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const teams = getBranchTeamsService();
      const isSuperAdmin = ctx.user.role === 'SUPER_ADMIN';
      const perms = ctx.user.permissions ?? [];
      const hasBranchManagePermission = perms.includes('branches.manage');
      const hasBranchManageUsersPermission = perms.includes('branches.manage_users');
      const hasCSTeamsPermission = perms.includes('branches.teams.cs');
      const hasMarketingTeamsPermission = perms.includes('branches.teams.marketing');
      const [membership, isBranchSupervisor] = await Promise.all([
        db
          .select({ branchId: schema.userBranches.branchId })
          .from(schema.userBranches)
          .where(
            and(
              eq(schema.userBranches.userId, ctx.user.id),
              eq(schema.userBranches.branchId, input.branchId),
            ),
          )
          .limit(1),
        teams.isActorSupervisorOnBranch(ctx.user.id, input.branchId),
      ]);
      const canAccessBranchPage =
        isSuperAdmin ||
        hasBranchManagePermission ||
        hasBranchManageUsersPermission ||
        hasCSTeamsPermission ||
        hasMarketingTeamsPermission ||
        isBranchSupervisor;
      const bypassMembership =
        isSuperAdmin ||
        hasBranchManagePermission ||
        (ctx.user.role === 'HEAD_OF_CS' && hasCSTeamsPermission);
      if (!canAccessBranchPage || (!bypassMembership && !membership[0])) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to access branch teams' });
      }
      return teams.listTeamsWithMembers(input.branchId);
    }),

  listBranchOrgStructure: authedProcedure
    .input(z.object({ branchId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const teams = getBranchTeamsService();
      const db = getDb();
      const isSuperAdmin = ctx.user.role === 'SUPER_ADMIN';
      const perms = ctx.user.permissions ?? [];
      const hasBranchManagePermission = perms.includes('branches.manage');
      const hasBranchManageUsersPermission = perms.includes('branches.manage_users');
      const hasCSTeamsPermission = perms.includes('branches.teams.cs');
      const hasMarketingTeamsPermission = perms.includes('branches.teams.marketing');
      const [membership, isBranchSupervisor] = await Promise.all([
        db
          .select({ branchId: schema.userBranches.branchId })
          .from(schema.userBranches)
          .where(
            and(
              eq(schema.userBranches.userId, ctx.user.id),
              eq(schema.userBranches.branchId, input.branchId),
            ),
          )
          .limit(1),
        teams.isActorSupervisorOnBranch(ctx.user.id, input.branchId),
      ]);
      const canAccessBranchPage =
        isSuperAdmin ||
        hasBranchManagePermission ||
        hasBranchManageUsersPermission ||
        hasCSTeamsPermission ||
        hasMarketingTeamsPermission ||
        isBranchSupervisor;
      const bypassMembership =
        isSuperAdmin ||
        hasBranchManagePermission ||
        (ctx.user.role === 'HEAD_OF_CS' && hasCSTeamsPermission);
      if (!canAccessBranchPage || (!bypassMembership && !membership[0])) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to access branch teams' });
      }
      return teams.listBranchOrgStructure(input.branchId);
    }),

  createBranchTeam: authedProcedure
    .input(
      z.object({
        branchId: z.string().uuid(),
        department: z.enum(['CS', 'MARKETING']),
        name: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      assertCanManageTeamDept(ctx.user, input.department);
      return getBranchTeamsService().createTeam(input.branchId, input.department, input.name, ctx.user);
    }),

  updateBranchTeam: authedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        name: z.string().max(120).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      return getBranchTeamsService().updateTeam(input.teamId, { name: input.name });
    }),

  deleteBranchTeam: authedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchTeamsService().deleteTeam(input.teamId);
      return { success: true as const };
    }),

  addBranchTeamMember: authedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
        isSupervisor: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchTeamsService().addTeamMember(
        input.teamId,
        input.userId,
        input.isSupervisor,
        ctx.user,
      );
      return { success: true as const };
    }),

  removeBranchTeamMember: authedProcedure
    .input(z.object({ teamId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchTeamsService().removeTeamMember(input.teamId, input.userId);
      return { success: true as const };
    }),

  setBranchTeamMemberSupervisor: authedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
        isSupervisor: z.boolean(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchTeamsService().setMemberSupervisor(
        input.teamId,
        input.userId,
        input.isSupervisor,
      );
      return { success: true as const };
    }),

  addBranchDepartmentMember: authedProcedure
    .input(z.object({ branchDepartmentId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dept = await loadBranchDepartmentDept(input.branchDepartmentId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchTeamsService().addDepartmentMember(
        input.branchDepartmentId,
        input.userId,
        ctx.user,
      );
      return { success: true as const };
    }),

  removeBranchDepartmentMember: authedProcedure
    .input(z.object({ branchDepartmentId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dept = await loadBranchDepartmentDept(input.branchDepartmentId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchTeamsService().removeDepartmentMember(
        input.branchDepartmentId,
        input.userId,
      );
      return { success: true as const };
    }),

  /**
   * Phase C — list every overridable system setting for a team, with the
   * resolved value (enforced-system > team > system) and metadata so the UI
   * can render the inline settings panel.
   */
  listTeamSettings: authedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      const settings = await getBranchesSettingsService().listTeamSettings(input.teamId, dept);
      const catalog = OVERRIDABLE_TEAM_SETTINGS.filter((s) =>
        s.allowedDepartments.includes(dept),
      ).map((s) => ({
        key: s.key,
        label: s.label,
        description: s.description,
      }));
      return { department: dept, catalog, settings };
    }),

  /** Phase C — write a per-team override for a single key. */
  setTeamSetting: authedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        key: z.string().min(1).max(120),
        value: z.record(z.unknown()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      const def = OVERRIDABLE_TEAM_SETTINGS.find((s) => s.key === input.key);
      if (!def || !def.allowedDepartments.includes(dept)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Setting "${input.key}" is not overridable for ${dept} teams.`,
        });
      }
      // Block override when system_settings.is_enforced is set.
      const effective = await getBranchesSettingsService().getEffectiveTeamSetting(
        input.teamId,
        input.key,
      );
      if (effective.systemEnforced) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This setting is locked at the system level. Ask an admin to clear the enforcement before overriding.',
        });
      }
      await getBranchesSettingsService().setTeamSetting(
        input.teamId,
        input.key,
        input.value,
        ctx.user.id,
      );
      return { success: true as const };
    }),

  /** Phase C — drop a team override; the team falls back to the system value. */
  clearTeamSetting: authedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        key: z.string().min(1).max(120),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchesSettingsService().clearTeamSetting(input.teamId, input.key, ctx.user.id);
      return { success: true as const };
    }),

  /**
   * Switch the active branch in the current session.
   * User must be a member of the target branch (or SuperAdmin).
   * Pass branchId: null to clear branch context (SuperAdmin "All Branches" view).
   */
  switchBranch: authedProcedure
    .input(z.object({ branchId: z.string().uuid().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const sessionStore = getSessionStore();

      // null = "All Branches" — only SuperAdmin may clear branch context
      if (input.branchId === null) {
        if ((ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN')) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only SuperAdmin can view all branches' });
        }
      } else if ((ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN')) {
        const membership = await db
          .select({ branchId: schema.userBranches.branchId })
          .from(schema.userBranches)
          .where(
            and(
              eq(schema.userBranches.userId, ctx.user.id),
              eq(schema.userBranches.branchId, input.branchId),
            ),
          )
          .limit(1);
        if (!membership[0]) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this branch' });
        }
      }

      // Update session cookie stored in Redis
      const sessionToken = ctx.sessionToken as string | undefined;
      if (sessionToken) {
        const currentSession = await sessionStore.getSession(sessionToken);
        if (currentSession) {
          const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
          await sessionStore.updateSession(
            sessionToken,
            { ...currentSession, currentBranchId: input.branchId ?? null },
            ttl,
          );
        }
      }

      return { currentBranchId: input.branchId ?? null };
    }),
});
