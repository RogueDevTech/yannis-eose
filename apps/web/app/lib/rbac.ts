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

  const sameBranch =
    !!actor.currentBranchId && target.primaryBranchId === actor.currentBranchId;
  if (!sameBranch) return false;

  if (actor.role === 'HEAD_OF_CS' && target.role === 'CS_AGENT') return true;
  if (actor.role === 'HEAD_OF_MARKETING' && target.role === 'MEDIA_BUYER') return true;
  if (actor.role === 'HEAD_OF_LOGISTICS' && HEAD_OF_LOGISTICS_MIRRORABLE.has(target.role))
    return true;

  return false;
}
