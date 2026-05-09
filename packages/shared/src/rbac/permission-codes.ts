export const LEGACY_PERMISSION_CODE_MAP: Record<string, string> = {
  'ceo.overview': 'dashboard.ceo.view',
  'orders.read': 'orders.view',
  'orders.reassign': 'orders.reassign',
  'orders.bulkTransition': 'orders.transition.bulk',
  'orders.bulkAssign': 'orders.assign.bulk',
  'orders.csWorkloads': 'cs.orders.workloads.view',
  'orders.releaseLocks': 'orders.locks.release',
  'orders.inactiveAgents': 'cs.agents.inactive.view',
  'orders.csLeaderboard': 'orders.cs.leaderboard.view',
  'orders.callbackQueue': 'cs.callbacks.queue.view',
  'orders.scheduledCallbacks': 'cs.callbacks.scheduled.view',
  'orders.flaggedDuplicates': 'orders.duplicates.flagged.view',
  'orders.mergeDuplicate': 'orders.duplicates.merge',
  'orders.dismissDuplicate': 'orders.duplicates.dismiss',
  'cs.dashboard': 'cs.dashboard.view',
  'cs.teamOverview': 'cs.team.overview.view',
  'cs.leaderboard': 'cs.leaderboard.view',
  'products.read': 'catalog.products.view',
  'products.create': 'catalog.products.create',
  'products.update': 'catalog.products.update',
  'categories.read': 'catalog.categories.view',
  'categories.write': 'catalog.categories.manage',
  'inventory.read': 'inventory.overview.view',
  'inventory.intake': 'inventory.stock.intake',
  'inventory.transfer': 'inventory.stock.transfer',
  'inventory.approveTransfer': 'inventory.transfer.approve',
  'inventory.verifyTransfer': 'inventory.transfer.verify',
  'inventory.adjust': 'inventory.stock.adjust',
  'inventory.lowStockAlerts': 'inventory.alerts.low_stock.view',
  'inventory.returnedOrders': 'inventory.orders.returned.view',
  'inventory.createReconciliation': 'inventory.reconciliation.create',
  'inventory.resolveReconciliation': 'inventory.reconciliation.resolve',
  'inventory.reconciliations': 'inventory.reconciliation.view',
  'transfers.read': 'inventory.transfers.view',
  'returns.read': 'inventory.returns.view',
  'logistics.read': 'logistics.overview.view',
  'logistics.write': 'logistics.settings.manage',
  'logistics.remit': 'logistics.remittance.submit',
  'marketing.read': 'marketing.overview.view',
  'marketing.funding': 'marketing.funding.create',
  'marketing.fundingSummary': 'marketing.funding.summary.view',
  'marketing.adSpend': 'marketing.ad_spend.log',
  'marketing.leaderboard': 'marketing.leaderboard.view',
  'marketing.checkHighCpa': 'marketing.alerts.high_cpa.check',
  'marketing.offerTemplate': 'marketing.offer_templates.manage',
  'marketing.campaigns': 'marketing.campaigns.manage',
  'marketing.teamOverview': 'marketing.team.overview.view',
  'marketing.orders': 'marketing.orders.view',
  'finance.read': 'finance.overview.view',
  'finance.costView': 'finance.costs.view',
  'finance.approve': 'finance.approvals.manage',
  'finance.disburse': 'finance.disbursements.manage',
  'finance.initMaterializedViews': 'finance.materialized_views.initialize',
  'hr.read': 'hr.overview.view',
  'hr.write': 'hr.manage',
  'hr.approveAdjustment': 'hr.adjustments.approve',
  'users.read': 'users.staff.view',
  'users.create': 'users.staff.create',
  'users.update': 'users.staff.update',
  'users.deactivate': 'users.staff.deactivate',
  'audit.read': 'audit.logs.view',
  'settings.write': 'settings.system.manage',
  'rider.dashboard': 'rider.dashboard.view',
  'cart.read': 'cart.abandoned.view',
  'branches.manage': 'branches.admin.manage',
  'branches.view_all': 'branches.scope.global',
  'notifications.broadcast': 'notifications.broadcast.manage',
  'cart.delete': 'cart.abandoned.delete',
  'rbac.manage_templates': 'rbac.templates.manage',
  'marketing.requestFunding.orgWide': 'marketing.funding.request.org_wide',
  // Phase 20 — split out approve/reject capabilities so they can be granted to
  // a custom role without inheriting all of HEAD_OF_MARKETING.
  'marketing.funding.request': 'marketing.funding.request',
  'marketing.funding.approve': 'marketing.funding.approve',
  'marketing.adSpend.approve': 'marketing.ad_spend.approve',
  'finance.cashRemittance.create': 'finance.cash_remittance.create',
  'finance.cashRemittance.markReceived': 'finance.cash_remittance.mark_received',
  // Phase 21 — capabilities split out from inline router/service role lists.
  'orders.createOffline': 'orders.createOffline',
  'messaging.templates.create': 'messaging.templates.create',
  'messaging.templates.update': 'messaging.templates.update',
  'logistics.transferRemittance.markReceived': 'logistics.transfer_remittance.mark_received',
  'logistics.deliveryConfirmation.submit': 'logistics.delivery_confirmation.submit',
  'logistics.deliveryConfirmation.review': 'logistics.delivery_confirmation.review',
  'mirror.any': 'mirror.any.manage',
  'mirror.cs_team': 'mirror.cs_team.manage',
  'mirror.marketing_team': 'mirror.marketing_team.manage',
  'mirror.logistics_chain': 'mirror.logistics_chain.manage',
  'team.supervise_cs': 'team.cs.supervise',
  'team.supervise_marketing': 'team.marketing.supervise',
  'team.supervise_logistics': 'team.logistics.supervise',
  // Phase 22 — staff onboarding workflow (already canonical).
  'hr.onboarding.read': 'hr.onboarding.read',
  'hr.onboarding.write': 'hr.onboarding.write',
  'hr.onboarding.approve': 'hr.onboarding.approve',
};

const LEGACY_BY_CANONICAL = new Map<string, string[]>();
for (const [legacy, canonical] of Object.entries(LEGACY_PERMISSION_CODE_MAP)) {
  const existing = LEGACY_BY_CANONICAL.get(canonical) ?? [];
  existing.push(legacy);
  LEGACY_BY_CANONICAL.set(canonical, existing);
}

export function canonicalPermissionCode(code: string): string {
  return LEGACY_PERMISSION_CODE_MAP[code] ?? code;
}

export function canonicalPermissionCodes(codes: Iterable<string>): string[] {
  return [...new Set(Array.from(codes, (code) => canonicalPermissionCode(code)))];
}

export function legacyAliasesForCanonical(code: string): string[] {
  return LEGACY_BY_CANONICAL.get(code) ?? [];
}

/**
 * Split a dotted canonical permission code into resource + action for UX copy.
 * Uses the last dot as the boundary (e.g. `team.cs.supervise` → resource `team.cs`, action `supervise`).
 */
export function permissionCodeDisplaySplit(code: string): { resource: string; action: string } {
  const trimmed = code.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) {
    return { resource: trimmed, action: '' };
  }
  return {
    resource: trimmed.slice(0, lastDot),
    action: trimmed.slice(lastDot + 1),
  };
}
