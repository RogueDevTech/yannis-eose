/**
 * Frontend authorization helpers — single source of truth for role-level checks.
 * Mirrors apps/api/src/common/authz.ts. Do NOT inline `role === 'SUPER_ADMIN'`
 * when you mean "admin-class user" — use `isAdminLevel` so ADMIN also passes.
 */

export const ADMIN_LEVEL_ROLES = new Set<string>(['SUPER_ADMIN', 'ADMIN']);

/**
 * True for SUPER_ADMIN or ADMIN. These two roles bypass permission checks,
 * see all branches, and have full operational authority.
 */
export function isAdminLevel(user: { role: string } | null | undefined): boolean {
  if (!user) return false;
  return ADMIN_LEVEL_ROLES.has(user.role);
}

/**
 * True ONLY for SUPER_ADMIN — reserved for actions that manage other Admins,
 * transfer ownership, or access the initial system-setup flow.
 */
export function isSuperAdminOnly(user: { role: string } | null | undefined): boolean {
  return !!user && user.role === 'SUPER_ADMIN';
}

export const ORG_WIDE_DEPARTMENT_HEAD_ROLES = new Set<string>([
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
]);

export function isOrgWideDepartmentHead(user: { role: string } | null | undefined): boolean {
  return !!user && ORG_WIDE_DEPARTMENT_HEAD_ROLES.has(user.role);
}

/** Cross-branch session / listings — mirrors apps/api `canViewAllBranches`. */
export function canViewAllBranches(user: { role: string } | null | undefined): boolean {
  if (!user) return false;
  return ADMIN_LEVEL_ROLES.has(user.role) || isOrgWideDepartmentHead(user);
}

/** Mirrors `hasFinanceAccess` in apps/api — finance role, hat, or costView permission. */
export function hasFinanceAccess(user: {
  role: string;
  permissions?: string[];
  isFinanceOfficer?: boolean;
} | null | undefined): boolean {
  if (!user) return false;
  if (ADMIN_LEVEL_ROLES.has(user.role)) return true;
  if (user.permissions?.includes('finance.costView')) return true;
  if (user.role === 'FINANCE_OFFICER') return true;
  if (user.isFinanceOfficer === true) return true;
  return false;
}

/**
 * Global audit page / `audit.globalLog` — admin, finance (primary or hat), or `audit.read`.
 */
export function canAccessGlobalAuditLog(user: {
  role: string;
  permissions?: string[];
  isFinanceOfficer?: boolean;
} | null | undefined): boolean {
  if (!user) return false;
  if (isAdminLevel(user)) return true;
  if (hasFinanceAccess(user)) return true;
  if (user.permissions?.includes('audit.read')) return true;
  return false;
}

const HEAD_OF_LOGISTICS_MIRRORABLE = new Set<string>([
  'LOGISTICS_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'STOCK_MANAGER',
]);

/**
 * Mirror Mode permission gate — mirrors apps/api/src/common/authz.ts::canMirror.
 * Used to decide whether to render the "Mirror user" button on user detail pages.
 * The backend re-checks on /auth/mirror/start; this is a UI-only filter.
 */
export function canMirror(
  actor:
    | {
        id: string;
        role: string;
        currentBranchId?: string | null;
        mirroredBy?: { id: string } | null;
      }
    | null
    | undefined,
  target: { id: string; role: string; primaryBranchId?: string | null },
): boolean {
  if (!actor) return false;
  if (actor.mirroredBy) return false;
  if (actor.id === target.id) return false;
  if (ADMIN_LEVEL_ROLES.has(target.role)) return false;
  if (ADMIN_LEVEL_ROLES.has(actor.role)) return true;

  if (isOrgWideDepartmentHead(actor)) {
    if (actor.role === 'HEAD_OF_CS' && target.role === 'CS_AGENT') return true;
    if (actor.role === 'HEAD_OF_MARKETING' && target.role === 'MEDIA_BUYER') return true;
    if (actor.role === 'HEAD_OF_LOGISTICS' && HEAD_OF_LOGISTICS_MIRRORABLE.has(target.role))
      return true;
    return false;
  }

  const sameBranch =
    !!actor.currentBranchId && target.primaryBranchId === actor.currentBranchId;
  if (!sameBranch) return false;

  return false;
}
