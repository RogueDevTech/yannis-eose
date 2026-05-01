/**
 * Centralized authorization helpers.
 * Import from here — do NOT duplicate role/permission checks inline.
 */

import { hasFinanceAccess } from './utils/strip-finance-fields';

/**
 * Legacy admin-class role labels (still stored on `users.role`).
 * Authorization is permission-first — do NOT treat these as automatic bypass.
 */
export const ADMIN_LEVEL_ROLES = new Set<string>(['SUPER_ADMIN', 'ADMIN']);

/**
 * Returns true for SUPER_ADMIN or ADMIN role strings — convenience for HR/promotion
 * flows and other legacy “admin-class” labeling only.
 */
export function isAdminLevel(user: { role: string }): boolean {
  return ADMIN_LEVEL_ROLES.has(user.role);
}

/**
 * Returns true ONLY for SUPER_ADMIN — used for actions that must stay
 * with the system owner (managing other Admins, transferring the
 * SuperAdmin role, killing admin-level sessions).
 */
export function isSuperAdminOnly(user: { role: string }): boolean {
  return user.role === 'SUPER_ADMIN';
}

/** Org-wide singleton heads: one active holder per role for the whole org; cross-branch visibility. */
export const ORG_WIDE_DEPARTMENT_HEAD_ROLES = new Set<string>([
  'HEAD_OF_CS',
  'HEAD_OF_MARKETING',
  'HEAD_OF_LOGISTICS',
]);

export function isOrgWideDepartmentHead(user: {
  role: string;
  scopeOrgWideHead?: boolean;
}): boolean {
  if (user.scopeOrgWideHead === true) return true;
  return ORG_WIDE_DEPARTMENT_HEAD_ROLES.has(user.role);
}

/**
 * Returns true if the user is allowed to see cross-branch data.
 * Permission-first: grant via global scope permissions (plus SUPER_ADMIN).
 */
export function canViewAllBranches(user: {
  role: string;
  permissions?: string[];
}): boolean {
  if (user.role === 'SUPER_ADMIN') return true;
  const permissionSet = new Set(user.permissions ?? []);
  return (
    permissionSet.has('branches.view_all') ||
    permissionSet.has('branches.scope.global') ||
    permissionSet.has('cs.scope.global') ||
    permissionSet.has('marketing.scope.global') ||
    permissionSet.has('logistics.scope.global')
  );
}

/** Session fields needed for global audit log / mirror-session audit access. */
export type GlobalAuditAccessUser = {
  role: string;
  permissions?: string[];
  isFinanceOfficer?: boolean;
  currentBranchId?: string | null;
};

/**
 * Global audit UI (`/admin/analytics/audit`) and `audit.globalLog` — not every authed user.
 * Admin + finance (primary or hat) see org-wide rows; others need `audit.read`.
 */
export function canAccessGlobalAuditLog(user: GlobalAuditAccessUser): boolean {
  if (isSuperAdminOnly(user)) return true;
  if (hasFinanceAccess(user)) return true;
  if (user.permissions?.includes('audit.read')) return true;
  return false;
}

/**
 * When true, `getGlobalAuditLog` restricts UNION arms to the viewer's `currentBranchId`
 * (and drops mirror_sessions + tables without branch columns).
 */
export function shouldScopeGlobalAuditToBranch(user: GlobalAuditAccessUser): boolean {
  if (!canAccessGlobalAuditLog(user)) return false;
  if (isSuperAdminOnly(user) || hasFinanceAccess(user)) return false;
  return Boolean(user.currentBranchId);
}

/**
 * Returns true if the role should be treated as admin-class when assigning
 * another user (HR cannot directly create/promote someone into this role —
 * it requires SuperAdmin approval).
 */
export function isAdminLevelRole(role: string): boolean {
  return ADMIN_LEVEL_ROLES.has(role);
}

/**
 * Roles a Head of Logistics may mirror — anyone in the logistics chain on
 * their branch (3PL managers, riders, stock managers, branch logistics manager).
 */
const HEAD_OF_LOGISTICS_MIRRORABLE = new Set<string>([
  'LOGISTICS_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'STOCK_MANAGER',
]);

/**
 * Mirror Mode permission gate.
 *
 * Rules (per CEO directive):
 * - SuperAdmin / Admin can mirror anyone EXCEPT another admin-level user.
 * - HEAD_OF_CS can mirror any CS_AGENT (org-wide head — not limited to a single branch).
 * - HEAD_OF_MARKETING can mirror any MEDIA_BUYER.
 * - HEAD_OF_LOGISTICS can mirror LOGISTICS_MANAGER / TPL_MANAGER / TPL_RIDER / STOCK_MANAGER org-wide.
 * - Branch team supervisors mirror via `BranchTeamsService.actorCanMirrorViaSupervision` (same branch).
 * - HR_MANAGER cannot mirror anyone (per directive — HR doesn't need it).
 * - Nobody can mirror themselves.
 *
 * Already-mirroring sessions cannot start a nested mirror (no mirror chains).
 */
export function canMirror(
  actor: {
    id: string;
    role: string;
    permissions?: string[];
    currentBranchId?: string | null;
    mirroredBy?: { id: string } | null;
  },
  target: { id: string; role: string; primaryBranchId?: string | null },
): boolean {
  // No mirror chains
  if (actor.mirroredBy) return false;
  // Cannot mirror yourself
  if (actor.id === target.id) return false;
  // Cannot mirror admin-level users
  if (ADMIN_LEVEL_ROLES.has(target.role)) return false;

  if (actor.role === 'SUPER_ADMIN') return true;

  const perms = actor.permissions ?? [];
  if (perms.includes('mirror.any')) return true;

  if (isOrgWideDepartmentHead(actor)) {
    if ((actor.role === 'HEAD_OF_CS' || perms.includes('mirror.cs_team')) && target.role === 'CS_AGENT')
      return true;
    if (
      (actor.role === 'HEAD_OF_MARKETING' || perms.includes('mirror.marketing_team')) &&
      target.role === 'MEDIA_BUYER'
    )
      return true;
    if (
      (actor.role === 'HEAD_OF_LOGISTICS' || perms.includes('mirror.logistics_chain')) &&
      HEAD_OF_LOGISTICS_MIRRORABLE.has(target.role)
    )
      return true;
    return false;
  }

  const sameBranch =
    !!actor.currentBranchId && target.primaryBranchId === actor.currentBranchId;
  if (!sameBranch) return false;

  return false;
}
