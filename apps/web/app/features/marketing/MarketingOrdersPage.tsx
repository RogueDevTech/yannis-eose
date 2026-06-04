import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { confirmationRateColorClass, deliveryRateColorClass, cpaColorClass } from '~/lib/rate-color';
import { clipName } from '~/lib/clip-name';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { useFetcherToast } from '~/components/ui/toast';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { formatOrderTimestamp } from '~/lib/format-date';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { useLiveIndicator } from '~/hooks/useSocket';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { FilterPills } from '~/components/ui/filter-pills';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
  type CompactTableMobileCardHelpers,
} from '~/components/ui/compact-table';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { Pagination } from '~/components/ui/pagination';
import { OrdersChartView } from '~/components/ui/orders-chart-view-lazy';
import { ExportModal, type ExportModalPicklists } from '~/components/ui/export-modal';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import type { Order } from '~/features/orders/types';
import type { PendingCart } from '~/features/cs/types';
import { AbandonedCartDetailModal } from '~/features/cs/AbandonedCartDetailModal';
import { orderDetailHref } from '~/lib/order-detail-return';
import { CsCommentIcon, MobileCommentPreview } from '~/components/ui/cs-comment-icon';
import { DeferredError } from '~/components/ui/deferred-section';
import {
  OrdersChartViewShellSkeleton,
  StatValuePulse,
  TableCellTextPulse,
} from '~/components/ui/deferred-skeletons';

import { FilterDismiss } from '~/components/ui/filter-dismiss';

const DEFERRED_PLACEHOLDER_ROW_COUNT = 10;
const DEFERRED_PLACEHOLDER_ROWS: Order[] = Array.from(
  { length: DEFERRED_PLACEHOLDER_ROW_COUNT },
  (_, i) => ({
    id: `__marketing_orders_deferred_${i}`,
    customerName: '',
    customerPhoneDisplay: '',
    status: 'UNPROCESSED',
    totalAmount: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    assignedCsId: null,
  }),
);

/**
 * Status filter list for the Marketing orders page: the shared CS-funnel buckets
 * plus Deleted, minus Cash Remitted — remittance is accountant-only and never
 * relevant to a marketing view of the funnel.
 * CEO directive 2026-05-23: CANCELLED replaced by DELETED.
 */
const MARKETING_ORDERS_STATUSES = [
  ...STATUS_OPTIONS.filter((status) => status !== 'REMITTED'),
  'DELETED',
];

/** Status dropdown labels before streamed counts hydrate (same order as full options). */
const MARKETING_ORDERS_STATUS_OPTIONS_BASE = MARKETING_ORDERS_STATUSES.map((status) => ({
  value: status,
  label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
}));

/** Sentinel — not a real order status. Selecting it activates the `?fromCart=1` view. */
const FROM_CART_STATUS_VALUE = '__from_cart__';
const TEST_ORDERS_STATUS_VALUE = '__test_orders__';

/** Marketing performance metrics — same shape as `marketing.metrics` / dashboard. */
export interface MarketingMetrics {
  totalOrders: number;
  deliveredOrders: number;
  deliveredRevenue: number;
  confirmedOrders: number;
  confirmationRate: number;
  cpa: number;
  trueRoas: number;
  deliveryRate: number;
  totalSpend: number;
}

/** Streamed after `orders.list`: counts, metrics, chart series, export picklists + buyer filter options. */
export type MarketingOrdersSecondaryPayload = {
  statusCounts: Record<string, number>;
  cpa: number | null;
  totalAdSpend: number | null;
  /** Full marketing KPIs from `getPerformanceMetrics` — used for the stat strip
   *  so Total Orders / Delivered / CR / DR match the dashboard, not raw statusCounts. */
  metrics: MarketingMetrics;
  dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
  marketingExportPicklists?: Partial<ExportModalPicklists>;
  mediaBuyersForFilter: Array<{ id: string; name: string }>;
  /** Always populated — Media Buyers + HoM/admin filter by Product on this table. */
  productsForFilter: Array<{ id: string; name: string }>;
  /** Always populated — Form (campaign) filter so a Media Buyer can isolate a single funnel. */
  campaignsForFilter: Array<{ id: string; name: string }>;
  /** Open (un-recovered) abandoned-cart count, scoped to the viewer's media buyer / branch. */
  abandonedCartCount: number;
};

