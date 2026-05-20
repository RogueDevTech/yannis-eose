import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, count, asc, sql } from 'drizzle-orm';
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
 * Inline branch list for cross-router bundles. Mirrors `branches.list` (admin
 * sees all, others see their memberships only) and reuses the same Redis cache.
 * Exported so `*PageBundle` procedures can avoid a second HTTP round-trip.
 */
export async function listBranchesForUser(user: {
  id: string;
  role: string;
}): Promise<Array<{ id: string; name: string; code?: string }>> {
  const db = getDb();
  // Org-wide roles see every branch even without explicit branch memberships:
  // SuperAdmin / Admin manage anything; HR creates / edits staff across the
  // org; Finance reconciles every branch; Head of Logistics and Head of CS
  // keep cross-branch visibility. Head of Marketing is intentionally excluded:
  // branch assignments define the branches they can switch between.
  const SEES_ALL_BRANCHES_ROLES = new Set([
    'SUPER_ADMIN',
    'ADMIN',
    'HR_MANAGER',
    'FINANCE_OFFICER',
    'HEAD_OF_LOGISTICS',
    'HEAD_OF_CS',
  ]);
  const seesAll = SEES_ALL_BRANCHES_ROLES.has(user.role);

  const fetchRows = async (): Promise<Array<{ id: string; name: string; code?: string }>> => {
    if (seesAll) {
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

      // null = "All Branches" — only SuperAdmin may clear branch context
      if (input.branchId === null) {
        if (ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN') {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only SuperAdmin can view all branches',
          });
        }
      } else if (ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN') {
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
