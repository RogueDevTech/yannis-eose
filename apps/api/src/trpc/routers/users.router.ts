import { z } from 'zod';
import { router, authedProcedure, permissionProcedure } from '../trpc';
import {
  createStaffSchema,
  updateStaffSchema,
  listUsersSchema,
  searchUsersForPushTargetSchema,
  resetPasswordSchema,
  processEmailChangeSchema,
  updateMyAppThemeSchema,
  updateMyFontScaleSchema,
  updateMyNotificationPreferencesSchema,
  getRelevantNotificationTypesForRole,
  NOTIFICATION_TYPE_META,
  MANDATORY_EMAIL_TYPES,
  setProbationSchema,
  extendProbationSchema,
  markProbationPermanentSchema,
  terminateProbationSchema,
} from '@yannis/shared';
import type { UsersService } from '../../users/users.service';
import type { SessionStoreService } from '../../auth/session-store.service';
import { CacheService } from '../../common/cache/cache.service';

/**
 * Factory pattern: NestJS injects the service, tRPC router consumes it.
 * This bridges NestJS DI with tRPC's static router definitions.
 */
let usersServiceInstance: UsersService | null = null;
let sessionStoreInstance: SessionStoreService | null = null;
let usersCacheService: CacheService | null = null;

export function setUsersService(service: UsersService) {
  usersServiceInstance = service;
}

export function setUsersSessionStore(store: SessionStoreService) {
  sessionStoreInstance = store;
}

export function setUsersCacheService(service: CacheService) {
  usersCacheService = service;
}

async function invalidatePermissionsUserMatrixCache(): Promise<void> {
  if (!usersCacheService) return;
  await usersCacheService.delPattern('cache:permissions:userMatrix:*').catch(() => {});
}

/** Exported for cross-router lookups (e.g. HR payout preview access gate). */
export function getUsersService(): UsersService {
  if (!usersServiceInstance) {
    throw new Error('UsersService not initialized. Call setUsersService() first.');
  }
  return usersServiceInstance;
}

function getSessionStore(): SessionStoreService {
  if (!sessionStoreInstance) {
    throw new Error('Users SessionStore not initialized. Call setUsersSessionStore() first.');
  }
  return sessionStoreInstance;
}

