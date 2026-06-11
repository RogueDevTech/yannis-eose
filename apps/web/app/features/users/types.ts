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
  /** Payout beneficiary fields — only present when the caller has finance access (`users.list`). */
  payoutBankName?: string | null;
  payoutAccountName?: string | null;
  payoutAccountNumber?: string | null;
  payoutBankCode?: string | null;
  /** Probation status — drives the Probation badge in user lists. */
  isProbation?: boolean;
  probationUntil?: string | null;
  /** "Is supervisor anywhere" — drives the Supervisor badge in user lists. */
  isTeamSupervisor?: boolean;
}

export const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'badge-danger',
  ADMIN: 'badge-danger',
  BRANCH_ADMIN: 'badge-warning',
  HEAD_OF_MARKETING: 'badge-brand',
  MEDIA_BUYER: 'badge-info',
  HEAD_OF_CS: 'badge-brand',
  CS_CLOSER: 'badge-info',
  FINANCE_OFFICER: 'badge-success',
  HEAD_OF_LOGISTICS: 'badge-brand',
  STOCK_MANAGER: 'badge-info',
  TPL_MANAGER: 'badge-warning',
  TPL_RIDER: 'badge-warning',
  HR_MANAGER: 'badge-brand',
  SUPPORT: 'badge-info',
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
  'CS_CLOSER',
  'FINANCE_OFFICER',
  'HEAD_OF_LOGISTICS',
  'STOCK_MANAGER',
  'TPL_MANAGER',
  'TPL_RIDER',
  'HR_MANAGER',
  'SUPPORT',
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
  groupId?: string | null;
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
  /** Branch groups for the group-scoped branch picker (SuperAdmin / multi-group HR). */
  branchGroups?: Array<{ id: string; name: string }>;
  /** Viewer's role — drives group-section visibility in the branch picker. */
  viewerRole?: string;
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
  /** Probation status — full role permissions, but eligible for PII-scrub termination. */
  isProbation?: boolean;
  probationStartedAt?: string | null;
  probationStartedBy?: string | null;
  probationUntil?: string | null;
  /** "Is supervisor anywhere" — drives the Supervisor badge on the user-detail page. */
  isTeamSupervisor?: boolean;
  /** Stamped only when this user was scrubbed via the probation termination flow. */
  terminatedAt?: string | null;
  terminatedBy?: string | null;
  originalRole?: string | null;
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

/** `hr.previewPayout` — live-ish estimate from attributed orders × commission rules (see HR service). */
export interface StaffPayoutEstimate {
  staffId: string;
  staffName: string;
  role: string;
  planName: string;
  deliveredCount: number;
  totalOrders: number;
  returnedCount: number;
  deliveryRate: number;
  baseSalary: number;
  performanceBonus: number;
  penalties: number;
  clawbacks: number;
  deductionsTotal: number;
  totalPayout: number;
}

