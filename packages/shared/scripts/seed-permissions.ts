/**
 * Seed RBAC permissions and role_permissions.
 * Sync mode: adds missing permissions and role assignments. Safe to run on prod.
 * - Inserts permissions with ON CONFLICT (code) DO NOTHING
 * - Inserts role_permissions with ON CONFLICT DO NOTHING
 *
 * Usage: pnpm db:seed-permissions (from repo root; loads .env automatically)
 *        DATABASE_URL=... pnpm db:seed-permissions (override for prod)
 */

import { config } from 'dotenv';
import path from 'path';
import postgres from 'postgres';
import { canonicalPermissionCode } from '../src/rbac/permission-codes';

// Load .env from repo root (when run via pnpm from packages/shared, cwd is packages/shared)
config({ path: path.resolve(process.cwd(), '../../.env') });

const PERMISSIONS: Array<{ code: string; resource: string; action: string; description?: string }> = [
  { code: 'ceo.overview', resource: 'ceo', action: 'overview', description: 'View CEO dashboard' },
  { code: 'orders.read', resource: 'orders', action: 'read', description: 'View orders' },
  { code: 'orders.reassign', resource: 'orders', action: 'reassign', description: 'Reassign CS orders' },
  { code: 'orders.bulkTransition', resource: 'orders', action: 'bulkTransition', description: 'Bulk order status transitions' },
  { code: 'orders.bulkAssign', resource: 'orders', action: 'bulkAssign', description: 'Bulk assign orders to CS' },
  { code: 'orders.csWorkloads', resource: 'orders', action: 'csWorkloads', description: 'View CS workloads' },
  { code: 'orders.releaseLocks', resource: 'orders', action: 'releaseLocks', description: 'Release expired order locks' },
  { code: 'orders.inactiveAgents', resource: 'orders', action: 'inactiveAgents', description: 'View inactive CS agents' },
  { code: 'orders.csLeaderboard', resource: 'orders', action: 'csLeaderboard', description: 'View CS leaderboard' },
  { code: 'orders.callbackQueue', resource: 'orders', action: 'callbackQueue', description: 'View callback queue' },
  { code: 'orders.scheduledCallbacks', resource: 'orders', action: 'scheduledCallbacks', description: 'View scheduled callbacks' },
  { code: 'orders.flaggedDuplicates', resource: 'orders', action: 'flaggedDuplicates', description: 'View flagged duplicates' },
  { code: 'orders.mergeDuplicate', resource: 'orders', action: 'mergeDuplicate', description: 'Merge duplicate orders' },
  { code: 'orders.dismissDuplicate', resource: 'orders', action: 'dismissDuplicate', description: 'Dismiss duplicate flag' },
  { code: 'cs.dashboard', resource: 'cs', action: 'dashboard', description: 'CS dashboard' },
  { code: 'cs.teamOverview', resource: 'cs', action: 'teamOverview', description: 'CS team overview (Head of CS only)' },
  { code: 'cs.leaderboard', resource: 'cs', action: 'leaderboard', description: 'CS leaderboard' },
  { code: 'products.read', resource: 'products', action: 'read', description: 'View products' },
  { code: 'products.create', resource: 'products', action: 'create', description: 'Create products' },
  { code: 'products.update', resource: 'products', action: 'update', description: 'Update products' },
  { code: 'categories.read', resource: 'categories', action: 'read', description: 'View categories' },
  { code: 'categories.write', resource: 'categories', action: 'write', description: 'Create/update categories' },
  { code: 'inventory.read', resource: 'inventory', action: 'read', description: 'View inventory' },
  { code: 'inventory.intake', resource: 'inventory', action: 'intake', description: 'Stock intake' },
  { code: 'inventory.transfer', resource: 'inventory', action: 'transfer', description: 'Transfer stock' },
  { code: 'inventory.verifyTransfer', resource: 'inventory', action: 'verifyTransfer', description: 'Verify received transfer' },
  { code: 'inventory.adjust', resource: 'inventory', action: 'adjust', description: 'Adjust stock' },
  { code: 'inventory.lowStockAlerts', resource: 'inventory', action: 'lowStockAlerts', description: 'View low stock alerts' },
  { code: 'inventory.returnedOrders', resource: 'inventory', action: 'returnedOrders', description: 'View returned orders' },
  { code: 'inventory.createReconciliation', resource: 'inventory', action: 'createReconciliation', description: 'Create stock reconciliation' },
  { code: 'inventory.resolveReconciliation', resource: 'inventory', action: 'resolveReconciliation', description: 'Resolve reconciliation' },
  { code: 'inventory.reconciliations', resource: 'inventory', action: 'reconciliations', description: 'View reconciliations' },
  { code: 'transfers.read', resource: 'transfers', action: 'read', description: 'View transfers' },
  { code: 'returns.read', resource: 'returns', action: 'read', description: 'View returns' },
  { code: 'logistics.read', resource: 'logistics', action: 'read', description: 'View logistics' },
  { code: 'logistics.write', resource: 'logistics', action: 'write', description: 'Create/update logistics companies and locations' },
  { code: 'logistics.remit', resource: 'logistics', action: 'remit', description: 'Submit transfer remittance to warehouse (3PL)' },
  { code: 'marketing.read', resource: 'marketing', action: 'read', description: 'View marketing' },
  { code: 'marketing.funding', resource: 'marketing', action: 'funding', description: 'Create funding records' },
  { code: 'marketing.fundingSummary', resource: 'marketing', action: 'fundingSummary', description: 'View funding summary' },
  { code: 'marketing.adSpend', resource: 'marketing', action: 'adSpend', description: 'Log ad spend' },
  { code: 'marketing.leaderboard', resource: 'marketing', action: 'leaderboard', description: 'View marketing leaderboard' },
  { code: 'marketing.checkHighCpa', resource: 'marketing', action: 'checkHighCpa', description: 'Check high CPA' },
  { code: 'marketing.offerTemplate', resource: 'marketing', action: 'offerTemplate', description: 'Create/update offer templates' },
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
  // Legacy aliases kept for coverage/tooling during rollout (canonicalized at seed/runtime).
  { code: 'users.read', resource: 'users', action: 'read', description: 'Legacy alias for users.staff.view' },
  { code: 'users.create', resource: 'users', action: 'create', description: 'Legacy alias for users.staff.create' },
  { code: 'users.update', resource: 'users', action: 'update', description: 'Legacy alias for users.staff.update' },
  { code: 'users.deactivate', resource: 'users', action: 'deactivate', description: 'Legacy alias for users.staff.deactivate' },
  { code: 'audit.read', resource: 'audit', action: 'read', description: 'View audit trail' },
  { code: 'settings.write', resource: 'settings', action: 'write', description: 'Update system settings' },
  { code: 'rider.dashboard', resource: 'rider', action: 'dashboard', description: 'Rider dashboard' },
  { code: 'cart.read', resource: 'cart', action: 'read', description: 'View cart abandonment data (CS dashboard)' },
  { code: 'branches.manage', resource: 'branches', action: 'manage', description: 'Create, update, and assign users to branches (SuperAdmin only)' },
  { code: 'branches.view_all', resource: 'branches', action: 'view_all', description: 'View data across all branches (global visibility bypass) — grant sparingly' },
  { code: 'cs.scope.global', resource: 'cs.scope', action: 'global', description: 'Allow CS workflows across all branches' },
  { code: 'marketing.scope.global', resource: 'marketing.scope', action: 'global', description: 'Allow Marketing workflows across all branches' },
  { code: 'logistics.scope.global', resource: 'logistics.scope', action: 'global', description: 'Allow Logistics workflows across all branches' },
  { code: 'notifications.broadcast', resource: 'notifications', action: 'broadcast', description: 'Create broadcasts / manage push automations' },
  { code: 'cart.delete', resource: 'cart', action: 'delete', description: 'Delete abandoned cart records' },
  { code: 'rbac.templates.manage', resource: 'rbac.templates', action: 'manage', description: 'Create/edit permission role templates' },
  { code: 'marketing.requestFunding.orgWide', resource: 'marketing', action: 'requestFundingOrgWide', description: 'Request upstream funding without an active branch context' },
  { code: 'mirror.any', resource: 'mirror', action: 'any', description: 'Mirror any eligible user (dangerous — SuperAdmin only)' },
  { code: 'mirror.cs_team', resource: 'mirror', action: 'cs_team', description: 'Mirror CS agents (Head of CS powers)' },
  { code: 'mirror.marketing_team', resource: 'mirror', action: 'marketing_team', description: 'Mirror media buyers (Head of Marketing powers)' },
  { code: 'mirror.logistics_chain', resource: 'mirror', action: 'logistics_chain', description: 'Mirror logistics chain roles (Head of Logistics powers)' },
  { code: 'team.supervise_cs', resource: 'team', action: 'supervise_cs', description: 'Supervise CS agents within branch teams' },
  { code: 'team.supervise_marketing', resource: 'team', action: 'supervise_marketing', description: 'Supervise media buyers within branch teams' },
  { code: 'team.supervise_logistics', resource: 'team', action: 'supervise_logistics', description: 'Supervise logistics roles within branch teams' },
  // Phase 20 — fine-grained capabilities split out from hardcoded role checks.
  // Granting these to a custom role lets you redistribute work without giving
  // away the whole HEAD_OF_MARKETING / FINANCE_OFFICER role.
  { code: 'marketing.funding.request', resource: 'marketing.funding', action: 'request', description: 'Submit a funding request (Media Buyer → HoM, or HoM → Finance)' },
  { code: 'marketing.funding.approve', resource: 'marketing.funding', action: 'approve', description: 'Approve or reject a funding request (HoM, Finance, Admin)' },
  { code: 'marketing.adSpend.approve', resource: 'marketing.ad_spend', action: 'approve', description: 'Approve or reject Media Buyer ad-spend submissions' },
  { code: 'finance.cashRemittance.create', resource: 'finance.cash_remittance', action: 'create', description: 'Record a cash remittance (accountant-led close-out of delivered orders)' },
  { code: 'finance.cashRemittance.markReceived', resource: 'finance.cash_remittance', action: 'mark_received', description: 'Mark a cash remittance Received and cascade orders to COMPLETED' },
  // Phase 21 — additional fine-grained capabilities for router/service gates that
  // were previously hardcoded role lists.
  { code: 'orders.createOffline', resource: 'orders', action: 'createOffline', description: 'Create an offline order (CS manual entry)' },
  { code: 'messaging.templates.create', resource: 'messaging.templates', action: 'create', description: 'Create CS message templates (SMS / WhatsApp / WhatsApp group)' },
  { code: 'messaging.templates.update', resource: 'messaging.templates', action: 'update', description: 'Update or archive CS message templates' },
  { code: 'logistics.transferRemittance.markReceived', resource: 'logistics.transfer_remittance', action: 'mark_received', description: 'Mark a 3PL→warehouse stock transfer remittance as received (HoLogistics)' },
  { code: 'logistics.deliveryConfirmation.submit', resource: 'logistics.delivery_confirmation', action: 'submit', description: 'Submit a delivery confirmation request (rider / 3PL manager / HoLogistics)' },
  { code: 'logistics.deliveryConfirmation.review', resource: 'logistics.delivery_confirmation', action: 'review', description: 'List, approve, or reject pending delivery confirmation requests (HoLogistics)' },
  // Phase 22 — staff onboarding (HR record-keeping; does not gate account login).
  { code: 'hr.onboarding.read', resource: 'hr.onboarding', action: 'read', description: 'View any staff member\'s onboarding profile' },
  { code: 'hr.onboarding.write', resource: 'hr.onboarding', action: 'write', description: 'Edit any staff member\'s onboarding profile' },
  { code: 'hr.onboarding.approve', resource: 'hr.onboarding', action: 'approve', description: 'Approve a submitted staff onboarding profile (locks edits for staff)' },
];