export const usersRouter = router({
  /**
   * List all users with filtering and pagination.
   * Accessible to SuperAdmin + department heads.
   */
  list: permissionProcedure('users.read')
    .input(listUsersSchema)
    .query(async ({ input, ctx }) => {
      return getUsersService().list(input, ctx.user, ctx.currentBranchId);
    }),

  /**
   * Search active users by name/email for push broadcast "one user" picker.
   * Also allowed for users.read (e.g. global search) without notifications.broadcast.
   */
  searchForPushTarget: permissionProcedure('notifications.broadcast', 'users.read')
    .input(searchUsersForPushTargetSchema)
    .query(async ({ input }) => {
      const users = await getUsersService().searchForPushTarget(input.q, input.limit, input.offset);
      return { users };
    }),

  /**
   * List CS team (HEAD_OF_CS + CS_AGENT) for Team page. Gated by cs.teamOverview.
   */
  listCSTeam: permissionProcedure('cs.teamOverview').query(async () => {
    return getUsersService().listCSTeam();
  }),

  /**
   * List active HEAD_OF_* users (with their primary branch) so the user
   * create/edit forms can warn about duplicate heads per branch.
   */
  listActiveHeads: permissionProcedure('users.read', 'users.create', 'users.update').query(async () => {
    return getUsersService().listActiveHeads();
  }),

  /**
   * Get a single user by ID.
   */
  getById: authedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getUsersService().getById(input.userId, ctx.user);
    }),

  /**
   * Save appearance theme for the current user. `null` = follow org default.
   * Updates Redis session so the next request sees the new preference.
   */
  updateMyAppTheme: authedProcedure
    .input(updateMyAppThemeSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await getUsersService().updateMyAppTheme(input.appTheme, ctx.user);
      const sessionToken = ctx.sessionToken ?? undefined;
      if (sessionToken) {
        const store = getSessionStore();
        const current = await store.getSession(sessionToken);
        if (current) {
          const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
          await store.updateSession(
            sessionToken,
            { ...current, appTheme: result.appTheme },
            ttl,
          );
        }
      }
      return result;
    }),

  /**
   * Save font scale for the current user. `null` = reset to base.
   * Updates Redis session so the next request sees the new preference.
   */
  updateMyFontScale: authedProcedure
    .input(updateMyFontScaleSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await getUsersService().updateMyFontScale(input.fontScale, ctx.user);
      const sessionToken = ctx.sessionToken ?? undefined;
      if (sessionToken) {
        const store = getSessionStore();
        const current = await store.getSession(sessionToken);
        if (current) {
          const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
          await store.updateSession(
            sessionToken,
            { ...current, fontScale: result.fontScale },
            ttl,
          );
        }
      }
      return result;
    }),

  /**
   * Get the calling user's notification preferences along with the catalog of types
   * relevant to their role (used to render the Settings → Notifications toggles).
   * Mandatory types are filtered OUT — they cannot be toggled.
   */
  getMyNotificationPreferences: authedProcedure.query(async ({ ctx }) => {
    const prefs = await getUsersService().getMyNotificationPreferences(ctx.user.id);
    const relevantTypes = getRelevantNotificationTypesForRole(ctx.user.role);
    const mandatory = new Set<string>(MANDATORY_EMAIL_TYPES);
    const items = relevantTypes
      .filter((t) => !mandatory.has(t))
      .map((t) => {
        const meta = NOTIFICATION_TYPE_META[t];
        const explicit = prefs[t];
        return {
          type: t,
          label: meta.label,
          description: meta.description,
          category: meta.category,
          enabled: explicit !== false, // default ON unless explicitly disabled
        };
      });
    return { items, preferences: prefs };
  }),

  /**
   * Save the calling user's notification preferences. Map of type → enabled.
   * Only `false` entries actually change behavior (they opt the user out); the
   * notifications service treats missing keys as enabled.
   */
  updateMyNotificationPreferences: authedProcedure
    .input(updateMyNotificationPreferencesSchema)
    .mutation(async ({ input, ctx }) => {
      return getUsersService().updateMyNotificationPreferences(input.preferences, ctx.user);
    }),

  /**
   * Self-edit on Settings → Account: update the caller's own display name.
   * Mirrors the cached session so the new name shows up immediately in the header.
   */
  updateMyProfile: authedProcedure
    .input(z.object({ name: z.string().min(2, 'Name must be at least 2 characters').max(120) }))
    .mutation(async ({ input, ctx }) => {
      const result = await getUsersService().updateMyProfile(input, ctx.user);
      const sessionToken = ctx.sessionToken ?? undefined;
      if (sessionToken) {
        const store = getSessionStore();
        const current = await store.getSession(sessionToken);
        if (current) {
          const ttl = parseInt(process.env['SESSION_TTL_SECONDS'] ?? '86400', 10);
          await store.updateSession(sessionToken, { ...current, name: result.name }, ttl);
        }
      }
      return result;
    }),

  /**
   * Self-edit on Settings → Security: change the caller's own password.
   * Verifies current password server-side; the service writes the new hash through `withActor`
   * so the audit trail captures who changed it.
   */
  changeMyPassword: authedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1, 'Current password is required'),
        newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getUsersService().changeMyPassword(input, ctx.user);
    }),

  /**
   * Create a new staff member (SuperAdmin only).
   */
  create: permissionProcedure('users.create')
    .meta({ branchScopedMutation: true })
    .input(z.intersection(createStaffSchema, z.object({ branchId: z.string().uuid().optional() })))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...createInput } = input;
      const res = await getUsersService().createStaff(createInput, ctx.user);
      await invalidatePermissionsUserMatrixCache();
      return res;
    }),

  /**
   * Update a staff member's details.
   *
   * Gate widened so HoCS / HoM can make a narrow, scoped edit on their direct
   * reports (capacity / productIds / visibleOrderStatuses — the "how they work"
   * fields). UsersService.update enforces both the target-role + same-branch
   * scope AND the field-level whitelist. Admin-level callers still go through
   * the full admin path unchanged.
   */
  update: permissionProcedure('users.update', 'cs.teamOverview', 'marketing.teamOverview')
    .meta({ branchScopedMutation: true })
    .input(updateStaffSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...updateInput } = input;
      const res = await getUsersService().update(updateInput, ctx.user);
      await invalidatePermissionsUserMatrixCache();
      return res;
    }),

  /**
   * Re-stamp the user's permission snapshot from the current template baseline.
   *
   * Use case: a user was created during a window when `role_template_permissions`
   * was empty (or before the snapshot model was wired up), so their
   * `user_permissions` table is empty and every permission check fails. This
   * mutation re-reads the current template baseline + any existing per-user
   * overrides and stamps fresh rows. Idempotent — safe to call repeatedly.
   *
   * Gated to staff-admin (`users.staff.update`) — same audience that can edit
   * permissions through the matrix. Honoured by SUPER_ADMIN bypass.
   */
  restampPermissions: permissionProcedure('users.staff.update', 'rbac.templates.manage')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const res = await getUsersService().restampPermissions(input.userId, ctx.user);
      await invalidatePermissionsUserMatrixCache();
      return res;
    }),

  /**
   * Deactivate a staff member (SuperAdmin only).
   * Kills all their active sessions immediately.
   */
  deactivate: permissionProcedure('users.deactivate')
    .meta({ branchScopedMutation: true })
    .input(z.object({ userId: z.string().uuid(), branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      return getUsersService().deactivate(input.userId, ctx.user);
    }),

  /**
   * Reset a user's password (SuperAdmin only).
   * Forces them to re-login with the new password.
   */
  resetPassword: permissionProcedure('users.deactivate')
    .meta({ branchScopedMutation: true })
    .input(resetPasswordSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...resetInput } = input;
      return getUsersService().resetPassword(resetInput, ctx.user);
    }),

  /**
   * Get pending email change request for a user (SuperAdmin only).
   */
  getPendingEmailChange: permissionProcedure('users.update')
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getUsersService().getPendingEmailChangeForUser(input.userId);
    }),

  /**
   * Approve or reject an email change request (SuperAdmin only).
   */
  processEmailChange: permissionProcedure('users.update')
    .meta({ branchScopedMutation: true })
    .input(processEmailChangeSchema.extend({ branchId: z.string().uuid().optional() }))
    .mutation(async ({ input, ctx }) => {
      const { branchId: _branchId, ...processInput } = input;
      return getUsersService().processEmailChange(processInput, ctx.user);
    }),

  /**
   * Resend invite email for a PENDING user with fresh credentials.
   */
  resendInvite: permissionProcedure('users.create')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getUsersService().resendInvite(input.userId, ctx.user);
    }),

  // ─── Probation ────────────────────────────────────────────────
  // Authority is HR_MANAGER + SUPER_ADMIN only — gated in the service layer
  // (NOT in `permissionProcedure`) so HR doesn't need any extra permission code.
  // ADMIN intentionally cannot manage probation (CEO directive 2026-05-08).

  /**
   * Live blockers snapshot for the Terminate Probation modal: open orders,
   * scheduled callbacks, unpaid payouts. UI disables "Terminate" until
   * `canTerminate` is true.
   */
  getTerminationBlockers: authedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return getUsersService().getTerminationBlockers(input.userId, ctx.user);
    }),

  /** Place an existing user on probation. */
  setProbation: authedProcedure
    .input(setProbationSchema)
    .mutation(async ({ input, ctx }) => {
      const res = await getUsersService().setProbation(input, ctx.user);
      await invalidatePermissionsUserMatrixCache();
      return res;
    }),

  /** Move the probation review date. */
  extendProbation: authedProcedure
    .input(extendProbationSchema)
    .mutation(async ({ input, ctx }) => {
      return getUsersService().extendProbation(input, ctx.user);
    }),

  /** Graduate the user off probation — they become a permanent staff member. */
  markProbationPermanent: authedProcedure
    .input(markProbationPermanentSchema)
    .mutation(async ({ input, ctx }) => {
      const res = await getUsersService().markProbationPermanent(input, ctx.user);
      await invalidatePermissionsUserMatrixCache();
      return res;
    }),

  /** Terminate the user — scrubs PII (live + history) and kills sessions. Permanent. */
  terminateProbation: authedProcedure
    .input(terminateProbationSchema)
    .mutation(async ({ input, ctx }) => {
      const res = await getUsersService().terminateProbation(input, ctx.user);
      await invalidatePermissionsUserMatrixCache();
      return res;
    }),
});
