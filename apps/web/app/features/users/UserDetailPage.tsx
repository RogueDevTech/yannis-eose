import { useState, useEffect } from 'react';
import { Form, Link, useActionData, useFetcher, useNavigation } from '@remix-run/react';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { Checkbox } from '~/components/ui/checkbox';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';
import { Pagination } from '~/components/ui/pagination';
import { formatActivityDescription } from '~/lib/format-activity';
import { formatNaira } from '~/lib/format-amount';
import type {
  UserDetailLoaderData,
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserOrderSummary,
  UserPayoutRecord,
  UserAdjustment,
  UserAuditEntry,
  UserMarketingMetrics,
  PendingEmailChange,
  UserStockMovement,
  UserApprovalRecord,
  UserPushStatus,
  ActiveHeadUser,
  FinanceHatHolder,
} from './types';
import { USER_STATUS_COLORS, ROLE_AVATAR_GRADIENTS, formatRole } from './types';
import { RoleBadge } from '~/components/ui/role-badge';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { RadioGroup } from '~/components/ui/radio-group';

// Roles limited to one active holder per branch. HR_MANAGER was added 2026-04-23 (CEO directive)
// to follow the same rule as the HEAD_OF_* roles. Naming kept for continuity with backend.
const HEAD_ROLES = ['HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS', 'HR_MANAGER'];

// ─── Constants ──────────────────────────────────────────

// SUPER_ADMIN is removed — the service rejects setting it on any user, so including it in the
// dropdown is misleading. ADMIN + BRANCH_ADMIN routes through the SuperAdmin approval flow for
// non-SuperAdmin callers; included so SuperAdmin can promote / demote directly.
const ROLES = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'BRANCH_ADMIN', label: 'Branch Admin' },
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'CS_AGENT', label: 'CS Agent' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'STOCK_MANAGER', label: 'Stock Manager' },
  { value: 'TPL_MANAGER', label: '3PL Manager' },
  { value: 'TPL_RIDER', label: '3PL Rider' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
];

const ROLE_DESCRIPTIONS: Record<string, string> = {
  SUPER_ADMIN: 'Full system access. Can manage all modules, users, and settings.',
  HEAD_OF_MARKETING: 'Oversees all marketing campaigns, funding, and media buyer performance.',
  MEDIA_BUYER: 'Runs ad campaigns, manages ad spend, and tracks CPA/ROAS.',
  HEAD_OF_CS: 'Manages CS team performance, order processing, and agent workloads.',
  CS_AGENT: 'Handles customer calls, confirms orders, and processes cancellations.',
  FINANCE_OFFICER: 'Manages invoices, approvals, budgets, and financial reporting.',
  HEAD_OF_LOGISTICS: 'Oversees logistics operations, logistics companies, 3PL partners, and transfers.',
  STOCK_MANAGER: 'Manages inventory, stock movements, and procurement.',
  TPL_MANAGER: 'Manages a third-party logistics location and its riders.',
  TPL_RIDER: 'Handles last-mile deliveries and order fulfillment.',
  HR_MANAGER: 'Manages payroll, commission plans, payouts, and staff records.',
};

// ─── Component ──────────────────────────────────────────

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  INTAKE: 'Intake',
  RESERVATION: 'Reservation',
  ALLOCATION: 'Allocation',
  DISPATCH: 'Dispatch',
  DELIVERY: 'Delivery',
  RETURN: 'Return',
  RESTOCK: 'Restock',
  WRITE_OFF: 'Write-off',
  TRANSFER_OUT: 'Transfer Out',
  TRANSFER_IN: 'Transfer In',
  ADJUSTMENT: 'Adjustment',
};

