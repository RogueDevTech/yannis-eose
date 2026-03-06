import { useState, useEffect } from 'react';
import { Link, useFetcher, useSearchParams, useNavigation } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { useFetcherToast } from '~/components/ui/toast';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { Spinner } from '~/components/ui/spinner';
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
  locations,
  allocatableLocations: allocatableLocationsProp,
  riders,
  filters,
  isTplManagerScoped = false,
  pageTitle = 'Logistics Orders',
  orderDetailBasePath = '/admin/logistics/orders',
}: LogisticsOrdersPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'CONFIRMED');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [allocateLocationId, setAllocateLocationId] = useState('');
  const [dispatchRiderId, setDispatchRiderId] = useState('');
  const [bulkResult, setBulkResult] = useState<{ succeeded: number; failed: number; errors: string[] } | null>(null);

  const fetcher = useFetcher();
  useFetcherToast(fetcher.data, { successMessage: 'Logistics action completed' });

  useEffect(() => {
    setSelectedStatus(statusFilter || 'CONFIRMED');
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

  const buildQueryString = (overrides: { page?: number; status?: string; search?: string }) => {
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
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const confirmedCount = statusCounts['CONFIRMED'] ?? 0;
  const allocatedCount = statusCounts['ALLOCATED'] ?? 0;
  const dispatchedCount = statusCounts['DISPATCHED'] ?? 0;
  const inTransitCount = statusCounts['IN_TRANSIT'] ?? 0;
  const deliveredCount = statusCounts['DELIVERED'] ?? 0;

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
  const canBulkAllocate = selectedConfirmed.length > 0 && selectedConfirmed.length === selectedIds.size;
  const canBulkDispatch =
    selectedAllocated.length > 0 &&
    selectedAllocated.length === selectedIds.size &&
    new Set(selectedAllocated.map((o) => o.logisticsLocationId)).size === 1;
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
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white">{pageTitle}</h1>
            <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
              Allocate confirmed orders to 3PL locations and dispatch to riders
            </p>
          </div>
          <div className="flex items-center min-h-[2rem] rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 pl-2.5 pr-2 py-1">
            <DateFilterBar
              startDate={filters.startDate}
              endDate={filters.endDate}
              periodAllTime={filters.periodAllTime}
            />
          </div>
        </div>
      </div>

      {isTplManagerScoped && (
        <div className="rounded-lg border border-brand-200 dark:border-brand-700/50 bg-brand-50 dark:bg-brand-900/20 px-3 py-2 text-sm text-brand-800 dark:text-brand-200">
          Showing orders for your location only.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
            Awaiting allocation
          </p>
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">{confirmedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
            Allocated
          </p>
          <p className="text-2xl font-bold text-info-600 dark:text-info-400 mt-1">{allocatedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
            Dispatched
          </p>
          <p className="text-2xl font-bold text-info-600 dark:text-info-400 mt-1">{dispatchedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
            In transit
          </p>
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">{inTransitCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
            Delivered
          </p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">{deliveredCount}</p>
        </div>
      </div>

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
              {canBulkAllocate && (
                <>
                  <select
                    value={allocateLocationId}
                    onChange={(e) => setAllocateLocationId(e.target.value)}
                    className="input py-1.5 text-sm w-48"
                    aria-label="3PL location"
                  >
                    <option value="">Select location</option>
                    {allocatableLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
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
                  <select
                    value={dispatchRiderId}
                    onChange={(e) => setDispatchRiderId(e.target.value)}
                    className="input py-1.5 text-sm w-48"
                    aria-label="Rider"
                  >
                    <option value="">Select rider</option>
                    {ridersForBulkDispatch.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
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
              {selectedIds.size > 0 && !canBulkAllocate && !canBulkDispatch && (
                <span className="text-xs text-surface-600 dark:text-surface-400">
                  Select only CONFIRMED orders to bulk allocate, or only ALLOCATED orders (same location) to bulk dispatch.
                </span>
              )}
            </div>
          </div>
          {bulkResult && (
            <div className="mt-3 p-3 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
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
                    <p className="text-xs text-surface-600 dark:text-surface-400">
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
          <input
            type="search"
            placeholder="Search by customer or order ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input flex-1"
          />
          <Button type="submit" variant="secondary" size="sm">
            Search
          </Button>
        </form>
        <select
          value={selectedStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="input w-auto py-1.5"
        >
          {LOGISTICS_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status === 'ALL' ? 'All statuses' : formatStatus(status)}
            </option>
          ))}
        </select>
        {isFilterLoading && (
          <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
            <Spinner size="sm" className="shrink-0" />
          </span>
        )}
      </div>

      <div className="card p-0 overflow-hidden">
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
                      <Link
                        to={`${orderDetailBasePath}/${order.id}`}
                        className="text-brand-500 hover:text-brand-600 font-medium"
                      >
                        {order.id.slice(0, 8)}...
                      </Link>
                    </td>
                    <td className="table-cell font-medium text-surface-900 dark:text-surface-100">
                      {order.customerName}
                    </td>
                    <td className="table-cell">
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="table-cell">
                      <DeliveryDateCell date={order.preferredDeliveryDate} />
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">{order.locationName}</td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">{order.riderName}</td>
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <Link to={`${orderDetailBasePath}/${order.id}`}>
                          <Button variant="secondary" size="sm">
                            View
                          </Button>
                        </Link>
                        {order.status === 'CONFIRMED' && (
                          <fetcher.Form method="post" className="inline-flex items-center gap-1">
                            <input type="hidden" name="intent" value="allocate" />
                            <input type="hidden" name="orderId" value={order.id} />
                            <select
                              name="logisticsLocationId"
                              required
                              className="input py-1 text-xs w-36"
                              defaultValue=""
                            >
                              <option value="">Location</option>
                              {allocatableLocations.map((loc) => (
                                <option key={loc.id} value={loc.id}>
                                  {loc.name}
                                </option>
                              ))}
                            </select>
                            <Button type="submit" variant="primary" size="sm" disabled={isSubmitting} loading={isSubmitting}>
                              Allocate
                            </Button>
                          </fetcher.Form>
                        )}
                        {order.status === 'ALLOCATED' && (
                          <fetcher.Form method="post" className="inline-flex items-center gap-1">
                            <input type="hidden" name="intent" value="dispatch" />
                            <input type="hidden" name="orderId" value={order.id} />
                            <select
                              name="riderId"
                              required
                              className="input py-1 text-xs w-36"
                              defaultValue=""
                              disabled={ridersForOrder.length === 0}
                            >
                              <option value="">
                                {ridersForOrder.length === 0 ? 'No riders' : 'Rider'}
                              </option>
                              {ridersForOrder.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
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
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {orders.length === 0 && (
          <div className="py-12 text-center text-surface-700 dark:text-surface-300">
            No orders found. Try changing the status filter or date range.
          </div>
        )}

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {orders.map((order) => {
            const ridersForOrder =
              order.logisticsLocationId && order.status === 'ALLOCATED'
                ? riders.filter((r) => r.logisticsLocationId === order.logisticsLocationId)
                : [];
            return (
              <div key={order.id} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <Link
                    to={`${orderDetailBasePath}/${order.id}`}
                    className="font-medium text-brand-500 hover:text-brand-600"
                  >
                    {order.id.slice(0, 8)}...
                  </Link>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="text-sm text-surface-900 dark:text-surface-100">{order.customerName}</p>
                <div className="flex items-center gap-2 text-xs text-surface-700 dark:text-surface-300">
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
                  {order.status === 'CONFIRMED' && (
                    <fetcher.Form method="post" className="flex gap-1 flex-wrap">
                      <input type="hidden" name="intent" value="allocate" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <select name="logisticsLocationId" required className="input py-1 text-xs flex-1 min-w-0">
                        <option value="">Location</option>
                        {allocatableLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
                        Allocate
                      </Button>
                    </fetcher.Form>
                  )}
                  {order.status === 'ALLOCATED' && ridersForOrder.length > 0 && (
                    <fetcher.Form method="post" className="flex gap-1">
                      <input type="hidden" name="intent" value="dispatch" />
                      <input type="hidden" name="orderId" value={order.id} />
                      <select name="riderId" required className="input py-1 text-xs">
                        <option value="">Rider</option>
                        {ridersForOrder.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
                        Dispatch
                      </Button>
                    </fetcher.Form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Link
            to={buildQueryString({ page: page - 1 })}
            className={`btn-secondary btn-sm ${page <= 1 ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Previous
          </Link>
          <span className="text-sm text-surface-700 dark:text-surface-300">
            Page {page} of {totalPages}
          </span>
          <Link
            to={buildQueryString({ page: page + 1 })}
            className={`btn-secondary btn-sm ${page >= totalPages ? 'opacity-50 pointer-events-none' : ''}`}
          >
            Next
          </Link>
        </div>
      )}

    </div>
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
    return <span className="text-surface-400 dark:text-surface-500 text-sm">Not set</span>;
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
            : 'text-surface-900 dark:text-surface-100'
      }`}
    >
      {formatDeliveryDate(date)}
      {overdue && <span className="ml-1 text-xs font-normal">(overdue)</span>}
      {today && <span className="ml-1 text-xs font-normal">(today)</span>}
    </span>
  );
}

