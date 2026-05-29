/**
 * RBAC permission catalog — single source of truth for both:
 *   1. The CLI seed script (`packages/shared/scripts/seed-permissions.ts`)
 *   2. The API boot-time `PermissionSeedService`
 *
 * Both contexts read from this module so the live DB stays in sync with the
 * code without requiring anyone to remember `pnpm db:seed-permissions`. New
 * permissions added here flow into the next API restart automatically.
 *
 * Keep additions sorted by domain and add a brief description so the
 * Permission catalog page renders human copy without a migration.
 */

import { canonicalPermissionCode } from './permission-codes';

export interface PermissionCatalogEntry {
  code: string;
  resource: string;
  action: string;
  description?: string;
}

export const PERMISSIONS: PermissionCatalogEntry[] = [
  { code: 'ceo.overview', resource: 'ceo', action: 'overview', description: 'View CEO dashboard' },
  { code: 'orders.read', resource: 'orders', action: 'read', description: 'View orders' },
  { code: 'orders.reassign', resource: 'orders', action: 'reassign', description: 'Reassign Sales orders' },
  { code: 'orders.bulkTransition', resource: 'orders', action: 'bulkTransition', description: 'Bulk order status transitions' },
  { code: 'orders.followUp', resource: 'orders', action: 'followUp', description: 'Follow-up: reassign closed orders to another branch' },
  { code: 'orders.bulkAssign', resource: 'orders', action: 'bulkAssign', description: 'Bulk assign orders to Sales' },
  { code: 'orders.csWorkloads', resource: 'orders', action: 'csWorkloads', description: 'View Sales workloads' },
  { code: 'orders.releaseLocks', resource: 'orders', action: 'releaseLocks', description: 'Release expired order locks' },
  { code: 'orders.inactiveAgents', resource: 'orders', action: 'inactiveAgents', description: 'View inactive Sales closers' },
  { code: 'orders.csLeaderboard', resource: 'orders', action: 'csLeaderboard', description: 'View Sales leaderboard' },
  {
    code: 'orders.routing',
    resource: 'orders',
    action: 'routing',
    description: 'Configure Sales auto-dispatch routing rules (branch + optional product → Sales teams)',
  },
  { code: 'orders.callbackQueue', resource: 'orders', action: 'callbackQueue', description: 'View callback queue' },
  { code: 'orders.scheduledCallbacks', resource: 'orders', action: 'scheduledCallbacks', description: 'View scheduled callbacks' },
  { code: 'orders.flaggedDuplicates', resource: 'orders', action: 'flaggedDuplicates', description: 'View flagged duplicates' },
  { code: 'orders.mergeDuplicate', resource: 'orders', action: 'mergeDuplicate', description: 'Merge duplicate orders' },
  { code: 'orders.dismissDuplicate', resource: 'orders', action: 'dismissDuplicate', description: 'Dismiss duplicate flag' },
  { code: 'cs.dashboard', resource: 'cs', action: 'dashboard', description: 'Sales dashboard' },
  { code: 'cs.teamOverview', resource: 'cs', action: 'teamOverview', description: 'Sales team overview (Head of CS only)' },
  { code: 'cs.leaderboard', resource: 'cs', action: 'leaderboard', description: 'Sales leaderboard' },
  { code: 'products.read', resource: 'products', action: 'read', description: 'View products' },
  { code: 'products.create', resource: 'products', action: 'create', description: 'Create products' },
  { code: 'products.update', resource: 'products', action: 'update', description: 'Update products' },
  { code: 'products.offers', resource: 'products', action: 'offers', description: 'Manage offer packages (stock-owned)' },
  { code: 'categories.read', resource: 'categories', action: 'read', description: 'View categories' },
  { code: 'categories.write', resource: 'categories', action: 'write', description: 'Create/update categories' },
  { code: 'inventory.read', resource: 'inventory', action: 'read', description: 'View inventory' },
  { code: 'inventory.shipments.read', resource: 'inventory.shipments', action: 'read', description: 'View inbound shipments' },
  { code: 'inventory.intake', resource: 'inventory', action: 'intake', description: 'Stock intake' },
  { code: 'inventory.transfer', resource: 'inventory', action: 'transfer', description: 'Transfer stock' },
  { code: 'inventory.approveTransfer', resource: 'inventory', action: 'approveTransfer', description: 'Approve or reject a pending stock transfer (source-authority gate)' },
  { code: 'inventory.verifyTransfer', resource: 'inventory', action: 'verifyTransfer', description: 'Verify received transfer' },
  { code: 'inventory.adjust', resource: 'inventory', action: 'adjust', description: 'Adjust stock' },
  { code: 'inventory.lowStockAlerts', resource: 'inventory', action: 'lowStockAlerts', description: 'View low stock alerts' },
  { code: 'inventory.returnedOrders', resource: 'inventory', action: 'returnedOrders', description: 'View returned orders' },
  { code: 'inventory.createReconciliation', resource: 'inventory', action: 'createReconciliation', description: 'Create stock reconciliation' },
  { code: 'inventory.resolveReconciliation', resource: 'inventory', action: 'resolveReconciliation', description: 'Resolve reconciliation' },
  { code: 'inventory.reconciliations', resource: 'inventory', action: 'reconciliations', description: 'View reconciliations' },
  {
    code: 'inventory.warehouses.write',
    resource: 'inventory',
    action: 'warehouses.write',
    description: 'Create / update Yannis-owned warehouses',
  },
  { code: 'transfers.read', resource: 'transfers', action: 'read', description: 'View transfers' },
  { code: 'returns.read', resource: 'returns', action: 'read', description: 'View returns' },
  { code: 'logistics.read', resource: 'logistics', action: 'read', description: 'View logistics' },
  {
    code: 'logistics.providers.view',
    resource: 'logistics.providers',
    action: 'view',
    description: 'View the Logistics companies page (3PL partner directory) — page-scoped slice of logistics.read.',
  },
  {
    code: 'logistics.partner_transfers.view',
    resource: 'logistics.partner_transfers',
    action: 'view',
    description: 'View the Partner stock transfers page (3PL transfer ledger) — page-scoped slice of transfers.read.',
  },
  { code: 'logistics.write', resource: 'logistics', action: 'write', description: 'Create/update logistics companies and locations' },
  { code: 'logistics.remit', resource: 'logistics', action: 'remit', description: 'Submit transfer remittance to warehouse (3PL)' },
  { code: 'logistics.teamOverview', resource: 'logistics', action: 'teamOverview', description: 'View Logistics Team Analysis (provider performance rollup)' },
  { code: 'marketing.read', resource: 'marketing', action: 'read', description: 'View marketing' },
  { code: 'marketing.funding', resource: 'marketing', action: 'funding', description: 'Create funding records' },
  { code: 'marketing.fundingSummary', resource: 'marketing', action: 'fundingSummary', description: 'View funding summary' },
  { code: 'marketing.adSpend', resource: 'marketing', action: 'adSpend', description: 'Log ad spend' },
  { code: 'marketing.leaderboard', resource: 'marketing', action: 'leaderboard', description: 'View marketing leaderboard' },
  { code: 'marketing.checkHighCpa', resource: 'marketing', action: 'checkHighCpa', description: 'Check high CPA' },
  {
    code: 'marketing.offerTemplate',
    resource: 'marketing',
    action: 'offerTemplate',
    description: 'Legacy: create, update, and archive Edge offer tiers (deprecated — offers are stock-owned under products.offers)',
  },
  { code: 'marketing.campaigns', resource: 'marketing', action: 'campaigns', description: 'Create/update campaigns' },
  { code: 'marketing.teamOverview', resource: 'marketing', action: 'teamOverview', description: 'Marketing team overview (Head of Marketing only)' },
  { code: 'marketing.orders', resource: 'marketing', action: 'orders', description: 'View own orders (Media Buyer) or marketing orders (Head of Marketing)' },
  { code: 'finance.read', resource: 'finance', action: 'read', description: 'View finance' },
  { code: 'finance.costView', resource: 'finance', action: 'costView', description: 'View cost/margin data' },
  { code: 'finance.approve', resource: 'finance', action: 'approve', description: 'Approve financial requests' },
  { code: 'finance.disburse', resource: 'finance', action: 'disburse', description: 'Disburse funds to Head of Marketing' },
  { code: 'finance.initMaterializedViews', resource: 'finance', action: 'initMaterializedViews', description: 'Initialize materialized views' },
  { code: 'hr.read', resource: 'hr', action: 'read', description: 'View HR & payroll' },
  { code: 'hr.write', resource: 'hr', action: 'write', description: 'Manage HR (plans, payouts, adjustments)' },
  { code: 'hr.approveAdjustment', resource: 'hr', action: 'approveAdjustment', description: 'Approve HR adjustments' },
  { code: 'users.staff.view', resource: 'users.staff', action: 'view', description: 'View users/staff list' },
  { code: 'users.staff.create', resource: 'users.staff', action: 'create', description: 'Create users' },
  { code: 'users.staff.update', resource: 'users.staff', action: 'update', description: 'Update users' },
  { code: 'users.staff.deactivate', resource: 'users.staff', action: 'deactivate', description: 'Deactivate users' },
  { code: 'users.read', resource: 'users', action: 'read', description: 'Legacy alias for users.staff.view' },
  { code: 'users.create', resource: 'users', action: 'create', description: 'Legacy alias for users.staff.create' },
  { code: 'users.update', resource: 'users', action: 'update', description: 'Legacy alias for users.staff.update' },
  { code: 'users.deactivate', resource: 'users', action: 'deactivate', description: 'Legacy alias for users.staff.deactivate' },
  { code: 'audit.read', resource: 'audit', action: 'read', description: 'View audit trail' },
  { code: 'settings.write', resource: 'settings', action: 'write', description: 'Update system settings' },
  { code: 'rider.dashboard', resource: 'rider', action: 'dashboard', description: 'Rider dashboard' },
  { code: 'cart.read', resource: 'cart', action: 'read', description: 'View cart abandonment data (Sales dashboard)' },
  { code: 'branches.manage', resource: 'branches', action: 'manage', description: 'Create, update, and assign users to branches (SuperAdmin / Admin / HR Manager)' },
  { code: 'branches.view_all', resource: 'branches', action: 'view_all', description: 'View data across all branches (global visibility bypass) — grant sparingly' },
  { code: 'branches.teams.cs', resource: 'branches.teams', action: 'cs', description: 'Manage Sales supervisor teams within a branch (Head of CS)' },
  { code: 'branches.teams.marketing', resource: 'branches.teams', action: 'marketing', description: 'Manage Marketing supervisor teams within a branch (Head of Marketing)' },
  { code: 'cs.scope.global', resource: 'cs.scope', action: 'global', description: 'Allow Sales workflows across all branches' },
  { code: 'marketing.scope.global', resource: 'marketing.scope', action: 'global', description: 'Allow Marketing workflows across all branches' },
  { code: 'logistics.scope.global', resource: 'logistics.scope', action: 'global', description: 'Allow Logistics workflows across all branches' },
  { code: 'notifications.broadcast', resource: 'notifications', action: 'broadcast', description: 'Create broadcasts / manage push automations' },
  { code: 'cart.delete', resource: 'cart', action: 'delete', description: 'Delete abandoned cart records' },
  { code: 'rbac.templates.manage', resource: 'rbac.templates', action: 'manage', description: 'Create/edit permission role templates' },
  { code: 'marketing.requestFunding.orgWide', resource: 'marketing', action: 'requestFundingOrgWide', description: 'Request upstream funding without an active branch context' },
  { code: 'mirror.any', resource: 'mirror', action: 'any', description: 'Mirror any eligible user (dangerous — SuperAdmin only)' },
  { code: 'mirror.cs_team', resource: 'mirror', action: 'cs_team', description: 'Mirror Sales closers (Head of CS powers)' },
  { code: 'mirror.marketing_team', resource: 'mirror', action: 'marketing_team', description: 'Mirror media buyers (Head of Marketing powers)' },
  { code: 'mirror.logistics_chain', resource: 'mirror', action: 'logistics_chain', description: 'Mirror logistics chain roles (Head of Logistics powers)' },
  { code: 'team.supervise_cs', resource: 'team', action: 'supervise_cs', description: 'Supervise Sales closers within branch teams' },
  { code: 'team.supervise_marketing', resource: 'team', action: 'supervise_marketing', description: 'Supervise media buyers within branch teams' },
  { code: 'team.supervise_logistics', resource: 'team', action: 'supervise_logistics', description: 'Supervise logistics roles within branch teams' },
  { code: 'marketing.funding.request', resource: 'marketing.funding', action: 'request', description: 'Submit a funding request (Media Buyer → HoM, or HoM → Finance)' },
  { code: 'marketing.funding.approve', resource: 'marketing.funding', action: 'approve', description: 'Approve or reject a funding request (HoM, Finance, Admin)' },
  { code: 'marketing.adSpend.approve', resource: 'marketing.ad_spend', action: 'approve', description: 'Approve or reject Media Buyer ad-spend submissions' },
  { code: 'finance.cashRemittance.create', resource: 'finance.cash_remittance', action: 'create', description: 'Record a cash remittance (accountant-led close-out of delivered orders)' },
  { code: 'finance.cashRemittance.markReceived', resource: 'finance.cash_remittance', action: 'mark_received', description: 'Mark a cash remittance Received and cascade orders to COMPLETED' },
  { code: 'orders.createOffline', resource: 'orders', action: 'createOffline', description: 'Create an offline order (Sales manual entry)' },
  { code: 'messaging.templates.create', resource: 'messaging.templates', action: 'create', description: 'Create Sales message templates (SMS / WhatsApp / WhatsApp group)' },
  { code: 'messaging.templates.update', resource: 'messaging.templates', action: 'update', description: 'Update or archive Sales message templates' },
  { code: 'logistics.transferRemittance.markReceived', resource: 'logistics.transfer_remittance', action: 'mark_received', description: 'Mark a 3PL→warehouse stock transfer remittance as received (HoLogistics)' },
  { code: 'logistics.deliveryConfirmation.submit', resource: 'logistics.delivery_confirmation', action: 'submit', description: 'Submit a delivery confirmation request (rider / 3PL manager / HoLogistics)' },
  { code: 'logistics.deliveryConfirmation.review', resource: 'logistics.delivery_confirmation', action: 'review', description: 'List, approve, or reject pending delivery confirmation requests (HoLogistics)' },
  { code: 'hr.onboarding.read', resource: 'hr.onboarding', action: 'read', description: 'View any staff member\'s onboarding profile' },
  { code: 'hr.onboarding.write', resource: 'hr.onboarding', action: 'write', description: 'Edit any staff member\'s onboarding profile' },
  { code: 'hr.onboarding.approve', resource: 'hr.onboarding', action: 'approve', description: 'Approve a submitted staff onboarding profile (locks edits for staff)' },

  // Capability codes that replace hardcoded role checks throughout the services.
  // Permission-first lock (CEO directive): SUPER_ADMIN is the only unconditional
  // bypass; every other gate runs through a code so admins can deputize via the
  // matrix without code changes.
  { code: 'orders.delete', resource: 'orders', action: 'delete', description: 'Soft-delete orders (removes from metrics; row stays in DB). CEO directive 2026-05-23: replaces CANCELLED. Admin/SuperAdmin default. HoCS must request and Admin must approve.' },
  { code: 'orders.line_price.edit', resource: 'orders.line_price', action: 'edit', description: 'Edit line unit prices (and derived totals) on confirmed orders. Branch / supervisor scoping still applies.' },
  {
    code: 'orders.detail.manage',
    resource: 'orders.detail',
    action: 'manage',
    description:
      'Use mutable controls on the admin order-detail page (call, callback, assignment, status actions, and related requests). Order/service-level scope checks still apply.',
  },
  { code: 'orders.confirm.bypass_call_gate', resource: 'orders.confirm', action: 'bypass_call_gate', description: 'Confirm an order without the 15-second call-duration evidence (off-platform 3PL workflows)' },
  { code: 'orders.delivery.confirm', resource: 'orders.delivery', action: 'confirm', description: 'Mark an order DELIVERED via the Sales / Logistics rider-proxy path' },
  { code: 'orders.update.any_branch', resource: 'orders.update', action: 'any_branch', description: 'Update orders that have no branch context (org-wide heads)' },
  { code: 'orders.assign', resource: 'orders', action: 'assign', description: 'Assign or reassign orders to Sales closers' },
  {
    code: 'orders.cs.transfer_any_status',
    resource: 'orders.cs',
    action: 'transfer_any_status',
    description:
      'Transfer the assigned Sales closer of an order at ANY status (including confirmed, dispatched, delivered, remitted) for credit-attribution fixes. Status is preserved — only the assignee changes. Audited.',
  },
  { code: 'users.staff.update_supervised', resource: 'users.staff', action: 'update_supervised', description: 'Narrow-edit (capacity / products / visible statuses) on direct reports — Heads use this without holding full users.update' },
  { code: 'voip.toggle', resource: 'voip', action: 'toggle', description: 'Enable or disable VOIP at the system level' },
  { code: 'branches.manage_users', resource: 'branches', action: 'manage_users', description: 'Add or remove users on a branch (Branch Admin scoped to their branch)' },

  // Permission-request approval — one code per request type. Anyone with a code
  // sees those rows on `/admin/permission-requests` and can approve / reject them.
  // Submitters always see their own rows regardless of these grants.
  { code: 'permission_requests.user_creation.approve', resource: 'permission_requests.user_creation', action: 'approve', description: 'Approve / reject pending USER_CREATION requests (HR-side new admin invites)' },
  { code: 'permission_requests.role_change.approve', resource: 'permission_requests.role_change', action: 'approve', description: 'Approve / reject pending ROLE_CHANGE requests (promotion to admin-level role)' },
  { code: 'permission_requests.permission_grant.approve', resource: 'permission_requests.permission_grant', action: 'approve', description: 'Approve / reject pending PERMISSION_GRANT requests' },
  { code: 'permission_requests.product_archive.approve', resource: 'permission_requests.product_archive', action: 'approve', description: 'Approve / reject pending PRODUCT_ARCHIVE requests (locked to SuperAdmin by CEO directive — grant cautiously)' },
  { code: 'permission_requests.order_line_price.approve', resource: 'permission_requests.order_line_price', action: 'approve', description: 'Approve / reject pending ORDER_LINE_PRICE_CHANGE requests (per-order branch / assignee context still applies)' },
  { code: 'permission_requests.order_deletion.approve', resource: 'permission_requests.order_deletion', action: 'approve', description: 'Approve / reject pending ORDER_DELETION requests (per-order branch / assignee context still applies)' },

  // Per-domain export gates. CEO directive: download/CSV/XLSX is permission-first
  // so admins can deputize export rights to specific users (senior CS, MB, etc.)
  // without code changes. Holding the read code on a domain is the precondition
  // for browsing the data; the export code is an *additional* grant on top.
  { code: 'orders.export', resource: 'orders', action: 'export', description: 'Download CSV / XLSX of orders (Sales, marketing, logistics, admin orders pages)' },
  { code: 'inventory.export', resource: 'inventory', action: 'export', description: 'Download CSV / XLSX of stock levels + movements' },
  { code: 'marketing.export', resource: 'marketing', action: 'export', description: 'Download CSV / XLSX of ad spend, funding ledger, marketing team performance' },
  { code: 'finance.export', resource: 'finance', action: 'export', description: 'Download CSV / XLSX of disbursements, delivery remittances, invoices, P&L' },
  { code: 'hr.export', resource: 'hr', action: 'export', description: 'Download payroll batch payout documents (sensitive — includes bank fields)' },
  { code: 'audit.export', resource: 'audit', action: 'export', description: 'Download CSV of the audit trail' },
];