interface MarketingOrdersPageProps {
  orders: Order[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  secondary: MarketingOrdersSecondaryPayload;
  statusFilter?: string;
  searchFilter?: string;
  sortBy?: string;
  sortOrder?: string;
  isMediaBuyer: boolean;
  /** True when the viewer is a marketing-team supervisor. */
  isMarketingSupervisor?: boolean;
  /** Pre-fetched personal stats for the supervisor's "My Performance" tab.
   *  When present, the stat strip toggles between team (secondary) and personal
   *  (this) data instantly — no network round-trip on tab switch. */
  personalSecondary?: MarketingOrdersSecondaryPayload;
  /** Show Media buyer column (HoM and SuperAdmin only). */
  showMediaBuyerColumn?: boolean;
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /**
   * When false (default), the Generate report button is hidden. Server still
   * enforces `orders.export` on the actual download.
   */
  canExport?: boolean;
  /** The current viewer's user ID — used for supervisor My/Team tab toggle. */
  viewerUserId?: string;
  /** Active mediaBuyerId filter from the URL (null = all team). */
  activeMediaBuyerFilter?: string | null;
  /**
   * Adds a "Cart abandonment" pseudo-option to the status dropdown. Maps to
   * `?fromCart=1`, which swaps the table to the abandoned-cart backlog.
   */
  enableFromCartStatusOption?: boolean;
  /** Show "Test orders" filter option. Admin only. */
  enableTestOrdersOption?: boolean;
  /**
   * Cart-abandonment mode — true when `?fromCart=1` is active and `orders`
   * has been populated with abandoned CARTS (synthetic status `'CART'`).
   */
  isCartAbandonmentView?: boolean;
  /**
   * When true, the page renders its real chrome but swaps row data + pagination
   * for pulse skeletons — used as the route-level Suspense fallback so the layout
   * stays mounted while the orders list streams in.
   */
  deferredLoading?: boolean;
}

export function MarketingOrdersPage({
  orders,
  total,
  totalPages,
  page,
  limit,
  secondary,
  personalSecondary,
  statusFilter,
  searchFilter,
  sortBy: sortByProp = 'createdAt',
  sortOrder: sortOrderProp = 'desc',
  isMediaBuyer,
  isMarketingSupervisor = false,
  showMediaBuyerColumn = false,
  filters,
  liveEvents,
  canExport = false,
  viewerUserId,
  activeMediaBuyerFilter,
  enableFromCartStatusOption = false,
  enableTestOrdersOption = false,
  isCartAbandonmentView = false,
  deferredLoading = false,
}: MarketingOrdersPageProps) {
  const dateFilters = filters ?? { startDate: '', endDate: '', periodAllTime: false };

  // On pagination-only loads (page > 1) the loader skips the secondary bundle
  // to cut response time in half. Keep the previous secondary data so stats,
  // charts, and filter picklists don't flash empty.
  const secondaryRef = useRef(secondary);
  const personalSecondaryRef = useRef(personalSecondary);
  const isSecondaryEmpty = Object.keys(secondary.statusCounts).length === 0
    && secondary.mediaBuyersForFilter.length === 0;
  if (!isSecondaryEmpty) {
    secondaryRef.current = secondary;
    personalSecondaryRef.current = personalSecondary;
  }
  secondary = secondaryRef.current;
  personalSecondary = personalSecondaryRef.current;

  const { busy: isLoaderRefetchBusy, primeSamePathRefetch } = useLoaderRefetchBusy();
  // Treat both the initial Suspense fallback AND any same-path loader refetch
  // (filter / pagination / status change) as "loading" — the table swaps to
  // skeleton rows in both cases instead of dimming with the overlay spinner.
  const showSkeletonRows = deferredLoading || isLoaderRefetchBusy;
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [searchParams, remixSetSearchParams] = useSearchParams();
  const setSearchParams = useCallback(
    (...args: Parameters<typeof remixSetSearchParams>) => {
      primeSamePathRefetch();
      remixSetSearchParams(...args);
    },
    [remixSetSearchParams, primeSamePathRefetch],
  );
  // The "Cart abandonment" pseudo-status is selected whenever `?fromCart=1` is on.
  const fromCartUrlActive = searchParams.get('fromCart') === '1';
  const testOrdersUrlActive = searchParams.get('testOrders') === '1';
  const [selectedStatus, setSelectedStatus] = useState(
    enableTestOrdersOption && testOrdersUrlActive
      ? TEST_ORDERS_STATUS_VALUE
      : enableFromCartStatusOption && fromCartUrlActive
        ? FROM_CART_STATUS_VALUE
        : statusFilter || 'ALL',
  );
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [myTeamTab, setMyTeamTab] = useState<'personal' | 'team'>(
    activeMediaBuyerFilter === viewerUserId ? 'personal' : 'team',
  );
  const [showChartView, setShowChartView] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [peekOrder, setPeekOrder] = useState<Order | null>(null);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);
  const purgeFetcher = useFetcher<{ success?: boolean; deleted?: number; skipped?: number; error?: string }>();
  const isTestOrdersView = selectedStatus === TEST_ORDERS_STATUS_VALUE;
  useFetcherToast(purgeFetcher.data, {
    successTitle: 'Test orders cancelled',
    successMessage: `${purgeFetcher.data?.deleted ?? 0} cancelled${(purgeFetcher.data?.skipped ?? 0) > 0 ? `, ${purgeFetcher.data?.skipped} skipped (stock moved)` : ''}`,
    errorTitle: 'Cancel failed',
  });

  useEffect(() => {
    setSelectedStatus(
      enableTestOrdersOption && testOrdersUrlActive
        ? TEST_ORDERS_STATUS_VALUE
        : enableFromCartStatusOption && fromCartUrlActive
          ? FROM_CART_STATUS_VALUE
          : statusFilter || 'ALL',
    );
    setSearchQuery(searchFilter || '');
    setMyTeamTab(activeMediaBuyerFilter === viewerUserId ? 'personal' : 'team');
  }, [statusFilter, searchFilter, enableFromCartStatusOption, fromCartUrlActive, enableTestOrdersOption, testOrdersUrlActive, activeMediaBuyerFilter, viewerUserId]);

