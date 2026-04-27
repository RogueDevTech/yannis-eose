import { useState, useEffect, useRef } from 'react';
import { Link, useFetcher, useSearchParams, useNavigation, useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { Checkbox } from '~/components/ui/checkbox';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { PageHeader } from '~/components/ui/page-header';
import { OrdersChartView } from '~/components/ui/orders-chart-view';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { Pagination } from '~/components/ui/pagination';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { Textarea } from '~/components/ui/textarea';
import { ExportModal } from '~/components/ui/export-modal';
import { CreateOfflineOrderModal } from '~/features/orders/CreateOfflineOrderModal';
import { useLiveIndicator } from '~/hooks/useSocket';
import { STATUS_OPTIONS, STATUS_LABELS, STATUS_TEXT_CLASS, formatStatus } from '~/features/shared/order-status';
import { exportToCsv } from '~/lib/csv-export';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { useBranchScopeActionGuard } from '~/contexts/branch-scope-action-guard';
import type { Order } from './types';

// Status transitions that make sense for bulk operations
const BULK_TRANSITIONS: Record<string, string[]> = {
  UNPROCESSED: ['CANCELLED'],
  CS_ASSIGNED: ['CANCELLED'],
  CONFIRMED: ['ALLOCATED'],
  ALLOCATED: ['DISPATCHED'],
  DISPATCHED: ['IN_TRANSIT'],
};

interface OrdersListPageProps {
  orders: Order[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  statusCounts: Record<string, number>;
  statusFilter?: string;
  searchFilter?: string;
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  userRole?: string;
  /** CS agent sees only their assigned orders; when true, title is "My Orders". */
  isCSAgent?: boolean;
  /** HoS/SuperAdmin see "Assigned CS" column and can filter by agent. */
  showCSAgentColumn?: boolean;
  /** For "Filter by CS Agent" dropdown (HoS/SuperAdmin). */
  csAgentsForFilter?: Array<{ agentId: string; agentName: string }>;
  /** HoS/SuperAdmin can assign directly. */
  canAssignDirectly?: boolean;
  /** Current user id. */
  currentUserId?: string;
  /** Workload snapshot for current CS agent (My Orders). */
  myWorkload?: {
    agentId: string;
    agentName: string;
    capacity: number;
    pendingCount: number;
    lastActionAt: string | null;
  } | null;
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
  /** When true, show "Create offline order" button (CS_AGENT / HEAD_OF_CS). */
  canCreateOffline?: boolean;
  /** Products list for offline order form (when canCreateOffline). */
  productsForOfflineOrder?: Array<{ id: string; name: string; offers?: Array<{ label: string; price: string; qty: number }> }>;
  /** Daily order count series for the "Orders over time" chart (from `orders.timeSeriesByCreated`). */
  dailyCounts?: Array<{ date: string; orderCount: number; deliveredCount?: number }>;
}

export function OrdersListPage({
  orders,
  total,
  totalPages,
  page,
  limit,
  statusCounts,
  statusFilter,
  searchFilter,
  filters,
  userRole,
  isCSAgent = false,
  showCSAgentColumn = false,
  csAgentsForFilter,
  canAssignDirectly = false,
  currentUserId = '',
  myWorkload = null,
  liveEvents,
  canCreateOffline = false,
  productsForOfflineOrder = [],
  dailyCounts,
}: OrdersListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOfflineOpen, setCreateOfflineOpen] = useState(false);
  const [showChartView, setShowChartView] = useState(false);
  const liveState = useLiveIndicator(liveEvents ?? []);
  const navigate = useNavigate();
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');
  const [showExportModal, setShowExportModal] = useState(false);

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

  // Server-side filtering via URL params; orders are already filtered by loader
  const filteredOrders = orders;

  const buildQueryString = (overrides: { page?: number; status?: string; search?: string; csAgentId?: string }) => {
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
    if (overrides.csAgentId !== undefined) {
      if (overrides.csAgentId && overrides.csAgentId !== 'ALL') params.set('csAgentId', overrides.csAgentId);
      else params.delete('csAgentId');
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

  // Checkbox handlers
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredOrders.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredOrders.map((o) => o.id)));
    }
  };

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

  const submitBulkExport = () => {
    const exportData = selectedOrders.map((o) => ({
      id: o.id,
      customer: o.customerName,
      ...(showCSAgentColumn && { assignedCs: o.assignedCsName ?? '—' }),
      phone: o.customerPhoneDisplay,
      status: o.status,
      amount: o.totalAmount ?? '',
      created: new Date(o.createdAt).toLocaleDateString(),
    }));
    exportToCsv(
      exportData,
      [
        { key: 'id', label: 'Order ID' },
        { key: 'customer', label: 'Customer' },
        ...(showCSAgentColumn ? [{ key: 'assignedCs', label: 'Assigned closer' }] : []),
        { key: 'phone', label: 'Phone' },
        { key: 'status', label: 'Status' },
        { key: 'amount', label: 'Amount' },
        { key: 'created', label: 'Created' },
      ],
      `orders-selected-${new Date().toISOString().split('T')[0]}.csv`,
    );
  };

  const canBulkAction = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN' || userRole === 'HEAD_OF_CS' || userRole === 'HEAD_OF_LOGISTICS' || userRole === 'STOCK_MANAGER';

  const statusOptions = STATUS_OPTIONS.map((status) => ({
    value: status,
    label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
  }));

  const csAgentOptions = [
    { value: 'ALL', label: 'All closers' },
    ...(csAgentsForFilter ?? []).map((a) => ({ value: a.agentId, label: a.agentName })),
  ];

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
        title={isCSAgent ? 'My Orders' : 'CS Orders'}
        description={isCSAgent ? 'Track your assigned orders' : 'Manage and track all customer orders'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {liveEvents != null && liveEvents.length > 0 && (
              <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
            )}
            <PageRefreshButton />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowChartView((v) => !v)}
            >
              {showChartView ? 'View as data' : 'View data in chart'}
            </Button>
            {canCreateOffline && (
              <Button variant="primary" size="sm" onClick={() => setCreateOfflineOpen(true)}>
                <span className="hidden sm:inline">Create offline order</span>
                <span className="sm:hidden">+ Order</span>
              </Button>
            )}
          </div>
        }
      />

      {/* Secondary action row — Export only (Live moved up next to refresh; date filter lives in filters card below) */}
      <div className="flex flex-wrap items-center gap-2 -mt-2">
        <div className="ml-auto">
          <Button
            variant="secondary"
            size="sm"
              onClick={() => setShowExportModal(true)}
          >
            Export CSV
          </Button>
        </div>
      </div>

      {/* Status totals — moved above My Workload so the funnel snapshot reads first. */}
      <OverviewStatStrip
        items={[
          { label: 'Total', value: total, valueClassName: 'text-app-fg' },
          ...statusItems,
        ]}
      />

      {/* My workload (CS agent only) */}
      {isCSAgent && myWorkload && (
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
                {myWorkload.pendingCount} of {myWorkload.capacity} slots
              </p>
            </div>
          </div>
          {(() => {
            const utilization =
              myWorkload.capacity > 0
                ? (myWorkload.pendingCount / myWorkload.capacity) * 100
                : 0;
            const barColor =
              utilization >= 90
                ? 'bg-danger-500'
                : utilization >= 70
                  ? 'bg-warning-500'
                  : 'bg-success-500';
            return (
              <>
                <div className="w-full h-2 bg-app-hover rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${Math.min(utilization, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-app-fg-muted">
                    {Math.round(utilization)}% utilized
                  </span>
                  {myWorkload.pendingCount >= myWorkload.capacity && (
                    <span className="text-xs font-medium text-danger-600 dark:text-danger-400">
                      FULL
                    </span>
                  )}
                </div>
              </>
            );
          })()}
        </div>
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
            <div className="flex flex-wrap items-center gap-2">
              {/* Bulk Transition buttons */}
              {availableTransitions.map((status: string) => (
                <Button
                  key={status}
                  variant="primary"
                  size="sm"
                  onClick={() => submitBulkTransition(status)}
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  loadingText="Processing..."
                >
                  {`Transition to ${formatStatus(status)}`}
                </Button>
              ))}
              {selectedStatuses.length > 1 && (
                <span className="text-xs text-app-fg-muted italic">
                  Select orders with same status for bulk transition
                </span>
              )}
              {/* Export selected */}
              <Button variant="secondary" size="sm" onClick={submitBulkExport}>
                Export Selected
              </Button>
            </div>
          </div>
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

      {/* Filters bar */}
      <div className="card">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Date pill — same chrome we use on MarketingTeamPage so the filter is visually
              prominent and easy to spot. The bare DateFilterBar is just a text button which
              disappears into the toolbar; the pill wrapper makes it a clear control. */}
          <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">
            <DateFilterBar
              startDate={filters?.startDate ?? ''}
              endDate={filters?.endDate ?? ''}
              periodAllTime={filters?.periodAllTime ?? false}
            />
          </div>
          <form
            method="get"
            className="flex-1"
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
              placeholder="Search by customer name..."
              value={searchQuery}
              onChange={(val) => setSearchQuery(val)}
              wrapperClassName="w-full"
            />
          </form>
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
            wrapperClassName="w-full sm:w-48"
          />
          {showCSAgentColumn && (csAgentsForFilter?.length ?? 0) > 0 && (
            <SearchableSelect
              id="orders-filter-closer"
              value={searchParams.get('csAgentId') || 'ALL'}
              onChange={(v) => {
                setSelectedIds(new Set());
                setBulkResult(null);
                setSearchParams((p) => {
                  const next = new URLSearchParams(p);
                  next.set('page', '1');
                  if (v && v !== 'ALL') next.set('csAgentId', v);
                  else next.delete('csAgentId');
                  return next;
                });
              }}
              options={csAgentOptions}
              wrapperClassName="w-full sm:w-48"
              placeholder="All closers"
              searchPlaceholder="Search closers..."
            />
          )}
        </div>
      </div>

      {/* Orders table — replaced with chart view when the user toggles "View data in chart" */}
      {showChartView ? (
        <OrdersChartView
          statusCounts={statusCounts}
          total={total}
          scopeLabel="CS orders"
          dailyCounts={dailyCounts}
        />
      ) : (
      <div className="card p-0">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                {canBulkAction && (
                  <th className="table-header w-10">
                    <Checkbox
                      checked={filteredOrders.length > 0 && selectedIds.size === filteredOrders.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                )}
                <th className="table-header">Order ID</th>
                <th className="table-header">Customer</th>
                {showCSAgentColumn && <th className="table-header">Assigned closer</th>}
                <th className="table-header">Status</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Created</th>
                <th className="table-header text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr
                  key={order.id}
                  className={`table-row ${selectedIds.has(order.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''} ${highlightedIds.has(order.id) ? 'row-new-highlight' : ''}`}
                >
                  {canBulkAction && (
                    <td className="table-cell w-10">
                      <Checkbox
                        checked={selectedIds.has(order.id)}
                        onChange={() => toggleSelect(order.id)}
                      />
                    </td>
                  )}
                  <td className="table-cell">
                    <OrderIdBadge id={order.id} linkTo={`/admin/orders/${order.id}`} />
                  </td>
                  <td className="table-cell font-medium text-app-fg">
                    {order.customerName}
                  </td>
                  {showCSAgentColumn && (
                    <td className="table-cell text-app-fg-muted">
                      {order.assignedCsId ? (
                        <Link
                          to={`/hr/users/${order.assignedCsId}`}
                          className="text-brand-500 hover:text-brand-600 font-medium hover:underline"
                        >
                          {order.assignedCsName ?? 'View user'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="table-cell">
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td className="table-cell text-right font-medium">
                    <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
                  </td>
                  <td className="table-cell text-app-fg-muted">
                    {new Date(order.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="table-cell">
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="btn-secondary btn-sm"
                      >
                        View
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={(canBulkAction ? 1 : 0) + 5 + (showCSAgentColumn ? 1 : 0)}>
                    <EmptyState
                      title={orders.length === 0 ? 'No orders yet' : 'No orders found'}
                      description={orders.length === 0 ? undefined : 'Try adjusting your filters or search query'}
                      variant="card"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-3 px-1">
          {filteredOrders.map((order) => (
            <div key={order.id} className={`rounded-lg border border-app-border bg-app-elevated relative ${highlightedIds.has(order.id) ? 'row-new-highlight' : ''}`}>
              {canBulkAction && (
                <div className="absolute top-4 left-4 z-10">
                  <Checkbox
                    checked={selectedIds.has(order.id)}
                    onChange={() => toggleSelect(order.id)}
                  />
                </div>
              )}
              <div className={`p-4 ${canBulkAction ? 'pl-10' : ''} ${selectedIds.has(order.id) ? 'bg-brand-50/50 dark:bg-brand-900/10' : ''}`}>
                <Link
                  to={`/admin/orders/${order.id}`}
                  className="block hover:opacity-90 transition-opacity"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-app-fg">
                      {order.customerName}
                    </span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  {showCSAgentColumn && (order.assignedCsName || order.assignedCsId) && (
                    <div className="text-sm mb-0.5 text-app-fg-muted">
                      {order.assignedCsId ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate(`/hr/users/${order.assignedCsId}`);
                          }}
                        >
                          {order.assignedCsName ?? 'View user'}
                        </Button>
                      ) : (
                        <span>{order.assignedCsName ?? '—'}</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm text-app-fg-muted">
                    <span className="font-mono">{order.customerPhoneDisplay}</span>
                    <span className="font-medium text-app-fg">
                      <NairaPrice amount={order.totalAmount ? Number(order.totalAmount) : null} />
                    </span>
                  </div>
                  <div className="text-xs text-app-fg-muted mt-1">
                    {new Date(order.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </Link>
                <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-app-border">
                  <Link
                    to={`/admin/orders/${order.id}`}
                    className="btn-secondary btn-sm"
                  >
                    View
                  </Link>
                </div>
              </div>
            </div>
          ))}
          {filteredOrders.length === 0 && (
            <EmptyState
              title={orders.length === 0 ? 'No orders yet' : 'No orders found'}
              description={orders.length === 0 ? undefined : 'Try adjusting your filters or search query'}
              variant="card"
            />
          )}
        </div>
      </div>
      )}

      {/* Pagination — table view only; the chart view doesn't paginate. */}
      {!showChartView && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-sm text-app-fg-muted">
            {total > 0
              ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} orders`
              : 'No orders'}
          </p>
          <Pagination page={page} totalPages={totalPages} pageParam="page" />
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
                variant="primary"
                className="border-danger-500 bg-danger-500 hover:bg-danger-600 text-white"
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

      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.cs_orders}
        initialFilters={{
          status: selectedStatus !== 'ALL' ? selectedStatus : undefined,
          search: searchQuery || undefined,
          assignedCsId: searchParams.get('csAgentId') || undefined,
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
