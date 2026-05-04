/**
 * Stable scope ids + allowlisted URL query keys for `usePersistListFilters`.
 * - `page` / `gpage` / `balancesPage` / `requestsPage` are never persisted (see `pickAllowlisted`).
 * - Omit free-text `search` on **order** lists (CS / marketing / logistics orders).
 */

export const LIST_FILTER_SCOPES = {
  csOrders: 'cs-orders',
  marketingOrders: 'marketing-orders',
  logisticsOrdersAdmin: 'logistics-orders-admin',
  logisticsOrdersTpl: 'logistics-orders-tpl',
  marketingFunding: 'marketing-funding',
  marketingAdSpend: 'marketing-ad-spend',
  marketingTeam: 'marketing-team',
  transfers: 'transfers',
  logisticsTeam: 'logistics-team',
  deliveryConfirmations: 'delivery-confirmations',
  inventory: 'inventory',
  categories: 'categories',
  deliveryRemittances: 'delivery-remittances',
  disbursements: 'disbursements',
  remittancesAdmin: 'remittances-admin',
  finance: 'finance',
  financePayout: 'finance-payout',
  hrUsers: 'hr-users',
  adminStaffAccounts: 'admin-staff-accounts',
  tplInventory: 'tpl-inventory',
  staffOnboardingDocs: 'staff-onboarding-docs',
  permissionRequests: 'permission-requests',
  audit: 'audit',
  settings: 'settings',
  tplSettings: 'tpl-settings',
  csDashboard: 'cs-dashboard',
  csLeaderboard: 'cs-leaderboard',
  marketingLeaderboard: 'marketing-leaderboard',
  ceoDashboard: 'ceo-dashboard',
} as const;

/** CS orders — omit `search` (customer name). */
export const ALLOWLIST_CS_ORDERS = [
  'startDate',
  'endDate',
  'period',
  'status',
  'csAgentId',
  'scheduleKind',
  'scheduleDate',
  'calendarMonth',
] as const;

export const ALLOWLIST_MARKETING_ORDERS = [
  'startDate',
  'endDate',
  'period',
  'status',
  'mediaBuyerId',
] as const;

export const ALLOWLIST_LOGISTICS_ORDERS = ['startDate', 'endDate', 'period', 'status'] as const;

export const ALLOWLIST_MARKETING_FUNDING = [
  'startDate',
  'endDate',
  'period',
  'section',
  'tab',
  'entryType',
  'entryStatus',
  'status',
  'requestStatus',
] as const;

export const ALLOWLIST_MARKETING_AD_SPEND = [
  'startDate',
  'endDate',
  'period',
  'status',
  'productId',
  'campaignId',
  'mediaBuyerId',
  'search',
] as const;

export const ALLOWLIST_MARKETING_TEAM = ['startDate', 'endDate', 'period', 'q', 'sortBy', 'sortDir'] as const;

export const ALLOWLIST_TRANSFERS = [
  'startDate',
  'endDate',
  'period',
  'status',
  'fromLocationId',
  'toLocationId',
  'productId',
] as const;

export const ALLOWLIST_LOGISTICS_TEAM = [
  'startDate',
  'endDate',
  'period',
  'q',
  'sortBy',
  'sortDir',
] as const;

export const ALLOWLIST_DELIVERY_CONFIRMATIONS = [
  'startDate',
  'endDate',
  'period',
  'tab',
  'requestStatus',
] as const;

export const ALLOWLIST_INVENTORY = ['productId', 'locationId', 'sort', 'search'] as const;

export const ALLOWLIST_CATEGORIES = ['search', 'status'] as const;

export const ALLOWLIST_DELIVERY_REMITTANCES = [
  'startDate',
  'endDate',
  'period',
  'status',
  'location',
  'sentBy',
] as const;

export const ALLOWLIST_DISBURSEMENTS = [
  'startDate',
  'endDate',
  'period',
  'tab',
  'status',
  'receiver',
  'search',
  'balancesSearch',
  'balancesRole',
  'balancesStatus',
  'receiverId',
] as const;

export const ALLOWLIST_REMITTANCES_ADMIN = [
  'startDate',
  'endDate',
  'period',
  'status',
  'locationId',
  'search',
  'sender',
  'minQty',
  'maxQty',
] as const;

export const ALLOWLIST_FINANCE = ['startDate', 'endDate', 'period', 'invoiceStatus', 'approvalStatus'] as const;

/** Omit `batchId` — restoring it would auto-open the batch detail panel from a bare sidebar link. */
export const ALLOWLIST_FINANCE_PAYOUT = ['status'] as const;

export const ALLOWLIST_USERS = ['status', 'role'] as const;

export const ALLOWLIST_STAFF_ONBOARDING_DOCS = [
  'search',
  'onboarding',
  'sortBy',
  'sortOrder',
  'allBranches',
] as const;

export const ALLOWLIST_PERMISSION_REQUESTS = ['status'] as const;

export const ALLOWLIST_AUDIT = ['startDate', 'endDate', 'period', 'tableName', 'actorId'] as const;

export const ALLOWLIST_SETTINGS = ['tab'] as const;

export const ALLOWLIST_CS_DASHBOARD = ['period', 'tab', 'hotSwapFrom', 'from'] as const;

export const ALLOWLIST_CS_LEADERBOARD = ['startDate', 'endDate', 'period'] as const;

export const ALLOWLIST_MARKETING_LEADERBOARD = ['startDate', 'endDate', 'period'] as const;

/** `topic` is chart UI only — loader does not read it from the URL yet. */
export const ALLOWLIST_CEO_DASHBOARD = ['startDate', 'endDate', 'period'] as const;
