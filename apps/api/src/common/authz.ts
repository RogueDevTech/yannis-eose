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
 * Returns true if the user is allowed to see cross-branch data without a session branch.
 * Admin-class + org-wide department heads match multi-branch UX (CLAUDE.md); others need scope perms.
 */
export function canViewAllBranches(user: {
  role: string;
  permissions?: string[];
  scopeOrgWideHead?: boolean;
}): boolean {
  if (isAdminLevel(user)) return true;
  if (isOrgWideDepartmentHead(user)) return true;
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
 * Edit-access scope for `/hr/users/:id/edit` and the underlying
 * `users.update` mutation.
 *
 *   - `'full'`     — can change every field (admin-class, HR_MANAGER on branch).
 *   - `'limited'`  — direct-report scope: HoCS over CS_CLOSER, HoM over
 *                    MEDIA_BUYER, on the same branch. Restricted to
 *                    `capacity` / `productIds` / `visibleOrderStatuses` /
 *                    `restrictProductAccess`.
 *   - `'none'`     — cannot edit. Detail page hides the "Edit user" link;
 *                    the edit-page loader 403s before rendering.
 *
 * The fields that `'limited'` may change are mirrored from the service
 * whitelist in [users.service.ts:1133-1137](apps/api/src/users/users.service.ts#L1133-L1137).
 * Keep the two in sync — they're the same contract enforced from two sides.
 */
export type EditUserAccessLevel = 'full' | 'limited' | 'none';

export interface CanEditUserViewer {
  id: string;
  role: string;
  permissions?: string[];
  currentBranchId?: string | null;
  scopeTeamSupervisor?: boolean;
}

export interface CanEditUserTarget {
  id: string;
  role: string;
  primaryBranchId?: string | null;
}

/**
 * Returns the edit-access scope a viewer has over a specific target user.
 *
 * SuperAdmin / Admin → always `'full'` unless the target is also admin-class.
 * HR_MANAGER → `'full'` on users in their branch.
 * Org-wide / branch-supervisor heads with `users.staff.update_supervised` →
 * `'limited'` over their direct-report role on the same branch.
 * Everyone else → `'none'`.
 *
 * Self-edit is intentionally `'none'` — that flow is `/admin/profile`, not
 * the staff-management edit page (preserves the service-layer "Cannot edit
 * your own account here" guard).
 */
export function canEditUser(
  viewer: CanEditUserViewer,
  target: CanEditUserTarget,
): EditUserAccessLevel {
  // Self-edit goes through /admin/profile, not the staff-management form.
  if (viewer.id === target.id) return 'none';

  // Admin-level accounts can't be edited from the staff-management page —
  // mirrors the SUPER_ADMIN/ADMIN guard in users.service.ts and the loader
  // gate at hr.users.$id.edit/route.tsx:78-80.
  if (ADMIN_LEVEL_ROLES.has(target.role)) return 'none';

  // Admin-class viewers can change anything on a non-admin target.
  if (isAdminLevel(viewer)) return 'full';

  const perms = new Set((viewer.permissions ?? []).map((p) => p));
  const has = (code: string) => perms.has(code);

  // HR_MANAGER on the target's branch — full access.
  if (viewer.role === 'HR_MANAGER') {
    const sameBranch =
      !!viewer.currentBranchId && target.primaryBranchId === viewer.currentBranchId;
    if (sameBranch) return 'full';
    return 'none';
  }

  // Anyone holding `users.staff.update` outright (catalog-granted) — full,
  // bounded by branch (org-wide heads with currentBranchId === null get
  // 'full' since branch isn't required).
  if (has('users.staff.update') || has('users.update')) {
    if (isOrgWideDepartmentHead(viewer)) return 'full';
    const sameBranch =
      !!viewer.currentBranchId && target.primaryBranchId === viewer.currentBranchId;
    if (sameBranch) return 'full';
    return 'none';
  }

  // Team-lead supervised scope — same shape as users.service.ts:1094-1148.
  // Need users.staff.update_supervised AND a domain-supervision marker
  // (cs.teamOverview / team.supervise_cs / scopeTeamSupervisor=true).
  const supervisedScope = has('users.staff.update_supervised');
  if (!supervisedScope) return 'none';

  const actorIsCsLead =
    has('cs.teamOverview') || has('team.supervise_cs') || viewer.scopeTeamSupervisor === true;
  const actorIsMarketingLead =
    has('marketing.teamOverview') ||
    has('team.supervise_marketing') ||
    viewer.scopeTeamSupervisor === true;

  const sameBranch =
    !!viewer.currentBranchId && target.primaryBranchId === viewer.currentBranchId;

  if (actorIsCsLead && target.role === 'CS_CLOSER' && sameBranch) return 'limited';
  if (actorIsMarketingLead && target.role === 'MEDIA_BUYER' && sameBranch) return 'limited';

  return 'none';
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
 * - HEAD_OF_CS can mirror any CS_CLOSER (org-wide head — not limited to a single branch).
 * - HEAD_OF_MARKETING can mirror any MEDIA_BUYER.
 * - HEAD_OF_LOGISTICS can mirror LOGISTICS_MANAGER / TPL_MANAGER / TPL_RIDER / STOCK_MANAGER org-wide.
 * - Branch team supervisors mirror via `BranchTeamsService.actorCanMirrorViaSupervision` (same branch).
 * - HR_MANAGER cannot mirror anyone (per directive — HR doesn't need it).
 * - Nobody can mirror themselves.
 *
 * Already-mirroring sessions cannot start a nested mirror (no mirror chains).
 */
/**
 * Staff insights on `/hr/users/:id` — orders/payroll/activity bundles, payout preview, and
 * `hr.listPayouts` when scoped to a `staffId`.
 *
 * Mirrors the Remix loader in `hr.users.$id._index/route.tsx` + `requireStaffAccountsAccess`
 * (see `apps/web/app/lib/api.server.ts` STAFF_ACCOUNTS_PERMISSION_CODES). Keep the two in sync.
 */
const STAFF_ACCOUNTS_DIRECTORY_PERMISSIONS = new Set<string>([
  'users.staff.view',
  'users.staff.create',
  'users.staff.update',
  'users.staff.deactivate',
  'users.read',
  'users.create',
  'users.update',
  'users.deactivate',
]);

/**
 * True when `viewer` may load HR user-detail defer bundles or payout previews for `target`,
 * excluding the unrestricted `users.getById` read (masked phone only).
 */
export function canAccessStaffHrUserDetail(
  viewer: { id: string; role: string; permissions?: string[] },
  target: { id: string; role: string },
): boolean {
  if (viewer.id === target.id) return true;

  const headOfCSViewingTeam =
    viewer.role === 'HEAD_OF_CS' && ['CS_CLOSER', 'HEAD_OF_CS'].includes(target.role);
  const headOfMarketingViewingTeam =
    viewer.role === 'HEAD_OF_MARKETING' &&
    ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(target.role);
  const isHoMOrHoCS = viewer.role === 'HEAD_OF_MARKETING' || viewer.role === 'HEAD_OF_CS';

  if (isHoMOrHoCS && !headOfCSViewingTeam && !headOfMarketingViewingTeam) {
    return false;
  }
  if (headOfCSViewingTeam || headOfMarketingViewingTeam) return true;

  if (isAdminLevel(viewer)) return true;

  /** Same branch as `requireStaffAccountsAccess` — primary Finance Officer only (not hat-only). */
  if (viewer.role === 'FINANCE_OFFICER') return true;

  const perms = viewer.permissions ?? [];
  for (const p of perms) {
    if (STAFF_ACCOUNTS_DIRECTORY_PERMISSIONS.has(p)) return true;
  }
  return false;
}

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
    if ((actor.role === 'HEAD_OF_CS' || perms.includes('mirror.cs_team')) && target.role === 'CS_CLOSER')
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
