import { canonicalPermissionCode } from './permission-codes';
/**
 * Frontend authorization helpers — single source of truth for role-level checks.
 * Mirrors apps/api/src/common/authz.ts. Do NOT inline `role === 'SUPER_ADMIN'`
 * when you mean "admin-class user" — use `isAdminLevel` so ADMIN also passes.
 */

export const ADMIN_LEVEL_ROLES = new Set<string>(['SUPER_ADMIN', 'ADMIN', 'SUPPORT']);

/**
 * True for SUPER_ADMIN or ADMIN. These are legacy "admin-class" role labels; access control is
 * permission-first — use `user.permissions` for authorization decisions.
 */
export function isAdminLevel(user: { role: string } | null | undefined): boolean {
  if (!user) return false;
  return ADMIN_LEVEL_ROLES.has(user.role);
}

/** Compare session user id vs profile id (case/spacing safe — UUID strings from DB vs Redis may differ slightly). */
export function actorUserIdsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x.length > 0 && x === y;
}

/**
 * True ONLY for SUPER_ADMIN — reserved for actions that manage other Admins,
 * transfer ownership, or access the initial system-setup flow.
 */
export function isSuperAdminOnly(user: { role: string } | null | undefined): boolean {
  return !!user && user.role === 'SUPER_ADMIN';
}

export const ORG_WIDE_DEPARTMENT_HEAD_ROLES = new Set<string>([
  'HEAD_OF_MARKETING',
  'HEAD_OF_CS',
  'HEAD_OF_LOGISTICS',
]);

const NON_BRANCH_ASSIGNED_ROLES = new Set<string>([
  'SUPER_ADMIN',
  'ADMIN',
  'SUPPORT',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'LOGISTICS_MANAGER',
  'HR_MANAGER',
]);

export function isOrgWideDepartmentHead(user: {
  role: string;
  scopeOrgWideHead?: boolean;
} | null | undefined): boolean {
  return !!user && (user.scopeOrgWideHead === true || ORG_WIDE_DEPARTMENT_HEAD_ROLES.has(user.role));
}

/** Cross-branch session / listings — mirror of apps/api `canViewAllBranches`. */
export function canViewAllBranches(user: {
  role: string;
  permissions?: string[];
  scopeOrgWideHead?: boolean;
} | null | undefined): boolean {
  if (!user) return false;
  if (NON_BRANCH_ASSIGNED_ROLES.has(user.role)) return true;
  if (isAdminLevel(user)) return true;
  if (isOrgWideDepartmentHead(user)) return true;
  const normalized = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
  return (
    normalized.includes('branches.view_all') ||
    normalized.includes('branches.scope.global') ||
    normalized.includes('cs.scope.global') ||
    normalized.includes('marketing.scope.global') ||
    normalized.includes('logistics.scope.global')
  );
}

/** Mirrors `hasFinanceAccess` in apps/api — finance role or finance.costs.view permission. */
export function hasFinanceAccess(user: {
  role: string;
  permissions?: string[];
} | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (user.role === 'SUPPORT') return true;
  if ((user.permissions ?? []).map((p) => canonicalPermissionCode(p)).includes('finance.costs.view')) return true;
  if (user.role === 'FINANCE_OFFICER') return true;
  return false;
}

/**
 * Global audit page / `audit.globalLog` — admin, finance, or `audit.read`.
 */
export function canAccessGlobalAuditLog(user: {
  role: string;
  permissions?: string[];
} | null | undefined): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  if (hasFinanceAccess(user)) return true;
  if ((user.permissions ?? []).map((p) => canonicalPermissionCode(p)).includes('audit.logs.view')) return true;
  return false;
}

/**
 * Edit-access scope for `/hr/users/:id/edit` — mirrors
 * `apps/api/src/common/authz.ts::canEditUser`. Same three states + same rules.
 *
 * `'limited'` viewers (HoCS over CS_CLOSER, HoM over MEDIA_BUYER) can ONLY
 * change `capacity` / `productIds` / `visibleOrderStatuses` /
 * `restrictProductAccess` — the form should reflect that whitelist.
 */
export type EditUserAccessLevel = 'full' | 'limited' | 'none';

export function canEditUser(
  viewer:
    | {
        id: string;
        role: string;
        permissions?: string[];
        currentBranchId?: string | null;
        scopeTeamSupervisor?: boolean;
      }
    | null
    | undefined,
  target: { id: string; role: string; primaryBranchId?: string | null },
): EditUserAccessLevel {
  if (!viewer) return 'none';
  if (actorUserIdsMatch(viewer.id, target.id)) return 'none';

  // SUPPORT is read-only — hide edit buttons entirely (mutations blocked at tRPC layer).
  if (viewer.role === 'SUPPORT') return 'none';

  // SuperAdmin can edit anyone, including admin-class accounts
  // (CLAUDE.md → "SuperAdmin-only: manage admin-level users"). The earlier
  // blanket admin-class exclusion blocked SuperAdmin from this page too.
  if (viewer.role === 'SUPER_ADMIN') return 'full';

  // HR_MANAGER can reach the edit form on any non-self target — admin-class
  // updates are routed through the SuperAdmin approval queue at the service
  // layer (CEO directive 2026-05-11). The form looks identical; the submit
  // is intercepted server-side.
  if (viewer.role === 'HR_MANAGER') return 'full';

  // Plain ADMIN can edit non-admin targets only — admin-class targets stay
  // SuperAdmin-handoff per CLAUDE.md.
  if (ADMIN_LEVEL_ROLES.has(target.role)) return 'none';
  if (isAdminLevel(viewer)) return 'full';

  const perms = (viewer.permissions ?? []).map((p) => canonicalPermissionCode(p));
  const has = (code: string) => perms.includes(canonicalPermissionCode(code));

  if (has('users.staff.update') || has('users.update')) {
    if (isOrgWideDepartmentHead(viewer)) return 'full';
    const sameBranch =
      !!viewer.currentBranchId && target.primaryBranchId === viewer.currentBranchId;
    return sameBranch ? 'full' : 'none';
  }

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
  if (actor.role === 'SUPPORT') return true;

  const perms = actor.permissions ?? [];
  const normalized = perms.map((p) => canonicalPermissionCode(p));
  if (normalized.includes('mirror.any.manage')) return true;

  if ((actor.role === 'HEAD_OF_CS' || normalized.includes('mirror.cs_team.manage')) && target.role === 'CS_CLOSER')
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

  // Branch supervisors are still resolved server-side from the live branch-team graph.
  return false;
}
