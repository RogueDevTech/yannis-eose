BEGIN;

CREATE TEMP TABLE _perm_code_map (
  old_code text PRIMARY KEY,
  new_code text NOT NULL
) ON COMMIT DROP;

INSERT INTO _perm_code_map (old_code, new_code) VALUES
  ('ceo.overview', 'dashboard.ceo.view'),
  ('orders.read', 'orders.view'),
  ('orders.reassign', 'orders.reassign'),
  ('orders.bulkTransition', 'orders.transition.bulk'),
  ('orders.bulkAssign', 'orders.assign.bulk'),
  ('orders.csWorkloads', 'cs.orders.workloads.view'),
  ('orders.releaseLocks', 'orders.locks.release'),
  ('orders.inactiveAgents', 'cs.agents.inactive.view'),
  ('orders.csLeaderboard', 'orders.cs.leaderboard.view'),
  ('orders.callbackQueue', 'cs.callbacks.queue.view'),
  ('orders.scheduledCallbacks', 'cs.callbacks.scheduled.view'),
  ('orders.flaggedDuplicates', 'orders.duplicates.flagged.view'),
  ('orders.mergeDuplicate', 'orders.duplicates.merge'),
  ('orders.dismissDuplicate', 'orders.duplicates.dismiss'),
  ('cs.dashboard', 'cs.dashboard.view'),
  ('cs.teamOverview', 'cs.team.overview.view'),
  ('cs.leaderboard', 'cs.leaderboard.view'),
  ('products.read', 'catalog.products.view'),
  ('products.create', 'catalog.products.create'),
  ('products.update', 'catalog.products.update'),
  ('categories.read', 'catalog.categories.view'),
  ('categories.write', 'catalog.categories.manage'),
  ('inventory.read', 'inventory.overview.view'),
  ('inventory.intake', 'inventory.stock.intake'),
  ('inventory.transfer', 'inventory.stock.transfer'),
  ('inventory.verifyTransfer', 'inventory.transfer.verify'),
  ('inventory.adjust', 'inventory.stock.adjust'),
  ('inventory.lowStockAlerts', 'inventory.alerts.low_stock.view'),
  ('inventory.returnedOrders', 'inventory.orders.returned.view'),
  ('inventory.createReconciliation', 'inventory.reconciliation.create'),
  ('inventory.resolveReconciliation', 'inventory.reconciliation.resolve'),
  ('inventory.reconciliations', 'inventory.reconciliation.view'),
  ('transfers.read', 'inventory.transfers.view'),
  ('returns.read', 'inventory.returns.view'),
  ('logistics.read', 'logistics.overview.view'),
  ('logistics.write', 'logistics.settings.manage'),
  ('logistics.remit', 'logistics.remittance.submit'),
  ('marketing.read', 'marketing.overview.view'),
  ('marketing.funding', 'marketing.funding.create'),
  ('marketing.fundingSummary', 'marketing.funding.summary.view'),
  ('marketing.adSpend', 'marketing.ad_spend.log'),
  ('marketing.leaderboard', 'marketing.leaderboard.view'),
  ('marketing.checkHighCpa', 'marketing.alerts.high_cpa.check'),
  ('marketing.offerTemplate', 'marketing.offer_templates.manage'),
  ('marketing.campaigns', 'marketing.campaigns.manage'),
  ('marketing.teamOverview', 'marketing.team.overview.view'),
  ('marketing.orders', 'marketing.orders.view'),
  ('finance.read', 'finance.overview.view'),
  ('finance.costView', 'finance.costs.view'),
  ('finance.approve', 'finance.approvals.manage'),
  ('finance.disburse', 'finance.disbursements.manage'),
  ('finance.initMaterializedViews', 'finance.materialized_views.initialize'),
  ('hr.read', 'hr.overview.view'),
  ('hr.write', 'hr.manage'),
  ('hr.approveAdjustment', 'hr.adjustments.approve'),
  ('users.read', 'users.staff.view'),
  ('users.create', 'users.staff.create'),
  ('users.update', 'users.staff.update'),
  ('users.deactivate', 'users.staff.deactivate'),
  ('audit.read', 'audit.logs.view'),
  ('settings.write', 'settings.system.manage'),
  ('rider.dashboard', 'rider.dashboard.view'),
  ('cart.read', 'cart.abandoned.view'),
  ('branches.manage', 'branches.admin.manage'),
  ('branches.view_all', 'branches.scope.global'),
  ('notifications.broadcast', 'notifications.broadcast.manage'),
  ('cart.delete', 'cart.abandoned.delete'),
  ('rbac.manage_templates', 'rbac.templates.manage'),
  ('marketing.requestFunding.orgWide', 'marketing.funding.request.org_wide'),
  ('mirror.any', 'mirror.any.manage'),
  ('mirror.cs_team', 'mirror.cs_team.manage'),
  ('mirror.marketing_team', 'mirror.marketing_team.manage'),
  ('mirror.logistics_chain', 'mirror.logistics_chain.manage'),
  ('team.supervise_cs', 'team.cs.supervise'),
  ('team.supervise_marketing', 'team.marketing.supervise'),
  ('team.supervise_logistics', 'team.logistics.supervise');

