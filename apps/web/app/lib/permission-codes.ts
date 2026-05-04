const LEGACY_PERMISSION_CODE_MAP: Record<string, string> = {
  'ceo.overview': 'dashboard.ceo.view',
  'orders.read': 'orders.view',
  'orders.bulkTransition': 'orders.transition.bulk',
  'orders.bulkAssign': 'orders.assign.bulk',
  'cs.teamOverview': 'cs.team.overview.view',
  'products.read': 'catalog.products.view',
  'products.create': 'catalog.products.create',
  'products.update': 'catalog.products.update',
  'categories.read': 'catalog.categories.view',
  'categories.write': 'catalog.categories.manage',
  'inventory.read': 'inventory.overview.view',
  'inventory.intake': 'inventory.stock.intake',
  'inventory.transfer': 'inventory.stock.transfer',
  'inventory.verifyTransfer': 'inventory.transfer.verify',
  'inventory.adjust': 'inventory.stock.adjust',
  'logistics.read': 'logistics.overview.view',
  'logistics.write': 'logistics.settings.manage',
  'marketing.read': 'marketing.overview.view',
  'marketing.funding': 'marketing.funding.create',
  'marketing.fundingSummary': 'marketing.funding.summary.view',
  'marketing.adSpend': 'marketing.ad_spend.log',
  'marketing.teamOverview': 'marketing.team.overview.view',
  'finance.read': 'finance.overview.view',
  'finance.costView': 'finance.costs.view',
  'finance.approve': 'finance.approvals.manage',
  'finance.disburse': 'finance.disbursements.manage',
  'hr.read': 'hr.overview.view',
  'hr.write': 'hr.manage',
  'hr.approveAdjustment': 'hr.adjustments.approve',
  'users.read': 'users.staff.view',
  'users.create': 'users.staff.create',
  'users.update': 'users.staff.update',
  'users.deactivate': 'users.staff.deactivate',
  'audit.read': 'audit.logs.view',
  'settings.write': 'settings.system.manage',
  'branches.manage': 'branches.admin.manage',
  'branches.view_all': 'branches.scope.global',
  'notifications.broadcast': 'notifications.broadcast.manage',
  'rbac.manage_templates': 'rbac.templates.manage',
  'mirror.any': 'mirror.any.manage',
  'mirror.cs_team': 'mirror.cs_team.manage',
  'mirror.marketing_team': 'mirror.marketing_team.manage',
  'mirror.logistics_chain': 'mirror.logistics_chain.manage',
};

export function canonicalPermissionCode(code: string): string {
  return LEGACY_PERMISSION_CODE_MAP[code] ?? code;
}

/**
 * Acronyms that should display as ALL-CAPS rather than Title Case.
 * Anything not in this set gets the regular "first-letter-uppercase, rest
 * lowercase" treatment so codes don't look shouty.
 */
const PERMISSION_DISPLAY_ACRONYMS = new Set([
  'cs', 'hr', 'voip', 'tpl', 'sms', 'ceo', 'cpa', 'roas',
  'rbac', 'pwa', 'ui', 'ux', 'api', 'kyc', 'cogs', 'mb', 'pdf',
]);

/**
 * Convert a dotted permission code into a readable label.
 *   audit.logs.view              → "Audit logs view"
 *   marketing.adSpend.approve    → "Marketing ad spend approve"
 *   finance.cash_remittance.create → "Finance cash remittance create"
 *   cs.dashboard                 → "CS dashboard"
 *
 * Splits on dots / underscores, breaks camelCase, lowercases, then
 * sentence-cases (only the first word is capitalized; subsequent words stay
 * lowercase unless they're a known acronym). Keep the canonical dotted code
 * around as the source-of-truth identifier in tooltips / debug surfaces.
 */
export function formatPermissionCode(code: string): string {
  const words = code
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((word, index) => {
      if (PERMISSION_DISPLAY_ACRONYMS.has(word)) return word.toUpperCase();
      if (index === 0) return word.charAt(0).toUpperCase() + word.slice(1);
      return word;
    })
    .join(' ');
}

/**
 * Convert the leading segment of a permission code (the "group key" used in
 * the matrix UI) into a readable section heading.
 *   audit  → "Audit"
 *   cs     → "CS"
 *   hr     → "HR"
 *   marketing → "Marketing"
 */
export function formatPermissionGroup(key: string): string {
  if (PERMISSION_DISPLAY_ACRONYMS.has(key.toLowerCase())) return key.toUpperCase();
  return formatPermissionCode(key);
}
