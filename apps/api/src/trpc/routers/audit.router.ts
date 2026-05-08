import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpc';
import type { AuditService } from '../../audit/audit.service';
import { canAccessGlobalAuditLog, shouldScopeGlobalAuditToBranch } from '../../common/authz';
import { CacheService } from '../../common/cache/cache.service';

// Factory pattern — same as all other routers
let auditServiceInstance: AuditService | null = null;
let auditCacheService: CacheService | null = null;

export function setAuditService(service: AuditService) {
  auditServiceInstance = service;
}

export function setAuditCacheService(service: CacheService) {
  auditCacheService = service;
}

function getAuditService(): AuditService {
  if (!auditServiceInstance) {
    throw new Error('AuditService not initialized. Call setAuditService() first.');
  }
  return auditServiceInstance;
}

/**
 * Cache TTL for the actor filter dropdown. The dropdown lists active staff
 * names — adding/deactivating staff is rare during a session, so 5 minutes
 * of staleness is acceptable. The cache key is keyed by scope (org-wide vs
 * branch-scoped) so admins and scoped viewers don't share entries.
 */
const ACTOR_FILTER_TTL_SECONDS = 300;

/**
 * Audit router — `recordHistory` / `timeTravel` stay authed-only (record-scoped by domain loaders).
 * Global log + mirror list require `audit.read` or admin/finance (see `canAccessGlobalAuditLog`).
 * Column-level security: `stripFinanceFields` on `authedProcedure` strips cost/margin in payloads.
 */
export const auditRouter = router({
  /**
   * Get all history versions of a specific record in a table.
   */
  recordHistory: authedProcedure
    .input(
      z.object({
        tableName: z.string(),
        recordId: z.string().uuid(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input }) => {
      return getAuditService().getRecordHistory(
        input.tableName,
        input.recordId,
        input.page,
        input.limit,
      );
    }),

  /**
   * Global audit log — query across all or a specific history table.
   */
  globalLog: authedProcedure
    .input(
      z.object({
        tableName: z.string().optional(),
        actorId: z.string().uuid().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ input, ctx }) => {
      const u = ctx.user;
      if (!canAccessGlobalAuditLog(u)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view the global audit log.' });
      }
      return getAuditService().getGlobalAuditLog(input, {
        role: u.role,
        permissions: u.permissions,
        currentBranchId: u.currentBranchId,
      });
    }),

  /**
   * Time travel — view the state of a record at a specific point in time.
   */
  timeTravel: authedProcedure
    .input(
      z.object({
        tableName: z.string(),
        recordId: z.string().uuid(),
        asOf: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return getAuditService().timeTravel(
        input.tableName,
        input.recordId,
        input.asOf,
      );
    }),

  /**
   * Get list of auditable table names (for UI dropdown).
   */
  tables: authedProcedure
    .query(async ({ ctx }) => {
      const u = ctx.user;
      if (!canAccessGlobalAuditLog(u)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view the global audit log.' });
      }
      return getAuditService().getAuditableTables({
        role: u.role,
        permissions: u.permissions,
        currentBranchId: u.currentBranchId,
      });
    }),

  /**
   * Resolve user IDs to names+roles for human-friendly audit display.
   */
  actorNames: authedProcedure
    .input(z.object({ userIds: z.array(z.string().uuid()) }))
    .query(async ({ input }) => {
      return getAuditService().getUserNameMap(input.userIds);
    }),

  /**
   * Logistics location labels for warehouse transfer audit rows (`from_location_id`, `to_location_id`).
   */
  locationNames: authedProcedure
    .input(z.object({ locationIds: z.array(z.string().uuid()).max(400) }))
    .query(async ({ input, ctx }) => {
      const u = ctx.user;
      if (!canAccessGlobalAuditLog(u)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to resolve audit labels.' });
      }
      return getAuditService().getLocationNameMap(input.locationIds);
    }),

  /**
   * Staff picker for `/admin/analytics/audit` actor filter — org/branch scope matches `globalLog`.
   *
   * Cached for 5 minutes keyed by (scope, branchId): the dropdown lists every active staff
   * member visible to the viewer, which is the same for everyone with the same scope flags
   * and branch. Adding / deactivating staff is rare and a 5-minute lag on the dropdown is
   * acceptable — the underlying audit log itself is not cached, only the filter source.
   */
  actorFilterOptions: authedProcedure.query(async ({ ctx }) => {
    const u = ctx.user;
    if (!canAccessGlobalAuditLog(u)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to load audit filters.' });
    }
    const fetch = () =>
      getAuditService().listActorFilterOptions({
        role: u.role,
        permissions: u.permissions,
        currentBranchId: u.currentBranchId,
      });
    if (!auditCacheService) return fetch();
    const scopeToBranch = shouldScopeGlobalAuditToBranch(u);
    const branchPart =
      scopeToBranch && u.currentBranchId ? `branch:${u.currentBranchId}` : 'global';
    const key = `cache:audit:actorFilter:${branchPart}`;
    return auditCacheService.getOrSet(key, ACTOR_FILTER_TTL_SECONDS, fetch);
  }),

  /**
   * Mirror Mode session log — separate from temporal audit because mirror sessions are
   * append-only (not row-versioned). Anyone with audit access can see who mirrored whom.
   */
  mirrorSessions: authedProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        actorId: z.string().uuid().optional(),
        targetId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const u = ctx.user;
      if (!canAccessGlobalAuditLog(u)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view mirror session audit.' });
      }
      return getAuditService().getMirrorSessions(input, {
        role: u.role,
        permissions: u.permissions,
        currentBranchId: u.currentBranchId,
      });
    }),
});
