import {
  useState,
  useEffect,
  useLayoutEffect,
  useMemo,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { Form, Link, useActionData, useFetcher, useNavigation } from '@remix-run/react';
import { BranchScopedLink } from '~/components/ui/branch-scoped-link';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { InlineNotification } from '~/components/ui/inline-notification';
import { PageNotification } from '~/components/ui/page-notification';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';
import { Pagination } from '~/components/ui/pagination';
import {
  ModalFetcherInlineError,
  useFetcherActionSurface,
} from '~/hooks/use-fetcher-action-surface';
import { humanizeZodIssuesString } from '~/lib/api-error';
import { formatNaira } from '~/lib/format-amount';
import { formatOrderTimestamp } from '~/lib/format-date';
import type {
  UserDetail,
  UserDetailPageProps,
  UserCreateProduct,
  UserCreateLocation,
  UserCreateCommissionPlan,
  UserPayoutRecord,
  UserAdjustment,
  UserAuditEntry,
  UserMarketingMetrics,
  PendingEmailChange,
  UserApprovalRecord,
  UserPushStatus,
  RoleTemplateOption,
  PermissionCatalogItem,
  PermissionCatalogBundle,
  UserOnboardingSummary,
  StaffPayoutEstimate,
  UserPaidPayoutSnapshot,
} from './types';
import { USER_STATUS_COLORS, formatRole } from './types';
import { RoleBadge } from '~/components/ui/role-badge';
import { ProbationBadge } from '~/components/ui/probation-badge';
import { SupervisorBadge } from '~/components/ui/supervisor-badge';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
const PermissionsPreview = lazy(() =>
  import('./PermissionsPreview').then((m) => ({ default: m.PermissionsPreview })),
);
const UserDetailActivityTabContent = lazy(() =>
  import('./user-detail-lazy-panels').then((m) => ({ default: m.UserDetailActivityTabContent })),
);
const UserDetailEarningsOutlookCard = lazy(() =>
  import('./user-detail-lazy-panels').then((m) => ({ default: m.UserDetailEarningsOutlookCard })),
);
import { useFetcherToast } from '~/components/ui/toast';
import { StatusBadge } from '~/components/ui/status-badge';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { Spinner } from '~/components/ui/spinner';
import { DescriptionList, type DescriptionItem } from '~/components/ui/description-list';

// ─── Constants ──────────────────────────────────────────

const ROLE_DESCRIPTIONS: Record<string, string> = {
  SUPER_ADMIN: 'Full system access. Can manage all modules, users, and settings.',
  HEAD_OF_MARKETING: 'Oversees all marketing campaigns, funding, and media buyer performance.',
  MEDIA_BUYER: 'Runs ad campaigns, manages ad spend, and tracks CPA/ROAS.',
  HEAD_OF_CS: 'Manages Sales team performance, order processing, and agent workloads.',
  CS_CLOSER: 'Handles customer calls, confirms orders, and processes cancellations.',
  FINANCE_OFFICER: 'Manages invoices, approvals, budgets, and financial reporting.',
  HEAD_OF_LOGISTICS:
    'Oversees logistics operations, logistics companies, 3PL partners, and transfers.',
  STOCK_MANAGER: 'Manages inventory, stock movements, and procurement.',
  TPL_MANAGER: 'Manages a third-party logistics location and its riders.',
  TPL_RIDER: 'Handles last-mile deliveries and order fulfillment.',
  HR_MANAGER: 'Manages payroll, commission plans, payouts, and staff records.',
};

// ─── Component ──────────────────────────────────────────

function formatOnboardingTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Matches labels on `StaffOnboardingPage` / HR onboarding workflow. */
function formatStaffOnboardingStatusLabel(status: string): string {
  switch (status) {
    case 'NOT_STARTED':
      return 'Not started';
    case 'IN_PROGRESS':
      return 'In progress';
    case 'SUBMITTED':
      return 'Pending HR review';
    case 'APPROVED':
      return 'Approved';
    default:
      return status.replace(/_/g, ' ');
  }
}

export function UserDetailPage({
  user,
  roleTemplates,
  locations,
  plans,
  payouts,
  adjustments,
  auditLog,
  pendingEmailChange,
  financeActivity,
  pushStatus,
  permissionCatalog,
  templatePermissionsById,
  userStampPreview,
  isSuperAdmin = false,
  canReactivateDeactivatedStaff = false,
  isViewerHeadOfMarketing = false,
  isViewerHeadOfCS = false,
  canEditLimited = false,
  viewerShowsMirror = false,
  mirrorSubmitDisabled = false,
  isSelfView = false,
  showOnboardingTab = false,
  viewerCanManageHrOnboarding = false,
  overviewOnboardingSlice = null,
  overviewPermissionsSlice = null,
  usersBasePath = '/hr/users',
}: UserDetailPageProps) {
  const actionData = useActionData<{
    error?: string;
    success?: boolean;
    message?: string;
    requiresApproval?: boolean;
  }>();
  const navigation = useNavigation();
  // Reset Password runs through its own fetcher so the form submission inside the portaled
  // modal stays isolated from the page-level <Form>s — those compete for navigation state and
  // were the source of the crash when the modal-portal Form's actionData reached an unmounted tree.
  const resetFetcher = useFetcher<{ error?: string; success?: boolean; message?: string }>();
  const resetSurface = useFetcherActionSurface(resetFetcher);
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
  const canOpenSettingsTab = isSuperAdmin || !restrictHeadView || canEditLimited;

  type ModalId =
    | 'marketing'
    | 'funding'
    | 'permissions'
    | 'payroll'
    | 'earnings'
    | 'finance'
    | 'activity';
  const [openModal, setOpenModal] = useState<ModalId | null>(null);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [showReactivateConfirm, setShowReactivateConfirm] = useState(false);
  const [mobileProfileSheetOpen, setMobileProfileSheetOpen] = useState(false);
  const [showEmailChangeModal, setShowEmailChangeModal] = useState<{
    requestId: string;
    action: 'APPROVED' | 'REJECTED';
  } | null>(null);
  const [emailChangeReason, setEmailChangeReason] = useState('');
  const [dismissedError, setDismissedError] = useState(false);
  const [dismissedSuccess, setDismissedSuccess] = useState(false);

  useFetcherToast(resetFetcher.data, {
    successMessage: 'Password updated',
    skipErrorToast: Boolean(showResetPassword && resetSurface.errorMatchingIntent('resetPassword')),
  });
  // Settings/edit moved to /hr/users/:id/edit — the edit form's local state
  // (conflictModalOpen, showSaveConfirm, editFormRef, allowSaveSubmitRef, resolvedActiveHeads,
  // resolvedBranches) was deleted with it. The Permissions preview card still needs the
  // role-template + catalog promises so we keep those resolutions below.
  const [resolvedRoleTemplates, setResolvedRoleTemplates] = useState<RoleTemplateOption[] | null>(
    null,
  );
  const [resolvedPermissionCatalog, setResolvedPermissionCatalog] = useState<
    PermissionCatalogItem[]
  >([]);
  const [resolvedTemplatePermissionsById, setResolvedTemplatePermissionsById] = useState<
    Record<string, string[]>
  >({});
  useEffect(() => {
    if (actionData?.error) setDismissedError(false);
    if (actionData?.success && actionData?.message) setDismissedSuccess(false);
  }, [actionData?.error, actionData?.success, actionData?.message]);

  // Derived flags (must be before useEffects that reference them)
  const isSuperAdminProfile = user.role === 'SUPER_ADMIN';

  // Close reset modal on fetcher success.
  useEffect(() => {
    if (resetFetcher.state === 'idle' && resetFetcher.data?.success) {
      setShowResetPassword(false);
    }
  }, [resetFetcher.state, resetFetcher.data?.success]);

  // Close email change modal on success
  useEffect(() => {
    if (
      actionData?.success &&
      (actionData?.message?.includes('Email updated') ||
        actionData?.message?.includes('Email change rejected'))
    ) {
      setShowEmailChangeModal(null);
      setEmailChangeReason('');
    }
  }, [actionData?.success, actionData?.message]);

  useEffect(() => {
    if (actionData?.success && actionData.message?.toLowerCase().includes('reactivat')) {
      setShowReactivateConfirm(false);
    }
  }, [actionData?.success, actionData?.message]);

  // Role-based tab visibility. Stock-domain activity (intakes, transfers,
  // adjustments) is covered by the global Activity tab below — no separate
  // Stock tab needed.
  const showOrdersTab = [
    'MEDIA_BUYER',
    'HEAD_OF_MARKETING',
    'HEAD_OF_CS',
    'CS_CLOSER',
    'HEAD_OF_LOGISTICS',
    'TPL_MANAGER',
    'TPL_RIDER',
  ].includes(user.role);
  const showPayrollTab = [
    'MEDIA_BUYER',
    'HEAD_OF_MARKETING',
    'HEAD_OF_CS',
    'CS_CLOSER',
    'TPL_RIDER',
    'HR_MANAGER',
  ].includes(user.role);
  // Finance activity tab is visible to the primary Finance Officer role.
  const showFinanceTab = user.role === 'FINANCE_OFFICER';
  const showEarningsTab = showPayrollTab;
  const isMarketingRole = ['MEDIA_BUYER', 'HEAD_OF_MARKETING'].includes(user.role);

  // Tab navigation. The body below switches on `activeTab`. An in-flight refactor moved
  // some panels to a separate `openModal` model — these state hooks restore the references
  // the typecheck needs while that migration is finished elsewhere.
  type TabId = 'overview' | 'orders' | 'payroll' | 'earnings' | 'finance' | 'audit';
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const tabs = useMemo(() => {
    const items: Array<{ id: TabId; label: string }> = [{ id: 'overview', label: 'Overview' }];
    if (showOrdersTab) items.push({ id: 'orders', label: 'Orders' });
    if (showPayrollTab) items.push({ id: 'payroll', label: 'Payroll' });
    if (showEarningsTab) items.push({ id: 'earnings', label: 'Earnings outlook' });
    if (showFinanceTab) items.push({ id: 'finance', label: 'Finance Activity' });
    items.push({ id: 'audit', label: 'Activity' });
    return items;
  }, [showOrdersTab, showPayrollTab, showEarningsTab, showFinanceTab]);

  // Permissions preview state — read-only chip rendering on the Permissions modal.
  // The editable form moved to /hr/users/:id/edit; only the preview state lives here now.
  /** Overview preview: sparse stamped deltas off-template / revokes on-template. */
  const [permissionOverridesLoaded, setPermissionOverridesLoaded] = useState<
    Record<string, boolean>
  >({});
  /** Role-template baseline codes for Overview (`getUserMatrix` stamp_preview). */
  const [stampPreviewTemplateCodes, setStampPreviewTemplateCodes] = useState<string[]>([]);
  /** RBAC union (template ∪ role_permissions ∪ stamped grants − revokes) — drives granted chips. */
  const [stampPreviewEffectiveCodes, setStampPreviewEffectiveCodes] = useState<string[]>([]);
  /** False until stamp preview payload resolves. */
  const [stampPreviewHydrated, setStampPreviewHydrated] = useState(false);
  /** False until `permissions.listCatalog` settles (labels for chips — empty array still counts as resolved). */
  const [permissionCatalogHydrated, setPermissionCatalogHydrated] = useState(false);
  /** True when SSR catalog fetch failed (401/503/etc.) — distinct from an legitimately empty catalog. */
  const [permissionCatalogRequestFailed, setPermissionCatalogRequestFailed] = useState(false);

  const coreFetcher = useFetcher<{
    ok: boolean;
    products: UserCreateProduct[];
    roleTemplates: RoleTemplateOption[];
    locations: UserCreateLocation[];
    plans: UserCreateCommissionPlan[];
    pendingEmailChange: PendingEmailChange | null;
    pushStatus: UserPushStatus | null;
    error?: string;
  }>();
  const onboardingFetcher = useFetcher<
    { ok: true; onboardingSummary: UserOnboardingSummary | null } | { ok: false; error?: string }
  >();
  const permissionsFetcher = useFetcher<
    | {
        ok: true;
        permissionCatalog: PermissionCatalogBundle;
        templatePermissionsById: Record<string, string[]>;
        userStampPreview: {
          userOverrides: Record<string, boolean>;
          templateCodes: string[];
          effectiveCodes: string[];
        };
      }
    | { ok: false; error?: string }
  >();
  const marketingFetcher = useFetcher<
    | {
        ok: true;
        marketingMetrics: UserMarketingMetrics | null;
        fundingBalance: {
          totalReceived: string;
          totalDistributed: string;
          totalSpend: string;
          balance: string;
        } | null;
      }
    | { ok: false; error?: string }
  >();
  const activityFetcher = useFetcher<{
    ok: boolean;
    payouts: UserPayoutRecord[];
    adjustments: UserAdjustment[];
    auditLog: UserAuditEntry[];
    financeActivity: { approvals: UserApprovalRecord[]; total: number } | null;
    error?: string;
  }>();
  const earningsFetcher = useFetcher<{
    ok: boolean;
    error?: string;
    currentMonth?: {
      periodLabel: string;
      periodStart: string;
      periodEnd: string;
      preview: StaffPayoutEstimate | null;
    };
    nextMonth?: {
      periodLabel: string;
      periodStart: string;
      periodEnd: string;
      preview: StaffPayoutEstimate | null;
    };
    lastPaidPayout?: UserPaidPayoutSnapshot | null;
    generatedAt?: string;
  }>();

  useEffect(() => {
    void coreFetcher.load(`/api/hr-user-detail-overview-core/${user.id}`);
  }, [user.id]);

  useEffect(() => {
    if (!showOnboardingTab) return;
    if (overviewOnboardingSlice) return;
    void onboardingFetcher.load(`/api/hr-user-detail-onboarding/${user.id}`);
  }, [showOnboardingTab, user.id, overviewOnboardingSlice]);

  useEffect(() => {
    if (isSuperAdminProfile) return;
    if (overviewPermissionsSlice) return;
    void permissionsFetcher.load(`/api/hr-user-detail-permissions/${user.id}`);
  }, [isSuperAdminProfile, user.id, overviewPermissionsSlice]);

  useEffect(() => {
    if (!isMarketingRole) return;
    void marketingFetcher.load(`/api/hr-user-detail-marketing/${user.id}`);
  }, [isMarketingRole, user.id]);

  useEffect(() => {
    if (openModal !== 'payroll' && openModal !== 'activity' && openModal !== 'finance') return;
    if (activityFetcher.data?.ok) return;
    void activityFetcher.load(`/api/hr-user-detail-activity-bundle/${user.id}`);
  }, [openModal, user.id]);

  useEffect(() => {
    if (!showEarningsTab) return;
    if (openModal !== 'earnings') return;
    void earningsFetcher.load(`/api/hr-user-detail-earnings/${user.id}`);
  }, [openModal, user.id, showEarningsTab]);

  const coreBundle = coreFetcher.data?.ok ? coreFetcher.data : null;
  const activityBundle = activityFetcher.data?.ok ? activityFetcher.data : null;

  const pendingEmailChangeResolved =
    coreBundle?.pendingEmailChange ??
    pendingEmailChange ??
    Promise.resolve(null as PendingEmailChange | null);
  const locationsResolved =
    coreBundle?.locations ?? locations ?? Promise.resolve([] as UserCreateLocation[]);
  const plansResolved =
    coreBundle?.plans ?? plans ?? Promise.resolve([] as UserCreateCommissionPlan[]);
  const payoutsResolved =
    activityBundle?.payouts ?? payouts ?? Promise.resolve([] as UserPayoutRecord[]);
  const adjustmentsResolved =
    activityBundle?.adjustments ?? adjustments ?? Promise.resolve([] as UserAdjustment[]);
  const auditLogResolved =
    activityBundle?.auditLog ?? auditLog ?? Promise.resolve([] as UserAuditEntry[]);
  const pushStatusResolved =
    coreBundle?.pushStatus ?? pushStatus ?? Promise.resolve(null as UserPushStatus | null);

  const financeActivityForDeferred: Promise<{ approvals: UserApprovalRecord[]; total: number }> =
    activityBundle?.financeActivity != null
      ? Promise.resolve(activityBundle.financeActivity)
      : financeActivity != null
        ? financeActivity
        : Promise.resolve({ approvals: [] as UserApprovalRecord[], total: 0 });

  useEffect(() => {
    if (coreBundle?.roleTemplates) {
      setResolvedRoleTemplates(coreBundle.roleTemplates);
    }
  }, [coreBundle]);

  useLayoutEffect(() => {
    if (!overviewPermissionsSlice) return;
    const p = overviewPermissionsSlice;
    setResolvedTemplatePermissionsById(p.templatePermissionsById);
    setResolvedPermissionCatalog(p.permissionCatalog.items);
    setPermissionCatalogRequestFailed(p.permissionCatalog.requestFailed);
    setPermissionCatalogHydrated(true);
    setPermissionOverridesLoaded(p.userStampPreview.userOverrides);
    setStampPreviewTemplateCodes(p.userStampPreview.templateCodes);
    setStampPreviewEffectiveCodes(p.userStampPreview.effectiveCodes ?? []);
    setStampPreviewHydrated(true);
  }, [overviewPermissionsSlice]);

  useEffect(() => {
    let cancelled = false;
    if (overviewPermissionsSlice) return;
    setStampPreviewHydrated(false);
    setStampPreviewTemplateCodes([]);
    setStampPreviewEffectiveCodes([]);
    setPermissionCatalogHydrated(false);
    setPermissionCatalogRequestFailed(false);
    if (permissionsFetcher.data && permissionsFetcher.data.ok === true) {
      const p = permissionsFetcher.data;
      setResolvedTemplatePermissionsById(p.templatePermissionsById);
      setResolvedPermissionCatalog(p.permissionCatalog.items);
      setPermissionCatalogRequestFailed(p.permissionCatalog.requestFailed);
      setPermissionCatalogHydrated(true);
      setPermissionOverridesLoaded(p.userStampPreview.userOverrides);
      setStampPreviewTemplateCodes(p.userStampPreview.templateCodes);
      setStampPreviewEffectiveCodes(p.userStampPreview.effectiveCodes ?? []);
      setStampPreviewHydrated(true);
      return () => {
        cancelled = true;
      };
    }
    if (roleTemplates) {
      roleTemplates
        .then((rows) => {
          if (!cancelled) setResolvedRoleTemplates(rows);
        })
        .catch(() => {
          if (!cancelled) setResolvedRoleTemplates([]);
        });
    }
    if (permissionCatalog) {
      permissionCatalog
        .then((bundle) => {
          if (!cancelled) {
            setResolvedPermissionCatalog(bundle.items);
            setPermissionCatalogRequestFailed(bundle.requestFailed);
            setPermissionCatalogHydrated(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResolvedPermissionCatalog([]);
            setPermissionCatalogRequestFailed(true);
            setPermissionCatalogHydrated(true);
          }
        });
    } else {
      setPermissionCatalogHydrated(true);
    }
    if (templatePermissionsById) {
      templatePermissionsById
        .then((rows) => {
          if (!cancelled) setResolvedTemplatePermissionsById(rows);
        })
        .catch(() => {
          if (!cancelled) setResolvedTemplatePermissionsById({});
        });
    }
    if (userStampPreview) {
      userStampPreview
        .then((row) => {
          if (!cancelled) {
            setPermissionOverridesLoaded(row.userOverrides);
            setStampPreviewTemplateCodes(row.templateCodes);
            setStampPreviewEffectiveCodes(row.effectiveCodes ?? []);
            setStampPreviewHydrated(true);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setPermissionOverridesLoaded({});
            setStampPreviewTemplateCodes([]);
            setStampPreviewEffectiveCodes([]);
            setStampPreviewHydrated(true);
          }
        });
    } else {
      setStampPreviewHydrated(true);
    }
    return () => {
      cancelled = true;
    };
  }, [
    overviewPermissionsSlice,
    roleTemplates,
    permissionCatalog,
    templatePermissionsById,
    userStampPreview,
    permissionsFetcher.data,
  ]);

  /** True until stamp preview and permission catalog requests settle (do not key off catalog length — failed loads stay []). */
  const permissionsPreviewLoading =
    !isSuperAdminProfile &&
    !overviewPermissionsSlice &&
    (!stampPreviewHydrated || !permissionCatalogHydrated);

  const onboardingSummaryResolved =
    overviewOnboardingSlice?.onboardingSummary ??
    (onboardingFetcher.data?.ok === true ? onboardingFetcher.data.onboardingSummary : null);

  const onboardingOverviewLoading =
    showOnboardingTab &&
    onboardingSummaryResolved == null &&
    !overviewOnboardingSlice &&
    (onboardingFetcher.state === 'loading' ||
      (onboardingFetcher.state === 'idle' && onboardingFetcher.data == null));

  // Detail-page-only role flags — used for tab visibility and the right-rail cards.
  const isCSRole = ['CS_CLOSER', 'HEAD_OF_CS'].includes(user.role);
  // Capacity is only a meaningful number for Sales closers + Media Buyers.
  // Drives the read-only badge / InfoField in the Overview, independent of CS-vs-MB role logic elsewhere.
  const showCapacityReadonly = ['CS_CLOSER', 'MEDIA_BUYER'].includes(user.role);
  const isLogisticsRole = [
    'TPL_MANAGER',
    'TPL_RIDER',
    'HEAD_OF_LOGISTICS',
    'STOCK_MANAGER',
  ].includes(user.role);

  const payoutColumns = useMemo(
    (): CompactTableColumn<UserPayoutRecord>[] => [
      {
        key: 'period',
        header: 'Period',
        render: (p) => (
          <span className="text-sm">
            {new Date(p.periodStart).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
            })}
            {' — '}
            {new Date(p.periodEnd).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        ),
      },
      {
        key: 'gross',
        header: 'Gross',
        align: 'right',
        render: (p) => (
          <span className="text-right text-sm text-app-fg">
            {formatNaira(Number(p.grossAmount))}
          </span>
        ),
      },
      {
        key: 'deductions',
        header: 'Deductions',
        align: 'right',
        render: (p) => (
          <span className="text-right text-sm text-danger-600 dark:text-danger-400">
            {Number(p.deductions) > 0 ? formatNaira(-Number(p.deductions)) : '—'}
          </span>
        ),
      },
      {
        key: 'net',
        header: 'Net',
        align: 'right',
        render: (p) => (
          <span className="text-right text-sm font-semibold text-app-fg">
            {formatNaira(Number(p.netAmount))}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (p) => (
          <span
            className={
              p.status === 'PAID'
                ? 'badge-success'
                : p.status === 'PENDING'
                  ? 'badge-warning'
                  : 'badge'
            }
          >
            {p.status}
          </span>
        ),
      },
    ],
    [],
  );

  const adjustmentColumns = useMemo(
    (): CompactTableColumn<UserAdjustment>[] => [
      {
        key: 'type',
        header: 'Type',
        render: (adj) => (
          <span
            className={
              adj.type === 'BONUS' || adj.type === 'ADD_ON' ? 'badge-success' : 'badge-danger'
            }
          >
            {adj.type.replace(/_/g, ' ')}
          </span>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (adj) => (
          <span
            className={`text-right text-sm font-medium ${
              adj.type === 'DEDUCTION' || adj.type === 'CLAWBACK'
                ? 'text-danger-600 dark:text-danger-400'
                : 'text-success-600 dark:text-success-400'
            }`}
          >
            {adj.type === 'DEDUCTION' || adj.type === 'CLAWBACK'
              ? formatNaira(-Math.abs(Number(adj.amount)))
              : `+${formatNaira(Number(adj.amount))}`}
          </span>
        ),
      },
      {
        key: 'reason',
        header: 'Reason',
        render: (adj) => (
          <span
            className="text-sm text-app-fg-muted max-w-[200px] truncate"
            title={adj.reason ?? undefined}
          >
            {adj.reason || '—'}
          </span>
        ),
        cellTitle: (adj) => adj.reason ?? undefined,
      },
      {
        key: 'status',
        header: 'Status',
        render: (adj) => (
          <span
            className={
              adj.status === 'APPROVED'
                ? 'badge-success'
                : adj.status === 'PENDING'
                  ? 'badge-warning'
                  : 'badge'
            }
          >
            {adj.status}
          </span>
        ),
      },
      {
        key: 'date',
        header: 'Date',
        render: (adj) => (
          <span className="text-sm text-app-fg-muted">
            {new Date(adj.createdAt).toLocaleDateString('en-NG', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        ),
      },
    ],
    [],
  );

  const financeApprovalColumns = useMemo(
    (): CompactTableColumn<UserApprovalRecord>[] => [
      {
        key: 'type',
        header: 'Type',
        render: (a) => <span className="badge">{a.type.replace(/_/g, ' ')}</span>,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: (a) => (
          <span className="text-right text-sm font-medium">{formatNaira(Number(a.amount))}</span>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        render: (a) => (
          <span className="text-sm text-app-fg-muted max-w-[200px] truncate" title={a.description}>
            {a.description}
          </span>
        ),
        cellTitle: (a) => a.description,
      },
      {
        key: 'status',
        header: 'Status',
        render: (a) => (
          <span
            className={
              a.status === 'APPROVED'
                ? 'badge-success'
                : a.status === 'REJECTED'
                  ? 'badge-danger'
                  : 'badge'
            }
          >
            {a.status}
          </span>
        ),
      },
      {
        key: 'date',
        header: 'Date',
        render: (a) => (
          <span className="text-sm text-app-fg-muted">
            {a.approvedAt
              ? new Date(a.approvedAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : new Date(a.createdAt).toLocaleDateString('en-NG', {
                  month: 'short',
                  day: 'numeric',
                })}
          </span>
        ),
      },
    ],
    [],
  );

  const profileHeaderTone = 'bg-brand-600 dark:bg-brand-700';
  const profileAvatarTone = 'bg-brand-600 dark:bg-brand-500';
  const profileHeroLabel = isSelfView ? 'My profile' : 'Staff profile';
  const initials = user.name
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
  const memberSince = new Date(user.createdAt);
  const tenure = getTimeSince(memberSince);

  const accountInformationItems = useMemo((): DescriptionItem[] => {
    const items: DescriptionItem[] = [
      {
        label: 'Member Since',
        value: memberSince.toLocaleDateString('en-NG', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      },
      {
        label: 'Last Updated',
        value: new Date(user.updatedAt).toLocaleDateString('en-NG', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      },
    ];

    if (!showOnboardingTab) return items;

    let onboardingValue: ReactNode;
    if (onboardingOverviewLoading) {
      onboardingValue = <span className="text-xs text-app-fg-muted">Loading…</span>;
    } else if (onboardingFetcher.data && onboardingFetcher.data.ok === false) {
      onboardingValue = (
        <span className="text-xs text-danger-600 dark:text-danger-400">Could not load</span>
      );
    } else if (!onboardingSummaryResolved) {
      onboardingValue = '—';
    } else if (onboardingSummaryResolved.ok === false) {
      onboardingValue =
        onboardingSummaryResolved.reason === 'error' ? (
          <span className="text-xs text-danger-600 dark:text-danger-400">Could not load</span>
        ) : (
          '—'
        );
    } else {
      const sum = onboardingSummaryResolved;
      const canOpen = isSelfView || viewerCanManageHrOnboarding;
      const onboardingTo = isSelfView ? '/admin/onboarding' : `/hr/users/${user.id}/onboarding`;
      const onboardingActionLabel = isSelfView
        ? 'opening your onboarding'
        : 'opening staff onboarding';
      onboardingValue = (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:flex-wrap sm:gap-2">
          <StatusBadge
            status={sum.status}
            label={formatStaffOnboardingStatusLabel(sum.status)}
            size="sm"
          />
          {canOpen ? (
            <BranchScopedLink
              to={onboardingTo}
              actionLabel={onboardingActionLabel}
              prefetch="intent"
              className="btn-secondary btn-sm text-xs inline-flex items-center justify-center shrink-0 w-fit"
            >
              {isSelfView ? 'Your onboarding' : 'Open onboarding'}
            </BranchScopedLink>
          ) : null}
        </div>
      );
    }

    items.push({ label: 'Onboarding', value: onboardingValue });

    // Assigned products — visible for Media Buyers (the only role that gets a
    // catalog restriction). Resolves IDs against the products list shipped on
    // the core bundle. If `restrictProductAccess` is off, the user effectively
    // has the whole catalog regardless of `assignedProductIds`.
    if (user.role === 'MEDIA_BUYER') {
      const productsCatalog = coreBundle?.products ?? [];
      const assignedIds = user.assignedProductIds ?? [];
      const productById = new Map(productsCatalog.map((p) => [p.id, p.name]));
      let productsValue: ReactNode;
      if (!user.restrictProductAccess || assignedIds.length === 0) {
        productsValue = (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-mini font-medium bg-app-hover text-app-fg-muted">
            All products
          </span>
        );
      } else if (productsCatalog.length === 0) {
        // Catalog hasn't loaded yet — show count so at least the user knows
        // the field is non-empty while the names hydrate.
        productsValue = (
          <span className="text-xs text-app-fg-muted">
            Loading {assignedIds.length} product{assignedIds.length === 1 ? '' : 's'}…
          </span>
        );
      } else {
        productsValue = (
          <div className="flex flex-wrap gap-1.5">
            {assignedIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-mini font-medium bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300"
                title={productById.get(id) ?? id}
              >
                {productById.get(id) ?? `Unknown (${id.slice(0, 8)}…)`}
              </span>
            ))}
          </div>
        );
      }
      items.push({ label: 'Assigned products', value: productsValue });
    }
    return items;
  }, [
    memberSince,
    user.updatedAt,
    user.id,
    user.role,
    user.restrictProductAccess,
    user.assignedProductIds,
    coreBundle?.products,
    showOnboardingTab,
    onboardingOverviewLoading,
    onboardingSummaryResolved,
    onboardingFetcher.data,
    isSelfView,
    viewerCanManageHrOnboarding,
  ]);

  return (
    <div className="w-full space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        {isSelfView ? (
          <span className="text-app-fg-muted">My Profile</span>
        ) : (
          <Link
            to={usersBasePath}
            prefetch="intent"
            className="text-app-fg-muted hover:text-brand-500 transition-colors"
          >
            Users
          </Link>
        )}
        <svg
          className="w-4 h-4 text-app-border"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-app-fg font-medium truncate">{user.name}</span>
      </div>

      {/* Action feedback */}
      {actionData?.error &&
        !dismissedError &&
        !showDeactivateConfirm &&
        !showReactivateConfirm &&
        !showEmailChangeModal && (
        <PageNotification
          variant="error"
          message={humanizeZodIssuesString(actionData.error)}
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
            <Link
              to="/admin/permission-requests"
              className="text-sm font-medium text-success-600 dark:text-success-400 hover:underline inline-block"
            >
              View pending requests →
            </Link>
          )}
        </div>
      )}

      {/* ─── Profile Header Card ─────────────────────────── */}
      <div className="card p-0 overflow-hidden">
        {/* Profile banner — executive hero with a single identity headline.
            Mobile: action kebab sits top-right of the banner so it's always reachable. */}
        <div className={`relative isolate overflow-hidden ${profileHeaderTone}`}>
          <div className="relative px-4 sm:px-6 pt-5 sm:pt-7 pb-16 sm:pb-20">
            <div className="flex items-start justify-between gap-3">
              <div className="max-w-3xl min-w-0">
                <p className="text-mini font-semibold uppercase tracking-[0.22em] text-white/75">
                  {profileHeroLabel}
                </p>
                <h1 className="mt-2 text-3xl sm:text-4xl font-bold text-white leading-tight break-words">
                  {user.name}
                </h1>
              </div>
              {/* Mobile-only: refresh + action kebab in the banner — primary blue bg for visibility */}
              <div className="md:hidden flex items-center gap-2 shrink-0 mt-1">
                <PageRefreshButton iconOnly />
                <button
                  type="button"
                  onClick={() => setMobileProfileSheetOpen(true)}
                  className="h-9 w-9 shrink-0 rounded-lg bg-brand-600 border border-brand-500 hover:bg-brand-700 flex items-center justify-center text-white"
                  aria-label="Profile actions"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Info */}
        <div className="px-4 sm:px-6 pb-5 -mt-10 sm:-mt-12 relative">
          <div className="rounded-[1.25rem] border border-app-border/80 bg-app-elevated shadow-sm">
            <div className="px-4 sm:px-5 py-4">
              <div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-app-fg break-all sm:break-normal">{user.email}</p>
                      <p className="text-xs text-app-fg-muted mt-1">
                        {ROLE_DESCRIPTIONS[user.role] ?? ''}
                      </p>
                    </div>
                    <div className="flex-shrink-0 hidden md:block">
                      <PageHeaderMobileTools
                        sheetTitle="Profile tools"
                        sheetSubtitle={<span>Refresh and account actions</span>}
                        triggerAriaLabel="Profile toolbar"
                        desktop={
                          <div className="flex flex-wrap items-center gap-2">
                            <PageRefreshButton />
                            {!isSelfView &&
                              viewerShowsMirror &&
                              (mirrorSubmitDisabled ? (
                                <span title="Exit mirror mode to start a new mirror session as this user.">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled
                                    className="opacity-70 cursor-not-allowed"
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <svg
                                        className="w-3.5 h-3.5"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={2}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                                        />
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                        />
                                      </svg>
                                      Mirror user
                                    </span>
                                  </Button>
                                </span>
                              ) : (
                                <Form method="post" data-branch-scoped-action="true" data-mirror-allow="">
                                  <input type="hidden" name="intent" value="mirror" />
                                  <Button
                                    type="submit"
                                    variant="secondary"
                                    size="sm"
                                    className="flex items-center gap-1.5 border-success-300 text-success-700 hover:border-success-400 dark:border-success-700 dark:text-success-400 dark:hover:border-success-600"
                                    loading={isSubmitting && navigation.formData?.get('intent') === 'mirror'}
                                    loadingText="Entering..."
                                  >
                                    <svg
                                      className="w-3.5 h-3.5"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                      />
                                    </svg>
                                    Mirror user
                                  </Button>
                                </Form>
                              ))}
                            {!isSelfView &&
                              !isSuperAdminProfile &&
                              (canOpenSettingsTab || canEditLimited) && (
                                <BranchScopedLink
                                  to={`/hr/users/${user.id}/edit`}
                                  actionLabel="editing this user"
                                  prefetch="intent"
                                  className="btn-primary btn-sm flex items-center gap-1.5"
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                                    />
                                  </svg>
                                  Edit user
                                </BranchScopedLink>
                              )}
                            {!isSelfView && !isSuperAdminProfile && !restrictHeadView && (
                              <>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => setShowResetPassword(true)}
                                  className="flex items-center gap-1.5"
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    strokeWidth={2}
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
                                    />
                                  </svg>
                                  Reset Password
                                </Button>
                                {(user.status === 'ACTIVE' || user.status === 'PENDING') &&
                                  isSuperAdmin && (
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
                                {(user.status === 'INACTIVE' ||
                                  user.status === 'ARCHIVED' ||
                                  (user.status === 'DEACTIVATED' && canReactivateDeactivatedStaff)) && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setShowReactivateConfirm(true)}
                                    className="text-success-600 dark:text-success-400 hover:text-success-700 border-success-200 dark:border-success-700 hover:border-success-300 flex items-center gap-1.5"
                                  >
                                    Reactivate
                                  </Button>
                                )}
                                {user.status === 'DEACTIVATED' && !canReactivateDeactivatedStaff && (
                                  <p className="text-xs text-app-fg-muted italic">
                                    Reactivating deactivated staff requires Super Admin / Admin access or the
                                    users deactivate permission.
                                  </p>
                                )}
                              </>
                            )}
                          </div>
                        }
                        sheet={({ closeSheet }) => (
                          <>
                            {!isSelfView &&
                              viewerShowsMirror &&
                              (mirrorSubmitDisabled ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled
                                  className="w-full justify-center opacity-70 cursor-not-allowed"
                                >
                                  Mirror user
                                </Button>
                              ) : (
                                <Form method="post" data-branch-scoped-action="true" data-mirror-allow="" className="w-full">
                                  <input type="hidden" name="intent" value="mirror" />
                                  <Button
                                    type="submit"
                                    variant="secondary"
                                    size="sm"
                                    className="w-full justify-center border-success-300 text-success-700 hover:border-success-400 dark:border-success-700 dark:text-success-400 dark:hover:border-success-600"
                                    loading={isSubmitting && navigation.formData?.get('intent') === 'mirror'}
                                    loadingText="Entering..."
                                  >
                                    Mirror user
                                  </Button>
                                </Form>
                              ))}
                            {!isSelfView &&
                              !isSuperAdminProfile &&
                              (canOpenSettingsTab || canEditLimited) && (
                                <BranchScopedLink
                                  to={`/hr/users/${user.id}/edit`}
                                  actionLabel="editing this user"
                                  prefetch="intent"
                                  className="btn-primary btn-sm w-full justify-center"
                                  onClick={() => closeSheet()}
                                >
                                  Edit user
                                </BranchScopedLink>
                              )}
                            {!isSelfView && !isSuperAdminProfile && !restrictHeadView && (
                              <>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="w-full justify-center"
                                  onClick={() => {
                                    closeSheet();
                                    setShowResetPassword(true);
                                  }}
                                >
                                  Reset Password
                                </Button>
                                {(user.status === 'ACTIVE' || user.status === 'PENDING') &&
                                  isSuperAdmin && (
                                    <Button
                                      type="button"
                                      variant="danger"
                                      size="sm"
                                      className="w-full justify-center bg-danger-600 hover:bg-danger-700 text-white border-danger-600 hover:border-danger-700 dark:bg-danger-600 dark:hover:bg-danger-700 dark:border-danger-600 dark:hover:border-danger-700"
                                      onClick={() => {
                                        closeSheet();
                                        setShowDeactivateConfirm(true);
                                      }}
                                    >
                                      Deactivate
                                    </Button>
                                  )}
                                {(user.status === 'INACTIVE' ||
                                  user.status === 'ARCHIVED' ||
                                  (user.status === 'DEACTIVATED' && canReactivateDeactivatedStaff)) && (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    className="w-full justify-center text-success-600 dark:text-success-400 hover:text-success-700 border-success-200 dark:border-success-700 hover:border-success-300"
                                    onClick={() => {
                                      closeSheet();
                                      setShowReactivateConfirm(true);
                                    }}
                                  >
                                    Reactivate
                                  </Button>
                                )}
                                {user.status === 'DEACTIVATED' && !canReactivateDeactivatedStaff && (
                                  <p className="text-xs text-app-fg-muted italic w-full">
                                    Reactivating deactivated staff requires Super Admin / Admin access or the
                                    users deactivate permission.
                                  </p>
                                )}
                              </>
                            )}
                          </>
                        )}
                      />
                    </div>
                  </div>

                  <div className="mt-4 pt-4 border-t border-app-border/70">
                    <div className="flex flex-wrap items-center gap-2">
                      <RoleBadge role={user.role} label={formatRole(user.role)} />
                      {user.isTeamSupervisor && <SupervisorBadge />}
                      {user.isProbation && <ProbationBadge until={user.probationUntil ?? null} />}
                      <span className={USER_STATUS_COLORS[user.status] ?? 'badge'}>{user.status}</span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-app-hover text-app-fg-muted">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        {tenure}
                      </span>
                      {(user.loginCount ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-app-hover text-app-fg-muted"
                          title={
                            user.lastLoginAt
                              ? `Last sign-in ${new Date(user.lastLoginAt).toLocaleString('en-NG')}`
                              : 'Sign-in history'
                          }
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
                            />
                          </svg>
                          {user.loginCount} sign-in{user.loginCount === 1 ? '' : 's'}
                          {user.lastLoginAt && ` · ${getTimeSince(new Date(user.lastLoginAt))}`}
                        </span>
                      )}
                      {user.phone && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-app-hover text-app-fg-muted">
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                            />
                          </svg>
                          {user.phone}
                        </span>
                      )}
                      {showCapacityReadonly && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
                            />
                          </svg>
                          Capacity: {user.capacity}
                        </span>
                      )}
                      <UserBranchBadges branches={user.branchMemberships} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dates + onboarding summary (header has name, email, role, status, phone, tenure pill). */}
      <div className="card space-y-3 !p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-app-fg">Account Information</h2>
          {!isSelfView &&
            !isSuperAdminProfile &&
            (canOpenSettingsTab || canEditLimited) && (
              <BranchScopedLink
                to={`${usersBasePath}/${user.id}/edit`}
                actionLabel="editing this user"
                prefetch="intent"
                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline shrink-0 self-start sm:self-auto"
              >
                Edit
              </BranchScopedLink>
            )}
        </div>
        <DescriptionList
          layout="grid"
          gridColumns={showOnboardingTab ? 3 : 2}
          dense
          items={accountInformationItems}
        />
      </div>

      {/* ─── Section cards — minimal layout (CEO directive 2026-05): each card opens a
          modal that lazy-loads the detail. Replaces the previous tab + inline-cards layout. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {isMarketingRole && (
          <SectionCard
            label="Marketing Performance"
            onClick={() => setOpenModal('marketing')}
          />
        )}
        {isMarketingRole && (
          <SectionCard
            label="Funding balance"
            onClick={() => setOpenModal('funding')}
          />
        )}
        {!isSuperAdminProfile && (
          <SectionCard
            label="Permissions"
            onClick={() => setOpenModal('permissions')}
          />
        )}
        {showPayrollTab && (
          <SectionCard label="Payroll" onClick={() => setOpenModal('payroll')} />
        )}
        {showEarningsTab && (
          <SectionCard
            label="Earnings outlook"
            onClick={() => setOpenModal('earnings')}
          />
        )}
        {showFinanceTab && (
          <SectionCard
            label="Finance Activity"
            onClick={() => setOpenModal('finance')}
          />
        )}
        <SectionCard label="Activity" onClick={() => setOpenModal('activity')} />
      </div>

      {/* ─── Marketing Performance modal ───────────────── */}
      {openModal === 'marketing' && (
        <Modal open onClose={() => setOpenModal(null)} maxWidth="max-w-3xl">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Marketing Performance</h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {marketingFetcher.state === 'loading' ||
            (marketingFetcher.state === 'idle' && marketingFetcher.data == null) ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 animate-pulse">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-app-hover" />
                ))}
              </div>
            ) : marketingFetcher.data?.ok === false ? (
              <p className="text-sm text-app-fg-muted">
                {typeof marketingFetcher.data.error === 'string'
                  ? marketingFetcher.data.error
                  : 'Could not load marketing performance.'}
              </p>
            ) : marketingFetcher.data?.ok && marketingFetcher.data.marketingMetrics ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <MetricCard
                  label="Total Spend"
                  value={formatNaira(Number(marketingFetcher.data.marketingMetrics.totalSpend))}
                />
                <MetricCard
                  label="Total Orders"
                  value={String(marketingFetcher.data.marketingMetrics.totalOrders)}
                />
                <MetricCard
                  label="Delivered"
                  value={String(marketingFetcher.data.marketingMetrics.deliveredOrders)}
                  accent="success"
                />
                <MetricCard
                  label="Confirmed"
                  value={String(marketingFetcher.data.marketingMetrics.confirmedOrders)}
                  accent="success"
                />
                <MetricCard
                  label="Revenue"
                  value={formatNaira(
                    Number(marketingFetcher.data.marketingMetrics.deliveredRevenue),
                  )}
                  accent="success"
                />
                <MetricCard
                  label="Conf. Rate"
                  value={`${Number(marketingFetcher.data.marketingMetrics.confirmationRate).toFixed(1)}%`}
                />
                <MetricCard
                  label="CPA"
                  value={formatNaira(Number(marketingFetcher.data.marketingMetrics.cpa))}
                />
                <MetricCard
                  label="True ROAS"
                  value={`${Number(marketingFetcher.data.marketingMetrics.trueRoas).toFixed(2)}x`}
                  accent={
                    marketingFetcher.data.marketingMetrics.trueRoas >= 2
                      ? 'success'
                      : marketingFetcher.data.marketingMetrics.trueRoas >= 1
                        ? 'warning'
                        : 'danger'
                  }
                />
              </div>
            ) : (
              <p className="text-sm text-app-fg-muted">No marketing data.</p>
            )}
          </div>
        </Modal>
      )}

      {/* ─── Funding balance modal ─────────────────────── */}
      {openModal === 'funding' && (
        <Modal open onClose={() => setOpenModal(null)} maxWidth="max-w-2xl">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Funding balance</h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p className="text-xs text-app-fg-muted">
              Confirmed funding received minus approved ad spend
            </p>
            {marketingFetcher.data?.ok && marketingFetcher.data.fundingBalance ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-app-fg-muted">Total received</p>
                  <p className="text-lg font-medium text-app-fg">
                    {formatNaira(
                      Number(marketingFetcher.data.fundingBalance.totalReceived),
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-app-fg-muted">Total spent</p>
                  <p className="text-lg font-medium text-app-fg">
                    {user.role === 'MEDIA_BUYER'
                      ? formatNaira(
                          Number(marketingFetcher.data.fundingBalance.totalSpend),
                        )
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-app-fg-muted">Balance</p>
                  <p className="text-xl font-bold text-brand-600 dark:text-brand-400">
                    {formatNaira(Number(marketingFetcher.data.fundingBalance.balance))}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-app-fg-muted">No funding data.</p>
            )}
          </div>
        </Modal>
      )}

      {/* ─── Permissions modal ─────────────────────────── */}
      {openModal === 'permissions' && !isSuperAdminProfile && (
        <Modal open onClose={() => setOpenModal(null)} maxWidth="max-w-3xl">
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-app-fg">Permissions</h2>
                <p className="text-xs text-app-fg-muted mt-0.5">
                  {isSelfView
                    ? 'Capabilities from your role template and any changes stamped on your account.'
                    : 'Read-only preview of effective permissions (template baseline plus account overrides).'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {!restrictHeadView && !isSelfView && (
              <div className="flex justify-end">
                <BranchScopedLink
                  to={`/hr/users/${user.id}/edit`}
                  actionLabel="editing user permissions"
                  prefetch="intent"
                  className="text-xs text-brand-500 hover:text-brand-600 font-medium"
                >
                  Edit permissions
                </BranchScopedLink>
              </div>
            )}
            {permissionsPreviewLoading ? (
              <div className="space-y-2 py-2">
                <div className="h-3 w-32 rounded bg-app-hover animate-pulse" />
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-6 w-24 rounded bg-app-hover animate-pulse" />
                  ))}
                </div>
              </div>
            ) : (
              <Suspense
                fallback={<div className="h-16 rounded bg-app-hover animate-pulse" aria-hidden />}
              >
                <PermissionsPreview
                  permissions={resolvedPermissionCatalog}
                  templateCodes={stampPreviewTemplateCodes}
                  overrides={permissionOverridesLoaded}
                  effectiveCodes={stampPreviewEffectiveCodes}
                  catalogRequestFailed={permissionCatalogRequestFailed}
                />
              </Suspense>
            )}
          </div>
        </Modal>
      )}

      {/* ─── Payroll modal ─────────────────────────────── */}
      {openModal === 'payroll' && (
        <Modal open onClose={() => setOpenModal(null)} maxWidth="max-w-4xl">
          <div className="p-4 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Payroll</h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <DeferredSection resolve={payoutsResolved} skeleton="table">
              {(payoutList) => (
                <div className="list-panel">
                  <div className="px-4 py-3 border-b border-app-border">
                    <h3 className="text-sm font-semibold text-app-fg">Payout History</h3>
                  </div>
                  <CompactTable<UserPayoutRecord>
                    caption="Payout history"
                    columns={payoutColumns}
                    rows={payoutList}
                    rowKey={(p) => p.id}
                    withCard={false}
                    className="min-w-[640px]"
                    emptyTitle="No payout records found"
                  />
                </div>
              )}
            </DeferredSection>
            <DeferredSection resolve={adjustmentsResolved} skeleton="table">
              {(adjList) => (
                <div className="list-panel">
                  <div className="px-4 py-3 border-b border-app-border">
                    <h3 className="text-sm font-semibold text-app-fg">Adjustments & Bonuses</h3>
                  </div>
                  <CompactTable<UserAdjustment>
                    caption="Adjustments and bonuses"
                    columns={adjustmentColumns}
                    rows={adjList}
                    rowKey={(adj) => adj.id}
                    withCard={false}
                    className="min-w-[720px]"
                    emptyTitle="No adjustments found"
                  />
                </div>
              )}
            </DeferredSection>
          </div>
        </Modal>
      )}

      {/* ─── Earnings outlook modal ────────────────────── */}
      {openModal === 'earnings' && showEarningsTab && (
        <Modal open onClose={() => setOpenModal(null)} maxWidth="max-w-3xl">
          <div className="p-4 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Earnings outlook</h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="rounded-lg border border-app-border bg-app-hover/40 px-4 py-3 text-xs text-app-fg-muted">
              <p>
                These figures are a <strong className="text-app-fg">running estimate</strong> from
                your attributed orders and commission plan — they update as you deliver. HR still
                finalises amounts in payroll batches; bonuses and adjustments may change the final
                payout.
              </p>
            </div>
            {(() => {
              const ep = earningsFetcher.data;
              const earningsLoading =
                earningsFetcher.state === 'loading' || earningsFetcher.state === 'submitting';
              if (earningsLoading || !ep) {
                return (
                  <div className="card flex justify-center py-16">
                    <Spinner />
                  </div>
                );
              }
              if (!ep.ok) {
                return (
                  <InlineNotification
                    variant="danger"
                    message={`Could not load earnings outlook.\n${ep.error ?? 'Try again in a moment.'}`}
                  />
                );
              }
              return (
                <>
                  <div className="grid gap-6 lg:grid-cols-2">
                    {ep.currentMonth ? (
                      <Suspense fallback={<Spinner className="mx-auto my-8" />}>
                        <UserDetailEarningsOutlookCard
                          heading="This month (so far)"
                          periodLabel={ep.currentMonth.periodLabel}
                          preview={ep.currentMonth.preview}
                        />
                      </Suspense>
                    ) : null}
                    {ep.nextMonth ? (
                      <Suspense fallback={<Spinner className="mx-auto my-8" />}>
                        <UserDetailEarningsOutlookCard
                          heading="Next calendar month (early outlook)"
                          periodLabel={ep.nextMonth.periodLabel}
                          preview={ep.nextMonth.preview}
                        />
                      </Suspense>
                    ) : null}
                  </div>
                  {ep.lastPaidPayout ? (
                    <div className="card p-4 space-y-2">
                      <h3 className="text-sm font-semibold text-app-fg">Last paid payroll</h3>
                      <p className="text-xs text-app-fg-muted">
                        Period{' '}
                        {new Date(ep.lastPaidPayout.periodStart).toLocaleDateString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        —{' '}
                        {new Date(ep.lastPaidPayout.periodEnd).toLocaleDateString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="text-lg font-bold text-app-fg">
                        {formatNaira(Number(ep.lastPaidPayout.totalPayout))}
                      </p>
                      <p className="text-xs text-app-fg-muted">
                        After Finance marks a batch paid, your next cycle starts fresh —
                        open <strong>Payroll</strong> for full history.
                      </p>
                    </div>
                  ) : null}
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* ─── Finance Activity modal ────────────────────── */}
      {openModal === 'finance' && showFinanceTab && (
        <Modal open onClose={() => setOpenModal(null)} maxWidth="max-w-4xl">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Finance Activity</h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <DeferredSection resolve={financeActivityForDeferred} skeleton="table">
              {(data) => (
                <div className="list-panel">
                  <div className="px-4 py-3 border-b border-app-border">
                    <h3 className="text-sm font-semibold text-app-fg">
                      Approvals Processed
                      <span className="text-app-fg-muted font-normal ml-2">({data.total})</span>
                    </h3>
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      Approval requests processed by this Finance Officer
                    </p>
                  </div>
                  <CompactTable<UserApprovalRecord>
                    caption="Approvals processed"
                    columns={financeApprovalColumns}
                    rows={data.approvals}
                    rowKey={(a) => a.id}
                    withCard={false}
                    className="min-w-[720px]"
                    emptyTitle="No approvals processed yet"
                  />
                </div>
              )}
            </DeferredSection>
          </div>
        </Modal>
      )}

      {/* ─── Activity modal ────────────────────────────── */}
      {openModal === 'activity' && (
        <Modal open onClose={() => setOpenModal(null)} maxWidth="max-w-4xl">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Activity</h2>
              <button
                type="button"
                onClick={() => setOpenModal(null)}
                className="text-app-fg-muted hover:text-app-fg text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <DeferredSection resolve={auditLogResolved} skeleton="stat">
              {(entries) => (
                <Suspense fallback={<Spinner className="mx-auto my-8" />}>
                  <UserDetailActivityTabContent entries={entries} />
                </Suspense>
              )}
            </DeferredSection>
          </div>
        </Modal>
      )}

      {/* ─── Mobile Profile Actions Sheet ─────────────────── */}
      {mobileProfileSheetOpen && (
        <Modal open onClose={() => setMobileProfileSheetOpen(false)} maxWidth="max-w-sm" contentClassName="p-4 space-y-2">
          <h3 className="text-base font-semibold text-app-fg mb-2">Profile tools</h3>
          {!isSelfView && viewerShowsMirror && (
            mirrorSubmitDisabled ? (
              <Button type="button" variant="secondary" size="sm" disabled className="w-full justify-center opacity-70 cursor-not-allowed">Mirror user</Button>
            ) : (
              <Form method="post" data-branch-scoped-action="true" data-mirror-allow="" className="w-full">
                <input type="hidden" name="intent" value="mirror" />
                <Button type="submit" variant="secondary" size="sm" className="w-full justify-center border-success-300 text-success-700 hover:border-success-400 dark:border-success-700 dark:text-success-400 dark:hover:border-success-600" loading={isSubmitting && navigation.formData?.get('intent') === 'mirror'} loadingText="Entering...">Mirror user</Button>
              </Form>
            )
          )}
          {!isSelfView && !isSuperAdminProfile && (canOpenSettingsTab || canEditLimited) && (
            <BranchScopedLink to={`/hr/users/${user.id}/edit`} actionLabel="editing this user" prefetch="intent" className="btn-primary btn-sm w-full justify-center" onClick={() => setMobileProfileSheetOpen(false)}>Edit user</BranchScopedLink>
          )}
          {!isSelfView && !isSuperAdminProfile && !restrictHeadView && (
            <>
              <Button type="button" variant="secondary" size="sm" className="w-full justify-center" onClick={() => { setMobileProfileSheetOpen(false); setShowResetPassword(true); }}>Reset Password</Button>
              {(user.status === 'ACTIVE' || user.status === 'PENDING') && isSuperAdmin && (
                <Button type="button" variant="danger" size="sm" className="w-full justify-center bg-danger-600 hover:bg-danger-700 text-white border-danger-600 hover:border-danger-700 dark:bg-danger-600 dark:hover:bg-danger-700 dark:border-danger-600 dark:hover:border-danger-700" onClick={() => { setMobileProfileSheetOpen(false); setShowDeactivateConfirm(true); }}>Deactivate</Button>
              )}
              {(user.status === 'INACTIVE' || user.status === 'ARCHIVED' || (user.status === 'DEACTIVATED' && canReactivateDeactivatedStaff)) && (
                <Button type="button" variant="secondary" size="sm" className="w-full justify-center text-success-600 dark:text-success-400 hover:text-success-700 border-success-200 dark:border-success-700 hover:border-success-300" onClick={() => { setMobileProfileSheetOpen(false); setShowReactivateConfirm(true); }}>Reactivate</Button>
              )}
            </>
          )}
          <Button type="button" variant="secondary" size="sm" className="w-full justify-center mt-2" onClick={() => setMobileProfileSheetOpen(false)}>Close</Button>
        </Modal>
      )}

      {/* ─── Reset Password Modal ────────────────────────── */}
      {showResetPassword && (
        <Modal
          open
          onClose={() => setShowResetPassword(false)}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4"
        >
          <h3 className="text-lg font-semibold text-app-fg">Reset Password</h3>
          <p className="text-sm text-app-fg-muted">
            Set a new password for <strong>{user.name}</strong>. This will log them out of all
            sessions.
          </p>
          <ModalFetcherInlineError message={resetSurface.errorMatchingIntent('resetPassword')} />
          <resetFetcher.Form method="post" action="." data-branch-scoped-action="true">
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
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowResetPassword(false)}
                  disabled={isResetting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={isResetting}
                  loadingText="Resetting..."
                >
                  Reset Password
                </Button>
              </div>
            </div>
          </resetFetcher.Form>
        </Modal>
      )}

      {/* ─── Email Change Approval Modal ─────────────────── */}
      {showEmailChangeModal && (
        <Modal
          open
          onClose={() => {
            setShowEmailChangeModal(null);
            setEmailChangeReason('');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6 space-y-4"
        >
          <h3 className="text-lg font-semibold text-app-fg">
            {showEmailChangeModal.action === 'APPROVED' ? 'Approve' : 'Reject'} Email Change
          </h3>
          <p className="text-sm text-app-fg-muted">
            {showEmailChangeModal.action === 'APPROVED'
              ? "This will update the user's email address. Please provide a reason for the approval."
              : 'This will reject the pending email change. Please provide a reason.'}
          </p>
          {actionData?.error ? (
            <InlineNotification
              variant="danger"
              message={humanizeZodIssuesString(actionData.error)}
            />
          ) : null}
          <Form method="post" data-branch-scoped-action="true">
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
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowEmailChangeModal(null);
                    setEmailChangeReason('');
                  }}
                >
                  Cancel
                </Button>
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
        <Modal
          open
          onClose={() => setShowDeactivateConfirm(false)}
          maxWidth="max-w-lg"
          role="alertdialog"
          aria-labelledby="deactivate-modal-title"
          aria-describedby="deactivate-modal-desc"
          contentClassName="p-6 space-y-5 border-2 border-danger-200 dark:border-danger-800"
        >
          <div className="flex items-center gap-3 pb-2 border-b border-danger-100 dark:border-danger-900/50">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/50 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-danger-600 dark:text-danger-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3
              id="deactivate-modal-title"
              className="text-lg font-semibold text-danger-700 dark:text-danger-300"
            >
              Deactivate user
            </h3>
          </div>
          <p id="deactivate-modal-desc" className="text-sm text-app-fg-muted">
            You are about to deactivate <strong>{user.name}</strong> ({user.email}). They will be signed out
            immediately and cannot sign in until an authorized administrator reactivates the account.
          </p>
          <div className="rounded-lg bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-800 p-4 space-y-2">
            <p className="text-sm font-medium text-danger-800 dark:text-danger-200">
              Risks and consequences:
            </p>
            <ul className="text-sm text-danger-700 dark:text-danger-300 space-y-1.5 list-disc list-inside">
              <li>Their login will be disabled immediately; all sessions will be terminated.</li>
              <li>
                They will disappear from the default user list (only visible when filtering by
                “Deactivated”).
              </li>
              <li>
                Super Admins, Admins, or holders of the deactivate-user permission can restore them to
                Active from this profile when appropriate.
              </li>
              <li>
                Existing audit trail and historical data (orders, payouts, etc.) remain tied to this
                user for compliance.
              </li>
            </ul>
          </div>
          <p className="text-xs text-app-fg-muted">
            Only Super Admins can use the Deactivate button here. To pause access without this flow, set
            status to <strong>Inactive</strong> or <strong>Archived</strong> on the edit form (those can
            also be reactivated from the profile).
          </p>
          {actionData?.error && !dismissedError ? (
            <InlineNotification
              variant="danger"
              message={humanizeZodIssuesString(actionData.error)}
            />
          ) : null}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowDeactivateConfirm(false)}
              disabled={isDeactivating}
            >
              Cancel
            </Button>
            <Form method="post" data-branch-scoped-action="true">
              <input type="hidden" name="intent" value="deactivate" />
              <Button
                type="submit"
                variant="danger"
                loading={isDeactivating}
                loadingText="Deactivating..."
                className="bg-danger-600 hover:bg-danger-700 text-white border-danger-600 hover:border-danger-700"
              >
                Deactivate user
              </Button>
            </Form>
          </div>
        </Modal>
      )}

      {/* ─── Reactivate Confirmation Modal ───────────────── */}
      {showReactivateConfirm && (
        <Modal
          open
          onClose={() => !isReactivating && setShowReactivateConfirm(false)}
          maxWidth="max-w-lg"
          role="alertdialog"
          aria-labelledby="reactivate-modal-title"
          aria-describedby="reactivate-modal-desc"
          contentClassName="p-6 space-y-5 border-2 border-success-200 dark:border-success-800"
        >
          <div className="flex items-center gap-3 pb-2 border-b border-success-100 dark:border-success-900/50">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-success-100 dark:bg-success-900/40 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-success-600 dark:text-success-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h3
              id="reactivate-modal-title"
              className="text-lg font-semibold text-success-800 dark:text-success-200"
            >
              Reactivate {user.name}?
            </h3>
          </div>
          <p id="reactivate-modal-desc" className="text-sm text-app-fg-muted">
            {user.status === 'DEACTIVATED' ? (
              <>
                This account was <strong>deactivated</strong> (sign-in blocked). Reactivating sets status
                to <strong>Active</strong> and allows <strong>{user.email}</strong> to sign in again with their
                existing password (unless it was reset in the meantime).
              </>
            ) : (
              <>
                This account is <strong>{user.status === 'INACTIVE' ? 'inactive' : 'archived'}</strong>.
                Reactivating sets status to <strong>Active</strong> so <strong>{user.email}</strong> can sign
                in again.
              </>
            )}
          </p>
          <ul className="text-sm text-app-fg-muted space-y-1.5 list-disc list-inside rounded-lg bg-app-hover/50 border border-app-border/70 p-4">
            <li>Confirm this is the right person before restoring access.</li>
            <li>Branch memberships and permissions stay as they were before this status change.</li>
          </ul>
          {actionData?.error && !dismissedError ? (
            <InlineNotification
              variant="danger"
              message={humanizeZodIssuesString(actionData.error)}
            />
          ) : null}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowReactivateConfirm(false)}
              disabled={isReactivating}
            >
              Cancel
            </Button>
            <Form method="post" data-branch-scoped-action="true">
              <input type="hidden" name="intent" value="reactivate" />
              <Button
                type="submit"
                variant="success"
                loading={isReactivating}
                loadingText="Reactivating..."
                className="bg-success-600 hover:bg-success-700 text-white border-success-600 hover:border-success-700 dark:bg-success-600 dark:hover:bg-success-700"
              >
                Reactivate account
              </Button>
            </Form>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

/**
 * Grey clickable card for the minimal user-detail layout. Each card opens a
 * modal with the section's lazy-loaded data.
 */
function SectionCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg border border-app-border bg-app-hover px-4 py-3 hover:bg-app-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition-colors"
    >
      <span className="block text-sm font-medium text-app-fg">{label}</span>
      <span className="block text-xs text-app-fg-muted mt-0.5">View details →</span>
    </button>
  );
}

function BlockerRow({
  label,
  count,
  resolveHref,
}: {
  label: string;
  count: number;
  resolveHref?: string;
}) {
  const cleared = count === 0;
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-app-hover/40">
      <span className="flex items-center gap-2 text-app-fg">
        <span className={`w-2 h-2 rounded-full ${cleared ? 'bg-success-500' : 'bg-amber-500'}`} />
        {label}
      </span>
      <span className="flex items-center gap-2 text-xs">
        <span
          className={`font-mono ${cleared ? 'text-success-700 dark:text-success-400' : 'text-amber-700 dark:text-amber-400'}`}
        >
          {count}
        </span>
        {!cleared && resolveHref && (
          <Link to={resolveHref} className="text-brand-600 dark:text-brand-400 hover:underline">
            Resolve →
          </Link>
        )}
      </span>
    </li>
  );
}

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
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-micro font-medium ${style}`}
    >
      {label}
    </span>
  );
}

function InfoField({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      {icon && <div className="mt-0.5 text-app-fg-muted flex-shrink-0">{icon}</div>}
      <div>
        <p className="text-mini font-medium text-app-fg-muted uppercase tracking-wider">
          {label}
        </p>
        <p className="text-sm text-app-fg mt-0.5">{value}</p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'success' | 'warning' | 'danger';
}) {
  const color =
    accent === 'success'
      ? 'text-success-600 dark:text-success-400'
      : accent === 'warning'
        ? 'text-warning-600 dark:text-warning-400'
        : accent === 'danger'
          ? 'text-danger-600 dark:text-danger-400'
          : 'text-app-fg';

  return (
    <div className="p-3 rounded-lg bg-app-hover">
      <p className="text-mini font-medium text-app-fg-muted uppercase tracking-wider">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'ACTIVE'
      ? 'bg-success-500'
      : status === 'PENDING'
        ? 'bg-info-500'
        : status === 'DEACTIVATED'
          ? 'bg-danger-500'
          : status === 'INACTIVE'
            ? 'bg-danger-500'
            : 'bg-warning-500';
  return (
    <div className={`w-4 h-4 rounded-full ${color} flex items-center justify-center`}>
      <div className="w-2 h-2 rounded-full bg-white" />
    </div>
  );
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
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
      />
    </svg>
  );
}
function EnvelopeIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
      />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
      />
    </svg>
  );
}
function PhoneIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
      />
    </svg>
  );
}
function StackIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75 6.43 9.75m11.14 0l4.179 2.25-4.179 2.25m0 0L12 17.25l-5.571-3m11.142 0l4.179 2.25L12 21.75l-9.75-5.25 4.179-2.25"
      />
    </svg>
  );
}
function CalendarIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
      />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/**
 * React list key for global-audit rows mapped into {@link UserAuditEntry}.
 * `id` is the business record id and repeats across temporal `_history` versions; pair with
 * `createdAt` (valid_from) and a stable index in the rendered list.
 */
function auditActivityRowKey(entry: UserAuditEntry, position: number): string {
  return `${entry.tableName}-${entry.id}-${entry.createdAt}-${position}`;
}
