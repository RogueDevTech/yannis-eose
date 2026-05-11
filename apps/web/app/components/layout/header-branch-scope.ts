const ALL_BRANCHES_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'HEAD_OF_CS',
  'HEAD_OF_LOGISTICS',
]);

export function canRoleSeeAllBranchesInHeader(userRole: string): boolean {
  return ALL_BRANCHES_ROLES.has(userRole);
}

export function shouldShowHeaderBranchSwitcher(branchCount: number, userRole: string): boolean {
  return branchCount > 1 || canRoleSeeAllBranchesInHeader(userRole);
}