-- If both old + new rows exist, repoint FK rows to the new row first and remove the old row.
WITH pairs AS (
  SELECT oldp.id AS old_id, newp.id AS new_id
  FROM _perm_code_map m
  JOIN permissions oldp ON oldp.code = m.old_code
  JOIN permissions newp ON newp.code = m.new_code
  WHERE oldp.id <> newp.id
)
DELETE FROM role_permissions rp
USING pairs p
WHERE rp.permission_id = p.old_id
  AND EXISTS (
    SELECT 1 FROM role_permissions keep
    WHERE keep.role = rp.role AND keep.permission_id = p.new_id
  );

WITH pairs AS (
  SELECT oldp.id AS old_id, newp.id AS new_id
  FROM _perm_code_map m
  JOIN permissions oldp ON oldp.code = m.old_code
  JOIN permissions newp ON newp.code = m.new_code
  WHERE oldp.id <> newp.id
)
UPDATE role_permissions rp
SET permission_id = p.new_id
FROM pairs p
WHERE rp.permission_id = p.old_id;

WITH pairs AS (
  SELECT oldp.id AS old_id, newp.id AS new_id
  FROM _perm_code_map m
  JOIN permissions oldp ON oldp.code = m.old_code
  JOIN permissions newp ON newp.code = m.new_code
  WHERE oldp.id <> newp.id
)
DELETE FROM role_template_permissions rtp
USING pairs p
WHERE rtp.permission_id = p.old_id
  AND EXISTS (
    SELECT 1 FROM role_template_permissions keep
    WHERE keep.role_template_id = rtp.role_template_id AND keep.permission_id = p.new_id
  );

WITH pairs AS (
  SELECT oldp.id AS old_id, newp.id AS new_id
  FROM _perm_code_map m
  JOIN permissions oldp ON oldp.code = m.old_code
  JOIN permissions newp ON newp.code = m.new_code
  WHERE oldp.id <> newp.id
)
UPDATE role_template_permissions rtp
SET permission_id = p.new_id
FROM pairs p
WHERE rtp.permission_id = p.old_id;

WITH pairs AS (
  SELECT oldp.id AS old_id, newp.id AS new_id
  FROM _perm_code_map m
  JOIN permissions oldp ON oldp.code = m.old_code
  JOIN permissions newp ON newp.code = m.new_code
  WHERE oldp.id <> newp.id
)
UPDATE user_permissions up
SET permission_id = p.new_id
FROM pairs p
WHERE up.permission_id = p.old_id;

DELETE FROM permissions p
USING _perm_code_map m
WHERE p.code = m.old_code
  AND EXISTS (SELECT 1 FROM permissions keep WHERE keep.code = m.new_code);

-- Rename remaining legacy codes in-place.
UPDATE permissions p
SET code = m.new_code,
    resource = split_part(m.new_code, '.', 1),
    action = split_part(m.new_code, '.', array_length(string_to_array(m.new_code, '.'), 1))
FROM _perm_code_map m
WHERE p.code = m.old_code
  AND NOT EXISTS (SELECT 1 FROM permissions keep WHERE keep.code = m.new_code);

COMMIT;
