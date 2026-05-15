import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Await, Link, useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { SmartPick } from '~/components/ui/smart-pick';
import { Modal } from '~/components/ui/modal';
import { AssignCloserModal } from '~/components/ui/assign-closer-modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { formatOrderTimestamp } from '~/lib/format-date';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { DeferredError } from '~/components/ui/deferred-section';
import { OrdersChartViewShellSkeleton } from '~/components/ui/deferred-skeletons';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { OrdersChartView } from '~/components/ui/orders-chart-view-lazy';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { Pagination } from '~/components/ui/pagination';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { Textarea } from '~/components/ui/textarea';
import { ExportModal } from '~/components/ui/export-modal';
import { LocalExportModal } from '~/components/ui/local-export-modal';
import { CreateOfflineOrderModal } from '~/features/orders/CreateOfflineOrderModal';
import { useLiveIndicator } from '~/hooks/useSocket';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { useFetcherToast } from '~/components/ui/toast';
import {
  STATUS_OPTIONS,
  STATUS_LABELS,
  STATUS_TEXT_CLASS,
  formatStatus,
} from '~/features/shared/order-status';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { orderDetailHref, type OrderDetailListFrom } from '~/lib/order-detail-return';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { TextInput } from '~/components/ui/text-input';
import { ScheduleHeatCalendar } from '~/components/ui/schedule-heat-calendar';
import type { ScheduleHeatDay } from '~/components/ui/schedule-heat-calendar';

/** Deferred loader bundle for `/admin/cs/orders` (counts, chart series, heat, picklists). */
export type CsOrdersDeferredSecondary = {
  statusCounts: Record<string, number>;
  dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
  scheduleHeat: ScheduleHeatDay[];
  myWorkload: {
    agentId: string;
    agentName: string;
    capacity: number;
    pendingCount: number;
    todayClosesCount?: number;
    lastActionAt: string | null;
  } | null;
  csClosersForFilter: Array<{ agentId: string; agentName: string }>;
  logisticsLocationsForBulk: Array<{ id: string; name: string; providerName: string | null }>;
  productsForOfflineOrder: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
};
import type { ListOrdersScheduleKind } from '@yannis/shared';
import type { Order } from './types';
import { isPreferredDeliveryDueToday } from '~/lib/order-delivery-today';

function DueTodayTag() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-success-300/80 bg-success-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success-800 shadow-sm animate-due-today-breathe dark:border-success-600/50 dark:bg-success-900/35 dark:text-success-100"
      title="Preferred delivery date is today (Africa/Lagos calendar)"
    >
      Due today
    </span>
  );
}

