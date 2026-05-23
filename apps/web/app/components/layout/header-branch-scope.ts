const ALL_BRANCHES_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'SUPPORT',
  'HEAD_OF_MARKETING',
  'HEAD_OF_CS',
  'HEAD_OF_LOGISTICS',
  // MEDIA_BUYER is a special case: a Media Buyer's orders are scoped by
  // ownership (`media_buyer_id`), so "All Branches" for them does NOT mean
  // org-wide — it means "all of MY orders, every branch I've worked in".
  // The header dropdown always offers it + the buyer's data-footprint
  // branches (incl. branches they've since been removed from) so they never
  // lose sight of data they created. Switching to a non-member branch is a
  // read-only data lens — branch-scoped mutations are blocked server-side.
  'MEDIA_BUYER',
]);

export function canRoleSeeAllBranchesInHeader(userRole: string): boolean {
  return ALL_BRANCHES_ROLES.has(userRole);
}

export function shouldShowHeaderBranchSwitcher(branchCount: number, userRole: string): boolean {
  return branchCount > 1 || canRoleSeeAllBranchesInHeader(userRole);
}
