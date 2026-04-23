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
