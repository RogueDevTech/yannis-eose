import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Await, Link, useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { SmartPick } from '~/components/ui/smart-pick';
import { Modal } from '~/components/ui/modal';
import { AssignCloserModal } from '~/components/ui/assign-closer-modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { formatOrderTimestamp } from '~/lib/format-date';
import { confirmationRateColorClass, deliveryRateColorClass } from '~/lib/rate-color';
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
import {
  CompactTable,
  type CompactTableColumn,
  type CompactTableMobileCardHelpers,
} from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { TextInput } from '~/components/ui/text-input';
import { ScheduleHeatCalendar } from '~/components/ui/schedule-heat-calendar';
import type { ScheduleHeatDay } from '~/components/ui/schedule-heat-calendar';
import { fetchOrdersMatchingIds, fetchOrderClipboardSummary, ORDERS_DEEP_SELECT_MAX } from '~/lib/trpc-browser';
import { useToast } from '~/components/ui/toast';

/** Deferred loader bundle for `/admin/sales/orders` (counts, chart series, heat, picklists). */
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
  /** Open abandoned-cart count for the overview strip — null when the viewer is not HoCS+. */
  cartAbandonmentCount: number | null;
};
import type { ListOrdersScheduleKind } from '@yannis/shared';
import type { Order } from './types';
import { AbandonedCartDetailModal } from '~/features/cs/AbandonedCartDetailModal';
import type { PendingCart } from '~/features/cs/types';
import {
  isPreferredDeliveryDueToday,
  isPreferredDeliveryOverdue,
  isCallbackDue,
} from '~/lib/order-delivery-today';

/** Statuses where the "Copy order" summary action is available on the list. */
const ORDER_STATUSES_WITH_COPY_ACTION = new Set([
  'CS_ENGAGED',
  'CONFIRMED',
  'AGENT_ASSIGNED',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'PARTIALLY_DELIVERED',
]);

function DueTodayTag() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-success-300/80 bg-success-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-success-800 shadow-sm animate-due-today-breathe dark:border-success-600/50 dark:bg-success-900/35 dark:text-success-100"
      title="Preferred delivery date is today (Africa/Lagos calendar)"
    >
      Due today
    </span>
  );
}

function OverdueTag() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-danger-300/80 bg-danger-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-800 shadow-sm dark:border-danger-600/50 dark:bg-danger-900/35 dark:text-danger-100"
      title="Preferred delivery date has passed and the order is still undelivered"
    >
      Overdue
    </span>
  );
}

function CallbackDueTag() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-warning-300/80 bg-warning-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-warning-800 shadow-sm dark:border-warning-600/50 dark:bg-warning-900/35 dark:text-warning-100"
      title="Scheduled callback time has arrived"
    >
      Callback due
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

// Status transitions that make sense for bulk operations.
// CEO directive 2026-05-23: CANCELLED removed — only DELETED (permission-gated).
const BULK_TRANSITIONS: Record<string, string[]> = {
  UNPROCESSED: ['DELETED'],
  CS_ASSIGNED: ['DELETED'],
  CS_ENGAGED: ['DELETED'],
  CONFIRMED: ['AGENT_ASSIGNED'],
  AGENT_ASSIGNED: ['DISPATCHED'],
  DISPATCHED: ['IN_TRANSIT'],
};

