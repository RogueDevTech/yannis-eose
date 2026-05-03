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
  /** Staff contact — returned by `users.list`; masked per backend policy when unauthorized. */
  phone?: string | null;
  branchMemberships?: UserBranchMembership[];
}

export const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'badge-danger',
  ADMIN: 'badge-danger',
  BRANCH_ADMIN: 'badge-warning',
  HEAD_OF_MARKETING: 'badge-brand',
  MEDIA_BUYER: 'badge-info',
  HEAD_OF_CS: 'badge-brand',
  CS_AGENT: 'badge-info',
  FINANCE_OFFICER: 'badge-success',
  HEAD_OF_LOGISTICS: 'badge-brand',
  STOCK_MANAGER: 'badge-info',
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
  'BRANCH_ADMIN',
  'HEAD_OF_MARKETING',
  'MEDIA_BUYER',
  'HEAD_OF_CS',
  'CS_AGENT',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
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
  providerName: string | null;
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
  /** ACTIVE or PENDING — both block creating another head on the same branch. */
  status?: string;
}

export interface RoleTemplateOption {
  id: string;
  key: string;
  name: string;
  kind: string;
  mappedRole: string | null;
}

export interface PermissionCatalogItem {
  code: string;
  resource: string;
  action: string;
  description: string | null;
  /** Legacy dotted codes that map to this canonical permission (from seed map). */
  legacyAliases?: string[];
}

export interface UserCreateLoaderData {
  products: UserCreateProduct[];
  locations: UserCreateLocation[];
  plans: UserCreateCommissionPlan[];
  branches: UserCreateBranch[];
  activeHeads: ActiveHeadUser[];
  roleTemplates: RoleTemplateOption[];
  permissionCatalog: PermissionCatalogItem[];
  templatePermissionsById: Record<string, string[]>;
  /** Session branch or sole ACTIVE branch — used to pre-check memberships on Add User. */
  defaultMembershipBranchId: string | null;
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
  roleTemplateId?: string | null;
  scopeGlobal?: boolean;
  scopeOrgWideHead?: boolean;
  scopeTeamSupervisor?: boolean;
  /** Lifetime sign-in counter — bumped each successful login. */
  loginCount?: number;
  /** Most recent successful sign-in timestamp. */
  lastLoginAt?: string | null;
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
  /** Entity id from `_history` — not unique per row; multiple versions share it. */
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
  installedDeviceCount: number;
  devices: Array<{
    id: string;
    userAgent: string | null;
    createdAt: string;
    installMode: 'STANDALONE' | 'BROWSER' | 'UNKNOWN';
    installModeUpdatedAt: string | null;
  }>;
  lastPushSentAt: string | null;
  totalPushSent: number;
}

/** Resolved from `onboarding.get` for the profile subject (staff onboarding workflow). */
export type UserOnboardingSummary =
  | { ok: true; status: string; submittedAt: string | null; approvedAt: string | null }
  | { ok: false; reason: 'forbidden' | 'error' };

/** SSR result for `permissions.listCatalog` — distinguishes API failure from an empty catalog. */
export type PermissionCatalogBundle = {
  items: PermissionCatalogItem[];
  /** True when the request was not OK (401/503/timeout) or the payload could not be parsed. */
  requestFailed: boolean;
};

export interface UserDetailLoaderData {
  user: UserDetail;
  roleTemplates?: Promise<RoleTemplateOption[]>;
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
  permissionCatalog?: Promise<PermissionCatalogBundle>;
  templatePermissionsById?: Promise<Record<string, string[]>>;
  /** Overview Permissions card — sparse deltas + template baseline + RBAC union for chips (`intent: stamp_preview`). */
  userStampPreview?: Promise<{
    userOverrides: Record<string, boolean>;
    templateCodes: string[];
    effectiveCodes: string[];
  }>;
  /** Settings PermissionMatrix sparse deltas — template baseline via `listTemplateBaselines` + `intent: edit_matrix`. */
  userEditPermissionOverrides?: Promise<Record<string, boolean>>;
  canDisburseToThisUser?: boolean;
  isSuperAdmin?: boolean;
  isViewerHeadOfMarketing?: boolean;
  isViewerHeadOfCS?: boolean;
  /**
   * True when the viewer is HoCS/HoM looking at a direct report on the same branch.
   * Backend enforces which fields they can actually edit (capacity, productIds,
   * visibleOrderStatuses); this flag tells the UI to show the limited Settings form.
   */
  canEditLimited?: boolean;
  /**
   * Mirror affordances — nested deferred promise so the loader returns without awaiting
   * `canMirrorToUser` (avoids Remix single-fetch turbo-stream ~5s timeouts).
   */
  mirrorUi: Promise<{ viewerShowsMirror: boolean; mirrorSubmitDisabled: boolean }>;
  /**
   * True when the viewer is opening their OWN profile (drives /admin/profile).
   * Hides destructive admin actions (Reset Password, Deactivate, Mirror, Disburse) —
   * users manage their own credentials in /admin/settings, not from the profile page.
   */
  isSelfView?: boolean;
  /** False for SuperAdmin / Admin profiles — they don't use the staff onboarding record. When true, Overview shows the onboarding card. */
  showOnboardingTab?: boolean;
  /** Viewer may open `/hr/users/:id/onboarding` (HR workflow). Self-view uses `/admin/onboarding` instead. */
  viewerCanManageHrOnboarding?: boolean;
  onboardingSummary?: Promise<UserOnboardingSummary | null>;
}

// ─── Avatar gradient mapping by role ────────────────────

export const ROLE_AVATAR_GRADIENTS: Record<string, string> = {
  SUPER_ADMIN: 'from-red-500 to-rose-600',
  ADMIN: 'from-red-400 to-orange-500',
  BRANCH_ADMIN: 'from-orange-400 to-yellow-500',
  HEAD_OF_MARKETING: 'from-brand-500 to-brand-700',
  MEDIA_BUYER: 'from-sky-400 to-blue-600',
  HEAD_OF_CS: 'from-brand-500 to-indigo-600',
  CS_AGENT: 'from-blue-400 to-cyan-600',
  FINANCE_OFFICER: 'from-emerald-400 to-green-600',
  HEAD_OF_LOGISTICS: 'from-violet-500 to-purple-700',
  STOCK_MANAGER: 'from-amber-400 to-orange-600',
  TPL_MANAGER: 'from-orange-400 to-amber-600',
  TPL_RIDER: 'from-yellow-400 to-orange-500',
  HR_MANAGER: 'from-pink-400 to-rose-600',
};

export const ROLE_ICONS: Record<string, string> = {
  SUPER_ADMIN: 'shield',
  ADMIN: 'shield',
  BRANCH_ADMIN: 'shield',
  HEAD_OF_MARKETING: 'megaphone',
  MEDIA_BUYER: 'chart-bar',
  HEAD_OF_CS: 'headset',
  CS_AGENT: 'phone',
  FINANCE_OFFICER: 'banknotes',
  HEAD_OF_LOGISTICS: 'truck',
  STOCK_MANAGER: 'cube',
  TPL_MANAGER: 'building',
  TPL_RIDER: 'bicycle',
  HR_MANAGER: 'users',
};
