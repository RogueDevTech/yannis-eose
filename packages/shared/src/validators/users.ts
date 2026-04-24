import { z } from 'zod';

// ============================================
// User Role Enum (matches DB enum)
// ============================================

export const userRoleSchema = z.enum([
  'SUPER_ADMIN',
  'ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  'CS_AGENT',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
]);

// ============================================
// Order Status values (for visible tabs)
// ============================================

export const visibleOrderStatusSchema = z.enum([
  'UNPROCESSED',
  'CS_ASSIGNED',
  'CS_ENGAGED',
  'CONFIRMED',
  'CANCELLED',
  'ALLOCATED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  'COMPLETED',
]);

// ============================================
// Setup — One-time SuperAdmin creation
// ============================================

export const setupSuperAdminSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type SetupSuperAdminInput = z.infer<typeof setupSuperAdminSchema>;

// ============================================
// Compensation — inline commission plan data
// ============================================

export const userCompensationSchema = z.object({
  fixedSalary: z.number().min(0).optional(),
  bonus: z.number().min(0).optional(),
  commissionType: z.enum(['FLAT', 'PERCENTAGE']).optional(),
  commissionValue: z.number().min(0).optional(),
  upsellCommissionType: z.enum(['FLAT', 'PERCENTAGE']).optional(),
  upsellCommissionValue: z.number().min(0).optional(),
  salesTargetEnabled: z.boolean().optional(),
  salesTargetPercentage: z.number().min(0).max(100).optional(),
});

export type UserCompensationInput = z.infer<typeof userCompensationSchema>;

// ============================================
// Create Staff — SuperAdmin invites a new user
// ============================================

export const createStaffSchema = z.object({
  // Account details
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  role: userRoleSchema,
  status: z.enum(['PENDING', 'ACTIVE']).default('PENDING'),

  // Role-specific settings
  capacity: z.number().int().min(1).max(100).optional(),
  logisticsLocationId: z.string().uuid().optional(),
  visibleOrderStatuses: z.array(visibleOrderStatusSchema).optional(),
  productIds: z.array(z.string().uuid()).optional(),
  restrictProductAccess: z.boolean().optional(),

  // Compensation
  commissionPlanId: z.string().uuid().optional(),
  compensation: userCompensationSchema.optional(),

  // Branch assignment
  primaryBranchId: z.string().uuid().optional(),

  /**
   * "Finance hat" — deputize this user with Finance Officer powers on top of their primary role.
   * At most one user in the org can have this set. If true at create time, the service will either
   * succeed (if no one else holds it) or reject with the name of the current holder.
   */
  isFinanceOfficer: z.boolean().optional(),

  // Contact — Nigerian phone: 0XXXXXXXXXX or +234XXXXXXXXXX
  phone: z.string().regex(
    /^(?:0[789]\d{9}|\+234[789]\d{9})$/,
    'Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567)',
  ).optional(),
}).superRefine((data, ctx) => {
  // Every non-SuperAdmin user must have a primary branch at creation time.
  if (data.role !== 'SUPER_ADMIN' && !data.primaryBranchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryBranchId'],
      message: 'Primary branch is required for non-SuperAdmin users',
    });
  }
});

export type CreateStaffInput = z.infer<typeof createStaffSchema>;

// ============================================
// Update Staff — modify user details
// ============================================

export const updateStaffSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: userRoleSchema.optional(),
  capacity: z.number().int().min(1).max(100).optional(),
  logisticsLocationId: z.string().uuid().nullable().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'DEACTIVATED', 'ARCHIVED']).optional(),
  phone: z.string().regex(
    /^(?:0[789]\d{9}|\+234[789]\d{9})$/,
    'Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567)',
  ).nullable().optional(),
  visibleOrderStatuses: z.array(visibleOrderStatusSchema).nullable().optional(),
  restrictProductAccess: z.boolean().optional(),
  productIds: z.array(z.string().uuid()).optional(),
  /**
   * Toggle the Finance hat. Setting to `true` auto-clears the flag from whoever previously held it
   * (atomic swap inside the same transaction). Setting to `false` revokes without reassigning.
   */
  isFinanceOfficer: z.boolean().optional(),
});

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

// ============================================
// List Users — with filtering & pagination
// ============================================

export const listUsersSchema = z.object({
  search: z.string().optional(),
  role: userRoleSchema.optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'DEACTIVATED', 'ARCHIVED']).optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'email', 'role', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;

/** Active-user name/email search for push broadcast recipient picker (narrow permission). */
export const searchUsersForPushTargetSchema = z.object({
  q: z.string().max(120).optional().default(''),
  limit: z.number().int().min(1).max(25).default(20),
  offset: z.number().int().min(0).default(0),
});

export type SearchUsersForPushTargetInput = z.infer<typeof searchUsersForPushTargetSchema>;

// ============================================
// Reset Password — admin resets a user's password
// ============================================

export const resetPasswordSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ============================================
// Email Change Approval — SuperAdmin approves/rejects
// ============================================

export const processEmailChangeSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

export type ProcessEmailChangeInput = z.infer<typeof processEmailChangeSchema>;
