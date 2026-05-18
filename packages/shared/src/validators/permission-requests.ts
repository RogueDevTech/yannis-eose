import { z } from 'zod';

export const permissionRequestTypeSchema = z.enum([
  'USER_CREATION',
  'ROLE_CHANGE',
  'PERMISSION_GRANT',
  'PRODUCT_ARCHIVE',
  'ORDER_LINE_PRICE_CHANGE',
  'ORDER_DELETION',
]);

export type PermissionRequestType = z.infer<typeof permissionRequestTypeSchema>;

export const createPermissionRequestSchema = z.object({
  type: permissionRequestTypeSchema,
  targetUserId: z.string().uuid().optional(),
  requestedRole: z.string().optional(),
  permissionCode: z.string().optional(),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
  payload: z.record(z.unknown()).optional(),
});

export type CreatePermissionRequestInput = z.infer<typeof createPermissionRequestSchema>;

export const processPermissionRequestSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().min(5, 'Reason must be at least 5 characters'),
});

export type ProcessPermissionRequestInput = z.infer<typeof processPermissionRequestSchema>;
