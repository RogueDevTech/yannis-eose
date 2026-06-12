import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, or, inArray, count, asc, sql } from 'drizzle-orm';
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
  if (!branchesSettingsService)
    throw new Error('SettingsService not initialized for branches router');
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
 * Branch IDs a Media Buyer may scope to in the header switcher: current
 * memberships UNION every branch their own orders / campaigns are attributed
 * to. A buyer moved off a branch keeps the branch in this set so they can
 * still open it as a read-only data lens and review what they created there.
 * Attribution is by ownership (`media_buyer_id`), so this never widens what a
 * buyer can see beyond their own data.
 */
async function mediaBuyerBranchScopeIds(userId: string): Promise<string[]> {
  const db = getDb();
  const [memberships, orderBranches, campaignBranches] = await Promise.all([
    db
      .select({ branchId: schema.userBranches.branchId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, userId)),
    db
      .selectDistinct({ branchId: schema.orders.branchId })
      .from(schema.orders)
      .where(eq(schema.orders.mediaBuyerId, userId)),
    db
      .selectDistinct({ branchId: schema.campaigns.branchId })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.mediaBuyerId, userId)),
  ]);
  const ids = new Set<string>();
  for (const r of [...memberships, ...orderBranches, ...campaignBranches]) {
    if (r.branchId) ids.add(r.branchId);
  }
  return [...ids];
}

/**
 * Inline branch list for cross-router bundles. Mirrors `branches.list` (admin
 * sees all, Media Buyers see their data-footprint branches, everyone else
 * their memberships only) and reuses the same Redis cache. Exported so
 * `*PageBundle` procedures can avoid a second HTTP round-trip.
 */
