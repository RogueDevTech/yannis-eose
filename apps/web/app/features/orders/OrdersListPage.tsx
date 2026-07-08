import { Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Await, Link, useFetcher, useRevalidator, useSearchParams } from '@remix-run/react';
import { clipName } from '~/lib/clip-name';
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
import { OverviewStatStrip, OverviewStatStripSkeleton, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
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
import { useLiveIndicator, useSocketEvent } from '~/hooks/useSocket';
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
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { ScheduleHeatCalendar } from '~/components/ui/schedule-heat-calendar';
import type { ScheduleHeatDay } from '~/components/ui/schedule-heat-calendar';
import { fetchOrdersMatchingIds, fetchOrderClipboardSummary, ORDERS_DEEP_SELECT_MAX } from '~/lib/trpc-browser';
import { useToast } from '~/components/ui/toast';
import { CsCommentIcon, MobileCommentPreview } from '~/components/ui/cs-comment-icon';
import { BulkProgressModal, BULK_PROGRESS_IDLE, type BulkProgressState } from '~/components/ui/bulk-progress-modal';

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
  productsForFilter?: Array<{ id: string; name: string }>;
  offlineCount: number;
  cartAbandonmentCount: number;
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

/** Comment icon shown before customer name when the order has a CS comment.
 *  Desktop: hovering shows the comment in a tooltip-style popup.
 *  The icon itself is always small (14×14) and inline. */
// CsCommentIcon + MobileCommentPreview imported from ~/components/ui/cs-comment-icon

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
  sortBy?: string;
  sortOrder?: string;
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
  /** Active frozen filter from URL: 'frozen' | 'active' | undefined. */
  frozenFilter?: string;
  /** Permission-driven (orders.freeze) — controls Freeze / Unfreeze bulk action visibility. */
  canFreeze?: boolean;
  /** When true, show "Create offline order" button (CS_CLOSER / HEAD_OF_CS). */
  canCreateOffline?: boolean;
  /** When true, show "Import orders" link (SuperAdmin only). */
  canImportOrders?: boolean;
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
  /** tRPC endpoint for deep-select. Defaults to `orders.list`. Pass `orders.followUpOrdersList` for follow-up surfaces. */
  bulkSelectEndpoint?: string;
  /** When true, hides SmartPick presets but keeps the "Select all matching" checkbox. */
  hideSmartPickPresets?: boolean;
  /**
   * When true, bulk actions (move, transition) use server-side per-item
   * processing with WebSocket progress instead of the Remix action fetcher.
   * Required for follow-up orders which use dedicated tRPC mutations.
   */
  bulkMovePerItem?: boolean;
  /** Sales orders route — streams counts, chart data, heat, and bulk-action picklists after the list paints. */
  deferredSecondary?: Promise<CsOrdersDeferredSecondary>;
  /**
   * Sales orders route — adds a "Cart abandonment" pseudo-option to the status
   * filter dropdown and makes the "Open carts" stat tile clickable.
   */
  enableFromCartStatusOption?: boolean;
  /** True when `?fromCart=1` is active — table shows abandoned carts instead of orders. */
  isCartAbandonmentView?: boolean;
  /** Show "Test orders" filter option. Admin only. */
  enableTestOrdersOption?: boolean;
  offlineCount?: number;
  cartAbandonmentCount?: number;
  /** Branches available for the "Move to branch" bulk action (Admin/HoCS only). */
  branchesForMove?: Array<{ id: string; name: string }>;
  /** Override the default page title ("Sales Orders" / "My Orders"). */
  pageTitle?: string;
  /** Override the default page description. */
  pageDescription?: string;
  /** Override the default back-to link. */
  backTo?: string;
  /** Override the base path for order detail links (default: '/admin/orders'). */
  detailBasePath?: string;
  /** Hide Offline + Open carts stat tiles (follow-up surface — always zero). */
  hideOfflineAndCartStats?: boolean;
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
  sortBy: sortByProp = 'createdAt',
  sortOrder: sortOrderProp = 'desc',
  filters,
  userRole,
  canBulkPick = false,
  isCSCloser = false,
  showCSCloserColumn = false,
  showCampaignColumn = false,
  campaignFilter,
  productFilter,
  frozenFilter: frozenFilterProp,
  canFreeze = false,
  campaignsForFilter,
  productsForFilter,
  csClosersForFilter,
  logisticsLocationsForBulk = [],
  canAssignDirectly = false,
  currentUserId = '',
  myWorkload = null,
  liveEvents,
  canCreateOffline = false,
  canImportOrders = false,
  canExport = false,
  productsForOfflineOrder = [],
  dailyCounts,
  scheduleHeat,
  scheduleFilters,
  orderDetailFrom = 'cs',
  deferredLoading = false,
  enableFromCartStatusOption = false,
  isCartAbandonmentView = false,
  enableTestOrdersOption = false,
  offlineCount = 0,
  cartAbandonmentCount = 0,
  bulkSelectAllMatchingInput,
  bulkSelectEndpoint,
  hideSmartPickPresets = false,
  bulkMovePerItem = false,
  branchesForMove,
  pageTitle,
  pageDescription,
  backTo,
  detailBasePath,
  hideOfflineAndCartStats = false,
}: OrdersListPageImplProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const toOrderDetail = useCallback(
    (orderId: string) => orderDetailHref(detailBasePath ?? '/admin/orders', orderId, orderDetailFrom ?? undefined),
    [orderDetailFrom, detailBasePath],
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
  const TEST_ORDERS_STATUS_VALUE = '__test_orders__';
  const OFFLINE_STATUS_VALUE = '__offline__';
  const FROM_CART_STATUS_VALUE = '__from_cart__';
  const testOrdersUrlActive = searchParams.get('testOrders') === '1';
  const offlineUrlActive = searchParams.get('orderSource') === 'offline';
  const fromCartUrlActive = searchParams.get('fromCart') === '1';
  const initialSelectedStatus =
    enableFromCartStatusOption && fromCartUrlActive
      ? FROM_CART_STATUS_VALUE
      : offlineUrlActive
        ? OFFLINE_STATUS_VALUE
        : enableTestOrdersOption && testOrdersUrlActive
          ? TEST_ORDERS_STATUS_VALUE
          : statusFilter || 'ALL';
  const [selectedStatus, setSelectedStatus] = useState(initialSelectedStatus);
  // Sync selectedStatus when URL params change (e.g. remount after loader revalidation)
  useEffect(() => {
    const synced = enableFromCartStatusOption && fromCartUrlActive
      ? FROM_CART_STATUS_VALUE
      : offlineUrlActive
        ? OFFLINE_STATUS_VALUE
        : enableTestOrdersOption && testOrdersUrlActive
          ? TEST_ORDERS_STATUS_VALUE
          : statusFilter || 'ALL';
    setSelectedStatus(synced);
  }, [statusFilter, offlineUrlActive, testOrdersUrlActive, enableTestOrdersOption, fromCartUrlActive, enableFromCartStatusOption]);
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
      cartDetailFetcher.load(`/admin/sales/cart-detail?cartId=${order.cartId}`);
    },
    [cartDetailFetcher],
  );

  // Sync URL params to local state when loader data changes (e.g. back/forward)
  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

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
        next.delete('orderSource');
        next.set('fromCart', '1');
      } else if (v === TEST_ORDERS_STATUS_VALUE) {
        next.delete('status');
        next.delete('orderSource');
        next.delete('fromCart');
        next.set('testOrders', '1');
      } else if (v === OFFLINE_STATUS_VALUE) {
        next.delete('status');
        next.delete('testOrders');
        next.delete('fromCart');
        next.set('orderSource', 'offline');
      } else {
        next.delete('testOrders');
        next.delete('orderSource');
        next.delete('fromCart');
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
  // Bulk move with server-side processing + WebSocket progress (follow-up surfaces).
  const [bulkMoveProgress, setBulkMoveProgress] = useState<BulkProgressState>(BULK_PROGRESS_IDLE);
  const { revalidate } = useRevalidator();
  useSocketEvent<BulkProgressState>('bulk:progress', useCallback((data: BulkProgressState) => {
    setBulkMoveProgress(data);
    if (data.status === 'complete' || data.status === 'error') {
      revalidate();
    }
  }, [revalidate]));

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
      if (overrides.status === TEST_ORDERS_STATUS_VALUE) {
        params.delete('status');
        params.set('testOrders', '1');
      } else {
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
  // When REMITTED is excluded (CS/Marketing view), merge its count into DELIVERED
  // so the "Delivered" pill shows the combined total.
  // Six-bucket collapse (CEO 2026-05-10): when the strip uses the default
  // STATUS_OPTIONS set (no AGENT_ASSIGNED / DISPATCHED / IN_TRANSIT pill), roll
  // those sub-stages into the Confirmed pill — they're "post-confirmation, in
  // flight" and the dashboard already counts them under Confirmed. Without the
  // rollup an order in IN_TRANSIT inflates Total but isn't reflected in any pill,
  // so the strip looks inconsistent (Total = pill-sum + sub-stage orphans).
  const remittedMergedIntoDelivered = excludeStatuses?.includes('REMITTED') ?? false;
  const isCloserRole = userRole === 'CS_CLOSER';
  const PIPELINE_KEYS = STATUS_OPTIONS.filter(
    (s) =>
      s !== 'ALL' &&
      !excludeStatuses?.includes(s) &&
      !(s === 'UNPROCESSED' && isCloserRole),
  );
  const CONFIRMED_SUBSTAGES = ['AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'] as const;
  const confirmedAbsorbsSubstages = !PIPELINE_KEYS.some((s) =>
    (CONFIRMED_SUBSTAGES as readonly string[]).includes(s),
  );
  const pipelineItems = PIPELINE_KEYS.map((status) => {
    let value = statusCounts[status] ?? 0;
    if (status === 'DELIVERED' && remittedMergedIntoDelivered) {
      value += statusCounts['REMITTED'] ?? 0;
    }
    if (status === 'CONFIRMED' && confirmedAbsorbsSubstages) {
      for (const sub of CONFIRMED_SUBSTAGES) value += statusCounts[sub] ?? 0;
    }
    return {
      label: STATUS_LABELS[status] ?? formatStatus(status),
      value,
      valueClassName: STATUS_TEXT_CLASS[status] ?? 'text-app-fg',
      active: selectedStatus === status,
      onClick: () => handleStatusSelect(status),
    };
  });
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
  // Exclude DELETED (editorial) and CART (abandoned carts never entered the pipeline)
  // from rate denominators — they're not business outcomes.
  const periodTotalExclDeleted = Object.entries(statusCounts)
    .filter(([k]) => k !== 'DELETED' && k !== 'CART')
    .reduce((sum, [, n]) => sum + (n ?? 0), 0);
  const confirmationRate =
    periodTotalExclDeleted > 0 ? (confirmedPlus / periodTotalExclDeleted) * 100 : 0;
  const deliveryRate =
    periodTotalExclDeleted > 0 ? (deliveredPlus / periodTotalExclDeleted) * 100 : 0;

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('Customer not picking');
  const [freezeModalOpen, setFreezeModalOpen] = useState<'freeze' | 'unfreeze' | null>(null);

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
      const { ids, capped } = await fetchOrdersMatchingIds(bulkSelectAllMatchingInput, bulkSelectEndpoint);
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
          ? ` Capped at ${ORDERS_DEEP_SELECT_MAX}. To process more, narrow the filter or run the action again.`
          : ''
      }`;

  // Mobile tools-sheet chrome — every option sits in the same boxed, centered,
  // grey (app-hover) row at one shared height so the sheet reads consistently.
  const mobileFilterBoxClass =
    'relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5';
  const mobileSelectTransparent = '!bg-transparent !border-transparent !text-center';

  // Smart pick + deep-select toolbar — shared between the desktop inline card
  // and the mobile Smart-pick modal (opened from the tools sheet).
  function renderSmartPickToolbar() {
    if (!canBulkPick || filteredOrders.length === 0) return null;
    // Smart pick operates over the FULL filter, not just the current page, so
    // picking 50 of 179 unassigned isn't silently clamped to the 20 visible on
    // the page. Server bulk-action cap is `ORDERS_DEEP_SELECT_MAX` (100), so
    // that's the hard ceiling we expose.
    const smartPickCeiling = Math.min(total, ORDERS_DEEP_SELECT_MAX);
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {!hideSmartPickPresets && (
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
                const { ids, capped } = await fetchOrdersMatchingIds(bulkSelectAllMatchingInput, bulkSelectEndpoint);
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
        )}
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

  // Handle fetcher response — set result banner + revalidate on success
  const prevFetcherRef = useRef<string>('idle');
  useEffect(() => {
    const prev = prevFetcherRef.current;
    prevFetcherRef.current = fetcher.state;
    if (prev !== 'idle' && fetcher.state === 'idle' && fetcher.data) {
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
        // Clear selection + revalidate so the page reflects the change
        if (data.succeeded && data.succeeded > 0) {
          setSelectedIds(new Set());
          setSelectAllMatchingActive(false);
          revalidate();
        }
      }
    }
  }, [fetcher.state, fetcher.data, revalidate]);

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

    if (bulkMovePerItem) {
      // Follow-up surface: single bulk API call + WebSocket progress
      const ids = [...selectedIds];
      setBulkMoveProgress({ label: 'Transitioning orders', total: ids.length, completed: 0, failed: 0, status: 'running' });
      (async () => {
        try {
          const { getBrowserApiBaseUrl } = await import('~/lib/browser-api-base');
          const base = getBrowserApiBaseUrl();
          const res = await fetch(`${base}/trpc/orders.bulkTransitionFollowUpOrders`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderIds: ids, newStatus }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            const msg = (() => { try { const j = JSON.parse(text); return j?.error?.message ?? text.slice(0, 120); } catch { return text.slice(0, 120); } })();
            setBulkMoveProgress((p) => ({ ...p, status: 'error', errors: [msg || `HTTP ${res.status}`] }));
          }
        } catch (err) {
          setBulkMoveProgress((p) => ({ ...p, status: 'error', errors: [(err as Error).message ?? 'Network error'] }));
        }
      })();
      return;
    }

    const doSubmit = (branchId: string) =>
      fetcher.submit(
        {
          intent: 'bulkTransition',
          orderIds: JSON.stringify([...selectedIds]),
          newStatus,
          branchId,
        },
        { method: 'post' },
      );

    if (derivedBranchFromSelection) {
      doSubmit(derivedBranchFromSelection);
    } else {
      ensureBranchForAction({
        actionLabel: `transitioning selected orders to ${formatStatus(newStatus)}`,
        onProceed: doSubmit,
      });
    }
  };

  // Eligibility: initial queue assign — unprocessed orders only.
  // Cart orders are handled exclusively via Follow-Up — not assignable from the orders page.
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

  // Freeze/Unfreeze eligibility — selection must be uniformly frozen or unfrozen.
  const allSelectedFrozen =
    canFreeze &&
    selectedOrders.length > 0 &&
    selectedOrders.every((o) => o.frozenForFollowUp);
  const allSelectedUnfrozen =
    canFreeze &&
    selectedOrders.length > 0 &&
    selectedOrders.every((o) => !o.frozenForFollowUp);
  const frozenSelectionMixed =
    canFreeze &&
    selectedOrders.length > 0 &&
    !allSelectedFrozen &&
    !allSelectedUnfrozen;

  const assignCloserOptions = (csClosersForFilter ?? []).map((a) => ({ value: a.agentId, label: a.agentName }));
  const allocateLocationOptions = logisticsLocationsForBulk.map((loc) => ({
    value: loc.id,
    label: loc.providerName ? `${loc.name} ● ${loc.providerName}` : loc.name,
  }));

  const submitBulkFreeze = () => {
    setFreezeModalOpen('freeze');
  };

  const submitBulkUnfreeze = () => {
    setFreezeModalOpen('unfreeze');
  };

  const confirmBulkFreeze = () => {
    const intent = freezeModalOpen === 'unfreeze' ? 'bulkUnfreeze' : 'bulkFreeze';
    setFreezeModalOpen(null);
    setBulkResult(null);
    fetcher.submit(
      { intent, orderIds: JSON.stringify([...selectedIds]) },
      { method: 'post' },
    );
  };

  /** Derive branch from selected orders — avoids the branch-picker modal for
   *  org-wide heads when all selected orders share a single branch. */
  const derivedBranchFromSelection = useMemo(() => {
    const branches = [...new Set(selectedOrders.map((o) => o.branchId).filter(Boolean))];
    return branches.length === 1 ? branches[0]! : null;
  }, [selectedOrders]);

  const submitBulkAssign = () => {
    setBulkResult(null);

    const isCartAssign = selectedOrders.every((o) => o.status === 'CART');
    const doSubmit = (branchId: string) =>
      assignFetcher.submit(
        {
          intent: isCartAssign ? 'bulkAssignCarts' : 'bulkAssign',
          orderIds: JSON.stringify([...selectedIds]),
          csCloserIds: JSON.stringify(Array.from(assignAgentIds)),
          branchId,
        },
        { method: 'post' },
      );

    if (derivedBranchFromSelection) {
      doSubmit(derivedBranchFromSelection);
    } else {
      ensureBranchForAction({
        actionLabel:
          assignModalKind === 'reassign'
            ? 'reassigning selected orders to closers'
            : 'assigning selected orders to closers',
        onProceed: doSubmit,
      });
    }
  };

  const submitBulkAllocate = () => {
    setBulkResult(null);
    const doSubmit = (branchId: string) =>
      allocateFetcher.submit(
        {
          intent: 'bulkTransition',
          orderIds: JSON.stringify([...selectedIds]),
          newStatus: 'AGENT_ASSIGNED',
          logisticsLocationId: allocateLocationId,
          branchId,
        },
        { method: 'post' },
      );

    if (derivedBranchFromSelection) {
      doSubmit(derivedBranchFromSelection);
    } else {
      ensureBranchForAction({
        actionLabel: 'assigning selected orders for delivery at a 3PL location',
        onProceed: doSubmit,
      });
    }
  };

  const submitBulkCancel = () => {
    setBulkResult(null);
    setCancelModalOpen(false);

    if (bulkMovePerItem) {
      const ids = [...selectedIds];
      const reason = cancelReason;
      setBulkMoveProgress({ label: 'Deleting orders', total: ids.length, completed: 0, failed: 0, status: 'running' });
      (async () => {
        try {
          const { getBrowserApiBaseUrl } = await import('~/lib/browser-api-base');
          const base = getBrowserApiBaseUrl();
          const res = await fetch(`${base}/trpc/orders.bulkTransitionFollowUpOrders`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ orderIds: ids, newStatus: 'DELETED', ...(reason ? { note: reason } : {}) }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            const msg = (() => { try { const j = JSON.parse(text); return j?.error?.message ?? text.slice(0, 120); } catch { return text.slice(0, 120); } })();
            setBulkMoveProgress((p) => ({ ...p, status: 'error', errors: [msg || `HTTP ${res.status}`] }));
          }
        } catch (err) {
          setBulkMoveProgress((p) => ({ ...p, status: 'error', errors: [(err as Error).message ?? 'Network error'] }));
        }
      })();
      return;
    }

    const doSubmit = (branchId: string) =>
      fetcher.submit(
        {
          intent: 'bulkTransition',
          orderIds: JSON.stringify([...selectedIds]),
          newStatus: 'DELETED',
          reason: cancelReason,
          branchId,
        },
        { method: 'post' },
      );

    if (derivedBranchFromSelection) {
      doSubmit(derivedBranchFromSelection);
    } else {
      ensureBranchForAction({
        actionLabel: 'deleting selected orders',
        onProceed: doSubmit,
      });
    }
  };

  // Bulk transition / assign / cancel act on orders. Cart abandonment view
  // only allows assign (recover + assign in one step).
  const canBulkAction =
    (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'SUPPORT' || userRole === 'HEAD_OF_CS' || userRole === 'HEAD_OF_LOGISTICS' || userRole === 'STOCK_MANAGER');

  const ordersListColumns = useMemo((): CompactTableColumn<Order>[] => {
    const cols: CompactTableColumn<Order>[] = [
      {
        key: 'orderId',
        header: 'Order ID',
        nowrap: true,
        render: (order) => <OrderIdBadge id={order.id} orderNumber={order.orderNumber} linkTo={toOrderDetail(order.id)} />,
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (order) => {
          type TagInfo = { label: string; colorClass: string; hex: string; textClass?: string };
          const tags: TagInfo[] = [];
          const isFollowUpSurface = orderDetailFrom === 'followup';
          if ((order as { isFollowUp?: boolean }).isFollowUp) tags.push({ label: 'Follow Up', colorClass: 'bg-info-500', hex: '#3b82f6' });
          if (order.frozenForFollowUp) tags.push({ label: 'Frozen', colorClass: 'bg-slate-400', hex: '#94a3b8' });
          // Suppress stale delivery/callback tags on the follow-up surface — these dates
          // carry over from source orders and don't apply to the fresh follow-up engagement.
          if (!isFollowUpSurface && isPreferredDeliveryDueToday(order.preferredDeliveryDate, order.status)) tags.push({ label: 'Delivery due today', colorClass: 'bg-warning-500', hex: '#f59e0b', textClass: 'text-black' });
          if (!isFollowUpSurface && isPreferredDeliveryOverdue(order.preferredDeliveryDate, order.status)) tags.push({ label: 'Delivery overdue', colorClass: 'bg-danger-500', hex: '#ef4444' });
          if (!isFollowUpSurface && isCallbackDue(order.callbackScheduledAt, order.status)) tags.push({ label: 'Callback due', colorClass: 'bg-purple-500', hex: '#a855f7' });
          const isFrozen = !!order.frozenForFollowUp;
          return (
            <div className="group/cust relative flex min-w-0 items-center gap-2">
              <span className={`min-w-0 truncate font-medium ${isFrozen ? 'text-app-fg/60' : 'text-app-fg'}`}>
                {clipName(order.customerName)}
                {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
                )}
              </span>
              {/* Tag dots + tooltip — outside truncated span so tooltip isn't clipped */}
              {tags.length > 0 && (
                <span className="relative inline-flex shrink-0 items-center gap-0.5">
                  {tags.map((t) => (
                    <span key={t.label} className={`inline-flex w-2 h-2 rounded-full ${t.colorClass}`} />
                  ))}
                  {/* Tooltip with arrow — appears on hover */}
                  <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 z-50 ml-2 hidden group-hover/cust:inline-flex items-center min-w-max">
                    <span className="shrink-0 -mr-px w-0 h-0 border-y-[5px] border-y-transparent border-r-[6px]" style={{ borderRightColor: tags[0]?.hex ?? '#374151' }} />
                    <span className="inline-flex gap-1">
                      {tags.map((t) => (
                        <span key={t.label} className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap shadow-lg ${t.textClass ?? 'text-white'} ${t.colorClass}`}>
                          {t.label}
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
              )}
            </div>
          );
        },
      },
    ];
    if (showCSCloserColumn) {
      cols.push({
        key: 'closer',
        header: 'Assigned closer',
        render: (order) => (
          <span className="font-medium text-app-fg">
            {order.assignedCsId ? (
              <Link
                to={`/hr/users/${order.assignedCsId}`}
                className="hover:text-brand-600 hover:underline"
              >
                {order.assignedCsName ?? 'View user'}
              </Link>
            ) : (
              <span className="text-app-fg-muted">—</span>
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
        render: (order) => {
          const frozen = !!order.frozenForFollowUp;
          return order.status === 'CART' ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Cart
            </span>
          ) : (
            <span className={`inline-flex items-center gap-1.5 ${frozen ? 'opacity-60' : ''}`}>
              <OrderStatusBadge status={order.status} />
              {order.isDuplicate === 'CART_EDGE_FORM_DUPE' && (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
                  Duplicate
                </span>
              )}
            </span>
          );
        },
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
        align: 'right',
        headerClassName: 'text-right',
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
            <div className="inline-flex flex-nowrap items-center justify-end gap-1.5">
              {order.lastCsComment && (
                <CsCommentIcon comment={order.lastCsComment.comment} actorName={order.lastCsComment.actorName} />
              )}
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
      const isFollowUpSurface = orderDetailFrom === 'followup';
      const hasTags = !isFollowUpSurface && (
        isPreferredDeliveryDueToday(order.preferredDeliveryDate, order.status) ||
        isPreferredDeliveryOverdue(order.preferredDeliveryDate, order.status) ||
        isCallbackDue(order.callbackScheduledAt, order.status)
      );
      const mobileFrozen = !!order.frozenForFollowUp;
      const body = (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className={`min-w-0 truncate text-sm font-medium ${mobileFrozen ? 'text-app-fg/60' : 'text-app-fg'}`} title={order.customerName ?? undefined}>
              {clipName(order.customerName)}
              {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
              )}
              {(order as { isFollowUp?: boolean }).isFollowUp && !isCSCloser && (
                <span className="ml-1.5 inline-flex shrink-0 w-2 h-2 rounded-full bg-info-500" title="Follow Up" />
              )}
              {mobileFrozen && (
                <span className="ml-1.5 inline-flex shrink-0 w-2 h-2 rounded-full bg-slate-400 opacity-70" title="Frozen" />
              )}
            </span>
            <OrderIdBadge id={order.id} orderNumber={order.orderNumber} textClassName={`text-sm font-medium ${mobileFrozen ? 'text-app-fg/60' : 'text-app-fg'}`} />
          </div>
          <div className="flex items-center justify-between gap-2">
            {isCart ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Cart
              </span>
            ) : (
              <span className={`inline-flex items-center gap-1.5 ${mobileFrozen ? 'opacity-60' : ''}`}>
                <OrderStatusBadge status={order.status} />
                {order.isDuplicate === 'CART_EDGE_FORM_DUPE' && (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
                    Duplicate
                  </span>
                )}
              </span>
            )}
            <span className="whitespace-nowrap text-xs text-app-fg-muted">
              {formatOrderTimestamp(order.createdAt)}
            </span>
          </div>
          {order.lastCsComment && (
            <MobileCommentPreview comment={order.lastCsComment.comment} />
          )}
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
    ...STATUS_OPTIONS.filter((status) => !excludeStatuses?.includes(status) && !(status === 'UNPROCESSED' && isCloserRole)).map((status) => ({
      value: status,
      label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
    })),
    // "Deleted" tab — soft-removed orders excluded from all metrics/counts.
    // CEO directive 2026-05-23: DELETED replaces the old CANCELLED flow.
    // Row stays in DB; Admin/SuperAdmin can restore. Migration 0153.
    ...(!excludeStatuses?.includes('DELETED')
      ? [{ value: 'DELETED', label: 'Deleted' }]
      : []),
    ...(hideOfflineAndCartStats ? [] : [{ value: OFFLINE_STATUS_VALUE, label: `Offline orders (${offlineCount ?? 0})` }]),
    ...(!hideOfflineAndCartStats && enableFromCartStatusOption
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
    if (frozenFilterProp) n += 1;
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
    frozenFilterProp,
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
    const scheduleActive = !!scheduleFilters?.scheduleKind;
    const clearSchedule = () => {
      setSelectedIds(new Set());
      setBulkResult(null);
      setSearchParams((p) => {
        const next = new URLSearchParams(p);
        next.delete('scheduleKind');
        next.delete('scheduleDate');
        next.set('page', '1');
        return next;
      });
    };
    if (boxed) {
      return (
        <div className={mobileFilterBoxClass}>
          {scheduleActive && <FilterDismiss onClear={clearSchedule} />}
          {select}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
        <div className="relative flex min-w-0 flex-col gap-1 sm:flex-1">
          {scheduleActive && <FilterDismiss onClear={clearSchedule} />}
          {select}
        </div>
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
          canEditPrices={userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'HEAD_OF_CS' || userRole === 'HEAD_OF_MARKETING'}
        />
      )}

      {/* Page header — Live tag sits directly in front of the refresh button per Sales request. */}
      <PageHeader
        title={pageTitle ?? (isCSCloser ? 'My Orders' : 'Sales Orders')}
        mobileInlineActions
        backTo={backTo}
        description={pageDescription ?? (isCSCloser ? 'Track your assigned orders' : 'Manage and track all customer orders')}
        actions={
          <PageHeaderMobileTools
              sheetTitle="Actions"
              triggerAriaLabel="Sales orders toolbar"
              saveFilterKey
              filtersBadgeCount={ordersListToolbarFilterBadge}
              filters={
                <>
                  {renderScheduleFilter(true)}
                  <div className={mobileFilterBoxClass}>
                    {selectedStatus !== 'ALL' && (
                      <FilterDismiss
                        onClear={() => {
                          setSelectedIds(new Set());
                          setBulkResult(null);
                          handleStatusSelect('ALL');
                        }}
                      />
                    )}
                    <FormSelect
                      value={selectedStatus}
                      onChange={(e) => handleStatusSelect(e.target.value)}
                      options={statusOptions}
                      controlSize="sm"
                      openAs="modal"
                      wrapperClassName="w-full"
                      className={mobileSelectTransparent} inlineChevron
                    />
                  </div>
                  {showCSCloserColumn && ((csClosersForFilter?.length ?? 0) > 0 || deferredLoading) ? (
                    <div className={mobileFilterBoxClass}>
                      {(searchParams.get('csCloserId') || 'ALL') !== 'ALL' && (
                        <FilterDismiss
                          onClear={() => {
                            setSelectedIds(new Set());
                            setBulkResult(null);
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.delete('csCloserId');
                              next.set('page', '1');
                              return next;
                            });
                          }}
                        />
                      )}
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
                          triggerClassName={mobileSelectTransparent} inlineChevron
                          placeholder="All closers"
                          searchPlaceholder="Search closers..."
                        />
                      )}
                    </div>
                  ) : null}
                  {(productsForFilter?.length ?? 0) > 0 ? (
                    <div className={mobileFilterBoxClass}>
                      {(productFilter || 'ALL') !== 'ALL' && (
                        <FilterDismiss
                          onClear={() => {
                            setSelectedIds(new Set());
                            setBulkResult(null);
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.delete('productId');
                              next.set('page', '1');
                              return next;
                            });
                          }}
                        />
                      )}
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
                        triggerClassName={mobileSelectTransparent} inlineChevron
                        placeholder="All products"
                        searchPlaceholder="Search products..."
                      />
                    </div>
                  ) : null}
                  {showCampaignColumn && (campaignsForFilter?.length ?? 0) > 0 ? (
                    <div className={mobileFilterBoxClass}>
                      {(campaignFilter || 'ALL') !== 'ALL' && (
                        <FilterDismiss
                          onClear={() => {
                            setSelectedIds(new Set());
                            setBulkResult(null);
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.delete('campaignId');
                              next.set('page', '1');
                              return next;
                            });
                          }}
                        />
                      )}
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
                        triggerClassName={mobileSelectTransparent} inlineChevron
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
                <DateFilterBar
                    startDate={filters?.startDate ?? ''}
                    endDate={filters?.endDate ?? ''}
                    startTime={filters?.startTime ?? ''}
                    endTime={filters?.endTime ?? ''}
                    periodAllTime={filters?.periodAllTime ?? false} chrome="pill" />
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowChartView((v) => !v)}>
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
                {canExport && (
                  <Button variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                    Generate report
                  </Button>
                )}
                {canImportOrders && (
                  <Link to="/admin/sales/orders/import" prefetch="intent" className="btn-secondary btn-sm">
                    Import orders
                  </Link>
                )}
                {canCreateOffline && (
                  <Button variant="primary" size="sm" onClick={() => setCreateOfflineOpen(true)}>
                    <span className="hidden sm:inline">Create offline order</span>
                    <span className="sm:hidden">+ Order</span>
                  </Button>
                )}
                {isTestOrdersView && (
                  <Button variant="danger" size="sm" onClick={() => setPurgeConfirmOpen(true)} disabled={purgeFetcher.state !== 'idle'}>
                    Delete all test orders
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
                  className="h-12 w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    setShowChartView((v) => !v);
                  }}
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
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
                {canImportOrders && (
                  <Link
                    to="/admin/sales/orders/import"
                    prefetch="intent"
                    className="btn-secondary btn-sm h-12 w-full justify-center"
                    onClick={() => closeSheet()}
                  >
                    Import orders
                  </Link>
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
                {canBulkPick && filteredOrders.length > 0 && (
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

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        startTime={filters?.startTime ?? ''}
        endTime={filters?.endTime ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      {/* My workload (Sales closer only) — compact strip above funnel */}
      {isCSCloser && (myWorkload || deferredLoading) && (
        myWorkload ? (() => {
          const closes = myWorkload.todayClosesCount ?? 0;
          const dailyPct = myWorkload.capacity > 0 ? (closes / myWorkload.capacity) * 100 : 0;
          const barColor =
            dailyPct >= 100 ? 'bg-success-500' : dailyPct >= 70 ? 'bg-warning-500' : 'bg-brand-500';
          const dutyColor =
            dailyPct >= 100 ? 'text-success-600 dark:text-success-400' : dailyPct >= 70 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg';
          return (
            <div className="card !py-2.5 !px-4 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-sm font-semibold tabular-nums ${dutyColor}`}>
                  Today&apos;s duty: {closes} / {myWorkload.capacity}
                </span>
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm text-app-fg-muted">Pipeline backlog:</span>
                <span className={`text-sm font-semibold tabular-nums ${myWorkload.pendingCount > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg'}`}>
                  {myWorkload.pendingCount}
                </span>
              </div>
              <div className="flex-1 min-w-[6rem] flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-app-hover rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${Math.min(dailyPct, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-app-fg-muted tabular-nums shrink-0">{Math.round(Math.min(dailyPct, 100))}%</span>
              </div>
            </div>
          );
        })() : deferredLoading ? (
          <div className="card !py-2.5 !px-4 flex items-center gap-4 flex-wrap" aria-hidden>
            <span className="text-sm text-app-fg-muted">Today&apos;s duty: <span className="inline-block h-4 w-10 rounded bg-app-hover animate-pulse align-middle" /></span>
            <span className="text-sm text-app-fg-muted">Pipeline backlog: <span className="inline-block h-4 w-6 rounded bg-app-hover animate-pulse align-middle" /></span>
            <div className="flex-1 min-w-[6rem] flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-app-hover rounded-full overflow-hidden" />
              <span className="inline-block h-3 w-6 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        ) : null
      )}

      {/* Status totals — funnel snapshot. */}
      {deferredLoading && Object.keys(statusCounts).length === 0 ? (
        <OverviewStatStripSkeleton
          count={1 + PIPELINE_KEYS.length + 3}
          labels={[
            'Total',
            ...(hideOfflineAndCartStats ? [] : ['Offline']),
            ...PIPELINE_KEYS.map((s) => STATUS_LABELS[s] ?? formatStatus(s)),
            'CR', 'DR',
            ...(PIPELINE_KEYS.includes('DELETED') ? [] : ['Deleted']),
            ...(!hideOfflineAndCartStats && enableFromCartStatusOption ? ['Cart Abandonment'] : []),
          ]}
        />
      ) : (
        // One strip in every mode — the order funnel snapshot stays put when you
        // drill into the cart-abandonment view, so you can jump straight back to
        // any status. The "Cart abandonment" tile is the clickable entry point.
        <OverviewStatStrip
          mobileGrid
          liveFlash={liveState.showGreen}
          items={[
            {
              label: 'Total',
              // Always derive from statusCounts (the source of truth) so
              // search/filter changes don't make the overview strip fluctuate.
              value: Object.entries(statusCounts)
                .filter(([k]) => k !== 'DELETED' && k !== 'CART')
                .reduce((sum, [, n]) => sum + (n || 0), 0),
              valueClassName: 'text-app-fg',
              active: selectedStatus === 'ALL',
              onClick: () => handleStatusSelect('ALL'),
            },
            ...(hideOfflineAndCartStats ? [] : [{
              label: 'Offline',
              value: offlineCount ?? 0,
              valueClassName: 'text-purple-600 dark:text-purple-400',
              title: 'Orders created manually via offline order',
              onClick: () => handleStatusSelect(OFFLINE_STATUS_VALUE),
              active: selectedStatus === OFFLINE_STATUS_VALUE,
            }]),
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
              title: 'Delivery Rate — delivered / total orders',
            },
            ...(deletedItem ? [deletedItem] : []),
            ...(!hideOfflineAndCartStats && enableFromCartStatusOption ? [{
              label: 'Cart Abandonment',
              value: cartAbandonmentCount ?? 0,
              valueClassName: (cartAbandonmentCount ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-app-fg',
              title: 'Captured carts not yet recovered — tap to view the cart backlog',
              active: selectedStatus === FROM_CART_STATUS_VALUE,
              onClick: () => handleStatusSelect(FROM_CART_STATUS_VALUE),
            }] : []),
          ]}
        />
      )}

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && canBulkAction && (
        <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700/50 relative overflow-hidden">
          {isSubmitting && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-brand-200 dark:bg-brand-800 overflow-hidden">
              <div className="h-full w-1/3 bg-brand-500 dark:bg-brand-400 animate-[indeterminateProgress_1.5s_ease-in-out_infinite]" />
            </div>
          )}
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
              {availableTransitions
                .filter((status: string) => {
                  // Delete is SuperAdmin/Admin only — HoCS cannot delete orders
                  if (status === 'DELETED' && userRole !== 'SUPER_ADMIN' && userRole !== 'ADMIN') return false;
                  return true;
                })
                .map((status: string) => (
                <Button
                  key={status}
                  variant={status === 'DELETED' || status === 'CANCELLED' ? 'danger' : 'primary'}
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
              {/* Freeze — all selected must be unfrozen */}
              {allSelectedUnfrozen && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={submitBulkFreeze}
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  loadingText="Freezing..."
                >
                  Freeze
                </Button>
              )}
              {/* Unfreeze — all selected must be frozen */}
              {allSelectedFrozen && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={submitBulkUnfreeze}
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  loadingText="Unfreezing..."
                >
                  Unfreeze
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
          {(bulkCloserSelectionMixed || selectedStatuses.length > 1 || frozenSelectionMixed) && (
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
              {frozenSelectionMixed && (
                <p className="text-xs text-app-fg-muted italic">
                  Select only frozen or only unfrozen orders to use Freeze / Unfreeze.
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
            disabled={!moveBranchId || moveBranchFetcher.state === 'submitting' || bulkMoveProgress.status === 'running'}
            loading={moveBranchFetcher.state === 'submitting'}
            loadingText="Moving…"
            onClick={async () => {
              if (bulkMovePerItem) {
                // Close confirmation modal — progress comes via WebSocket
                const ids = [...selectedIds];
                const branch = moveBranchId;
                setMoveBranchModalOpen(false);
                setMoveBranchId('');
                setBulkMoveProgress({ label: 'Moving orders to branch', total: ids.length, completed: 0, failed: 0, status: 'running' });
                try {
                  const { getBrowserApiBaseUrl } = await import('~/lib/browser-api-base');
                  const base = getBrowserApiBaseUrl();
                  const res = await fetch(`${base}/trpc/orders.bulkTransferFollowUpOrders`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ orderIds: ids, targetBranchId: branch }),
                  });
                  if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    const msg = (() => { try { const j = JSON.parse(text); return j?.error?.message ?? text.slice(0, 120); } catch { return text.slice(0, 120); } })();
                    setBulkMoveProgress((p) => ({ ...p, status: 'error', errors: [msg || `HTTP ${res.status}`] }));
                  }
                  // On success the final socket event already set state to 'complete'
                } catch (err) {
                  setBulkMoveProgress((p) => ({ ...p, status: 'error', errors: [(err as Error).message ?? 'Network error'] }));
                }
              } else {
                moveBranchFetcher.submit(
                  { intent: 'moveOrdersToBranch', orderIds: JSON.stringify([...selectedIds]), targetBranchId: moveBranchId },
                  { method: 'post' },
                );
              }
            }}
          >
            Move {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </Modal>
      {/* Bulk progress modal (server-side processing + WebSocket progress) */}
      <BulkProgressModal
        state={bulkMoveProgress}
        onDone={() => {
          setBulkMoveProgress(BULK_PROGRESS_IDLE);
          clearSelection();
          revalidate();
        }}
      />

      <div className="list-panel">
        <ToolbarFiltersCollapsible
          className="!border-0"
          hideMobileSheet
          badgeCount={ordersListToolbarFilterBadge}
          searchRow={
            <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-2">
              <form
                method="get"
                className="flex min-w-0 w-full gap-2 sm:flex-row sm:items-center md:w-[350px]"
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
                  onChange={(val) => {
                    setSearchQuery(val);
                    // Clear × should reload immediately, not wait for submit
                    if (!val.trim() && searchParams.get('search')) {
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.delete('search');
                        next.set('page', '1');
                        return next;
                      });
                    }
                  }}
                  withSubmitButton
                  wrapperClassName="min-w-0 w-full flex-1"
                />
              </form>
              <div className="hidden items-center gap-2 md:flex md:flex-wrap">
                <div className="relative">
                  {selectedStatus !== 'ALL' && (
                    <FilterDismiss
                      onClear={() => {
                        setSelectedIds(new Set());
                        setBulkResult(null);
                        handleStatusSelect('ALL');
                      }}
                    />
                  )}
                  <FormSelect
                    value={selectedStatus}
                    onChange={(e) => handleStatusSelect(e.target.value)}
                    options={statusOptions}
                    wrapperClassName="w-full min-w-0 sm:w-48"
                  />
                </div>
                {showCSCloserColumn && ((csClosersForFilter?.length ?? 0) > 0 || deferredLoading) ? (
                  deferredLoading && !(csClosersForFilter?.length) ? (
                    <div
                      className="h-9 w-full min-w-0 sm:w-48 shrink-0 rounded-md bg-app-hover animate-pulse"
                      aria-hidden
                    />
                  ) : (
                    <div className="relative">
                      {(searchParams.get('csCloserId') || 'ALL') !== 'ALL' && (
                        <FilterDismiss
                          onClear={() => {
                            setSelectedIds(new Set());
                            setBulkResult(null);
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.delete('csCloserId');
                              next.set('page', '1');
                              return next;
                            });
                          }}
                        />
                      )}
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
                    </div>
                  )
                ) : null}
                {(productsForFilter?.length ?? 0) > 0 ? (
                  <div className="relative">
                    {(productFilter || 'ALL') !== 'ALL' && (
                      <FilterDismiss
                        onClear={() => {
                          setSelectedIds(new Set());
                          setBulkResult(null);
                          setSearchParams((p) => {
                            const next = new URLSearchParams(p);
                            next.delete('productId');
                            next.set('page', '1');
                            return next;
                          });
                        }}
                      />
                    )}
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
                  </div>
                ) : null}
                {showCampaignColumn && (campaignsForFilter?.length ?? 0) > 0 ? (
                  <div className="relative">
                    {(campaignFilter || 'ALL') !== 'ALL' && (
                      <FilterDismiss
                        onClear={() => {
                          setSelectedIds(new Set());
                          setBulkResult(null);
                          setSearchParams((p) => {
                            const next = new URLSearchParams(p);
                            next.delete('campaignId');
                            next.set('page', '1');
                            return next;
                          });
                        }}
                      />
                    )}
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
                  </div>
                ) : null}
                <div className="relative">
                  {frozenFilterProp && (
                    <FilterDismiss
                      onClear={() => {
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.delete('frozen');
                          next.set('page', '1');
                          return next;
                        });
                      }}
                    />
                  )}
                  {/* Combined sort + frozen filter */}
                  {(sortByProp !== 'createdAt' || sortOrderProp !== 'desc' || frozenFilterProp) && (
                    <FilterDismiss
                      onClear={() => {
                        setSelectedIds(new Set());
                        setBulkResult(null);
                        setSearchParams((p) => {
                          const next = new URLSearchParams(p);
                          next.delete('sortBy');
                          next.delete('sortOrder');
                          next.delete('frozen');
                          next.set('page', '1');
                          return next;
                        });
                      }}
                    />
                  )}
                  <FormSelect
                    value={frozenFilterProp ? `frozen:${frozenFilterProp}` : `${sortByProp}:${sortOrderProp}`}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedIds(new Set());
                      setBulkResult(null);
                      setSearchParams((p) => {
                        const next = new URLSearchParams(p);
                        next.set('page', '1');
                        if (val.startsWith('frozen:')) {
                          next.set('frozen', val.split(':')[1]!);
                          // Keep current sort
                        } else {
                          next.delete('frozen');
                          const [newSortBy, newSortOrder] = val.split(':');
                          if (newSortBy && newSortBy !== 'createdAt') next.set('sortBy', newSortBy);
                          else next.delete('sortBy');
                          if (newSortOrder && newSortOrder !== 'desc') next.set('sortOrder', newSortOrder);
                          else next.delete('sortOrder');
                        }
                        return next;
                      });
                    }}
                    options={[
                      { value: 'createdAt:desc', label: 'Newest first' },
                      { value: 'createdAt:asc', label: 'Oldest first' },
                      { value: 'totalAmount:desc', label: 'Highest amount' },
                      { value: 'totalAmount:asc', label: 'Lowest amount' },
                      { value: 'updatedAt:desc', label: 'Recently updated' },
                      { value: 'status:asc', label: 'Status A–Z' },
                      { value: 'status:desc', label: 'Status Z–A' },
                      { value: '---', label: '──────────', disabled: true },
                      { value: 'frozen:active', label: 'Non Frozen' },
                      { value: 'frozen:frozen', label: 'Frozen only' },
                    ]}
                    wrapperClassName="w-full min-w-0 sm:w-44"
                  />
                </div>
                {renderScheduleFilter(false)}
              </div>
            </div>
          }
          desktopInlineFilters={null}
          sheetFilterBody={null}
        />
      </div>

      {/* Smart pick + deep-select. Desktop: inline card under the filters.
          Mobile: hidden here — it lives in the tools sheet and opens its own
          Smart-pick modal. SmartPick picks the first N of the current page;
          the deep-select checkbox selects every order matching the filter
          (capped server-side at ORDERS_DEEP_SELECT_MAX). */}
      {canBulkPick && filteredOrders.length > 0 && (
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
            collapseForCS
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
              [
                selectedIds.has(o.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : '',
                highlightedIds.has(o.id) ? 'row-new-highlight' : '',
                liveState.showGreen ? 'animate-live-flash-row' : '',
              ]
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
                ? 'Every captured cart has been recovered or cleared.'
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
              const noun = 'orders';
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

      {/* Freeze / Unfreeze confirmation modal */}
      {freezeModalOpen && (
        <Modal open onClose={() => setFreezeModalOpen(null)} maxWidth="max-w-sm" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">
            {freezeModalOpen === 'freeze' ? 'Freeze' : 'Unfreeze'} {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''}?
          </h3>
          <p className="text-sm text-app-fg-muted mb-4">
            {freezeModalOpen === 'freeze'
              ? 'Frozen orders are excluded from follow-up batches and will not be re-engaged automatically.'
              : 'These orders will become eligible for follow-up batches again.'}
          </p>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="secondary" onClick={() => setFreezeModalOpen(null)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={confirmBulkFreeze}>
              {freezeModalOpen === 'freeze' ? 'Freeze' : 'Unfreeze'}
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
          errorMessage={assignSurface.errorMatchingIntent('bulkAssign') || assignSurface.errorMatchingIntent('bulkAssignCarts')}
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
  // Cache the last resolved secondary data so filter changes don't flash the
  // skeleton for stats that haven't changed (status counts, workload, etc.).
  const cachedSecRef = useRef<CsOrdersDeferredSecondary | null>(null);

  if (props.deferredSecondary) {
    const { deferredSecondary, ...rest } = props;
    const cached = cachedSecRef.current;
    return (
      <Suspense
        fallback={
          <OrdersListPageImpl
            {...rest}
            // When we have cached data, show it instead of empty skeleton.
            // Only the table shows a loading overlay via useLoaderRefetchBusy.
            deferredLoading={!cached}
            statusCounts={cached?.statusCounts ?? {}}
            dailyCounts={cached?.dailyCounts}
            scheduleHeat={cached?.scheduleHeat}
            myWorkload={cached?.myWorkload ?? null}
            csClosersForFilter={cached?.csClosersForFilter}
            logisticsLocationsForBulk={cached?.logisticsLocationsForBulk ?? []}
            productsForOfflineOrder={cached?.productsForOfflineOrder ?? []}
            productsForFilter={cached?.productsForFilter}
            offlineCount={cached?.offlineCount ?? 0}
            cartAbandonmentCount={cached?.cartAbandonmentCount ?? 0}
          />
        }
      >
        <Await resolve={deferredSecondary} errorElement={<DeferredError />}>
          {(sec) => {
            cachedSecRef.current = sec;
            return (
              <OrdersListPageImpl
                {...rest}
                statusCounts={sec.statusCounts}
                dailyCounts={sec.dailyCounts}
                scheduleHeat={sec.scheduleHeat}
                myWorkload={sec.myWorkload}
                csClosersForFilter={sec.csClosersForFilter}
                logisticsLocationsForBulk={sec.logisticsLocationsForBulk}
                productsForOfflineOrder={sec.productsForOfflineOrder}
                productsForFilter={sec.productsForFilter}
                offlineCount={sec.offlineCount ?? 0}
                cartAbandonmentCount={sec.cartAbandonmentCount ?? 0}
              />
            );
          }}
        </Await>
      </Suspense>
    );
  }
  return <OrdersListPageImpl {...props} />;
}
