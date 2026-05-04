import { z } from 'zod';

// ============================================
// User Role Enum (matches DB enum)
// ============================================

export const userRoleSchema = z.enum([
  'SUPER_ADMIN',
  'ADMIN',
  'BRANCH_ADMIN',
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

  /**
   * Optional explicit permission template selection. When omitted, the server assigns the SYSTEM
   * template mapped to `role` (if present).
   */
  roleTemplateId: z.string().uuid().optional(),
  /**
   * Fine-grained grants/revokes applied after template grants.
   * `true` = grant, `false` = revoke (even if the template grants it).
   */
  permissionOverrides: z.record(z.boolean()).optional(),
  scopeGlobal: z.boolean().optional(),
  scopeOrgWideHead: z.boolean().optional(),
  scopeTeamSupervisor: z.boolean().optional(),

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
  branchIds: z.array(z.string().uuid()).min(1, 'Select at least one branch').optional(),
  primaryBranchId: z.string().uuid().optional(),

  // Contact — Nigerian phone: 0XXXXXXXXXX or +234XXXXXXXXXX.
  // Required on create (CEO directive 2026-04-24) — every staff member must have a reachable
  // number and it must be unique across the org. Existing users without a phone can still be
  // edited; the update validator keeps this optional for back-compat.
  phone: z.string().regex(
    /^(?:0[789]\d{9}|\+234[789]\d{9})$/,
    'Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567)',
  ),
}).superRefine((data, ctx) => {
  // Every non-SuperAdmin user must have at least one branch and a primary branch.
  if (data.role !== 'SUPER_ADMIN' && (!data.branchIds || data.branchIds.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['branchIds'],
      message: 'At least one branch is required for non-SuperAdmin users',
    });
  }
  if (data.role !== 'SUPER_ADMIN' && !data.primaryBranchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryBranchId'],
      message: 'Primary branch is required for non-SuperAdmin users',
    });
  }
  if (data.primaryBranchId && data.branchIds && !data.branchIds.includes(data.primaryBranchId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryBranchId'],
      message: 'Primary branch must be one of the selected branches',
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
  roleTemplateId: z.string().uuid().nullable().optional(),
  permissionOverrides: z.record(z.boolean()).optional(),
  scopeGlobal: z.boolean().optional(),
  scopeOrgWideHead: z.boolean().optional(),
  scopeTeamSupervisor: z.boolean().optional(),
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
  branchIds: z.array(z.string().uuid()).min(1).optional(),
  primaryBranchId: z.string().uuid().optional(),
});

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

// ============================================
// List Users — with filtering & pagination
// ============================================

export const listUsersSchema = z.object({
  search: z.string().optional(),
  role: userRoleSchema.optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'DEACTIVATED', 'ARCHIVED']).optional(),
  branchId: z.string().uuid().optional(),
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'email', 'role', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  /**
   * Resolve names for an exact set of user IDs, bypassing pagination and the default
   * "status != DEACTIVATED" filter. Used by feature pages (ad spend, orders) that need to
   * display the name behind a foreign key no matter the current active/inactive state.
   */
  userIds: z.array(z.string().uuid()).max(500).optional(),
  /**
   * Admin-class only: bypass auto-scoping by `ctx.currentBranchId`.
   * Used by `/admin/branches/:id` member picker where the admin needs to add staff
   * from any branch to a specific branch. Non-admin callers passing this flag are
   * silently still scoped to their active branch (the service ignores the opt-in).
   */
  allBranches: z.boolean().optional(),
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
