import { useState, useEffect } from 'react';
import { Link, useFetcher, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { FileUpload } from '~/components/ui/file-upload';
import { S3_FOLDERS } from '~/lib/s3-upload';
import { PageHeader } from '~/components/ui/page-header';
import { OrdersChartView } from '~/components/ui/orders-chart-view';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { EmptyState } from '~/components/ui/empty-state';
import { Pagination } from '~/components/ui/pagination';
import { TextInput } from '~/components/ui/text-input';
import { formatStatus } from '~/features/shared/order-status';
import type { Order } from '~/features/orders/types';
import type { Location } from './types';

const LOGISTICS_STATUS_OPTIONS = ['ALL', 'CONFIRMED', 'ALLOCATED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED'] as const;

export interface LogisticsOrderRow extends Order {
  logisticsLocationId?: string | null;
  riderId?: string | null;
  deliveryNotes?: string | null;
  preferredDeliveryDate?: string | null;
  locationName: string;
  riderName: string;
}

export interface RiderOption {
  id: string;
  name: string;
  logisticsLocationId: string | null;
}

interface LogisticsOrdersPageProps {
  orders: LogisticsOrderRow[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  statusCounts: Record<string, number>;
  statusFilter?: string;
  searchFilter?: string;
  listErrorMessage?: string;
  locations: Location[];
  /** When provided (e.g. TPL), only these locations in allocate dropdown; else locations where !dispatchLocked */
  allocatableLocations?: Location[];
  riders: RiderOption[];
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  isTplManagerScoped?: boolean;
  /** Override page title (e.g. "Orders" for 3PL layout) */
  pageTitle?: string;
  /** Base path for order detail links (e.g. "/tpl/orders" for TPL, "/admin/logistics/orders" for admin) */
  orderDetailBasePath?: string;
  /** When true, allocation is only on the order detail page (e.g. 3PL); hide allocate from list and bulk */
  allocationOnDetailOnly?: boolean;
  /** When true, show Edit button to change preferred delivery date (e.g. TPL orders page) */
  canEditDeliveryDate?: boolean;
  /** Label for DISPATCHED → IN_TRANSIT button (e.g. "Mark In Transit" for TPL, default "Start Delivery") */
  markInTransitLabel?: string;
  /** Daily order count series for the "Orders over time" chart (from `orders.timeSeriesByCreated`). */
  dailyCounts?: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
}

export function LogisticsOrdersPage({
  orders,
  total,
  totalPages,
  page,
  limit,
  statusCounts,
  statusFilter,
  searchFilter,
  listErrorMessage,
  locations,
  allocatableLocations: allocatableLocationsProp,
  riders,
  filters,
  isTplManagerScoped = false,
  pageTitle = 'Logistics Orders',
  orderDetailBasePath = '/admin/logistics/orders',
  allocationOnDetailOnly = false,
  canEditDeliveryDate = false,
  markInTransitLabel = 'Start Delivery',
  dailyCounts,
}: LogisticsOrdersPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showChartView, setShowChartView] = useState(false);
  const isFilterLoading = useLoaderRefetchBusy();
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allocateLocationId, setAllocateLocationId] = useState('');
  const [dispatchRiderId, setDispatchRiderId] = useState('');
  const [rowAllocateLocationByOrder, setRowAllocateLocationByOrder] = useState<Record<string, string>>({});
  const [rowDispatchRiderByOrder, setRowDispatchRiderByOrder] = useState<Record<string, string>>({});
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; errors: string[] } | null>(null);

  const [deliverConfirm, setDeliverConfirm] = useState<{ orderId: string; customerName: string } | null>(null);
  const [deliverConfirmDiscount, setDeliverConfirmDiscount] = useState('');
  const [deliverConfirmDeliveryCost, setDeliverConfirmDeliveryCost] = useState('');
  const [editDeliveryDateOrder, setEditDeliveryDateOrder] = useState<{
    orderId: string;
    customerName: string;
    preferredDeliveryDate: string | null;
  } | null>(null);

  const fetcher = useFetcher();
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
  const allocatedCount = statusCounts['ALLOCATED'] ?? 0;
  const dispatchedCount = statusCounts['DISPATCHED'] ?? 0;
  const inTransitCount = statusCounts['IN_TRANSIT'] ?? 0;
  const deliveredCount = statusCounts['DELIVERED'] ?? 0;
  const totalOrdersCount = Object.values(statusCounts).reduce((sum, n) => sum + (n ?? 0), 0);

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

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (searchQuery) next.set('search', searchQuery);
      else next.delete('search');
      return next;
    });
  };

  const confirmedOrders = orders.filter((o) => o.status === 'CONFIRMED');
  const allocatedOrders = orders.filter((o) => o.status === 'ALLOCATED');
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));
  const selectedConfirmed = selectedOrders.filter((o) => o.status === 'CONFIRMED');
  const selectedAllocated = selectedOrders.filter((o) => o.status === 'ALLOCATED');
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

  /** Locations available for allocation; TPL passes only their location */
  const allocatableLocations = allocatableLocationsProp ?? locations.filter((loc) => !loc.dispatchLocked);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkResult(null);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBulkResult(null);
    setAllocateLocationId('');
    setDispatchRiderId('');
  };

  const isSubmitting = fetcher.state !== 'idle';

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <PageHeader
          title={pageTitle}
          description="Allocate confirmed orders to 3PL locations and dispatch to riders"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <PageRefreshButton />
              <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                />
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowChartView((v) => !v)}
              >
                {showChartView ? 'View as data' : 'View data in chart'}
              </button>
            </div>
          }
        />
      </div>

      <OverviewStatStrip
        tileClassName="min-w-[6rem]"
        items={[
          { label: 'Total Orders', value: totalOrdersCount.toLocaleString(), valueClassName: 'text-app-fg' },
          { label: 'Awaiting allocation', value: confirmedCount, valueClassName: 'text-brand-600 dark:text-brand-400' },
          { label: 'Allocated', value: allocatedCount, valueClassName: 'text-info-600 dark:text-info-400' },
          { label: 'Dispatched', value: dispatchedCount, valueClassName: 'text-info-600 dark:text-info-400' },
          { label: 'In transit', value: inTransitCount, valueClassName: 'text-brand-600 dark:text-brand-400' },
          { label: 'Delivered', value: deliveredCount, valueClassName: 'text-success-600 dark:text-success-400' },
        ]}
      />

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
                    options={allocatableLocations.map((loc) => ({ value: loc.id, label: loc.name }))}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!allocateLocationId || isSubmitting}
                    loading={isSubmitting}
                    loadingText="Allocating..."
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
                    Allocate selected
                  </Button>
                </>
              )}
              {canBulkDispatch && ridersForBulkDispatch.length > 0 && (
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
              {canBulkMarkDelivered && (
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
              {selectedIds.size > 0 && !canBulkAllocate && !canBulkDispatch && !canBulkMarkDelivered && (
                <span className="text-xs text-app-fg-muted">
                  {allocationOnDetailOnly
                    ? 'Open an order to allocate. Select only ALLOCATED orders (same location) to bulk dispatch, or only IN_TRANSIT to mark delivered.'
                    : 'Select only CONFIRMED orders to bulk allocate, only ALLOCATED orders (same location) to bulk dispatch, or only IN_TRANSIT orders to mark delivered.'}
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

      <div className="flex flex-col sm:flex-row gap-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1">
          <SearchInput
            value={searchQuery}
            onChange={(val) => setSearchQuery(val)}
            placeholder="Search by customer or order ID..."
            className="flex-1"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <FormSelect
          value={selectedStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          options={LOGISTICS_STATUS_OPTIONS.map((status) => ({
            value: status,
            label: status === 'ALL' ? 'All statuses' : formatStatus(status),
          }))}
          className="w-auto"
        />
      </div>

      {showChartView ? (
        <OrdersChartView
          statusCounts={statusCounts}
          total={totalOrdersCount}
          scopeLabel="Logistics orders"
          dailyCounts={dailyCounts}
        />
      ) : (
      <TableLoadingOverlay show={isFilterLoading}>
      <div className="card p-0">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header w-10">
                  <Checkbox
                    checked={orders.length > 0 && selectedIds.size === orders.length}
                    onChange={() => {
                      if (selectedIds.size === orders.length) setSelectedIds(new Set());
                      else setSelectedIds(new Set(orders.map((o) => o.id)));
                      setBulkResult(null);
                    }}
                  />
                </th>
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                <th className="table-header">Status</th>
                <th className="table-header">Delivery Date</th>
                <th className="table-header">3PL Location</th>
                <th className="table-header">Rider</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const ridersForOrder =
                  order.logisticsLocationId && order.status === 'ALLOCATED'
                    ? riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId)
                    : [];
                return (
                  <tr key={order.id} className={`table-row ${selectedIds.has(order.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}`}>
                    <td className="table-cell w-10">
                      <Checkbox
                        checked={selectedIds.has(order.id)}
                        onChange={() => toggleSelect(order.id)}
                      />
                    </td>
                    <td className="table-cell">
                      <OrderIdBadge id={order.id} linkTo={`${orderDetailBasePath}/${order.id}`} />
                    </td>
                    <td className="table-cell font-medium text-app-fg">
                      {order.customerName}
                    </td>
                    <td className="table-cell">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="table-cell">
                      <DeliveryDateCell date={order.preferredDeliveryDate} />
                    </td>
                    <td className="table-cell text-app-fg-muted">{order.locationName}</td>
                    <td className="table-cell text-app-fg-muted">{order.riderName}</td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <Link to={`${orderDetailBasePath}/${order.id}`}>
                          <Button variant="secondary" size="sm">
                            View
                          </Button>
                        </Link>
                        {canEditDeliveryDate && order.status === 'CONFIRMED' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setEditDeliveryDateOrder({
                                orderId: order.id,
                                customerName: order.customerName,
                                preferredDeliveryDate: order.preferredDeliveryDate ?? null,
                              })
                            }
                          >
                            Resolve order
                          </Button>
                        )}
                        {order.status === 'IN_TRANSIT' && (
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
                              required
                              value={rowAllocateLocationByOrder[order.id] ?? ''}
                              onChange={(value) => setRowAllocateLocationByOrder((prev) => ({ ...prev, [order.id]: value }))}
                              placeholder="Location"
                              searchPlaceholder="Search locations..."
                              options={allocatableLocations.map((loc) => ({ value: loc.id, label: loc.name }))}
                              wrapperClassName="w-36"
                              controlSize="sm"
                            />
                            <Button type="submit" variant="primary" size="sm" disabled={isSubmitting || !(rowAllocateLocationByOrder[order.id] ?? '')} loading={isSubmitting}>
                              Allocate
                            </Button>
                          </fetcher.Form>
                        )}
                        {order.status === 'ALLOCATED' && (
                          <fetcher.Form method="post" className="inline-flex items-center gap-1">
                            <input type="hidden" name="intent" value="dispatch" />
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="riderId" value={rowDispatchRiderByOrder[order.id] ?? ''} />
                            <SearchableSelect
                              id={`logistics-row-dispatch-${order.id}`}
                              required
                              value={rowDispatchRiderByOrder[order.id] ?? ''}
                              onChange={(value) => setRowDispatchRiderByOrder((prev) => ({ ...prev, [order.id]: value }))}
                              disabled={ridersForOrder.length === 0}
                              placeholder={ridersForOrder.length === 0 ? 'No riders' : 'Rider'}
                              searchPlaceholder="Search riders..."
                              options={ridersForOrder.map((r) => ({ value: r.id, label: r.name }))}
                              wrapperClassName="w-36"
                              controlSize="sm"
                            />
                            <Button
                              type="submit"
                              variant="primary"
                              size="sm"
                              disabled={isSubmitting || ridersForOrder.length === 0}
                              loading={isSubmitting}
                            >
                              Dispatch
                            </Button>
                          </fetcher.Form>
                        )}
                        {order.status === 'DISPATCHED' && (
                          <fetcher.Form method="post" className="inline">
                            <input type="hidden" name="intent" value="transition" />
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="newStatus" value="IN_TRANSIT" />
                            <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting}>
                              {markInTransitLabel}
                            </Button>
                          </fetcher.Form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && (
          <EmptyState
            title={listErrorMessage ? 'Could not load orders' : 'No orders found'}
            description={listErrorMessage ?? 'Try changing the status filter or date range.'}
          />
        )}

        {/* Mobile cards */}
        <div className="md:hidden space-y-3 px-1">
          {orders.map((order) => {
            const ridersForOrder =
              order.logisticsLocationId && order.status === 'ALLOCATED'
                ? riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId)
                : [];
            return (
              <div key={order.id} className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <OrderIdBadge
                    id={order.id}
                    linkTo={`${orderDetailBasePath}/${order.id}`}
                    textClassName="font-medium text-brand-500 hover:text-brand-600"
                  />
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="text-sm text-app-fg">{order.customerName}</p>
                <div className="flex items-center gap-2 text-sm text-app-fg-muted">
                  <span>{order.locationName} · {order.riderName}</span>
                  {order.preferredDeliveryDate && (
                    <span className="text-brand-600 dark:text-brand-400 font-medium">
                      Delivery: {formatDeliveryDate(order.preferredDeliveryDate)}
                    </span>
                  )}
                </div>
                <div className="flex gap-2 pt-2">
                  <Link to={`${orderDetailBasePath}/${order.id}`}>
                    <Button variant="secondary" size="sm">
                      View
                    </Button>
                  </Link>
                        {canEditDeliveryDate && order.status === 'CONFIRMED' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              setEditDeliveryDateOrder({
                                orderId: order.id,
                                customerName: order.customerName,
                                preferredDeliveryDate: order.preferredDeliveryDate ?? null,
                              })
                            }
                          >
                            Resolve order
                          </Button>
                        )}
                  {order.status === 'IN_TRANSIT' && (
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => setDeliverConfirm({ orderId: order.id, customerName: order.customerName })}
                    >
                      Mark Delivered
                    </Button>
                  )}
                  {order.status === 'CONFIRMED' && !allocationOnDetailOnly && (
                    <fetcher.Form method="post" className="flex gap-1 flex-wrap">
                      <input type="hidden" name="intent" value="allocate" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="logisticsLocationId" value={rowAllocateLocationByOrder[order.id] ?? ''} />
                      <SearchableSelect
                        id={`logistics-mobile-allocate-${order.id}`}
                        required
                        value={rowAllocateLocationByOrder[order.id] ?? ''}
                        onChange={(value) => setRowAllocateLocationByOrder((prev) => ({ ...prev, [order.id]: value }))}
                        placeholder="Location"
                        searchPlaceholder="Search locations..."
                        options={allocatableLocations.map((loc) => ({ value: loc.id, label: loc.name }))}
                        wrapperClassName="flex-1 min-w-0"
                        controlSize="sm"
                      />
                      <Button type="submit" variant="primary" size="sm" disabled={isSubmitting || !(rowAllocateLocationByOrder[order.id] ?? '')}>
                        Allocate
                      </Button>
                    </fetcher.Form>
                  )}
                  {order.status === 'ALLOCATED' && ridersForOrder.length > 0 && (
                    <fetcher.Form method="post" className="flex gap-1">
                      <input type="hidden" name="intent" value="dispatch" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="riderId" value={rowDispatchRiderByOrder[order.id] ?? ''} />
                      <SearchableSelect
                        id={`logistics-mobile-dispatch-${order.id}`}
                        required
                        value={rowDispatchRiderByOrder[order.id] ?? ''}
                        onChange={(value) => setRowDispatchRiderByOrder((prev) => ({ ...prev, [order.id]: value }))}
                        placeholder="Rider"
                        searchPlaceholder="Search riders..."
                        options={ridersForOrder.map((r) => ({ value: r.id, label: r.name }))}
                        controlSize="sm"
                      />
                      <Button type="submit" variant="primary" size="sm" disabled={isSubmitting || !(rowDispatchRiderByOrder[order.id] ?? '')}>
                        Dispatch
                      </Button>
                    </fetcher.Form>
                  )}
                  {order.status === 'DISPATCHED' && (
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="transition" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="newStatus" value="IN_TRANSIT" />
                      <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
                        {markInTransitLabel}
                      </Button>
                    </fetcher.Form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </TableLoadingOverlay>
      )}

      {!showChartView && totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} pageParam="page" />
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
    </div>
  );
}

// ── Edit Delivery Date Modal ───────────────────────────────────

function getTodayYYYYMMDD(): string {
  return new Date().toISOString().slice(0, 10);
}

function EditDeliveryDateModal({
  orderId,
  customerName,
  initialDate,
  onClose,
  loading,
  onSave,
}: {
  orderId: string;
  customerName: string;
  initialDate: string | null;
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
              folder={S3_FOLDERS.RECEIPTS}
              onUpload={setReceiptUrl}
              accept="image/*,.pdf"
              label="Upload receipt"
              required
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

// ── Delivery Date Helpers ──────────────────────────────────────

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

function DeliveryDateCell({ date }: { date?: string | null }) {
  if (!date) {
    return <span className="text-app-fg-muted text-sm">Not set</span>;
  }

  const overdue = isOverdue(date);
  const today = isToday(date);

  return (
    <span
      className={`text-sm font-medium ${
        overdue
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

