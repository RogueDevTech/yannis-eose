import { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { Await, Link, useFetcher, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
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
import { DeferredError } from '~/components/ui/deferred-section';
import {
  OrdersChartViewShellSkeleton,
  StatValuePulse,
  TableCellTextPulse,
} from '~/components/ui/deferred-skeletons';

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
 * plus Cancelled, minus Cash Remitted — remittance is accountant-only and never
 * relevant to a marketing view of the funnel.
 */
const MARKETING_ORDERS_STATUSES = [
  ...STATUS_OPTIONS.filter((status) => status !== 'REMITTED'),
  'CANCELLED',
];

/** Status dropdown labels before streamed counts hydrate (same order as full options). */
const MARKETING_ORDERS_STATUS_OPTIONS_BASE = MARKETING_ORDERS_STATUSES.map((status) => ({
  value: status,
  label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
}));

/** Sentinel — not a real order status. Selecting it activates the `?fromCart=1` view. */
const FROM_CART_STATUS_VALUE = '__from_cart__';
const TEST_ORDERS_STATUS_VALUE = '__test_orders__';

/** Streamed after `orders.list`: counts, metrics, chart series, export picklists + buyer filter options. */
export type MarketingOrdersSecondaryPayload = {
  statusCounts: Record<string, number>;
  cpa: number | null;
  totalAdSpend: number | null;
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
  secondary: Promise<MarketingOrdersSecondaryPayload>;
  statusFilter?: string;
  searchFilter?: string;
  isMediaBuyer: boolean;
  /** True when the viewer is a marketing-team supervisor. */
  isMarketingSupervisor?: boolean;
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
  statusFilter,
  searchFilter,
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
  const [showChartView, setShowChartView] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
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
  }, [statusFilter, searchFilter, enableFromCartStatusOption, fromCartUrlActive, enableTestOrdersOption, testOrdersUrlActive]);

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

  const buildQueryString = (overrides: { page?: number; status?: string; search?: string; mediaBuyerId?: string }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.page !== undefined) params.set('page', String(overrides.page));
    // Always pass `status` when changing the status filter (including ALL) so the URL stays in sync.
    // The "Cart abandonment" pseudo-status maps to `?fromCart=1` (and drops `status`);
    // selecting any real status clears `fromCart`.
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
    // Always pass `search` when submitting the search form (including empty to clear).
    if (overrides.search !== undefined) {
      if (overrides.search) params.set('search', overrides.search);
      else params.delete('search');
    }
    if (overrides.mediaBuyerId !== undefined) {
      if (overrides.mediaBuyerId && overrides.mediaBuyerId !== 'ALL') params.set('mediaBuyerId', overrides.mediaBuyerId);
      else params.delete('mediaBuyerId');
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSearchParams(buildQueryString({ status, page: 1 }));
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(buildQueryString({ search: searchQuery.trim(), page: 1 }));
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
              <span className="font-medium text-app-fg">
                {order.customerName}
                {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                  <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-surface-300/80 bg-surface-100 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-surface-500 dark:border-surface-600/50 dark:bg-surface-800/50 dark:text-surface-400">Test</span>
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
                  className="text-brand-500 hover:text-brand-600 font-medium hover:underline"
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
        key: 'campaign',
        header: 'Form',
        render: showSkeletonRows
          ? () => <TableCellTextPulse className="w-[8rem]" />
          : (order) => (
              <span className="text-sm text-app-fg-muted truncate">
                {order.campaignName?.trim() ? order.campaignName : '—'}
              </span>
            ),
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
                <CompactTableActionButton to={orderDetailHref('/admin/orders', order.id, 'marketing')}>View</CompactTableActionButton>
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
            <span className="min-w-0 truncate text-sm font-medium text-app-fg">
              {order.customerName || '—'}
              {/^test([^a-zA-Z]|$)/i.test(order.customerName?.trim() ?? '') && (
                <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-surface-300/80 bg-surface-100 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-surface-500 dark:border-surface-600/50 dark:bg-surface-800/50 dark:text-surface-400">Test</span>
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
        </>
      );

      // Cart rows open the quick-detail modal; real orders link to order detail.
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
        <Link
          to={orderDetailHref('/admin/orders', order.id, 'marketing')}
          className="-mx-3 -my-2.5 block space-y-1.5 px-3 py-2.5"
        >
          {body}
        </Link>
      );
    },
    [showSkeletonRows, openCartDetail],
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
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowChartView((v) => !v)}
                >
                  {showChartView ? 'View as data' : 'View data in chart'}
                </Button>
                {canExport && (
                  <Suspense
                    fallback={
                      <Button type="button" variant="secondary" size="sm" disabled>
                        Generate report…
                      </Button>
                    }
                  >
                    <Await resolve={secondary}>
                      {() => (
                        <Button onClick={() => setShowExportModal(true)} variant="secondary" size="sm">
                          Generate report
                        </Button>
                      )}
                    </Await>
                  </Suspense>
                )}
                {isTestOrdersView && (
                  <Button variant="danger" size="sm" onClick={() => setPurgeConfirmOpen(true)} disabled={purgeFetcher.state !== 'idle'}>
                    Cancel all test orders
                  </Button>
                )}
                <PageRefreshButton />
              </>
            }
            filtersBadgeCount={ordersToolbarFilterBadge}
            filters={
              <>
                <FormSelect
                  value={selectedStatus}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  options={statusOptionsBase}
                  controlSize="lg"
                  className="!bg-app-hover text-center"
                  wrapperClassName="w-full"
                />
                <Suspense fallback={null}>
                  <Await resolve={secondary}>
                    {(ins) => {
                      const mediaBuyerFilterOptions = [
                        { value: 'ALL', label: 'All media buyers' },
                        ...ins.mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
                      ];
                      return (
                        <>
                          {showMediaBuyerColumn && ins.mediaBuyersForFilter.length > 0 ? (
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
                              options={mediaBuyerFilterOptions}
                              controlSize="lg"
                              triggerClassName="!bg-app-hover text-center"
                              wrapperClassName="w-full"
                              placeholder="All media buyers"
                              searchPlaceholder="Search buyers…"
                            />
                          ) : null}
                          {ins.productsForFilter.length > 0 ? (
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
                                ...ins.productsForFilter.map((p) => ({ value: p.id, label: p.name })),
                              ]}
                              controlSize="lg"
                              triggerClassName="!bg-app-hover text-center"
                              wrapperClassName="w-full"
                              placeholder="All products"
                              searchPlaceholder="Search products…"
                            />
                          ) : null}
                          {ins.campaignsForFilter.length > 0 ? (
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
                                ...ins.campaignsForFilter.map((c) => ({ value: c.id, label: c.name })),
                              ]}
                              controlSize="lg"
                              triggerClassName="!bg-app-hover text-center"
                              wrapperClassName="w-full"
                              placeholder="All forms"
                              searchPlaceholder="Search forms…"
                            />
                          ) : null}
                        </>
                      );
                    }}
                  </Await>
                </Suspense>
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
                {canExport && (
                  <Suspense
                    fallback={
                      <Button type="button" variant="secondary" size="sm" className="w-full justify-center" disabled>
                        Generate report…
                      </Button>
                    }
                  >
                    <Await resolve={secondary}>
                      {() => (
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
                    </Await>
                  </Suspense>
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
            { label: 'My Orders', value: 'personal' },
            { label: 'Team Orders', value: 'team' },
          ]}
          value={activeMediaBuyerFilter === viewerUserId ? 'personal' : 'team'}
          onChange={(v) => {
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

      <Suspense
        fallback={
          <>
            <OverviewStatStrip
              mobileGrid
              tileClassName="!py-2.5"
              items={[
                { label: 'Total', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Unprocessed', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Confirmed', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Delivered', value: <StatValuePulse className="min-w-[2rem]" /> },
                { label: 'Delivery Rate', value: <StatValuePulse className="min-w-[3rem]" /> },
                { label: 'CPA', value: <StatValuePulse className="min-w-[4rem]" /> },
                { label: 'Cancelled', value: <StatValuePulse className="min-w-[2rem]" /> },
              ]}
            />

            <ToolbarFiltersCollapsible
              hideMobileSheet
              badgeCount={ordersToolbarFilterBadge}
              sheetSubtitle={<span>Status and media buyer apply immediately</span>}
              searchRow={
                <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
                  <SearchInput
                    placeholder="Search by customer or order ID..."
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
                    options={statusOptionsBase}
                    wrapperClassName="w-auto min-w-[11rem]"
                  />
                  {showMediaBuyerColumn ? (
                    <div
                      className="h-9 w-full min-w-0 rounded-md border border-app-border bg-app-hover/90 animate-pulse sm:w-56"
                      aria-hidden
                    />
                  ) : null}
                </>
              }
              sheetFilterBody={null}
            />
          </>
        }
      >
        <Await resolve={secondary} errorElement={<DeferredError />}>
          {(ins) => {
            const mediaBuyerFilterOptions = [
              { value: 'ALL', label: 'All media buyers' },
              ...ins.mediaBuyersForFilter.map((b) => ({ value: b.id, label: b.name })),
            ];
            const statusCounts = ins.statusCounts;
            const ordersInPeriodTotal = Object.values(statusCounts).reduce((sum, n) => sum + n, 0);
            const unprocessedCount = statusCounts['UNPROCESSED'] ?? 0;
            const csAssignedCount = statusCounts['CS_ASSIGNED'] ?? 0;
            const unconfirmedCount = statusCounts['CS_ENGAGED'] ?? 0;
            // "Confirmed" rolls up the full post-confirmation in-flight pipeline
            // so this count matches the OrderStatusBadge default.
            const confirmedCount =
              (statusCounts['CONFIRMED'] ?? 0) +
              (statusCounts['AGENT_ASSIGNED'] ?? 0) +
              (statusCounts['DISPATCHED'] ?? 0) +
              (statusCounts['IN_TRANSIT'] ?? 0);
            const deliveredCount = statusCounts['DELIVERED'] ?? 0;
            const cancelledCount = statusCounts['CANCELLED'] ?? 0;
            // Overview strip is a fixed snapshot of the period — it must not
            // shift when the table's status filter (or the cart view) changes.
            // Everything here is derived from `statusCounts` (the period
            // aggregate), never from `total` (the filtered list count).
            const deliveryRate =
              ordersInPeriodTotal > 0
                ? (((statusCounts['DELIVERED'] ?? 0) / ordersInPeriodTotal) * 100).toFixed(1)
                : '0';
            const statusOptions = [
              ...MARKETING_ORDERS_STATUSES.map((status) => ({
                value: status,
                label:
                  status === 'ALL'
                    ? `All Statuses (${ordersInPeriodTotal})`
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
                  items={[
                    {
                      label: 'Total',
                      value: ordersInPeriodTotal,
                      valueClassName: 'text-app-fg',
                      to: buildQueryString({ status: 'ALL', page: 1 }),
                      active: selectedStatus === 'ALL',
                      onClick: () => setSelectedStatus('ALL'),
                    },
                    {
                      label: 'Unassigned',
                      value: unprocessedCount,
                      valueClassName: 'text-warning-600 dark:text-warning-400',
                      to: buildQueryString({ status: 'UNPROCESSED', page: 1 }),
                      active: selectedStatus === 'UNPROCESSED',
                      onClick: () => setSelectedStatus('UNPROCESSED'),
                    },
                    {
                      label: 'Assigned',
                      value: csAssignedCount,
                      valueClassName: 'text-info-600 dark:text-info-400',
                      to: buildQueryString({ status: 'CS_ASSIGNED', page: 1 }),
                      active: selectedStatus === 'CS_ASSIGNED',
                      onClick: () => setSelectedStatus('CS_ASSIGNED'),
                    },
                    {
                      label: 'Unconfirmed',
                      value: unconfirmedCount,
                      valueClassName: 'text-cyan-600 dark:text-cyan-400',
                      to: buildQueryString({ status: 'CS_ENGAGED', page: 1 }),
                      active: selectedStatus === 'CS_ENGAGED',
                      onClick: () => setSelectedStatus('CS_ENGAGED'),
                    },
                    {
                      label: 'Confirmed',
                      value: confirmedCount,
                      valueClassName: 'text-brand-600 dark:text-brand-400',
                      active: selectedStatus === 'CONFIRMED',
                      to: buildQueryString({ status: 'CONFIRMED', page: 1 }),
                      onClick: () => setSelectedStatus('CONFIRMED'),
                    },
                    {
                      label: 'Delivered',
                      value: deliveredCount,
                      valueClassName: 'text-success-600 dark:text-success-400',
                      to: buildQueryString({ status: 'DELIVERED', page: 1 }),
                      active: selectedStatus === 'DELIVERED',
                      onClick: () => setSelectedStatus('DELIVERED'),
                    },
                    {
                      label: 'Open carts',
                      value: ins.abandonedCartCount,
                      valueClassName:
                        ins.abandonedCartCount > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-app-fg',
                      title: 'Captured carts not yet recovered — tap to view the cart backlog',
                      active: selectedStatus === FROM_CART_STATUS_VALUE,
                      ...(enableFromCartStatusOption
                        ? {
                            to: buildQueryString({ status: FROM_CART_STATUS_VALUE, page: 1 }),
                            onClick: () => setSelectedStatus(FROM_CART_STATUS_VALUE),
                          }
                        : {}),
                    },
                    { label: 'Delivery Rate', value: <>{deliveryRate}%</>, valueClassName: 'text-app-fg' },
                    {
                      label: 'CPA',
                      value:
                        ins.cpa != null ? (
                          <>
                            {'\u20A6'}
                            {Number(ins.cpa).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </>
                        ) : (
                          '\u2014'
                        ),
                      valueClassName: 'text-app-fg',
                    },
                    {
                      label: 'Cancelled',
                      value: cancelledCount,
                      valueClassName:
                        cancelledCount > 0
                          ? 'text-danger-600 dark:text-danger-400'
                          : 'text-app-fg',
                      to: buildQueryString({ status: 'CANCELLED', page: 1 }),
                      active: selectedStatus === 'CANCELLED',
                      onClick: () => setSelectedStatus('CANCELLED'),
                    },
                  ]}
                />

                <ToolbarFiltersCollapsible
                  hideMobileSheet
                  badgeCount={ordersToolbarFilterBadge}
                  sheetSubtitle={<span>Status and media buyer apply immediately</span>}
                  searchRow={
                    <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
                      <SearchInput
                        placeholder="Search by customer or order ID..."
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
                      ) : null}
                      {ins.productsForFilter.length > 0 ? (
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
                      ) : null}
                      {ins.campaignsForFilter.length > 0 ? (
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
                      ) : null}
                    </>
                  }
                  sheetFilterBody={null}
                />
              </>
            );
          }}
        </Await>
      </Suspense>

      {showChartView ? (
        showSkeletonRows ? (
          <OrdersChartViewShellSkeleton />
        ) : (
          <Suspense fallback={<OrdersChartViewShellSkeleton />}>
            <Await resolve={secondary} errorElement={<DeferredError />}>
              {(ins) => {
                const ordersInPeriodTotal = Object.values(ins.statusCounts).reduce((sum, n) => sum + n, 0);
                return (
                  <OrdersChartView
                    statusCounts={ins.statusCounts}
                    total={ordersInPeriodTotal}
                    scopeLabel="Marketing orders"
                    dailyCounts={ins.dailyCounts}
                  />
                );
              }}
            </Await>
          </Suspense>
        )
      ) : (
      <>
      <div className="list-panel scroll-mt-4">
        <CompactTable<Order>
          withCard={false}
          columns={marketingOrderColumns}
          rows={showSkeletonRows ? DEFERRED_PLACEHOLDER_ROWS : orders}
          rowKey={(order) => order.id}
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

      <Suspense fallback={null}>
        <Await resolve={secondary}>
          {(s) => (
            <ExportModal
              open={showExportModal}
              onClose={() => setShowExportModal(false)}
              config={EXPORT_CONFIGS.marketing_orders}
              picklists={s.marketingExportPicklists}
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
          )}
        </Await>
      </Suspense>

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
          <h3 className="text-lg font-semibold text-app-fg mb-2">Cancel all test orders</h3>
          <p className="text-sm text-app-fg-muted mb-4">
            This will cancel all orders where the customer name contains &ldquo;test&rdquo;. Only pre-confirmation orders (unprocessed, assigned, engaged) are affected &mdash; stock-moved orders are skipped.
          </p>
          {purgeFetcher.state === 'idle' && purgeFetcher.data ? (
            <div className="mb-4">
              {purgeFetcher.data.success ? (
                <div className="rounded-lg border border-success-300 bg-success-50 dark:border-success-700 dark:bg-success-900/20 px-4 py-3">
                  <p className="text-sm font-semibold text-success-700 dark:text-success-300">
                    {purgeFetcher.data.deleted ?? 0} test order{(purgeFetcher.data.deleted ?? 0) !== 1 ? 's' : ''} cancelled
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
                    {purgeFetcher.data.error ?? 'Failed to cancel test orders'}
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
                Cancel all test orders
              </Button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
