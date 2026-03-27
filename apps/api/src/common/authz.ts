/**
 * Centralized authorization helpers.
 * Import from here — do NOT duplicate role/permission checks inline.
 */

/**
 * Roles that can view data across all branches (global visibility bypass).
 * Current policy: only SuperAdmin can access all branches.
 */
const GLOBAL_VISIBILITY_ROLES = new Set<string>(['SUPER_ADMIN']);

/**
 * Returns true if the user is allowed to see cross-branch data.
 * Current policy: only SuperAdmin is eligible.
 */
export function canViewAllBranches(user: { role: string; permissions?: string[] }): boolean {
  return GLOBAL_VISIBILITY_ROLES.has(user.role);
}
