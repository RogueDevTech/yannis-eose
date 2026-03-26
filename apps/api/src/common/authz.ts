/**
 * Centralized authorization helpers.
 * Import from here — do NOT duplicate role/permission checks inline.
 */

/**
 * Roles that can view data across all branches (global visibility bypass).
 * These users may have currentBranchId = null in their session, which the
 * RLS policies treat as "no branch filter".
 */
const GLOBAL_VISIBILITY_ROLES = new Set<string>(['SUPER_ADMIN']);

/**
 * Returns true if the user is allowed to see cross-branch data.
 * SuperAdmin is always eligible. Any other role can be granted the
 * `branches.view_all` permission for explicit elevation without giving full SA.
 */
export function canViewAllBranches(user: { role: string; permissions?: string[] }): boolean {
  return (
    GLOBAL_VISIBILITY_ROLES.has(user.role) ||
    (user.permissions?.includes('branches.view_all') ?? false)
  );
}