// Friendly action verbs for bulk transition buttons.
// Falls back to the generic "Transition to <STATUS>" form for any status not listed.
function bulkTransitionLabel(targetStatus: string): string {
  switch (targetStatus) {
    case 'DELETED':
      return 'Delete orders';
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
   * Sales context passes `['REMITTED']` because cash remittance is accountant-only
   * and irrelevant to Sales — leaving it in the dropdown is just noise.
   * The status pills + buckets above the table are unaffected (they read from
   * `statusCounts` directly).
   */
  excludeStatuses?: string[];
  searchFilter?: string;
  filters?: { startDate: string; endDate: string; startTime?: string; endTime?: string; periodAllTime: boolean };
  userRole?: string;
  /** Permission-driven (orders.bulkAssign) — controls the SmartPick toolbar visibility. */
  canBulkPick?: boolean;
  /** Sales closer sees only their assigned orders; when true, title is "My Orders". */
  isCSCloser?: boolean;
  /** HoS/SuperAdmin see "Assigned Sales" column and can filter by agent. */
  showCSCloserColumn?: boolean;
  /** For "Filter by Sales Closer" dropdown (HoS/SuperAdmin). */
  csClosersForFilter?: Array<{ agentId: string; agentName: string }>;
  /** Logistics locations for the "Allocate to 3PL" bulk modal (HoS/SuperAdmin/Admin). */
  logisticsLocationsForBulk?: Array<{ id: string; name: string; providerName: string | null }>;
  /** HoS/SuperAdmin can assign directly. */
  canAssignDirectly?: boolean;
  /** Current user id. */
  currentUserId?: string;
  /** Workload snapshot for current Sales closer (My Orders). */
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
   * to the Sales / general orders views.
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
  /** Sales orders route passes `cs` so unified order detail breadcrumb returns here for admins. */
  orderDetailFrom?: OrderDetailListFrom | null;
  /** Sales orders: per-day callback + delivery heat (optional — only `/admin/sales/orders` passes this). */
  scheduleHeat?: ScheduleHeatDay[];
  scheduleFilters?: {
    calendarMonth: string;
    scheduleKind: ListOrdersScheduleKind | null;
    scheduleDate: string | null;
  };
  /**
   * Serialised `listInput` (the same payload the loader sent to `orders.list`).
   * When provided, enables the "Select all matching this filter" deep-select
   * banner — the page calls `orders.list` client-side with this exact input
   * (capped at ORDERS_DEEP_SELECT_MAX) so authz/scope match the visible list.
   * Omit it to hide the feature for a given surface.
   */
  bulkSelectAllMatchingInput?: string;
  /** Sales orders route — streams counts, chart data, heat, and bulk-action picklists after the list paints. */
  deferredSecondary?: Promise<CsOrdersDeferredSecondary>;
  /**
   * Sales orders route — adds a "Cart abandonment" pseudo-option to the status
   * dropdown for HoCS+. Maps to `?fromCart=1` (which the loader filters on).
   * When this prop is true the dropdown gains the option and selecting it
   * deletes any `status` param. Selecting any real status clears `fromCart`.
   * Server still enforces the role gate; this prop is just UI visibility.
   */
  enableFromCartStatusOption?: boolean;
  /** Show "Test orders" filter option. Admin only. */
  enableTestOrdersOption?: boolean;
  /**
   * Open abandoned-cart count — when provided, an extra "Cart abandonment" tile
   * is shown in the overview strip. Only the Sales orders route supplies it (via
   * `deferredSecondary`) and only for HoCS / Admin / SuperAdmin.
   */
  cartAbandonmentCount?: number | null;
  /**
   * Cart-abandonment mode — true when the `?fromCart=1` filter is active and the
   * loader has populated `orders` with abandoned CARTS (status `'CART'`) instead
   * of real orders. Switches the table to a read-only cart view: "Cart" status
   * badge, "View cart" action only, no bulk toolbar / smart pick.
   */
  isCartAbandonmentView?: boolean;
  /** Branches available for the "Move to branch" bulk action (Admin/HoCS only). */
  branchesForMove?: Array<{ id: string; name: string }>;
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
  enableFromCartStatusOption = false,
  enableTestOrdersOption = false,
  cartAbandonmentCount = null,
  isCartAbandonmentView = false,
  bulkSelectAllMatchingInput,
  branchesForMove,
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

  const { toast } = useToast();
  const liveState = useLiveIndicator(liveEvents ?? []);
  const { busy: isLoaderRefetchBusy, primeSamePathRefetch } = useLoaderRefetchBusy();
  /** Sentinel — not an order status, indicates the `?fromCart=1` pseudo-filter is active. */
  const FROM_CART_STATUS_VALUE = '__from_cart__';
  const TEST_ORDERS_STATUS_VALUE = '__test_orders__';
  const fromCartUrlActive = searchParams.get('fromCart') === '1';
  const testOrdersUrlActive = searchParams.get('testOrders') === '1';
  const initialSelectedStatus =
    enableTestOrdersOption && testOrdersUrlActive
      ? TEST_ORDERS_STATUS_VALUE
      : enableFromCartStatusOption && fromCartUrlActive
        ? FROM_CART_STATUS_VALUE
        : statusFilter || 'ALL';
  const [selectedStatus, setSelectedStatus] = useState(initialSelectedStatus);
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSelectedExportModal, setShowSelectedExportModal] = useState(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const purgeFetcher = useFetcher<{ success?: boolean; deleted?: number; skipped?: number; error?: string }>();
  const isTestOrdersView = selectedStatus === TEST_ORDERS_STATUS_VALUE;
  useFetcherToast(purgeFetcher.data, {
    successTitle: 'Test orders deleted',
    successMessage: `${purgeFetcher.data?.deleted ?? 0} deleted${(purgeFetcher.data?.skipped ?? 0) > 0 ? `, ${purgeFetcher.data?.skipped} skipped (stock moved)` : ''}`,
    errorTitle: 'Delete failed',
  });
  // Mobile-only: Smart pick lives in the tools sheet and opens its own modal.
  const [smartPickModalOpen, setSmartPickModalOpen] = useState(false);

  // "View cart" quick-detail — for cart-recovered orders, fetches the source cart
  // on demand and shows it in the shared abandoned-cart detail modal.
  const cartDetailFetcher = useFetcher<{ cart: PendingCart | null }>();
  const [viewCartOrderId, setViewCartOrderId] = useState<string | null>(null);
  const openCartDetail = useCallback(
    (order: Order) => {
      if (!order.cartId) return;
      setViewCartOrderId(order.id);
      cartDetailFetcher.load(`/admin/sales/queue/carts?cartId=${order.cartId}`);
    },
    [cartDetailFetcher],
  );

  // Sync URL params to local state when loader data changes (e.g. back/forward)
  useEffect(() => {
    setSelectedStatus(
      enableFromCartStatusOption && fromCartUrlActive
        ? FROM_CART_STATUS_VALUE
        : statusFilter || 'ALL',
    );
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter, enableFromCartStatusOption, fromCartUrlActive]);

  // Track new/updated rows for 3s highlight effect. Gated on
  // `liveState.showGreen` so it only fires when a relevant socket event
  // (order:new / order:status_changed / etc.) was received within the last
  // 4s — i.e. an actual realtime update. Filter changes, search, schedule
  // picks and page navigations also mutate `orders`, but they shouldn't paint
  // a green border on every visible row.
  const prevOrdersRef = useRef<Map<string, string>>(new Map());
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prev = prevOrdersRef.current;
    const newIds = new Set<string>();
    const isFirstLoad = prev.size === 0;

    if (!isFirstLoad && liveState.showGreen) {
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
  }, [orders, liveState.showGreen]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; errors: string[] } | null>(null);
  // "Select all matching this filter" deep-select state. Active when the user
  // chose to extend the page-only selection to every order matching the
  // current filter (server-fetched, capped at ORDERS_DEEP_SELECT_MAX).
  const [selectAllMatchingActive, setSelectAllMatchingActive] = useState(false);

  /** Update selected status + URL params without triggering a full route navigation.
   *  Stat strip items use this so the strip never flickers with a skeleton. */
  const handleStatusSelect = useCallback((v: string) => {
    primeSamePathRefetch();
    setSelectedStatus(v);
    setSelectedIds(new Set());
    setBulkResult(null);
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (v === FROM_CART_STATUS_VALUE) {
        next.delete('status');
        next.delete('testOrders');
        next.set('fromCart', '1');
      } else if (v === TEST_ORDERS_STATUS_VALUE) {
        next.delete('status');
        next.delete('fromCart');
        next.set('testOrders', '1');
      } else {
        next.delete('fromCart');
        next.delete('testOrders');
        if (v === 'ALL') next.delete('status');
        else next.set('status', v);
      }
      return next;
    });
  }, [setSearchParams, primeSamePathRefetch]);
  const [selectAllMatchingLoading, setSelectAllMatchingLoading] = useState(false);
  const [selectAllMatchingCapped, setSelectAllMatchingCapped] = useState(false);
  const [selectAllMatchingError, setSelectAllMatchingError] = useState<string | null>(null);
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

  // Move-to-branch modal state + dedicated fetcher.
  const [moveBranchModalOpen, setMoveBranchModalOpen] = useState(false);
  const [moveBranchId, setMoveBranchId] = useState('');
  const moveBranchFetcher = useFetcher<{ succeeded?: number; failed?: number; error?: string }>();
  useFetcherToast(moveBranchFetcher.data, { successMessage: 'Orders moved successfully' });
  useCloseOnFetcherSuccess(moveBranchFetcher, () => {
    setMoveBranchModalOpen(false);
    setMoveBranchId('');
    clearSelection();
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
    // The "Cart abandonment" pseudo-status maps to `?fromCart=1` (and drops
    // `status`); selecting any real status — including ALL — clears `fromCart`
    // so the strip pills always navigate cleanly in and out of the cart view.
    if (overrides.status !== undefined) {
      if (overrides.status === FROM_CART_STATUS_VALUE) {
        params.delete('status');
        params.delete('testOrders');
        params.set('fromCart', '1');
      } else if (overrides.status === TEST_ORDERS_STATUS_VALUE) {
        params.delete('status');
        params.delete('fromCart');
        params.set('testOrders', '1');
      } else {
        params.delete('fromCart');
        params.delete('testOrders');
        if (overrides.status === 'ALL' || !overrides.status) params.delete('status');
        else params.set('status', overrides.status);
      }
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
  // Unprocessed / Confirmed / Delivered. `excludeStatuses` is honoured here too so
  // Sales (which excludes REMITTED — cash remittance is accountant-only) doesn't get
  // a "Cash Remitted" tile the closer can't act on.
  // Pipeline statuses (excluding DELETED — it goes after CR/DR).
  const PIPELINE_KEYS = STATUS_OPTIONS.filter(
    (s) => s !== 'ALL' && !excludeStatuses?.includes(s),
  );
  const pipelineItems = PIPELINE_KEYS.map((status) => ({
    label: STATUS_LABELS[status] ?? formatStatus(status),
    value: statusCounts[status] ?? 0,
    valueClassName: STATUS_TEXT_CLASS[status] ?? 'text-app-fg',
    active: selectedStatus === status,
    onClick: () => handleStatusSelect(status),
  }));
  // Deleted item — placed after rates for logical grouping.
  const deletedItem = !excludeStatuses?.includes('DELETED')
    ? {
        label: 'Deleted',
        value: statusCounts['DELETED'] ?? 0,
        valueClassName: 'text-danger-600 dark:text-danger-400',
        active: selectedStatus === 'DELETED',
        onClick: () => handleStatusSelect('DELETED'),
      }
    : null;

  // CR = confirmed-or-beyond / total orders in period (DELETED excluded)
  // DR = delivered-or-remitted / total orders in period (DELETED excluded)
  // DELETED is an editorial action (test/fake/mistake orders), not a business
  // outcome — it never enters any rate calc.
  const confirmedPlus =
    (statusCounts['CONFIRMED'] ?? 0) +
    (statusCounts['AGENT_ASSIGNED'] ?? 0) +
    (statusCounts['DISPATCHED'] ?? 0) +
    (statusCounts['IN_TRANSIT'] ?? 0) +
    (statusCounts['DELIVERED'] ?? 0) +
    (statusCounts['PARTIALLY_DELIVERED'] ?? 0) +
    (statusCounts['REMITTED'] ?? 0) +
    (statusCounts['RETURNED'] ?? 0) +
    (statusCounts['RESTOCKED'] ?? 0) +
    (statusCounts['WRITTEN_OFF'] ?? 0);
  const deliveredPlus = (statusCounts['DELIVERED'] ?? 0) + (statusCounts['REMITTED'] ?? 0);
  const periodTotalExclDeleted = Object.entries(statusCounts)
    .filter(([k]) => k !== 'DELETED')
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  const confirmationRate =
    periodTotalExclDeleted > 0 ? (confirmedPlus / periodTotalExclDeleted) * 100 : 0;
  const deliveryRate =
    periodTotalExclDeleted > 0 ? (deliveredPlus / periodTotalExclDeleted) * 100 : 0;

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('Customer not picking');

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkAction(null);
    setBulkResult(null);
    setSelectAllMatchingActive(false);
    setSelectAllMatchingCapped(false);
    setSelectAllMatchingError(null);
  };

  // Reset the deep-select state whenever the filter changes — the previously
  // fetched ID set no longer matches the new filter, so keeping it active
  // would let bulk actions hit orders the user can no longer see.
  useEffect(() => {
    if (selectAllMatchingActive) {
      setSelectedIds(new Set());
      setSelectAllMatchingActive(false);
      setSelectAllMatchingCapped(false);
      setSelectAllMatchingError(null);
    }
    // Intentionally narrow deps to the URL string — covers status, search,
    // dates, schedule filters, pagination, etc. in one shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()]);

  async function selectAllMatchingFilter() {
    if (!bulkSelectAllMatchingInput) return;
    setSelectAllMatchingLoading(true);
    setSelectAllMatchingError(null);
    try {
      const { ids, capped } = await fetchOrdersMatchingIds(bulkSelectAllMatchingInput);
      if (ids.length === 0) {
        setSelectAllMatchingError('Could not load matching orders. Try again.');
        return;
      }
      setSelectedIds(new Set(ids));
      setSelectAllMatchingActive(true);
      setSelectAllMatchingCapped(capped);
    } catch {
      setSelectAllMatchingError('Could not load matching orders. Try again.');
    } finally {
      setSelectAllMatchingLoading(false);
    }
  }

  // Determine what bulk transitions are available based on selected orders
  const selectedOrders = filteredOrders.filter((o) => selectedIds.has(o.id));
  const selectedStatuses = [...new Set(selectedOrders.map((o) => o.status))];
  const singleStatus = selectedStatuses[0];
  const availableTransitions = selectedStatuses.length === 1 && singleStatus !== undefined
    ? BULK_TRANSITIONS[singleStatus] ?? []
    : [];

  // Tooltip copy for the deep-select info icon — replaces the verbose helper
  // lines that used to sit under the "Select all matching" checkbox.
  const deepSelectInfoTitle = selectAllMatchingActive
    ? `Bulk actions will affect all ${selectedIds.size.toLocaleString()} selected orders.${
        selectedIds.size > filteredOrders.length
          ? ` ${(selectedIds.size - filteredOrders.length).toLocaleString()} are not visible on this page.`
          : ''
      }${
        selectAllMatchingCapped
          ? ` Capped at ${ORDERS_DEEP_SELECT_MAX} of ${total.toLocaleString()} matching.`
          : ''
      }`
    : `Selects every order matching the current filter.${
        total > ORDERS_DEEP_SELECT_MAX
          ? ` Capped at ${ORDERS_DEEP_SELECT_MAX} — to process more, narrow the filter or run the action again.`
          : ''
      }`;

  // Mobile tools-sheet chrome — every option sits in the same boxed, centered,
  // grey (app-hover) row at one shared height so the sheet reads consistently.
  const mobileFilterBoxClass =
    'flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5';
  const mobileSelectTransparent = '!bg-transparent !border-transparent !text-center';

  // Smart pick + deep-select toolbar — shared between the desktop inline card
  // and the mobile Smart-pick modal (opened from the tools sheet).
  function renderSmartPickToolbar() {
    if (!canBulkPick || isCartAbandonmentView || filteredOrders.length === 0) return null;
    // Smart pick operates over the FULL filter, not just the current page, so
    // picking 50 of 179 unassigned isn't silently clamped to the 20 visible on
    // the page. Server bulk-action cap is `ORDERS_DEEP_SELECT_MAX` (100), so
    // that's the hard ceiling we expose.
    const smartPickCeiling = Math.min(total, ORDERS_DEEP_SELECT_MAX);
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <SmartPick
          total={smartPickCeiling}
          selectedCount={selectedIds.size}
          onPick={async (count) => {
            // Fast path: requested count fits on the current page — slice locally.
            if (count <= filteredOrders.length) {
              if (selectAllMatchingActive) {
                setSelectAllMatchingActive(false);
                setSelectAllMatchingCapped(false);
              }
              setSelectedIds(new Set(filteredOrders.slice(0, count).map((o) => o.id)));
              return;
            }
            // Cross-page path: fetch matching IDs from the server (same authz
            // and scope as the visible list), then slice to the requested count.
            if (!bulkSelectAllMatchingInput) {
              setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
              return;
            }
            setSelectAllMatchingLoading(true);
            setSelectAllMatchingError(null);
            try {
              const { ids, capped } = await fetchOrdersMatchingIds(bulkSelectAllMatchingInput);
              if (ids.length === 0) {
                setSelectAllMatchingError('Could not load matching orders. Try again.');
                return;
              }
              const picked = ids.slice(0, count);
              setSelectedIds(new Set(picked));
              setSelectAllMatchingActive(true);
              setSelectAllMatchingCapped(capped && count >= ids.length);
            } catch {
              setSelectAllMatchingError('Could not load matching orders. Try again.');
            } finally {
              setSelectAllMatchingLoading(false);
            }
          }}
          onClear={clearSelection}
          itemNoun="orders"
        />
        {canBulkAction && bulkSelectAllMatchingInput && total > 0 && (
          <label className="flex items-center gap-1.5 text-sm">
            <Checkbox
              checked={selectAllMatchingActive}
              disabled={selectAllMatchingLoading}
              onChange={(e) => {
                if (e.target.checked) selectAllMatchingFilter();
                else clearSelection();
              }}
            />
            <span className="font-medium text-app-fg">
              {selectAllMatchingActive
                ? `${selectedIds.size.toLocaleString()} selected across filter`
                : `Select all ${total.toLocaleString()} matching`}
            </span>
            <span
              className="inline-flex shrink-0 text-app-fg-muted"
              title={deepSelectInfoTitle}
              aria-label={deepSelectInfoTitle}
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            {selectAllMatchingLoading && (
              <span className="text-xs text-app-fg-muted">Loading…</span>
            )}
          </label>
        )}
        {selectAllMatchingError && (
          <p className="w-full text-xs text-danger-600 dark:text-danger-400">
            {selectAllMatchingError}
          </p>
        )}
      </div>
    );
  }

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
    if (newStatus === 'DELETED') {
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
      actionLabel: 'deleting selected orders',
      onProceed: () =>
        fetcher.submit(
          {
            intent: 'bulkTransition',
            orderIds: JSON.stringify([...selectedIds]),
            newStatus: 'DELETED',
            reason: cancelReason,
          },
          { method: 'post' },
        ),
    });
  };

  // Bulk transition / assign / cancel act on orders — disabled entirely in the
  // cart-abandonment view, where the rows are carts, not orders.
  const canBulkAction =
    !isCartAbandonmentView &&
    (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'HEAD_OF_CS' || userRole === 'HEAD_OF_LOGISTICS' || userRole === 'STOCK_MANAGER');

  const ordersListColumns = useMemo((): CompactTableColumn<Order>[] => {
    const cols: CompactTableColumn<Order>[] = [
      {
        key: 'orderId',
        header: 'Order ID',
        render: (order) => <OrderIdBadge id={order.id} orderNumber={order.orderNumber} linkTo={toOrderDetail(order.id)} />,
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (order) => (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-medium text-app-fg">
              {order.customerName}
              {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
              )}
            </span>
            {isPreferredDeliveryDueToday(order.preferredDeliveryDate, order.status) ? <DueTodayTag /> : null}
            {isPreferredDeliveryOverdue(order.preferredDeliveryDate, order.status) ? <OverdueTag /> : null}
            {isCallbackDue(order.callbackScheduledAt, order.status) ? <CallbackDueTag /> : null}
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
        render: (order) =>
          order.status === 'CART' ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Cart
            </span>
          ) : (
            <OrderStatusBadge status={order.status} />
          ),
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
        // Abandoned-cart rows (cart-abandonment view) get "View cart" — the quick
        // cart-detail modal. Real orders get the plain "View" → order detail.
        render: (order) =>
          order.status === 'CART' ? (
            <TableActionButton
              variant="primary"
              onClick={() => openCartDetail(order)}
              disabled={cartDetailFetcher.state !== 'idle' && viewCartOrderId === order.id}
            >
              View cart
            </TableActionButton>
          ) : (
            <div className="inline-flex flex-nowrap items-center justify-center gap-1.5">
              {ORDER_STATUSES_WITH_COPY_ACTION.has(order.status) && (
                <TableActionButton
                  variant="neutral"
                  onClick={async () => {
                    try {
                      const { text } = await fetchOrderClipboardSummary(order.id);
                      await navigator.clipboard.writeText(text);
                      toast.success('Copied', 'Order summary copied to clipboard.');
                    } catch (e) {
                      toast.error('Copy failed', e instanceof Error ? e.message : 'Could not copy order summary.');
                    }
                  }}
                >
                  Copy
                </TableActionButton>
              )}
              <TableActionButton to={toOrderDetail(order.id)} variant="primary">
                View
              </TableActionButton>
            </div>
          ),
      },
    );
    return cols;
  }, [
    showCSCloserColumn,
    showCampaignColumn,
    toOrderDetail,
    openCartDetail,
    cartDetailFetcher.state,
    viewCartOrderId,
    toast,
  ]);

  // Mobile card — deliberately minimal: customer name + order ID on the first
  // row, status + created time on the second. The default CompactTable card
  // stacked every column as label:value, which is too noisy on a phone. The
  // whole card is a tap target → order detail (or the cart-detail modal for
  // abandoned-cart rows). When bulk selection is active the checkbox sits in
  // its own row above the link (matching CompactTable's default) so the link
  // never wraps an interactive control.
  const renderOrderMobileCard = useCallback(
    (order: Order, _index: number, helpers: CompactTableMobileCardHelpers<Order>) => {
      const isCart = order.status === 'CART';
      const hasTags =
        isPreferredDeliveryDueToday(order.preferredDeliveryDate, order.status) ||
        isPreferredDeliveryOverdue(order.preferredDeliveryDate, order.status) ||
        isCallbackDue(order.callbackScheduledAt, order.status);
      const body = (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-app-fg">
              {order.customerName || '—'}
              {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
              )}
            </span>
            <OrderIdBadge id={order.id} orderNumber={order.orderNumber} textClassName="text-sm font-medium text-app-fg" />
          </div>
          <div className="flex items-center justify-between gap-2">
            {isCart ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Cart
              </span>
            ) : (
              <OrderStatusBadge status={order.status} />
            )}
            <span className="whitespace-nowrap text-xs text-app-fg-muted">
              {formatOrderTimestamp(order.createdAt)}
            </span>
          </div>
          {hasTags ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {isPreferredDeliveryDueToday(order.preferredDeliveryDate, order.status) ? <DueTodayTag /> : null}
              {isPreferredDeliveryOverdue(order.preferredDeliveryDate, order.status) ? <OverdueTag /> : null}
              {isCallbackDue(order.callbackScheduledAt, order.status) ? <CallbackDueTag /> : null}
            </div>
          ) : null}
        </>
      );

      const tappable = isCart ? (
        <button
          type="button"
          onClick={() => openCartDetail(order)}
          className="block w-full space-y-1.5 text-left"
        >
          {body}
        </button>
      ) : (
        <Link to={toOrderDetail(order.id)} className="block space-y-1.5">
          {body}
        </Link>
      );

      if (helpers.rowSelection) {
        return (
          <div>
            <div className="mb-2 flex justify-end border-b border-app-border/80 pb-2">
              {helpers.rowSelection}
            </div>
            {tappable}
          </div>
        );
      }
      // No selection — let the link bleed to the card edges for a bigger tap target.
      return <div className="-mx-3 -my-2.5 px-3 py-2.5">{tappable}</div>;
    },
    [toOrderDetail, openCartDetail],
  );

  const statusOptions = [
    ...STATUS_OPTIONS.filter((status) => !excludeStatuses?.includes(status)).map((status) => ({
      value: status,
      label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
    })),
    // "Deleted" tab — soft-removed orders excluded from all metrics/counts.
    // CEO directive 2026-05-23: DELETED replaces the old CANCELLED flow.
    // Row stays in DB; Admin/SuperAdmin can restore. Migration 0153.
    ...(!excludeStatuses?.includes('DELETED')
      ? [{ value: 'DELETED', label: 'Deleted' }]
      : []),
    ...(enableFromCartStatusOption
      ? [{ value: FROM_CART_STATUS_VALUE, label: 'Cart abandonment' }]
      : []),
    ...(enableTestOrdersOption
      ? [{ value: TEST_ORDERS_STATUS_VALUE, label: 'Test orders' }]
      : []),
  ];

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

  // `boxed` → the mobile tools-sheet variant: same boxed/centered/grey chrome
  // as the other sheet filters. Plain inline layout for the desktop filter row.
  function renderScheduleFilter(boxed: boolean) {
    if (!scheduleFilters) return null;
    // Inline the picked date into the schedule label so we don't need a
    // separate date pill next to the dropdown. The calendar still opens
    // on selection (always — including Overdue) so a fresh date can be
    // chosen any time by re-selecting the same option.
    const formattedScheduleDate = scheduleFilters.scheduleDate
      ? new Date(scheduleFilters.scheduleDate).toLocaleDateString('en-NG', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      : null;
    const deliveryOnDayLabel =
      scheduleSelectValue === 'delivery_on_day' && formattedScheduleDate
        ? `Deliveries on ${formattedScheduleDate}`
        : 'Deliveries (on date)';
    const callbackOnDayLabel =
      scheduleSelectValue === 'callback_on_day' && formattedScheduleDate
        ? `Callbacks on ${formattedScheduleDate}`
        : 'Callbacks (on date)';
    const select = (
      <FormSelect
        aria-label="Filter by schedule"
        value={scheduleSelectValue}
        placeholder="Schedule"
        onChange={(e) => {
          setSelectedIds(new Set());
          setBulkResult(null);
          const v = e.target.value;
          applyScheduleKind(v);
          // All three date-aware options now open the calendar so users
          // can pick / change the date inline. Overdue is date-less in
          // the URL today, but opening the calendar still lets them
          // see the heat map at a glance.
          if (v === 'delivery_on_day' || v === 'callback_on_day' || v === 'delivery_overdue') {
            setScheduleCalendarModalOpen(true);
          }
        }}
        options={[
          { value: '', label: 'All schedules' },
          { value: 'delivery_on_day', label: deliveryOnDayLabel },
          { value: 'callback_on_day', label: callbackOnDayLabel },
          { value: 'delivery_overdue', label: 'Overdue (undelivered)' },
        ]}
        controlSize={boxed ? 'sm' : undefined}
        openAs={boxed ? 'modal' : undefined}
        wrapperClassName={boxed ? 'w-full' : 'w-full min-w-0 sm:w-52'}
        className={boxed ? mobileSelectTransparent : undefined}
      />
    );
    if (boxed) {
      return <div className={mobileFilterBoxClass}>{select}</div>;
    }
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
        <div className="flex min-w-0 flex-col gap-1 sm:flex-1">{select}</div>
      </div>
    );
  }

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

      {/* Page header — Live tag sits directly in front of the refresh button per Sales request. */}
      <PageHeader
        title={isCSCloser ? 'My Orders' : 'Sales Orders'}
        mobileInlineActions
        description={isCSCloser ? 'Track your assigned orders' : 'Manage and track all customer orders'}
        actions={
          <PageHeaderMobileTools
              sheetTitle="Sales orders tools"
              sheetSubtitle={<span>Chart, offline order, and export</span>}
              triggerAriaLabel="Sales orders toolbar"
              filtersBadgeCount={ordersListToolbarFilterBadge}
              filters={
                <>
                  {renderScheduleFilter(true)}
                  <div className={mobileFilterBoxClass}>
                    <FormSelect
                      value={selectedStatus}
                      onChange={(e) => handleStatusSelect(e.target.value)}
                      options={statusOptions}
                      controlSize="sm"
                      openAs="modal"
                      wrapperClassName="w-full"
                      className={mobileSelectTransparent}
                    />
                  </div>
                  {showCSCloserColumn && ((csClosersForFilter?.length ?? 0) > 0 || deferredLoading) ? (
                    <div className={mobileFilterBoxClass}>
                      {deferredLoading && !(csClosersForFilter?.length) ? (
                        <div className="h-5 w-32 rounded-md bg-app-border/70 animate-pulse" aria-hidden />
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
                          controlSize="sm"
                          wrapperClassName="w-full"
                          triggerClassName={mobileSelectTransparent}
                          placeholder="All closers"
                          searchPlaceholder="Search closers..."
                        />
                      )}
                    </div>
                  ) : null}
                  {(productsForFilter?.length ?? 0) > 0 ? (
                    <div className={mobileFilterBoxClass}>
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
                        controlSize="sm"
                        wrapperClassName="w-full"
                        triggerClassName={mobileSelectTransparent}
                        placeholder="All products"
                        searchPlaceholder="Search products..."
                      />
                    </div>
                  ) : null}
                  {showCampaignColumn && (campaignsForFilter?.length ?? 0) > 0 ? (
                    <div className={mobileFilterBoxClass}>
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
                        controlSize="sm"
                        wrapperClassName="w-full"
                        triggerClassName={mobileSelectTransparent}
                        placeholder="All forms"
                        searchPlaceholder="Search forms..."
                      />
                    </div>
                  ) : null}
                </>
              }
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
                {!isCartAbandonmentView && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowChartView((v) => !v)}>
                    {showChartView ? 'View as data' : 'View data in chart'}
                  </Button>
                )}
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
                {isTestOrdersView && (
                  <Button variant="danger" size="sm" onClick={() => setPurgeConfirmOpen(true)} disabled={purgeFetcher.state !== 'idle'}>
                    Delete all test orders
                  </Button>
                )}
                {!isCartAbandonmentView && (
                  <div className="flex shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                    <DateFilterBar
                      startDate={filters?.startDate ?? ''}
                      endDate={filters?.endDate ?? ''}
                      startTime={filters?.startTime ?? ''}
                      endTime={filters?.endTime ?? ''}
                      periodAllTime={filters?.periodAllTime ?? false}
                    />
                  </div>
                )}
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                {!isCartAbandonmentView && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowChartView((v) => !v);
                    }}
                  >
                    {showChartView ? 'View as data' : 'View data in chart'}
                  </Button>
                )}
                {canCreateOffline && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
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
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setShowExportModal(true);
                    }}
                  >
                    Generate report
                  </Button>
                )}
                {isTestOrdersView && (
                  <Button
                    variant="danger"
                    size="sm"
                    className="h-12 w-full justify-center"
                    disabled={purgeFetcher.state !== 'idle'}
                    onClick={() => {
                      closeSheet();
                      setPurgeConfirmOpen(true);
                    }}
                  >
                    Delete all test orders
                  </Button>
                )}
                {canBulkPick && !isCartAbandonmentView && filteredOrders.length > 0 && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-12 w-full justify-center"
                    onClick={() => {
                      closeSheet();
                      setSmartPickModalOpen(true);
                    }}
                  >
                    Smart pick{selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ''}
                  </Button>
                )}
              </>
            )}
            />
        }
      />

      {!isCartAbandonmentView && (
        <MobileDateFilterRow
          startDate={filters?.startDate ?? ''}
          endDate={filters?.endDate ?? ''}
          startTime={filters?.startTime ?? ''}
          endTime={filters?.endTime ?? ''}
          periodAllTime={filters?.periodAllTime ?? false}
        />
      )}

      {/* Status totals — moved above My Workload so the funnel snapshot reads first.
          For HoCS+ the strip leads with a "Cart abandonment" KPI (open un-recovered
          carts) so the recovery backlog is visible without opening the filter. */}
      {deferredLoading && Object.keys(statusCounts).length === 0 ? (
        <OverviewStatStripSkeleton
          count={1 + PIPELINE_KEYS.length + (enableFromCartStatusOption ? 1 : 0) + 3}
        />
      ) : (
        // One strip in every mode — the order funnel snapshot stays put when you
        // drill into the cart-abandonment view, so you can jump straight back to
        // any status. The "Cart abandonment" tile is the clickable entry point.
        <OverviewStatStrip
          mobileGrid
          items={[
            {
              label: 'Total',
              // Always derive from statusCounts (the source of truth) so
              // search/filter changes don't make the overview strip fluctuate.
              value: Object.entries(statusCounts)
                .filter(([k]) => k !== 'DELETED')
                .reduce((sum, [, n]) => sum + (n || 0), 0),
              valueClassName: 'text-app-fg',
              active: selectedStatus === 'ALL',
              onClick: () => handleStatusSelect('ALL'),
            },
            ...pipelineItems,
            {
              label: 'CR',
              value: `${confirmationRate.toFixed(1)}%`,
              valueClassName: confirmationRateColorClass(confirmationRate),
              title: 'Confirmation Rate — confirmed / (confirmed + deleted)',
            },
            {
              label: 'DR',
              value: `${deliveryRate.toFixed(1)}%`,
              valueClassName: deliveryRateColorClass(deliveryRate),
              title: 'Delivery Rate — delivered / confirmed',
            },
            ...(enableFromCartStatusOption
              ? [
                  {
                    label: 'Cart abandonment',
                    value: cartAbandonmentCount ?? 0,
                    valueClassName:
                      (cartAbandonmentCount ?? 0) > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-app-fg',
                    title: 'Open abandoned carts not yet recovered',
                    onClick: () => handleStatusSelect(FROM_CART_STATUS_VALUE),
                    active: selectedStatus === FROM_CART_STATUS_VALUE,
                  },
                ]
              : []),
            ...(deletedItem ? [deletedItem] : []),
          ]}
        />
      )}

      {/* My workload (Sales closer only) */}
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
                <p className="text-mini text-app-fg-muted mt-0.5">Pipeline backlog: {myWorkload.pendingCount}</p>
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
                  Assign to Sales
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
              {/* Move to branch — Admin / HoCS only, when branches are available. */}
              {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'HEAD_OF_CS') && branchesForMove && branchesForMove.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setMoveBranchModalOpen(true)} disabled={isSubmitting}>
                  Move to branch
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

      {/* Move to Branch Modal */}
      <Modal
        open={moveBranchModalOpen}
        onClose={() => { setMoveBranchModalOpen(false); setMoveBranchId(''); }}
        maxWidth="max-w-sm"
        contentClassName="p-6 space-y-4"
      >
        <h3 className="text-lg font-semibold text-app-fg">Move orders to branch</h3>
        <p className="text-sm text-app-fg-muted">
          {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} will be moved to the selected branch. Status will reset to Unprocessed.
        </p>
        <SearchableSelect
          id="move-branch-select"
          label="Destination branch"
          value={moveBranchId}
          onChange={(v) => setMoveBranchId(v)}
          options={(branchesForMove ?? []).map((b) => ({ value: b.id, label: b.name }))}
          placeholder="Select branch"
          searchPlaceholder="Search branches…"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => { setMoveBranchModalOpen(false); setMoveBranchId(''); }}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!moveBranchId || moveBranchFetcher.state === 'submitting'}
            loading={moveBranchFetcher.state === 'submitting'}
            loadingText="Moving…"
            onClick={() => {
              moveBranchFetcher.submit(
                { intent: 'moveOrdersToBranch', orderIds: JSON.stringify([...selectedIds]), targetBranchId: moveBranchId },
                { method: 'post' },
              );
            }}
          >
            Move {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </Modal>

      <div className="list-panel">
        <ToolbarFiltersCollapsible
          className="!border-0"
          hideMobileSheet
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
                  onChange={(e) => handleStatusSelect(e.target.value)}
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
          desktopInlineFilters={renderScheduleFilter(false)}
          sheetFilterBody={null}
        />
      </div>

      {/* Smart pick + deep-select. Desktop: inline card under the filters.
          Mobile: hidden here — it lives in the tools sheet and opens its own
          Smart-pick modal. SmartPick picks the first N of the current page;
          the deep-select checkbox selects every order matching the filter
          (capped server-side at ORDERS_DEEP_SELECT_MAX). */}
      {canBulkPick && !isCartAbandonmentView && filteredOrders.length > 0 && (
        <div
          className={`hidden md:block rounded-lg border px-3 py-2 ${
            selectAllMatchingActive
              ? 'border-warning-400 bg-warning-50 dark:border-warning-700 dark:bg-warning-900/20'
              : 'border-app-border bg-app-elevated'
          }`}
        >
          {renderSmartPickToolbar()}
        </div>
      )}

      {/* Mobile Smart-pick modal — opened from the tools sheet. */}
      <Modal
        open={smartPickModalOpen}
        onClose={() => setSmartPickModalOpen(false)}
        maxWidth="max-w-lg"
      >
        <div className="space-y-4 p-5">
          <div>
            <h3 className="text-base font-semibold text-app-fg">Smart pick</h3>
            <p className="mt-0.5 text-sm text-app-fg-muted">
              Select a batch of orders for bulk actions.
            </p>
          </div>
          {renderSmartPickToolbar()}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setSmartPickModalOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

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
            scopeLabel="Sales orders"
            dailyCounts={dailyCounts}
          />
        )
      ) : (
      <TableLoadingOverlay show={isLoaderRefetchBusy}>
        <div className="list-panel">
          <CompactTable<Order>
            withCard={false}
            columns={ordersListColumns}
            rows={filteredOrders}
            rowKey={(o) => o.id}
            renderMobileCard={renderOrderMobileCard}
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
                      // Any per-row toggle exits deep-select mode — the user
                      // is now picking individually, not "all matching".
                      if (selectAllMatchingActive) {
                        setSelectAllMatchingActive(false);
                        setSelectAllMatchingCapped(false);
                      }
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (selected) next.add(id);
                        else next.delete(id);
                        return next;
                      });
                    },
                    onToggleAll: (selectAll) => {
                      if (selectAllMatchingActive) {
                        setSelectAllMatchingActive(false);
                        setSelectAllMatchingCapped(false);
                      }
                      if (selectAll) setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
                      else setSelectedIds(new Set());
                    },
                  }
                : undefined
            }
            emptyTitle={
              isCartAbandonmentView
                ? 'No abandoned carts'
                : orders.length === 0
                  ? 'No orders yet'
                  : 'No orders found'
            }
            emptyDescription={
              isCartAbandonmentView
                ? 'Every dropped cart has been recovered or cleared.'
                : orders.length === 0
                  ? undefined
                  : 'Try adjusting your filters or search query'
            }
          />
        </div>
      </TableLoadingOverlay>
      )}

      {/* Pagination — table view only; the chart view doesn't paginate. */}
      {!showChartView && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {(() => {
              const noun = isCartAbandonmentView ? 'carts' : 'orders';
              return total > 0
                ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} ${noun}`
                : `No ${noun}`;
            })()}
          </p>
          <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} />
        </div>
      )}

      {/* Bulk cancel confirmation modal */}
      {cancelModalOpen && (
        <Modal open onClose={() => { setCancelModalOpen(false); setCancelReason(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">
              Delete {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}?
            </h3>
            <p className="text-sm text-app-fg-muted mb-3">
              Please provide a reason (at least 10 characters). Deleted orders are removed from metrics but stay in the database.
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
              placeholder="Enter deletion reason..."
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
                loadingText="Deleting..."
                onClick={submitBulkCancel}
              >
                Delete {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}
              </Button>
            </div>
        </Modal>
      )}

      {/* Bulk assign / reassign to Sales — checkbox list + random split (matches Sales queue) */}
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

      {purgeConfirmOpen && (
        <Modal open onClose={() => { if (purgeFetcher.state === 'idle') setPurgeConfirmOpen(false); }} maxWidth="max-w-sm" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-2">Delete all test orders</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            This will delete all orders where the customer name contains &ldquo;test&rdquo;. Deleted orders are removed from metrics but stay in the database. Pre-confirmation and cancelled orders are affected &mdash; stock-moved orders are skipped.
          </p>
          {purgeFetcher.state === 'idle' && purgeFetcher.data ? (
            <div className="mb-4">
              {purgeFetcher.data.success ? (
                <div className="rounded-lg border border-success-300 bg-success-50 dark:border-success-700 dark:bg-success-900/20 px-4 py-3">
                  <p className="text-sm font-semibold text-success-700 dark:text-success-300">
                    {purgeFetcher.data.deleted ?? 0} test order{(purgeFetcher.data.deleted ?? 0) !== 1 ? 's' : ''} deleted
                  </p>
                  {(purgeFetcher.data.skipped ?? 0) > 0 && (
                    <p className="text-xs text-success-600 dark:text-success-400 mt-0.5">
                      {purgeFetcher.data.skipped} skipped (stock already moved)
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-danger-300 bg-danger-50 dark:border-danger-700 dark:bg-danger-900/20 px-4 py-3">
                  <p className="text-sm font-semibold text-danger-700 dark:text-danger-300">
                    {purgeFetcher.data.error ?? 'Failed to delete test orders'}
                  </p>
                </div>
              )}
            </div>
          ) : null}
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setPurgeConfirmOpen(false)} disabled={purgeFetcher.state !== 'idle'}>
              {purgeFetcher.data?.success ? 'Done' : 'Cancel'}
            </Button>
            {!purgeFetcher.data?.success && (
              <Button
                variant="danger"
                disabled={purgeFetcher.state !== 'idle'}
                loading={purgeFetcher.state !== 'idle'}
                loadingText="Deleting..."
                onClick={() => {
                  purgeFetcher.submit({ intent: 'purgeTestOrders' }, { method: 'post' });
                }}
              >
                Delete all test orders
              </Button>
            )}
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

      <AbandonedCartDetailModal
        cart={
          viewCartOrderId && cartDetailFetcher.state === 'idle'
            ? cartDetailFetcher.data?.cart ?? null
            : null
        }
        canReveal
        cartStatus="ABANDONED"
        onClose={() => setViewCartOrderId(null)}
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
              cartAbandonmentCount={sec.cartAbandonmentCount}
            />
          )}
        </Await>
      </Suspense>
    );
  }
  return <OrdersListPageImpl {...props} />;
}
