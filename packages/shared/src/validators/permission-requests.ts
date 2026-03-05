import { z } from 'zod';

export const permissionRequestTypeSchema = z.enum([
  'USER_CREATION',
  'ROLE_CHANGE',
  'PERMISSION_GRANT',
]);

export type PermissionRequestType = z.infer<typeof permissionRequestTypeSchema>;

export const createPermissionRequestSchema = z.object({
  type: permissionRequestTypeSchema,
  targetUserId: z.string().uuid().optional(),
  requestedRole: z.string().optional(),
  permissionCode: z.string().optional(),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
  payload: z.record(z.unknown()).optional(),
});

export type CreatePermissionRequestInput = z.infer<typeof createPermissionRequestSchema>;

export const processPermissionRequestSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export type ProcessPermissionRequestInput = z.infer<typeof processPermissionRequestSchema>;
