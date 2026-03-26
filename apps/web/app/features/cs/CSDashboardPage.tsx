import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Modal } from '~/components/ui/modal';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { useFetcherToast } from '~/components/ui/toast';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import { Checkbox } from '~/components/ui/checkbox';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { CreateOfflineOrderModal } from '~/features/orders/CreateOfflineOrderModal';
import { useLiveIndicator } from '~/hooks/useSocket';
import type {
  CSDashboardStreamData,
  AgentWorkload,
  InactiveAgent,
  CSOrder,
  DuplicatePair,
  CSLeaderboardEntry,
  PendingCart,
} from './types';

// ─── Agent Workload Card (reusable for strip + modal) ───

function AgentWorkloadCard({ agent, className }: { agent: AgentWorkload; className?: string }) {
  const utilization = agent.capacity > 0 ? (agent.pendingCount / agent.capacity) * 100 : 0;
  const barColor = utilization >= 90
    ? 'bg-danger-500'
    : utilization >= 70
    ? 'bg-warning-500'
    : 'bg-success-500';

  return (
    <div className={className ?? 'card'}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
            {agent.agentName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
            {agent.agentName}
          </p>
          <p className="text-xs text-surface-800 dark:text-surface-200">
            {agent.pendingCount} of {agent.capacity} slots
          </p>
        </div>
      </div>
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
        {agent.pendingCount >= agent.capacity && (
          <span className="text-xs font-medium text-danger-600 dark:text-danger-400">FULL</span>
        )}
      </div>
    </div>
  );
}

// ─── Live cart card (mobile horizontal strip) ───

function LiveCartCard({ cart, className }: { cart: PendingCart; className?: string }) {
  return (
    <div className={className ?? 'rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-3 shadow-sm'}>
      <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">{cart.customerName}</p>
      <p className="text-xs font-mono text-surface-700 dark:text-surface-300 truncate mt-0.5">{cart.customerPhoneDisplay}</p>
      <p className="text-xs text-surface-800 dark:text-surface-200 truncate mt-1">{cart.productName ?? cart.id.slice(0, 8) + '...'}</p>
      <p className="text-xs text-surface-600 dark:text-surface-400 truncate">{cart.campaignName ?? '—'}</p>
      <p className="text-xs text-surface-500 dark:text-surface-500 mt-2">
        {new Date(cart.updatedAt).toLocaleDateString('en-NG', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })}
      </p>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────

export function CSDashboardPage({
  workloads,
  unassignedOrders,
  unassignedTotal,
  activeOrders,
  activeTotal,
  statusCounts,
  isClaimMode = false,
  claimCap = 2,
  inactiveAgents,
  callbackOrders,
  flaggedDuplicates,
  leaderboard,
  leaderboardPeriod = 'this_month',
  cartStats,
  claimQueue,
  liveEvents,
  canCreateOffline = false,
  productsForOfflineOrder = [],
  initialTab,
  initialHotSwapFrom,
}: CSDashboardStreamData) {
  const fetcher = useFetcher();
  const claimFetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const cartsFetcher = useFetcher<{ pendingCarts?: PendingCart[]; abandonedCarts?: PendingCart[] }>();
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [createOfflineOpen, setCreateOfflineOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'queue' | 'active' | 'callbacks' | 'duplicates' | 'carts' | 'hotswap' | 'performance' | 'claim'>(
    initialTab === 'hotswap' ? 'hotswap' : isClaimMode ? 'claim' : 'active',
  );
  // Track which order is being claimed (to show per-row loading state)
  const [claimingOrderId, setClaimingOrderId] = useState<string | null>(null);
  const [assignAgent, setAssignAgent] = useState<Record<string, string>>({});
  const [hotSwapFrom, setHotSwapFrom] = useState(initialHotSwapFrom ?? '');
  const [hotSwapTo, setHotSwapTo] = useState('');
  const [hotSwapOrderIds, setHotSwapOrderIds] = useState<string[]>([]);
  /** Reassign order modal: order + current assignee so we can pick new agent */
  const [reassignOrder, setReassignOrder] = useState<{ orderId: string; customerName: string; assignedCsId: string } | null>(null);
  const [reassignToAgentId, setReassignToAgentId] = useState('');
  /** Pending confirm for Cancel order (replaces window.confirm) */
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState<{ orderId: string; customerName: string } | null>(null);
  /** Live carts table pagination (5 rows per page) */
  const [cartPage, setCartPage] = useState(1);
  /** Cart Abandonment tab: abandoned carts pagination (10 rows per page) */
  const [abandonedCartPage, setAbandonedCartPage] = useState(1);
  /** Agent Workloads: View all modal and pagination */
  const [viewAllAgentsOpen, setViewAllAgentsOpen] = useState(false);
  const [viewAllPage, setViewAllPage] = useState(1);
  /** Cart Abandonment: View cart detail modal */
  const [viewCartModal, setViewCartModal] = useState<PendingCart | null>(null);
  /** Prefill Create Offline Order modal when opening from Cart Abandonment */
  const [createOfflinePrefill, setCreateOfflinePrefill] = useState<{ customerName: string } | null>(null);
  const agentScrollRef = useRef<HTMLDivElement>(null);
  const liveCartsStripRef = useRef<HTMLDivElement>(null);
  const liveCartsTabStripRef = useRef<HTMLDivElement>(null);

  const scrollAgentStrip = useCallback((delta: number) => {
    agentScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  const scrollLiveCartsStrip = useCallback((delta: number) => {
    liveCartsStripRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollLiveCartsTabStrip = useCallback((delta: number) => {
    liveCartsTabStripRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (viewAllAgentsOpen) setViewAllPage(1);
  }, [viewAllAgentsOpen]);

  useEffect(() => {
    if (!viewAllAgentsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewAllAgentsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewAllAgentsOpen]);

  // Fetch cart data when user switches to Cart Abandonment tab (refetch each time for fresh data)
  useEffect(() => {
    if (activeTab === 'carts') {
      cartsFetcher.load('/admin/cs/queue/carts');
    }
  }, [activeTab]);

  const actionError = (fetcher.data as { error?: string })?.error;
  const [dismissedError, setDismissedError] = useState(false);
  const distributeResult = fetcher.data as { success?: boolean; distributed?: number } | undefined;
  const successMessage =
    distributeResult && 'distributed' in distributeResult
      ? distributeResult.distributed === 0
        ? 'No unassigned orders to distribute'
        : `${distributeResult.distributed} order(s) distributed to agents`
      : 'CS action completed';
  useFetcherToast(fetcher.data, { successMessage });
  useFetcherToast(claimFetcher.data, { successMessage: claimFetcher.data?.message ?? 'Order claimed' });

  // Clear claiming state after claim response
  useEffect(() => {
    if (claimFetcher.state === 'idle' && claimingOrderId) {
      setClaimingOrderId(null);
    }
  }, [claimFetcher.state]);

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // Close reassign / cancel modals only after a successful response
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data) {
      const result = fetcher.data as { success?: boolean };
      if (result.success) {
        if (reassignOrder) {
          setReassignOrder(null);
          setReassignToAgentId('');
        }
        if (cancelConfirmOrder) {
          setCancelConfirmOrder(null);
        }
      }
    }
  }, [fetcher.state, fetcher.data]);

  const totalPending = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.pendingCount, 0);
  const totalCapacity = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.capacity, 0);
  const confirmedCount = (statusCounts as Record<string, number>)['CONFIRMED'] ?? 0;
  const cancelledCount = (statusCounts as Record<string, number>)['CANCELLED'] ?? 0;

  // Get orders assigned to the hotswap source agent
  const hotSwapSourceOrders = activeOrders.filter(
    (o: CSOrder) => o.assignedCsId === hotSwapFrom,
  );

  function handleAssign(orderId: string) {
    const agentId = assignAgent[orderId];
    if (!agentId) return;
    fetcher.submit(
      { intent: 'assign', orderId, csAgentId: agentId },
      { method: 'post' },
    );
  }

  function handleHotSwap() {
    if (hotSwapOrderIds.length === 0 || !hotSwapFrom || !hotSwapTo) return;
    fetcher.submit(
      {
        intent: 'bulkReassign',
        orderIds: JSON.stringify(hotSwapOrderIds),
        fromAgentId: hotSwapFrom,
        toAgentId: hotSwapTo,
      },
      { method: 'post' },
    );
  }

  function handleReassignSubmit() {
    if (!reassignOrder || !reassignToAgentId || reassignToAgentId === reassignOrder.assignedCsId) return;
    fetcher.submit(
      {
        intent: 'bulkReassign',
        orderIds: JSON.stringify([reassignOrder.orderId]),
        fromAgentId: reassignOrder.assignedCsId,
        toAgentId: reassignToAgentId,
      },
      { method: 'post' },
    );
  }

  function toggleHotSwapOrder(orderId: string) {
    setHotSwapOrderIds((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId],
    );
  }

  function selectAllHotSwap() {
    setHotSwapOrderIds(hotSwapSourceOrders.map((o: CSOrder) => o.id));
  }

  // Suppress unused variable warning — cancelledCount may be used in future stats
  void cancelledCount;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Live activities</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Manage agents, dispatch orders, and monitor workloads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageRefreshButton />
          {canCreateOffline && (
            <Button variant="primary" size="sm" onClick={() => setCreateOfflineOpen(true)}>
              Create offline order
            </Button>
          )}
          {liveEvents != null && liveEvents.length > 0 && (
            <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
          )}
        </div>
      </div>

      {canCreateOffline && (
        <CreateOfflineOrderModal
          open={createOfflineOpen}
          onClose={() => { setCreateOfflineOpen(false); setCreateOfflinePrefill(null); }}
          onSuccess={() => { setCreateOfflineOpen(false); setCreateOfflinePrefill(null); }}
          initialCustomerName={createOfflinePrefill?.customerName}
          products={productsForOfflineOrder}
        />
      )}

      {actionError && !dismissedError && (
        <PageNotification
          variant="error"
          message={actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      {/* Overview + Order Pipeline (compact, single horizontal row) */}
      <div className="card">
        <div className="flex flex-nowrap gap-3 overflow-x-auto pb-1">
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Active Agents
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {workloads.length}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Pending confirmation
            </p>
            <p className="text-xl font-bold text-warning-600 dark:text-warning-400 mt-1">
              {totalPending}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Unassigned
            </p>
            <p className="text-xl font-bold text-danger-600 dark:text-danger-400 mt-1">
              {unassignedTotal}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Confirmed
            </p>
            <p className="text-xl font-bold text-brand-600 dark:text-brand-400 mt-1">
              {confirmedCount}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Capacity
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {totalPending}
              <span className="text-sm font-normal text-surface-700 dark:text-surface-300">
                /{totalCapacity}
              </span>
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              CS Engaged
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {(statusCounts as Record<string, number>)['CS_ENGAGED'] ?? 0}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Cancelled
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {(statusCounts as Record<string, number>)['CANCELLED'] ?? 0}
            </p>
          </div>
          {cartStats && (
            <>
              <DeferredSection resolve={cartStats} skeleton="inline">
                {(stats: { pending: number; abandonedLast24h: number }) => (
                  <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                    <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                      Cart Pending
                    </p>
                    <p className="text-xl font-bold text-warning-600 dark:text-warning-400 mt-1">
                      {stats.pending}
                    </p>
                  </div>
                )}
              </DeferredSection>
              <DeferredSection resolve={cartStats} skeleton="inline">
                {(stats: { pending: number; abandonedLast24h: number }) => (
                  <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                    <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                      Abandoned (24h)
                    </p>
                    <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
                      {stats.abandonedLast24h}
                    </p>
                  </div>
                )}
              </DeferredSection>
            </>
          )}
        </div>
      </div>

      {/* Live carts overview — only after cart data has been loaded (open Cart Abandonment tab once) */}
      {cartsFetcher.data != null && (
        <div className="card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-surface-900 dark:text-white">Live carts</h2>
            {(cartsFetcher.data.pendingCarts?.length ?? 0) > 0 && (
              <div className="flex md:hidden items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => scrollLiveCartsStrip(-260)}
                  className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                  aria-label="Scroll left"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => scrollLiveCartsStrip(260)}
                  className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors"
                  aria-label="Scroll right"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-surface-700 dark:text-surface-300 mb-3">
            Carts in progress: customers filled name + phone but haven&apos;t submitted yet. May convert soon.
          </p>
          <div className="flex flex-col">
            {(() => {
              const carts = cartsFetcher.data.pendingCarts ?? [];
              const pageSize = 5;
              const totalPages = Math.max(1, Math.ceil(carts.length / pageSize));
              const page = Math.min(cartPage, totalPages);
              const start = (page - 1) * pageSize;
              const rows = carts.slice(start, start + pageSize);
              return carts.length > 0 ? (
                <>
                  <div
                    ref={liveCartsStripRef}
                    className="flex md:hidden flex-nowrap gap-3 overflow-x-auto overflow-y-hidden pb-1 -mx-1 px-1"
                    style={{ scrollbarWidth: 'thin' } as React.CSSProperties}
                  >
                    {carts.map((c) => (
                      <LiveCartCard key={c.id} cart={c} className="shrink-0 w-[260px] rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-3 shadow-sm" />
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto overflow-y-auto -mx-4 px-4 min-h-0 max-h-[15rem]">
                    <table className="w-full text-sm table-fixed">
                      <thead>
                        <tr className="h-10">
                          <th className="table-header text-left">Customer</th>
                          <th className="table-header text-left">Phone</th>
                          <th className="table-header text-left">Product</th>
                          <th className="table-header text-left">Campaign</th>
                          <th className="table-header text-left">Last activity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => (
                          <tr key={c.id} className="table-row h-10">
                            <td className="table-cell font-medium text-surface-900 dark:text-surface-100 truncate">{c.customerName}</td>
                            <td className="table-cell font-mono text-xs truncate">{c.customerPhoneDisplay}</td>
                            <td className="table-cell text-surface-800 dark:text-surface-200 truncate">{c.productName ?? c.id.slice(0, 8) + '...'}</td>
                            <td className="table-cell text-surface-800 dark:text-surface-200 truncate">{c.campaignName ?? '—'}</td>
                            <td className="table-cell text-surface-700 dark:text-surface-300 whitespace-nowrap">
                              {new Date(c.updatedAt).toLocaleDateString('en-NG', {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                              })}
                            </td>
                          </tr>
                        ))}
                        {rows.length < pageSize &&
                          Array.from({ length: pageSize - rows.length }).map((_, i) => (
                            <tr key={`empty-${i}`} className="h-10" aria-hidden="true">
                              <td colSpan={5} className="table-cell border-b border-transparent" />
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="hidden md:flex items-center justify-between gap-2 mt-3 pt-3 border-t border-surface-100 dark:border-surface-800 shrink-0">
                    <span className="text-xs text-surface-600 dark:text-surface-400">
                      Page {page} of {totalPages}
                      <span className="ml-1">
                        ({start + 1}–{Math.min(start + pageSize, carts.length)} of {carts.length})
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setCartPage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setCartPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-surface-700 dark:text-surface-300 py-3 text-center">No live carts</p>
              );
            })()}
          </div>
        </div>
      )}

      {/* Agent Workloads — horizontal scroll strip + View all */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Agent Workloads</h2>
          {workloads.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollAgentStrip(-280)}
                className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                aria-label="Scroll left"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scrollAgentStrip(280)}
                className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                aria-label="Scroll right"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setViewAllAgentsOpen(true)}
              >
                View all
              </Button>
            </div>
          )}
        </div>
        {workloads.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-surface-700 dark:text-surface-300">No CS agents found. Manage staff from HR → Users.</p>
          </div>
        ) : (
          <div
            ref={agentScrollRef}
            className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden pb-1"
          >
            {workloads.map((agent: AgentWorkload) => (
              <AgentWorkloadCard
                key={agent.agentId}
                agent={agent}
                className="card shrink-0 w-64"
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-200 dark:border-surface-700">
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v as typeof activeTab)}
          tabs={[
            ...(isClaimMode ? [{
              value: 'claim',
              label: 'Claim Queue',
              badge: claimQueue ? (
                <DeferredSection resolve={claimQueue} skeleton="inline">
                  {(orders: CSOrder[]) =>
                    orders.length > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 text-xs font-bold">
                        {orders.length}
                      </span>
                    ) : null
                  }
                </DeferredSection>
              ) : undefined,
            }] : []),
            { value: 'active', label: `Active Orders (${activeTotal})` },
            { value: 'queue', label: `Unassigned Queue (${unassignedTotal})` },
            {
              value: 'callbacks',
              label: 'Callbacks',
              badge: (
                <DeferredSection resolve={callbackOrders} skeleton="inline">
                  {(orders: CSOrder[]) =>
                    orders.length > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400 text-xs font-bold">
                        {orders.length}
                      </span>
                    ) : null
                  }
                </DeferredSection>
              ),
            },
            {
              value: 'duplicates',
              label: 'Duplicates',
              badge: (
                <DeferredSection resolve={flaggedDuplicates} skeleton="inline">
                  {(pairs: DuplicatePair[]) =>
                    pairs.length > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400 text-xs font-bold">
                        {pairs.length}
                      </span>
                    ) : null
                  }
                </DeferredSection>
              ),
            },
            {
              value: 'carts',
              label: 'Cart Abandonment',
              badge: cartStats ? (
                <DeferredSection resolve={cartStats} skeleton="inline">
                  {(stats: { pending: number; abandonedLast24h: number }) => {
                    const n = stats.abandonedLast24h + stats.pending;
                    return n > 0 ? <span> ({n})</span> : null;
                  }}
                </DeferredSection>
              ) : undefined,
            },
            { value: 'hotswap', label: 'Hot Swap' },
            { value: 'performance', label: 'Performance' },
          ]}
          className="border-b-0 flex-1 min-w-0"
        />
        {activeTab === 'queue' ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="shrink-0 -mb-px"
            disabled={fetcher.state !== 'idle'}
            onClick={() => fetcher.submit({ intent: 'redistribute' }, { method: 'post' })}
          >
            {fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'redistribute'
              ? 'Distributing…'
              : 'Distribute Order'}
          </Button>
        ) : (
          <Link
            to="/admin/cs/orders"
            className="btn-primary btn-sm shrink-0 -mb-px inline-flex items-center justify-center"
          >
            Go to Orders
          </Link>
        )}
      </div>

      {/* Tab Content — fixed height so layout does not shift */}
      {activeTab === 'queue' && (
        <div className="card p-0 overflow-hidden flex flex-col h-[28rem]">
          <div className="hidden md:block overflow-auto flex-1 min-h-0">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Order ID</th>
                  <th className="table-header">Customer</th>
                  <th className="table-header">Phone</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Created</th>
                  <th className="table-header">Assign To</th>
                  <th className="table-header text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {unassignedOrders.map((order: CSOrder) => (
                  <tr key={order.id} className="table-row">
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
                    <td className="table-cell font-mono text-sm">
                      {order.customerPhoneDisplay}
                    </td>
                    <td className="table-cell text-right font-medium">
                      {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                    </td>
                    <td className="table-cell text-surface-800 dark:text-surface-200">
                      {new Date(order.createdAt).toLocaleDateString('en-NG', {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <select
                          value={assignAgent[order.id] ?? ''}
                          onChange={(e) => setAssignAgent((prev) => ({ ...prev, [order.id]: e.target.value }))}
                          className="input py-1 text-sm w-32"
                        >
                          <option value="">Select...</option>
                          {workloads
                            .filter((w: AgentWorkload) => w.pendingCount < w.capacity)
                            .map((w: AgentWorkload) => (
                              <option key={w.agentId} value={w.agentId}>
                                {w.agentName} ({w.pendingCount}/{w.capacity})
                              </option>
                            ))}
                        </select>
                        <Button
                          onClick={() => handleAssign(order.id)}
                          disabled={!assignAgent[order.id] || fetcher.state === 'submitting'}
                          variant="primary"
                          size="sm"
                          loading={fetcher.state === 'submitting'}
                          loadingText="Assigning..."
                        >
                          Assign
                        </Button>
                      </div>
                    </td>
                    <td className="table-cell text-center">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          to={`/admin/orders/${order.id}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          View
                        </Link>
                        <button
                          type="button"
                          onClick={() => setCancelConfirmOrder({ orderId: order.id, customerName: order.customerName })}
                          disabled={fetcher.state === 'submitting'}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-danger-700 dark:text-danger-200 bg-danger-50 dark:bg-danger-900/40 hover:bg-danger-100 dark:hover:bg-danger-800/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                          title="Cancel order (removes from queue; order stays in DB)"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {unassignedOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                      No unassigned orders in queue
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile — cards */}
          <div className="md:hidden overflow-auto flex-1 min-h-0 p-3 space-y-3">
            {unassignedOrders.map((order: CSOrder) => (
              <div
                key={order.id}
                className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm space-y-3"
              >
                <div className="flex items-center justify-between">
                  <Link
                    to={`/admin/orders/${order.id}`}
                    className="text-brand-500 hover:text-brand-600 font-medium text-sm"
                  >
                    {order.customerName}
                  </Link>
                  <span className="text-sm font-medium text-surface-900 dark:text-surface-100">
                    {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                  </span>
                </div>
                <p className="text-xs font-mono text-surface-700 dark:text-surface-300">{order.customerPhoneDisplay}</p>
                <p className="text-xs text-surface-600 dark:text-surface-400">
                  {new Date(order.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
                <div className="flex items-center gap-2">
                  <select
                    value={assignAgent[order.id] ?? ''}
                    onChange={(e) => setAssignAgent((prev) => ({ ...prev, [order.id]: e.target.value }))}
                    className="input py-1 text-sm flex-1"
                  >
                    <option value="">Select agent...</option>
                    {workloads
                      .filter((w: AgentWorkload) => w.pendingCount < w.capacity)
                      .map((w: AgentWorkload) => (
                        <option key={w.agentId} value={w.agentId}>
                          {w.agentName} ({w.pendingCount}/{w.capacity})
                        </option>
                      ))}
                  </select>
                  <Button
                    onClick={() => handleAssign(order.id)}
                    disabled={!assignAgent[order.id] || fetcher.state === 'submitting'}
                    variant="primary"
                    size="sm"
                    loading={fetcher.state === 'submitting'}
                    loadingText="Assigning..."
                  >
                    Assign
                  </Button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Link
                    to={`/admin/orders/${order.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                  >
                    View
                  </Link>
                  <button
                    type="button"
                    onClick={() => setCancelConfirmOrder({ orderId: order.id, customerName: order.customerName })}
                    disabled={fetcher.state === 'submitting'}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-danger-700 dark:text-danger-200 bg-danger-50 dark:bg-danger-900/40 hover:bg-danger-100 dark:hover:bg-danger-800/50 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                    title="Cancel order"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {unassignedOrders.length === 0 && (
              <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-8 text-center text-surface-700 dark:text-surface-300">
                No unassigned orders
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'active' && (
        <div className="card p-0 overflow-hidden flex flex-col h-[28rem]">
          <div className="hidden md:block overflow-auto flex-1 min-h-0">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Order ID</th>
                  <th className="table-header">Customer</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Assigned Agent</th>
                  <th className="table-header">Created</th>
                  <th className="table-header text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeOrders.map((order: CSOrder) => {
                  const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
                  return (
                    <tr key={order.id} className="table-row">
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
                      <td className="table-cell">
                        <OrderStatusBadge status={order.status} />
                      </td>
                      <td className="table-cell text-right font-medium">
                        {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                      </td>
                      <td className="table-cell">
                        {agent ? (
                          <span className="text-sm text-surface-900 dark:text-surface-100">{agent.agentName}</span>
                        ) : (
                          <span className="text-sm text-surface-700 dark:text-surface-300">Unassigned</span>
                        )}
                      </td>
                      <td className="table-cell text-surface-800 dark:text-surface-200">
                        {new Date(order.createdAt).toLocaleDateString('en-NG', {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center justify-center gap-1.5">
                          <Link
                            to={`/admin/orders/${order.id}`}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                            title="View order"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            View
                          </Link>
                          <button
                            type="button"
                            onClick={() => order.assignedCsId && setReassignOrder({ orderId: order.id, customerName: order.customerName, assignedCsId: order.assignedCsId })}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-800/50 transition-colors"
                            title="Reassign to another agent"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4m4 4V4m0 12l4 4m-4-4l4-4" />
                            </svg>
                            Reassign
                          </button>
                          <button
                            onClick={() => setCancelConfirmOrder({ orderId: order.id, customerName: order.customerName })}
                            disabled={fetcher.state === 'submitting'}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-danger-700 dark:text-danger-200 bg-danger-50 dark:bg-danger-900/40 hover:bg-danger-100 dark:hover:bg-danger-800/50 transition-colors"
                            title="Cancel order"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Cancel order
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {activeOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                      No active CS-engaged orders
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile — cards */}
          <div className="md:hidden overflow-auto flex-1 min-h-0 p-3 space-y-3">
            {activeOrders.map((order: CSOrder) => {
              const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-surface-900 dark:text-surface-100">{order.customerName}</span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <div className="flex items-center justify-between text-sm text-surface-800 dark:text-surface-200">
                    <span>{agent?.agentName ?? 'Unassigned'}</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">
                      {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                    </span>
                  </div>
                  <p className="text-xs text-surface-600 dark:text-surface-400">
                    {new Date(order.createdAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Link
                      to={`/admin/orders/${order.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                    >
                      View
                    </Link>
                    <button
                      type="button"
                      onClick={() => order.assignedCsId && setReassignOrder({ orderId: order.id, customerName: order.customerName, assignedCsId: order.assignedCsId })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-brand-700 dark:text-brand-200 bg-brand-50 dark:bg-brand-900/40 hover:bg-brand-100 dark:hover:bg-brand-800/50 transition-colors"
                    >
                      Reassign
                    </button>
                    <button
                      onClick={() => setCancelConfirmOrder({ orderId: order.id, customerName: order.customerName })}
                      disabled={fetcher.state === 'submitting'}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium text-danger-700 dark:text-danger-200 bg-danger-50 dark:bg-danger-900/40 hover:bg-danger-100 dark:hover:bg-danger-800/50 transition-colors"
                    >
                      Cancel order
                    </button>
                  </div>
                </div>
              );
            })}
            {activeOrders.length === 0 && (
              <div className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-8 text-center text-surface-700 dark:text-surface-300">
                No active orders
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'hotswap' && (
        <div className="h-[28rem] overflow-auto">
          <div className="space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">Hot Swap</h2>
            <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
              Select orders from one agent and bulk-reassign them to another agent.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  From Agent
                </label>
                <select
                  value={hotSwapFrom}
                  onChange={(e) => {
                    setHotSwapFrom(e.target.value);
                    setHotSwapOrderIds([]);
                  }}
                  className="input"
                >
                  <option value="">Select source agent...</option>
                  {workloads.map((w: AgentWorkload) => (
                    <option key={w.agentId} value={w.agentId}>
                      {w.agentName} ({w.pendingCount} orders)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  To Agent
                </label>
                <select
                  value={hotSwapTo}
                  onChange={(e) => setHotSwapTo(e.target.value)}
                  className="input"
                >
                  <option value="">Select target agent...</option>
                  {workloads
                    .filter((w: AgentWorkload) => w.agentId !== hotSwapFrom)
                    .map((w: AgentWorkload) => (
                      <option key={w.agentId} value={w.agentId}>
                        {w.agentName} ({w.pendingCount}/{w.capacity})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {hotSwapFrom && hotSwapSourceOrders.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-surface-700 dark:text-surface-300">
                    Select orders to reassign ({hotSwapOrderIds.length} selected)
                  </p>
                  <button
                    onClick={selectAllHotSwap}
                    className="text-sm text-brand-500 hover:text-brand-600 font-medium"
                  >
                    Select All ({hotSwapSourceOrders.length})
                  </button>
                </div>

                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {hotSwapSourceOrders.map((order: CSOrder) => (
                    <label
                      key={order.id}
                      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-pointer"
                    >
                      <Checkbox
                        checked={hotSwapOrderIds.includes(order.id)}
                        onChange={() => toggleHotSwapOrder(order.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                            {order.customerName}
                          </span>
                          <OrderStatusBadge status={order.status} />
                        </div>
                        <span className="text-xs text-surface-700 dark:text-surface-300">
                          {order.id.slice(0, 8)}... &middot; {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            {hotSwapFrom && hotSwapSourceOrders.length === 0 && (
              <p className="text-sm text-surface-700 dark:text-surface-300 text-center py-4">
                No active orders for this agent
              </p>
            )}
          </div>

          {/* Hot Swap action */}
          {hotSwapOrderIds.length > 0 && hotSwapTo && (
            <div className="flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setHotSwapOrderIds([])}>
                Clear Selection
              </Button>
              <Button
                variant="primary"
                onClick={handleHotSwap}
                disabled={fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Reassigning..."
              >
                {`Reassign ${hotSwapOrderIds.length} Order${hotSwapOrderIds.length > 1 ? 's' : ''}`}
              </Button>
            </div>
          )}
          </div>
        </div>
      )}

      {/* ── Claim Queue Tab ──────────────────────────── */}
      {activeTab === 'claim' && claimQueue && (
        <DeferredSection resolve={claimQueue} skeleton="table">
          {(orders: CSOrder[]) => (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Claim Queue</h2>
                    <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
                      Unassigned orders available to claim. First agent to click Claim takes the order.
                      Cap: <strong>{claimCap}</strong> unconfirmed orders per agent.
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-success-600 dark:text-success-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-success-500 inline-block animate-pulse" />
                    Live
                  </span>
                </div>

                {orders.length === 0 ? (
                  <div className="text-center py-12 text-surface-700 dark:text-surface-300">
                    No orders in the claim queue right now.
                  </div>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="hidden md:block overflow-auto">
                      <table className="w-full">
                        <thead>
                          <tr>
                            <th className="table-header">Order</th>
                            <th className="table-header">Customer</th>
                            <th className="table-header">Phone</th>
                            <th className="table-header text-right">Amount</th>
                            <th className="table-header">Received</th>
                            <th className="table-header" />
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((order: CSOrder) => {
                            const isClaiming = claimingOrderId === order.id && claimFetcher.state === 'submitting';
                            // Count how many unconfirmed orders the current user has
                            // We cap check is enforced server-side; disable button while submitting
                            return (
                              <tr key={order.id} className="table-row">
                                <td className="table-cell">
                                  <Link
                                    to={`/admin/orders/${order.id}`}
                                    className="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
                                  >
                                    {order.id.slice(0, 8).toUpperCase()}
                                  </Link>
                                </td>
                                <td className="table-cell">
                                  <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{order.customerName}</p>
                                </td>
                                <td className="table-cell">
                                  <span className="text-xs font-mono text-surface-700 dark:text-surface-300">{order.customerPhoneDisplay}</span>
                                </td>
                                <td className="table-cell text-right text-sm">
                                  {order.totalAmount ? `₦${Number(order.totalAmount).toLocaleString()}` : '—'}
                                </td>
                                <td className="table-cell text-xs text-surface-700 dark:text-surface-300">
                                  {new Date(order.createdAt).toLocaleString('en-NG', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </td>
                                <td className="table-cell text-right">
                                  <Button
                                    type="button"
                                    variant="primary"
                                    size="sm"
                                    loading={isClaiming}
                                    loadingText="Claiming..."
                                    disabled={claimFetcher.state === 'submitting'}
                                    onClick={() => {
                                      setClaimingOrderId(order.id);
                                      claimFetcher.submit(
                                        { intent: 'claimOrder', orderId: order.id },
                                        { method: 'post' },
                                      );
                                    }}
                                  >
                                    Claim
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="md:hidden space-y-3">
                      {orders.map((order: CSOrder) => {
                        const isClaiming = claimingOrderId === order.id && claimFetcher.state === 'submitting';
                        return (
                          <div
                            key={order.id}
                            className="rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <Link
                                  to={`/admin/orders/${order.id}`}
                                  className="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
                                >
                                  {order.id.slice(0, 8).toUpperCase()}
                                </Link>
                                <p className="text-sm font-medium text-surface-900 dark:text-surface-100 mt-0.5">{order.customerName}</p>
                                <p className="text-xs font-mono text-surface-700 dark:text-surface-300">{order.customerPhoneDisplay}</p>
                                {order.totalAmount && (
                                  <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">₦{Number(order.totalAmount).toLocaleString()}</p>
                                )}
                                <p className="text-xs text-surface-500 dark:text-surface-400 mt-1">
                                  {new Date(order.createdAt).toLocaleString('en-NG', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="primary"
                                size="sm"
                                loading={isClaiming}
                                loadingText="Claiming..."
                                disabled={claimFetcher.state === 'submitting'}
                                onClick={() => {
                                  setClaimingOrderId(order.id);
                                  claimFetcher.submit(
                                    { intent: 'claimOrder', orderId: order.id },
                                    { method: 'post' },
                                  );
                                }}
                              >
                                Claim
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </DeferredSection>
      )}

      {/* ── Performance Tab ─────────────────────────── */}
      {activeTab === 'performance' && (
        <DeferredSection resolve={leaderboard} skeleton="table">
          {(lb: CSLeaderboardEntry[]) => {
            if (lb.length === 0) return null;
            return (
              <div className="card p-0 overflow-hidden flex flex-col h-[28rem]">
                <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800 shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-surface-900 dark:text-white">CS Agent Performance</h3>
                      <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                        Ranked by delivery rate ({leaderboardPeriod === 'all_time' ? 'all time' : 'this month'})
                      </p>
                    </div>
                    <div className="flex gap-1 rounded-lg bg-surface-100 dark:bg-surface-800 p-1">
                      <Link
                        to="/admin/cs/queue?period=this_month"
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          leaderboardPeriod === 'this_month'
                            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                            : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                        }`}
                      >
                        This month
                      </Link>
                      <Link
                        to="/admin/cs/queue?period=all_time"
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          leaderboardPeriod === 'all_time'
                            ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                            : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                        }`}
                      >
                        All time
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="hidden md:block overflow-auto flex-1 min-h-0">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">#</th>
                        <th className="table-header">Agent</th>
                        <th className="table-header text-right">Engaged</th>
                        <th className="table-header text-right">Confirmed</th>
                        <th className="table-header text-right">Delivered</th>
                        <th className="table-header text-right">Calls</th>
                        <th className="table-header text-right">Conf. Rate</th>
                        <th className="table-header text-right">Del. Rate</th>
                        <th className="table-header text-right">Avg Call</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lb.map((e: CSLeaderboardEntry, idx: number) => (
                        <tr key={e.agentId} className="table-row">
                          <td className="table-cell text-surface-700 dark:text-surface-300 font-mono text-sm">{idx + 1}</td>
                          <td className="table-cell">
                            <p className="text-sm font-medium text-surface-900 dark:text-surface-100">{e.agentName}</p>
                          </td>
                          <td className="table-cell text-right text-sm">{e.ordersEngaged}</td>
                          <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">{e.ordersConfirmed}</td>
                          <td className="table-cell text-right text-sm font-medium text-brand-600 dark:text-brand-400">{e.ordersDelivered}</td>
                          <td className="table-cell text-right text-sm">{e.callsMade}</td>
                          <td className="table-cell text-right text-sm">{e.confirmationRate.toFixed(1)}%</td>
                          <td className="table-cell text-right">
                            <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-surface-900 dark:text-white'}`}>
                              {e.deliveryRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="table-cell text-right text-sm text-surface-700 dark:text-surface-300">
                            {e.avgCallDurationSeconds >= 60
                              ? `${Math.floor(e.avgCallDurationSeconds / 60)}m ${e.avgCallDurationSeconds % 60}s`
                              : `${e.avgCallDurationSeconds}s`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile — cards */}
                <div className="md:hidden overflow-auto flex-1 min-h-0 p-3 space-y-3">
                  {lb.map((e: CSLeaderboardEntry, idx: number) => (
                    <div
                      key={e.agentId}
                      className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-surface-700 dark:text-surface-300">#{idx + 1}</span>
                          <span className="font-medium text-surface-900 dark:text-white text-sm">{e.agentName}</span>
                        </div>
                        <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-surface-900 dark:text-white'}`}>
                          {e.deliveryRate.toFixed(1)}% del.
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Confirmed</span>
                          <p className="font-medium text-surface-900 dark:text-white">{e.ordersConfirmed}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Calls</span>
                          <p className="font-medium text-surface-900 dark:text-white">{e.callsMade}</p>
                        </div>
                        <div>
                          <span className="text-surface-700 dark:text-surface-300">Conf. Rate</span>
                          <p className="font-medium text-surface-900 dark:text-white">{e.confirmationRate.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          }}
        </DeferredSection>
      )}

      {/* ── Callbacks Tab ──────────────────────────── */}
      {activeTab === 'callbacks' && (
        <DeferredSection resolve={callbackOrders} skeleton="table">
          {(resolvedCallbacks: CSOrder[]) => (
            <div className="h-[28rem] overflow-auto">
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Callback Queue</h2>
                    <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
                      Orders awaiting callback retry after &ldquo;No Answer&rdquo;
                    </p>
                  </div>
                </div>

                {resolvedCallbacks.length === 0 ? (
                  <div className="text-center py-12 text-surface-700 dark:text-surface-300">
                    No callbacks scheduled
                  </div>
                ) : (
                  <div className="space-y-3">
                    {resolvedCallbacks.map((order: CSOrder) => {
                      const isDue = order.callbackScheduledAt && new Date(order.callbackScheduledAt) <= new Date();
                      const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
                      return (
                        <div
                          key={order.id}
                          className={`rounded-lg border p-4 ${
                            isDue
                              ? 'border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/10'
                              : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Link
                                  to={`/admin/orders/${order.id}`}
                                  className="text-brand-500 hover:text-brand-600 font-medium text-sm"
                                >
                                  {order.id.slice(0, 8)}...
                                </Link>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                                  Attempt {order.callbackAttempts ?? 0}/3
                                </span>
                                {isDue && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400">
                                    DUE NOW
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-medium text-surface-900 dark:text-surface-100">
                                {order.customerName}
                              </p>
                              <p className="text-xs text-surface-800 dark:text-surface-200">
                                {order.customerPhoneDisplay}
                                {agent ? ` \u00b7 Assigned: ${agent.agentName}` : ''}
                                {order.totalAmount ? ` \u00b7 \u20A6${Number(order.totalAmount).toLocaleString()}` : ''}
                              </p>
                              {order.callbackScheduledAt && (
                                <p className="text-xs text-surface-700 dark:text-surface-300 mt-1">
                                  Scheduled: {new Date(order.callbackScheduledAt).toLocaleString('en-NG', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </p>
                              )}
                              {order.callbackNotes && (
                                <p className="text-xs text-surface-800 dark:text-surface-200 mt-1 italic">
                                  Note: {order.callbackNotes}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Link
                                to={`/admin/orders/${order.id}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                View
                              </Link>
                              <Link
                                to={`/admin/orders/${order.id}`}
                                className="btn-primary btn-sm"
                              >
                                Call Now
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            </div>
          )}
        </DeferredSection>
      )}

      {/* ── Duplicates Tab ─────────────────────────── */}
      {activeTab === 'duplicates' && (
        <DeferredSection resolve={flaggedDuplicates} skeleton="table">
          {(resolvedDuplicates: DuplicatePair[]) => (
            <div className="h-[28rem] overflow-auto">
            <div className="space-y-4">
              <div className="card">
                <div className="mb-4">
                  <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Duplicate Review</h2>
                  <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
                    Potential duplicate orders flagged for review. Compare and merge, dismiss, or cancel.
                  </p>
                </div>

                {resolvedDuplicates.length === 0 ? (
                  <div className="text-center py-12 text-surface-700 dark:text-surface-300">
                    No flagged duplicates
                  </div>
                ) : (
                  <div className="space-y-6">
                    {resolvedDuplicates.map((pair: DuplicatePair) => (
                      <div key={pair.duplicate.id} className="rounded-lg border border-danger-200 dark:border-danger-800 overflow-hidden">
                        <div className="bg-danger-50 dark:bg-danger-900/20 px-4 py-2.5 border-b border-danger-200 dark:border-danger-800">
                          <p className="text-sm font-semibold text-danger-700 dark:text-danger-400">
                            Potential Duplicate Detected
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-surface-200 dark:divide-surface-700">
                          {/* Original Order */}
                          <div className="p-4">
                            <p className="text-xs font-semibold text-surface-800 dark:text-surface-200 uppercase tracking-wider mb-2">
                              Original Order
                            </p>
                            {pair.original ? (
                              <div className="space-y-1.5">
                                <Link to={`/admin/orders/${pair.original.id}`} className="text-brand-500 hover:text-brand-600 font-medium text-sm">
                                  {pair.original.id.slice(0, 8)}...
                                </Link>
                                <p className="text-sm text-surface-900 dark:text-surface-100">{pair.original.customerName}</p>
                                <p className="text-xs text-surface-800 dark:text-surface-200">{pair.original.customerPhoneDisplay}</p>
                                <p className="text-xs text-surface-800 dark:text-surface-200">
                                  Amount: {pair.original.totalAmount ? `\u20A6${Number(pair.original.totalAmount).toLocaleString()}` : '\u2014'}
                                </p>
                                <p className="text-xs text-surface-800 dark:text-surface-200">
                                  Status: <OrderStatusBadge status={pair.original.status} />
                                </p>
                                <p className="text-xs text-surface-700 dark:text-surface-300">
                                  Created: {new Date(pair.original.createdAt).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                            ) : (
                              <p className="text-sm text-surface-700 dark:text-surface-300 italic">Original order not found</p>
                            )}
                          </div>

                          {/* Flagged Duplicate */}
                          <div className="p-4 bg-danger-50/50 dark:bg-danger-900/5">
                            <p className="text-xs font-semibold text-danger-600 dark:text-danger-400 uppercase tracking-wider mb-2">
                              Flagged Duplicate
                            </p>
                            <div className="space-y-1.5">
                              <Link to={`/admin/orders/${pair.duplicate.id}`} className="text-brand-500 hover:text-brand-600 font-medium text-sm">
                                {pair.duplicate.id.slice(0, 8)}...
                              </Link>
                              <p className="text-sm text-surface-900 dark:text-surface-100">{pair.duplicate.customerName}</p>
                              <p className="text-xs text-surface-800 dark:text-surface-200">{pair.duplicate.customerPhoneDisplay}</p>
                              <p className="text-xs text-surface-800 dark:text-surface-200">
                                Amount: {pair.duplicate.totalAmount ? `\u20A6${Number(pair.duplicate.totalAmount).toLocaleString()}` : '\u2014'}
                              </p>
                              <p className="text-xs text-surface-800 dark:text-surface-200">
                                Status: <OrderStatusBadge status={pair.duplicate.status} />
                              </p>
                              <p className="text-xs text-surface-700 dark:text-surface-300">
                                Created: {new Date(pair.duplicate.createdAt).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="px-4 py-3 bg-surface-50 dark:bg-surface-800/50 border-t border-surface-200 dark:border-surface-700 flex items-center gap-3 flex-wrap">
                          {pair.original && (
                            <Button
                              onClick={() => {
                                fetcher.submit(
                                  { intent: 'mergeDuplicate', duplicateId: pair.duplicate.id, originalId: pair.original!.id },
                                  { method: 'post' },
                                );
                              }}
                              disabled={fetcher.state === 'submitting'}
                              variant="primary"
                              size="sm"
                              loading={fetcher.state === 'submitting'}
                              loadingText="Merging..."
                            >
                              Merge into Original
                            </Button>
                          )}
                          <Button
                            onClick={() => {
                              fetcher.submit(
                                { intent: 'dismissDuplicate', orderId: pair.duplicate.id },
                                { method: 'post' },
                              );
                            }}
                            disabled={fetcher.state === 'submitting'}
                            variant="secondary"
                            size="sm"
                            loading={fetcher.state === 'submitting'}
                            loadingText="Dismissing..."
                          >
                            Dismiss (Legitimate Order)
                          </Button>
                          <Button
                            onClick={() => {
                              fetcher.submit(
                                { intent: 'transition', orderId: pair.duplicate.id, newStatus: 'CANCELLED', reason: 'Confirmed duplicate order' },
                                { method: 'post' },
                              );
                            }}
                            disabled={fetcher.state === 'submitting'}
                            variant="danger"
                            size="sm"
                            loading={fetcher.state === 'submitting'}
                            loadingText="Cancelling..."
                            className="font-medium"
                          >
                            Cancel Duplicate
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </div>
          )}
        </DeferredSection>
      )}

      {/* ── Cart Abandonment Tab (fetched when tab is selected) ─────────────────────────── */}
      {activeTab === 'carts' && (
        <div className="card p-0 overflow-hidden flex flex-col h-[28rem]">
          {cartsFetcher.state === 'loading' || (cartsFetcher.state === 'idle' && !cartsFetcher.data) ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <p className="text-sm text-surface-600 dark:text-surface-400">Loading cart data…</p>
            </div>
          ) : (
            (() => {
              const abandonedCarts = cartsFetcher.data?.abandonedCarts ?? [];
              const pageSize = 10;
              const totalPages = Math.max(1, Math.ceil(abandonedCarts.length / pageSize));
              const page = Math.min(abandonedCartPage, totalPages);
              const start = (page - 1) * pageSize;
              const rows = abandonedCarts.slice(start, start + pageSize);
              return (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800 shrink-0 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Abandoned (last 24h)</h2>
                      <p className="text-sm text-surface-700 dark:text-surface-300 mt-0.5">
                        Carts marked abandoned (no order submitted). Same count as the stat above.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={page <= 1}
                        onClick={() => setAbandonedCartPage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={page >= totalPages}
                        onClick={() => setAbandonedCartPage((p) => Math.min(totalPages, p + 1))}
                      >
                        Next
                      </Button>
                      <Link
                        to="/admin/cs/orders?status=UNPROCESSED"
                        className="btn-primary btn-sm inline-flex items-center justify-center"
                      >
                        View all
                      </Link>
                    </div>
                  </div>
                  <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    {abandonedCarts.length > 0 ? (
                      <>
                        {/* Desktop — table */}
                        <div className="hidden md:block overflow-auto flex-1 min-h-0" style={{ minHeight: '14rem' }}>
                          <table className="w-full text-sm table-fixed border-collapse">
                            <thead>
                              <tr className="h-10">
                                <th className="table-header text-left">Customer</th>
                                <th className="table-header text-left">Phone</th>
                                <th className="table-header text-left">Product</th>
                                <th className="table-header text-left">Campaign</th>
                                <th className="table-header text-left">Last activity</th>
                                <th className="table-header text-center w-32">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((c) => (
                                <tr key={c.id} className="table-row h-10">
                                  <td className="table-cell font-medium text-surface-900 dark:text-surface-100 truncate">{c.customerName}</td>
                                  <td className="table-cell font-mono text-xs truncate">{c.customerPhoneDisplay}</td>
                                  <td className="table-cell text-surface-800 dark:text-surface-200 truncate">{c.productName ?? c.id.slice(0, 8) + '...'}</td>
                                  <td className="table-cell text-surface-800 dark:text-surface-200 truncate">{c.campaignName ?? '—'}</td>
                                  <td className="table-cell text-surface-700 dark:text-surface-300 whitespace-nowrap">
                                    {new Date(c.updatedAt).toLocaleDateString('en-NG', {
                                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                    })}
                                  </td>
                                  <td className="table-cell text-center">
                                    <div className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                                      <button
                                        type="button"
                                        onClick={() => setViewCartModal(c)}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                                        title="View cart details"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        View
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setCreateOfflinePrefill({ customerName: c.customerName }); setCreateOfflineOpen(true); }}
                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-success-700 dark:text-success-200 bg-success-50 dark:bg-success-900/40 hover:bg-success-100 dark:hover:bg-success-800/50 transition-colors"
                                        title="Create offline order for this customer"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                                        </svg>
                                        Create order
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                              {rows.length < pageSize &&
                                Array.from({ length: pageSize - rows.length }).map((_, i) => (
                                  <tr key={`empty-${i}`} className="h-10" aria-hidden="true">
                                    <td colSpan={6} className="table-cell border-b border-transparent" />
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                        {/* Mobile — cards */}
                        <div className="md:hidden overflow-auto flex-1 min-h-0 p-3 space-y-3">
                          {rows.map((c) => (
                            <div
                              key={c.id}
                              className="rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4 shadow-sm space-y-2"
                            >
                              <p className="font-medium text-surface-900 dark:text-surface-100">{c.customerName}</p>
                              <p className="text-xs font-mono text-surface-700 dark:text-surface-300">{c.customerPhoneDisplay}</p>
                              <p className="text-xs text-surface-800 dark:text-surface-200">{c.productName ?? '—'}</p>
                              <p className="text-xs text-surface-600 dark:text-surface-400">{c.campaignName ?? '—'}</p>
                              <p className="text-xs text-surface-600 dark:text-surface-400">
                                {new Date(c.updatedAt).toLocaleDateString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                              <div className="flex items-center gap-2 pt-2">
                                <button
                                  type="button"
                                  onClick={() => setViewCartModal(c)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                                >
                                  View
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setCreateOfflinePrefill({ customerName: c.customerName }); setCreateOfflineOpen(true); }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-success-700 dark:text-success-200 bg-success-50 dark:bg-success-900/40 hover:bg-success-100 dark:hover:bg-success-800/50 transition-colors"
                                >
                                  Create order
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center p-8">
                        <p className="text-sm text-surface-700 dark:text-surface-300">No abandoned carts in the last 24h</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-4 py-3 border-t border-surface-100 dark:border-surface-800 shrink-0">
                    <span className="text-xs text-surface-600 dark:text-surface-400">
                      {abandonedCarts.length > 0 ? (
                        <>
                          Page {page} of {totalPages}
                          <span className="ml-1">
                            ({start + 1}–{Math.min(start + pageSize, abandonedCarts.length)} of {abandonedCarts.length})
                          </span>
                        </>
                      ) : (
                        '0 carts'
                      )}
                    </span>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* ── View cart (Cart Abandonment) modal ───────────────── */}
      {viewCartModal && (
        <Modal open onClose={() => setViewCartModal(null)} maxWidth="max-w-md" role="dialog" aria-labelledby="view-cart-title" contentClassName="p-6">
            <h3 id="view-cart-title" className="text-lg font-semibold text-surface-900 dark:text-white mb-4">
              Abandoned cart details
            </h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-surface-600 dark:text-surface-400 font-medium">Customer</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{viewCartModal.customerName}</dd>
              </div>
              <div>
                <dt className="text-surface-600 dark:text-surface-400 font-medium">Phone</dt>
                <dd className="font-mono text-surface-900 dark:text-surface-100 mt-0.5">{viewCartModal.customerPhoneDisplay}</dd>
              </div>
              <div>
                <dt className="text-surface-600 dark:text-surface-400 font-medium">Product</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{viewCartModal.productName ?? '—'}</dd>
              </div>
              {viewCartModal.offerLabel && (
                <div>
                  <dt className="text-surface-600 dark:text-surface-400 font-medium">Offer</dt>
                  <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{viewCartModal.offerLabel}</dd>
                </div>
              )}
              <div>
                <dt className="text-surface-600 dark:text-surface-400 font-medium">Campaign</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">{viewCartModal.campaignName ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-surface-600 dark:text-surface-400 font-medium">Last activity</dt>
                <dd className="text-surface-900 dark:text-surface-100 mt-0.5">
                  {new Date(viewCartModal.updatedAt).toLocaleString('en-NG', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2 mt-6">
              <Button
                variant="primary"
                size="sm"
                onClick={() => { setViewCartModal(null); setCreateOfflinePrefill({ customerName: viewCartModal.customerName }); setCreateOfflineOpen(true); }}
              >
                Create order
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setViewCartModal(null)}>
                Close
              </Button>
            </div>
        </Modal>
      )}

      {/* ── Reassign order modal ───────────────── */}
      {reassignOrder && (
        <Modal open onClose={() => { setReassignOrder(null); setReassignToAgentId(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">
              Reassign order
            </h3>
            <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
              {reassignOrder.customerName} ({reassignOrder.orderId.slice(0, 8)}...)
            </p>

            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                Assign to agent
              </label>
              <select
                value={reassignToAgentId}
                onChange={(e) => setReassignToAgentId(e.target.value)}
                className="input"
              >
                <option value="">Select agent...</option>
                {workloads
                  .filter((w: AgentWorkload) => w.agentId !== reassignOrder.assignedCsId && w.pendingCount < w.capacity)
                  .map((w: AgentWorkload) => (
                    <option key={w.agentId} value={w.agentId}>
                      {w.agentName} ({w.pendingCount}/{w.capacity})
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setReassignOrder(null);
                  setReassignToAgentId('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleReassignSubmit}
                disabled={!reassignToAgentId || fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Reassigning..."
              >
                Reassign
              </Button>
            </div>
        </Modal>
      )}

      {/* Performance Quick Stats moved into top Overview card */}

      {cancelConfirmOrder && (
        <ConfirmActionModal
          open={!!cancelConfirmOrder}
          onClose={() => setCancelConfirmOrder(null)}
          title="Cancel order?"
          description={
            <>
              Cancel order for <strong>{cancelConfirmOrder.customerName}</strong>? The order will be moved to Cancelled. You can add a reason on the order detail page if needed.
            </>
          }
          confirmLabel="Cancel order"
          variant="danger"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            fetcher.submit(
              {
                intent: 'transition',
                orderId: cancelConfirmOrder.orderId,
                newStatus: 'CANCELLED',
                reason: 'Cancelled by CS from dashboard',
              },
              { method: 'post' },
            );
          }}
        />
      )}

      {/* View all Agent Workloads modal — 20 per page, Prev/Next */}
      {viewAllAgentsOpen && (
        <Modal open onClose={() => setViewAllAgentsOpen(false)} maxWidth="max-w-4xl" role="dialog" aria-labelledby="view-all-agents-title" contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-100 dark:border-surface-800 shrink-0">
              <h2 id="view-all-agents-title" className="text-lg font-semibold text-surface-900 dark:text-white">
                Agent Workloads
              </h2>
              <button
                type="button"
                onClick={() => setViewAllAgentsOpen(false)}
                className="p-2 rounded-lg text-surface-600 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-2 border-b border-surface-100 dark:border-surface-800 shrink-0">
              <p className="text-sm text-surface-600 dark:text-surface-400">
                {workloads.length} agent{workloads.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {(() => {
                const pageSize = 20;
                const totalPages = Math.max(1, Math.ceil(workloads.length / pageSize));
                const page = Math.min(viewAllPage, totalPages);
                const start = (page - 1) * pageSize;
                const rows = workloads.slice(start, start + pageSize);

                return (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                      {rows.map((agent: AgentWorkload) => (
                        <AgentWorkloadCard key={agent.agentId} agent={agent} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
                      <span className="text-sm text-surface-600 dark:text-surface-400">
                        Page {page} of {totalPages}
                        {workloads.length > 0 && (
                          <span className="ml-1">
                            ({start + 1}–{Math.min(start + pageSize, workloads.length)} of {workloads.length})
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setViewAllPage((p) => Math.max(1, p - 1))}
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page >= totalPages}
                          onClick={() => setViewAllPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
        </Modal>
      )}
    </div>
  );
}