  // Quick-detail modal for an abandoned cart row — fetched on demand from the
  // marketing cart-detail resource route (scoped server-side to the viewer).
  const cartDetailFetcher = useFetcher<{ cart: PendingCart | null }>();
  const [viewCartOrderId, setViewCartOrderId] = useState<string | null>(null);
  const openCartDetail = useCallback(
    (order: Order) => {
      if (!order.cartId) return;
      setViewCartOrderId(order.id);
      cartDetailFetcher.load(`/admin/marketing/cart-detail?cartId=${order.cartId}`);
    },
    [cartDetailFetcher],
  );

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (status === FROM_CART_STATUS_VALUE) {
        next.delete('status');
        next.delete('testOrders');
        next.set('fromCart', '1');
      } else if (status === TEST_ORDERS_STATUS_VALUE) {
        next.delete('status');
        next.delete('fromCart');
        next.set('testOrders', '1');
      } else {
        next.delete('fromCart');
        next.delete('testOrders');
        if (status === 'ALL' || !status) next.delete('status');
        else next.set('status', status);
      }
      return next;
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      const q = searchQuery.trim();
      if (q) next.set('search', q);
      else next.delete('search');
      return next;
    });
  };

  // Status dropdown options shown before streamed counts hydrate — with the
  // "Cart abandonment" pseudo-option appended when the viewer may use it.
  const statusOptionsBase = useMemo(
    () => [
      ...MARKETING_ORDERS_STATUS_OPTIONS_BASE,
      ...(enableFromCartStatusOption
        ? [{ value: FROM_CART_STATUS_VALUE, label: 'Cart abandonment' }]
        : []),
      ...(enableTestOrdersOption
        ? [{ value: TEST_ORDERS_STATUS_VALUE, label: 'Test orders' }]
        : []),
    ],
    [enableFromCartStatusOption, enableTestOrdersOption],
  );

  const ordersToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (selectedStatus !== 'ALL') n += 1;
    const mb = searchParams.get('mediaBuyerId') || 'ALL';
    if (showMediaBuyerColumn && mb !== 'ALL') n += 1;
    if ((searchParams.get('productId') || '').length > 0) n += 1;
    if ((searchParams.get('campaignId') || '').length > 0) n += 1;
    if ((searchParams.get('orderSource') || '').length > 0) n += 1;
    return n;
  }, [selectedStatus, showMediaBuyerColumn, searchParams]);


  const marketingOrderColumns: CompactTableColumn<Order>[] = useMemo(() => {
    const cols: CompactTableColumn<Order>[] = [
      {
        key: 'id',
        header: 'Order ID',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) =>
              order.status === 'CART' ? (
                // Cart rows have no order detail page — copyable id only.
                <OrderIdBadge id={order.id} orderNumber={order.orderNumber} />
              ) : (
                <OrderIdBadge id={order.id} orderNumber={order.orderNumber} linkTo={orderDetailHref('/admin/orders', order.id, 'marketing')} />
              ),
      },
      {
        key: 'customer',
        header: 'Customer',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[9rem] max-w-[min(14rem,100%)]" />
          : (order) => (
              <span className="font-medium text-app-fg" title={order.customerName ?? undefined}>
                {clipName(order.customerName)}
                {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
                )}
              </span>
            ),
      },
    ];
    if (showMediaBuyerColumn) {
      cols.push({
        key: 'mediaBuyer',
        header: 'Media buyer',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[7rem]" />
          : (order) =>
              order.mediaBuyerId ? (
                <Link
                  to={`/hr/users/${order.mediaBuyerId}`}
                  className="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-semibold hover:underline"
                >
                  {order.mediaBuyerName ?? 'View user'}
                </Link>
              ) : (
                <span className="text-app-fg-muted">—</span>
              ),
      });
    }
    cols.push(
      {
        key: 'product',
        header: 'Product',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[10rem] max-w-[min(16rem,100%)]" />
          : (order) => {
              const name = order.primaryProductName?.trim();
              const extra =
                (order.itemCount ?? 0) > 1 ? ` · +${(order.itemCount ?? 0) - 1} more` : '';
              return name ? (
                <span className="text-sm text-app-fg truncate">
                  {name}
                  {extra ? <span className="text-app-fg-muted">{extra}</span> : null}
                </span>
              ) : (
                <span className="text-app-fg-muted">—</span>
              );
            },
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        render: showSkeletonRows
          ? () => (
              <span className="inline-flex w-full justify-start md:justify-end">
                <TableCellTextPulse className="w-[4.5rem]" />
              </span>
            )
          : (order) => (
              <span className="font-medium">
                <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
              </span>
            ),
      },
      {
        key: 'status',
        header: 'Status',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[5.5rem]" />
          : (order) =>
              order.status === 'CART' ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                  Cart
                </span>
              ) : (
                <OrderStatusBadge status={order.status} />
              ),
      },
      {
        key: 'created',
        header: 'Created',
        nowrap: true,
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[9rem]" />
          : (order) => (
              <span className="text-app-fg-muted whitespace-nowrap">
                {formatOrderTimestamp(order.createdAt)}
              </span>
            ),
      },
      {
        key: 'actions',
        header: '',
        align: 'center',
        tight: true,
        mobileShowLabel: false,
        render: showSkeletonRows
          ? () => <CompactTableActionButton disabled>View</CompactTableActionButton>
          : (order) =>
              order.status === 'CART' ? (
                <CompactTableActionButton
                  onClick={() => openCartDetail(order)}
                  disabled={cartDetailFetcher.state !== 'idle' && viewCartOrderId === order.id}
                >
                  View cart
                </CompactTableActionButton>
              ) : (
                <div className="inline-flex flex-nowrap items-center justify-end gap-1.5">
                  {order.lastCsComment && (
                    <CsCommentIcon comment={order.lastCsComment.comment} actorName={order.lastCsComment.actorName} />
                  )}
                  <CompactTableActionButton to={orderDetailHref('/admin/orders', order.id, 'marketing')}>View</CompactTableActionButton>
                </div>
              ),
      },
    );
    return cols;
  }, [showMediaBuyerColumn, showSkeletonRows, openCartDetail, cartDetailFetcher.state, viewCartOrderId]);

  // Mobile card — deliberately minimal: order ID (with copy), customer name,
  // status, and created time. The full label:value stack the default CompactTable
  // mobile card produces is too noisy here. The whole card is a tap target that
  // opens the order detail page; the copy button inside OrderIdBadge stops
  // propagation so copying never triggers the card navigation.
  const renderMarketingOrderMobileCard = useCallback(
    (order: Order, _index: number, _helpers: CompactTableMobileCardHelpers<Order>) => {
      if (showSkeletonRows) {
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <TableCellTextPulse className="w-[9rem]" />
              <TableCellTextPulse className="w-[7rem]" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <TableCellTextPulse className="w-[5.5rem]" />
              <TableCellTextPulse className="w-[8rem]" />
            </div>
          </div>
        );
      }
      const body = (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium text-app-fg" title={order.customerName ?? undefined}>
              {clipName(order.customerName)}
              {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-danger-300 bg-danger-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-danger-600 dark:border-danger-700 dark:bg-danger-900/30 dark:text-danger-400">Test</span>
              )}
              {order.isDuplicate === 'FLAGGED' && (
                <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-warning-300 bg-warning-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-warning-700 dark:border-warning-700 dark:bg-warning-900/30 dark:text-warning-400">Duplicate</span>
              )}
              {order.isDuplicate === 'POSSIBLY_DUPLICATE' && (
                <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Possible dup</span>
              )}
            </span>
            <OrderIdBadge id={order.id} orderNumber={order.orderNumber} textClassName="text-sm font-medium text-app-fg" />
          </div>
          <div className="flex items-center justify-between gap-2">
            {order.status === 'CART' ? (
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
          {order.lastCsComment && (
            <MobileCommentPreview comment={order.lastCsComment.comment} />
          )}
        </>
      );

      // Cart rows open the quick-detail modal; real orders open the peek modal.
      if (order.status === 'CART') {
        return (
          <button
            type="button"
            onClick={() => openCartDetail(order)}
            className="-mx-3 -my-2.5 block w-full space-y-1.5 px-3 py-2.5 text-left"
          >
            {body}
          </button>
        );
      }
      return (
        <button
          type="button"
          onClick={() => setPeekOrder(order)}
          className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] space-y-1.5 px-3 py-2.5 text-left"
        >
          {body}
        </button>
      );
    },
    [showSkeletonRows, openCartDetail, setPeekOrder],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={isMediaBuyer ? 'My Orders' : 'Marketing Orders'}
        mobileInlineActions
        description={
          isMediaBuyer
            ? 'Track your campaign orders.'
            : 'View orders by media buyer.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Marketing orders tools"
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
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime} chrome="pill" />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowChartView((v) => !v)}
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
                {canExport && (
                  <Button onClick={() => setShowExportModal(true)} variant="secondary" size="sm">
                    Generate report
                  </Button>
                )}
                {isTestOrdersView && (
                  <Button variant="danger" size="sm" onClick={() => setPurgeConfirmOpen(true)} disabled={purgeFetcher.state !== 'idle'}>
                    Delete all test orders
                  </Button>
                )}
              </>
            }
            filtersBadgeCount={ordersToolbarFilterBadge}
            filters={
              <>
                <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                  <FormSelect
                    value={selectedStatus}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    options={statusOptionsBase}
                    controlSize="sm"
                    className="!bg-transparent !border-transparent !text-center" inlineChevron
                    openAs="modal"
                    wrapperClassName="w-full"
                  />
                </div>
                {showMediaBuyerColumn && secondary.mediaBuyersForFilter.length > 0 ? (
                  <div className="relative">
                    {(searchParams.get('mediaBuyerId') || 'ALL') !== 'ALL' && (
                      <FilterDismiss onClear={() => {
                        setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('mediaBuyerId'); n.set('page', '1'); return n; });
                      }} />
                    )}
                    <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                      <SearchableSelect
                        id="marketing-orders-filter-buyer-sheet"
                        value={searchParams.get('mediaBuyerId') || 'ALL'}
                        onChange={(v) => {
                          setSearchParams((p) => {
                            const next = new URLSearchParams(p);
                            next.set('page', '1');
                            if (v && v !== 'ALL') next.set('mediaBuyerId', v);
                            else next.delete('mediaBuyerId');
                            return next;
                          });
                        }}
                        options={[
                          { value: 'ALL', label: 'All media buyers' },
                          ...secondary.mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
                        ]}
                        triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                        wrapperClassName="w-full"
                        placeholder="All media buyers"
                        searchPlaceholder="Search buyers…"
                      />
                    </div>
                  </div>
                ) : null}
                {secondary.productsForFilter.length > 0 ? (
                  <div className="relative">
                    {(searchParams.get('productId') || 'ALL') !== 'ALL' && (
                      <FilterDismiss onClear={() => {
                        setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('productId'); n.set('page', '1'); return n; });
                      }} />
                    )}
                    <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                      <SearchableSelect
                        id="marketing-orders-filter-product-sheet"
                        value={searchParams.get('productId') || 'ALL'}
                        onChange={(v) => {
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
                          ...secondary.productsForFilter.map((p) => ({ value: p.id, label: p.name })),
                        ]}
                        triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                        wrapperClassName="w-full"
                        placeholder="All products"
                        searchPlaceholder="Search products…"
                      />
                    </div>
                  </div>
                ) : null}
                {secondary.campaignsForFilter.length > 0 ? (
                  <div className="relative">
                    {(searchParams.get('campaignId') || 'ALL') !== 'ALL' && (
                      <FilterDismiss onClear={() => {
                        setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('campaignId'); n.set('page', '1'); return n; });
                      }} />
                    )}
                    <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                      <SearchableSelect
                        id="marketing-orders-filter-form-sheet"
                        value={searchParams.get('campaignId') || 'ALL'}
                        onChange={(v) => {
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
                          ...secondary.campaignsForFilter.map((c) => ({ value: c.id, label: c.name })),
                        ]}
                        triggerClassName="!bg-transparent !border-transparent !text-center" inlineChevron
                        wrapperClassName="w-full"
                        placeholder="All forms"
                        searchPlaceholder="Search forms…"
                      />
                    </div>
                  </div>
                ) : null}
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
              </>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={dateFilters.periodAllTime}
      />

      {isMarketingSupervisor && viewerUserId && (
        <FilterPills
          variant="tab"
          options={[
            { label: 'My Performance', value: 'personal' },
            { label: 'Team Performance', value: 'team' },
          ]}
          value={myTeamTab}
          onChange={(v) => {
            setMyTeamTab(v as 'personal' | 'team');
            setSearchParams((p) => {
              const next = new URLSearchParams(p);
              next.set('page', '1');
              if (v === 'personal') {
                next.set('mediaBuyerId', viewerUserId);
              } else {
                next.delete('mediaBuyerId');
              }
              return next;
            });
          }}
        />
      )}

      {(() => {
            const ins = secondary;
            // When the supervisor/HoM toggles to "My Performance", use the
            // pre-fetched personal stats for the stat strip instead of the
            // team stats. Picklists + chart always come from the team bundle.
            const activeSecondary =
              myTeamTab === 'personal' && personalSecondary ? personalSecondary : ins;
            const mediaBuyerFilterOptions = [
              { value: 'ALL', label: 'All media buyers' },
              ...ins.mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
            ];
            // KPI tiles use `metrics` from `getPerformanceMetrics` so Total /
            // Delivered / CR / DR match the dashboard (which uses the same source).
            // `statusCounts` is still used for the status filter dropdown and for
            // per-status click-through counts (Unassigned, Assigned, etc.).
            const defaultMetrics: MarketingMetrics = { totalOrders: 0, deliveredOrders: 0, deliveredRevenue: 0, confirmedOrders: 0, confirmationRate: 0, cpa: 0, trueRoas: 0, deliveryRate: 0, totalSpend: 0 };
            const m = activeSecondary.metrics ?? defaultMetrics;
            // statusCounts always from team bundle — drives status dropdown + per-status pills
            const statusCounts = ins.statusCounts;
            const statusTotal = Object.entries(statusCounts).filter(([k]) => k !== 'DELETED').reduce((sum, [, n]) => sum + n, 0);
            const unprocessedCount = statusCounts['UNPROCESSED'] ?? 0;
            const csAssignedCount = statusCounts['CS_ASSIGNED'] ?? 0;
            const unconfirmedCount = statusCounts['CS_ENGAGED'] ?? 0;
            const confirmedCount =
              (statusCounts['CONFIRMED'] ?? 0) +
              (statusCounts['AGENT_ASSIGNED'] ?? 0) +
              (statusCounts['DISPATCHED'] ?? 0) +
              (statusCounts['IN_TRANSIT'] ?? 0);
            const deletedCount = statusCounts['DELETED'] ?? 0;
            const statusOptions = [
              ...MARKETING_ORDERS_STATUSES.map((status) => ({
                value: status,
                label:
                  status === 'ALL'
                    ? `All Statuses (${statusTotal})`
                    : `${formatStatus(status)} (${statusCounts[status] ?? 0})`,
              })),
              ...(enableFromCartStatusOption
                ? [{ value: FROM_CART_STATUS_VALUE, label: 'Cart abandonment' }]
                : []),
              ...(enableTestOrdersOption
                ? [{ value: TEST_ORDERS_STATUS_VALUE, label: 'Test orders' }]
                : []),
            ];

            return (
              <>
                <OverviewStatStrip
                  mobileGrid
                  tileClassName="!py-2.5"
                  liveFlash={liveState.showGreen}
                  items={[
                    {
                      label: 'Total Orders',
                      value: m.totalOrders,
                      valueClassName: 'text-app-fg',
                      active: selectedStatus === 'ALL',
                      onClick: () => handleStatusChange('ALL'),
                    },
                    {
                      label: 'Unassigned',
                      value: unprocessedCount,
                      valueClassName: 'text-warning-600 dark:text-warning-400',
                      active: selectedStatus === 'UNPROCESSED',
                      onClick: () => handleStatusChange('UNPROCESSED'),
                    },
                    {
                      label: 'Assigned',
                      value: csAssignedCount,
                      valueClassName: 'text-info-600 dark:text-info-400',
                      active: selectedStatus === 'CS_ASSIGNED',
                      onClick: () => handleStatusChange('CS_ASSIGNED'),
                    },
                    {
                      label: 'Unconfirmed',
                      value: unconfirmedCount,
                      valueClassName: 'text-cyan-600 dark:text-cyan-400',
                      active: selectedStatus === 'CS_ENGAGED',
                      onClick: () => handleStatusChange('CS_ENGAGED'),
                    },
                    {
                      label: 'Confirmed',
                      value: m.confirmedOrders,
                      valueClassName: 'text-brand-600 dark:text-brand-400',
                      active: selectedStatus === 'CONFIRMED',
                      onClick: () => handleStatusChange('CONFIRMED'),
                    },
                    {
                      label: 'Delivered',
                      value: m.deliveredOrders,
                      valueClassName: m.deliveredOrders > 0 ? 'text-success-600 dark:text-success-400' : 'text-app-fg',
                      active: selectedStatus === 'DELIVERED',
                      onClick: () => handleStatusChange('DELIVERED'),
                    },
                    {
                      label: 'CR',
                      value: `${m.confirmationRate.toFixed(1)}%`,
                      valueClassName: confirmationRateColorClass(m.confirmationRate),
                      title: 'Confirmation Rate — confirmed / total in period (DELETED excluded)',
                    },
                    { label: 'DR', value: <>{m.deliveryRate.toFixed(1)}%</>, valueClassName: deliveryRateColorClass(m.deliveryRate), title: 'Delivery Rate — delivered / confirmed' },
                    {
                      label: 'Open carts',
                      value: activeSecondary.abandonedCartCount,
                      valueClassName:
                        activeSecondary.abandonedCartCount > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-app-fg',
                      title: 'Captured carts not yet recovered — tap to view the cart backlog',
                      active: selectedStatus === FROM_CART_STATUS_VALUE,
                      ...(enableFromCartStatusOption
                        ? { onClick: () => handleStatusChange(FROM_CART_STATUS_VALUE) }
                        : {}),
                    },
                    {
                      label: 'Deleted',
                      value: deletedCount,
                      valueClassName: deletedCount > 0
                        ? 'text-danger-600 dark:text-danger-400'
                        : 'text-app-fg',
                      active: selectedStatus === 'DELETED',
                      onClick: () => handleStatusChange('DELETED'),
                    },
                  ]}
                />

                <ToolbarFiltersCollapsible
                  hideMobileSheet
                  badgeCount={ordersToolbarFilterBadge}
                  searchRow={
                    <form onSubmit={handleSearchSubmit} className="flex min-w-0 flex-1 gap-2">
                      <SearchInput
                        placeholder="Search by name, order number, or ID..."
                        value={searchQuery}
                        onChange={(val) => setSearchQuery(val)}
                        withSubmitButton
                        wrapperClassName="min-w-0 flex-1"
                      />
                    </form>
                  }
                  desktopInlineFilters={
                    <>
                      <FormSelect
                        value={selectedStatus}
                        onChange={(e) => handleStatusChange(e.target.value)}
                        options={statusOptions}
                        wrapperClassName="w-auto min-w-[11rem]"
                      />
                      {showMediaBuyerColumn && ins.mediaBuyersForFilter.length > 0 ? (
                        <div className="relative">
                          {(searchParams.get('mediaBuyerId') || 'ALL') !== 'ALL' && (
                            <FilterDismiss onClear={() => {
                              setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('mediaBuyerId'); n.set('page', '1'); return n; });
                            }} />
                          )}
                          <SearchableSelect
                            id="marketing-orders-filter-buyer"
                            value={searchParams.get('mediaBuyerId') || 'ALL'}
                            onChange={(v) => {
                              setSearchParams((p) => {
                                const next = new URLSearchParams(p);
                                next.set('page', '1');
                                if (v && v !== 'ALL') next.set('mediaBuyerId', v);
                                else next.delete('mediaBuyerId');
                                return next;
                              });
                            }}
                            options={mediaBuyerFilterOptions}
                            wrapperClassName="w-full min-w-0 sm:w-56"
                            placeholder="All media buyers"
                            searchPlaceholder="Search buyers…"
                          />
                        </div>
                      ) : null}
                      {ins.productsForFilter.length > 0 ? (
                        <div className="relative">
                          {(searchParams.get('productId') || 'ALL') !== 'ALL' && (
                            <FilterDismiss onClear={() => {
                              setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('productId'); n.set('page', '1'); return n; });
                            }} />
                          )}
                          <SearchableSelect
                            id="marketing-orders-filter-product"
                            value={searchParams.get('productId') || 'ALL'}
                            onChange={(v) => {
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
                              ...ins.productsForFilter.map((p) => ({ value: p.id, label: p.name })),
                            ]}
                            wrapperClassName="w-full min-w-0 sm:w-48"
                            placeholder="All products"
                            searchPlaceholder="Search products…"
                          />
                        </div>
                      ) : null}
                      {ins.campaignsForFilter.length > 0 ? (
                        <div className="relative">
                          {(searchParams.get('campaignId') || 'ALL') !== 'ALL' && (
                            <FilterDismiss onClear={() => {
                              setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('campaignId'); n.set('page', '1'); return n; });
                            }} />
                          )}
                          <SearchableSelect
                            id="marketing-orders-filter-form"
                            value={searchParams.get('campaignId') || 'ALL'}
                            onChange={(v) => {
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
                              ...ins.campaignsForFilter.map((c) => ({ value: c.id, label: c.name })),
                            ]}
                            wrapperClassName="w-full min-w-0 sm:w-48"
                            placeholder="All forms"
                            searchPlaceholder="Search forms…"
                          />
                        </div>
                      ) : null}
                      <div className="relative">
                        {(sortByProp !== 'createdAt' || sortOrderProp !== 'desc') && (
                          <FilterDismiss onClear={() => {
                            setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('sortBy'); n.delete('sortOrder'); n.set('page', '1'); return n; });
                          }} />
                        )}
                        <FormSelect
                          value={`${sortByProp}:${sortOrderProp}`}
                          onChange={(e) => {
                            const [newSortBy, newSortOrder] = e.target.value.split(':');
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.set('page', '1');
                              if (newSortBy && newSortBy !== 'createdAt') next.set('sortBy', newSortBy);
                              else next.delete('sortBy');
                              if (newSortOrder && newSortOrder !== 'desc') next.set('sortOrder', newSortOrder);
                              else next.delete('sortOrder');
                              return next;
                            });
                          }}
                          options={[
                            { value: 'createdAt:desc', label: 'Newest first' },
                            { value: 'createdAt:asc', label: 'Oldest first' },
                            { value: 'totalAmount:desc', label: 'Highest amount' },
                            { value: 'totalAmount:asc', label: 'Lowest amount' },
                            { value: 'updatedAt:desc', label: 'Recently updated' },
                          ]}
                          wrapperClassName="w-full min-w-0 sm:w-44"
                        />
                      </div>
                      <div className="relative">
                        {(searchParams.get('orderSource') || '') !== '' && (
                          <FilterDismiss onClear={() => {
                            setSearchParams((p) => { const n = new URLSearchParams(p); n.delete('orderSource'); n.set('page', '1'); return n; });
                          }} />
                        )}
                        <FormSelect
                          value={searchParams.get('orderSource') || 'ALL'}
                          onChange={(e) => {
                            setSearchParams((p) => {
                              const next = new URLSearchParams(p);
                              next.set('page', '1');
                              if (e.target.value && e.target.value !== 'ALL') next.set('orderSource', e.target.value);
                              else next.delete('orderSource');
                              return next;
                            });
                          }}
                          options={[
                            { value: 'ALL', label: 'All sources' },
                            { value: 'edge-form', label: 'Online orders' },
                            { value: 'offline', label: 'Offline orders' },
                          ]}
                          wrapperClassName="w-full min-w-0 sm:w-40"
                        />
                      </div>
                    </>
                  }
                  sheetFilterBody={null}
                />
              </>
            );
      })()}

      {showChartView ? (
        showSkeletonRows ? (
          <OrdersChartViewShellSkeleton />
        ) : (
          <OrdersChartView
            statusCounts={secondary.statusCounts}
            total={Object.values(secondary.statusCounts).reduce((sum, n) => sum + n, 0)}
            scopeLabel="Marketing orders"
            dailyCounts={secondary.dailyCounts}
            collapseForCS
          />
        )
      ) : (
      <>
      <div className="list-panel scroll-mt-4">
        <CompactTable<Order>
          withCard={false}
          columns={marketingOrderColumns}
          rows={showSkeletonRows ? DEFERRED_PLACEHOLDER_ROWS : orders}
          rowKey={(order) => order.id}
          rowClassName={() => liveState.showGreen ? 'animate-live-flash-row' : ''}
          renderMobileCard={renderMarketingOrderMobileCard}
          emptyTitle={isCartAbandonmentView ? 'No abandoned carts' : 'No orders match your filters'}
          emptyDescription={
            isCartAbandonmentView
              ? 'Every captured cart has been recovered or cleared.'
              : 'Try adjusting your status filter or search query'
          }
        />
      </div>
      {/* Pagination — same layout as Sales Orders list; page size is fixed at 20 in the route loader.
          We deliberately gate the skeleton on `deferredLoading` (initial Suspense fallback) NOT
          `showSkeletonRows` (which also goes true on `isLoaderRefetchBusy`). Reason: the pointerdown
          handler in `useLoaderRefetchBusy` calls `flushSync(setArmed(true))` synchronously, which
          would re-render this section between the click's pointerdown and click events. If the real
          `<Pagination>` is replaced with non-interactive skeleton bars in that gap, the browser
          loses its click target and the navigation never fires — pagination clicks silently no-op.
          Keep Pagination mounted across refetches so click handlers stay alive. */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {deferredLoading ? (
          <>
            <p className="text-sm m-0 min-h-[1.25rem] flex items-center">
              <span
                className="inline-block h-4 w-52 max-w-[90vw] rounded-md bg-app-border/75 dark:bg-app-border/60 animate-pulse sm:w-72"
                aria-hidden
              />
            </p>
            <div className="flex items-center gap-2 shrink-0" aria-hidden>
              <span className="inline-block h-8 w-[4.5rem] rounded-lg bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
              <span className="inline-block h-8 w-28 rounded-lg bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
              <span className="inline-block h-8 w-[4.5rem] rounded-lg bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-app-fg-muted">
              {(() => {
                const noun = isCartAbandonmentView ? 'carts' : 'orders';
                return total > 0
                  ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} ${noun}`
                  : `No ${noun}`;
              })()}
            </p>
            <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} />
          </>
        )}
      </div>
      </>
      )}

      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.marketing_orders}
        picklists={secondary.marketingExportPicklists}
        initialFilters={{
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          search: searchQuery || undefined,
          mediaBuyerId: searchParams.get('mediaBuyerId') || undefined,
          ...(dateFilters.periodAllTime
            ? { periodAllTime: true as const }
            : dateFilters.startDate && dateFilters.endDate
              ? { startDate: dateFilters.startDate, endDate: dateFilters.endDate }
              : {}),
        }}
      />

      {/* Quick-detail modal for an abandoned cart row (read-only on the Marketing
          page — recover / clear / phone-reveal stay CS-side). */}
      <AbandonedCartDetailModal
        cart={
          viewCartOrderId && cartDetailFetcher.state === 'idle'
            ? cartDetailFetcher.data?.cart ?? null
            : null
        }
        canReveal={false}
        cartStatus="ABANDONED"
        onClose={() => setViewCartOrderId(null)}
      />

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
                loadingText="Cancelling..."
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

      {/* Mobile peek modal — shows order details + actions */}
      <Modal
        open={!!peekOrder}
        onClose={() => setPeekOrder(null)}
        maxWidth="max-w-sm"
        contentClassName="p-5"
      >
        {peekOrder && (() => {
          const o = peekOrder;
          return (
            <div className="space-y-4">
              {/* Header: customer + order ID */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-app-fg truncate min-w-0" title={o.customerName ?? undefined}>{clipName(o.customerName)}</p>
                <OrderIdBadge id={o.id} orderNumber={o.orderNumber} textClassName="text-sm font-medium text-app-fg" />
              </div>

              {/* Details */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Status</span>
                  <OrderStatusBadge status={o.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Product</span>
                  <span className="text-app-fg text-right truncate max-w-[60%]">
                    {o.primaryProductName?.trim() || '—'}
                    {(o.itemCount ?? 0) > 1 ? <span className="text-app-fg-muted"> +{(o.itemCount ?? 0) - 1}</span> : null}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Amount</span>
                  <span className="font-medium">
                    <NairaPrice amount={o.totalAmount ? Number(o.totalAmount) : null} />
                  </span>
                </div>
                {o.campaignName?.trim() && (
                  <div className="flex justify-between">
                    <span className="text-app-fg-muted">Form</span>
                    <span className="text-app-fg text-right truncate max-w-[60%]">{o.campaignName}</span>
                  </div>
                )}
                {o.mediaBuyerName && (
                  <div className="flex justify-between">
                    <span className="text-app-fg-muted">Media buyer</span>
                    <span className="text-app-fg text-right truncate max-w-[60%]">{o.mediaBuyerName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Created</span>
                  <span className="text-app-fg">{formatOrderTimestamp(o.createdAt)}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-app-border">
                <Link
                  to={orderDetailHref('/admin/orders', o.id, 'marketing')}
                  prefetch="intent"
                  className="btn-primary btn-sm inline-flex flex-1 items-center justify-center"
                  onClick={() => setPeekOrder(null)}
                >
                  View order
                </Link>
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