export async function listBranchesForUser(user: {
  id: string;
  role: string;
}): Promise<Array<{ id: string; name: string; code: string; status: string; groupId: string | null }>> {
  const db = getDb();
  // Org-wide roles see every branch even without explicit branch memberships:
  // SuperAdmin / Admin manage anything; HR creates / edits staff across the
  // org; Finance reconciles every branch; Head of Logistics and Head of CS
  // keep cross-branch visibility. Head of Marketing is intentionally excluded:
  // branch assignments define the branches they can switch between.
  const SEES_ALL_BRANCHES_ROLES = new Set([
    'SUPER_ADMIN',
    'ADMIN',
    'SUPPORT',
    'HR_MANAGER',
    'FINANCE_OFFICER',
    'HEAD_OF_LOGISTICS',
    'HEAD_OF_CS',
  ]);
  const seesAll = SEES_ALL_BRANCHES_ROLES.has(user.role);

  // Explicit projection — `status` is threaded through so the header branch
  // switcher can tag a disabled (INACTIVE) branch instead of dropping it.
  // `groupId` is included for the multi-company group switcher (CEO 2026-06-10).
  const branchCols = {
    id: schema.branches.id,
    name: schema.branches.name,
    code: schema.branches.code,
    status: schema.branches.status,
    groupId: schema.branches.groupId,
  };
  const fetchRows = async (): Promise<
    Array<{ id: string; name: string; code: string; status: string; groupId: string | null }>
  > => {
    if (seesAll) {
      return db.select(branchCols).from(schema.branches);
    }
    const branchIds =
      user.role === 'MEDIA_BUYER'
        ? await mediaBuyerBranchScopeIds(user.id)
        : (
            await db
              .select({ branchId: schema.userBranches.branchId })
              .from(schema.userBranches)
              .where(eq(schema.userBranches.userId, user.id))
          ).map((m) => m.branchId);
    if (branchIds.length === 0) return [];
    return db
      .select(branchCols)
      .from(schema.branches)
      .where(
        branchIds.length === 1
          ? eq(schema.branches.id, branchIds[0]!)
          : inArray(schema.branches.id, branchIds),
      );
  };

  if (!branchesCacheService) return fetchRows();
  // Cache key includes `seesAll` (was `isAdmin`) so an HR Manager and a
  // Media Buyer can't share a cache entry — they get different rowsets.
  const key = 'cache:branches:list:' + CacheService.hashInput({ viewerId: user.id, seesAll });
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

/**
 * Permission gate for team-management procedures (CEO directive 2026-05-10):
 *   - SuperAdmin / `branches.manage` / dept-level manage → allow (existing).
 *   - Team supervisor on the target team → allow, but ONLY for that team.
 *
 * Use this on procedures that take a `teamId` and need to allow either a
 * department head OR the team's own supervisor:
 *   - addBranchTeamMember / addBranchTeamMembersBulk
 *   - removeBranchTeamMember
 *   - updateBranchTeam (rename)
 *
 * Do NOT use for `setBranchTeamMemberSupervisor` — that one stays Head-only
 * because a supervisor must not be able to crown a successor or self-demote
 * (single-supervisor invariant + no privilege handoff).
 */
async function assertCanManageTeamOrSupervisor(
  ctxUser: { id: string; role: string; permissions?: ReadonlyArray<string> | null },
  teamId: string,
  dept: BranchTeamDepartment,
): Promise<void> {
  const isSuperAdmin = ctxUser.role === 'SUPER_ADMIN';
  const perms = ctxUser.permissions ?? [];
  if (actorCanManageTeamDept(perms, isSuperAdmin, dept)) return;
  const isSupervisor = await getBranchTeamsService().isSupervisorOfTeam(ctxUser.id, teamId);
  if (isSupervisor) return;
  throw new TRPCError({
    code: 'FORBIDDEN',
    message:
      dept === 'CS'
        ? 'You don’t have permission to manage this Sales team'
        : 'You don’t have permission to manage this Marketing team',
  });
}

export const branchesRouter = router({
  /**
   * List all branches (SuperAdmin / Admin / HR Manager / Finance Officer /
   * org-wide department heads) or branches the current user belongs to.
   *
   * Delegates to the shared `listBranchesForUser` helper so the role/scope
   * rules live in exactly one place. The earlier copy of this gate was
   * out of sync — it only allowed SUPER_ADMIN / ADMIN, locking HR Manager
   * out of the branch picker on `/hr/users/new` even though they're an
   * org-wide role (CEO directive 2026-05-10).
   */
  list: authedProcedure.query(async ({ ctx }) => {
    return listBranchesForUser({ id: ctx.user.id, role: ctx.user.role });
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
      const isHeadOfCsRole = ctx.user.role === 'HEAD_OF_CS';

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
        !isHeadOfCsRole &&
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
        isHeadOfCsRole ||
        isBranchSupervisor;
      if (!canAccessBranchPage) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not allowed to access this branch page',
        });
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
      const canManageBranchPage =
        isSuperAdmin || hasBranchManagePermission || hasBranchManageUsersPermission;
      let visibleMembers = members;
      if (!canManageBranchPage) {
        // Heads hold `branches.teams.*` on the template, but mirror/read paths must still match
        // reality: HoM / HoCS are org-wide leads for their lane — they need the full dept roster
        // on every branch (not only when `user_permissions` happens to include the teams codes).
        const deptHeadVisibilityIds = new Set<string>();
        let useDeptHeadVisibility = false;
        if (hasMarketingTeamsPermission) {
          useDeptHeadVisibility = true;
          deptHeadVisibilityIds.add(ctx.user.id);
          for (const m of members) {
            if (m.department === 'MARKETING') deptHeadVisibilityIds.add(m.userId);
          }
        }
        if (hasCSTeamsPermission || isHeadOfCsRole) {
          useDeptHeadVisibility = true;
          deptHeadVisibilityIds.add(ctx.user.id);
          for (const m of members) {
            if (m.department === 'CS') deptHeadVisibilityIds.add(m.userId);
          }
        }

        if (useDeptHeadVisibility) {
          visibleMembers = members.filter((m) => deptHeadVisibilityIds.has(m.userId));
        } else if (isBranchSupervisor) {
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
        // Branch overview — count every order this branch touches, whether it
        // ran the campaign (marketing branch) or works it (servicing branch).
        // Migration 0150 split these into two columns.
        .where(
          or(
            eq(schema.orders.branchId, input.branchId),
            eq(schema.orders.servicingBranchId, input.branchId),
          ),
        )
        .groupBy(schema.orders.status);

      let totalOrders = 0;
      let deliveredOrders = 0;
      let activeOrders = 0;
      for (const row of orderStatRows) {
        const c = Number(row.orderCount);
        totalOrders += c;
        // REMITTED is post-delivery — same physical delivery, count it too.
        if (row.status === 'DELIVERED' || row.status === 'REMITTED') deliveredOrders += c;
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
        isSuperAdmin || hasBranchManagePermission || hasCSTeamsPermission || isHeadOfCsRole;
      const canManageMarketingTeams =
        isSuperAdmin ||
        hasBranchManagePermission ||
        hasMarketingTeamsPermission;

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
   * Server-backed members search for the branch detail page. Mirrors the
   * visibility rules from `branches.overview` (admin / branch-manage roles
   * see all; org-wide heads see only their dept; branch supervisors see
   * their supervised set; everyone else sees only themselves). The search
   * runs at SQL with `ILIKE %q%` against name + email so the page doesn't
   * have to ship the full roster client-side once a branch grows past a
   * few dozen members. Pagination is intentional — the panel uses
   * `MEMBERS_PAGE_SIZE = 20` and we honour that with `limit + offset`.
   */
  searchMembers: authedProcedure
    .input(
      z.object({
        branchId: z.string().uuid(),
        search: z.string().trim().max(120).optional(),
        /** Optional dept narrowing — the branch detail page calls this from
         *  inside a per-department panel and only wants matches within that
         *  bucket (e.g. searching "John" inside the Marketing tab shouldn't
         *  return CS Johns). The values mirror `BranchMemberDepartment`. */
        department: z.enum(['MARKETING', 'CS', 'OTHER']).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const teams = getBranchTeamsService();

      // ── Auth: same matrix as overview ─────────────────────────────────
      const isSuperAdmin = ctx.user.role === 'SUPER_ADMIN';
      const perms = ctx.user.permissions ?? [];
      const hasBranchManagePermission = perms.includes('branches.manage');
      const hasBranchManageUsersPermission = perms.includes('branches.manage_users');
      const hasCSTeamsPermission = perms.includes('branches.teams.cs');
      const hasMarketingTeamsPermission = perms.includes('branches.teams.marketing');
      const isHeadOfCsRole = ctx.user.role === 'HEAD_OF_CS';

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
        !isHeadOfCsRole &&
        !membership[0]
      ) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this branch' });
      }

      // ── Build the SQL with ILIKE search baked in ──────────────────────
      const trimmed = input.search?.trim() ?? '';
      // Postgres ILIKE wildcard escape: \ % and _ are special inside the
      // pattern. Escape them so a buyer named "Mary_Anne" or "%discount"
      // searches as a literal substring rather than as a wildcard.
      const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const likePattern = `%${escaped}%`;
      const conditions = [eq(schema.userBranches.branchId, input.branchId)];
      if (trimmed.length > 0) {
        conditions.push(
          sql`(${schema.users.name} ILIKE ${likePattern} OR ${schema.users.email} ILIKE ${likePattern})`,
        );
      }
      const whereClause = and(...conditions);

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
        .where(whereClause)
        .orderBy(asc(schema.users.name));

      const allMatching = memberRows
        .map((row) => {
          const effectiveRole = (row.roleInBranch ?? row.globalRole) as string;
          return {
            userId: row.userId,
            name: row.name,
            effectiveRole,
            isPrimary: row.isPrimary,
            department: departmentForBranchMemberRole(effectiveRole),
          };
        })
        .filter((m) => !input.department || m.department === input.department);

      // ── Apply the same dept-head visibility filter as overview ────────
      const canManageBranchPage =
        isSuperAdmin || hasBranchManagePermission || hasBranchManageUsersPermission;
      const isBranchSupervisor = canManageBranchPage
        ? false
        : await teams.isActorSupervisorOnBranch(ctx.user.id, input.branchId);
      let visibleMembers = allMatching;
      if (!canManageBranchPage) {
        const visibleIds = new Set<string>();
        let useDeptHeadVisibility = false;
        if (hasMarketingTeamsPermission) {
          useDeptHeadVisibility = true;
          visibleIds.add(ctx.user.id);
          for (const m of allMatching) {
            if (m.department === 'MARKETING') visibleIds.add(m.userId);
          }
        }
        if (hasCSTeamsPermission || isHeadOfCsRole) {
          useDeptHeadVisibility = true;
          visibleIds.add(ctx.user.id);
          for (const m of allMatching) {
            if (m.department === 'CS') visibleIds.add(m.userId);
          }
        }
        if (useDeptHeadVisibility) {
          visibleMembers = allMatching.filter((m) => visibleIds.has(m.userId));
        } else if (isBranchSupervisor) {
          const [supervisedCs, supervisedMarketing] = await Promise.all([
            teams.listSupervisedUserIds(ctx.user.id, input.branchId, 'CS'),
            teams.listSupervisedUserIds(ctx.user.id, input.branchId, 'MARKETING'),
          ]);
          const visibleSet = new Set([ctx.user.id, ...supervisedCs, ...supervisedMarketing]);
          visibleMembers = allMatching.filter((m) => visibleSet.has(m.userId));
        } else {
          visibleMembers = allMatching.filter((m) => m.userId === ctx.user.id);
        }
      }

      const total = visibleMembers.length;
      const start = (input.page - 1) * input.limit;
      const pageRows = visibleMembers.slice(start, start + input.limit);
      return {
        members: pageRows,
        pagination: {
          total,
          page: input.page,
          pageSize: input.limit,
          totalPages: Math.max(1, Math.ceil(total / input.limit)),
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
        groupId: z.string().uuid(),
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
            groupId: input.groupId,
            status: 'ACTIVE',
            settings: input.settings ?? null,
          })
          .returning();
        const branch = inserted[0];
        if (!branch) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Branch insert returned no row',
          });
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

      // CEO directive 2026-05-10: only Marketing, CS, Branch Admin, and HR
      // (added 2026-05-19) belong in the branching system. Block server-side
      // so a tampered request can't bypass the UI's role filter.
      const BRANCH_ELIGIBLE_ROLES = new Set([
        'MEDIA_BUYER',
        'HEAD_OF_MARKETING',
        'CS_CLOSER',
        'HEAD_OF_CS',
        'BRANCH_ADMIN',
        'HR_MANAGER',
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
        roleInBranch:
          (input.roleInBranch as (typeof schema.userBranches.$inferInsert)['roleInBranch']) ?? null,
        isPrimary: input.isPrimary ?? false,
      });
      await invalidateBranchesListCache();
      // `branchIds` is captured on the Redis session at login and never
      // refreshed live — push the new membership onto the user's active
      // sessions so it takes effect on their next request (no forced logout).
      await getSessionStore().refreshUserBranchMemberships(input.userId).catch(() => {});

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
      const branchTeams = getBranchTeamsService();

      const branchRows = await db
        .select({ name: schema.branches.name })
        .from(schema.branches)
        .where(eq(schema.branches.id, input.branchId))
        .limit(1);
      const branchName = branchRows[0]?.name ?? 'A branch';

      // Removing a user from a branch must also drop them from that branch's
      // org chart — the optional team squads (`branch_team_members`) and the
      // teamless department roster (`branch_department_members`). A user who
      // no longer belongs to the branch must not linger as a member — or a
      // stale supervisor — of any team in it. Done in one transaction so the
      // membership delete and the org-chart cleanup commit together.
      const removed = await db.transaction(async (tx) => {
        const removedRows = await tx
          .delete(schema.userBranches)
          .where(
            and(
              eq(schema.userBranches.userId, input.userId),
              eq(schema.userBranches.branchId, input.branchId),
            ),
          )
          .returning({ userId: schema.userBranches.userId });
        if (removedRows.length === 0) return removedRows;

        const teamRows = await tx
          .select({ id: schema.branchTeams.id })
          .from(schema.branchTeams)
          .where(eq(schema.branchTeams.branchId, input.branchId));
        if (teamRows.length > 0) {
          await tx
            .delete(schema.branchTeamMembers)
            .where(
              and(
                eq(schema.branchTeamMembers.userId, input.userId),
                inArray(
                  schema.branchTeamMembers.teamId,
                  teamRows.map((t) => t.id),
                ),
              ),
            );
        }
        const deptRows = await tx
          .select({ id: schema.branchDepartments.id })
          .from(schema.branchDepartments)
          .where(eq(schema.branchDepartments.branchId, input.branchId));
        if (deptRows.length > 0) {
          await tx
            .delete(schema.branchDepartmentMembers)
            .where(
              and(
                eq(schema.branchDepartmentMembers.userId, input.userId),
                inArray(
                  schema.branchDepartmentMembers.branchDepartmentId,
                  deptRows.map((d) => d.id),
                ),
              ),
            );
        }
        return removedRows;
      });

      if (removed[0]) {
        await invalidateBranchesListCache();
        // Supervisor team rows may have been deleted — resync the flag.
        void branchTeams.syncUserSupervisorFlag(input.userId).catch(() => {});
        // `branchIds` / `currentBranchId` are captured on the Redis session at
        // login and never refreshed live. Push the removal onto the user's
        // active sessions so access is revoked on their next request (their
        // `currentBranchId` is reconciled if it was the removed branch) —
        // this is the "still has access after removal" fix, no forced logout.
        await getSessionStore().refreshUserBranchMemberships(input.userId).catch(() => {});
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
        permissions: ctx.user.permissions ?? [],
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

  /**
   * Boolean check: does the caller supervise the given user on any branch
   * team? Used by `/hr/users/:id` so a Marketing- / CS-team supervisor can
   * open their squad-mates' profile cards without holding the full
   * `users.staff.*` permission family (CEO directive 2026-05-11). The
   * supervisor relationship lives in `branch_team_members.is_supervisor` and
   * isn't reflected in any role enum, so a dedicated query is needed.
   */
  amISupervisorOfUser: authedProcedure
    .input(z.object({ superviseeId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      if (ctx.user.id === input.superviseeId) return false;
      return getBranchTeamsService().isSupervisorOfUserAnywhere(
        ctx.user.id,
        input.superviseeId,
      );
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
      return getBranchTeamsService().createTeam(
        input.branchId,
        input.department,
        input.name,
        ctx.user,
      );
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
      // Supervisor of this team can rename it; deletion stays Head-only.
      await assertCanManageTeamOrSupervisor(ctx.user, input.teamId, dept);
      return getBranchTeamsService().updateTeam(input.teamId, { name: input.name }, ctx.user);
    }),

  deleteBranchTeam: authedProcedure
    .input(z.object({ teamId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      assertCanManageTeamDept(ctx.user, dept);
      await getBranchTeamsService().deleteTeam(input.teamId, ctx.user);
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
      await assertCanManageTeamOrSupervisor(ctx.user, input.teamId, dept);
      // Promotion to supervisor stays Head-only — supervisors can't crown a
      // successor or hand off privilege via the add-member path.
      if (input.isSupervisor) {
        assertCanManageTeamDept(ctx.user, dept);
      }
      await getBranchTeamsService().addTeamMember(
        input.teamId,
        input.userId,
        input.isSupervisor,
        ctx.user,
      );
      return { success: true as const };
    }),

  /**
   * Bulk add/move members into a team (CEO directive 2026-05-10) — used by
   * the Members tab's multi-select toolbar. Members already on a sibling team
   * in the same dept are moved (not duplicated). Returns counts so the UI can
   * show "added 3 / moved 2".
   */
  addBranchTeamMembersBulk: authedProcedure
    .input(
      z.object({
        teamId: z.string().uuid(),
        userIds: z.array(z.string().uuid()).min(1).max(200),
        isSupervisor: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      await assertCanManageTeamOrSupervisor(ctx.user, input.teamId, dept);
      // Bulk-promotion to supervisor stays Head-only (UI also routes that path
      // through a separate per-member action).
      if (input.isSupervisor) {
        assertCanManageTeamDept(ctx.user, dept);
      }
      const result = await getBranchTeamsService().addTeamMembersBulk(
        input.teamId,
        input.userIds,
        input.isSupervisor,
        ctx.user,
      );
      return { success: true as const, ...result };
    }),

  removeBranchTeamMember: authedProcedure
    .input(z.object({ teamId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dept = await loadTeamDepartment(input.teamId);
      // Supervisor can remove members from their own team. They cannot remove
      // themselves from the supervisor role via this path — that requires
      // setBranchTeamMemberSupervisor (Head-only).
      await assertCanManageTeamOrSupervisor(ctx.user, input.teamId, dept);
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

      // Notify the user that they were promoted to / removed from supervisor
      // on this team. Resolve team + branch names so the in-app card has
      // useful context ("CS · Lagos HQ") and don't block the response on
      // notification delivery — `enqueueCreate` is fire-and-forget.
      try {
        const db = getDb();
        const notifications = getBranchesNotificationsService();
        const [teamRow] = await db
          .select({
            teamName: schema.branchTeams.name,
            department: schema.branchTeams.department,
            branchId: schema.branchTeams.branchId,
            branchName: schema.branches.name,
            branchCode: schema.branches.code,
          })
          .from(schema.branchTeams)
          .innerJoin(schema.branches, eq(schema.branches.id, schema.branchTeams.branchId))
          .where(eq(schema.branchTeams.id, input.teamId))
          .limit(1);
        const teamLabel = teamRow?.teamName ?? 'a branch team';
        const branchLabel = teamRow?.branchName ?? teamRow?.branchCode ?? 'a branch';
        notifications.enqueueCreate({
          userId: input.userId,
          type: input.isSupervisor
            ? 'account:supervisor_assigned'
            : 'account:supervisor_revoked',
          title: input.isSupervisor ? 'Promoted to supervisor' : 'Supervisor role removed',
          body: input.isSupervisor
            ? `You're now supervising the ${teamLabel} team at ${branchLabel}.`
            : `You're no longer a supervisor of the ${teamLabel} team at ${branchLabel}.`,
          data: {
            teamId: input.teamId,
            branchId: teamRow?.branchId ?? null,
            department: teamRow?.department ?? null,
            isSupervisor: input.isSupervisor,
          },
        });
      } catch {
        // Notification is a nice-to-have — the supervisor change has already
        // been persisted by the time we hit this catch. Don't fail the
        // mutation if the in-app notification fan-out blows up.
      }

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
      await getBranchTeamsService().removeDepartmentMember(input.branchDepartmentId, input.userId);
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
          message:
            'This setting is locked at the system level. Ask an admin to clear the enforcement before overriding.',
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
    // View-only: flips the current-branch field in the Redis session bundle
    // so the viewer (or an admin in mirror mode) can see what the user sees
    // in branch X. No row in any business table is created/updated/deleted —
    // so the mirror-mode mutation block is intentionally bypassed.
    .meta({ viewOnlyOk: true })
    .input(z.object({ branchId: z.string().uuid().nullable() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const sessionStore = getSessionStore();

      const isAdminClass =
        ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN' || ctx.user.role === 'SUPPORT';
      const isMediaBuyer = ctx.user.role === 'MEDIA_BUYER';

      // null = "All Branches". Admin-class clears branch context org-wide; a
      // Media Buyer clears it to view ALL of their own orders across every
      // branch (ownership-scoped, so still only their data). Anyone else may
      // not run unscoped.
      if (input.branchId === null) {
        if (!isAdminClass && !isMediaBuyer) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only SuperAdmin can view all branches',
          });
        }
      } else if (isMediaBuyer) {
        // A Media Buyer may switch to any branch in their data footprint —
        // current memberships PLUS branches their own orders/campaigns are
        // attributed to. A branch they were removed from stays reachable as a
        // read-only data lens; branch-scoped mutations are blocked server-side
        // (see `blockMediaBuyerMutationsOutsideMemberBranch` in trpc.ts).
        const scopeIds = await mediaBuyerBranchScopeIds(ctx.user.id);
        if (!scopeIds.includes(input.branchId)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You have no orders or campaigns in this branch',
          });
        }
      } else if (!isAdminClass) {
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

  /* ── Branch Groups (multi-company) ─────────────────────────────── */

  /** List all branch groups with their member branch count. SuperAdmin only. */
  listGroups: permissionProcedure('branches.manage')
    .query(async () => {
      const db = getDb();
      const groups = await db
        .select({
          id: schema.branchGroups.id,
          name: schema.branchGroups.name,
          createdAt: schema.branchGroups.createdAt,
        })
        .from(schema.branchGroups)
        .orderBy(asc(schema.branchGroups.createdAt));

      // Count branches per group
      const branchCounts = await db
        .select({
          groupId: schema.branches.groupId,
          count: count(),
        })
        .from(schema.branches)
        .groupBy(schema.branches.groupId);

      const countMap = new Map(branchCounts.map((r) => [r.groupId, Number(r.count)]));
      return groups.map((g) => ({
        ...g,
        branchCount: countMap.get(g.id) ?? 0,
      }));
    }),

  /** Get a single branch group with its member branches. */
  getGroup: authedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [group] = await db
        .select()
        .from(schema.branchGroups)
        .where(eq(schema.branchGroups.id, input.groupId))
        .limit(1);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Branch group not found' });

      const members = await db
        .select({
          id: schema.branches.id,
          name: schema.branches.name,
          code: schema.branches.code,
          status: schema.branches.status,
        })
        .from(schema.branches)
        .where(eq(schema.branches.groupId, input.groupId))
        .orderBy(asc(schema.branches.name));

      return { ...group, branches: members };
    }),

  /** Get detailed overview of a branch group — branches, member counts, scoped entity totals. */
  getGroupDetail: permissionProcedure('branches.manage')
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [group] = await db
        .select()
        .from(schema.branchGroups)
        .where(eq(schema.branchGroups.id, input.groupId))
        .limit(1);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Company group not found' });

      // Branches in this group
      const branchRows = await db
        .select({
          id: schema.branches.id,
          name: schema.branches.name,
          code: schema.branches.code,
          status: schema.branches.status,
          createdAt: schema.branches.createdAt,
        })
        .from(schema.branches)
        .where(eq(schema.branches.groupId, input.groupId))
        .orderBy(asc(schema.branches.name));

      const branchIds = branchRows.map((b) => b.id);

      // Parallel aggregate queries
      const [memberCountRows, productCount, commissionPlanCount, settlementConfigCount] =
        await Promise.all([
          // Members per branch
          branchIds.length > 0
            ? db
                .select({ branchId: schema.userBranches.branchId, count: count() })
                .from(schema.userBranches)
                .where(inArray(schema.userBranches.branchId, branchIds))
                .groupBy(schema.userBranches.branchId)
            : Promise.resolve([]),
          // Products scoped to this group
          db
            .select({ count: count() })
            .from(schema.products)
            .where(eq(schema.products.groupId, input.groupId))
            .then((r) => Number(r[0]?.count ?? 0)),
          // Commission plans scoped to this group
          db
            .select({ count: count() })
            .from(schema.commissionPlans)
            .where(eq(schema.commissionPlans.groupId, input.groupId))
            .then((r) => Number(r[0]?.count ?? 0)),
          // Settlement configs scoped to this group
          db
            .select({ count: count() })
            .from(schema.settlementConfigs)
            .where(eq(schema.settlementConfigs.groupId, input.groupId))
            .then((r) => Number(r[0]?.count ?? 0)),
        ]);

      const memberCountMap = new Map(memberCountRows.map((r) => [r.branchId, Number(r.count)]));
      const totalMembers = memberCountRows.reduce((sum, r) => sum + Number(r.count), 0);

      const branches = branchRows.map((b) => ({
        ...b,
        memberCount: memberCountMap.get(b.id) ?? 0,
      }));

      return {
        ...group,
        branches,
        totals: {
          branches: branchRows.length,
          members: totalMembers,
          products: productCount,
          commissionPlans: commissionPlanCount,
          settlementConfigs: settlementConfigCount,
        },
      };
    }),

  /** Create a new branch group. SuperAdmin only. */
  createGroup: permissionProcedure('branches.manage')
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [created] = await db
        .insert(schema.branchGroups)
        .values({ name: input.name.trim() })
        .returning();
      await invalidateBranchesListCache();
      return created;
    }),

  /** Update a branch group name. SuperAdmin only. */
  updateGroup: permissionProcedure('branches.manage')
    .input(z.object({ groupId: z.string().uuid(), name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [updated] = await db
        .update(schema.branchGroups)
        .set({ name: input.name.trim(), updatedAt: new Date() })
        .where(eq(schema.branchGroups.id, input.groupId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Branch group not found' });
      await invalidateBranchesListCache();
      return updated;
    }),

  /** Move a branch to a different group. SuperAdmin only. */
  assignBranchToGroup: permissionProcedure('branches.manage')
    .input(z.object({ branchId: z.string().uuid(), groupId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // Verify group exists
      const [group] = await db
        .select({ id: schema.branchGroups.id })
        .from(schema.branchGroups)
        .where(eq(schema.branchGroups.id, input.groupId))
        .limit(1);
      if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Branch group not found' });

      const [updated] = await db
        .update(schema.branches)
        .set({ groupId: input.groupId, updatedAt: new Date() })
        .where(eq(schema.branches.id, input.branchId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Branch not found' });
      await invalidateBranchesListCache();
      return updated;
    }),

  // ── Department Deactivation ──────────────────────────────────────

  preflightDeactivateDepartment: permissionProcedure('branches.manage')
    .input(z.object({ branchDepartmentId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getBranchTeamsService().preflightDeactivateDepartment(input.branchDepartmentId);
    }),

  deactivateDepartment: permissionProcedure('branches.manage')
    .input(z.object({ branchDepartmentId: z.string().uuid(), targetBranchId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getBranchTeamsService().deactivateDepartment(input.branchDepartmentId, input.targetBranchId, ctx.user);
    }),

  reactivateDepartment: permissionProcedure('branches.manage')
    .input(z.object({ branchDepartmentId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getBranchTeamsService().reactivateDepartment(input.branchDepartmentId, ctx.user);
    }),
});
