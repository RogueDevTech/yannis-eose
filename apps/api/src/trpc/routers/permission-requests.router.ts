import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
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
 * listPending: SuperAdmin only (audit.read implies super admin access to approval queues)
 * approve/reject: SuperAdmin only (same)
 */
export const permissionRequestsRouter = router({
  listPending: permissionProcedure('audit.read')
    .query(async () => {
      return getService().listPending();
    }),

  approve: permissionProcedure('audit.read')
    .input(
      z.object({
        requestId: z.string().uuid(),
        reason: z.string().min(10, 'Reason must be at least 10 characters'),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return getService().approve(input.requestId, ctx.user, input.reason);
    }),

  reject: permissionProcedure('audit.read')
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