function addMonthsYm(ym: string, delta: number): string {
  const [ys, ms] = ym.split('-');
  const y = parseInt(ys ?? '0', 10);
  const mo = parseInt(ms ?? '1', 10);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Status transitions that make sense for bulk operations
const BULK_TRANSITIONS: Record<string, string[]> = {
  UNPROCESSED: ['CANCELLED'],
  CS_ASSIGNED: ['CANCELLED'],
  CONFIRMED: ['AGENT_ASSIGNED'],
  AGENT_ASSIGNED: ['DISPATCHED'],
  DISPATCHED: ['IN_TRANSIT'],
};

// Friendly action verbs for bulk transition buttons.
// Falls back to the generic "Transition to <STATUS>" form for any status not listed.
function bulkTransitionLabel(targetStatus: string): string {
  switch (targetStatus) {
    case 'CANCELLED':
      return 'Cancel orders';
    case 'AGENT_ASSIGNED':
      return 'Assign for delivery';
    case 'DISPATCHED':
      return 'Mark dispatched';
    case 'IN_TRANSIT':
      return 'Mark in transit';
    default:
      return `Transition to ${formatStatus(targetStatus)}`;
  }
}

export interface OrdersListPageProps {
  orders: Order[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  statusCounts: Record<string, number>;
  statusFilter?: string;
  /**
   * Statuses to omit from the status filter dropdown for this surface.
   * CS context passes `['REMITTED']` because cash remittance is accountant-only
   * and irrelevant to CS — leaving it in the dropdown is just noise.
   * The status pills + buckets above the table are unaffected (they read from
   * `statusCounts` directly).
   */
  excludeStatuses?: string[];
  searchFilter?: string;
  filters?: { startDate: string; endDate: string; startTime?: string; endTime?: string; periodAllTime: boolean };
  userRole?: string;
  /** Permission-driven (orders.bulkAssign) — controls the SmartPick toolbar visibility. */
  canBulkPick?: boolean;
  /** CS closer sees only their assigned orders; when true, title is "My Orders". */
  isCSCloser?: boolean;
  /** HoS/SuperAdmin see "Assigned CS" column and can filter by agent. */
  showCSCloserColumn?: boolean;
  /** For "Filter by CS Closer" dropdown (HoS/SuperAdmin). */
  csClosersForFilter?: Array<{ agentId: string; agentName: string }>;
  /** Logistics locations for the "Allocate to 3PL" bulk modal (HoS/SuperAdmin/Admin). */
  logisticsLocationsForBulk?: Array<{ id: string; name: string; providerName: string | null }>;
  /** HoS/SuperAdmin can assign directly. */
  canAssignDirectly?: boolean;
  /** Current user id. */
  currentUserId?: string;
  /** Workload snapshot for current CS closer (My Orders). */
  myWorkload?: {
    agentId: string;
    agentName: string;
    capacity: number;
    pendingCount: number;
    todayClosesCount?: number;
    lastActionAt: string | null;
  } | null;
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /**
   * When true, show the Form (campaign) column. Used by the Marketing orders page so
   * a Media Buyer can see which form an order came in from at a glance — not relevant
   * to the CS / general orders views.
   */
  showCampaignColumn?: boolean;
  /** Active campaign filter for the Form picker (URL `campaignId`). */
  campaignFilter?: string;
  /** Active product filter for the Product picker (URL `productId`). */
  productFilter?: string;
  /** Available campaigns for the Form filter dropdown (paired with showCampaignColumn). */
  campaignsForFilter?: Array<{ id: string; name: string }>;
  /** Available products for the Product filter dropdown. */
  productsForFilter?: Array<{ id: string; name: string }>;
  /** When true, show "Create offline order" button (CS_CLOSER / HEAD_OF_CS). */
  canCreateOffline?: boolean;
  /**
   * When false (default), the Export / Export Selected buttons are hidden.
   * Server still enforces `orders.export` on the actual download — this is the UI gate.
   */
  canExport?: boolean;
  /** Products list for offline order form (when canCreateOffline). */
  productsForOfflineOrder?: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
  /** Daily order count series for the "Orders over time" chart (from `orders.timeSeriesByCreated`). */
  dailyCounts?: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
  /** CS orders route passes `cs` so unified order detail breadcrumb returns here for admins. */
  orderDetailFrom?: OrderDetailListFrom | null;
  /** CS orders: per-day callback + delivery heat (optional — only `/admin/cs/orders` passes this). */
  scheduleHeat?: ScheduleHeatDay[];
  scheduleFilters?: {
    calendarMonth: string;
    scheduleKind: ListOrdersScheduleKind | null;
    scheduleDate: string | null;
  };
  /** CS orders route — streams counts, chart data, heat, and bulk-action picklists after the list paints. */
  deferredSecondary?: Promise<CsOrdersDeferredSecondary>;
}

type OrdersListPageImplProps = Omit<OrdersListPageProps, 'deferredSecondary'> & {
  deferredLoading?: boolean;
};

function OrdersListPageImpl({
  orders,
  total,
  totalPages,
  page,
  limit,
  statusCounts,
  statusFilter,
  excludeStatuses,
  searchFilter,
  filters,
  userRole,
  canBulkPick = false,
  isCSCloser = false,
  showCSCloserColumn = false,
  showCampaignColumn = false,
  campaignFilter,
  productFilter,
  campaignsForFilter,
  productsForFilter,
  csClosersForFilter,
  logisticsLocationsForBulk = [],
  canAssignDirectly = false,
  currentUserId = '',
  myWorkload = null,
  liveEvents,
  canCreateOffline = false,
  canExport = false,
  productsForOfflineOrder = [],
  dailyCounts,
  scheduleHeat,
  scheduleFilters,
  orderDetailFrom = 'cs',
  deferredLoading = false,
}: OrdersListPageImplProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const toOrderDetail = useCallback(
    (orderId: string) => orderDetailHref('/admin/orders', orderId, orderDetailFrom ?? undefined),
    [orderDetailFrom],
  );
  const [createOfflineOpen, setCreateOfflineOpen] = useState(false);
  const [showChartView, setShowChartView] = useState(false);
  /** Schedule heat calendar lives in a modal — opens when the user picks a "…on date"
   *  schedule filter (before or after a date is chosen) or clicks the date badge.
   *  Page never renders the calendar inline. */
  const [scheduleCalendarModalOpen, setScheduleCalendarModalOpen] = useState(false);

  const liveState = useLiveIndicator(liveEvents ?? []);
  const isLoaderRefetchBusy = useLoaderRefetchBusy().busy;
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSelectedExportModal, setShowSelectedExportModal] = useState(false);

  // Sync URL params to local state when loader data changes (e.g. back/forward)
  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  // Track new/updated rows for 3s highlight effect (e.g. from socket refresh)
  const prevOrdersRef = useRef<Map<string, string>>(new Map());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevOrdersRef.current;
    const newIds = new Set<string>();
    const isFirstLoad = prev.size === 0;

    if (!isFirstLoad) {
      for (const order of orders) {
        const prevStatus = prev.get(order.id);
        if (!prevStatus) {
          newIds.add(order.id); // New order
        } else if (prevStatus !== order.status) {
          newIds.add(order.id); // Status changed
        }
      }
    }

    // Update ref for next comparison
    prevOrdersRef.current = new Map(orders.map((o) => [o.id, o.status]));

    if (newIds.size > 0) {
      setHighlightedIds((h) => new Set([...h, ...newIds]));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setHighlightedIds((h) => {
          const next = new Set(h);
          newIds.forEach((id) => next.delete(id));
          return next;
        });
        timeoutRef.current = null;
      }, 3000);
    }

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [orders]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; errors: string[] } | null>(null);
  const fetcher = useFetcher();
  const { ensureBranchForAction, requiresBranchSelection } = useBranchScopeActionGuard();

  // Bulk Assign-to-CS modal state + dedicated fetcher (so the toast/close trigger
  // doesn't collide with the bulk transition fetcher above).
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  /** Initial assign (unprocessed) vs moving work between closers */
  const [assignModalKind, setAssignModalKind] = useState<'assign' | 'reassign'>('assign');
  const [assignAgentIds, setAssignAgentIds] = useState<Set<string>>(() => new Set());
  const assignFetcher = useFetcher<{ success?: boolean; error?: string; succeeded?: number; failed?: number }>();
  const assignSurface = useFetcherActionSurface(assignFetcher);
  const isAssigning = assignFetcher.state !== 'idle';
  const assignSuccessMessage =
    assignModalKind === 'reassign' ? 'Orders reassigned to closers' : 'Orders assigned to closers';
  useFetcherToast(assignFetcher.data, { successMessage: assignSuccessMessage, skipErrorToast: assignModalOpen });
  useCloseOnFetcherSuccess(assignFetcher, () => {
    setAssignModalOpen(false);
    setAssignAgentIds(new Set());
    setSelectedIds(new Set());
  });

  // Bulk Allocate-to-3PL modal state + dedicated fetcher.
  const [allocateModalOpen, setAllocateModalOpen] = useState(false);
  const [allocateLocationId, setAllocateLocationId] = useState('');
  const allocateFetcher = useFetcher<{ success?: boolean; error?: string; succeeded?: number; failed?: number }>();
  const allocateSurface = useFetcherActionSurface(allocateFetcher);
  const isAllocating = allocateFetcher.state !== 'idle';
  useFetcherToast(allocateFetcher.data, {
    successMessage: 'Orders assigned for delivery (Logistics)',
    skipErrorToast: allocateModalOpen,
  });
  useCloseOnFetcherSuccess(allocateFetcher, () => {
    setAllocateModalOpen(false);
    setAllocateLocationId('');
    setSelectedIds(new Set());
  });

  // Server-side filtering via URL params; orders are already filtered by loader
  const filteredOrders = orders;

  const scheduleSelectValue =
    scheduleFilters?.scheduleKind === 'callback_due'
      ? 'callback_due'
      : scheduleFilters?.scheduleKind === 'delivery_on_day'
        ? 'delivery_on_day'
        : scheduleFilters?.scheduleKind === 'callback_on_day'
          ? 'callback_on_day'
          : scheduleFilters?.scheduleKind === 'delivery_overdue'
            ? 'delivery_overdue'
            : '';

  /** URL updates immediately on dropdown change; loader data can lag one tick — use both for modal copy. */
  const scheduleKindFromSearch = searchParams.get('scheduleKind');
  const modalIsCallbackDayFilter =
    scheduleKindFromSearch === 'callback_on_day' || scheduleFilters?.scheduleKind === 'callback_on_day';

  const applyScheduleKind = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (!v) {
        next.delete('scheduleKind');
        next.delete('scheduleDate');
      } else if (v === 'callback_due') {
        next.set('scheduleKind', 'callback_due');
        next.delete('scheduleDate');
      } else if (v === 'delivery_overdue') {
        next.set('scheduleKind', 'delivery_overdue');
        next.delete('scheduleDate');
      } else {
        next.set('scheduleKind', v);
        const existing = prev.get('scheduleDate');
        if (existing && /^\d{4}-\d{2}-\d{2}$/.test(existing)) next.set('scheduleDate', existing);
        else next.delete('scheduleDate');
      }
      return next;
    });
  };

  const applyScheduleDate = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (v) next.set('scheduleDate', v);
      else next.delete('scheduleDate');
      return next;
    });
  };

  const buildQueryString = (overrides: { page?: number; status?: string; search?: string; csCloserId?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.page !== undefined) params.set('page', String(overrides.page));
    if (overrides.status !== undefined) {
      if (overrides.status === 'ALL' || !overrides.status) params.delete('status');
      else params.set('status', overrides.status);
    }
    if (overrides.search !== undefined) {
      if (overrides.search) params.set('search', overrides.search);
      else params.delete('search');
    }
    if (overrides.csCloserId !== undefined) {
      if (overrides.csCloserId && overrides.csCloserId !== 'ALL') params.set('csCloserId', overrides.csCloserId);
      else params.delete('csCloserId');
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

  // Stat-strip pill per status — funnel order, per-status colors. Same pattern as
  // MarketingOrdersPage so the strip surfaces every stage of the lifecycle, not just
  // Unprocessed / Confirmed / Delivered.
  const STATUS_KEYS = STATUS_OPTIONS.filter((s) => s !== 'ALL');
  const statusItems = STATUS_KEYS.map((status) => ({
    label: STATUS_LABELS[status] ?? formatStatus(status),
    value: statusCounts[status] ?? 0,
    valueClassName: STATUS_TEXT_CLASS[status] ?? 'text-app-fg',
  }));

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('Customer not picking');

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkAction(null);
    setBulkResult(null);
  };

  // Determine what bulk transitions are available based on selected orders
  const selectedOrders = filteredOrders.filter((o) => selectedIds.has(o.id));
  const selectedStatuses = [...new Set(selectedOrders.map((o) => o.status))];
  const singleStatus = selectedStatuses[0];
  const availableTransitions = selectedStatuses.length === 1 && singleStatus !== undefined
    ? BULK_TRANSITIONS[singleStatus] ?? []
    : [];

  const isSubmitting = fetcher.state !== 'idle';

  // Handle fetcher response
  if (fetcher.data && !bulkResult) {
    const data = fetcher.data as { success?: boolean; succeeded?: number; failed?: number; results?: Array<{ orderId: string; success: boolean; error?: string }> };
    if (data.success !== undefined) {
      const errors = (data.results ?? [])
        .filter((r) => !r.success)
        .map((r) => `${r.orderId.slice(0, 8)}...: ${r.error ?? 'Unknown'}`);
      setBulkResult({
        succeeded: data.succeeded ?? 0,
        failed: data.failed ?? 0,
        errors,
      });
    }
  }

  useEffect(() => {
    const err = (fetcher.data as { error?: string } | undefined)?.error;
    if (!err) return;
    if (!requiresBranchSelection) return;
    if (!err.toLowerCase().includes('branch context required')) return;
    ensureBranchForAction({ actionLabel: 'bulk order action' });
  }, [fetcher.data, requiresBranchSelection, ensureBranchForAction]);

  const submitBulkTransition = (newStatus: string) => {
    if (newStatus === 'CANCELLED') {
      setCancelModalOpen(true);
      return;
    }
    setBulkResult(null);
    ensureBranchForAction({
      actionLabel: `transitioning selected orders to ${formatStatus(newStatus)}`,
      onProceed: () =>
        fetcher.submit(
          {
            intent: 'bulkTransition',
            orderIds: JSON.stringify([...selectedIds]),
            newStatus,
          },
          { method: 'post' },
        ),
    });
  };

  // Eligibility: initial queue assign — only unprocessed orders.
  const canBulkAssignToCS =
    selectedOrders.length > 0 &&
    (csClosersForFilter?.length ?? 0) > 0 &&
    selectedOrders.every((o) => o.status === 'UNPROCESSED');

  // Eligibility: Hot-swap style reassignment — orders already with a closer (same bulk API + random split).
  const canBulkReassignToCS =
    selectedOrders.length > 0 &&
    (csClosersForFilter?.length ?? 0) > 0 &&
    selectedOrders.every((o) => o.status === 'CS_ASSIGNED' || o.status === 'CS_ENGAGED');

  /** Unassigned + already-assigned mixed selection — cannot use Assign and Reassign in one batch. */
  const bulkCloserSelectionMixed =
    selectedOrders.some((o) => o.status === 'UNPROCESSED') &&
    selectedOrders.some((o) => o.status === 'CS_ASSIGNED' || o.status === 'CS_ENGAGED');

  // Eligibility: every selected order in CONFIRMED AND we have at least one location.
  const canBulkAllocateTo3PL =
    selectedOrders.length > 0 &&
    logisticsLocationsForBulk.length > 0 &&
    selectedOrders.every((o) => o.status === 'CONFIRMED');

  const assignCloserOptions = (csClosersForFilter ?? []).map((a) => ({ value: a.agentId, label: a.agentName }));
  const allocateLocationOptions = logisticsLocationsForBulk.map((loc) => ({
    value: loc.id,
    label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
  }));

  const submitBulkAssign = () => {
    setBulkResult(null);
    ensureBranchForAction({
      actionLabel:
        assignModalKind === 'reassign'
          ? 'reassigning selected orders to closers'
          : 'assigning selected orders to closers',
      onProceed: () =>
        assignFetcher.submit(
          {
            intent: 'bulkAssign',
            orderIds: JSON.stringify([...selectedIds]),
            csCloserIds: JSON.stringify(Array.from(assignAgentIds)),
          },
          { method: 'post' },
        ),
    });
  };

  const submitBulkAllocate = () => {
    setBulkResult(null);
    ensureBranchForAction({
      actionLabel: 'assigning selected orders for delivery at a 3PL location',
      onProceed: () =>
        allocateFetcher.submit(
          {
            intent: 'bulkTransition',
            orderIds: JSON.stringify([...selectedIds]),
            newStatus: 'AGENT_ASSIGNED',
            logisticsLocationId: allocateLocationId,
          },
          { method: 'post' },
        ),
    });
  };

  const submitBulkCancel = () => {
    setBulkResult(null);
    setCancelModalOpen(false);
    ensureBranchForAction({
      actionLabel: 'cancelling selected orders',
      onProceed: () =>
        fetcher.submit(
          {
            intent: 'bulkTransition',
            orderIds: JSON.stringify([...selectedIds]),
            newStatus: 'CANCELLED',
            reason: cancelReason,
          },
          { method: 'post' },
        ),
    });
  };

  const canBulkAction = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'HEAD_OF_CS' || userRole === 'HEAD_OF_LOGISTICS' || userRole === 'STOCK_MANAGER';

  const ordersListColumns = useMemo((): CompactTableColumn<Order>[] => {
    const cols: CompactTableColumn<Order>[] = [
      {
        key: 'orderId',
        header: 'Order ID',
        render: (order) => <OrderIdBadge id={order.id} linkTo={toOrderDetail(order.id)} />,
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (order) => (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-app-fg">{order.customerName}</span>
            {isPreferredDeliveryDueToday(order.preferredDeliveryDate, order.status) ? <DueTodayTag /> : null}
          </div>
        ),
      },
    ];
    if (showCSCloserColumn) {
      cols.push({
        key: 'closer',
        header: 'Assigned closer',
        render: (order) => (
          <span className="text-app-fg-muted">
            {order.assignedCsId ? (
              <Link
                to={`/hr/users/${order.assignedCsId}`}
                className="font-medium text-brand-500 hover:text-brand-600 hover:underline"
              >
                {order.assignedCsName ?? 'View user'}
              </Link>
            ) : (
              '—'
            )}
          </span>
        ),
      });
    }
    cols.push({
      key: 'product',
      header: 'Product',
      render: (order) => {
        const name = order.primaryProductName?.trim();
        const extra = (order.itemCount ?? 0) > 1 ? ` · +${(order.itemCount ?? 0) - 1} more` : '';
        return (
          <span className="text-sm text-app-fg truncate">
            {name ? (
              <>
                {name}
                {extra ? <span className="text-app-fg-muted">{extra}</span> : null}
              </>
            ) : (
              <span className="text-app-fg-muted">—</span>
            )}
          </span>
        );
      },
    });
    if (showCampaignColumn) {
      cols.push({
        key: 'campaign',
        header: 'Form',
        render: (order) => (
          <span className="text-sm text-app-fg-muted truncate">
            {order.campaignName?.trim() ? order.campaignName : '—'}
          </span>
        ),
      });
    }
    cols.push(
      {
        key: 'status',
        header: 'Status',
        render: (order) => <OrderStatusBadge status={order.status} />,
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        headerClassName: 'text-right',
        render: (order) => (
          <span className="font-medium">
            <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
          </span>
        ),
      },
      {
        key: 'created',
        header: 'Created',
        render: (order) => (
          <span className="text-app-fg-muted whitespace-nowrap">
            {formatOrderTimestamp(order.createdAt)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'center',
        headerClassName: 'text-center',
        tight: true,
        mobileShowLabel: false,
        render: (order) => <TableActionButton to={toOrderDetail(order.id)} variant="primary">View</TableActionButton>,
      },
    );
    return cols;
  }, [showCSCloserColumn, showCampaignColumn, toOrderDetail]);

  const statusOptions = STATUS_OPTIONS.filter((status) => !excludeStatuses?.includes(status)).map(
    (status) => ({
      value: status,
      label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
    }),
  );

  const csCloserOptions = [
    { value: 'ALL', label: 'All closers' },
    ...(csClosersForFilter ?? []).map((a) => ({ value: a.agentId, label: a.agentName })),
  ];

  const ordersListToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (selectedStatus !== 'ALL') n += 1;
    const agent = searchParams.get('csCloserId') || 'ALL';
    if (showCSCloserColumn && (csClosersForFilter?.length ?? 0) > 0 && agent !== 'ALL') n += 1;
    if (scheduleFilters?.scheduleKind) n += 1;
    if (productFilter) n += 1;
    if (showCampaignColumn && campaignFilter) n += 1;
    return n;
  }, [
    selectedStatus,
    showCSCloserColumn,
    csClosersForFilter?.length,
    searchParams,
    scheduleFilters?.scheduleKind,
    productFilter,
    showCampaignColumn,
    campaignFilter,
  ]);

  const scheduleFilterFields = scheduleFilters ? (
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-1">
          <FormSelect
            aria-label="Filter by schedule"
            value={scheduleSelectValue}
            placeholder="Schedule"
            onChange={(e) => {
              setSelectedIds(new Set());
              setBulkResult(null);
              const v = e.target.value;
              applyScheduleKind(v);
              if ((v === 'delivery_on_day' || v === 'callback_on_day') && !scheduleFilters.scheduleDate) {
                setScheduleCalendarModalOpen(true);
              }
            }}
            options={[
              { value: '', label: 'All schedules' },
              { value: 'delivery_on_day', label: 'Deliveries (on date)' },
              { value: 'callback_on_day', label: 'Callbacks (on date)' },
              { value: 'delivery_overdue', label: 'Overdue (undelivered)' },
            ]}
            wrapperClassName="w-full min-w-0 sm:w-52"
          />
        </div>
        {(scheduleSelectValue === 'delivery_on_day' || scheduleSelectValue === 'callback_on_day') && (
          <div className="inline-flex w-full min-w-0 sm:w-auto items-stretch gap-1">
              <button
                type="button"
                onClick={() => {
                  setScheduleCalendarModalOpen(true);
                }}
                className="inline-flex flex-1 items-center justify-between gap-2 h-9 px-3 rounded-md border border-app-border bg-app-elevated text-sm text-app-fg hover:border-brand-300 dark:hover:border-brand-700 transition-colors min-w-[10rem]"
              >
                <span className="inline-flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>
                    {scheduleFilters.scheduleDate
                      ? new Date(scheduleFilters.scheduleDate).toLocaleDateString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })
                      : 'Pick a date…'}
                  </span>
                </span>
                <svg className="w-3 h-3 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {/* Clear schedule filter — wipes both the kind and the date so the page
                  returns to the default "no schedule filter" state. */}
              <button
                type="button"
                onClick={() => {
                  setSelectedIds(new Set());
                  setBulkResult(null);
                  applyScheduleKind('');
                }}
                className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-app-border bg-app-elevated text-app-fg-muted hover:text-app-fg hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
                aria-label="Clear schedule filter"
                title="Clear schedule filter"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      {canCreateOffline && (
        <CreateOfflineOrderModal
          open={createOfflineOpen}
          onClose={() => setCreateOfflineOpen(false)}
          onSuccess={() => setCreateOfflineOpen(false)}
          products={productsForOfflineOrder}
        />
      )}

      {/* Page header — Live tag sits directly in front of the refresh button per CS request. */}
      <PageHeader
        title={isCSCloser ? 'My Orders' : 'CS Orders'}
        mobileInlineActions
        description={isCSCloser ? 'Track your assigned orders' : 'Manage and track all customer orders'}
        actions={
          <>
            <PageHeaderMobileTools
              sheetTitle="CS orders tools"
              sheetSubtitle={<span>Chart, offline order, and export</span>}
              triggerAriaLabel="CS orders toolbar"
              mobileLeading={
                liveEvents != null && liveEvents.length > 0 ? (
                  <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
                ) : null
              }
              desktop={
              <>
                {liveEvents != null && liveEvents.length > 0 && (
                  <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
                )}
                <PageRefreshButton />
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowChartView((v) => !v)}>
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
                {canCreateOffline && (
                  <Button variant="primary" size="sm" onClick={() => setCreateOfflineOpen(true)}>
                    <span className="hidden sm:inline">Create offline order</span>
                    <span className="sm:hidden">+ Order</span>
                  </Button>
                )}
                {canExport && (
                  <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                    Generate report
                  </Button>
                )}
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowChartView((v) => !v);
                  }}
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
                {canCreateOffline && (
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setCreateOfflineOpen(true);
                    }}
                  >
                    Create offline order
                  </Button>
                )}
                {canExport && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowExportModal(true);
                    }}
                  >
                    Generate report
                  </Button>
                )}
              </>
            )}
            />
            <div className="flex shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
              <DateFilterBar
                startDate={filters?.startDate ?? ''}
                endDate={filters?.endDate ?? ''}
                startTime={filters?.startTime ?? ''}
                endTime={filters?.endTime ?? ''}
                periodAllTime={filters?.periodAllTime ?? false}
              />
            </div>
          </>
        }
      />

      {/* Status totals — moved above My Workload so the funnel snapshot reads first. */}
      {deferredLoading ? (
        <OverviewStatStripSkeleton count={1 + STATUS_KEYS.length} />
      ) : (
        <OverviewStatStrip
          items={[
            { label: 'Total', value: total, valueClassName: 'text-app-fg' },
            ...statusItems,
          ]}
        />
      )}

      {/* My workload (CS closer only) */}
      {isCSCloser && (myWorkload || deferredLoading) && (
        myWorkload ? (
          <div className="card">
            <h2 className="text-sm font-semibold text-app-fg mb-2">
              My Workload
            </h2>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
                <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
                  {myWorkload.agentName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-app-fg truncate">
                  {myWorkload.agentName}
                </p>
                <p className="text-xs text-app-fg-muted">
                  Today&apos;s duty: {myWorkload.todayClosesCount ?? 0} / {myWorkload.capacity}
                  <span className="text-app-fg-muted/80"> (Lagos)</span>
                </p>
                <p className="text-[11px] text-app-fg-muted mt-0.5">Pipeline backlog: {myWorkload.pendingCount}</p>
              </div>
            </div>
            {(() => {
              const closes = myWorkload.todayClosesCount ?? 0;
              const dailyPct = myWorkload.capacity > 0 ? (closes / myWorkload.capacity) * 100 : 0;
              const barColor =
                dailyPct >= 100 ? 'bg-success-500' : dailyPct >= 70 ? 'bg-warning-500' : 'bg-brand-500';
              return (
                <>
                  <div className="w-full h-2 bg-app-hover rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                      style={{ width: `${Math.min(dailyPct, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                    <span className="text-xs text-app-fg-muted">
                      {Math.round(Math.min(dailyPct, 100))}% of daily target
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {closes >= myWorkload.capacity && (
                        <span className="text-xs font-medium text-success-600 dark:text-success-400">Target met</span>
                      )}
                      {myWorkload.pendingCount >= myWorkload.capacity && (
                        <span className="text-xs font-medium text-warning-600 dark:text-warning-400">At quota</span>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        ) : deferredLoading ? (
          <div className="card animate-pulse space-y-3" aria-hidden>
            <div className="h-4 w-28 rounded bg-app-hover" />
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-app-hover shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-app-hover" />
                <div className="h-3 w-52 rounded bg-app-hover" />
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-app-hover" />
          </div>
        ) : null
      )}

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && canBulkAction && (
        <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <button onClick={clearSelection} className="text-xs text-brand-500 hover:text-brand-600 underline">
                Clear
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {/* Bulk assign — unprocessed orders only */}
              {canBulkAssignToCS && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setAssignModalKind('assign');
                    setAssignAgentIds(new Set());
                    setAssignModalOpen(true);
                  }}
                  disabled={isSubmitting || isAssigning || isAllocating}
                >
                  Assign to CS
                </Button>
              )}
              {/* Reassign — orders already assigned / engaged; distinct from first-time assign */}
              {canBulkReassignToCS && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setAssignModalKind('reassign');
                    setAssignAgentIds(new Set());
                    setAssignModalOpen(true);
                  }}
                  disabled={isSubmitting || isAssigning || isAllocating}
                >
                  Reassign closers
                </Button>
              )}
              {/* Bulk Allocate to 3PL — appears when every selection is CONFIRMED */}
              {canBulkAllocateTo3PL && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setAllocateLocationId('');
                    setAllocateModalOpen(true);
                  }}
                  disabled={isSubmitting || isAssigning || isAllocating}
                >
                  Assign to Logistics
                </Button>
              )}
              {/* Bulk Transition buttons */}
              {availableTransitions.map((status: string) => (
                <Button
                  key={status}
                  variant={status === 'CANCELLED' ? 'danger' : 'primary'}
                  size="sm"
                  onClick={() => submitBulkTransition(status)}
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  loadingText="Processing..."
                >
                  {bulkTransitionLabel(status)}
                </Button>
              ))}
              {/* Export selected — same orders.export gate as the full report button. */}
              {canExport && (
                <Button variant="secondary" size="sm" onClick={() => setShowSelectedExportModal(true)}>
                  Export Selected
                </Button>
              )}
            </div>
          </div>
          {/* Helper notes — kept on their own lines so they don't wedge between
              the action buttons and make the toolbar look scattered. */}
          {(bulkCloserSelectionMixed || selectedStatuses.length > 1) && (
            <div className="mt-2 space-y-1 border-t border-brand-200/60 dark:border-brand-700/40 pt-2">
              {bulkCloserSelectionMixed && (
                <p className="text-xs text-app-fg-muted">
                  Use Assign for unassigned orders only, or Reassign when every selected order already has a
                  closer — not both in one selection.
                </p>
              )}
              {selectedStatuses.length > 1 && (
                <p className="text-xs text-app-fg-muted italic">
                  Select orders with same status for bulk transition.
                </p>
              )}
            </div>
          )}
          {/* Bulk result summary */}
          {bulkResult && (
            <div className="mt-3 p-3 rounded-lg bg-app-elevated border border-app-border">
              <div className="flex items-center gap-3 text-sm">
                {bulkResult.succeeded > 0 && (
                  <span className="text-success-600 dark:text-success-400 font-medium">
                    {bulkResult.succeeded} succeeded
                  </span>
                )}
                {bulkResult.failed > 0 && (
                  <span className="text-danger-600 dark:text-danger-400 font-medium">
                    {bulkResult.failed} failed
                  </span>
                )}
              </div>
              {bulkResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {bulkResult.errors.map((err, i) => (
                    <p key={i} className="text-xs text-danger-600 dark:text-danger-400">
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <LocalExportModal
        open={showSelectedExportModal}
        onClose={() => setShowSelectedExportModal(false)}
        title="Export Selected Orders"
        description="Choose format and columns for selected orders."
        filenamePrefix="orders-selected"
        rows={selectedOrders.map((o) => ({
          id: o.id,
          customer: o.customerName,
          assignedCs: o.assignedCsName ?? '—',
          phone: o.customerPhoneDisplay,
          status: o.status,
          amount: o.totalAmount ?? '',
          created: formatOrderTimestamp(o.createdAt),
        }))}
        columns={[
          { key: 'id', label: 'Order ID' },
          { key: 'customer', label: 'Customer' },
          ...(showCSCloserColumn ? [{ key: 'assignedCs', label: 'Assigned closer' }] : []),
          { key: 'phone', label: 'Phone' },
          { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount' },
          { key: 'created', label: 'Created' },
        ]}
        defaultColumns={showCSCloserColumn ? ['id', 'customer', 'assignedCs', 'status', 'amount', 'created'] : ['id', 'customer', 'status', 'amount', 'created']}
      />

      <div className="card p-0 overflow-hidden">
        <ToolbarFiltersCollapsible
          className="!border-0"
          badgeCount={ordersListToolbarFilterBadge}
          sheetSubtitle={<span>Status and closer apply immediately</span>}
          searchRow={
            <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:flex-nowrap md:items-center md:gap-3 md:flex-1">
              <form
                method="get"
                className="flex min-w-0 w-full flex-col gap-2 sm:flex-row sm:items-center md:flex-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSearchParams((p) => {
                    const next = new URLSearchParams(p);
                    next.set('page', '1');
                    if (searchQuery.trim()) next.set('search', searchQuery.trim());
                    else next.delete('search');
                    return next;
                  });
                }}
              >
                <SearchInput
                  name="search"
                  placeholder="Search by customer name or phone number…"
                  value={searchQuery}
                  onChange={(val) => setSearchQuery(val)}
                  withSubmitButton
                  wrapperClassName="min-w-0 w-full flex-1"
                />
              </form>
              <div className="hidden shrink-0 items-center gap-3 md:flex">
                <FormSelect
                  value={selectedStatus}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedStatus(v);
                    setSelectedIds(new Set());
                    setBulkResult(null);
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (v === 'ALL') next.delete('status');
                      else next.set('status', v);
                      return next;
                    });
                  }}
                  options={statusOptions}
                  wrapperClassName="w-full min-w-0 sm:w-48"
                />
                {showCSCloserColumn && ((csClosersForFilter?.length ?? 0) > 0 || deferredLoading) ? (
                  deferredLoading && !(csClosersForFilter?.length) ? (
                    <div
                      className="h-9 w-full min-w-0 sm:w-48 shrink-0 rounded-md bg-app-hover animate-pulse"
                      aria-hidden
                    />
                  ) : (
                    <SearchableSelect
                      id="orders-filter-closer"
                      value={searchParams.get('csCloserId') || 'ALL'}
                      onChange={(v) => {
                        setSelectedIds(new Set());
                        setBulkResult(null);
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.set('page', '1');
                          if (v && v !== 'ALL') next.set('csCloserId', v);
                          else next.delete('csCloserId');
                          return next;
                        });
                      }}
                      options={csCloserOptions}
                      wrapperClassName="w-full min-w-0 sm:w-48"
                      placeholder="All closers"
                      searchPlaceholder="Search closers..."
                    />
                  )
                ) : null}
                {(productsForFilter?.length ?? 0) > 0 ? (
                  <SearchableSelect
                    id="orders-filter-product"
                    value={productFilter || 'ALL'}
                    onChange={(v) => {
                      setSelectedIds(new Set());
                      setBulkResult(null);
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.set('page', '1');
                        if (v && v !== 'ALL') next.set('productId', v);
                        else next.delete('productId');
                        return next;
                      });
                    }}
                    options={[
                      { value: 'ALL', label: 'All products' },
                      ...(productsForFilter ?? []).map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    wrapperClassName="w-full min-w-0 sm:w-48"
                    placeholder="All products"
                    searchPlaceholder="Search products..."
                  />
                ) : null}
                {showCampaignColumn && (campaignsForFilter?.length ?? 0) > 0 ? (
                  <SearchableSelect
                    id="orders-filter-form"
                    value={campaignFilter || 'ALL'}
                    onChange={(v) => {
                      setSelectedIds(new Set());
                      setBulkResult(null);
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.set('page', '1');
                        if (v && v !== 'ALL') next.set('campaignId', v);
                        else next.delete('campaignId');
                        return next;
                      });
                    }}
                    options={[
                      { value: 'ALL', label: 'All forms' },
                      ...(campaignsForFilter ?? []).map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    wrapperClassName="w-full min-w-0 sm:w-48"
                    placeholder="All forms"
                    searchPlaceholder="Search forms..."
                  />
                ) : null}
              </div>
            </div>
          }
          desktopInlineFilters={scheduleFilterFields}
          sheetFilterBody={
            <>
              {scheduleFilterFields ? (
                <div className="space-y-1.5 pb-2 border-b border-app-border mb-3">{scheduleFilterFields}</div>
              ) : null}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Status</span>
                <FormSelect
                  value={selectedStatus}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedStatus(v);
                    setSelectedIds(new Set());
                    setBulkResult(null);
                    setSearchParams((p) => {
                      const next = new URLSearchParams(p);
                      next.set('page', '1');
                      if (v === 'ALL') next.delete('status');
                      else next.set('status', v);
                      return next;
                    });
                  }}
                  options={statusOptions}
                  wrapperClassName="w-full"
                />
              </div>
              {showCSCloserColumn && ((csClosersForFilter?.length ?? 0) > 0 || deferredLoading) ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Closer</span>
                  {deferredLoading && !(csClosersForFilter?.length) ? (
                    <div className="h-9 w-full rounded-md bg-app-hover animate-pulse" aria-hidden />
                  ) : (
                    <SearchableSelect
                      id="orders-filter-closer-sheet"
                      value={searchParams.get('csCloserId') || 'ALL'}
                      onChange={(v) => {
                        setSelectedIds(new Set());
                        setBulkResult(null);
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.set('page', '1');
                          if (v && v !== 'ALL') next.set('csCloserId', v);
                          else next.delete('csCloserId');
                          return next;
                        });
                      }}
                      options={csCloserOptions}
                      wrapperClassName="w-full"
                      placeholder="All closers"
                      searchPlaceholder="Search closers..."
                    />
                  )}
                </div>
              ) : null}
              {(productsForFilter?.length ?? 0) > 0 ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Product</span>
                  <SearchableSelect
                    id="orders-filter-product-sheet"
                    value={productFilter || 'ALL'}
                    onChange={(v) => {
                      setSelectedIds(new Set());
                      setBulkResult(null);
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.set('page', '1');
                        if (v && v !== 'ALL') next.set('productId', v);
                        else next.delete('productId');
                        return next;
                      });
                    }}
                    options={[
                      { value: 'ALL', label: 'All products' },
                      ...(productsForFilter ?? []).map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    wrapperClassName="w-full"
                    placeholder="All products"
                    searchPlaceholder="Search products..."
                  />
                </div>
              ) : null}
              {showCampaignColumn && (campaignsForFilter?.length ?? 0) > 0 ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Form</span>
                  <SearchableSelect
                    id="orders-filter-form-sheet"
                    value={campaignFilter || 'ALL'}
                    onChange={(v) => {
                      setSelectedIds(new Set());
                      setBulkResult(null);
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.set('page', '1');
                        if (v && v !== 'ALL') next.set('campaignId', v);
                        else next.delete('campaignId');
                        return next;
                      });
                    }}
                    options={[
                      { value: 'ALL', label: 'All forms' },
                      ...(campaignsForFilter ?? []).map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    wrapperClassName="w-full"
                    placeholder="All forms"
                    searchPlaceholder="Search forms..."
                  />
                </div>
              ) : null}
            </>
          }
        />
      </div>

      {/* Smart pick — sits directly under the filters card so the bulk-pick
          toolbar reads as a continuation of the filter row. Permission-driven
          (orders.bulkAssign); held by HEAD_OF_CS by default and admin-class
          inherits via ALL_PERMISSION_CODES. Picks the first N from the
          filtered list; per-row checkboxes still work alongside it. */}
      {canBulkPick && filteredOrders.length > 0 && (
        <div className="rounded-lg border border-app-border bg-app-elevated px-3 py-2">
          <SmartPick
            total={filteredOrders.length}
            selectedCount={selectedIds.size}
            onPick={(count) =>
              setSelectedIds(new Set(filteredOrders.slice(0, count).map((o) => o.id)))
            }
            onClear={clearSelection}
            itemNoun="orders"
          />
        </div>
      )}

      {/* Schedule heat calendar — modal only. The Schedule dropdown's "…on date" options
          open this; the date badge next to the dropdown reopens it to change the day. */}
      {scheduleFilters && scheduleCalendarModalOpen ? (
        <Modal
          open
          onClose={() => setScheduleCalendarModalOpen(false)}
          maxWidth="max-w-md"
          backdropBlur
          contentClassName="p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold text-app-fg">
                {modalIsCallbackDayFilter ? 'Pick a callback day' : 'Pick a delivery day'}
              </h3>
              <p className="text-xs text-app-fg-muted">
                {modalIsCallbackDayFilter
                  ? 'Lagos callback date matches the day you select.'
                  : 'ISO preferred delivery date matches the day you select.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setScheduleCalendarModalOpen(false)}
              className="shrink-0 text-app-fg-muted hover:text-app-fg p-1"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {deferredLoading && scheduleHeat === undefined ? (
            <div className="min-h-[18rem] rounded-lg bg-app-hover/80 animate-pulse" aria-hidden />
          ) : (
            <>
              {/* Loading overlay — kicks in while the loader is recomputing the heat
                  for the new month (← / → buttons trigger a URL change). The calendar
                  stays mounted under a blur so the user sees the new data fade in
                  instead of a flash of empty cells. */}
              <TableLoadingOverlay show={isLoaderRefetchBusy} minHeightClassName="min-h-[18rem]">
                <ScheduleHeatCalendar
              yearMonth={scheduleFilters.calendarMonth}
              heat={scheduleHeat ?? []}
              selectedDate={scheduleFilters.scheduleDate}
              onSelectDay={(iso) => {
                setSelectedIds(new Set());
                setBulkResult(null);
                // Pick the right bucket based on what the day actually contains:
                //   • only callbacks → callback_on_day
                //   • only deliveries → delivery_on_day
                //   • both → respect the current view's kind so the user stays in
                //     the bucket they were already filtering by
                //   • neither (cell shouldn't be clickable, but defensive) → keep
                //     the current kind, fallback to delivery_on_day
                const dayHeat = (scheduleHeat ?? []).find((d) => d.date === iso);
                const cb = dayHeat?.callbackCount ?? 0;
                const del = dayHeat?.deliveryCount ?? 0;
                const currentIsCallback =
                  scheduleKindFromSearch === 'callback_on_day' ||
                  scheduleFilters.scheduleKind === 'callback_on_day';
                const dayKind: 'callback_on_day' | 'delivery_on_day' =
                  cb > 0 && del === 0
                    ? 'callback_on_day'
                    : del > 0 && cb === 0
                      ? 'delivery_on_day'
                      : currentIsCallback
                        ? 'callback_on_day'
                        : 'delivery_on_day';
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('page', '1');
                  next.set('calendarMonth', iso.slice(0, 7));
                  next.set('scheduleKind', dayKind);
                  next.set('scheduleDate', iso);
                  return next;
                });
                setScheduleCalendarModalOpen(false);
              }}
              onPrevMonth={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('page', '1');
                  next.set('calendarMonth', addMonthsYm(scheduleFilters.calendarMonth, -1));
                  return next;
                });
              }}
              onNextMonth={() => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('page', '1');
                  next.set('calendarMonth', addMonthsYm(scheduleFilters.calendarMonth, 1));
                  return next;
                });
              }}
                />
              </TableLoadingOverlay>
            </>
          )}
        </Modal>
      ) : null}

      {/* Orders table — replaced with chart view when the user toggles "View data in chart" */}
      {showChartView ? (
        deferredLoading ? (
          <OrdersChartViewShellSkeleton />
        ) : (
          <OrdersChartView
            statusCounts={statusCounts}
            total={total}
            scopeLabel="CS orders"
            dailyCounts={dailyCounts}
          />
        )
      ) : (
      <TableLoadingOverlay show={isLoaderRefetchBusy}>
        <div className="card p-0">
          <CompactTable<Order>
            withCard={false}
            columns={ordersListColumns}
            rows={filteredOrders}
            rowKey={(o) => o.id}
            rowClassName={(o) =>
              [selectedIds.has(o.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : '', highlightedIds.has(o.id) ? 'row-new-highlight' : '']
                .filter(Boolean)
                .join(' ')
            }
            selection={
              canBulkAction
                ? {
                    selectedIds,
                    onToggle: (id, selected) => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (selected) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    },
                    onToggleAll: (selectAll) => {
                      if (selectAll) setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
                      else setSelectedIds(new Set());
                    },
                  }
                : undefined
            }
            emptyTitle={orders.length === 0 ? 'No orders yet' : 'No orders found'}
            emptyDescription={orders.length === 0 ? undefined : 'Try adjusting your filters or search query'}
          />
        </div>
      </TableLoadingOverlay>
      )}

      {/* Pagination — table view only; the chart view doesn't paginate. */}
      {!showChartView && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {total > 0
              ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} orders`
              : 'No orders'}
          </p>
          <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} />
        </div>
      )}

      {/* Bulk cancel confirmation modal */}
      {cancelModalOpen && (
        <Modal open onClose={() => { setCancelModalOpen(false); setCancelReason(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">
              Cancel {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}?
            </h3>
            <p className="text-sm text-app-fg-muted mb-3">
              Please provide a reason (at least 10 characters). Selected orders will be moved to Cancelled.
            </p>
            {/* Preset reason buttons */}
            <div className="flex flex-wrap gap-2 mb-3">
              {['Customer not picking', 'Wrong number', 'Customer refused', 'Duplicate', 'Other'].map((preset) => {
                const isOther = preset === 'Other';
                const isActive = isOther
                  ? cancelReason.length > 0 && !['Customer not picking', 'Wrong number', 'Customer refused', 'Duplicate'].includes(cancelReason)
                  : cancelReason === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCancelReason(isOther ? '' : preset)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border border-brand-300 dark:border-brand-700'
                        : 'bg-app-hover text-app-fg-muted border border-app-border hover:bg-app-hover'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            {/* Textarea for custom reason */}
            <Textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Enter cancellation reason..."
              rows={3}
            />
            {/* Modal actions */}
            <div className="flex gap-2 mt-4 justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setCancelModalOpen(false);
                  setCancelReason('Customer not picking');
                }}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={cancelReason.trim().length < 10 || isSubmitting}
                loading={isSubmitting}
                loadingText="Cancelling..."
                onClick={submitBulkCancel}
              >
                Cancel {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}
              </Button>
            </div>
        </Modal>
      )}

      {/* Bulk assign / reassign to CS — checkbox list + random split (matches CS queue) */}
      {assignModalOpen && (
        <AssignCloserModal
          open
          onClose={() => {
            setAssignModalOpen(false);
            setAssignAgentIds(new Set());
          }}
          selectedCount={selectedIds.size}
          options={assignCloserOptions}
          selectedIds={assignAgentIds}
          onToggle={(id) =>
            setAssignAgentIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onSubmit={submitBulkAssign}
          isSubmitting={isAssigning}
          errorMessage={assignSurface.errorMatchingIntent('bulkAssign')}
          mode={assignModalKind}
          emptyMessage="No closers available in your scope."
        />
      )}

      {/* Bulk Allocate to 3PL modal */}
      {allocateModalOpen && (
        <Modal
          open
          onClose={() => {
            if (isAllocating) return;
            setAllocateModalOpen(false);
            setAllocateLocationId('');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">
            Assign {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} for delivery at a Logistics location
          </h3>
          <p className="text-sm text-app-fg-muted mb-4">
            Pick the Logistics location that will fulfill these orders.
          </p>
          <ModalFetcherInlineError message={allocateSurface.errorMatchingIntent('bulkTransition')} className="mb-4" />
          <div data-branch-scoped-action="true">
            <div className="mb-4">
              <SearchableSelect
                id="bulk-allocate-location"
                label="Logistics location"
                value={allocateLocationId}
                onChange={setAllocateLocationId}
                options={allocateLocationOptions}
                placeholder="Select a location..."
                searchPlaceholder="Search locations..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={isAllocating}
                onClick={() => {
                  setAllocateModalOpen(false);
                  setAllocateLocationId('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={!allocateLocationId || isAllocating}
                loading={isAllocating}
                loadingText="Assigning…"
                onClick={submitBulkAllocate}
              >
                Assign
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.cs_orders}
        picklists={{
          csClosers: (csClosersForFilter ?? []).map((a) => ({ id: a.agentId, name: a.agentName })),
        }}
        initialFilters={{
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          search: searchQuery || undefined,
          assignedCsId: searchParams.get('csCloserId') || undefined,
          ...(filters?.periodAllTime
            ? { periodAllTime: true as const }
            : filters?.startDate && filters?.endDate
              ? { startDate: filters.startDate, endDate: filters.endDate }
              : {}),
        }}
      />

    </div>
  );
}

export function OrdersListPage(props: OrdersListPageProps) {
  if (props.deferredSecondary) {
    const { deferredSecondary, ...rest } = props;
    return (
      <Suspense
        fallback={
          <OrdersListPageImpl
            {...rest}
            deferredLoading
            statusCounts={{}}
            dailyCounts={undefined}
            scheduleHeat={undefined}
            myWorkload={null}
            csClosersForFilter={undefined}
            logisticsLocationsForBulk={[]}
            productsForOfflineOrder={[]}
          />
        }
      >
        <Await resolve={deferredSecondary} errorElement={<DeferredError />}>
          {(sec) => (
            <OrdersListPageImpl
              {...rest}
              statusCounts={sec.statusCounts}
              dailyCounts={sec.dailyCounts}
              scheduleHeat={sec.scheduleHeat}
              myWorkload={sec.myWorkload}
              csClosersForFilter={sec.csClosersForFilter}
              logisticsLocationsForBulk={sec.logisticsLocationsForBulk}
              productsForOfflineOrder={sec.productsForOfflineOrder}
            />
          )}
        </Await>
      </Suspense>
    );
  }
  return <OrdersListPageImpl {...props} />;
}
