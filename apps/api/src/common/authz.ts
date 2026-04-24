/**
 * Centralized authorization helpers.
 * Import from here — do NOT duplicate role/permission checks inline.
 */

/**
 * Admin-level roles: bypass permission checks, see all branches, have full
 * operational authority. SUPER_ADMIN additionally may manage other Admins
 * and is a singleton (see isSuperAdminOnly). ADMIN is NOT a singleton.
 */
export const ADMIN_LEVEL_ROLES = new Set<string>(['SUPER_ADMIN', 'ADMIN']);

/**
 * Returns true for SUPER_ADMIN or ADMIN — the two roles that bypass
 * permission checks and have cross-branch visibility.
 * Use this anywhere the old code wrote `role === 'SUPER_ADMIN'` to grant
 * elevated access or skip permission gates.
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

/**
 * Returns true if the user is allowed to see cross-branch data.
 * SUPER_ADMIN + ADMIN have global visibility.
 */
export function canViewAllBranches(user: { role: string; permissions?: string[] }): boolean {
  return ADMIN_LEVEL_ROLES.has(user.role);
}

/**
 * Returns true if the role should be treated as admin-class when assigning
 * another user (HR cannot directly create/promote someone into this role —
 * it requires SuperAdmin approval).
 */
export function isAdminLevelRole(role: string): boolean {
  return ADMIN_LEVEL_ROLES.has(role);
}
