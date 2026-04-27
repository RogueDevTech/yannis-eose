import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, count } from 'drizzle-orm';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import { db as schema } from '@yannis/shared';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SessionStoreService } from '../../auth/session-store.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { BranchTeamsService } from '../../branches/branch-teams.service';
import { canMirror } from '../../common/authz';

// Service instances injected via factory pattern
let drizzleInstance: PostgresJsDatabase<typeof schema> | null = null;
let sessionStoreInstance: SessionStoreService | null = null;
let notificationsServiceInstance: NotificationsService | null = null;
let branchTeamsServiceInstance: BranchTeamsService | null = null;

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

const CS_OVERVIEW_ROLES = new Set(['CS_AGENT', 'HEAD_OF_CS']);
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
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
]);

export const branchesRouter = router({
  /**
   * List all branches (SuperAdmin) or branches the current user belongs to.
   */
  list: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    if ((ctx.user.role === 'SUPER_ADMIN' || ctx.user.role === 'ADMIN')) {
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
        branchIds.length === 1 ? eq(schema.branches.id, branchIds[0]!)         : inArray(schema.branches.id, branchIds),
      );
  }),

  /**
   * Branch overview: flat `members` (+ department bucket), order pipeline counts, campaigns, message templates.
   */
  overview: permissionProcedure('branches.manage')
    .input(z.object({ branchId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const db = getDb();

      if ((ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'ADMIN')) {
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

      return {
        branch,
        counts: {
          totalMembers: members.length,
          totalOrders,
          deliveredOrders,
          activeOrders,
          campaigns: Number(campaignsRow?.c ?? 0),
          messageTemplates: Number(templatesRow?.c ?? 0),
        },
        members,
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
      const rows = await db
        .insert(schema.branches)
        .values({
          name: input.name,
          code: input.code,
          status: 'ACTIVE',
          settings: input.settings ?? null,
        })
        .returning();
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
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        settings: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const updateFields: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updateFields.name = input.name;
      if (input.status) updateFields.status = input.status;
      if (input.settings !== undefined) updateFields.settings = input.settings;
      const rows = await db
        .update(schema.branches)
        .set(updateFields)
        .where(eq(schema.branches.id, input.branchId))
        .returning();
      return rows[0];
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

  listTeamsWithMembers: permissionProcedure('branches.manage')
    .input(z.object({ branchId: z.string().uuid() }))
    .query(async ({ input }) => getBranchTeamsService().listTeamsWithMembers(input.branchId)),

  createBranchTeam: permissionProcedure('branches.manage')
    .input(
      z.object({
        branchId: z.string().uuid(),
        department: z.enum(['CS', 'MARKETING']),
        name: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      getBranchTeamsService().createTeam(input.branchId, input.department, input.name, ctx.user),
    ),

  updateBranchTeam: permissionProcedure('branches.manage')
    .input(
      z.object({
        teamId: z.string().uuid(),
        name: z.string().max(120).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => getBranchTeamsService().updateTeam(input.teamId, { name: input.name })),

  deleteBranchTeam: permissionProcedure('branches.manage')
    .input(z.object({ teamId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await getBranchTeamsService().deleteTeam(input.teamId);
      return { success: true as const };
    }),

  addBranchTeamMember: permissionProcedure('branches.manage')
    .input(
      z.object({
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
        isSupervisor: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await getBranchTeamsService().addTeamMember(
        input.teamId,
        input.userId,
        input.isSupervisor,
        ctx.user,
      );
      return { success: true as const };
    }),

  removeBranchTeamMember: permissionProcedure('branches.manage')
    .input(z.object({ teamId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await getBranchTeamsService().removeTeamMember(input.teamId, input.userId);
      return { success: true as const };
    }),

  setBranchTeamMemberSupervisor: permissionProcedure('branches.manage')
    .input(
      z.object({
        teamId: z.string().uuid(),
        userId: z.string().uuid(),
        isSupervisor: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      await getBranchTeamsService().setMemberSupervisor(
        input.teamId,
        input.userId,
        input.isSupervisor,
      );
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
