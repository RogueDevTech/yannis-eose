import { useState, useEffect, useRef } from 'react';
import { Link, useFetcher, useSearchParams, useNavigation, useNavigate } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { Spinner } from '~/components/ui/spinner';
import { ActionDropdown, type ActionDropdownItem } from '~/components/ui/action-dropdown';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { useLiveIndicator } from '~/hooks/useSocket';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';
import { exportToCsv } from '~/lib/csv-export';
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
  /** HoS/SuperAdmin can assign directly; CS_AGENT requests transfer. */
  canAssignDirectly?: boolean;
  /** Current user id (for "my order" transfer check). */
  currentUserId?: string;
  /** Workload snapshot for current CS agent (My Orders). */
  myWorkload?: {
    agentId: string;
    agentName: string;
    capacity: number;
    pendingCount: number;
    lastActionAt: string | null;
  } | null;
  /** CS agents list for Transfer modal (from csWorkloads or listCSAgents). */
  csAgentsForTransfer?: Array<{ agentId: string; agentName: string }>;
  /** Pending transfer requests where current user is target. */
  pendingTransferRequests?: Array<{
    id: string;
    orderId: string;
    fromCsId: string;
    fromCsName: string | null;
    toCsId: string;
    status: string;
    requestedAt: string;
    reason: string | null;
    order: { id: string; customerName: string; status: string } | null;
  }>;
  /** When provided, shows the Live indicator and subscribes to these events for "just received" state. */
  liveEvents?: string[];
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
  csAgentsForTransfer = [],
  pendingTransferRequests = [],
  liveEvents,
}: OrdersListPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const liveState = useLiveIndicator(liveEvents ?? []);
  const navigate = useNavigate();
  const navigation = useNavigation();
  const isFilterLoading = navigation.state === 'loading';
  const [selectedStatus, setSelectedStatus] = useState(statusFilter || 'ALL');
  const [searchQuery, setSearchQuery] = useState(searchFilter || '');

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
  const transferFetcher = useFetcher();

  const [actionsDropdownOrderId, setActionsDropdownOrderId] = useState<string | null>(null);
  const [transferModalOrder, setTransferModalOrder] = useState<Order | null>(null);
  const [transferToAgentId, setTransferToAgentId] = useState<string>('');
  const [transferReason, setTransferReason] = useState<string>('');

  const NON_TRANSFERABLE_STATUSES = new Set([
    'CONFIRMED', 'ALLOCATED', 'DISPATCHED', 'IN_TRANSIT',
    'DELIVERED', 'COMPLETED', 'RETURNED', 'RESTOCKED', 'WRITTEN_OFF', 'CANCELLED',
  ]);

  const canTransferOrder = (order: Order) => {
    if (!csAgentsForTransfer.length) return false;
    if (NON_TRANSFERABLE_STATUSES.has(order.status)) return false;
    if (canAssignDirectly) return true;
    return isCSAgent && currentUserId && order.assignedCsId === currentUserId;
  };

  useEffect(() => {
    if (transferFetcher.state === 'idle' && transferFetcher.data && (transferFetcher.data as { success?: boolean }).success) {
      setTransferModalOrder(null);
      setTransferToAgentId('');
      setTransferReason('');
      setActionsDropdownOrderId(null);
    }
  }, [transferFetcher.state, transferFetcher.data]);

  function getOrderActionsItems(order: Order): ActionDropdownItem[] {
    const transferReq = pendingTransferRequests.find(
      (req) =>
        req.orderId === order.id &&
        req.status === 'PENDING' &&
        req.toCsId === currentUserId,
    );

    const items: ActionDropdownItem[] = [
      { label: 'View', to: `/admin/orders/${order.id}` },
    ];
    if (transferReq) {
      items.push(
        {
          label: 'Accept transfer',
          variant: 'success',
          onClick: () => {
            transferFetcher.submit(
              { intent: 'acceptTransfer', requestId: transferReq.id },
              { method: 'post' },
            );
          },
        },
        {
          label: 'Reject transfer',
          variant: 'danger',
          onClick: () => {
            transferFetcher.submit(
              { intent: 'rejectTransfer', requestId: transferReq.id },
              { method: 'post' },
            );
          },
        },
      );
    }
    if (canTransferOrder(order)) {
      items.push({
        label: 'Transfer to agent...',
        onClick: () => {
          setTransferModalOrder(order);
          setTransferToAgentId('');
          setTransferReason('');
          setActionsDropdownOrderId(null);
        },
      });
    }
    return items;
  }

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

  const unprocessedCount = statusCounts['UNPROCESSED'] ?? 0;
  const confirmedCount = statusCounts['CONFIRMED'] ?? 0;
  const deliveredCount = statusCounts['DELIVERED'] ?? 0;

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

  const submitBulkTransition = (newStatus: string) => {
    setBulkResult(null);
    fetcher.submit(
      {
        intent: 'bulkTransition',
        orderIds: JSON.stringify([...selectedIds]),
        newStatus,
      },
      { method: 'post' },
    );
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
        ...(showCSAgentColumn ? [{ key: 'assignedCs', label: 'Assigned CS' }] : []),
        { key: 'phone', label: 'Phone' },
        { key: 'status', label: 'Status' },
        { key: 'amount', label: 'Amount' },
        { key: 'created', label: 'Created' },
      ],
      `orders-selected-${new Date().toISOString().split('T')[0]}.csv`,
    );
  };

  const canBulkAction = userRole === 'SUPER_ADMIN' || userRole === 'HEAD_OF_CS' || userRole === 'HEAD_OF_LOGISTICS' || userRole === 'WAREHOUSE_MANAGER';

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">
            {isCSAgent ? 'My Orders' : 'CS Orders'}
          </h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            {isCSAgent ? 'Track your assigned orders' : 'Manage and track all customer orders'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {liveEvents != null && liveEvents.length > 0 && (
            <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
          )}
          {filters != null && (
            <div className="flex items-center min-h-[2rem] rounded-md border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800/50 pl-2.5 pr-2 py-1">
              <DateFilterBar
                startDate={filters.startDate ?? ''}
                endDate={filters.endDate ?? ''}
                periodAllTime={filters.periodAllTime ?? false}
              />
            </div>
          )}
          <Button
          variant="secondary"
          size="sm"
          onClick={() => exportToCsv(
            filteredOrders.map((o) => ({
              id: o.id,
              customer: o.customerName,
              ...(showCSAgentColumn && { assignedCs: o.assignedCsName ?? '—' }),
              phone: o.customerPhoneDisplay,
              status: o.status,
              amount: o.totalAmount ?? '',
              created: new Date(o.createdAt).toLocaleDateString(),
            })),
            [
              { key: 'id', label: 'Order ID' },
              { key: 'customer', label: 'Customer' },
              ...(showCSAgentColumn ? [{ key: 'assignedCs', label: 'Assigned CS' }] : []),
              { key: 'phone', label: 'Phone' },
              { key: 'status', label: 'Status' },
              { key: 'amount', label: 'Amount' },
              { key: 'created', label: 'Created' },
            ],
            `orders-${new Date().toISOString().split('T')[0]}.csv`,
          )}
        >
          Export CSV
        </Button>
      </div>
      </div>

      {/* My workload (CS agent only) */}
      {isCSAgent && myWorkload && (
        <div className="card">
          <h2 className="text-sm font-semibold text-surface-900 dark:text-white mb-2">
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
              <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                {myWorkload.agentName}
              </p>
              <p className="text-xs text-surface-800 dark:text-surface-200">
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
                <div className="w-full h-2 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                    style={{ width: `${Math.min(utilization, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-surface-700 dark:text-surface-300">
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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Unprocessed</p>
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{unprocessedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Confirmed</p>
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">{confirmedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Delivered</p>
          <p className="text-2xl font-bold text-success-600 dark:text-success-400 mt-1">{deliveredCount}</p>
        </div>
      </div>

      {/* Pending transfer requests (target agent can Accept/Reject) */}
      {pendingTransferRequests.length > 0 && (
        <div className="card bg-warning-50 dark:bg-warning-900/20 border-warning-200 dark:border-warning-700/50">
          <h3 className="text-sm font-semibold text-warning-800 dark:text-warning-200 mb-2">Transfer requests for you</h3>
          <ul className="space-y-2">
            {pendingTransferRequests.map((req) => (
              <li
                key={req.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-warning-200/50 dark:border-warning-700/50 last:border-0"
              >
                <div className="text-sm text-surface-800 dark:text-surface-200">
                  <span className="font-medium">{req.fromCsName ?? 'Unknown'}</span>
                  {' requested to transfer '}
                  {req.order ? (
                    <Link to={`/admin/orders/${req.order.id}`} className="text-brand-600 dark:text-brand-400 hover:underline">
                      {req.order.customerName}
                    </Link>
                  ) : (
                    <span>order {req.orderId.slice(0, 8)}...</span>
                  )}
                  {' to you.'}
                  {req.reason && (
                    <p className="mt-1 text-surface-600 dark:text-surface-400 italic">Reason: {req.reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <transferFetcher.Form method="post" className="inline">
                    <input type="hidden" name="intent" value="acceptTransfer" />
                    <input type="hidden" name="requestId" value={req.id} />
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      disabled={transferFetcher.state !== 'idle'}
                      loading={transferFetcher.state !== 'idle'}
                      loadingText="..."
                    >
                      Accept
                    </Button>
                  </transferFetcher.Form>
                  <transferFetcher.Form method="post" className="inline">
                    <input type="hidden" name="intent" value="rejectTransfer" />
                    <input type="hidden" name="requestId" value={req.id} />
                    <Button
                      type="submit"
                      variant="secondary"
                      size="sm"
                      disabled={transferFetcher.state !== 'idle'}
                    >
                      Reject
                    </Button>
                  </transferFetcher.Form>
                </div>
              </li>
            ))}
          </ul>
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
                <span className="text-xs text-surface-800 dark:text-surface-200 italic">
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
            <div className="mt-3 p-3 rounded-lg bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
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
          <div className="flex items-center gap-2 shrink-0">
            <DateFilterBar
              startDate={filters?.startDate ?? ''}
              endDate={filters?.endDate ?? ''}
              periodAllTime={filters?.periodAllTime ?? false}
            />
          </div>
          <form
            method="get"
            className="relative flex-1"
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
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              name="search"
              placeholder="Search by customer name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 py-1.5 w-full"
            />
          </form>
          <select
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
            className="input w-full sm:w-48 py-1.5"
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status === 'ALL' ? 'All Statuses' : formatStatus(status)}
              </option>
            ))}
          </select>
          {showCSAgentColumn && (csAgentsForFilter?.length ?? 0) > 0 && (
            <select
              value={searchParams.get('csAgentId') || 'ALL'}
              onChange={(e) => {
                const v = e.target.value;
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
              className="input w-full sm:w-48 py-1.5"
              aria-label="Filter by CS agent"
            >
              <option value="ALL">All agents</option>
              {csAgentsForFilter!.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.agentName}
                </option>
              ))}
            </select>
          )}
          {isFilterLoading && (
            <span className="flex items-center text-surface-500 dark:text-surface-400" aria-hidden>
              <Spinner size="sm" className="shrink-0" />
            </span>
          )}
        </div>
      </div>

      {/* Orders table */}
      <div className="card p-0 overflow-hidden">
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
                {showCSAgentColumn && <th className="table-header">Assigned CS</th>}
                <th className="table-header">Phone</th>
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
                    <Link
                      to={`/admin/orders/${order.id}`}
                      className="text-brand-500 hover:text-brand-600 font-medium"
                    >
                      {order.id.slice(0, 8)}...
                    </Link>
                  </td>
                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100">
                    {order.customerName}
                  </td>
                  {showCSAgentColumn && (
                    <td className="table-cell text-surface-800 dark:text-surface-200">
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
                  <td className="table-cell font-mono text-sm">
                    {order.customerPhoneDisplay}
                  </td>
                  <td className="table-cell">
                    <div className="flex flex-col gap-1">
                      <OrderStatusBadge status={order.status} />
                      {pendingTransferRequests.some(
                        (req) =>
                          req.orderId === order.id &&
                          req.status === 'PENDING' &&
                          req.toCsId === currentUserId,
                      ) && (
                        <span className="inline-flex items-center rounded-full bg-warning-50 dark:bg-warning-900/20 px-2 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300">
                          Transfer request pending
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="table-cell text-right font-medium">
                    {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                  </td>
                  <td className="table-cell text-surface-800 dark:text-surface-200">
                    {new Date(order.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="table-cell text-center">
                    <ActionDropdown
                      id={order.id}
                      trigger="actions"
                      items={getOrderActionsItems(order)}
                      openMenuId={actionsDropdownOrderId}
                      setOpenMenuId={setActionsDropdownOrderId}
                    />
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={(canBulkAction ? 1 : 0) + 6 + (showCSAgentColumn ? 1 : 0)} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                    {orders.length === 0 ? 'No orders yet' : 'No orders found'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
          {filteredOrders.map((order) => (
            <div key={order.id} className={`relative ${highlightedIds.has(order.id) ? 'row-new-highlight' : ''}`}>
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
                    <span className="font-medium text-surface-900 dark:text-surface-100">
                      {order.customerName}
                    </span>
                    <div className="flex flex-col items-end gap-1">
                      <OrderStatusBadge status={order.status} />
                      {pendingTransferRequests.some(
                        (req) =>
                          req.orderId === order.id &&
                          req.status === 'PENDING' &&
                          req.toCsId === currentUserId,
                      ) && (
                        <span className="inline-flex items-center rounded-full bg-warning-50 dark:bg-warning-900/20 px-2 py-0.5 text-[10px] font-semibold text-warning-700 dark:text-warning-300">
                          Transfer request pending
                        </span>
                      )}
                    </div>
                  </div>
                  {showCSAgentColumn && (order.assignedCsName || order.assignedCsId) && (
                    <div className="text-xs mb-0.5 text-surface-600 dark:text-surface-400">
                      {order.assignedCsId ? (
                        <button
                          type="button"
                          className="text-brand-500 hover:text-brand-600 hover:underline"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            navigate(`/hr/users/${order.assignedCsId}`);
                          }}
                        >
                          {order.assignedCsName ?? 'View user'}
                        </button>
                      ) : (
                        <span>{order.assignedCsName ?? '—'}</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm text-surface-800 dark:text-surface-200">
                    <span className="font-mono">{order.customerPhoneDisplay}</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">
                      {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                    </span>
                  </div>
                  <div className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                    {new Date(order.createdAt).toLocaleDateString('en-NG', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </Link>
                <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-surface-100 dark:border-surface-700">
                  <Link
                    to={`/admin/orders/${order.id}`}
                    className="text-xs text-brand-600 dark:text-brand-400 font-medium"
                  >
                    View
                  </Link>
                  {canTransferOrder(order) && (
                    <button
                      type="button"
                      className="text-xs text-surface-600 dark:text-surface-400 font-medium"
                      onClick={() => {
                        setTransferModalOrder(order);
                        setTransferToAgentId('');
                        setTransferReason('');
                      }}
                    >
                      Transfer to agent...
                    </button>
                  )}
                  {pendingTransferRequests.some(
                    (req) =>
                      req.orderId === order.id &&
                      req.status === 'PENDING' &&
                      req.toCsId === currentUserId,
                  ) && (
                    <>
                      <button
                        type="button"
                        className="text-xs font-medium text-success-600 dark:text-success-400"
                        onClick={() => {
                          const req = pendingTransferRequests.find(
                            (r) =>
                              r.orderId === order.id &&
                              r.status === 'PENDING' &&
                              r.toCsId === currentUserId,
                          );
                          if (!req) return;
                          transferFetcher.submit(
                            { intent: 'acceptTransfer', requestId: req.id },
                            { method: 'post' },
                          );
                        }}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className="text-xs font-medium text-danger-600 dark:text-danger-400"
                        onClick={() => {
                          const req = pendingTransferRequests.find(
                            (r) =>
                              r.orderId === order.id &&
                              r.status === 'PENDING' &&
                              r.toCsId === currentUserId,
                          );
                          if (!req) return;
                          transferFetcher.submit(
                            { intent: 'rejectTransfer', requestId: req.id },
                            { method: 'post' },
                          );
                        }}
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filteredOrders.length === 0 && (
            <div className="p-8 text-center text-surface-700 dark:text-surface-300">
              {orders.length === 0 ? 'No orders yet' : 'No orders found'}
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-surface-800 dark:text-surface-200">
          {total > 0
            ? `Showing ${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total} orders`
            : 'No orders'}
        </p>
        <div className="flex items-center gap-2">
          <Link
            to={page > 1 ? buildQueryString({ page: page - 1 }) || '?' : '#'}
            prefetch="intent"
            className={`btn-secondary btn-sm ${page <= 1 ? 'pointer-events-none opacity-50' : ''}`}
            aria-disabled={page <= 1}
          >
            Previous
          </Link>
          <span className="text-sm text-surface-800 dark:text-surface-200 px-2">
            Page {page} of {totalPages || 1}
          </span>
          <Link
            to={page < totalPages ? buildQueryString({ page: page + 1 }) || '?' : '#'}
            prefetch="intent"
            className={`btn-secondary btn-sm ${page >= totalPages ? 'pointer-events-none opacity-50' : ''}`}
            aria-disabled={page >= totalPages}
          >
            Next
          </Link>
        </div>
      </div>

      {/* Transfer modal */}
      {transferModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" aria-modal="true" role="dialog">
          <div className="card max-w-md w-full shadow-xl">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
              {canAssignDirectly ? 'Assign order' : 'Request transfer'}
            </h3>
            <p className="text-sm text-surface-700 dark:text-surface-300 mt-1">
              {transferModalOrder.customerName} — {transferModalOrder.id.slice(0, 8)}...
            </p>
            {canAssignDirectly ? (
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                The order will be assigned immediately. No approval needed.
              </p>
            ) : (
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-1">
                The selected agent must accept the transfer before the order is reassigned.
              </p>
            )}
            <transferFetcher.Form method="post" className="mt-4 space-y-4">
              <input type="hidden" name="intent" value="transfer" />
              <input type="hidden" name="orderId" value={transferModalOrder.id} />
              <input type="hidden" name="direct" value={canAssignDirectly ? 'true' : 'false'} />
              <div>
                <label htmlFor="transfer-to-agent" className="block text-sm font-medium text-surface-800 dark:text-surface-200 mb-1">
                  Transfer to
                </label>
                <select
                  id="transfer-to-agent"
                  name="toCsAgentId"
                  required
                  value={transferToAgentId}
                  onChange={(e) => setTransferToAgentId(e.target.value)}
                  className="input w-full"
                >
                  <option value="">Select agent...</option>
                  {csAgentsForTransfer
                    .filter((a) => !isCSAgent || a.agentId !== currentUserId)
                    .map((a) => (
                      <option key={a.agentId} value={a.agentId}>
                        {a.agentName}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label htmlFor="transfer-reason" className="block text-sm font-medium text-surface-800 dark:text-surface-200 mb-1">
                  Reason for transfer (optional)
                </label>
                <textarea
                  id="transfer-reason"
                  name="reason"
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. Workload rebalance, specialist follow-up..."
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  className="input w-full resize-none"
                />
              </div>
              {(transferFetcher.data as { error?: string } | undefined)?.error && (
                <p className="text-sm text-danger-600 dark:text-danger-400">{(transferFetcher.data as { error: string }).error}</p>
              )}
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => { setTransferModalOrder(null); setTransferToAgentId(''); setTransferReason(''); }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!transferToAgentId || transferFetcher.state !== 'idle'}
                  loading={transferFetcher.state !== 'idle'}
                  loadingText="Sending..."
                >
                  {canAssignDirectly ? 'Assign' : 'Request transfer'}
                </Button>
              </div>
            </transferFetcher.Form>
          </div>
        </div>
      )}

    </div>
  );
}
