import { useState } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { useFetcherToast } from '~/components/ui/toast';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import type {
  CSDashboardStreamData,
  AgentWorkload,
  InactiveAgent,
  CSOrder,
  DuplicatePair,
  CSLeaderboardEntry,
  PendingCart,
} from './types';

// ─── Constants ──────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  UNPROCESSED: 'badge-warning',
  CS_ENGAGED: 'badge-info',
  CONFIRMED: 'badge-brand',
  CANCELLED: 'badge-danger',
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

// ─── Component ──────────────────────────────────────────

export function CSDashboardPage({
  workloads,
  unassignedOrders,
  unassignedTotal,
  activeOrders,
  activeTotal,
  statusCounts,
  inactiveAgents,
  callbackOrders,
  flaggedDuplicates,
  leaderboard,
  leaderboardPeriod = 'this_month',
  cartStats,
  pendingCarts,
}: CSDashboardStreamData) {
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState<'queue' | 'active' | 'callbacks' | 'duplicates' | 'hotswap'>('queue');
  const [assignAgent, setAssignAgent] = useState<Record<string, string>>({});
  const [hotSwapFrom, setHotSwapFrom] = useState('');
  const [hotSwapTo, setHotSwapTo] = useState('');
  const [hotSwapOrderIds, setHotSwapOrderIds] = useState<string[]>([]);
  const [callbackModal, setCallbackModal] = useState<{ orderId: string; customerName: string } | null>(null);
  const [callbackDelay, setCallbackDelay] = useState('120');
  const [callbackNotes, setCallbackNotes] = useState('');

  const actionError = (fetcher.data as { error?: string })?.error;
  useFetcherToast(fetcher.data, { successMessage: 'CS action completed' });
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
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">CS Dashboard</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Manage customer service agents, dispatch orders, and monitor workloads
        </p>
      </div>

      {actionError && (
        <div className="rounded-lg bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/50 px-4 py-3">
          <p className="text-sm text-danger-700 dark:text-danger-500">{actionError}</p>
        </div>
      )}

      {/* Inactive agents alert — deferred */}
      <DeferredSection resolve={inactiveAgents} skeleton="card">
        {(agents: InactiveAgent[]) =>
          agents.length > 0 ? (
            <div className="rounded-lg bg-warning-50 dark:bg-warning-700/20 border border-warning-200 dark:border-warning-700/50 px-4 py-3">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-warning-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-warning-800 dark:text-warning-300">Inactive Agents Detected</p>
                  <p className="text-xs text-warning-600 dark:text-warning-400 mt-0.5">
                    {agents.map((a: InactiveAgent) =>
                      `${a.agentName} (${a.pendingCount} pending, idle > 10 min)`
                    ).join(', ')} — consider reassigning their orders.
                  </p>
                </div>
              </div>
            </div>
          ) : null
        }
      </DeferredSection>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Active Agents</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{workloads.length}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Pending</p>
          <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{totalPending}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Unassigned</p>
          <p className="text-2xl font-bold text-danger-600 dark:text-danger-400 mt-1">{unassignedTotal}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Confirmed</p>
          <p className="text-2xl font-bold text-brand-600 dark:text-brand-400 mt-1">{confirmedCount}</p>
        </div>
        <div className="card">
          <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Capacity</p>
          <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">
            {totalPending}<span className="text-sm font-normal text-surface-700">/{totalCapacity}</span>
          </p>
        </div>
      </div>

      {/* Cart Abandonment — deferred */}
      {cartStats && pendingCarts && (
        <DeferredSection resolve={cartStats} skeleton="stat">
          {(stats: { pending: number; abandonedLast24h: number }) => (
            <div className="card">
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Cart Abandonment</h2>
              <p className="text-sm text-surface-800 dark:text-surface-200 mb-3">
                Carts saved when customers fill name + phone but don&apos;t submit. Pending carts may convert to orders soon.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg bg-surface-100 dark:bg-surface-800 p-3">
                  <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Pending</p>
                  <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">{stats.pending}</p>
                  <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">May convert soon</p>
                </div>
                <div className="rounded-lg bg-surface-100 dark:bg-surface-800 p-3">
                  <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">Abandoned (24h)</p>
                  <p className="text-2xl font-bold text-surface-900 dark:text-white mt-1">{stats.abandonedLast24h}</p>
                  <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">Marked abandoned</p>
                </div>
              </div>
              <DeferredSection resolve={pendingCarts} skeleton="table">
                {(carts: PendingCart[]) =>
                  carts.length > 0 ? (
                    <div className="overflow-x-auto -mx-4 px-4">
                      <table className="w-full text-sm">
                        <thead>
                          <tr>
                            <th className="table-header text-left">Customer</th>
                            <th className="table-header text-left">Phone</th>
                            <th className="table-header text-left">Product</th>
                            <th className="table-header text-left">Campaign</th>
                            <th className="table-header text-left">Last activity</th>
                          </tr>
                        </thead>
                        <tbody>
                          {carts.map((c) => (
                            <tr key={c.id} className="table-row">
                              <td className="table-cell font-medium text-surface-900 dark:text-surface-100">{c.customerName}</td>
                              <td className="table-cell font-mono text-xs">{c.customerPhoneDisplay}</td>
                              <td className="table-cell text-surface-800 dark:text-surface-200">{c.productName ?? c.id.slice(0, 8) + '...'}</td>
                              <td className="table-cell text-surface-800 dark:text-surface-200">{c.campaignName ?? '—'}</td>
                              <td className="table-cell text-surface-700 dark:text-surface-300">
                                {new Date(c.updatedAt).toLocaleDateString('en-NG', {
                                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-surface-700 dark:text-surface-300 py-4 text-center">No pending carts</p>
                  )
                }
              </DeferredSection>
            </div>
          )}
        </DeferredSection>
      )}

      {/* Agent Workload Cards */}
      <div>
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Agent Workloads</h2>
        {workloads.length === 0 ? (
          <div className="card text-center py-8">
            <p className="text-surface-700 dark:text-surface-300">No CS agents found. Add CS agents from the Users page.</p>
            <Link to="/hr/users/new" className="btn-primary inline-block mt-3">Add CS Agent</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {workloads.map((agent: AgentWorkload) => {
              const utilization = agent.capacity > 0 ? (agent.pendingCount / agent.capacity) * 100 : 0;
              const barColor = utilization >= 90
                ? 'bg-danger-500'
                : utilization >= 70
                ? 'bg-warning-500'
                : 'bg-success-500';

              return (
                <div key={agent.agentId} className="card">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
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
                  {/* Capacity bar */}
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
            })}
          </div>
        )}
      </div>

      {/* CS Agent Leaderboard — deferred */}
      <DeferredSection resolve={leaderboard} skeleton="table">
        {(lb: CSLeaderboardEntry[]) => {
          if (lb.length === 0) return null;
          return (
            <div className="card p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-100 dark:border-surface-800">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-surface-900 dark:text-white">CS Agent Performance</h3>
                    <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
                      Ranked by delivery rate ({leaderboardPeriod === 'all_time' ? 'all time' : 'this month'})
                    </p>
                  </div>
                  <div className="flex gap-1 rounded-lg bg-surface-100 dark:bg-surface-800 p-1">
                    <Link
                      to="/admin/cs?period=this_month"
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                        leaderboardPeriod === 'this_month'
                          ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                          : 'text-surface-700 dark:text-surface-200 hover:text-surface-900 dark:hover:text-surface-200'
                      }`}
                    >
                      This month
                    </Link>
                    <Link
                      to="/admin/cs?period=all_time"
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
              <div className="hidden md:block overflow-x-auto">
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

              {/* Mobile leaderboard */}
              <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
                {lb.map((e: CSLeaderboardEntry, idx: number) => (
                  <div key={e.agentId} className="p-4 space-y-2">
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

      <Tabs
        value={activeTab}
        onChange={(v) => setActiveTab(v as typeof activeTab)}
        tabs={[
          { value: 'queue', label: `Unassigned Queue (${unassignedTotal})` },
          { value: 'active', label: `Active Orders (${activeTotal})` },
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
          { value: 'hotswap', label: 'Hot Swap' },
        ]}
      />

      {/* Tab Content */}
      {activeTab === 'queue' && (
        <div className="card p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Order ID</th>
                  <th className="table-header">Customer</th>
                  <th className="table-header">Phone</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Created</th>
                  <th className="table-header">Assign To</th>
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
                  </tr>
                ))}
                {unassignedOrders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                      No unassigned orders in queue
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
            {unassignedOrders.map((order: CSOrder) => (
              <div key={order.id} className="p-4 space-y-3">
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
              </div>
            ))}
            {unassignedOrders.length === 0 && (
              <div className="p-8 text-center text-surface-700 dark:text-surface-300">
                No unassigned orders
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'active' && (
        <div className="card p-0 overflow-hidden">
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Order ID</th>
                  <th className="table-header">Customer</th>
                  <th className="table-header">Status</th>
                  <th className="table-header text-right">Amount</th>
                  <th className="table-header">Assigned Agent</th>
                  <th className="table-header">Created</th>
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
                        <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                          {formatStatus(order.status)}
                        </span>
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
                    </tr>
                  );
                })}
                {activeOrders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-surface-700 dark:text-surface-300">
                      No active CS-engaged orders
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden divide-y divide-surface-100 dark:divide-surface-800">
            {activeOrders.map((order: CSOrder) => {
              const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
              return (
                <Link
                  key={order.id}
                  to={`/admin/orders/${order.id}`}
                  className="block p-4 hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-surface-900 dark:text-surface-100">{order.customerName}</span>
                    <span className={STATUS_COLORS[order.status] ?? 'badge'}>{formatStatus(order.status)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-surface-800 dark:text-surface-200">
                    <span>{agent?.agentName ?? 'Unassigned'}</span>
                    <span className="font-medium text-surface-900 dark:text-surface-100">
                      {order.totalAmount ? `\u20A6${Number(order.totalAmount).toLocaleString()}` : '\u2014'}
                    </span>
                  </div>
                </Link>
              );
            })}
            {activeOrders.length === 0 && (
              <div className="p-8 text-center text-surface-700 dark:text-surface-300">
                No active orders
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'hotswap' && (
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
                      <input
                        type="checkbox"
                        checked={hotSwapOrderIds.includes(order.id)}
                        onChange={() => toggleHotSwapOrder(order.id)}
                        className="rounded border-surface-300 dark:border-surface-600 text-brand-500 focus:ring-brand-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
                            {order.customerName}
                          </span>
                          <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                            {formatStatus(order.status)}
                          </span>
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
      )}

      {/* ── Callbacks Tab ──────────────────────────── */}
      {activeTab === 'callbacks' && (
        <DeferredSection resolve={callbackOrders} skeleton="table">
          {(resolvedCallbacks: CSOrder[]) => (
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
          )}
        </DeferredSection>
      )}

      {/* ── Duplicates Tab ─────────────────────────── */}
      {activeTab === 'duplicates' && (
        <DeferredSection resolve={flaggedDuplicates} skeleton="table">
          {(resolvedDuplicates: DuplicatePair[]) => (
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
                                  Status: <span className={STATUS_COLORS[pair.original.status] ?? 'badge'}>{formatStatus(pair.original.status)}</span>
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
                                Status: <span className={STATUS_COLORS[pair.duplicate.status] ?? 'badge'}>{formatStatus(pair.duplicate.status)}</span>
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
          )}
        </DeferredSection>
      )}

      {/* ── Callback Schedule Modal ───────────────── */}
      {callbackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white mb-1">
              Schedule Callback
            </h3>
            <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
              For: {callbackModal.customerName} ({callbackModal.orderId.slice(0, 8)}...)
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Retry After
                </label>
                <select
                  value={callbackDelay}
                  onChange={(e) => setCallbackDelay(e.target.value)}
                  className="input"
                >
                  <option value="30">30 minutes</option>
                  <option value="60">1 hour</option>
                  <option value="120">2 hours (default)</option>
                  <option value="240">4 hours</option>
                  <option value="480">8 hours</option>
                  <option value="1440">Tomorrow (24 hours)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  Notes for next call attempt
                </label>
                <textarea
                  value={callbackNotes}
                  onChange={(e) => setCallbackNotes(e.target.value)}
                  className="input"
                  rows={3}
                  placeholder="e.g., Customer was busy, try after 5pm..."
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                variant="secondary"
                onClick={() => {
                  setCallbackModal(null);
                  setCallbackDelay('120');
                  setCallbackNotes('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  fetcher.submit(
                    {
                      intent: 'scheduleCallback',
                      orderId: callbackModal.orderId,
                      delayMinutes: callbackDelay,
                      notes: callbackNotes || '',
                    },
                    { method: 'post' },
                  );
                  setCallbackModal(null);
                  setCallbackDelay('120');
                  setCallbackNotes('');
                }}
                disabled={fetcher.state === 'submitting'}
                loading={fetcher.state === 'submitting'}
                loadingText="Scheduling..."
              >
                Schedule Callback
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Performance Quick Stats */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-3">Order Pipeline</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['UNPROCESSED', 'CS_ENGAGED', 'CONFIRMED', 'CANCELLED'] as const).map((status) => {
            const count = (statusCounts as Record<string, number>)[status] ?? 0;
            return (
              <div key={status} className="text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
                <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
                  {formatStatus(status)}
                </p>
                <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">{count}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
