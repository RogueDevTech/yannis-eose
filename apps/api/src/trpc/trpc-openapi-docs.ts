/**
 * OpenAPI/Swagger documentation for all tRPC endpoints.
 * Auto-generated structure — add new procedures here when adding routers.
 *
 * tRPC URL format:
 * - Queries: GET /trpc/{router}.{procedure}?input={json}
 * - Mutations: POST /trpc/{router}.{procedure} with JSON body
 */

import type { OpenAPIObject } from '@nestjs/swagger';

const TRPC_BASE = '/trpc';

/** Procedures that do not require authentication */
const PUBLIC_PROCEDURES = new Set([
  'health.ping',
  'health.echo',
  'orders.create',
  'marketing.getPublic',
  'cart.save',
]);

interface TrpcEndpoint {
  procedure: string;
  method: 'GET' | 'POST';
  summary: string;
  tag: string;
}

const ENDPOINTS: TrpcEndpoint[] = [
  // Health
  { procedure: 'health.ping', method: 'GET', summary: 'Health check', tag: 'Health' },
  { procedure: 'health.whoami', method: 'GET', summary: 'Current authenticated user', tag: 'Health' },
  { procedure: 'health.echo', method: 'GET', summary: 'Echo test with message', tag: 'Health' },

  // Orders
  { procedure: 'orders.create', method: 'POST', summary: 'Create a new order', tag: 'Orders' },
  { procedure: 'orders.getById', method: 'GET', summary: 'Get order by ID', tag: 'Orders' },
  {
    procedure: 'orders.deliveryMovementCustomerNames',
    method: 'GET',
    summary: 'Batch order customer names for inventory DELIVERY movements',
    tag: 'Orders',
  },
  { procedure: 'orders.list', method: 'GET', summary: 'List orders with filters', tag: 'Orders' },
  { procedure: 'orders.transition', method: 'POST', summary: 'Transition order status', tag: 'Orders' },
  { procedure: 'orders.update', method: 'POST', summary: 'Update order details', tag: 'Orders' },
  {
    procedure: 'orders.requestLinePriceChangeApproval',
    method: 'POST',
    summary: 'Request order line price change approval',
    tag: 'Orders',
  },
  {
    procedure: 'orders.requestOrderDeletionApproval',
    method: 'POST',
    summary: 'Request order archive (soft delete) approval',
    tag: 'Orders',
  },
  { procedure: 'orders.softDeleteOrder', method: 'POST', summary: 'Soft-delete (archive) an order', tag: 'Orders' },
  { procedure: 'orders.assignToCS', method: 'POST', summary: 'Assign order to CS agent', tag: 'Orders' },
  { procedure: 'orders.bulkReassign', method: 'POST', summary: 'Bulk reassign orders', tag: 'Orders' },
  { procedure: 'orders.redistributeCSOrders', method: 'POST', summary: 'Redistribute CS-assigned orders', tag: 'Orders' },
  { procedure: 'orders.distributeUnassignedOrders', method: 'POST', summary: 'Distribute unassigned (UNPROCESSED) orders to CS agents', tag: 'Orders' },
  { procedure: 'orders.statusCounts', method: 'GET', summary: 'Get order status counts', tag: 'Orders' },
  { procedure: 'orders.csWorkloads', method: 'GET', summary: 'CS agent workloads', tag: 'Orders' },
  {
    procedure: 'orders.closerWorkloadOrders',
    method: 'GET',
    summary: 'Closer pending workload orders with line items',
    tag: 'Orders',
  },
  { procedure: 'orders.releaseExpiredLocks', method: 'POST', summary: 'Release expired order locks', tag: 'Orders' },
  { procedure: 'orders.inactiveAgents', method: 'GET', summary: 'List inactive CS agents', tag: 'Orders' },
  { procedure: 'orders.csLeaderboard', method: 'GET', summary: 'CS agent leaderboard', tag: 'Orders' },
  { procedure: 'orders.revealPhoneForManualCall', method: 'POST', summary: 'Reveal phone for manual call', tag: 'Orders' },
  { procedure: 'orders.initiateCall', method: 'POST', summary: 'Initiate VOIP call', tag: 'Orders' },
  { procedure: 'orders.getCallLogs', method: 'GET', summary: 'Get order call logs', tag: 'Orders' },
  { procedure: 'orders.latestCall', method: 'GET', summary: 'Get latest call for order', tag: 'Orders' },
  { procedure: 'orders.scheduleCallback', method: 'POST', summary: 'Schedule callback', tag: 'Orders' },
  { procedure: 'orders.callbackQueue', method: 'GET', summary: 'Get callback queue', tag: 'Orders' },
  { procedure: 'orders.scheduledCallbacks', method: 'GET', summary: 'Get scheduled callbacks', tag: 'Orders' },
  { procedure: 'orders.flaggedDuplicates', method: 'GET', summary: 'Get flagged duplicate orders', tag: 'Orders' },
  { procedure: 'orders.mergeDuplicate', method: 'POST', summary: 'Merge duplicate orders', tag: 'Orders' },
  { procedure: 'orders.dismissDuplicate', method: 'POST', summary: 'Dismiss duplicate flag', tag: 'Orders' },
  { procedure: 'orders.bulkTransition', method: 'POST', summary: 'Bulk transition orders', tag: 'Orders' },
  { procedure: 'orders.bulkAssignToCS', method: 'POST', summary: 'Bulk assign orders to CS', tag: 'Orders' },

  // Users
  { procedure: 'users.list', method: 'GET', summary: 'List users with filters', tag: 'Users' },
  {
    procedure: 'users.searchForPushTarget',
    method: 'GET',
    summary: 'Search users for push broadcast picker',
    tag: 'Users',
  },
  { procedure: 'users.getById', method: 'GET', summary: 'Get user by ID', tag: 'Users' },
  { procedure: 'users.updateMyAppTheme', method: 'POST', summary: 'Update current user appearance theme', tag: 'Users' },
  { procedure: 'users.create', method: 'POST', summary: 'Create staff member', tag: 'Users' },
  { procedure: 'users.update', method: 'POST', summary: 'Update staff member', tag: 'Users' },
  { procedure: 'users.deactivate', method: 'POST', summary: 'Deactivate staff member', tag: 'Users' },
  { procedure: 'users.resetPassword', method: 'POST', summary: 'Reset user password', tag: 'Users' },
  { procedure: 'users.getPendingEmailChange', method: 'GET', summary: 'Get pending email change', tag: 'Users' },
  { procedure: 'users.processEmailChange', method: 'POST', summary: 'Process email change', tag: 'Users' },

  // Products
  { procedure: 'products.list', method: 'GET', summary: 'List products', tag: 'Products' },
  { procedure: 'products.getById', method: 'GET', summary: 'Get product by ID', tag: 'Products' },
  { procedure: 'products.create', method: 'POST', summary: 'Create product', tag: 'Products' },
  { procedure: 'products.update', method: 'POST', summary: 'Update product', tag: 'Products' },
  {
    procedure: 'products.requestArchive',
    method: 'POST',
    summary: 'Archive product (Super Admin immediate, or permission request)',
    tag: 'Products',
  },
  { procedure: 'products.categories', method: 'GET', summary: 'Get product categories', tag: 'Products' },

  // Product Categories
  { procedure: 'productCategories.list', method: 'GET', summary: 'List product categories', tag: 'Product Categories' },
  { procedure: 'productCategories.getById', method: 'GET', summary: 'Get category by ID', tag: 'Product Categories' },
  { procedure: 'productCategories.listActive', method: 'GET', summary: 'List active categories', tag: 'Product Categories' },
  { procedure: 'productCategories.create', method: 'POST', summary: 'Create category', tag: 'Product Categories' },
  { procedure: 'productCategories.update', method: 'POST', summary: 'Update category', tag: 'Product Categories' },

  // Inventory
  { procedure: 'inventory.levels', method: 'GET', summary: 'Get inventory levels', tag: 'Inventory' },
  { procedure: 'inventory.availableStock', method: 'GET', summary: 'Get available stock', tag: 'Inventory' },
  { procedure: 'inventory.intake', method: 'POST', summary: 'Stock intake', tag: 'Inventory' },
  { procedure: 'inventory.transfer', method: 'POST', summary: 'Transfer stock', tag: 'Inventory' },
  { procedure: 'inventory.verifyTransfer', method: 'POST', summary: 'Verify transfer', tag: 'Inventory' },
  { procedure: 'inventory.adjust', method: 'POST', summary: 'Adjust stock', tag: 'Inventory' },
  { procedure: 'inventory.movements', method: 'GET', summary: 'List stock movements', tag: 'Inventory' },
  { procedure: 'inventory.transfers', method: 'GET', summary: 'List transfers', tag: 'Inventory' },
  { procedure: 'inventory.lowStockAlerts', method: 'GET', summary: 'Low stock alerts', tag: 'Inventory' },
  { procedure: 'inventory.returnedOrders', method: 'GET', summary: 'Returned orders', tag: 'Inventory' },
  { procedure: 'inventory.createReconciliation', method: 'POST', summary: 'Create reconciliation', tag: 'Inventory' },
  { procedure: 'inventory.resolveReconciliation', method: 'POST', summary: 'Resolve reconciliation', tag: 'Inventory' },
  { procedure: 'inventory.reconciliations', method: 'GET', summary: 'List reconciliations', tag: 'Inventory' },
  { procedure: 'inventory.dispatchLockStatus', method: 'GET', summary: 'Dispatch lock status', tag: 'Inventory' },

  // Logistics
  { procedure: 'logistics.listProviders', method: 'GET', summary: 'List logistics companies', tag: 'Logistics' },
  { procedure: 'logistics.getProvider', method: 'GET', summary: 'Get logistics company by ID', tag: 'Logistics' },
  { procedure: 'logistics.createProvider', method: 'POST', summary: 'Create logistics company', tag: 'Logistics' },
  { procedure: 'logistics.updateProvider', method: 'POST', summary: 'Update logistics company', tag: 'Logistics' },
  { procedure: 'logistics.listLocations', method: 'GET', summary: 'List locations', tag: 'Logistics' },
  { procedure: 'logistics.createLocation', method: 'POST', summary: 'Create location', tag: 'Logistics' },
  { procedure: 'logistics.updateLocation', method: 'POST', summary: 'Update location', tag: 'Logistics' },
  { procedure: 'logistics.shrinkageAlerts', method: 'GET', summary: 'Shrinkage alerts', tag: 'Logistics' },
  { procedure: 'logistics.stuckOrders', method: 'GET', summary: 'Stuck orders', tag: 'Logistics' },
  { procedure: 'logistics.transferDelays', method: 'GET', summary: 'Transfer delays', tag: 'Logistics' },
  { procedure: 'logistics.healthDashboard', method: 'GET', summary: 'Logistics health dashboard', tag: 'Logistics' },
  { procedure: 'logistics.submitDeliveryConfirmation', method: 'POST', summary: 'Submit delivery confirmation for HOL approval', tag: 'Logistics' },
  { procedure: 'logistics.listDeliveryConfirmationRequests', method: 'GET', summary: 'List delivery confirmation requests', tag: 'Logistics' },
  { procedure: 'logistics.approveDeliveryConfirmation', method: 'POST', summary: 'Approve delivery confirmation', tag: 'Logistics' },
  { procedure: 'logistics.rejectDeliveryConfirmation', method: 'POST', summary: 'Reject delivery confirmation', tag: 'Logistics' },

  // Marketing
  { procedure: 'marketing.createFunding', method: 'POST', summary: 'Create funding record', tag: 'Marketing' },
  { procedure: 'marketing.verifyFunding', method: 'POST', summary: 'Verify funding', tag: 'Marketing' },
  { procedure: 'marketing.listFunding', method: 'GET', summary: 'List funding records', tag: 'Marketing' },
  { procedure: 'marketing.fundingSummary', method: 'GET', summary: 'Funding summary', tag: 'Marketing' },
  { procedure: 'marketing.createAdSpend', method: 'POST', summary: 'Create ad spend entry', tag: 'Marketing' },
  { procedure: 'marketing.listAdSpend', method: 'GET', summary: 'List ad spend', tag: 'Marketing' },
  { procedure: 'marketing.adSpendStatusCounts', method: 'GET', summary: 'Ad spend status counts', tag: 'Marketing' },
  { procedure: 'marketing.metrics', method: 'GET', summary: 'Marketing performance metrics', tag: 'Marketing' },
  { procedure: 'marketing.leaderboard', method: 'GET', summary: 'Media buyer leaderboard', tag: 'Marketing' },
  { procedure: 'marketing.checkHighCpa', method: 'GET', summary: 'Check high CPA warning', tag: 'Marketing' },
  { procedure: 'marketing.createOfferTemplate', method: 'POST', summary: 'Create offer template', tag: 'Marketing' },
  { procedure: 'marketing.updateOfferTemplate', method: 'POST', summary: 'Update offer template', tag: 'Marketing' },
  {
    procedure: 'marketing.archiveAllOfferTemplatesForProduct',
    method: 'POST',
    summary: 'Archive all offer templates for a product',
    tag: 'Marketing',
  },
  { procedure: 'marketing.getOfferTemplate', method: 'GET', summary: 'Get offer template', tag: 'Marketing' },
  { procedure: 'marketing.listOfferTemplates', method: 'GET', summary: 'List offer templates', tag: 'Marketing' },
  { procedure: 'marketing.createCampaign', method: 'POST', summary: 'Create campaign', tag: 'Marketing' },
  { procedure: 'marketing.updateCampaign', method: 'POST', summary: 'Update campaign', tag: 'Marketing' },
  { procedure: 'marketing.getCampaign', method: 'GET', summary: 'Get campaign', tag: 'Marketing' },
  { procedure: 'marketing.listCampaigns', method: 'GET', summary: 'List campaigns', tag: 'Marketing' },
  { procedure: 'marketing.getPublic', method: 'GET', summary: 'Public marketing data (for Edge)', tag: 'Marketing' },

  // Finance
  { procedure: 'finance.updateInvoiceStatus', method: 'POST', summary: 'Update invoice status', tag: 'Finance' },
  { procedure: 'finance.getInvoice', method: 'GET', summary: 'Get invoice', tag: 'Finance' },
  { procedure: 'finance.listInvoices', method: 'GET', summary: 'List invoices', tag: 'Finance' },
  { procedure: 'finance.invoiceSummary', method: 'GET', summary: 'Invoice summary', tag: 'Finance' },
  { procedure: 'finance.profitReport', method: 'GET', summary: 'Profit report', tag: 'Finance' },
  { procedure: 'finance.overview', method: 'GET', summary: 'Finance overview', tag: 'Finance' },
  { procedure: 'finance.createApprovalRequest', method: 'POST', summary: 'Create approval request', tag: 'Finance' },
  { procedure: 'finance.processApproval', method: 'POST', summary: 'Process approval', tag: 'Finance' },
  { procedure: 'finance.listApprovalRequests', method: 'GET', summary: 'List approval requests', tag: 'Finance' },
  { procedure: 'finance.setBudget', method: 'POST', summary: 'Set budget', tag: 'Finance' },
  { procedure: 'finance.listBudgets', method: 'GET', summary: 'List budgets', tag: 'Finance' },
  { procedure: 'finance.budgetUtilization', method: 'GET', summary: 'Budget utilization', tag: 'Finance' },
  { procedure: 'finance.flagOverdueInvoices', method: 'POST', summary: 'Flag overdue invoices', tag: 'Finance' },
  { procedure: 'finance.initMaterializedViews', method: 'POST', summary: 'Init materialized views', tag: 'Finance' },
  { procedure: 'finance.refreshMaterializedViews', method: 'POST', summary: 'Refresh materialized views', tag: 'Finance' },
  { procedure: 'finance.fastProfitReport', method: 'GET', summary: 'Fast profit report', tag: 'Finance' },

  // HR
  { procedure: 'hr.createPlan', method: 'POST', summary: 'Create commission plan', tag: 'HR' },
  { procedure: 'hr.updatePlan', method: 'POST', summary: 'Update commission plan', tag: 'HR' },
  { procedure: 'hr.listPlans', method: 'GET', summary: 'List commission plans', tag: 'HR' },
  { procedure: 'hr.generatePayouts', method: 'POST', summary: 'Generate payouts', tag: 'HR' },
  { procedure: 'hr.approvePayout', method: 'POST', summary: 'Approve payout', tag: 'HR' },
  { procedure: 'hr.listPayouts', method: 'GET', summary: 'List payouts', tag: 'HR' },
  { procedure: 'hr.payoutSummary', method: 'GET', summary: 'Payout summary', tag: 'HR' },
  { procedure: 'hr.createClawback', method: 'POST', summary: 'Create clawback', tag: 'HR' },
  { procedure: 'hr.previewPayout', method: 'GET', summary: 'Preview payout', tag: 'HR' },
  { procedure: 'hr.createAdjustment', method: 'POST', summary: 'Create adjustment', tag: 'HR' },
  { procedure: 'hr.approveAdjustment', method: 'POST', summary: 'Approve adjustment', tag: 'HR' },
  { procedure: 'hr.listAdjustments', method: 'GET', summary: 'List adjustments', tag: 'HR' },
  { procedure: 'hr.setSettlementConfig', method: 'POST', summary: 'Set settlement config', tag: 'HR' },
  { procedure: 'hr.getActiveSettlementConfig', method: 'GET', summary: 'Get active settlement config', tag: 'HR' },
  { procedure: 'hr.listSettlementConfigs', method: 'GET', summary: 'List settlement configs', tag: 'HR' },
  { procedure: 'hr.getCurrentSettlementPeriod', method: 'GET', summary: 'Get current settlement period', tag: 'HR' },

  // Notifications
  { procedure: 'notifications.list', method: 'GET', summary: 'List notifications', tag: 'Notifications' },
  { procedure: 'notifications.unreadCount', method: 'GET', summary: 'Unread count', tag: 'Notifications' },
  { procedure: 'notifications.markAsRead', method: 'POST', summary: 'Mark as read', tag: 'Notifications' },
  { procedure: 'notifications.markAllAsRead', method: 'POST', summary: 'Mark all as read', tag: 'Notifications' },

  // Audit
  { procedure: 'audit.recordHistory', method: 'GET', summary: 'Record history for entity', tag: 'Audit' },
  { procedure: 'audit.globalLog', method: 'GET', summary: 'Global audit log', tag: 'Audit' },
  { procedure: 'audit.timeTravel', method: 'GET', summary: 'Time travel query', tag: 'Audit' },
  { procedure: 'audit.tables', method: 'GET', summary: 'List auditable tables', tag: 'Audit' },
  { procedure: 'audit.actorNames', method: 'GET', summary: 'Resolve actor names', tag: 'Audit' },

  // Dashboard
  { procedure: 'dashboard.ceoOverview', method: 'GET', summary: 'CEO executive overview', tag: 'Dashboard' },
  { procedure: 'dashboard.ceoOverviewTimeSeries', method: 'GET', summary: 'CEO overview time-series (daily revenue & orders)', tag: 'Dashboard' },
  { procedure: 'dashboard.orderPipelineChart', method: 'GET', summary: 'Order pipeline chart (Volume, CS Engaged, Confirmed, Logistics, Delivered)', tag: 'Dashboard' },

  // Settings
  { procedure: 'settings.getClientConfig', method: 'GET', summary: 'Get client UI config and effective theme', tag: 'Settings' },
  { procedure: 'settings.updateClientUiConfig', method: 'POST', summary: 'Update org default UI config', tag: 'Settings' },
  { procedure: 'settings.getSystemSettings', method: 'GET', summary: 'Get system settings', tag: 'Settings' },
  { procedure: 'settings.getNotificationEmailConfig', method: 'GET', summary: 'Get notification email config', tag: 'Settings' },
  { procedure: 'settings.updateNotificationEmailConfig', method: 'POST', summary: 'Update notification email config', tag: 'Settings' },
  { procedure: 'settings.updateSystemSetting', method: 'POST', summary: 'Update system setting', tag: 'Settings' },

  // VOIP
  { procedure: 'voip.isEnabled', method: 'GET', summary: 'Check if VOIP is enabled', tag: 'VOIP' },
  { procedure: 'voip.setEnabled', method: 'POST', summary: 'Enable/disable VOIP', tag: 'VOIP' },
  { procedure: 'voip.generateToken', method: 'POST', summary: 'Generate VOIP token', tag: 'VOIP' },
  { procedure: 'voip.callStatus', method: 'GET', summary: 'Get call status', tag: 'VOIP' },
  { procedure: 'voip.releaseExpiredLocks', method: 'POST', summary: 'Release expired call locks', tag: 'VOIP' },

  // Cart
  { procedure: 'cart.save', method: 'POST', summary: 'Save cart', tag: 'Cart' },
  { procedure: 'cart.markAbandoned', method: 'POST', summary: 'Mark cart abandoned', tag: 'Cart' },
  { procedure: 'cart.listPending', method: 'GET', summary: 'List pending carts', tag: 'Cart' },
  { procedure: 'cart.getStats', method: 'GET', summary: 'Cart stats', tag: 'Cart' },

  // Permission Requests
  { procedure: 'permissionRequests.listPending', method: 'GET', summary: 'List pending permission requests (first page)', tag: 'Permission Requests' },
  {
    procedure: 'permissionRequests.list',
    method: 'GET',
    summary: 'List permission requests (paginated, viewer-scoped)',
    tag: 'Permission Requests',
  },
  { procedure: 'permissionRequests.statusCounts', method: 'GET', summary: 'Permission request counts by status (viewer-scoped)', tag: 'Permission Requests' },
  { procedure: 'permissionRequests.approve', method: 'POST', summary: 'Approve permission request', tag: 'Permission Requests' },
  { procedure: 'permissionRequests.reject', method: 'POST', summary: 'Reject permission request', tag: 'Permission Requests' },
];