export function UserDetailPage({
  user,
  products,
  locations,
  plans,
  recentOrders,
  payouts,
  adjustments,
  auditLog,
  marketingMetrics,
  fundingBalance,
  pendingEmailChange,
  stockMovements,
  financeActivity,
  pushStatus,
  activeHeads,
  currentFinanceOfficer,
  branchesList,
  canDisburseToThisUser = false,
  isSuperAdmin = false,
  isViewerHeadOfMarketing = false,
  isViewerHeadOfCS = false,
  canEditLimited = false,
  viewerCanMirror = false,
  isSelfView = false,
  usersBasePath = '/hr/users',
}: UserDetailLoaderData & { usersBasePath?: string }) {
  const actionData = useActionData<{ error?: string; success?: boolean; message?: string; requiresApproval?: boolean }>();
  const navigation = useNavigation();
  // Reset Password runs through its own fetcher so the form submission inside the portaled
  // modal stays isolated from the page-level <Form>s — those compete for navigation state and
  // were the source of the crash when the modal-portal Form's actionData reached an unmounted tree.
  const resetFetcher = useFetcher<{ error?: string; success?: boolean; message?: string }>();
  const isSubmitting = navigation.state === 'submitting';
  const formIntent = navigation.formData?.get('intent')?.toString();
  const isDeactivating = isSubmitting && formIntent === 'deactivate';
  const isReactivating = isSubmitting && formIntent === 'reactivate';
  const isResetting = resetFetcher.state !== 'idle';
  const isUpdating = isSubmitting && formIntent === 'update';
  const isProcessingEmailChange = isSubmitting && formIntent === 'processEmailChange';
  const restrictHeadView = isViewerHeadOfMarketing || isViewerHeadOfCS;
  // Team-leads see the Settings tab ONLY when editing a direct report (canEditLimited);
  // admin-level users keep full Settings access unconditionally.
  const canOpenSettingsTab = isSuperAdmin || (!restrictHeadView) || canEditLimited;

  type TabId = 'overview' | 'orders' | 'payroll' | 'stock' | 'finance' | 'audit' | 'edit';
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [showEmailChangeModal, setShowEmailChangeModal] = useState<{ requestId: string; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [emailChangeReason, setEmailChangeReason] = useState('');
  const [dismissedError, setDismissedError] = useState(false);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  // Resolve the deferred `activeHeads` / `branchesList` into state so the submit handler can
  // check synchronously whether the selected role+branch is already taken by another user.
  const [resolvedActiveHeads, setResolvedActiveHeads] = useState<ActiveHeadUser[] | null>(null);
  const [resolvedBranches, setResolvedBranches] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
    if (actionData?.success && actionData?.message) setDismissedSuccess(false);
  }, [actionData?.error, actionData?.success, actionData?.message]);

  // Derived flags (must be before useEffects that reference them)
  const isSuperAdminProfile = user.role === 'SUPER_ADMIN';

  useEffect(() => {
    let cancelled = false;
    if (activeHeads) {
      activeHeads
        .then((heads) => {
          if (!cancelled) setResolvedActiveHeads(heads);
        })
        .catch(() => {
          if (!cancelled) setResolvedActiveHeads([]);
        });
    }
    if (branchesList) {
      branchesList
        .then((branches) => {
          if (!cancelled) setResolvedBranches(branches);
        })
        .catch(() => {
          if (!cancelled) setResolvedBranches([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [activeHeads, branchesList]);

  // Close reset modal on fetcher success.
  useEffect(() => {
    if (resetFetcher.state === 'idle' && resetFetcher.data?.success) {
      setShowResetPassword(false);
    }
  }, [resetFetcher.state, resetFetcher.data?.success]);

  // Close email change modal on success
  useEffect(() => {
    if (actionData?.success && (actionData?.message?.includes('Email updated') || actionData?.message?.includes('Email change rejected'))) {
      setShowEmailChangeModal(null);
      setEmailChangeReason('');
    }
  }, [actionData?.success, actionData?.message]);

  // Role-based tab visibility
  const showOrdersTab = ['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'HEAD_OF_CS', 'CS_AGENT', 'HEAD_OF_LOGISTICS', 'TPL_MANAGER', 'TPL_RIDER'].includes(user.role);
  const showPayrollTab = ['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'HEAD_OF_CS', 'CS_AGENT', 'TPL_RIDER', 'HR_MANAGER'].includes(user.role);
  const showStockTab = ['STOCK_MANAGER', 'TPL_MANAGER', 'HEAD_OF_LOGISTICS'].includes(user.role);
  // Finance activity tab is visible to either a primary Finance Officer OR anyone currently
  // wearing the Finance hat on top of their primary role.
  const showFinanceTab = user.role === 'FINANCE_OFFICER' || user.isFinanceOfficer === true;

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(showOrdersTab ? [{ id: 'orders' as const, label: 'Orders' }] : []),
    ...(showPayrollTab ? [{ id: 'payroll' as const, label: 'Payroll' }] : []),
    ...(showStockTab ? [{ id: 'stock' as const, label: 'Stock' }] : []),
    ...(showFinanceTab ? [{ id: 'finance' as const, label: 'Finance Activity' }] : []),
    { id: 'audit', label: 'Activity' },
    // Self-view never gets the Settings tab — user manages their own account in /admin/settings.
    ...((!isSelfView && !isSuperAdminProfile && (canOpenSettingsTab || canEditLimited)) ? [{ id: 'edit' as const, label: 'Settings' }] : []),
  ];

  // When viewing a user, ensure activeTab is valid for their role
  useEffect(() => {
    const validIds = new Set<TabId>(['overview', 'audit']);
    if (showOrdersTab) validIds.add('orders');
    if (showPayrollTab) validIds.add('payroll');
    if (showStockTab) validIds.add('stock');
    if (showFinanceTab) validIds.add('finance');
    if (!isSelfView && !isSuperAdminProfile && (canOpenSettingsTab || canEditLimited)) validIds.add('edit');
    if (!validIds.has(activeTab)) {
      setActiveTab('overview');
    }
  }, [user.role, activeTab, showOrdersTab, showPayrollTab, showStockTab, showFinanceTab, isSuperAdminProfile, canOpenSettingsTab, canEditLimited, isSelfView]);

  // Edit form state
  const [selectedRole, setSelectedRole] = useState(user.role);

  const pendingConflict =
    HEAD_ROLES.includes(selectedRole) &&
    selectedRole !== user.role &&
    user.primaryBranchId &&
    resolvedActiveHeads
      ? resolvedActiveHeads.find(
          (h) =>
            h.role === selectedRole &&
            h.primaryBranchId === user.primaryBranchId &&
            h.id !== user.id,
        )
      : undefined;
  const pendingConflictBranchName = pendingConflict
    ? resolvedBranches?.find((b) => b.id === user.primaryBranchId)?.name ?? 'This branch'
    : null;

  const [assignFinanceHat, setAssignFinanceHat] = useState(user.isFinanceOfficer === true);
  useEffect(() => {
    setAssignFinanceHat(user.isFinanceOfficer === true);
  }, [user.id, user.updatedAt, user.isFinanceOfficer]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(user.assignedProductIds ?? []);

  const assignedProductIdsKey = [...(user.assignedProductIds ?? [])].sort().join(',');
  useEffect(() => {
    setSelectedRole(user.role);
    setSelectedProductIds(user.assignedProductIds ? [...user.assignedProductIds] : []);
  }, [user.id, user.updatedAt, user.role, assignedProductIdsKey]);

  // Capacity is only meaningful for roles that work an individual workload — CS agents
  // (max concurrent orders) and Media Buyers (max concurrent campaigns). Managers / heads
  // don't carry a personal load, so hiding the field removes noise from their forms.
  const showCapacity = ['CS_AGENT', 'MEDIA_BUYER'].includes(selectedRole);
  const showLogisticsLocation = ['TPL_MANAGER', 'TPL_RIDER'].includes(selectedRole);
  const showProductAssignment = ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(selectedRole);
  const isMarketingRole = ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(user.role);
  const isCSRole = ['CS_AGENT', 'HEAD_OF_CS'].includes(user.role);
  // Capacity is only a meaningful number for CS agents + Media Buyers (see `showCapacity`).
  // This flag gates the read-only badge / InfoField in the overview, independent of CS-vs-MB role logic elsewhere.
  const showCapacityReadonly = ['CS_AGENT', 'MEDIA_BUYER'].includes(user.role);
  const isLogisticsRole = ['TPL_MANAGER', 'TPL_RIDER', 'HEAD_OF_LOGISTICS', 'STOCK_MANAGER'].includes(user.role);

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const gradient = ROLE_AVATAR_GRADIENTS[user.role] ?? 'from-brand-500 to-brand-700';
  const initials = user.name.split(' ').map((w) => w.charAt(0).toUpperCase()).slice(0, 2).join('');
  const memberSince = new Date(user.createdAt);
  const tenure = getTimeSince(memberSince);

  // Show Orders/Payroll cards in Overview only for roles that have those tabs
  const showOrdersCard = showOrdersTab;
  const showPayrollCard = showPayrollTab || user.role === 'HR_MANAGER';

  return (
    <div className="w-full space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        {isSelfView ? (
          <span className="text-app-fg-muted">My Profile</span>
        ) : (
          <Link to={usersBasePath} prefetch="intent" className="text-app-fg-muted hover:text-brand-500 transition-colors">
            Users
          </Link>
        )}
        <svg className="w-4 h-4 text-app-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-app-fg font-medium truncate">{user.name}</span>
      </div>

      {/* Action feedback */}
      {actionData?.error && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionData.error}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}
      {actionData?.success && actionData.message && !dismissedSuccess && (
        <div className="space-y-1">
          <PageNotification
            variant="success"
            message={actionData.message}
            durationMs={5000}
            onDismiss={() => setDismissedSuccess(true)}
          />
          {actionData.requiresApproval && (
            <Link to="/admin/permission-requests" className="text-sm font-medium text-success-600 dark:text-success-400 hover:underline inline-block">
              View pending requests →
            </Link>
          )}
        </div>
      )}

      {/* ─── Profile Header Card ─────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        {/* Gradient Banner */}
        <div className={`h-28 sm:h-32 bg-gradient-to-r ${gradient} relative`}>
          <div className="absolute inset-0 bg-black/10" />
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.15\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
        </div>

        {/* Profile Info */}
        <div className="px-4 sm:px-6 pb-5 -mt-12 sm:-mt-14 relative">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            {/* Avatar */}
            <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br ${gradient} ring-4 ring-white dark:ring-surface-900 flex items-center justify-center shadow-lg flex-shrink-0`}>
              <span className="text-2xl sm:text-3xl font-bold text-white tracking-wide">{initials}</span>
            </div>

            <div className="flex-1 min-w-0 pb-1">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-app-fg">{user.name}</h1>
                  <p className="text-sm text-app-fg-muted mt-0.5">{user.email}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <PageRefreshButton />
                  {!isSelfView && (canDisburseToThisUser || (!isSuperAdminProfile && !restrictHeadView)) && (
                    <>
                    {canDisburseToThisUser && (
                      <Link
                        to={`/admin/finance/disbursements?receiverId=${user.id}`}
                        className="btn-primary btn-sm"
                      >
                        Disburse
                      </Link>
                    )}
                    {viewerCanMirror && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="mirror" />
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          className="flex items-center gap-1.5 border-success-300 text-success-700 hover:border-success-400 dark:border-success-700 dark:text-success-400 dark:hover:border-success-600"
                          loading={isSubmitting && navigation.formData?.get('intent') === 'mirror'}
                          loadingText="Entering..."
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Mirror user
                        </Button>
                      </Form>
                    )}
                    {!isSuperAdminProfile && !restrictHeadView && (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setShowResetPassword(true)}
                          className="flex items-center gap-1.5"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                          </svg>
                          Reset Password
                        </Button>
                        {(user.status === 'ACTIVE' || user.status === 'PENDING') && isSuperAdmin && (
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => setShowDeactivateConfirm(true)}
                            className="bg-danger-600 hover:bg-danger-700 text-white border-danger-600 hover:border-danger-700 dark:bg-danger-600 dark:hover:bg-danger-700 dark:border-danger-600 dark:hover:border-danger-700"
                          >
                            Deactivate
                          </Button>
                        )}
                        {(user.status === 'INACTIVE' || user.status === 'ARCHIVED') && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="reactivate" />
                            <Button type="submit" variant="secondary" size="sm" loading={isReactivating} loadingText="Reactivating..." className="text-success-600 dark:text-success-400 hover:text-success-700 border-success-200 dark:border-success-700 hover:border-success-300 flex items-center gap-1.5">
                              Reactivate
                            </Button>
                          </Form>
                        )}
                        {user.status === 'DEACTIVATED' && (
                          <p className="text-xs text-app-fg-muted italic">
                            Deactivated accounts cannot be reactivated. Re-invite the user to create a new account.
                          </p>
                        )}
                      </>
                    )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Quick info pills */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <RoleBadge role={user.role} label={formatRole(user.role)} />
            {user.isFinanceOfficer && user.role !== 'FINANCE_OFFICER' && (
              <span className="badge-success" title="Wears the Finance hat — carries Finance Officer powers on top of their primary role.">
                + Finance hat
              </span>
            )}
            <span className={USER_STATUS_COLORS[user.status] ?? 'badge'}>{user.status}</span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-app-hover text-app-fg-muted">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {tenure}
            </span>
            {user.phone && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-app-hover text-app-fg-muted">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
                {user.phone}
              </span>
            )}
            {showCapacityReadonly && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
                </svg>
                Capacity: {user.capacity}
              </span>
            )}
            <UserBranchBadges branches={user.branchMemberships} />
          </div>

          {/* Role description */}
          <p className="text-xs text-app-fg-muted mt-3">
            {ROLE_DESCRIPTIONS[user.role] ?? ''}
          </p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as TabId)}
        tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
      />

      {/* ─── Overview Tab ────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column — Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Account Information */}
            <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-app-fg">Account Information</h2>
                {!isSuperAdminProfile && !restrictHeadView && (
                  <button type="button" onClick={() => setActiveTab('edit')} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                    Edit
                  </button>
                )}
              </div>
              <DeferredSection resolve={pendingEmailChange} skeleton="inline">
                {(pending: PendingEmailChange | null) => pending && !isSuperAdminProfile && !restrictHeadView && (
                  <div className="rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800 p-3 mb-4">
                    <p className="text-sm font-medium text-warning-800 dark:text-warning-200">
                      Pending email change to <strong>{pending.requestedNewEmail}</strong> — requires SuperAdmin approval
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant="success"
                        size="sm"
                        className="text-xs"
                        onClick={() => { setShowEmailChangeModal({ requestId: pending.id, action: 'APPROVED' }); setEmailChangeReason(''); }}
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        className="text-xs"
                        onClick={() => { setShowEmailChangeModal({ requestId: pending.id, action: 'REJECTED' }); setEmailChangeReason(''); }}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                )}
              </DeferredSection>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-6">
                <InfoField label="Full Name" value={user.name} icon={<UserIcon />} />
                <InfoField label="Email Address" value={user.email} icon={<EnvelopeIcon />} />
                <InfoField label="Role" value={formatRole(user.role)} icon={<ShieldIcon />} />
                <InfoField label="Status" value={user.status} icon={<StatusDot status={user.status} />} />
                <InfoField label="Phone" value={user.phone ?? 'Not set'} icon={<PhoneIcon />} />
                {showCapacityReadonly && <InfoField label="Order Capacity" value={String(user.capacity)} icon={<StackIcon />} />}
                <InfoField
                  label="Member Since"
                  value={memberSince.toLocaleDateString('en-NG', { month: 'long', day: 'numeric', year: 'numeric' })}
                  icon={<CalendarIcon />}
                />
                <InfoField
                  label="Last Updated"
                  value={new Date(user.updatedAt).toLocaleDateString('en-NG', { month: 'long', day: 'numeric', year: 'numeric' })}
                  icon={<ClockIcon />}
                />
              </div>
            </div>

            {/* Role Settings */}
            {(user.logisticsLocationId || user.restrictProductAccess || user.commissionPlanId) && (
              <div className="card space-y-4">
                <h2 className="text-base font-semibold text-app-fg">Role Configuration</h2>

                {user.logisticsLocationId && (
                  <div>
                    <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-1">Assigned Location</p>
                    <DeferredSection resolve={locations} skeleton="inline">
                      {(resolvedLocations) => {
                        const assignedLocation = resolvedLocations.find(
                          (location) => location.id === user.logisticsLocationId,
                        );
                        return assignedLocation ? (
                          <Link to="/admin/logistics" className="text-sm text-brand-600 dark:text-brand-400 hover:underline">
                            {assignedLocation.name}
                          </Link>
                        ) : (
                          <p className="text-sm text-app-fg">Unknown location</p>
                        );
                      }}
                    </DeferredSection>
                    <p className="text-xs text-app-fg-muted mt-1">Open Logistics to see full location details.</p>
                  </div>
                )}

                {user.restrictProductAccess && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
                    <svg className="w-4 h-4 text-warning-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                    <span className="text-sm text-warning-700 dark:text-warning-300 font-medium">Product access is restricted to assigned products only</span>
                  </div>
                )}

                {user.commissionPlanId && (
                  <div>
                    <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-1">Commission Plan</p>
                    <DeferredSection resolve={plans} skeleton="inline">
                      {(resolvedPlans) => {
                        const assignedCommissionPlan = resolvedPlans.find(
                          (plan) => plan.id === user.commissionPlanId,
                        );
                        return assignedCommissionPlan ? (
                          <Link to="/hr/plans" className="text-sm text-brand-600 dark:text-brand-400 hover:underline">
                            {assignedCommissionPlan.planName}
                          </Link>
                        ) : (
                          <p className="text-sm text-app-fg">Unknown commission plan</p>
                        );
                      }}
                    </DeferredSection>
                    <p className="text-xs text-app-fg-muted mt-1">Manage commission plans in HR Plans.</p>
                  </div>
                )}
              </div>
            )}

            {/* Marketing Metrics — only for marketing roles */}
            {isMarketingRole && (
              <DeferredSection resolve={marketingMetrics} skeleton="stat">
                {(metrics) => metrics && (
                  <div className="card space-y-4">
                    <h2 className="text-base font-semibold text-app-fg">Marketing Performance</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <MetricCard label="Total Spend" value={formatNaira(Number(metrics.totalSpend))} />
                      <MetricCard label="Total Orders" value={String(metrics.totalOrders)} />
                      <MetricCard label="Delivered" value={String(metrics.deliveredOrders)} accent="success" />
                      <MetricCard label="Confirmed" value={String(metrics.confirmedOrders)} accent="success" />
                      <MetricCard label="Revenue" value={formatNaira(Number(metrics.deliveredRevenue))} accent="success" />
                      <MetricCard label="Conf. Rate" value={`${Number(metrics.confirmationRate).toFixed(1)}%`} />
                      <MetricCard label="CPA" value={formatNaira(Number(metrics.cpa))} />
                      <MetricCard label="True ROAS" value={`${Number(metrics.trueRoas).toFixed(2)}x`} accent={metrics.trueRoas >= 2 ? 'success' : metrics.trueRoas >= 1 ? 'warning' : 'danger'} />
                    </div>
                  </div>
                )}
              </DeferredSection>
            )}

            {/* Funding balance — only for HoM / Media Buyer (disbursement recipients) */}
            {isMarketingRole && (
              <DeferredSection resolve={fundingBalance} skeleton="stat">
                {(balance) => balance && (
                  <div className="card space-y-4 border-brand-200 dark:border-brand-700/50 bg-brand-50/20 dark:bg-brand-900/10">
                    <h2 className="text-base font-semibold text-app-fg">Funding balance</h2>
                    <p className="text-xs text-app-fg-muted">Confirmed funding received minus approved ad spend</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <p className="text-xs text-app-fg-muted">Total received</p>
                        <p className="text-lg font-medium text-app-fg">{formatNaira(Number(balance.totalReceived))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-app-fg-muted">Total spent</p>
                        <p className="text-lg font-medium text-app-fg">
                          {user.role === 'MEDIA_BUYER' ? formatNaira(Number(balance.totalSpend)) : '—'}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-app-fg-muted">Balance</p>
                        <p className="text-xl font-bold text-brand-600 dark:text-brand-400">{formatNaira(Number(balance.balance))}</p>
                      </div>
                    </div>
                  </div>
                )}
              </DeferredSection>
            )}
          </div>

          {/* Right Column — Quick Stats */}
          <div className="space-y-6">
            {/* Order Stats — only for roles with order attribution */}
            {showOrdersCard && (
              <DeferredSection resolve={recentOrders} skeleton="stat">
                {(data) => (
                  <div className="card space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-app-fg">Orders</h3>
                      <button type="button" onClick={() => setActiveTab('orders')} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                        View all
                      </button>
                    </div>
                    <p className="text-3xl font-bold text-app-fg">{data.total}</p>
                    <p className="text-xs text-app-fg-muted">
                      {isCSRole ? 'Orders handled as CS agent' : isMarketingRole ? 'Orders from campaigns' : isLogisticsRole ? 'Deliveries assigned' : 'Total orders in system'}
                    </p>
                    {data.orders.length > 0 && (
                      <div className="border-t border-app-border pt-3 space-y-2">
                        {data.orders.slice(0, 3).map((order) => (
                          <Link key={order.id} to={`/admin/orders/${order.id}`} prefetch="intent" className="flex items-center justify-between text-xs hover:bg-app-hover/50 -mx-1 px-1 py-1 rounded transition-colors">
                            <span className="text-app-fg font-medium">{order.referenceNumber || order.id.slice(0, 8)}</span>
                            <OrderStatusBadge status={order.status} />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </DeferredSection>
            )}

            {/* Payout Summary — only for roles with payroll */}
            {showPayrollCard && (
            <DeferredSection resolve={payouts} skeleton="stat">
              {(payoutList) => (
                <div className="card space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-app-fg">Payroll</h3>
                    <button type="button" onClick={() => setActiveTab('payroll')} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                      View all
                    </button>
                  </div>
                  <p className="text-3xl font-bold text-app-fg">{payoutList.length}</p>
                  <p className="text-xs text-app-fg-muted">Payout records</p>
                  {payoutList.length > 0 && (
                    <div className="border-t border-app-border pt-3 space-y-2">
                      {payoutList.slice(0, 3).map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <span className="text-app-fg-muted">
                            {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                            {' — '}
                            {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="font-medium text-app-fg">{formatNaira(Number(p.netAmount))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </DeferredSection>
            )}

            {/* Recent Activity */}
            <DeferredSection resolve={auditLog} skeleton="stat">
              {(entries) => (
                <div className="card space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-app-fg">Recent Activity</h3>
                    <button type="button" onClick={() => setActiveTab('audit')} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                      View all
                    </button>
                  </div>
                  {entries.length > 0 ? (
                    <div className="space-y-2">
                      {entries.slice(0, 5).map((entry) => (
                        <div key={entry.id} className="flex items-start gap-2 text-xs">
                          <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-app-fg truncate">
                              {formatActivityDescription(entry)}
                            </p>
                            <p className="text-app-fg-muted text-[11px] mt-0.5">
                              {new Date(entry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-app-fg-muted">No activity recorded yet</p>
                  )}
                </div>
              )}
            </DeferredSection>

            {/* Push Notification Status — SuperAdmin only */}
            {isSuperAdmin && pushStatus && (
              <DeferredSection resolve={pushStatus} skeleton="stat">
                {(status: UserPushStatus | null) => (
                  <div className="card space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-app-fg">Push Notifications</h3>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        status && status.subscribedDevices > 0
                          ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300'
                          : 'bg-app-hover text-app-fg-muted'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${status && status.subscribedDevices > 0 ? 'bg-success-500' : 'bg-app-fg-muted/50'}`} />
                        {status && status.subscribedDevices > 0 ? 'Subscribed' : 'Not subscribed'}
                      </span>
                    </div>

                    {status ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-lg bg-app-hover px-3 py-2">
                            <p className="text-[10px] text-app-fg-muted uppercase tracking-wider mb-0.5">Devices</p>
                            <p className="text-xl font-bold text-app-fg">{status.subscribedDevices}</p>
                          </div>
                          <div className="rounded-lg bg-app-hover px-3 py-2">
                            <p className="text-[10px] text-app-fg-muted uppercase tracking-wider mb-0.5">Installed</p>
                            <p className="text-xl font-bold text-app-fg">
                              {status.installedDeviceCount}
                              <span className="text-xs font-normal text-app-fg-muted">
                                {' '}
                                / {status.subscribedDevices}
                              </span>
                            </p>
                          </div>
                          <div className="rounded-lg bg-app-hover px-3 py-2">
                            <p className="text-[10px] text-app-fg-muted uppercase tracking-wider mb-0.5">Total sent</p>
                            <p className="text-xl font-bold text-app-fg">{status.totalPushSent}</p>
                          </div>
                        </div>

                        {status.lastPushSentAt && (
                          <p className="text-xs text-app-fg-muted">
                            Last push:{' '}
                            <span className="text-app-fg">
                              {new Date(status.lastPushSentAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </p>
                        )}

                        {status.subscribedDevices > 0 && status.devices.length > 0 && (
                          <div className="border-t border-app-border pt-3 space-y-2">
                            {status.devices.map((device) => (
                              <div key={device.id} className="flex items-start gap-2">
                                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m0 3.75h-3" />
                                </svg>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <InstallModeBadge
                                      mode={device.installMode}
                                      updatedAt={device.installModeUpdatedAt}
                                    />
                                  </div>
                                  <p className="text-xs text-app-fg truncate mt-0.5">{device.userAgent ?? 'Unknown device'}</p>
                                  <p className="text-[11px] text-app-fg-muted">
                                    Added {new Date(device.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-app-fg-muted">No push data available</p>
                    )}
                  </div>
                )}
              </DeferredSection>
            )}
          </div>
        </div>
      )}

      {/* ─── Orders Tab ──────────────────────────────────── */}
      {activeTab === 'orders' && (
        <DeferredSection resolve={recentOrders} skeleton="table">
          {(data) => (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-app-border flex items-center justify-between">
                <h2 className="text-sm font-semibold text-app-fg">
                  {isCSRole ? 'Orders Handled' : isMarketingRole ? 'Campaign Orders' : isLogisticsRole ? 'Delivery Orders' : 'All Orders'}
                  <span className="text-app-fg-muted font-normal ml-2">({data.total})</span>
                </h2>
              </div>
              {data.orders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">Reference</th>
                        <th className="table-header">Customer</th>
                        <th className="table-header">Status</th>
                        <th className="table-header text-right">Amount</th>
                        <th className="table-header">Date</th>
                        <th className="table-header text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((order) => (
                        <tr key={order.id} className="table-row">
                          <td className="table-cell">
                            <Link to={`/admin/orders/${order.id}`} prefetch="intent" className="text-brand-500 hover:text-brand-600 font-medium text-sm">
                              {order.referenceNumber || order.id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="table-cell text-sm text-app-fg-muted">{order.customerName || '—'}</td>
                          <td className="table-cell">
                            <OrderStatusBadge status={order.status} />
                          </td>
                          <td className="table-cell text-right text-sm font-medium text-app-fg">
                            {order.totalAmount ? formatNaira(Number(order.totalAmount)) : '—'}
                          </td>
                          <td className="table-cell text-sm text-app-fg-muted">
                            {new Date(order.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                          <td className="table-cell text-center">
                            <Link
                              to={`/admin/orders/${order.id}`}
                              prefetch="intent"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-12 text-center text-app-fg-muted">No orders found for this user</div>
              )}
            </div>
          )}
        </DeferredSection>
      )}

      {/* ─── Payroll Tab ─────────────────────────────────── */}
      {activeTab === 'payroll' && (
        <div className="space-y-6">
          {/* Payouts */}
          <DeferredSection resolve={payouts} skeleton="table">
            {(payoutList) => (
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-app-border">
                  <h2 className="text-sm font-semibold text-app-fg">Payout History</h2>
                </div>
                {payoutList.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="table-header">Period</th>
                          <th className="table-header text-right">Gross</th>
                          <th className="table-header text-right">Deductions</th>
                          <th className="table-header text-right">Net</th>
                          <th className="table-header">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payoutList.map((p) => (
                          <tr key={p.id} className="table-row">
                            <td className="table-cell text-sm">
                              {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                              {' — '}
                              {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </td>
                            <td className="table-cell text-right text-sm text-app-fg">{formatNaira(Number(p.grossAmount))}</td>
                            <td className="table-cell text-right text-sm text-danger-600 dark:text-danger-400">
                              {Number(p.deductions) > 0 ? formatNaira(-Number(p.deductions)) : '—'}
                            </td>
                            <td className="table-cell text-right text-sm font-semibold text-app-fg">{formatNaira(Number(p.netAmount))}</td>
                            <td className="table-cell">
                              <span className={p.status === 'PAID' ? 'badge-success' : p.status === 'PENDING' ? 'badge-warning' : 'badge'}>{p.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-12 text-center text-app-fg-muted">No payout records found</div>
                )}
              </div>
            )}
          </DeferredSection>

          {/* Adjustments */}
          <DeferredSection resolve={adjustments} skeleton="table">
            {(adjList) => (
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-app-border">
                  <h2 className="text-sm font-semibold text-app-fg">Adjustments & Bonuses</h2>
                </div>
                {adjList.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th className="table-header">Type</th>
                          <th className="table-header text-right">Amount</th>
                          <th className="table-header">Reason</th>
                          <th className="table-header">Status</th>
                          <th className="table-header">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjList.map((adj) => (
                          <tr key={adj.id} className="table-row">
                            <td className="table-cell">
                              <span className={adj.type === 'BONUS' || adj.type === 'ADD_ON' ? 'badge-success' : 'badge-danger'}>
                                {adj.type.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className={`table-cell text-right text-sm font-medium ${adj.type === 'DEDUCTION' || adj.type === 'CLAWBACK' ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                              {adj.type === 'DEDUCTION' || adj.type === 'CLAWBACK' ? formatNaira(-Math.abs(Number(adj.amount))) : `+${formatNaira(Number(adj.amount))}`}
                            </td>
                            <td className="table-cell text-sm text-app-fg-muted max-w-[200px] truncate">{adj.reason || '—'}</td>
                            <td className="table-cell">
                              <span className={adj.status === 'APPROVED' ? 'badge-success' : adj.status === 'PENDING' ? 'badge-warning' : 'badge'}>{adj.status}</span>
                            </td>
                            <td className="table-cell text-sm text-app-fg-muted">
                              {new Date(adj.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-12 text-center text-app-fg-muted">No adjustments found</div>
                )}
              </div>
            )}
          </DeferredSection>
        </div>
      )}

      {/* ─── Stock Tab ──────────────────────────────────── */}
      {activeTab === 'stock' && stockMovements && (
        <DeferredSection resolve={stockMovements} skeleton="table">
          {(data) => (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-app-border">
                <h2 className="text-sm font-semibold text-app-fg">
                  Stock Activity
                  <span className="text-app-fg-muted font-normal ml-2">({data.total})</span>
                </h2>
                <p className="text-xs text-app-fg-muted mt-0.5">
                  Intakes, transfers, adjustments, and reconciliations performed by this user
                </p>
              </div>
              {data.movements.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">Type</th>
                        <th className="table-header text-right">Qty</th>
                        <th className="table-header">From → To</th>
                        <th className="table-header">Reason</th>
                        <th className="table-header">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.movements.map((m) => (
                        <tr key={m.id} className="table-row">
                          <td className="table-cell">
                            <span className="badge">{MOVEMENT_TYPE_LABELS[m.movementType] ?? m.movementType}</span>
                          </td>
                          <td className="table-cell text-right text-sm font-medium">{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                          <td className="table-cell text-xs text-app-fg-muted">
                            {m.fromLocationId ? m.fromLocationId.slice(0, 8) : '—'}
                            {' → '}
                            {m.toLocationId ? m.toLocationId.slice(0, 8) : '—'}
                          </td>
                          <td className="table-cell text-sm text-app-fg-muted max-w-[200px] truncate">{m.reason ?? '—'}</td>
                          <td className="table-cell text-sm text-app-fg-muted">
                            {new Date(m.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-12 text-center text-app-fg-muted">No stock movements found</div>
              )}
            </div>
          )}
        </DeferredSection>
      )}

      {/* ─── Finance Activity Tab ─────────────────────────── */}
      {activeTab === 'finance' && financeActivity && (
        <DeferredSection resolve={financeActivity} skeleton="table">
          {(data) => (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-app-border">
                <h2 className="text-sm font-semibold text-app-fg">
                  Approvals Processed
                  <span className="text-app-fg-muted font-normal ml-2">({data.total})</span>
                </h2>
                <p className="text-xs text-app-fg-muted mt-0.5">
                  Approval requests processed by this Finance Officer
                </p>
              </div>
              {data.approvals.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">Type</th>
                        <th className="table-header text-right">Amount</th>
                        <th className="table-header">Description</th>
                        <th className="table-header">Status</th>
                        <th className="table-header">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.approvals.map((a) => (
                        <tr key={a.id} className="table-row">
                          <td className="table-cell">
                            <span className="badge">{a.type.replace(/_/g, ' ')}</span>
                          </td>
                          <td className="table-cell text-right text-sm font-medium">{formatNaira(Number(a.amount))}</td>
                          <td className="table-cell text-sm text-app-fg-muted max-w-[200px] truncate">{a.description}</td>
                          <td className="table-cell">
                            <span className={a.status === 'APPROVED' ? 'badge-success' : a.status === 'REJECTED' ? 'badge-danger' : 'badge'}>{a.status}</span>
                          </td>
                          <td className="table-cell text-sm text-app-fg-muted">
                            {a.approvedAt
                              ? new Date(a.approvedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                              : new Date(a.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-12 text-center text-app-fg-muted">No approvals processed yet</div>
              )}
            </div>
          )}
        </DeferredSection>
      )}

      {/* ─── Activity / Audit Tab ────────────────────────── */}
      {activeTab === 'audit' && (
        <DeferredSection resolve={auditLog} skeleton="stat">
          {(entries) => <ActivityTabContent entries={entries} />}
        </DeferredSection>
      )}

      {/* ─── Settings / Edit Tab ─────────────────────────── */}
      {activeTab === 'edit' && (
        <Form
          method="post"
          className="space-y-6"
          onSubmit={(e) => {
            if (pendingConflict) {
              e.preventDefault();
              setConflictModalOpen(true);
            }
          }}
        >
          <input type="hidden" name="intent" value="update" />
          {showProductAssignment && selectedProductIds.length > 0 && (
            <input type="hidden" name="productIds" value={JSON.stringify(selectedProductIds)} />
          )}

          {canEditLimited && (
            <InlineNotification
              variant="info"
              message={
                user.role === 'CS_AGENT'
                  ? 'As Head of CS you can change this agent’s order capacity and assigned products. For role changes, account status, or password resets, contact an administrator.'
                  : 'As Head of Marketing you can change this buyer’s assigned products. For role changes, account status, or password resets, contact an administrator.'
              }
            />
          )}

          {/* Account Details — admin-only; hidden for team-lead scoped edits */}
          {!canEditLimited && (
          <div className="card space-y-4">
            <h2 className="text-base font-semibold text-app-fg">Account Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <FormSelect
                  id="role"
                  name="role"
                  label="Role"
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                  options={ROLES.map((role) => ({ value: role.value, label: role.label }))}
                />
                {HEAD_ROLES.includes(selectedRole) && selectedRole !== user.role && user.primaryBranchId && activeHeads && (
                  <DeferredSection resolve={activeHeads} skeleton="inline">
                    {(heads: ActiveHeadUser[]) => {
                      const conflict = heads.find(
                        (h) =>
                          h.role === selectedRole &&
                          h.primaryBranchId === user.primaryBranchId &&
                          h.id !== user.id,
                      );
                      if (!conflict) return null;
                      return (
                        <DeferredSection resolve={branchesList ?? Promise.resolve([])} skeleton="inline">
                          {(branches: Array<{ id: string; name: string }>) => {
                            const branchName =
                              branches.find((b) => b.id === user.primaryBranchId)?.name ?? 'This branch';
                            return (
                              <div className="mt-2">
                                <InlineNotification
                                  variant="warning"
                                  message={`${branchName} already has an active ${formatRole(selectedRole)} (${conflict.name}). Saving this change will be rejected — deactivate them first.`}
                                />
                              </div>
                            );
                          }}
                        </DeferredSection>
                      );
                    }}
                  </DeferredSection>
                )}
              </div>
              <div>
                <TextInput id="name" name="name" type="text" label="Full Name" defaultValue={user.name} />
              </div>
              <div>
                <TextInput id="email" name="email" type="email" label="Email Address" defaultValue={user.email} />
                <p className="text-xs text-warning-600 dark:text-warning-400 mt-1">Email changes require SuperAdmin approval before taking effect.</p>
              </div>
              <div>
                {user.status === 'DEACTIVATED' ? (
                  <>
                    <p className="text-sm font-medium text-app-fg-muted mb-1.5">Status</p>
                    <p className="text-sm text-app-fg-muted">Deactivated accounts cannot be reactivated. Re-invite to create a new account.</p>
                  </>
                ) : (
                  <RadioGroup
                    name="status"
                    label="Status"
                    layout="horizontal"
                    defaultValue={user.status}
                    options={(['PENDING', 'ACTIVE', 'INACTIVE', 'DEACTIVATED', 'ARCHIVED'] as const).map((s) => ({
                      value: s,
                      label: s.charAt(0) + s.slice(1).toLowerCase(),
                    }))}
                  />
                )}
              </div>
              <div>
                <TextInput
                  id="phone"
                  name="phone"
                  type="tel"
                  label="Phone"
                  defaultValue=""
                  placeholder="Enter new phone"
                />
                <p className="text-xs text-app-fg-muted mt-1">Current: {user.phone ?? 'Not set'}. Leave blank to keep unchanged.</p>
              </div>
            </div>
          </div>
          )}

          {/* Finance hat — org-wide singleton. Admin-only; hidden for team-lead edits. */}
          {!canEditLimited && selectedRole !== 'FINANCE_OFFICER' && (
            <div className="card space-y-3">
              <h2 className="text-base font-semibold text-app-fg">Finance hat</h2>
              <p className="text-sm text-app-fg-muted">
                Deputize this user with Finance Officer powers (column-level cost visibility, approvals, remittance) <strong>in addition to</strong> their primary role. Only one user can hold the hat at any time.
              </p>
              <input type="hidden" name="isFinanceOfficer" value={assignFinanceHat ? 'true' : 'false'} />
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={assignFinanceHat}
                  onChange={(e) => setAssignFinanceHat((e.target as HTMLInputElement).checked)}
                />
                <span className="text-sm text-app-fg">This user holds the Finance hat</span>
              </label>
              {assignFinanceHat && !user.isFinanceOfficer && currentFinanceOfficer && (
                <DeferredSection resolve={currentFinanceOfficer} skeleton="inline">
                  {(holder: FinanceHatHolder | null) => {
                    if (!holder || holder.id === user.id) return null;
                    return (
                      <InlineNotification
                        variant="warning"
                        message={`The Finance hat is currently held by ${holder.name}. Saving will revoke it from them automatically.`}
                      />
                    );
                  }}
                </DeferredSection>
              )}
              {user.isFinanceOfficer && !assignFinanceHat && (
                <InlineNotification
                  variant="warning"
                  message="Unchecking this revokes the Finance hat from this user. No one else will hold it until you assign it to someone else."
                />
              )}
            </div>
          )}

          {/* Role Settings */}
          {(showCapacity || showLogisticsLocation || showProductAssignment) && (
            <div className="card space-y-4">
              <h2 className="text-base font-semibold text-app-fg">Role Settings</h2>

              {showCapacity && (
                <div>
                  <TextInput
                    id="capacity"
                    name="capacity"
                    type="number"
                    label="Order Capacity"
                    min={1}
                    max={100}
                    defaultValue={String(user.capacity)}
                    wrapperClassName="w-full sm:w-32"
                  />
                </div>
              )}

              {showLogisticsLocation && !canEditLimited && (
                <DeferredSection resolve={locations} skeleton="inline">
                  {(locs) => (
                    <div>
                      <FormSelect
                        id="logisticsLocationId"
                        name="logisticsLocationId"
                        label="Logistics Location"
                        defaultValue={user.logisticsLocationId ?? ''}
                        placeholder="Select location"
                        options={locs.map((loc: UserCreateLocation) => ({
                          value: loc.id,
                          label: `${loc.name} — ${loc.address}`,
                        }))}
                      />
                      {locs.length === 0 && (
                        <InlineNotification
                          variant="warning"
                          message="No logistics locations found. Create one first."
                          action={{ label: 'Go to Logistics', href: '/admin/logistics' }}
                          className="mt-2"
                        />
                      )}
                    </div>
                  )}
                </DeferredSection>
              )}

              {showProductAssignment && (
                <DeferredSection resolve={products} skeleton="table">
                  {(prods) => (
                    <div>
                      <label className="block text-sm font-medium text-app-fg-muted mb-1.5">Assign Products</label>
                      <p className="text-xs text-app-fg-muted mb-2">Leave blank to assign all products.</p>
                      {prods.length > 0 ? (
                        <div className="border border-app-border rounded-lg max-h-48 overflow-y-auto">
                          {prods.map((product: UserCreateProduct) => (
                            <label key={product.id} className="flex items-center gap-3 px-3 py-2 hover:bg-app-hover/50 cursor-pointer border-b border-app-border last:border-b-0">
                              <Checkbox
                                checked={selectedProductIds.includes(product.id)}
                                onChange={() => toggleProduct(product.id)}
                              />
                              <span className="text-sm text-app-fg">{product.name}</span>
                              <span className="text-xs text-app-fg-muted ml-auto">{product.category ?? ''}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-app-fg-muted">No products found.</p>
                      )}
                      {selectedProductIds.length > 0 && (
                        <div className="mt-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              name="restrictProductAccess"
                              value="true"
                              defaultChecked={user.restrictProductAccess}
                            />
                            <span className="text-sm text-app-fg-muted">Restrict access to only assigned products</span>
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </DeferredSection>
              )}
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setActiveTab('overview')}>Cancel</Button>
            <Button type="submit" variant="primary" className="w-full sm:w-auto" loading={isUpdating} loadingText="Saving...">
              Save Changes
            </Button>
          </div>
        </Form>
      )}

      {/* ─── Reset Password Modal ────────────────────────── */}
      {showResetPassword && (
        <Modal open onClose={() => setShowResetPassword(false)} maxWidth="max-w-md" contentClassName="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-app-fg">Reset Password</h3>
            <p className="text-sm text-app-fg-muted">
              Set a new password for <strong>{user.name}</strong>. This will log them out of all sessions.
            </p>
            {resetFetcher.data?.error && (
              <InlineNotification variant="danger" message={resetFetcher.data.error} />
            )}
            <resetFetcher.Form method="post" action=".">
              <input type="hidden" name="intent" value="resetPassword" />
              <div className="space-y-4">
                <div>
                  <TextInput
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    label="New Password"
                    required
                    minLength={8}
                    placeholder="Minimum 8 characters"
                  />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={() => setShowResetPassword(false)} disabled={isResetting}>Cancel</Button>
                  <Button type="submit" variant="primary" loading={isResetting} loadingText="Resetting...">
                    Reset Password
                  </Button>
                </div>
              </div>
            </resetFetcher.Form>
        </Modal>
      )}

      {/* ─── Email Change Approval Modal ─────────────────── */}
      {showEmailChangeModal && (
        <Modal open onClose={() => { setShowEmailChangeModal(null); setEmailChangeReason(''); }} maxWidth="max-w-md" contentClassName="p-6 space-y-4">
            <h3 className="text-lg font-semibold text-app-fg">
              {showEmailChangeModal.action === 'APPROVED' ? 'Approve' : 'Reject'} Email Change
            </h3>
            <p className="text-sm text-app-fg-muted">
              {showEmailChangeModal.action === 'APPROVED'
                ? 'This will update the user\'s email address. Please provide a reason for the approval.'
                : 'This will reject the pending email change. Please provide a reason.'}
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="processEmailChange" />
              <input type="hidden" name="requestId" value={showEmailChangeModal.requestId} />
              <input type="hidden" name="action" value={showEmailChangeModal.action} />
              <div className="space-y-4">
                <div>
                  <Textarea
                    id="emailChangeReason"
                    name="reason"
                    label="Reason (min 10 characters)"
                    required
                    minLength={10}
                    value={emailChangeReason}
                    onChange={(e) => setEmailChangeReason(e.target.value)}
                    rows={4}
                    placeholder="e.g. Verified with HR, request approved"
                  />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={() => { setShowEmailChangeModal(null); setEmailChangeReason(''); }}>Cancel</Button>
                  <Button
                    type="submit"
                    variant={showEmailChangeModal.action === 'APPROVED' ? 'success' : 'danger'}
                    disabled={isProcessingEmailChange || emailChangeReason.length < 10}
                    loading={isProcessingEmailChange}
                    loadingText="Processing..."
                  >
                    {showEmailChangeModal.action === 'APPROVED' ? 'Approve' : 'Reject'}
                  </Button>
                </div>
              </div>
            </Form>
        </Modal>
      )}

      {/* ─── Deactivate Confirmation Modal ───────────────── */}
      {showDeactivateConfirm && (
        <Modal open onClose={() => setShowDeactivateConfirm(false)} maxWidth="max-w-lg" role="alertdialog" aria-labelledby="deactivate-modal-title" aria-describedby="deactivate-modal-desc" contentClassName="p-6 space-y-5 border-2 border-danger-200 dark:border-danger-800">
            <div className="flex items-center gap-3 pb-2 border-b border-danger-100 dark:border-danger-900/50">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/50 flex items-center justify-center">
                <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h3 id="deactivate-modal-title" className="text-lg font-semibold text-danger-700 dark:text-danger-300">
                Deactivate user permanently
              </h3>
            </div>
            <p id="deactivate-modal-desc" className="text-sm text-app-fg-muted">
              You are about to deactivate <strong>{user.name}</strong> ({user.email}). This action is <strong>irreversible</strong> for this account.
            </p>
            <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 p-4 space-y-2">
              <p className="text-sm font-medium text-danger-800 dark:text-danger-200">Risks and consequences:</p>
              <ul className="text-sm text-danger-700 dark:text-danger-300 space-y-1.5 list-disc list-inside">
                <li>Their login will be disabled immediately; all sessions will be terminated.</li>
                <li>They will disappear from the default user list (only visible when filtering by “Deactivated”).</li>
                <li>This account <strong>cannot be reactivated</strong>. To give them access again you must re-invite them, which creates a new account and new audit history.</li>
                <li>Existing audit trail and historical data (orders, payouts, etc.) remain tied to this user for compliance.</li>
              </ul>
            </div>
            <p className="text-xs text-app-fg-muted">
              Only Super Admins can deactivate users. If you need to temporarily disable access, use <strong>Inactive</strong> or <strong>Archived</strong> instead (those can be reactivated).
            </p>
            {actionData?.error && !dismissedError && (
              <PageNotification
                variant="error"
                message={actionData.error}
                durationMs={5000}
                onDismiss={() => setDismissedError(true)}
              />
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowDeactivateConfirm(false)} disabled={isDeactivating}>
                Cancel
              </Button>
              <Form method="post">
                <input type="hidden" name="intent" value="deactivate" />
                <Button
                  type="submit"
                  variant="danger"
                  loading={isDeactivating}
                  loadingText="Deactivating..."
                  className="bg-danger-600 hover:bg-danger-700 text-white border-danger-600 hover:border-danger-700"
                >
                  Deactivate permanently
                </Button>
              </Form>
            </div>
        </Modal>
      )}

      {conflictModalOpen && pendingConflict && (
        <Modal
          open
          onClose={() => setConflictModalOpen(false)}
          maxWidth="max-w-md"
          contentClassName="p-6"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-2">Role already taken in this branch</h3>
          <p className="text-sm text-app-fg-muted mb-3">
            Only one active <strong>{formatRole(selectedRole)}</strong> is allowed per branch.{' '}
            <strong>{pendingConflictBranchName}</strong> already has{' '}
            <strong>{pendingConflict.name}</strong> in that role.
          </p>
          <p className="text-sm text-app-fg-muted mb-4">
            To change {user.name}&apos;s role to {formatRole(selectedRole)}, first change{' '}
            {pendingConflict.name}&apos;s role (or deactivate them) from their profile.
          </p>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConflictModalOpen(false)}
            >
              Back
            </Button>
            <Link
              to={`${usersBasePath}/${pendingConflict.id}`}
              className="btn-primary"
              onClick={() => setConflictModalOpen(false)}
            >
              Go to {pendingConflict.name}
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function InstallModeBadge({
  mode,
  updatedAt,
}: {
  mode: 'STANDALONE' | 'BROWSER' | 'UNKNOWN';
  updatedAt: string | null;
}) {
  // Stale threshold: if the client heartbeat hasn't reported in 30 days, downgrade the badge
  // to "Unknown" since we can't vouch for the current install state on that device.
  const STALE_MS = 30 * 24 * 60 * 60 * 1000;
  const isStale = updatedAt ? Date.now() - new Date(updatedAt).getTime() > STALE_MS : true;
  const effectiveMode = mode === 'UNKNOWN' || isStale ? 'UNKNOWN' : mode;

  const style =
    effectiveMode === 'STANDALONE'
      ? 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-300'
      : effectiveMode === 'BROWSER'
        ? 'bg-app-hover text-app-fg-muted'
        : 'bg-app-hover text-app-fg-muted/70';
  const label =
    effectiveMode === 'STANDALONE'
      ? 'Installed'
      : effectiveMode === 'BROWSER'
        ? 'Browser'
        : 'Unknown';
  const title = updatedAt
    ? `Last reported ${new Date(updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
    : 'Never reported by this device';
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${style}`}
    >
      {label}
    </span>
  );
}

function InfoField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {icon && <div className="mt-0.5 text-app-fg-muted flex-shrink-0">{icon}</div>}
      <div>
        <p className="text-[11px] font-medium text-app-fg-muted uppercase tracking-wider">{label}</p>
        <p className="text-sm text-app-fg mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'warning' | 'danger' }) {
  const color = accent === 'success' ? 'text-success-600 dark:text-success-400'
    : accent === 'warning' ? 'text-warning-600 dark:text-warning-400'
    : accent === 'danger' ? 'text-danger-600 dark:text-danger-400'
    : 'text-app-fg';

  return (
    <div className="p-3 rounded-lg bg-app-hover">
      <p className="text-[11px] font-medium text-app-fg-muted uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'ACTIVE' ? 'bg-success-500' : status === 'PENDING' ? 'bg-info-500' : status === 'DEACTIVATED' ? 'bg-danger-500' : status === 'INACTIVE' ? 'bg-danger-500' : 'bg-warning-500';
  return <div className={`w-4 h-4 rounded-full ${color} flex items-center justify-center`}><div className="w-2 h-2 rounded-full bg-white" /></div>;
}

function getTimeSince(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  if (months === 1) return '1 month';
  if (months < 12) return `${months} months`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return `${years}y`;
  return `${years}y ${remainingMonths}m`;
}

// ─── Icons ──────────────────────────────────────────────

function UserIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>;
}
function EnvelopeIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>;
}
function ShieldIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>;
}
function PhoneIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>;
}
function StackIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.43 9.75m11.14 0l4.179 2.25-4.179 2.25m0 0L12 17.25l-5.571-3m11.142 0l4.179 2.25L12 21.75l-9.75-5.25 4.179-2.25" /></svg>;
}
function CalendarIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>;
}
function ClockIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}


/**
 * Activity / audit log tab — paginated 10/page client-side. Loader returns up to 50 entries
 * (UserAuditEntry[]); we slice in-memory because the volume is small and avoiding a server
 * round-trip per page keeps the tab responsive.
 */
function ActivityTabContent({ entries }: { entries: UserAuditEntry[] }) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const paged = entries.slice(startIdx, startIdx + PAGE_SIZE);

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-app-fg">Activity</h3>
        <span className="text-xs text-app-fg-muted">{entries.length} entries</span>
      </div>
      {entries.length > 0 ? (
        <>
          <div className="space-y-2">
            {paged.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-app-fg truncate">{formatActivityDescription(entry)}</p>
                  <p className="text-app-fg-muted text-[11px] mt-0.5">
                    {new Date(entry.createdAt).toLocaleDateString("en-NG", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="pt-2 border-t border-app-border flex items-center justify-between">
              <p className="text-[11px] text-app-fg-muted">
                Showing {startIdx + 1}–{Math.min(startIdx + PAGE_SIZE, entries.length)} of {entries.length}
              </p>
              <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-app-fg-muted">No activity recorded yet</p>
      )}
    </div>
  );
}
