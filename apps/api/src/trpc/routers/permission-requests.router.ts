import { z } from 'zod';
import { router, authedProcedure } from '../trpc';
import type { PermissionRequestsService } from '../../permission-requests/permission-requests.service';

let permissionRequestsServiceInstance: PermissionRequestsService | null = null;

export function setPermissionRequestsService(service: PermissionRequestsService) {
  permissionRequestsServiceInstance = service;
}

function getService(): PermissionRequestsService {
  if (!permissionRequestsServiceInstance) {
    throw new Error('PermissionRequestsService not initialized.');
  }
  return permissionRequestsServiceInstance;
}

/**
 * Permission requests router.
 * listPending / list: viewer-scoped server-side — admin-class sees everything; approvers
 *   see types they can approve; everyone else only sees rows they personally submitted.
 *   Stops a CS Agent / Media Buyer with the URL from reading every HR user-creation
 *   draft, order-deletion reason, etc.
 * approve/reject: authedProcedure — service enforces per-type gates (audit.read / SuperAdmin / order price approvers).
 */
export const permissionRequestsRouter = router({
  listPending: authedProcedure
    .query(async ({ ctx }) => {
      return getService().listPending(ctx.user);
    }),

  list: authedProcedure
    .input(
      z
        .object({
          status: z.enum(['ALL', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return getService().list({ status: input?.status }, ctx.user);
    }),

  approve: authedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        reason: z.string().min(10, 'Reason must be at least 10 characters'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getService().approve(input.requestId, ctx.user, input.reason);
    }),

  reject: authedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        reason: z.string().min(10, 'Reason must be at least 10 characters'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getService().reject(input.requestId, ctx.user, input.reason);
    }),
});
