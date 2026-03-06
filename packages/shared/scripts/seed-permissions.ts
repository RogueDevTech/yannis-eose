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

// Load .env from repo root (when run via pnpm from packages/shared, cwd is packages/shared)
config({ path: path.resolve(process.cwd(), '../../.env') });

const PERMISSIONS: Array<{ code: string; resource: string; action: string; description?: string }> = [
  { code: 'ceo.overview', resource: 'ceo', action: 'overview', description: 'View CEO dashboard' },
  { code: 'orders.read', resource: 'orders', action: 'read', description: 'View orders' },
  { code: 'orders.reassign', resource: 'orders', action: 'reassign', description: 'Reassign CS orders' },
  { code: 'orders.requestTransfer', resource: 'orders', action: 'requestTransfer', description: 'Request order transfer to another CS agent' },
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
  { code: 'logistics.write', resource: 'logistics', action: 'write', description: 'Create/update logistics providers and locations' },
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
  { code: 'users.read', resource: 'users', action: 'read', description: 'View users/staff list' },
  { code: 'users.create', resource: 'users', action: 'create', description: 'Create users' },
  { code: 'users.update', resource: 'users', action: 'update', description: 'Update users' },
  { code: 'users.deactivate', resource: 'users', action: 'deactivate', description: 'Deactivate users' },
  { code: 'audit.read', resource: 'audit', action: 'read', description: 'View audit trail' },
  { code: 'settings.write', resource: 'settings', action: 'write', description: 'Update system settings' },
  { code: 'rider.dashboard', resource: 'rider', action: 'dashboard', description: 'Rider dashboard' },
  { code: 'cart.read', resource: 'cart', action: 'read', description: 'View cart abandonment data (CS dashboard)' },
];

// role -> permission codes
const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: [], // bypasses all checks - no need to store
  HEAD_OF_MARKETING: ['marketing.read', 'marketing.funding', 'marketing.fundingSummary', 'marketing.leaderboard', 'marketing.checkHighCpa', 'marketing.offerTemplate', 'marketing.campaigns', 'marketing.teamOverview', 'marketing.orders', 'products.read', 'users.read'],
  MEDIA_BUYER: ['marketing.read', 'marketing.adSpend', 'marketing.leaderboard', 'marketing.campaigns', 'marketing.orders', 'products.read'],
  HEAD_OF_CS: ['orders.read', 'orders.reassign', 'orders.requestTransfer', 'orders.bulkTransition', 'orders.bulkAssign', 'orders.csWorkloads', 'orders.releaseLocks', 'orders.inactiveAgents', 'orders.csLeaderboard', 'orders.callbackQueue', 'orders.scheduledCallbacks', 'orders.flaggedDuplicates', 'orders.mergeDuplicate', 'orders.dismissDuplicate', 'cs.teamOverview', 'cs.leaderboard', 'cart.read', 'users.read'],
  CS_AGENT: ['orders.read', 'orders.requestTransfer', 'orders.csLeaderboard', 'orders.callbackQueue', 'orders.scheduledCallbacks', 'orders.flaggedDuplicates', 'orders.dismissDuplicate', 'cs.leaderboard', 'cart.read'],
  FINANCE_OFFICER: ['finance.read', 'finance.costView', 'finance.approve', 'finance.disburse', 'marketing.fundingSummary', 'orders.read'],
  HEAD_OF_LOGISTICS: ['orders.read', 'orders.bulkTransition', 'logistics.read', 'logistics.write', 'inventory.read', 'inventory.lowStockAlerts'],
  WAREHOUSE_MANAGER: ['inventory.read', 'inventory.intake', 'inventory.transfer', 'inventory.adjust', 'inventory.lowStockAlerts', 'inventory.createReconciliation', 'inventory.resolveReconciliation', 'inventory.reconciliations', 'transfers.read', 'returns.read', 'products.read', 'products.create', 'categories.read', 'categories.write'],
  TPL_MANAGER: ['inventory.verifyTransfer', 'inventory.returnedOrders', 'inventory.createReconciliation', 'inventory.reconciliations', 'logistics.read', 'logistics.remit', 'orders.read', 'transfers.read', 'returns.read'],
  TPL_RIDER: ['rider.dashboard'],
  HR_MANAGER: ['hr.read', 'hr.write', 'users.read', 'users.create', 'users.update'],
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
  for (const p of PERMISSIONS) {
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
      const permId = permMap.get(code);
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
      const permId = permMap.get(code);
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

  console.log(`  Permissions: ${permInserted} new, ${PERMISSIONS.length - permInserted} already existed`);
  console.log(`  Role assignments: ${rpDeleted} revoked, ${rpInserted} new added`);
  console.log('  Done.\n');
  await sql.end();
}

seedPermissions().catch((err) => {
  console.error(err);
  process.exit(1);
});
