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
  'CS_CLOSER',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
]);

/**
 * Roles that are branch-scoped and therefore must carry at least one branch.
 * Every other non-SuperAdmin role (Stock Manager, Finance, HR, org-wide Heads,
 * TPL, etc.) is company-wide and is not assigned to branches.
 * Migration 0136 — CEO directive 2026-05-10.
 */
export const BRANCH_ELIGIBLE_ROLES = new Set([
  'MEDIA_BUYER',
  'HEAD_OF_MARKETING',
  'CS_CLOSER',
  'HEAD_OF_CS',
  'BRANCH_ADMIN',
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
  // Renamed from ALLOCATED — CEO directive 2026-05-04, migration 0110.
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
  'RETURNED',
  'RESTOCKED',
  'WRITTEN_OFF',
  // Renamed from COMPLETED — CEO directive 2026-05-04, migration 0110.
  'REMITTED',
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
  branchIds: z.array(z.string().uuid()).optional(),
  primaryBranchId: z.string().uuid().optional(),

  // Contact — Nigerian phone: 0XXXXXXXXXX or +234XXXXXXXXXX.
  // Required on create (CEO directive 2026-04-24) — every staff member must have a reachable
  // number and it must be unique across the org. Existing users without a phone can still be
  // edited; the update validator keeps this optional for back-compat.
  phone: z.string().regex(
    /^(?:0[789]\d{9}|\+234[789]\d{9})$/,
    'Enter a valid Nigerian phone number (e.g. 08031234567 or +2348031234567)',
  ),

  // Probation — when true, the user is created on probation. Default review window is
  // 90 days unless `probationUntil` is provided. Server-side eligibility check rejects
  // ADMIN / SUPER_ADMIN. CEO directive 2026-05-08.
  isProbation: z.boolean().optional(),
  probationUntil: z.coerce.date().optional(),
}).superRefine((data, ctx) => {
  // Only branch-eligible roles must carry a branch + primary branch. Company-wide
  // roles (Stock Manager, Finance, HR, org-wide Heads, TPL) are not branch-scoped.
  const roleNeedsBranch = BRANCH_ELIGIBLE_ROLES.has(data.role);
  if (roleNeedsBranch && (!data.branchIds || data.branchIds.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['branchIds'],
      message: 'At least one branch is required for this role',
    });
  }
  if (roleNeedsBranch && !data.primaryBranchId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['primaryBranchId'],
      message: 'Primary branch is required for this role',
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
  branchIds: z.array(z.string().uuid()).optional(),
  primaryBranchId: z.string().uuid().optional(),
});

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

// ============================================
// List Users — with filtering & pagination
// ============================================

export const listUsersSchema = z.object({
  search: z.string().max(120).optional(),
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
  /**
   * HR / staff-accounts roster: list everyone with `users.read`, ignoring `ctx.currentBranchId`.
   * Only honored when the actor matches staff-accounts access (admin-level, HR_MANAGER,
   * FINANCE_OFFICER, or `users.staff.*` grants) — same gate as `/hr/users`.
   */
  companyWideUserList: z.boolean().optional(),
  /**
   * When `false`, skip the per-row branch-memberships join. Defaults to `true` for
   * backward compatibility (the User Admin page reads memberships per row).
   * Filter-dropdown callers (Marketing orders' Media-buyer picker, ad-spend buyer
   * resolver, etc.) that only need `id + name + role` should pass `false` to drop
   * one DB round-trip from the response.
   */
  includeBranchMemberships: z.boolean().optional(),
  /** When true, only users currently on probation (`is_probation`). HR users list URL: `probationOnly=1`. */
  probationOnly: z.boolean().optional(),
  /**
   * When true, only users marked as a team supervisor anywhere
   * (`users.is_team_supervisor`). HR users list URL: `supervisorOnly=1`.
   */
  supervisorOnly: z.boolean().optional(),
  /**
   * When true, only users with **no** `user_branches` membership rows — i.e.
   * the org-wide hats (SuperAdmin, Admin, Heads, HR Manager, Finance Officer).
   * Used by the HR Users + Finance Staff Accounts branch picker to surface the
   * "Org-wide (heads / finance / admin)" sentinel without leaking everyone
   * else. Mutually exclusive with `branchId` — when both are set the service
   * favours `orgWideOnly` (NOT EXISTS) and ignores the branchId filter.
   */
  orgWideOnly: z.boolean().optional(),
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;

/** Same filters as `listUsersSchema` without pagination/sort — HR roster KPI strip (`users.rosterSummary`). */
export const usersRosterSummarySchema = listUsersSchema.pick({
  search: true,
  role: true,
  status: true,
  branchId: true,
  userIds: true,
  allBranches: true,
  companyWideUserList: true,
  probationOnly: true,
  supervisorOnly: true,
  orgWideOnly: true,
});

export type ListUsersRosterSummaryInput = z.infer<typeof usersRosterSummarySchema>;

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

// ============================================
// Probation — set / extend / mark permanent / terminate
// ============================================

/**
 * Roles INELIGIBLE for the probation flag. Admin-tier accounts cannot be put on probation
 * (the CEO's call — placing someone with a deletion window in charge of admin-class
 * authority is too risky). Service layer + UI both check this list.
 */
export const PROBATION_INELIGIBLE_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;

export function isRoleProbationEligible(role: string): boolean {
  return !PROBATION_INELIGIBLE_ROLES.includes(role as never);
}

/** Default probation window when HR doesn't pick a custom date. */
export const DEFAULT_PROBATION_DAYS = 90;

export function defaultProbationUntilFromNow(now: Date = new Date()): Date {
  const date = new Date(now);
  date.setDate(date.getDate() + DEFAULT_PROBATION_DAYS);
  return date;
}

export const setProbationSchema = z.object({
  userId: z.string().uuid(),
  /** Optional explicit review date; defaults to now + 90 days. */
  probationUntil: z.coerce.date().optional(),
});
export type SetProbationInput = z.infer<typeof setProbationSchema>;

export const extendProbationSchema = z.object({
  userId: z.string().uuid(),
  probationUntil: z.coerce.date(),
});
export type ExtendProbationInput = z.infer<typeof extendProbationSchema>;

export const markProbationPermanentSchema = z.object({
  userId: z.string().uuid(),
});
export type MarkProbationPermanentInput = z.infer<typeof markProbationPermanentSchema>;

export const terminateProbationSchema = z.object({
  userId: z.string().uuid(),
  /** Free-form reason — stored on the permanent `probation_terminations` row. */
  reason: z.string().min(10, 'Reason must be at least 10 characters').max(500),
  /** HR types the user's name to confirm — server compares case-insensitively. */
  confirmName: z.string().min(1),
});
export type TerminateProbationInput = z.infer<typeof terminateProbationSchema>;
