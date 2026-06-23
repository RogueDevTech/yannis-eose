// Roles that view data across an entire company GROUP rather than a single
// assigned branch. These always get the group-level header switcher (even when
// their active group currently has only one branch) so the UI is consistent
// across every org-wide role instead of collapsing to a dead static pill.
//
// Mirrors the backend `NON_BRANCH_ASSIGNED_ROLES`
// (apps/api/src/common/authz.ts) — the source of truth for "org-wide, scoped by
// company group". Kept in sync deliberately; the one omission is TPL_RIDER,
// which lives in the dedicated rider UI and never needs a company switcher.
//
// MEDIA_BUYER is a special case: a Media Buyer's orders are scoped by ownership
// (`media_buyer_id`), so "All Branches" for them does NOT mean org-wide — it
// means "all of MY orders, every branch I've worked in". The header dropdown
// always offers it + the buyer's data-footprint branches (incl. branches they've
// since been removed from) so they never lose sight of data they created.
// Switching to a non-member branch is a read-only lens — branch-scoped mutations
// are blocked server-side.
export const ALL_BRANCHES_ROLES = new Set([
  // Admin-class
  'SUPER_ADMIN',
  'ADMIN',
  'SUPPORT',
  // Org-wide department heads
  'HEAD_OF_MARKETING',
  'HEAD_OF_CS',
  'HEAD_OF_LOGISTICS',
  // Org-wide managers / officers (not branch-assigned)
  'FINANCE_OFFICER',
  'HR_MANAGER',
  'STOCK_MANAGER',
  'LOGISTICS_MANAGER',
  'TPL_MANAGER',
  // Footprint-scoped, see note above
  'MEDIA_BUYER',
]);

export function canRoleSeeAllBranchesInHeader(userRole: string): boolean {
  return ALL_BRANCHES_ROLES.has(userRole);
}

export function shouldShowHeaderBranchSwitcher(branchCount: number, userRole: string): boolean {
  return branchCount > 1 || canRoleSeeAllBranchesInHeader(userRole);
}