const CANONICAL_PERMISSIONS: Array<{ code: string; resource: string; action: string; description?: string }> = [
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

const ALL_PERMISSION_CODES: string[] = CANONICAL_PERMISSIONS.map((p) => p.code);

// role -> permission codes
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [], // bypasses all checks - no need to store
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
  ],
  HEAD_OF_MARKETING: [
    'marketing.read',
    'marketing.funding',
    'marketing.fundingSummary',
    'marketing.leaderboard',
    'marketing.checkHighCpa',
    'marketing.offerTemplate',
    'marketing.campaigns',
    'marketing.teamOverview',
    'marketing.orders',
    'marketing.requestFunding.orgWide',
    // Phase 20 — explicit moderation + request capabilities (replaces hardcoded role checks)
    'marketing.funding.request',
    'marketing.funding.approve',
    'marketing.adSpend.approve',
    'products.read',
    'users.read',
    'audit.read',
    'mirror.marketing_team',
    'team.supervise_marketing',
    'marketing.scope.global',
  ],
  MEDIA_BUYER: [
    'marketing.read',
    'marketing.adSpend',
    'marketing.leaderboard',
    'marketing.campaigns',
    'marketing.orders',
    'products.read',
    // Phase 20 — MB requests funding from HoM via this capability
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
    'mirror.cs_team',
    'team.supervise_cs',
    'cs.scope.global',
    // Phase 21
    'orders.createOffline',
    'messaging.templates.create',
    'messaging.templates.update',
  ],
  CS_AGENT: [
    'orders.read',
    'orders.csLeaderboard',
    'orders.callbackQueue',
    'orders.scheduledCallbacks',
    'orders.flaggedDuplicates',
    'orders.dismissDuplicate',
    'cs.leaderboard',
    'cart.read',
    // Phase 21
    'orders.createOffline',
    'messaging.templates.create',
    'messaging.templates.update',
  ],
  FINANCE_OFFICER: [
    'finance.read',
    'finance.costView',
    'finance.approve',
    'finance.disburse',
    'marketing.read',
    'marketing.fundingSummary',
    'orders.read',
    'audit.read',
    'users.read',
    // Phase 20 — fine-grained Finance capabilities
    'marketing.funding.approve',
    'finance.cashRemittance.create',
    'finance.cashRemittance.markReceived',
  ],
  HEAD_OF_LOGISTICS: [
    'orders.read',
    'orders.bulkTransition',
    'logistics.read',
    'logistics.write',
    'inventory.read',
    'inventory.verifyTransfer',
    'inventory.lowStockAlerts',
    // Returns & reconciliation live under Logistics in the admin nav; HoLogistics approves submissions.
    'returns.read',
    'inventory.returnedOrders',
    'inventory.reconciliations',
    'inventory.createReconciliation',
    'inventory.resolveReconciliation',
    'audit.read',
    'mirror.logistics_chain',
    'team.supervise_logistics',
    'logistics.scope.global',
    // Phase 21 — explicit gates for transfer remittance receipt + delivery confirmations
    'logistics.transferRemittance.markReceived',
    'logistics.deliveryConfirmation.submit',
    'logistics.deliveryConfirmation.review',
  ],
  STOCK_MANAGER: [
    'inventory.read',
    'inventory.intake',
    'inventory.transfer',
    'inventory.verifyTransfer',
    'inventory.adjust',
    'inventory.lowStockAlerts',
    'inventory.createReconciliation',
    'inventory.resolveReconciliation',
    'inventory.reconciliations',
    'transfers.read',
    'returns.read',
    'products.read',
    'products.create',
    'categories.read',
    'categories.write',
  ],
  TPL_MANAGER: [
    'inventory.read',
    'inventory.verifyTransfer',
    'inventory.returnedOrders',
    'inventory.createReconciliation',
    'inventory.reconciliations',
    'logistics.read',
    'logistics.remit',
    'orders.read',
    'transfers.read',
    'returns.read',
    // Phase 21 — 3PL managers submit delivery confirmations for HoL approval
    'logistics.deliveryConfirmation.submit',
  ],
  TPL_RIDER: [
    'rider.dashboard',
    // Phase 21 — riders submit delivery confirmations from the field
    'logistics.deliveryConfirmation.submit',
  ],
  HR_MANAGER: [
    'hr.read',
    'hr.write',
    'users.read',
    'users.create',
    'users.update',
    'audit.read',
    // Phase 22 — HR owns the onboarding workflow.
    'hr.onboarding.read',
    'hr.onboarding.write',
    'hr.onboarding.approve',
  ],
  // hr.approveAdjustment: SuperAdmin only (not in any role — bypass)
  // finance.initMaterializedViews: SuperAdmin only (not in any role — bypass)
};

