import { canonicalPermissionCode } from './permission-codes';
/**
 * Frontend authorization helpers — single source of truth for role-level checks.
 * Mirrors apps/api/src/common/authz.ts. Do NOT inline `role === 'SUPER_ADMIN'`
 * when you mean "admin-class user" — use `isAdminLevel` so ADMIN also passes.
 */

export const ADMIN_LEVEL_ROLES = new Set<string>(['SUPER_ADMIN', 'ADMIN']);

/**
 * True for SUPER_ADMIN or ADMIN. These are legacy "admin-class" role labels; access control is
 * permission-first — use `user.permissions` for authorization decisions.
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

export function isOrgWideDepartmentHead(user: {
  role: string;
  scopeOrgWideHead?: boolean;
} | null | undefined): boolean {
  return !!user && (user.scopeOrgWideHead === true || ORG_WIDE_DEPARTMENT_HEAD_ROLES.has(user.role));
}

/** Cross-branch session / listings — permission-driven mirror of apps/api `canViewAllBranches`. */
export function canViewAllBranches(user: {
  role: string;
  permissions?: string[];
} | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const normalized = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  return (
    normalized.includes('branches.scope.global') ||
    normalized.includes('cs.scope.global') ||
    normalized.includes('marketing.scope.global') ||
    normalized.includes('logistics.scope.global')
  );
}

/** Mirrors `hasFinanceAccess` in apps/api — finance role, hat, or costView permission. */
export function hasFinanceAccess(user: {
  role: string;
  permissions?: string[];
  isFinanceOfficer?: boolean;
} | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if ((user.permissions ?? []).map((p) => canonicalPermissionCode(p)).includes('finance.costs.view')) return true;
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
  if (user.role === 'SUPER_ADMIN') return true;
  if (hasFinanceAccess(user)) return true;
  if ((user.permissions ?? []).map((p) => canonicalPermissionCode(p)).includes('audit.logs.view')) return true;
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
        permissions?: string[];
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
  if (actor.role === 'SUPER_ADMIN') return true;

  const perms = actor.permissions ?? [];
  const normalized = perms.map((p) => canonicalPermissionCode(p));
  if (normalized.includes('mirror.any.manage')) return true;

  if (isOrgWideDepartmentHead(actor)) {
    if ((actor.role === 'HEAD_OF_CS' || normalized.includes('mirror.cs_team.manage')) && target.role === 'CS_AGENT')
      return true;
    if (
      (actor.role === 'HEAD_OF_MARKETING' || normalized.includes('mirror.marketing_team.manage')) &&
      target.role === 'MEDIA_BUYER'
    )
      return true;
    if (
      (actor.role === 'HEAD_OF_LOGISTICS' || normalized.includes('mirror.logistics_chain.manage')) &&
      HEAD_OF_LOGISTICS_MIRRORABLE.has(target.role)
    )
      return true;
    return false;
  }

  const sameBranch =
    !!actor.currentBranchId && target.primaryBranchId === actor.currentBranchId;
  if (!sameBranch) return false;

  // Branch supervisors + delegated mirror permissions are enforced server-side in
  // `branches.canMirrorToUser` / `AuthService.startMirror`. UI stays conservative.
  return (
    normalized.includes('mirror.cs_team.manage') ||
    normalized.includes('mirror.marketing_team.manage') ||
    normalized.includes('mirror.logistics_chain.manage')
  );
}