export const CANONICAL_PERMISSIONS: PermissionCatalogEntry[] = [
  ...new Map(
    PERMISSIONS.map((p) => {
      const code = canonicalPermissionCode(p.code);
      const parts = code.split('.');
      const action = parts.at(-1) ?? p.action;
      const resource = parts.slice(0, -1).join('.') || p.resource;
      return [code, { ...p, code, resource, action }];
    }),
  ).values(),
];

export const ALL_PERMISSION_CODES: string[] = CANONICAL_PERMISSIONS.map((p) => p.code);

/**
 * Role → permission codes. Admin is `ALL_PERMISSION_CODES` (full bypass at runtime
 * via `permissionProcedure`). SuperAdmin is `[]` because every gate short-circuits
 * for them at the middleware layer.
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [],
  // SUPPORT gets ALL_PERMISSION_CODES (like ADMIN) so the session carries
  // every permission for both server-side and client-side gate checks.
  // All mutations are still blocked at the tRPC middleware layer.
  SUPPORT: ALL_PERMISSION_CODES,
  ADMIN: ALL_PERMISSION_CODES,
  BRANCH_ADMIN: [
    'orders.read',
    'users.read',
    'audit.read',
    'products.read',
    'categories.read',
    'inventory.read',
    'logistics.read',
    'marketing.read',
    'finance.read',
    'hr.read',
    'settings.write',
    'branches.manage',
    'branches.manage_users',
    'branches.teams.cs',
    'branches.teams.marketing',
    'orders.line_price.edit',
    'orders.detail.manage',
    'orders.confirm.bypass_call_gate',
    'orders.delivery.confirm',
    'orders.assign',
    // `orders.routing` is intentionally NOT granted to BRANCH_ADMIN. The CS
    // routing page is global (writes fan out to every branch's settings) —
    // a single Branch Admin shouldn't be able to flip the org-wide routing
    // mode or reassign products globally. Admin-class + Head of CS only.
    // Branch admins approve order-domain requests for orders in their branch
    // (per-order context check still runs in the service).
    'permission_requests.order_line_price.approve',
    'permission_requests.order_deletion.approve',
    // Branch admin is the source authority for WAREHOUSE locations in their branch
    // (alongside Stock Manager) — see Transfer Approval Gate in CLAUDE.md.
    'inventory.approveTransfer',
    // Branch admin owns the branch end-to-end and can pull data downloads for
    // any domain they read (orders + inventory + finance + audit + HR).
    'orders.export',
    'inventory.export',
    'finance.export',
    'audit.export',
    'hr.export',
    'marketing.export',
    // Page-scoped slice of logistics.read so Branch Admin keeps Logistics
    // companies visibility after the 2026-05 split. Branch Admin never had
    // transfers.read, so partner transfers remains out of scope.
    'logistics.providers.view',
  ],
  HEAD_OF_MARKETING: [
    'marketing.read',
    'marketing.funding',
    'marketing.fundingSummary',
    'marketing.leaderboard',
    'marketing.checkHighCpa',
    'marketing.campaigns',
    'marketing.teamOverview',
    'marketing.orders',
    'marketing.requestFunding.orgWide',
    'marketing.funding.request',
    'marketing.funding.approve',
    'marketing.adSpend',
    'marketing.adSpend.approve',
    // `products.read` removed by CEO directive — Marketing should not access
    // the catalogue admin page. Product pickers on ad-spend / campaign /
    // funding forms still work because `products.list` / `products.options`
    // / `products.getById` are `authedProcedure` (any authed user reads).
    'users.read',
    'users.staff.update_supervised',
    'audit.read',
    'mirror.marketing_team',
    'team.supervise_marketing',
    'marketing.export',
    'orders.export',
    'branches.teams.marketing',
  ],
  MEDIA_BUYER: [
    'marketing.read',
    'marketing.adSpend',
    'marketing.leaderboard',
    'marketing.campaigns',
    'marketing.orders',
    // `products.read` removed by CEO directive — same reasoning as
    // HEAD_OF_MARKETING above. The product picker on the ad-spend modal
    // still works (authedProcedure on `products.list` / `products.options`).
    'marketing.funding.request',
  ],
  HEAD_OF_CS: [
    'orders.read',
    'orders.reassign',
    'orders.bulkTransition',
    'orders.bulkAssign',
    'orders.csWorkloads',
    'orders.releaseLocks',
    'orders.inactiveAgents',
    'orders.csLeaderboard',
    'orders.callbackQueue',
    'orders.scheduledCallbacks',
    'orders.flaggedDuplicates',
    'orders.mergeDuplicate',
    'orders.dismissDuplicate',
    'cs.teamOverview',
    'cs.leaderboard',
    'cart.read',
    'users.read',
    'audit.read',
    'products.read',
    'mirror.cs_team',
    'team.supervise_cs',
    'cs.scope.global',
    'orders.createOffline',
    'messaging.templates.create',
    'messaging.templates.update',
    'orders.line_price.edit',
    'orders.detail.manage',
    'orders.confirm.bypass_call_gate',
    'orders.delivery.confirm',
    'orders.update.any_branch',
    'orders.assign',
    'orders.cs.transfer_any_status',
    'users.staff.update_supervised',
    // HoCS approves CS-side order-domain requests (per-order assignee context still
    // applies in the service so they only act on orders for their team).
    'permission_requests.order_line_price.approve',
    'permission_requests.order_deletion.approve',
    'orders.export',
    'branches.teams.cs',
    'orders.routing',
  ],
  CS_CLOSER: [
    'orders.read',
    'orders.csLeaderboard',
    'orders.callbackQueue',
    'orders.scheduledCallbacks',
    'orders.flaggedDuplicates',
    'orders.dismissDuplicate',
    'orders.detail.manage',
    'cs.leaderboard',
    'cart.read',
    'orders.createOffline',
    'messaging.templates.create',
    'messaging.templates.update',
  ],
  FINANCE_OFFICER: [
    'finance.read',
    'finance.costView',
    'finance.approve',
    'finance.disburse',
    'orders.read',
    'audit.read',
    'users.read',
    // Marketing access intentionally excluded: Head of Marketing owns
    // marketing workflows; Finance acts via finance pages only.
    'finance.cashRemittance.create',
    'finance.cashRemittance.markReceived',
    'finance.export',
    'orders.export',
    'audit.export',
  ],
  // Permission inbox: order line price + archive approvals from CS (`permission_requests.*`),
  // plus direct line-price edits via `orders.line_price.edit`. Org-wide scope via
  // `logistics.scope.global` powers `canActorEditOrderLinePrices` for cross-branch orders.
  HEAD_OF_LOGISTICS: [
    'orders.read',
    'orders.bulkTransition',
    'logistics.read',
    'logistics.write',
    'logistics.teamOverview',
    'inventory.read',
    'inventory.shipments.read',
    'inventory.transfer',
    'inventory.approveTransfer',
    'inventory.verifyTransfer',
    'inventory.intake',
    'inventory.lowStockAlerts',
    'inventory.warehouses.write',
    'returns.read',
    'inventory.returnedOrders',
    'inventory.reconciliations',
    'inventory.createReconciliation',
    'inventory.resolveReconciliation',
    'audit.read',
    'mirror.logistics_chain',
    'team.supervise_logistics',
    'logistics.scope.global',
    'logistics.transferRemittance.markReceived',
    'logistics.deliveryConfirmation.submit',
    'logistics.deliveryConfirmation.review',
    'orders.line_price.edit',
    'orders.detail.manage',
    'orders.delivery.confirm',
    'orders.update.any_branch',
    // HoLogistics approves logistics-side order-domain requests (per-order branch
    // context still applies in the service).
    'permission_requests.order_line_price.approve',
    'permission_requests.order_deletion.approve',
    'transfers.read',
    'finance.read',
    'orders.export',
    'inventory.export',
    // Page-scoped slices of logistics.read / transfers.read — preserves
    // visibility after the 2026-05 split into per-page codes.
    'logistics.providers.view',
    'logistics.partner_transfers.view',
  ],
  STOCK_MANAGER: [
    'inventory.read',
    'inventory.shipments.read',
    'inventory.intake',
    'inventory.transfer',
    'inventory.approveTransfer',
    'inventory.verifyTransfer',
    'inventory.adjust',
    'inventory.lowStockAlerts',
    'inventory.createReconciliation',
    'inventory.resolveReconciliation',
    'inventory.reconciliations',
    'inventory.warehouses.write',
    'logistics.read',
    'transfers.read',
    'returns.read',
    'orders.read',
    'products.read',
    'products.create',
    'products.update',
    'products.offers',
    'categories.read',
    'categories.write',
    'inventory.export',
    // Page-scoped slices of logistics.read / transfers.read — preserves
    // visibility after the 2026-05 split into per-page codes.
    'logistics.providers.view',
    'logistics.partner_transfers.view',
  ],
  TPL_MANAGER: [
    'inventory.read',
    'inventory.approveTransfer',
    'inventory.verifyTransfer',
    'inventory.returnedOrders',
    'inventory.createReconciliation',
    'inventory.reconciliations',
    'logistics.read',
    'logistics.remit',
    'orders.read',
    'orders.delivery.confirm',
    'transfers.read',
    'returns.read',
    'logistics.deliveryConfirmation.submit',
    // Page-scoped slices of logistics.read / transfers.read — preserves
    // visibility after the 2026-05 split into per-page codes.
    'logistics.providers.view',
    'logistics.partner_transfers.view',
  ],
  TPL_RIDER: [
    'rider.dashboard',
    'logistics.deliveryConfirmation.submit',
  ],
  HR_MANAGER: [
    'hr.read',
    'hr.write',
    'hr.approveAdjustment',
    'users.read',
    'users.create',
    'users.update',
    // HR manages the org's branch catalogue (CEO directive 2026-05-11) —
    // creates new branches, edits names / codes / status, assigns users
    // to branches. SuperAdmin / Admin still cover the same surface; HR
    // joins them by default so day-to-day staff-org changes don't need a
    // SuperAdmin handoff. `branches.manage_users` mirrors the same intent
    // for branch-membership writes.
    'branches.manage',
    'branches.manage_users',
    'notifications.broadcast',
    'audit.read',
    'hr.onboarding.read',
    'hr.onboarding.write',
    'hr.onboarding.approve',
    // HR approves user-management requests (admin-level invites, role changes,
    // permission grants — but NOT product archive, which stays SuperAdmin-only).
    'permission_requests.user_creation.approve',
    'permission_requests.role_change.approve',
    'permission_requests.permission_grant.approve',
    'hr.export',
  ],
};