function buildTrpcPaths(): OpenAPIObject['paths'] {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of ENDPOINTS) {
    const path = `${TRPC_BASE}/${ep.procedure}`;

    if (!paths[path]) {
      paths[path] = {};
    }

    const operation: Record<string, unknown> = {
      tags: [ep.tag],
      summary: ep.summary,
      description: `tRPC procedure: \`${ep.procedure}\`. ${ep.method === 'GET' ? 'Query: pass input as JSON in `input` query param.' : 'Mutation: pass input as JSON in request body.'}`,
      security: PUBLIC_PROCEDURES.has(ep.procedure) ? [] : [{ yannis_session: [] }],
      responses: {
        200: { description: 'Success' },
        401: { description: 'Not authenticated' },
        403: { description: 'Forbidden' },
      },
    };

    if (ep.method === 'GET') {
      operation.parameters = [
        {
          name: 'input',
          in: 'query',
          required: false,
          schema: { type: 'string', description: 'JSON-encoded input object' },
        },
      ];
    } else {
      operation.requestBody = {
        required: false,
        content: {
          'application/json': {
            schema: { type: 'object', description: 'Procedure input' },
          },
        },
      };
    }

    paths[path][ep.method.toLowerCase()] = operation;
  }

  return paths as OpenAPIObject['paths'];
}

export function getTrpcOpenApiPaths(): OpenAPIObject['paths'] {
  return buildTrpcPaths();
}

export function getTrpcTags(): { name: string; description: string }[] {
  const tagSet = new Set(ENDPOINTS.map((e) => e.tag));
  return Array.from(tagSet).sort().map((name) => ({
    name,
    description: `${name} tRPC procedures`,
  }));
}