/** Narrow shape for last paid row on the earnings outlook card (from `hr.listPayouts`). */
export interface UserPaidPayoutSnapshot {
  periodStart: string;
  periodEnd: string;
  totalPayout: string;
  createdAt?: string;
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

/**
 * Remix `defer` payload for `/hr/users/:id` (and reuse routes like finance staff accounts).
 * Heavy reads stream client-side from `/api/hr-user-detail-*` resource routes — only shell flags + user row here.
 */
/** Server-resolved onboarding summary for the user detail overview (avoids client fetcher races). */
export type UserDetailOnboardingOverviewSlice = {
  onboardingSummary: UserOnboardingSummary;
};

/** Server-resolved permissions preview bundle for the overview card. */
export type UserDetailPermissionsOverviewSlice = {
  permissionCatalog: PermissionCatalogBundle;
  templatePermissionsById: Record<string, string[]>;
  userStampPreview: {
    userOverrides: Record<string, boolean>;
    templateCodes: string[];
    effectiveCodes: string[];
  };
};

export interface UserDetailLoaderData {
  user: UserDetail;
  /** Resolved inside deferred `userDetail` — avoids nested `<Await>` remounting fetcher-driven UI. */
  mirrorUi: { viewerShowsMirror: boolean; mirrorSubmitDisabled: boolean };
  /** When set, Overview onboarding card hydrates from SSR; client resource route is skipped. */
  overviewOnboardingSlice?: UserDetailOnboardingOverviewSlice | null;
  /** When set, Overview permissions card hydrates from SSR; client resource route is skipped. */
  overviewPermissionsSlice?: UserDetailPermissionsOverviewSlice | null;
  isSuperAdmin?: boolean;
  /** SuperAdmin/Admin or `users.deactivate` / `users.staff.deactivate` — can restore DEACTIVATED staff to ACTIVE. */
  canReactivateDeactivatedStaff?: boolean;
  isViewerHeadOfMarketing?: boolean;
  isViewerHeadOfCS?: boolean;
  /**
   * True when the viewer is HoCS/HoM looking at a direct report on the same branch.
   */
  canEditLimited?: boolean;
  /**
   * True when the viewer is opening their OWN profile (drives /admin/profile).
   */
  isSelfView?: boolean;
  /** False for SuperAdmin / Admin profiles — staff onboarding card hidden. */
  showOnboardingTab?: boolean;
  /** Viewer may open `/hr/users/:id/onboarding` (HR workflow). */
  viewerCanManageHrOnboarding?: boolean;
}

/**
 * Props for `UserDetailPage` after `UserDetailPageWithMirror` strips `mirrorUi`.
 * Optional promises are legacy/test-only fallbacks; production hydrates from resource routes.
 */
export type UserDetailPageProps = Omit<
  UserDetailLoaderData,
  'mirrorUi' | 'overviewOnboardingSlice' | 'overviewPermissionsSlice'
> & {
  usersBasePath?: string;
  viewerShowsMirror?: boolean;
  mirrorSubmitDisabled?: boolean;
  overviewOnboardingSlice?: UserDetailOnboardingOverviewSlice | null;
  overviewPermissionsSlice?: UserDetailPermissionsOverviewSlice | null;
  roleTemplates?: Promise<RoleTemplateOption[]>;
  locations?: Promise<UserCreateLocation[]>;
  plans?: Promise<UserCreateCommissionPlan[]>;
  payouts?: Promise<UserPayoutRecord[]>;
  adjustments?: Promise<UserAdjustment[]>;
  auditLog?: Promise<UserAuditEntry[]>;
  pendingEmailChange?: Promise<PendingEmailChange | null>;
  financeActivity?: Promise<{ approvals: UserApprovalRecord[]; total: number }> | null;
  pushStatus?: Promise<UserPushStatus | null>;
  permissionCatalog?: Promise<PermissionCatalogBundle>;
  templatePermissionsById?: Promise<Record<string, string[]>>;
  userStampPreview?: Promise<{
    userOverrides: Record<string, boolean>;
    templateCodes: string[];
    effectiveCodes: string[];
  }>;
};

// ─── Avatar gradient mapping by role ────────────────────

export const ROLE_AVATAR_GRADIENTS: Record<string, string> = {
  SUPER_ADMIN: 'from-red-500 to-rose-600',
  ADMIN: 'from-red-400 to-orange-500',
  BRANCH_ADMIN: 'from-orange-400 to-yellow-500',
  HEAD_OF_MARKETING: 'from-brand-500 to-brand-700',
  MEDIA_BUYER: 'from-sky-400 to-blue-600',
  HEAD_OF_CS: 'from-brand-500 to-indigo-600',
  CS_CLOSER: 'from-blue-400 to-cyan-600',
  FINANCE_OFFICER: 'from-emerald-400 to-green-600',
  HEAD_OF_LOGISTICS: 'from-violet-500 to-purple-700',
  STOCK_MANAGER: 'from-amber-400 to-orange-600',
  TPL_MANAGER: 'from-orange-400 to-amber-600',
  TPL_RIDER: 'from-yellow-400 to-orange-500',
  HR_MANAGER: 'from-pink-400 to-rose-600',
  SUPPORT: 'from-slate-400 to-gray-600',
};

export const ROLE_ICONS: Record<string, string> = {
  SUPER_ADMIN: 'shield',
  ADMIN: 'shield',
  BRANCH_ADMIN: 'shield',
  HEAD_OF_MARKETING: 'megaphone',
  MEDIA_BUYER: 'chart-bar',
  HEAD_OF_CS: 'headset',
  CS_CLOSER: 'phone',
  FINANCE_OFFICER: 'banknotes',
  HEAD_OF_LOGISTICS: 'truck',
  STOCK_MANAGER: 'cube',
  TPL_MANAGER: 'building',
  TPL_RIDER: 'bicycle',
  HR_MANAGER: 'users',
  SUPPORT: 'eye',
};
