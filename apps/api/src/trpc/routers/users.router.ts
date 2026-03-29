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
} from '@yannis/shared';
import type { UsersService } from '../../users/users.service';
import type { SessionStoreService } from '../../auth/session-store.service';

/**
 * Factory pattern: NestJS injects the service, tRPC router consumes it.
 * This bridges NestJS DI with tRPC's static router definitions.
 */
let usersServiceInstance: UsersService | null = null;
let sessionStoreInstance: SessionStoreService | null = null;

export function setUsersService(service: UsersService) {
  usersServiceInstance = service;
}

export function setUsersSessionStore(store: SessionStoreService) {
  sessionStoreInstance = store;
}

function getUsersService(): UsersService {
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
    .query(async ({ input }) => {
      return getUsersService().list(input);
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
   * Get a single user by ID.
   */
  getById: authedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ input }) => {
      return getUsersService().getById(input.userId);
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
   * Create a new staff member (SuperAdmin only).
   */
  create: permissionProcedure('users.create')
    .input(createStaffSchema)
    .mutation(async ({ input, ctx }) => {
      return getUsersService().createStaff(input, ctx.user);
    }),

  /**
   * Update a staff member's details (SuperAdmin only).
   */
  update: permissionProcedure('users.update')
    .input(updateStaffSchema)
    .mutation(async ({ input, ctx }) => {
      return getUsersService().update(input, ctx.user);
    }),

  /**
   * Deactivate a staff member (SuperAdmin only).
   * Kills all their active sessions immediately.
   */
  deactivate: permissionProcedure('users.deactivate')
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      return getUsersService().deactivate(input.userId, ctx.user);
    }),

  /**
   * Reset a user's password (SuperAdmin only).
   * Forces them to re-login with the new password.
   */
  resetPassword: permissionProcedure('users.deactivate')
    .input(resetPasswordSchema)
    .mutation(async ({ input, ctx }) => {
      return getUsersService().resetPassword(input, ctx.user);
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
    .input(processEmailChangeSchema)
    .mutation(async ({ input, ctx }) => {
      return getUsersService().processEmailChange(input, ctx.user);
    }),
});
