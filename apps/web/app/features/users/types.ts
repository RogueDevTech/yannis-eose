export interface UserBranchMembership {
  branchId: string;
  branchName: string;
  branchCode: string;
  isPrimary: boolean;
  roleInBranch: string | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  capacity: number;
  createdAt: string;
  branchMemberships?: UserBranchMembership[];
}

export const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'badge-danger',
  ADMIN: 'badge-danger',
  HEAD_OF_MARKETING: 'badge-brand',
  MEDIA_BUYER: 'badge-info',
  HEAD_OF_CS: 'badge-brand',
  CS_AGENT: 'badge-info',
  FINANCE_OFFICER: 'badge-success',
  HEAD_OF_LOGISTICS: 'badge-brand',
  WAREHOUSE_MANAGER: 'badge-info',
  TPL_MANAGER: 'badge-warning',
  TPL_RIDER: 'badge-warning',
  HR_MANAGER: 'badge-brand',
};

export const USER_STATUS_COLORS: Record<string, string> = {
  PENDING: 'badge-info',
  ACTIVE: 'badge-success',
  INACTIVE: 'badge-danger',
  DEACTIVATED: 'badge-danger',
  ARCHIVED: 'badge-warning',
};

export const ROLE_OPTIONS = [
  'ALL',
  'SUPER_ADMIN',
  'ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  'CS_AGENT',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'WAREHOUSE_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
];

export function formatRole(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// ─── User Create Page Types ─────────────────────────────

export interface UserCreateProduct {
  id: string;
  name: string;
  sku: string;
  category?: string;
}

export interface UserCreateLocation {
  id: string;
  name: string;
  address: string;
}

export interface UserCreateCommissionPlan {
  id: string;
  planName: string;
  role: string;
}

export interface UserCreateBranch {
  id: string;
  name: string;
  code: string;
  status: string;
}

export interface ActiveHeadUser {
  id: string;
  name: string;
  role: string;
  primaryBranchId: string | null;
}

export interface UserCreateLoaderData {
  products: UserCreateProduct[];
  locations: UserCreateLocation[];
  plans: UserCreateCommissionPlan[];
  branches: UserCreateBranch[];
  activeHeads: ActiveHeadUser[];
}

// ─── User Detail Page Types ──────────────────────────────

export interface UserDetail {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  capacity: number;
  logisticsLocationId: string | null;
  phone: string | null;
  visibleOrderStatuses: string[] | null;
  restrictProductAccess: boolean;
  /** Product IDs from user_product_assignments (for edit form + save diff). */
  assignedProductIds?: string[];
  commissionPlanId: string | null;
  primaryBranchId: string | null;
  createdAt: string;
  updatedAt: string;
  branchMemberships?: UserBranchMembership[];
}

export interface UserOrderSummary {
  id: string;
  referenceNumber: string;
  customerName: string;
  status: string;
  totalAmount: string;
  createdAt: string;
}

export interface UserPayoutRecord {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: string;
  deductions: string;
  netAmount: string;
  status: string;
  paidAt: string | null;
}

export interface UserAdjustment {
  id: string;
  type: string;
  amount: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface UserAuditEntry {
  id: string;
  action: string;
  tableName: string;
  recordId?: string;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  createdAt: string;
  /** Raw row data (alias for newValues) — used by formatActivityDescription */
  data?: Record<string, unknown>;
}

export interface UserMarketingMetrics {
  totalSpend: number;
  totalOrders: number;
  deliveredOrders: number;
  deliveredRevenue: number;
  confirmedOrders: number;
  confirmationRate: number;
  cpa: number;
  trueRoas: number;
}

export interface PendingEmailChange {
  id: string;
  userId: string;
  requestedNewEmail: string;
  requesterId: string;
  status: string;
  createdAt: string;
}

export interface UserStockMovement {
  id: string;
  productId: string;
  movementType: string;
  quantity: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface UserApprovalRecord {
  id: string;
  type: string;
  amount: string;
  description: string;
  status: string;
  approvedAt: string | null;
  createdAt: string;
}

export interface UserPushStatus {
  subscribedDevices: number;
  devices: Array<{ id: string; userAgent: string | null; createdAt: string }>;
  lastPushSentAt: string | null;
  totalPushSent: number;
}

export interface UserDetailLoaderData {
  user: UserDetail;
  products: Promise<UserCreateProduct[]>;
  locations: Promise<UserCreateLocation[]>;
  plans: Promise<UserCreateCommissionPlan[]>;
  recentOrders: Promise<{ orders: UserOrderSummary[]; total: number }>;
  payouts: Promise<UserPayoutRecord[]>;
  adjustments: Promise<UserAdjustment[]>;
  auditLog: Promise<UserAuditEntry[]>;
  marketingMetrics: Promise<UserMarketingMetrics | null>;
  fundingBalance: Promise<{ totalReceived: string; totalSpend: string; balance: string } | null>;
  pendingEmailChange: Promise<PendingEmailChange | null>;
  stockMovements: Promise<{ movements: UserStockMovement[]; total: number }> | null;
  financeActivity: Promise<{ approvals: UserApprovalRecord[]; total: number }> | null;
  pushStatus?: Promise<UserPushStatus | null>;
  activeHeads?: Promise<ActiveHeadUser[]>;
  branchesList?: Promise<Array<{ id: string; name: string; code: string; status: string }>>;
  canDisburseToThisUser?: boolean;
  isSuperAdmin?: boolean;
  isViewerHeadOfMarketing?: boolean;
  isViewerHeadOfCS?: boolean;
}

// ─── Avatar gradient mapping by role ────────────────────

export const ROLE_AVATAR_GRADIENTS: Record<string, string> = {
  SUPER_ADMIN: 'from-red-500 to-rose-600',
  ADMIN: 'from-red-400 to-orange-500',
  HEAD_OF_MARKETING: 'from-brand-500 to-brand-700',
  MEDIA_BUYER: 'from-sky-400 to-blue-600',
  HEAD_OF_CS: 'from-brand-500 to-indigo-600',
  CS_AGENT: 'from-blue-400 to-cyan-600',
  FINANCE_OFFICER: 'from-emerald-400 to-green-600',
  HEAD_OF_LOGISTICS: 'from-violet-500 to-purple-700',
  WAREHOUSE_MANAGER: 'from-amber-400 to-orange-600',
  TPL_MANAGER: 'from-orange-400 to-amber-600',
  TPL_RIDER: 'from-yellow-400 to-orange-500',
  HR_MANAGER: 'from-pink-400 to-rose-600',
};

export const ROLE_ICONS: Record<string, string> = {
  SUPER_ADMIN: 'shield',
  ADMIN: 'shield',
  HEAD_OF_MARKETING: 'megaphone',
  MEDIA_BUYER: 'chart-bar',
  HEAD_OF_CS: 'headset',
  CS_AGENT: 'phone',
  FINANCE_OFFICER: 'banknotes',
  HEAD_OF_LOGISTICS: 'truck',
  WAREHOUSE_MANAGER: 'cube',
  TPL_MANAGER: 'building',
  TPL_RIDER: 'bicycle',
  HR_MANAGER: 'users',
};