async function seedPermissions() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  console.log('Syncing RBAC permissions...\n');

  // Insert permissions — add any missing (ON CONFLICT DO NOTHING)
  let permInserted = 0;
  for (const p of CANONICAL_PERMISSIONS) {
    const result = await sql`
      INSERT INTO permissions (id, code, resource, action, description)
      VALUES (gen_random_uuid(), ${p.code}, ${p.resource}, ${p.action}, ${p.description ?? null})
      ON CONFLICT (code) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) permInserted++;
  }

  // Build permission id map
  const permMap = new Map<string, string>();
  const perms = await sql`SELECT id, code FROM permissions`;
  for (const p of perms) {
    permMap.set(p.code, p.id);
  }

  // Allowed permission IDs per role (source of truth)
  const roleAllowedPermIds = new Map<string, Set<string>>();
  for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
    if (role === 'SUPER_ADMIN') continue;
    const ids = new Set<string>();
    for (const code of codes) {
      const permId = permMap.get(canonicalPermissionCode(code));
      if (permId) ids.add(permId);
    }
    roleAllowedPermIds.set(role, ids);
  }

  // Remove role_permissions that are no longer in ROLE_PERMISSIONS (revoke removed permissions)
  let rpDeleted = 0;
  const allRolePerms = await sql`
    SELECT rp.role::text, rp.permission_id
    FROM role_permissions rp
  `;
  for (const row of allRolePerms) {
    const allowed = roleAllowedPermIds.get(row.role);
    if (allowed && !allowed.has(row.permission_id)) {
      await sql`
        DELETE FROM role_permissions
        WHERE role = ${row.role}::user_role AND permission_id = ${row.permission_id}
      `;
      rpDeleted++;
    }
  }

  // Insert role_permissions — add any missing (ON CONFLICT DO NOTHING)
  let rpInserted = 0;
  for (const [role, codes] of Object.entries(ROLE_PERMISSIONS)) {
    if (role === 'SUPER_ADMIN') continue;
    for (const code of codes) {
      const permId = permMap.get(canonicalPermissionCode(code));
      if (permId) {
        const result = await sql`
          INSERT INTO role_permissions (role, permission_id)
          VALUES (${role}::user_role, ${permId})
          ON CONFLICT (role, permission_id) DO NOTHING
          RETURNING role
        `;
        if (result.length > 0) rpInserted++;
      }
    }
  }

  console.log(`  Permissions: ${permInserted} new, ${CANONICAL_PERMISSIONS.length - permInserted} already existed`);
  console.log(`  Role assignments: ${rpDeleted} revoked, ${rpInserted} new added`);

  // Ensure a SYSTEM role_template exists for every role we have permissions
  // for. Without these rows, the /hr/users/new page can't pre-check anything
  // because there's no template to baseline against. Idempotent — uses
  // ON CONFLICT (key) DO NOTHING so re-runs don't churn rows.
  let templatesInserted = 0;
  for (const roleKey of Object.keys(ROLE_PERMISSIONS)) {
    if (roleKey === 'SUPER_ADMIN') continue; // bypasses all permission checks; no template needed
    const templateKey = `SYSTEM.${roleKey}`;
    const niceName = roleKey
      .split('_')
      .map((s) => s[0] + s.slice(1).toLowerCase())
      .join(' ');
    const result = await sql`
      INSERT INTO role_templates (key, name, kind, status, locked, mapped_role)
      VALUES (${templateKey}, ${niceName}, 'SYSTEM', 'ACTIVE', true, ${roleKey}::user_role)
      ON CONFLICT (key) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) templatesInserted++;
  }
  if (templatesInserted > 0) {
    console.log(`  System role templates: ${templatesInserted} new added`);
  }

  // Keep SYSTEM role_templates.role_template_permissions in sync with role_permissions
  // (runtime effective perms prefer template rows when role_template_id is set).
  const systemTemplates = await sql`
    SELECT id, mapped_role::text AS mapped_role
    FROM role_templates
    WHERE kind = 'SYSTEM' AND mapped_role IS NOT NULL
  `;

  let rtpDeleted = 0;
  let rtpInserted = 0;
  for (const t of systemTemplates) {
    const roleKey = t.mapped_role as string;
    const allowed = roleAllowedPermIds.get(roleKey);
    if (!allowed) continue;

    const allRtp = await sql`
      SELECT permission_id
      FROM role_template_permissions
      WHERE role_template_id = ${t.id} AND valid_to IS NULL
    `;
    for (const row of allRtp) {
      if (!allowed.has(row.permission_id as string)) {
        await sql`
          DELETE FROM role_template_permissions
          WHERE role_template_id = ${t.id} AND permission_id = ${row.permission_id}
        `;
        rtpDeleted++;
      }
    }

    for (const permId of allowed) {
      const result = await sql`
        INSERT INTO role_template_permissions (role_template_id, permission_id)
        VALUES (${t.id}, ${permId})
        ON CONFLICT DO NOTHING
        RETURNING role_template_id
      `;
      if (result.length > 0) rtpInserted++;
    }
  }

  console.log(`  System template perms: ${rtpDeleted} revoked, ${rtpInserted} new added`);
  console.log('  Done.\n');
  await sql.end();
}

seedPermissions().catch((err) => {
  console.error(err);
  process.exit(1);
});
