import { useState, useEffect } from 'react';
import { Form, Link, useActionData, useNavigation } from '@remix-run/react';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Button } from '~/components/ui/button';
import { InlineNotification } from '~/components/ui/inline-notification';
import { Tabs } from '~/components/ui/tabs';
import { formatActivityDescription } from '~/lib/format-activity';
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
} from './types';
import { ROLE_COLORS, USER_STATUS_COLORS, ROLE_AVATAR_GRADIENTS, formatRole } from './types';

// ─── Constants ──────────────────────────────────────────

const ROLES = [
  { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
  { value: 'MEDIA_BUYER', label: 'Media Buyer' },
  { value: 'HEAD_OF_CS', label: 'Head of CS' },
  { value: 'CS_AGENT', label: 'CS Agent' },
  { value: 'FINANCE_OFFICER', label: 'Finance Officer' },
  { value: 'HEAD_OF_LOGISTICS', label: 'Head of Logistics' },
  { value: 'WAREHOUSE_MANAGER', label: 'Warehouse Manager' },
  { value: 'TPL_MANAGER', label: '3PL Manager' },
  { value: 'TPL_RIDER', label: '3PL Rider' },
  { value: 'HR_MANAGER', label: 'HR Manager' },
  { value: 'SUPER_ADMIN', label: 'Super Admin' },
];

const ORDER_STATUSES = [
  { value: 'UNPROCESSED', label: 'Unprocessed', color: 'bg-surface-500' },
  { value: 'CS_ENGAGED', label: 'CS Engaged', color: 'bg-blue-500' },
  { value: 'CONFIRMED', label: 'Confirmed', color: 'bg-green-500' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'bg-red-500' },
  { value: 'ALLOCATED', label: 'Allocated', color: 'bg-indigo-500' },
  { value: 'DISPATCHED', label: 'Dispatched', color: 'bg-purple-500' },
  { value: 'IN_TRANSIT', label: 'In Transit', color: 'bg-amber-500' },
  { value: 'DELIVERED', label: 'Delivered', color: 'bg-emerald-500' },
  { value: 'PARTIALLY_DELIVERED', label: 'Partial Delivery', color: 'bg-teal-500' },
  { value: 'RETURNED', label: 'Returned', color: 'bg-orange-500' },
  { value: 'RESTOCKED', label: 'Restocked', color: 'bg-cyan-500' },
  { value: 'WRITTEN_OFF', label: 'Written Off', color: 'bg-rose-500' },
  { value: 'COMPLETED', label: 'Completed', color: 'bg-green-700' },
];

const ORDER_STATUS_COLORS: Record<string, string> = {
  UNPROCESSED: 'badge-warning',
  CS_ENGAGED: 'badge-info',
  CONFIRMED: 'badge-success',
  CANCELLED: 'badge-danger',
  ALLOCATED: 'badge-info',
  DISPATCHED: 'badge-brand',
  IN_TRANSIT: 'badge-warning',
  DELIVERED: 'badge-success',
  PARTIALLY_DELIVERED: 'badge-warning',
  RETURNED: 'badge-danger',
  RESTOCKED: 'badge-info',
  WRITTEN_OFF: 'badge-danger',
  COMPLETED: 'badge-success',
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  SUPER_ADMIN: 'Full system access. Can manage all modules, users, and settings.',
  HEAD_OF_MARKETING: 'Oversees all marketing campaigns, funding, and media buyer performance.',
  MEDIA_BUYER: 'Runs ad campaigns, manages ad spend, and tracks CPA/ROAS.',
  HEAD_OF_CS: 'Manages CS team performance, order processing, and agent workloads.',
  CS_AGENT: 'Handles customer calls, confirms orders, and processes cancellations.',
  FINANCE_OFFICER: 'Manages invoices, approvals, budgets, and financial reporting.',
  HEAD_OF_LOGISTICS: 'Oversees all logistics operations, 3PL partners, and transfers.',
  WAREHOUSE_MANAGER: 'Manages inventory, stock movements, and procurement.',
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
  pendingEmailChange,
  stockMovements,
  financeActivity,
  canDisburseToThisUser = false,
}: UserDetailLoaderData) {
  const actionData = useActionData<{ error?: string; success?: boolean; message?: string; requiresApproval?: boolean }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';
  const formIntent = navigation.formData?.get('intent')?.toString();
  const isDeactivating = isSubmitting && formIntent === 'deactivate';
  const isReactivating = isSubmitting && formIntent === 'reactivate';
  const isResetting = isSubmitting && formIntent === 'resetPassword';
  const isUpdating = isSubmitting && formIntent === 'update';
  const isProcessingEmailChange = isSubmitting && formIntent === 'processEmailChange';

  type TabId = 'overview' | 'orders' | 'payroll' | 'stock' | 'finance' | 'audit' | 'edit';
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [showEmailChangeModal, setShowEmailChangeModal] = useState<{ requestId: string; action: 'APPROVED' | 'REJECTED' } | null>(null);
  const [emailChangeReason, setEmailChangeReason] = useState('');

  // Derived flags (must be before useEffects that reference them)
  const isSuperAdminProfile = user.role === 'SUPER_ADMIN';

  // Close reset modal on success
  useEffect(() => {
    if (actionData?.success && actionData?.message?.includes('Password')) {
      setShowResetPassword(false);
    }
  }, [actionData?.success, actionData?.message]);

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
  const showStockTab = ['WAREHOUSE_MANAGER', 'TPL_MANAGER', 'HEAD_OF_LOGISTICS'].includes(user.role);
  const showFinanceTab = ['FINANCE_OFFICER'].includes(user.role);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(showOrdersTab ? [{ id: 'orders' as const, label: 'Orders' }] : []),
    ...(showPayrollTab ? [{ id: 'payroll' as const, label: 'Payroll' }] : []),
    ...(showStockTab ? [{ id: 'stock' as const, label: 'Stock' }] : []),
    ...(showFinanceTab ? [{ id: 'finance' as const, label: 'Finance Activity' }] : []),
    { id: 'audit', label: 'Activity' },
    ...(!isSuperAdminProfile ? [{ id: 'edit' as const, label: 'Settings' }] : []),
  ];

  // When viewing a user, ensure activeTab is valid for their role
  useEffect(() => {
    const validIds = new Set<TabId>(['overview', 'audit']);
    if (showOrdersTab) validIds.add('orders');
    if (showPayrollTab) validIds.add('payroll');
    if (showStockTab) validIds.add('stock');
    if (showFinanceTab) validIds.add('finance');
    if (!isSuperAdminProfile) validIds.add('edit');
    if (!validIds.has(activeTab)) {
      setActiveTab('overview');
    }
  }, [user.role, activeTab, showOrdersTab, showPayrollTab, showStockTab, showFinanceTab, isSuperAdminProfile]);

  // Edit form state
  const [selectedRole, setSelectedRole] = useState(user.role);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(
    user.visibleOrderStatuses ?? ORDER_STATUSES.map((s) => s.value),
  );
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  const showCapacity = ['CS_AGENT', 'HEAD_OF_CS'].includes(selectedRole);
  const showOrderStatuses = ['CS_AGENT', 'HEAD_OF_CS'].includes(selectedRole);
  const showLogisticsLocation = ['TPL_MANAGER', 'TPL_RIDER'].includes(selectedRole);
  const showProductAssignment = ['MEDIA_BUYER', 'HEAD_OF_MARKETING', 'CS_AGENT', 'HEAD_OF_CS'].includes(selectedRole);
  const isMarketingRole = ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(user.role);
  const isCSRole = ['CS_AGENT', 'HEAD_OF_CS'].includes(user.role);
  const isLogisticsRole = ['TPL_MANAGER', 'TPL_RIDER', 'HEAD_OF_LOGISTICS', 'WAREHOUSE_MANAGER'].includes(user.role);

  const toggleStatus = (value: string) => {
    setSelectedStatuses((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  };

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
        <Link to="/hr/users" prefetch="intent" className="text-surface-800 dark:text-surface-200 hover:text-brand-500 transition-colors">
          Users
        </Link>
        <svg className="w-4 h-4 text-surface-300 dark:text-surface-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-surface-900 dark:text-white font-medium truncate">{user.name}</span>
      </div>

      {/* Action feedback */}
      {actionData?.error && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionData.error}</p>
        </div>
      )}
      {actionData?.success && actionData.message && (
        <div className="rounded-lg bg-success-50 dark:bg-success-700/20 border border-success-200 dark:border-success-700/50 px-4 py-3">
          <p className="text-sm text-success-700 dark:text-success-500">{actionData.message}</p>
          {actionData.requiresApproval && (
            <Link to="/admin/permission-requests" className="text-sm font-medium text-success-600 dark:text-success-400 hover:underline mt-1 inline-block">
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
                  <h1 className="text-xl sm:text-2xl font-bold text-surface-900 dark:text-white">{user.name}</h1>
                  <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">{user.email}</p>
                </div>
                {(canDisburseToThisUser || !isSuperAdminProfile) && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canDisburseToThisUser && (
                      <Link
                        to={`/admin/disbursements?receiverId=${user.id}`}
                        className="btn-primary btn-sm"
                      >
                        Disburse
                      </Link>
                    )}
                    {!isSuperAdminProfile && (
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
                        {user.status === 'ACTIVE' && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setShowDeactivateConfirm(true)}
                            className="text-danger-600 dark:text-danger-400 hover:text-danger-700 border-danger-200 dark:border-danger-700 hover:border-danger-300"
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
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick info pills */}
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span className={ROLE_COLORS[user.role] ?? 'badge'}>{formatRole(user.role)}</span>
            <span className={USER_STATUS_COLORS[user.status] ?? 'badge'}>{user.status}</span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {tenure}
            </span>
            {user.phone && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
                {user.phone}
              </span>
            )}
            {isCSRole && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
                </svg>
                Capacity: {user.capacity}
              </span>
            )}
          </div>

          {/* Role description */}
          <p className="text-xs text-surface-600 dark:text-surface-300 mt-3">
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
                <h2 className="text-base font-semibold text-surface-900 dark:text-white">Account Information</h2>
                {!isSuperAdminProfile && (
                  <button type="button" onClick={() => setActiveTab('edit')} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                    Edit
                  </button>
                )}
              </div>
              <DeferredSection resolve={pendingEmailChange} skeleton="inline">
                {(pending: PendingEmailChange | null) => pending && !isSuperAdminProfile && (
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
                {isCSRole && <InfoField label="Order Capacity" value={String(user.capacity)} icon={<StackIcon />} />}
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
            {(user.visibleOrderStatuses || user.logisticsLocationId || user.restrictProductAccess) && (
              <div className="card space-y-4">
                <h2 className="text-base font-semibold text-surface-900 dark:text-white">Role Configuration</h2>

                {user.visibleOrderStatuses && user.visibleOrderStatuses.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-2">Visible Order Tabs</p>
                    <div className="flex flex-wrap gap-1.5">
                      {user.visibleOrderStatuses.map((s) => {
                        const def = ORDER_STATUSES.find((os) => os.value === s);
                        return (
                          <span key={s} className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium text-white ${def?.color ?? 'bg-surface-500'}`}>
                            {def?.label ?? s}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {user.logisticsLocationId && (
                  <div>
                    <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-1">Assigned Location</p>
                    <p className="text-xs font-mono text-surface-900 dark:text-surface-100 bg-surface-50 dark:bg-surface-800 px-2 py-1 rounded inline-block">{user.logisticsLocationId}</p>
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
                    <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-1">Commission Plan ID</p>
                    <p className="text-xs font-mono bg-surface-50 dark:bg-surface-800 px-2 py-1 rounded inline-block text-surface-900 dark:text-surface-100">{user.commissionPlanId}</p>
                  </div>
                )}
              </div>
            )}

            {/* Marketing Metrics — only for marketing roles */}
            {isMarketingRole && (
              <DeferredSection resolve={marketingMetrics} skeleton="stat">
                {(metrics) => metrics && (
                  <div className="card space-y-4">
                    <h2 className="text-base font-semibold text-surface-900 dark:text-white">Marketing Performance</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                      <MetricCard label="Total Spend" value={`₦${Number(metrics.totalSpend).toLocaleString()}`} />
                      <MetricCard label="Total Orders" value={String(metrics.totalOrders)} />
                      <MetricCard label="Delivered" value={String(metrics.deliveredOrders)} accent="success" />
                      <MetricCard label="Revenue" value={`₦${Number(metrics.deliveredRevenue).toLocaleString()}`} accent="success" />
                      <MetricCard label="CPA" value={`₦${Number(metrics.cpa).toLocaleString()}`} />
                      <MetricCard label="True ROAS" value={`${Number(metrics.trueRoas).toFixed(2)}x`} accent={metrics.trueRoas >= 2 ? 'success' : metrics.trueRoas >= 1 ? 'warning' : 'danger'} />
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
                      <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Orders</h3>
                      <button type="button" onClick={() => setActiveTab('orders')} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                        View all
                      </button>
                    </div>
                    <p className="text-3xl font-bold text-surface-900 dark:text-white">{data.total}</p>
                    <p className="text-xs text-surface-600 dark:text-surface-300">
                      {isCSRole ? 'Orders handled as CS agent' : isMarketingRole ? 'Orders from campaigns' : isLogisticsRole ? 'Deliveries assigned' : 'Total orders in system'}
                    </p>
                    {data.orders.length > 0 && (
                      <div className="border-t border-surface-100 dark:border-surface-800 pt-3 space-y-2">
                        {data.orders.slice(0, 3).map((order) => (
                          <Link key={order.id} to={`/admin/orders/${order.id}`} prefetch="intent" className="flex items-center justify-between text-xs hover:bg-surface-50 dark:hover:bg-surface-800/50 -mx-1 px-1 py-1 rounded transition-colors">
                            <span className="text-surface-900 dark:text-surface-100 font-medium">{order.referenceNumber || order.id.slice(0, 8)}</span>
                            <span className={ORDER_STATUS_COLORS[order.status] ?? 'badge'}>{order.status.replace('_', ' ')}</span>
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
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Payroll</h3>
                    <button type="button" onClick={() => setActiveTab('payroll')} className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                      View all
                    </button>
                  </div>
                  <p className="text-3xl font-bold text-surface-900 dark:text-white">{payoutList.length}</p>
                  <p className="text-xs text-surface-600 dark:text-surface-300">Payout records</p>
                  {payoutList.length > 0 && (
                    <div className="border-t border-surface-100 dark:border-surface-800 pt-3 space-y-2">
                      {payoutList.slice(0, 3).map((p) => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <span className="text-surface-700 dark:text-surface-200">
                            {new Date(p.periodStart).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                            {' — '}
                            {new Date(p.periodEnd).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                          </span>
                          <span className="font-medium text-surface-900 dark:text-surface-100">₦{Number(p.netAmount).toLocaleString()}</span>
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
                    <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Recent Activity</h3>
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
                            <p className="text-surface-900 dark:text-surface-200 truncate">
                              {formatActivityDescription(entry)}
                            </p>
                            <p className="text-surface-500 dark:text-surface-600 text-[11px] mt-0.5">
                              {new Date(entry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-surface-500">No activity recorded yet</p>
                  )}
                </div>
              )}
            </DeferredSection>
          </div>
        </div>
      )}

      {/* ─── Orders Tab ──────────────────────────────────── */}
      {activeTab === 'orders' && (
        <DeferredSection resolve={recentOrders} skeleton="table">
          {(data) => (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-surface-900 dark:text-white">
                  {isCSRole ? 'Orders Handled' : isMarketingRole ? 'Campaign Orders' : isLogisticsRole ? 'Delivery Orders' : 'All Orders'}
                  <span className="text-surface-500 dark:text-surface-200 font-normal ml-2">({data.total})</span>
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
                          <td className="table-cell text-sm text-surface-800 dark:text-surface-300">{order.customerName || '—'}</td>
                          <td className="table-cell">
                            <span className={ORDER_STATUS_COLORS[order.status] ?? 'badge'}>{order.status.replace(/_/g, ' ')}</span>
                          </td>
                          <td className="table-cell text-right text-sm font-medium text-surface-900 dark:text-surface-100">
                            {order.totalAmount ? `₦${Number(order.totalAmount).toLocaleString()}` : '—'}
                          </td>
                          <td className="table-cell text-sm text-surface-600 dark:text-surface-200">
                            {new Date(order.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-12 text-center text-surface-500">No orders found for this user</div>
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
                <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                  <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Payout History</h2>
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
                            <td className="table-cell text-right text-sm text-surface-900 dark:text-surface-100">₦{Number(p.grossAmount).toLocaleString()}</td>
                            <td className="table-cell text-right text-sm text-danger-600 dark:text-danger-400">
                              {Number(p.deductions) > 0 ? `-₦${Number(p.deductions).toLocaleString()}` : '—'}
                            </td>
                            <td className="table-cell text-right text-sm font-semibold text-surface-900 dark:text-surface-100">₦{Number(p.netAmount).toLocaleString()}</td>
                            <td className="table-cell">
                              <span className={p.status === 'PAID' ? 'badge-success' : p.status === 'PENDING' ? 'badge-warning' : 'badge'}>{p.status}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-12 text-center text-surface-500">No payout records found</div>
                )}
              </div>
            )}
          </DeferredSection>

          {/* Adjustments */}
          <DeferredSection resolve={adjustments} skeleton="table">
            {(adjList) => (
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                  <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Adjustments & Bonuses</h2>
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
                              {adj.type === 'DEDUCTION' || adj.type === 'CLAWBACK' ? '-' : '+'}₦{Number(adj.amount).toLocaleString()}
                            </td>
                            <td className="table-cell text-sm text-surface-700 dark:text-surface-200 max-w-[200px] truncate">{adj.reason || '—'}</td>
                            <td className="table-cell">
                              <span className={adj.status === 'APPROVED' ? 'badge-success' : adj.status === 'PENDING' ? 'badge-warning' : 'badge'}>{adj.status}</span>
                            </td>
                            <td className="table-cell text-sm text-surface-600 dark:text-surface-200">
                              {new Date(adj.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="px-4 py-12 text-center text-surface-500">No adjustments found</div>
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
              <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                <h2 className="text-sm font-semibold text-surface-900 dark:text-white">
                  Stock Activity
                  <span className="text-surface-500 dark:text-surface-200 font-normal ml-2">({data.total})</span>
                </h2>
                <p className="text-xs text-surface-500 dark:text-surface-600 mt-0.5">
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
                          <td className="table-cell text-xs text-surface-600 dark:text-surface-200">
                            {m.fromLocationId ? m.fromLocationId.slice(0, 8) : '—'}
                            {' → '}
                            {m.toLocationId ? m.toLocationId.slice(0, 8) : '—'}
                          </td>
                          <td className="table-cell text-sm text-surface-700 dark:text-surface-300 max-w-[200px] truncate">{m.reason ?? '—'}</td>
                          <td className="table-cell text-sm text-surface-600 dark:text-surface-200">
                            {new Date(m.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-12 text-center text-surface-500">No stock movements found</div>
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
              <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                <h2 className="text-sm font-semibold text-surface-900 dark:text-white">
                  Approvals Processed
                  <span className="text-surface-500 dark:text-surface-200 font-normal ml-2">({data.total})</span>
                </h2>
                <p className="text-xs text-surface-500 dark:text-surface-600 mt-0.5">
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
                          <td className="table-cell text-right text-sm font-medium">₦{Number(a.amount).toLocaleString()}</td>
                          <td className="table-cell text-sm text-surface-700 dark:text-surface-300 max-w-[200px] truncate">{a.description}</td>
                          <td className="table-cell">
                            <span className={a.status === 'APPROVED' ? 'badge-success' : a.status === 'REJECTED' ? 'badge-danger' : 'badge'}>{a.status}</span>
                          </td>
                          <td className="table-cell text-sm text-surface-600 dark:text-surface-200">
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
                <div className="px-4 py-12 text-center text-surface-500">No approvals processed yet</div>
              )}
            </div>
          )}
        </DeferredSection>
      )}

      {/* ─── Activity / Audit Tab ────────────────────────── */}
      {activeTab === 'audit' && (
        <DeferredSection resolve={auditLog} skeleton="stat">
          {(entries) => (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Activity</h3>
                <span className="text-xs text-surface-500 dark:text-surface-600">{entries.length} entries</span>
              </div>
              {entries.length > 0 ? (
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <div key={entry.id} className="flex items-start gap-2 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-1.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-surface-900 dark:text-surface-200 truncate">
                          {formatActivityDescription(entry)}
                        </p>
                        <p className="text-surface-500 dark:text-surface-600 text-[11px] mt-0.5">
                          {new Date(entry.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-surface-500">No activity recorded yet</p>
              )}
            </div>
          )}
        </DeferredSection>
      )}

      {/* ─── Settings / Edit Tab ─────────────────────────── */}
      {activeTab === 'edit' && (
        <Form method="post" className="space-y-6">
          <input type="hidden" name="intent" value="update" />
          {showOrderStatuses && (
            <input type="hidden" name="visibleOrderStatuses" value={JSON.stringify(selectedStatuses)} />
          )}
          {showProductAssignment && selectedProductIds.length > 0 && (
            <input type="hidden" name="productIds" value={JSON.stringify(selectedProductIds)} />
          )}

          {/* Account Details */}
          <div className="card space-y-4">
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">Account Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label htmlFor="role" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Role</label>
                <select id="role" name="role" className="input" value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
                  {ROLES.map((role) => (
                    <option key={role.value} value={role.value}>{role.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Full Name</label>
                <input id="name" name="name" type="text" defaultValue={user.name} className="input" />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Email Address</label>
                <input id="email" name="email" type="email" defaultValue={user.email} className="input" />
                <p className="text-xs text-warning-600 dark:text-warning-400 mt-1">Email changes require SuperAdmin approval before taking effect.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Status</label>
                <div className="flex items-center gap-4 mt-2">
                  {(['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const).map((s) => (
                    <label key={s} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="status" value={s} defaultChecked={user.status === s} className="text-brand-500 focus:ring-brand-500" />
                      <span className="text-sm text-surface-700 dark:text-surface-300">{s.charAt(0) + s.slice(1).toLowerCase()}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Phone</label>
                <input id="phone" name="phone" type="tel" defaultValue="" placeholder="Enter new phone (current is masked)" className="input" />
                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">Current: {user.phone ?? 'Not set'}. Leave blank to keep unchanged.</p>
              </div>
            </div>
          </div>

          {/* Role Settings */}
          {(showCapacity || showOrderStatuses || showLogisticsLocation || showProductAssignment) && (
            <div className="card space-y-4">
              <h2 className="text-base font-semibold text-surface-900 dark:text-white">Role Settings</h2>

              {showCapacity && (
                <div>
                  <label htmlFor="capacity" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Order Capacity</label>
                  <input id="capacity" name="capacity" type="number" min={1} max={100} defaultValue={user.capacity} className="input w-full sm:w-32" />
                </div>
              )}

              {showOrderStatuses && (
                <div>
                  <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Active Tabs</label>
                  <div className="flex flex-wrap gap-2">
                    {ORDER_STATUSES.map((status) => {
                      const isActive = selectedStatuses.includes(status.value);
                      return (
                        <button key={status.value} type="button" onClick={() => toggleStatus(status.value)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150 ${isActive ? `${status.color} text-white shadow-sm` : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300'}`}>
                          {status.label}
                          {isActive && (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {showLogisticsLocation && (
                <DeferredSection resolve={locations} skeleton="inline">
                  {(locs) => (
                    <div>
                      <label htmlFor="logisticsLocationId" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Logistics Location</label>
                      <select id="logisticsLocationId" name="logisticsLocationId" className="input" defaultValue={user.logisticsLocationId ?? ''}>
                        <option value="">Select location</option>
                        {locs.map((loc: UserCreateLocation) => (
                          <option key={loc.id} value={loc.id}>{loc.name} — {loc.address}</option>
                        ))}
                      </select>
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
                      <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Assign Products</label>
                      <p className="text-xs text-surface-700 dark:text-surface-300 mb-2">Leave blank to assign all products.</p>
                      {prods.length > 0 ? (
                        <div className="border border-surface-200 dark:border-surface-700 rounded-lg max-h-48 overflow-y-auto">
                          {prods.map((product: UserCreateProduct) => (
                            <label key={product.id} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer border-b border-surface-100 dark:border-surface-800 last:border-b-0">
                              <input type="checkbox" checked={selectedProductIds.includes(product.id)} onChange={() => toggleProduct(product.id)} className="rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500" />
                              <span className="text-sm text-surface-900 dark:text-surface-100">{product.name}</span>
                              <span className="text-xs text-surface-700 dark:text-surface-300 ml-auto">{product.category ?? ''}</span>
                            </label>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-surface-700">No products found.</p>
                      )}
                      {selectedProductIds.length > 0 && (
                        <div className="mt-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" name="restrictProductAccess" value="true" defaultChecked={user.restrictProductAccess} className="rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500" />
                            <span className="text-sm text-surface-700 dark:text-surface-300">Restrict access to only assigned products</span>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Reset Password</h3>
            <p className="text-sm text-surface-700 dark:text-surface-200">
              Set a new password for <strong>{user.name}</strong>. This will log them out of all sessions.
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="resetPassword" />
              <div className="space-y-4">
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">New Password</label>
                  <input id="newPassword" name="newPassword" type="password" required minLength={8} className="input" placeholder="Minimum 8 characters" />
                </div>
                <div className="flex items-center justify-end gap-3">
                  <Button type="button" variant="secondary" onClick={() => setShowResetPassword(false)}>Cancel</Button>
                  <Button type="submit" variant="primary" loading={isResetting} loadingText="Resetting...">
                    Reset Password
                  </Button>
                </div>
              </div>
            </Form>
          </div>
        </div>
      )}

      {/* ─── Email Change Approval Modal ─────────────────── */}
      {showEmailChangeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
              {showEmailChangeModal.action === 'APPROVED' ? 'Approve' : 'Reject'} Email Change
            </h3>
            <p className="text-sm text-surface-700 dark:text-surface-200">
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
                  <label htmlFor="emailChangeReason" className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">Reason (min 10 characters)</label>
                  <textarea
                    id="emailChangeReason"
                    name="reason"
                    required
                    minLength={10}
                    value={emailChangeReason}
                    onChange={(e) => setEmailChangeReason(e.target.value)}
                    className="input min-h-[80px]"
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
          </div>
        </div>
      )}

      {/* ─── Deactivate Confirmation Modal ───────────────── */}
      {showDeactivateConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md space-y-4">
            <h3 className="text-lg font-semibold text-danger-600 dark:text-danger-400">Deactivate User</h3>
            <p className="text-sm text-surface-700 dark:text-surface-200">
              Are you sure you want to deactivate <strong>{user.name}</strong>? This will immediately
              terminate all their active sessions and prevent them from logging in.
            </p>
            {actionData?.error && (
              <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-3 py-2">
                <p className="text-sm text-danger-700 dark:text-danger-500">{actionData.error}</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setShowDeactivateConfirm(false)} disabled={isDeactivating}>Cancel</Button>
              <Form method="post">
                <input type="hidden" name="intent" value="deactivate" />
                <Button type="submit" variant="danger" loading={isDeactivating} loadingText="Deactivating...">
                  Deactivate
                </Button>
              </Form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function InfoField({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {icon && <div className="mt-0.5 text-surface-400 dark:text-surface-600 flex-shrink-0">{icon}</div>}
      <div>
        <p className="text-[11px] font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">{label}</p>
        <p className="text-sm text-surface-900 dark:text-surface-100 mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'warning' | 'danger' }) {
  const color = accent === 'success' ? 'text-success-600 dark:text-success-400'
    : accent === 'warning' ? 'text-warning-600 dark:text-warning-400'
    : accent === 'danger' ? 'text-danger-600 dark:text-danger-400'
    : 'text-surface-900 dark:text-white';

  return (
    <div className="p-3 rounded-lg bg-surface-50 dark:bg-surface-800/50">
      <p className="text-[11px] font-medium text-surface-500 dark:text-surface-300 uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'ACTIVE' ? 'bg-success-500' : status === 'INACTIVE' ? 'bg-danger-500' : 'bg-warning-500';
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
