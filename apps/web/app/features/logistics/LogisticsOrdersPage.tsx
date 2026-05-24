import { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { Await, Link, useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { ModalFetcherInlineError, useFetcherActionSurface } from '~/hooks/use-fetcher-action-surface';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { FileUpload } from '~/components/ui/file-upload';
import { ASSET_FOLDERS } from '~/lib/object-storage';
import { orderDetailHref, type OrderDetailListFrom } from '~/lib/order-detail-return';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { DeferredError } from '~/components/ui/deferred-section';
import { OrdersChartViewShellSkeleton, StatValuePulse } from '~/components/ui/deferred-skeletons';
import { OrdersChartView } from '~/components/ui/orders-chart-view-lazy';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { Spinner } from '~/components/ui/spinner';
import {
  CompactTable,
  CompactTableActions,
  type CompactTableColumn,
  type CompactTableMobileCardHelpers,
} from '~/components/ui/compact-table';
import { TableActionButton } from '~/components/ui/table-action-button';
import { Pagination } from '~/components/ui/pagination';
import { TextInput } from '~/components/ui/text-input';
import { formatStatus } from '~/features/shared/order-status';
import { formatOrderTimestamp } from '~/lib/format-date';
import type { Order } from '~/features/orders/types';
import type { Location } from './types';

const LOGISTICS_STATUS_OPTIONS = ['ALL', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'] as const;

export interface LogisticsOrderRow extends Order {
  logisticsLocationId?: string | null;
  riderId?: string | null;
  deliveryNotes?: string | null;
  preferredDeliveryDate?: string | null;
  locationName: string;
  locationProviderName: string | null;
  riderName: string;
}

export interface RiderOption {
  id: string;
  name: string;
  logisticsLocationId: string | null;
}

/** Streamed after `orders.list` when using `deferredSecondary` (admin logistics + TPL orders). */
export type LogisticsOrdersDeferredSecondary = {
  statusCounts: Record<string, number>;
  locations: Location[];
  /** TPL orders route — riders for dispatch picklists and row labels. */
  riders?: RiderOption[];
  /** TPL — scope-filtered allocate targets; omitted on admin (derived from `locations`). */
  allocatableLocations?: Location[];
};

interface LogisticsOrdersPageProps {
  orders: LogisticsOrderRow[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  /** Omitted when `deferredSecondary` is used (admin logistics route). */
  statusCounts?: Record<string, number>;
  statusFilter?: string;
  searchFilter?: string;
  listErrorMessage?: string;
  /** Omitted when `deferredSecondary` is used. */
  locations?: Location[];
  /** Stream counts + locations (+ optional riders / TPL allocatable list) after `orders.list`. */
  deferredSecondary?: Promise<LogisticsOrdersDeferredSecondary>;
  /** When provided (e.g. TPL), only these locations in allocate dropdown; else locations where !dispatchLocked */
  allocatableLocations?: Location[];
  riders: RiderOption[];
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  isTplManagerScoped?: boolean;
  /** Override page title (e.g. "Orders" for 3PL layout) */
  pageTitle?: string;
  /** Base path for order detail links (e.g. "/tpl/orders" for TPL, "/admin/logistics/orders" for admin) */
  orderDetailBasePath?: string;
  /**
   * When opening unified `/admin/orders/:id`, append `?from=` so breadcrumb "Orders" returns here
   * (important for admin-class users who are not logistics-role in session).
   */
  orderDetailFrom?: OrderDetailListFrom | null;
  /**
   * When true, pipeline actions (allocate, dispatch, in-transit, mark delivered) live on the order
   * detail page only — the list shows View (and optional TPL-only controls like Resolve order).
   */
  allocationOnDetailOnly?: boolean;
  /** When true, show Edit button to change preferred delivery date (e.g. TPL orders page) */
  canEditDeliveryDate?: boolean;
  /** Label for DISPATCHED → IN_TRANSIT button (e.g. "Mark In Transit" for TPL, default "Start Delivery") */
  markInTransitLabel?: string;
  /** Daily order count series for the "Orders over time" chart (from `orders.timeSeriesByCreated`). */
  dailyCounts?: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
  /** Optional hero description under the page title */
  pageDescription?: string;
  /**
   * Caller-driven skeleton mode — used by the admin route's `CachedAwait`
   * fallback path so the table body renders skeleton rows while the loader
   * resolves. The component itself flips this on internally when
   * `deferredSecondary` is awaiting, but the route also needs to pass it for
   * the first-paint fallback before `pageData` arrives.
   */
  deferredLoading?: boolean;
}

// ── Delivery Date Helpers (above page — used by column memo) ─────────────────

function formatDeliveryDate(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isOverdue(date: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deliveryDate = new Date(date + 'T00:00:00');
  return deliveryDate < today;
}

function isToday(date: string): boolean {
  const today = new Date();
  const d = new Date(date + 'T00:00:00');
  return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

/** Preferred date vs calendar "overdue" only applies while the order is still in flight. */
const DELIVERY_DATE_FULFILLED_STATUSES = new Set([
  'DELIVERED',
  'REMITTED',
  'PARTIALLY_DELIVERED',
]);

function DeliveryDateCell({ date, status }: { date?: string | null; status: string }) {
  if (!date) {
    return <span className="text-app-fg-muted text-sm">Not set</span>;
  }

  const fulfilled = DELIVERY_DATE_FULFILLED_STATUSES.has(status);
  const overdue = !fulfilled && isOverdue(date);
  const today = !fulfilled && isToday(date);

  return (
    <span
      className={`text-sm font-medium ${
        fulfilled
          ? 'text-success-600 dark:text-success-400'
          : overdue
            ? 'text-danger-600 dark:text-danger-400'
            : today
              ? 'text-warning-600 dark:text-warning-400'
              : 'text-app-fg'
      }`}
    >
      {formatDeliveryDate(date)}
      {overdue && <span className="ml-1 text-xs font-normal">(overdue)</span>}
      {today && <span className="ml-1 text-xs font-normal">(today)</span>}
    </span>
  );
}

function LogisticsOrdersPageImpl({
  orders,
  total,
  totalPages,
  page,
  limit,
  statusCounts: statusCountsProp,
  statusFilter,
  searchFilter,
  listErrorMessage,
  locations: locationsProp,
  allocatableLocations: allocatableLocationsProp,
  riders,
  filters,
  isTplManagerScoped = false,
  pageTitle = 'Logistics Orders',
  orderDetailBasePath = '/admin/logistics/orders',
  orderDetailFrom = null,
  allocationOnDetailOnly = false,
  canEditDeliveryDate = false,
  markInTransitLabel = 'Start Delivery',
  dailyCounts,
  pageDescription = 'Confirmed and in-flight orders. Open one to allocate, dispatch, or confirm delivery.',
  deferredLoading = false,
}: LogisticsOrdersPageProps & { deferredLoading?: boolean }) {
  const statusCounts = statusCountsProp ?? {};
  const locations = locationsProp ?? [];

  const displayOrders = useMemo((): LogisticsOrderRow[] => {
    const locationNameById = new Map(locations.map((l) => [l.id, l.name]));
    const locationProviderById = new Map(locations.map((l) => [l.id, l.providerName ?? null]));
    const riderById = new Map(riders.map((r) => [r.id, r]));
    return orders.map((o) => ({
      ...o,
      locationName: o.logisticsLocationId ? locationNameById.get(o.logisticsLocationId) ?? '—' : '—',
      locationProviderName: o.logisticsLocationId ? locationProviderById.get(o.logisticsLocationId) ?? null : null,
      riderName: o.riderId ? riderById.get(o.riderId)?.name ?? '—' : '—',
    }));
  }, [orders, locations, riders]);

  const toOrderDetail = useCallback(
    (orderId: string) => orderDetailHref(orderDetailBasePath, orderId, orderDetailFrom ?? undefined),
    [orderDetailBasePath, orderDetailFrom],
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [showChartView, setShowChartView] = useState(false);
  const isFilterLoading = useLoaderRefetchBusy().busy;
  const trendFetcher = useFetcher<{
    ok: boolean;
    dailyCounts: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
    error: string | null;
  }>();
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allocateLocationId, setAllocateLocationId] = useState('');
  const [dispatchRiderId, setDispatchRiderId] = useState('');
  const [rowAllocateLocationByOrder, setRowAllocateLocationByOrder] = useState<Record<string, string>>({});
  const [rowDispatchRiderByOrder, setRowDispatchRiderByOrder] = useState<Record<string, string>>({});
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; errors: string[] } | null>(null);

  const [peekOrder, setPeekOrder] = useState<LogisticsOrderRow | null>(null);
  const [deliverConfirm, setDeliverConfirm] = useState<{ orderId: string; customerName: string } | null>(null);
  const [deliverConfirmDiscount, setDeliverConfirmDiscount] = useState('');
  const [deliverConfirmDeliveryCost, setDeliverConfirmDeliveryCost] = useState('');
  const [editDeliveryDateOrder, setEditDeliveryDateOrder] = useState<{
    orderId: string;
    customerName: string;
    preferredDeliveryDate: string | null;
  } | null>(null);

  const fetcher = useFetcher();
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const logisticsMutationsModalOpen = !!deliverConfirm || !!editDeliveryDateOrder;
  const fetcherResult = fetcher.data as {
    success?: boolean;
    deliveryConfirmation?: boolean;
    intent?: string;
  } | undefined;
  useFetcherToast(fetcher.data, {
    successMessage:
      fetcherResult?.intent === 'updateDeliveryDate'
        ? 'Delivery date updated'
        : fetcherResult?.deliveryConfirmation
          ? 'Delivery confirmation submitted for approval'
          : 'Logistics action completed',
    skipErrorToast: logisticsMutationsModalOpen,
  });

  // Close deliver confirm modal on success
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcherResult?.success && deliverConfirm) {
      setDeliverConfirm(null);
      setDeliverConfirmDiscount('');
      setDeliverConfirmDeliveryCost('');
    }
  }, [fetcher.state, fetcherResult, deliverConfirm]);

  // Close Resolve order modal after request completes (success or error) so user is not stuck
  useEffect(() => {
    if (
      fetcher.state === 'idle' &&
      fetcher.data &&
      typeof fetcher.data === 'object' &&
      (fetcher.data as { intent?: string }).intent === 'updateDeliveryDate' &&
      editDeliveryDateOrder
    ) {
      setEditDeliveryDateOrder(null);
    }
  }, [fetcher.state, fetcher.data, editDeliveryDateOrder]);

  useEffect(() => {
    setSelectedStatus(statusFilter || 'ALL');
    setSearchQuery(searchFilter || '');
  }, [statusFilter, searchFilter]);

  const trendQueryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('status', statusFilter || 'ALL');
    if (filters.startDate) p.set('startDate', filters.startDate);
    if (filters.endDate) p.set('endDate', filters.endDate);
    if (filters.periodAllTime) p.set('periodAllTime', 'true');
    return p.toString();
  }, [statusFilter, filters.startDate, filters.endDate, filters.periodAllTime]);

  useEffect(() => {
    void trendFetcher.load(`/api/logistics-orders-trend?${trendQueryString}`);
  }, [trendQueryString]);

  const trendCounts = trendFetcher.data?.ok ? trendFetcher.data.dailyCounts : dailyCounts;
  const trendLoading = trendFetcher.state === 'loading' && !trendFetcher.data;

  useEffect(() => {
    if (fetcher.data && typeof fetcher.data === 'object' && 'results' in fetcher.data && !bulkResult) {
      const data = fetcher.data as { succeeded?: number; failed?: number; results?: Array<{ orderId: string; success: boolean; error?: string }> };
      const errors = (data.results ?? [])
        .filter((r) => !r.success)
        .map((r) => `${r.orderId.slice(0, 8)}...: ${r.error ?? 'Unknown'}`);
      setBulkResult({
        succeeded: data.succeeded ?? 0,
        failed: data.failed ?? 0,
        errors,
      });
    }
  }, [fetcher.data, bulkResult]);

  const confirmedCount = statusCounts['CONFIRMED'] ?? 0;
  const allocatedCount = statusCounts['AGENT_ASSIGNED'] ?? 0;
  const dispatchedCount = statusCounts['DISPATCHED'] ?? 0;
  const inTransitCount = statusCounts['IN_TRANSIT'] ?? 0;
  const deliveredCount = statusCounts['DELIVERED'] ?? 0;
  const totalOrdersCount = Object.values(statusCounts).reduce((sum, n) => sum + (n ?? 0), 0);

  const buildStatusQuery = (status: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', '1');
    if (status === 'ALL' || !status) next.delete('status');
    else next.set('status', status);
    const qs = next.toString();
    return qs ? `?${qs}` : '?';
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    setSelectedIds(new Set());
    setBulkResult(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (status === 'ALL' || !status) next.delete('status');
      else next.set('status', status);
      return next;
    });
  };

  const logisticsOrdersToolbarFilterBadge = useMemo(
    () => (selectedStatus !== 'ALL' ? 1 : 0),
    [selectedStatus],
  );

  const confirmedOrders = displayOrders.filter((o) => o.status === 'CONFIRMED');
  const allocatedOrders = displayOrders.filter((o) => o.status === 'AGENT_ASSIGNED');
  const selectedOrders = displayOrders.filter((o) => selectedIds.has(o.id));
  const selectedConfirmed = selectedOrders.filter((o) => o.status === 'CONFIRMED');
  const selectedAllocated = selectedOrders.filter((o) => o.status === 'AGENT_ASSIGNED');
  const selectedInTransit = selectedOrders.filter((o) => o.status === 'IN_TRANSIT');
  const canBulkAllocate = selectedConfirmed.length > 0 && selectedConfirmed.length === selectedIds.size;
  const canBulkDispatch =
    selectedAllocated.length > 0 &&
    selectedAllocated.length === selectedIds.size &&
    new Set(selectedAllocated.map((o) => o.logisticsLocationId)).size === 1;
  const canBulkMarkDelivered = selectedInTransit.length > 0 && selectedInTransit.length === selectedIds.size;
  const bulkDispatchLocationId = canBulkDispatch ? selectedAllocated[0]?.logisticsLocationId ?? null : null;
  const ridersForBulkDispatch = bulkDispatchLocationId
    ? riders.filter((r) => r.logisticsLocationId === bulkDispatchLocationId)
    : [];

  const hasVisibleBulkActions =
    (canBulkAllocate && !allocationOnDetailOnly) ||
    (canBulkDispatch && !allocationOnDetailOnly && ridersForBulkDispatch.length > 0) ||
    (canBulkMarkDelivered && !allocationOnDetailOnly);

  /** Locations available for allocation; TPL passes only their location */
  const allocatableLocations = allocatableLocationsProp ?? locations.filter((loc) => !loc.dispatchLocked);

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkResult(null);
    setAllocateLocationId('');
    setDispatchRiderId('');
  };

  const isSubmitting = fetcher.state !== 'idle';

  const logisticsOrderColumns = useMemo((): CompactTableColumn<LogisticsOrderRow>[] => {
    return [
      {
        key: 'orderId',
        header: 'Order ID',
        render: (order) => (
          <OrderIdBadge id={order.id} orderNumber={order.orderNumber} linkTo={toOrderDetail(order.id)} />
        ),
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (order) => <span className="font-medium text-app-fg">{order.customerName}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (order) => <OrderStatusBadge status={order.status} expanded />,
      },
      {
        key: 'deliveryDate',
        header: 'Delivery Date',
        render: (order) => (
          <DeliveryDateCell date={order.preferredDeliveryDate} status={order.status} />
        ),
      },
      {
        key: 'location',
        header: 'Company',
        render: (order) => (
          <span className="text-app-fg-muted">
            {order.locationProviderName
              ? `${order.locationProviderName} · ${order.locationName}`
              : order.locationName}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        tight: true,
        nowrap: true,
        minWidth: allocationOnDetailOnly ? 'min-w-[4.5rem]' : 'min-w-[220px]',
        mobileShowLabel: false,
        headerClassName: 'text-right',
        render: (order) => {
          return (
            <CompactTableActions className="inline-flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
              <TableActionButton to={toOrderDetail(order.id)} variant="primary">
                View
              </TableActionButton>
              {canEditDeliveryDate && order.status === 'CONFIRMED' && (
                <TableActionButton
                  variant="neutral"
                  onClick={() =>
                    setEditDeliveryDateOrder({
                      orderId: order.id,
                      customerName: order.customerName,
                      preferredDeliveryDate: order.preferredDeliveryDate ?? null,
                    })
                  }
                >
                  Resolve order
                </TableActionButton>
              )}
              {order.status === 'IN_TRANSIT' && !allocationOnDetailOnly && (
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => setDeliverConfirm({ orderId: order.id, customerName: order.customerName })}
                >
                  Mark Delivered
                </Button>
              )}
              {order.status === 'CONFIRMED' && !allocationOnDetailOnly && (
                <fetcher.Form method="post" className="inline-flex items-center gap-1">
                  <input type="hidden" name="intent" value="allocate" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="logisticsLocationId" value={rowAllocateLocationByOrder[order.id] ?? ''} />
                  <SearchableSelect
                    id={`logistics-row-allocate-${order.id}`}
                    value={rowAllocateLocationByOrder[order.id] ?? ''}
                    onChange={(value) => setRowAllocateLocationByOrder((prev) => ({ ...prev, [order.id]: value }))}
                    placeholder="Location"
                    searchPlaceholder="Search locations..."
                    options={allocatableLocations.map((loc) => ({
                      value: loc.id,
                      label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                    }))}
                    wrapperClassName="w-36"
                    controlSize="sm"
                  />
                  <Button type="submit" variant="primary" size="sm" disabled={isSubmitting || !(rowAllocateLocationByOrder[order.id] ?? '')} loading={isSubmitting}>
                    Assign
                  </Button>
                </fetcher.Form>
              )}
              {order.status === 'AGENT_ASSIGNED' && !allocationOnDetailOnly && (
                <fetcher.Form method="post" className="inline-flex items-center gap-1">
                  <input type="hidden" name="intent" value="dispatch" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="riderId" value={rowDispatchRiderByOrder[order.id] ?? ''} />
                  <SearchableSelect
                    id={`logistics-row-dispatch-${order.id}`}
                    value={rowDispatchRiderByOrder[order.id] ?? ''}
                    onChange={(value) => setRowDispatchRiderByOrder((prev) => ({ ...prev, [order.id]: value }))}
                    disabled={
                      !order.logisticsLocationId ||
                      riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId).length === 0
                    }
                    placeholder={
                      !order.logisticsLocationId ||
                      riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId).length === 0
                        ? 'No riders'
                        : 'Rider'
                    }
                    searchPlaceholder="Search riders..."
                    options={
                      order.logisticsLocationId
                        ? riders
                            .filter((r) => r.logisticsLocationId === order.logisticsLocationId)
                            .map((r) => ({ value: r.id, label: r.name }))
                        : []
                    }
                    wrapperClassName="w-36"
                    controlSize="sm"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={
                      isSubmitting ||
                      !order.logisticsLocationId ||
                      riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId).length === 0
                    }
                    loading={isSubmitting}
                  >
                    Dispatch
                  </Button>
                </fetcher.Form>
              )}
              {order.status === 'DISPATCHED' && !allocationOnDetailOnly && (
                <fetcher.Form method="post" className="inline">
                  <input type="hidden" name="intent" value="transition" />
                  <input type="hidden" name="orderId" value={order.id} />
                  <input type="hidden" name="newStatus" value="IN_TRANSIT" />
                  <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting}>
                    {markInTransitLabel}
                  </Button>
                </fetcher.Form>
              )}
            </CompactTableActions>
          );
        },
      },
    ];
  }, [
    fetcher,
    isSubmitting,
    orderDetailBasePath,
    toOrderDetail,
    canEditDeliveryDate,
    allocationOnDetailOnly,
    rowAllocateLocationByOrder,
    rowDispatchRiderByOrder,
    allocatableLocations,
    riders,
    markInTransitLabel,
  ]);

  const renderLogisticsOrderMobileCard = (
    order: LogisticsOrderRow,
    _index: number,
    _helpers: CompactTableMobileCardHelpers<LogisticsOrderRow>,
  ) => {
    return (
      <button
        type="button"
        onClick={() => setPeekOrder(order)}
        className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
      >
        {/* Row 1: customer + order ID */}
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-app-fg">
            {order.customerName || '—'}
          </span>
          <OrderIdBadge
            id={order.id}
            orderNumber={order.orderNumber}
            textClassName="text-sm font-medium text-app-fg"
          />
        </div>
        {/* Row 2: status + date */}
        <div className="flex items-center justify-between gap-2">
          <OrderStatusBadge status={order.status} expanded />
          <span className="whitespace-nowrap text-xs text-app-fg-muted">
            {formatOrderTimestamp(order.createdAt)}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <PageHeader
          title={pageTitle}
          mobileInlineActions
          description={pageDescription}
          actions={
            <PageHeaderMobileTools
              sheetTitle="Actions"
              triggerAriaLabel="Logistics orders tools"
              filtersBadgeCount={logisticsOrdersToolbarFilterBadge}
              desktop={
                <>
                  <PageRefreshButton />
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => setShowChartView((v) => !v)}
                  >
                    {showChartView ? 'View as data' : 'View data in chart'}
                  </button>
                  <DateFilterBar
                      startDate={filters.startDate}
                      endDate={filters.endDate}
                      periodAllTime={filters.periodAllTime} chrome="pill" />
                </>
              }
              filters={
                <FormSelect
                  value={selectedStatus}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  options={LOGISTICS_STATUS_OPTIONS.map((status) => ({
                    value: status,
                    label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
                  }))}
                  controlSize="lg"
                  className="!bg-app-hover text-center"
                  wrapperClassName="w-full"
                />
              }
              sheet={({ closeSheet }) => (
                <div className="space-y-2">
                  <button
                    type="button"
                    className="flex h-10 w-full items-center justify-center rounded-md border border-app-border bg-app-hover text-sm font-medium text-app-fg transition-colors hover:bg-app-border"
                    onClick={() => {
                      closeSheet();
                      setShowChartView((v) => !v);
                    }}
                  >
                    {showChartView ? 'View as data' : 'View data in chart'}
                  </button>
                </div>
              )}
            />
          }
        />

        <MobileDateFilterRow
          startDate={filters.startDate}
          endDate={filters.endDate}
          periodAllTime={filters.periodAllTime}
        />
      </div>

      {deferredLoading ? (
        <OverviewStatStrip
          mobileGrid
          items={[
            { label: 'Total', value: <StatValuePulse className="min-w-[2.5rem]" /> },
            { label: 'Unassigned', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Assigned', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Dispatched', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'In transit', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Delivered', value: <StatValuePulse className="min-w-[2rem]" /> },
          ]}
        />
      ) : (
        <OverviewStatStrip
          mobileGrid
          items={[
            { label: 'Total', value: totalOrdersCount.toLocaleString(), valueClassName: 'text-app-fg', to: buildStatusQuery('ALL') },
            { label: 'Unassigned', value: confirmedCount, valueClassName: 'text-brand-600 dark:text-brand-400', to: buildStatusQuery('CONFIRMED') },
            { label: 'Assigned', value: allocatedCount, valueClassName: 'text-info-600 dark:text-info-400', to: buildStatusQuery('AGENT_ASSIGNED') },
            { label: 'Dispatched', value: dispatchedCount, valueClassName: 'text-info-600 dark:text-info-400', to: buildStatusQuery('DISPATCHED') },
            { label: 'In transit', value: inTransitCount, valueClassName: 'text-brand-600 dark:text-brand-400', to: buildStatusQuery('IN_TRANSIT') },
            { label: 'Delivered', value: deliveredCount, valueClassName: 'text-success-600 dark:text-success-400', to: buildStatusQuery('DELIVERED') },
          ]}
        />
      )}

      {/* Bulk action toolbar */}
      {selectedIds.size > 0 && (
        <div className="card bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-700/50">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-brand-700 dark:text-brand-300">
                {selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected
              </span>
              <button type="button" onClick={clearSelection} className="text-xs text-brand-500 hover:text-brand-600 underline">
                Clear
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canBulkAllocate && !allocationOnDetailOnly && (
                <>
                  <SearchableSelect
                    id="logistics-bulk-allocate-location"
                    value={allocateLocationId}
                    onChange={setAllocateLocationId}
                    wrapperClassName="w-48"
                    placeholder="Select location"
                    searchPlaceholder="Search locations..."
                    options={allocatableLocations.map((loc) => ({
                      value: loc.id,
                      label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                    }))}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!allocateLocationId || isSubmitting}
                    loading={isSubmitting}
                    loadingText="Assigning…"
                    onClick={() => {
                      if (!allocateLocationId) return;
                      fetcher.submit(
                        {
                          intent: 'bulkAllocate',
                          orderIds: JSON.stringify([...selectedIds]),
                          logisticsLocationId: allocateLocationId,
                        },
                        { method: 'post' },
                      );
                      setBulkResult(null);
                    }}
                  >
                    Assign selected
                  </Button>
                </>
              )}
              {canBulkDispatch && !allocationOnDetailOnly && ridersForBulkDispatch.length > 0 && (
                <>
                  <SearchableSelect
                    id="logistics-bulk-dispatch-rider"
                    value={dispatchRiderId}
                    onChange={setDispatchRiderId}
                    wrapperClassName="w-48"
                    placeholder="Select rider"
                    searchPlaceholder="Search riders..."
                    options={ridersForBulkDispatch.map((r) => ({ value: r.id, label: r.name }))}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!dispatchRiderId || isSubmitting}
                    loading={isSubmitting}
                    loadingText="Dispatching..."
                    onClick={() => {
                      if (!dispatchRiderId) return;
                      fetcher.submit(
                        {
                          intent: 'bulkDispatch',
                          orderIds: JSON.stringify([...selectedIds]),
                          riderId: dispatchRiderId,
                        },
                        { method: 'post' },
                      );
                      setBulkResult(null);
                    }}
                  >
                    Dispatch selected
                  </Button>
                </>
              )}
              {canBulkMarkDelivered && !allocationOnDetailOnly && (
                <Button
                  variant="success"
                  size="sm"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  loadingText="Marking delivered..."
                  onClick={() => {
                    fetcher.submit(
                      {
                        intent: 'bulkMarkDelivered',
                        orderIds: JSON.stringify([...selectedIds]),
                      },
                      { method: 'post' },
                    );
                    setBulkResult(null);
                  }}
                >
                  Mark delivered
                </Button>
              )}
              {selectedIds.size > 0 && !hasVisibleBulkActions && (
                <span className="text-xs text-app-fg-muted">
                  {allocationOnDetailOnly
                    ? 'Open an order from the list to assign to logistics, dispatch, and confirm delivery on the order detail page.'
                    : 'Select only CONFIRMED orders to assign for delivery, only agent-assigned orders (same location) to bulk dispatch, or only IN_TRANSIT orders to mark delivered.'}
                </span>
              )}
            </div>
          </div>
          {bulkResult && (
            <div className="mt-3 p-3 rounded-lg bg-app-elevated border border-app-border">
              <div className="flex gap-3 text-sm">
                {bulkResult.succeeded > 0 && (
                  <span className="text-success-600 dark:text-success-400 font-medium">{bulkResult.succeeded} succeeded</span>
                )}
                {bulkResult.failed > 0 && (
                  <span className="text-danger-600 dark:text-danger-400 font-medium">{bulkResult.failed} failed</span>
                )}
              </div>
              {bulkResult.errors.length > 0 && (
                <div className="mt-2 space-y-1">
                  {bulkResult.errors.slice(0, 5).map((err, i) => (
                    <p key={i} className="text-xs text-danger-600 dark:text-danger-400">
                      {err}
                    </p>
                  ))}
                  {bulkResult.errors.length > 5 && (
                    <p className="text-xs text-app-fg-muted">
                      +{bulkResult.errors.length - 5} more
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ToolbarFiltersCollapsible
        className="!border-0 !p-0 !bg-transparent"
        hideMobileSheet
        badgeCount={logisticsOrdersToolbarFilterBadge}
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
                    const q = searchQuery.trim();
                    if (q) next.set('search', q);
                    else next.delete('search');
                    return next;
                  });
                }}
              >
                <SearchInput
                  name="search"
                  placeholder="Search by customer name..."
                  value={searchQuery}
                  onChange={(val) => setSearchQuery(val)}
                  withSubmitButton
                  wrapperClassName="w-full md:flex-1"
                  className="bg-white dark:bg-app-elevated"
                />
              </form>
              <div className="hidden shrink-0 items-center gap-3 md:flex">
                <FormSelect
                  value={selectedStatus}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  options={LOGISTICS_STATUS_OPTIONS.map((status) => ({
                    value: status,
                    label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
                  }))}
                  wrapperClassName="w-full min-w-0 sm:w-48"
                />
              </div>
            </div>
          }
          desktopInlineFilters={null}
          sheetFilterBody={null}
        />

      {showChartView ? (
        deferredLoading ? (
          <OrdersChartViewShellSkeleton />
        ) : trendLoading && !trendCounts ? (
          <div className="card !p-4">
            <div className="flex items-center gap-2 text-sm text-app-fg-muted">
              <Spinner className="w-4 h-4" />
              <span>Loading chart…</span>
            </div>
          </div>
        ) : (
          <OrdersChartView
            statusCounts={statusCounts}
            total={totalOrdersCount}
            scopeLabel="Logistics orders"
            dailyCounts={trendCounts}
          />
        )
      ) : (
      <TableLoadingOverlay show={isFilterLoading}>
        {/* Card chrome is desktop-only — on mobile each order renders as its
            own elevated card, so an outer card would just double the chrome
            and waste horizontal space. */}
        <div className="md:bg-app-elevated md:rounded-xl md:border md:border-app-border md:shadow-card dark:md:shadow-none md:overflow-hidden">
          <CompactTable<LogisticsOrderRow>
            withCard={false}
            columns={logisticsOrderColumns}
            rows={displayOrders}
            rowKey={(o) => o.id}
            rowClassName={(o) => (selectedIds.has(o.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : '')}
            selection={{
              selectedIds,
              onToggle: (id, selected) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (selected) next.add(id);
                  else next.delete(id);
                  return next;
                });
                setBulkResult(null);
              },
              onToggleAll: (selectAll) => {
                if (selectAll) setSelectedIds(new Set(displayOrders.map((o) => o.id)));
                else setSelectedIds(new Set());
                setBulkResult(null);
              },
            }}
            emptyTitle={listErrorMessage ? 'Could not load orders' : 'No orders found'}
            emptyDescription={listErrorMessage ?? 'Try changing the status filter or date range.'}
            renderMobileCard={renderLogisticsOrderMobileCard}
          />
        </div>
      </TableLoadingOverlay>
      )}

      {!showChartView && (
        <div className="mt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {total > 0
              ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} orders`
              : 'No orders'}
          </p>
          <Pagination
            page={page}
            totalPages={totalPages}
            pageParam="page"
            pageSize={limit}
            pageSizeOptions={[20, 40, 50, 100, 200, 500, 1000]}
            showWhenSinglePage
          />
        </div>
      )}

      {/* Mark Delivered confirmation modal */}
      {deliverConfirm && (
        <ConfirmActionModal
          open={!!deliverConfirm}
          onClose={() => {
            setDeliverConfirm(null);
            setDeliverConfirmDiscount('');
            setDeliverConfirmDeliveryCost('');
          }}
          error={fetcherSurface.errorMatchingIntent('transition')}
          title="Mark order as delivered?"
          description={
            <>
              Confirm delivery for order <strong>{deliverConfirm.orderId.slice(0, 8)}...</strong> ({deliverConfirm.customerName}).
            </>
          }
          details={
            <div className="space-y-2">
              <TextInput
                type="number"
                label="Cost of delivery (₦) — optional"
                min={0}
                step="0.01"
                value={deliverConfirmDeliveryCost}
                onChange={(e) => setDeliverConfirmDeliveryCost(e.target.value)}
                placeholder="0"
                disabled={fetcher.state === 'submitting'}
                className="w-28"
              />
              <TextInput
                type="number"
                label="Discount at delivery (₦) — optional"
                min={0}
                step="0.01"
                value={deliverConfirmDiscount}
                onChange={(e) => setDeliverConfirmDiscount(e.target.value)}
                placeholder="0"
                disabled={fetcher.state === 'submitting'}
                className="w-28"
              />
            </div>
          }
          confirmLabel="Mark Delivered"
          variant="warning"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            const payload: Record<string, string> = {
              intent: 'transition',
              orderId: deliverConfirm.orderId,
              newStatus: 'DELIVERED',
            };
            const costNum = deliverConfirmDeliveryCost.trim() !== '' ? parseFloat(deliverConfirmDeliveryCost) : NaN;
            if (!Number.isNaN(costNum) && costNum >= 0) {
              payload.deliveryFeeAddOn = String(costNum);
            }
            const discountNum = deliverConfirmDiscount.trim() !== '' ? parseFloat(deliverConfirmDiscount) : NaN;
            if (!Number.isNaN(discountNum) && discountNum >= 0) {
              payload.deliveryDiscountAmount = String(discountNum);
            }
            fetcher.submit(payload, { method: 'post' });
          }}
        />
      )}

      {/* Edit delivery date modal */}
      {editDeliveryDateOrder && (
        <EditDeliveryDateModal
          orderId={editDeliveryDateOrder.orderId}
          customerName={editDeliveryDateOrder.customerName}
          initialDate={editDeliveryDateOrder.preferredDeliveryDate}
          submissionError={fetcherSurface.errorMatchingIntent('updateDeliveryDate')}
          onClose={() => setEditDeliveryDateOrder(null)}
          loading={fetcher.state === 'submitting'}
          onSave={(preferredDeliveryDate, deliveryFeeAddOn, deliveryDiscountAmount, resolveReceiptUrl) => {
            const payload: Record<string, string> = {
              intent: 'updateDeliveryDate',
              orderId: editDeliveryDateOrder.orderId,
              preferredDeliveryDate,
              resolveReceiptUrl: resolveReceiptUrl ?? '',
            };
            if (deliveryFeeAddOn !== undefined && !Number.isNaN(deliveryFeeAddOn) && deliveryFeeAddOn >= 0) {
              payload.deliveryFeeAddOn = String(deliveryFeeAddOn);
            }
            if (deliveryDiscountAmount !== undefined && !Number.isNaN(deliveryDiscountAmount) && deliveryDiscountAmount >= 0) {
              payload.deliveryDiscountAmount = String(deliveryDiscountAmount);
            }
            fetcher.submit(payload, { method: 'post' });
          }}
        />
      )}

      {/* Mobile peek modal */}
      <Modal
        open={!!peekOrder}
        onClose={() => setPeekOrder(null)}
        maxWidth="max-w-sm"
        contentClassName="p-5"
      >
        {peekOrder && (() => {
          const o = peekOrder;
          const companyLine = o.locationProviderName
            ? `${o.locationProviderName} · ${o.locationName}`
            : o.locationName;
          const ridersForOrder =
            o.logisticsLocationId && o.status === 'AGENT_ASSIGNED'
              ? riders.filter((r) => r.logisticsLocationId === o.logisticsLocationId)
              : [];
          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-app-fg truncate min-w-0">{o.customerName || '—'}</p>
                <OrderIdBadge id={o.id} orderNumber={o.orderNumber} textClassName="text-sm font-medium text-app-fg" />
              </div>

              {/* Details */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Status</span>
                  <OrderStatusBadge status={o.status} expanded />
                </div>
                {companyLine && companyLine !== '—' && (
                  <div className="flex justify-between">
                    <span className="text-app-fg-muted">Company</span>
                    <span className="text-app-fg text-right truncate max-w-[60%]">{companyLine}</span>
                  </div>
                )}
                {o.preferredDeliveryDate && (
                  <div className="flex justify-between">
                    <span className="text-app-fg-muted">Delivery date</span>
                    <DeliveryDateCell date={o.preferredDeliveryDate} status={o.status} />
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-app-fg-muted">Created</span>
                  <span className="text-app-fg">{formatOrderTimestamp(o.createdAt)}</span>
                </div>
                {o.riderName && o.riderName !== '—' && (
                  <div className="flex justify-between">
                    <span className="text-app-fg-muted">Rider</span>
                    <span className="text-app-fg">{o.riderName}</span>
                  </div>
                )}
              </div>

              {/* Inline actions */}
              {!allocationOnDetailOnly && (
                <div className="space-y-2">
                  {o.status === 'CONFIRMED' && (
                    <fetcher.Form method="post" className="flex gap-1.5">
                      <input type="hidden" name="intent" value="allocate" />
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="logisticsLocationId" value={rowAllocateLocationByOrder[o.id] ?? ''} />
                      <SearchableSelect
                        value={rowAllocateLocationByOrder[o.id] ?? ''}
                        onChange={(value) => setRowAllocateLocationByOrder((prev) => ({ ...prev, [o.id]: value }))}
                        placeholder="Select location"
                        searchPlaceholder="Search locations..."
                        options={allocatableLocations.map((loc) => ({
                          value: loc.id,
                          label: loc.providerName ? `${loc.name} — ${loc.providerName}` : loc.name,
                        }))}
                        wrapperClassName="min-w-0 flex-1"
                        controlSize="sm"
                      />
                      <Button type="submit" variant="primary" size="sm" disabled={isSubmitting || !(rowAllocateLocationByOrder[o.id] ?? '')}>
                        Assign
                      </Button>
                    </fetcher.Form>
                  )}
                  {o.status === 'AGENT_ASSIGNED' && ridersForOrder.length > 0 && (
                    <fetcher.Form method="post" className="flex gap-1.5">
                      <input type="hidden" name="intent" value="dispatch" />
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="riderId" value={rowDispatchRiderByOrder[o.id] ?? ''} />
                      <SearchableSelect
                        value={rowDispatchRiderByOrder[o.id] ?? ''}
                        onChange={(value) => setRowDispatchRiderByOrder((prev) => ({ ...prev, [o.id]: value }))}
                        placeholder="Select rider"
                        searchPlaceholder="Search riders..."
                        options={ridersForOrder.map((r) => ({ value: r.id, label: r.name }))}
                        controlSize="sm"
                        wrapperClassName="min-w-0 flex-1"
                      />
                      <Button type="submit" variant="primary" size="sm" disabled={isSubmitting || !(rowDispatchRiderByOrder[o.id] ?? '')}>
                        Dispatch
                      </Button>
                    </fetcher.Form>
                  )}
                  {o.status === 'DISPATCHED' && (
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="transition" />
                      <input type="hidden" name="orderId" value={o.id} />
                      <input type="hidden" name="newStatus" value="IN_TRANSIT" />
                      <Button type="submit" variant="primary" size="sm" className="w-full" disabled={isSubmitting}>
                        {markInTransitLabel}
                      </Button>
                    </fetcher.Form>
                  )}
                  {o.status === 'IN_TRANSIT' && (
                    <Button
                      variant="success"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setPeekOrder(null);
                        setDeliverConfirm({ orderId: o.id, customerName: o.customerName });
                      }}
                    >
                      Mark Delivered
                    </Button>
                  )}
                </div>
              )}

              {/* View order link */}
              <div className="pt-1 border-t border-app-border">
                <Link
                  to={toOrderDetail(o.id)}
                  prefetch="intent"
                  className="btn-primary btn-sm inline-flex w-full items-center justify-center"
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

export function LogisticsOrdersPage(props: LogisticsOrdersPageProps) {
  if (props.deferredSecondary) {
    const { deferredSecondary, ...rest } = props;
    return (
      <Suspense
        fallback={
          <LogisticsOrdersPageImpl
            {...rest}
            deferredSecondary={undefined}
            statusCounts={{}}
            locations={[]}
            deferredLoading
          />
        }
      >
        <Await resolve={deferredSecondary} errorElement={<DeferredError />}>
          {(sec) => (
            <LogisticsOrdersPageImpl
              {...rest}
              deferredSecondary={undefined}
              statusCounts={sec.statusCounts}
              locations={sec.locations}
              riders={sec.riders ?? rest.riders}
              allocatableLocations={sec.allocatableLocations ?? rest.allocatableLocations}
            />
          )}
        </Await>
      </Suspense>
    );
  }
  return <LogisticsOrdersPageImpl {...props} />;
}

// ── Edit Delivery Date Modal ───────────────────────────────────

function getTodayYYYYMMDD(): string {
  return new Date().toISOString().slice(0, 10);
}

function EditDeliveryDateModal({
  orderId,
  customerName,
  initialDate,
  submissionError,
  onClose,
  loading,
  onSave,
}: {
  orderId: string;
  customerName: string;
  initialDate: string | null;
  submissionError?: string | null;
  onClose: () => void;
  loading: boolean;
  onSave: (preferredDeliveryDate: string, deliveryFeeAddOn?: number, deliveryDiscountAmount?: number, resolveReceiptUrl?: string) => void;
}) {
  const [dateValue, setDateValue] = useState(initialDate ?? getTodayYYYYMMDD());
  const [deliveryCost, setDeliveryCost] = useState('');
  const [discount, setDiscount] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');

  const canSave = dateValue.trim() !== '' && receiptUrl.trim() !== '';

  const handleSave = () => {
    const trimmed = dateValue.trim();
    if (!trimmed || !receiptUrl.trim()) return;
    const costNum = deliveryCost.trim() !== '' ? parseFloat(deliveryCost) : undefined;
    const discountNum = discount.trim() !== '' ? parseFloat(discount) : undefined;
    onSave(
      trimmed,
      costNum !== undefined && !Number.isNaN(costNum) ? costNum : undefined,
      discountNum !== undefined && !Number.isNaN(discountNum) ? discountNum : undefined,
      receiptUrl.trim(),
    );
  };

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" role="dialog" aria-labelledby="edit-delivery-date-title" contentClassName="p-0 border border-app-border">
        <div className="flex items-center justify-between pb-2 border-b border-app-border px-4 pt-4 sm:px-5 sm:pt-5">
          <h3 id="edit-delivery-date-title" className="text-lg font-semibold text-app-fg">
            Resolve order
          </h3>
        </div>
        <div className="space-y-4 pt-4 px-4 sm:px-5">
          <ModalFetcherInlineError message={submissionError} />
          <p className="text-sm text-app-fg-muted">
            Order <strong>{orderId.slice(0, 8)}...</strong> · {customerName}
          </p>
          <TextInput
            type="date"
            label="Preferred delivery date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            disabled={loading}
          />
          <TextInput
            type="number"
            label="Cost of delivery (₦) — optional"
            min={0}
            step="0.01"
            value={deliveryCost}
            onChange={(e) => setDeliveryCost(e.target.value)}
            placeholder="0"
            disabled={loading}
          />
          <TextInput
            type="number"
            label="Discount at delivery (₦) — optional"
            min={0}
            step="0.01"
            value={discount}
            onChange={(e) => setDiscount(e.target.value)}
            placeholder="0"
            disabled={loading}
          />
          <div>
            <label className="block text-sm font-medium text-app-fg-muted">
              Receipt <span className="text-danger-600 dark:text-danger-400">*</span>
            </label>
            <FileUpload
              folder={ASSET_FOLDERS.RECEIPTS}
              onUpload={setReceiptUrl}
              accept="image/*,.pdf"
              label="Upload receipt"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 mt-4 border-t border-app-border px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSave} loading={loading} disabled={!canSave}>
            Save
          </Button>
        </div>
    </Modal>
  );
}
