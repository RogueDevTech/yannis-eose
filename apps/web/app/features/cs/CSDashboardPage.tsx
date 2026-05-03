import { useState, useRef, useCallback, useEffect, useMemo, useTransition } from 'react';
import { Link, useFetcher, useRevalidator, useRouteLoaderData, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { Textarea } from '~/components/ui/textarea';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Spinner } from '~/components/ui/spinner';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { useFetcherToast } from '~/components/ui/toast';
import { DeferredSection } from '~/components/ui/deferred-section';
import { Tabs } from '~/components/ui/tabs';
import { Checkbox } from '~/components/ui/checkbox';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { NairaPrice } from '~/components/ui/naira-price';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import {
  LiveActivityCard,
  LiveActivityDetailModal,
  DetailRow,
} from '~/components/ui/live-activity-card';
import { CreateOfflineOrderModal } from '~/features/orders/CreateOfflineOrderModal';
import { useHasHorizontalOverflow } from '~/hooks/useHasHorizontalOverflow';
import { useLiveIndicator, useSocketEvent } from '~/hooks/useSocket';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import {
  parseCSQueueTabFromSearchParam,
  type CSDashboardStreamData,
  type AgentWorkload,
  type InactiveAgent,
  type CSOrder,
  type DuplicatePair,
  type CSLeaderboardEntry,
  type PendingCart,
  type LiveActivityItem,
  type CSQueueTab,
  type CloserWorkloadOrder,
} from './types';

/** Most recently active closers first; stable tie-break for strip + View all. */
function compareCloserWorkloadsByRecency(a: AgentWorkload, b: AgentWorkload): number {
  const aTime = a.lastActionAt ? new Date(a.lastActionAt).getTime() : 0;
  const bTime = b.lastActionAt ? new Date(b.lastActionAt).getTime() : 0;
  if (bTime !== aTime) return bTime - aTime;
  const byName = a.agentName.localeCompare(b.agentName, undefined, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  return a.agentId.localeCompare(b.agentId);
}

// ─── Agent Workload Card (reusable for strip + modal) ───

function AgentWorkloadCard({
  agent,
  className,
  onOpen,
  isNew,
}: {
  agent: AgentWorkload;
  className?: string;
  onOpen?: (agent: AgentWorkload) => void;
  isNew?: boolean;
}) {
  const utilization = agent.capacity > 0 ? (agent.pendingCount / agent.capacity) * 100 : 0;
  const barColor = utilization >= 90
    ? 'bg-danger-500'
    : utilization >= 70
    ? 'bg-warning-500'
    : 'bg-success-500';

  const inner = (
    <>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
            {agent.agentName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-app-fg truncate">
            {agent.agentName}
          </p>
          <p className="text-xs text-app-fg-muted">
            {agent.pendingCount} of {agent.capacity} slots
          </p>
        </div>
      </div>
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
        {agent.pendingCount >= agent.capacity && (
          <span className="text-xs font-medium text-danger-600 dark:text-danger-400">FULL</span>
        )}
      </div>
      {isNew && (
        <div className="mt-2 pt-2 border-t border-success-200 dark:border-success-800/50 flex items-center gap-1.5">
          <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
            NEW ORDER
          </span>
        </div>
      )}
    </>
  );

  const newClass = isNew
    ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
    : '';

  const viewOrdersLink = (
    <div className="flex flex-col gap-1.5 w-full">
      <Link
        to={`/admin/cs/orders?csAgentId=${agent.agentId}&period=all_time`}
        prefetch="intent"
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/25 hover:bg-brand-100 dark:hover:bg-brand-900/40 border border-brand-200/80 dark:border-brand-700/50 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        View orders
      </Link>
      <Link
        to={`/admin/cs/queue?tab=hotswap&hotSwapFrom=${encodeURIComponent(agent.agentId)}`}
        prefetch="intent"
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-xs font-semibold text-app-fg bg-app-hover hover:bg-app-border border border-app-border transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
        Hot swap
      </Link>
    </div>
  );

  if (onOpen) {
    return (
      <div
        className={`${className ?? 'card'} ${newClass} flex flex-col overflow-hidden p-0 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200`}
      >
        <button
          type="button"
          onClick={() => onOpen(agent)}
          className="text-left cursor-pointer flex-1 px-5 pt-5 pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 rounded-t-xl"
        >
          {inner}
        </button>
        <div className="px-5 pb-5 pt-0">
          {viewOrdersLink}
        </div>
      </div>
    );
  }
  return (
    <div className={`${className ?? 'card'} ${newClass} flex flex-col overflow-hidden p-0`}>
      <div className="px-5 pt-5 pb-3 flex-1">{inner}</div>
      <div className="px-5 pb-5 pt-0">{viewOrdersLink}</div>
    </div>
  );
}

// ─── Agent Workload Detail Modal ───

function AgentWorkloadDetailModal({
  agent,
  onClose,
}: {
  agent: AgentWorkload | null;
  onClose: () => void;
}) {
  const [queueOrders, setQueueOrders] = useState<CloserWorkloadOrder[] | null>(null);
  const [queueLoadError, setQueueLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) {
      setQueueOrders(null);
      setQueueLoadError(null);
      return;
    }
    const controller = new AbortController();
    setQueueOrders(null);
    setQueueLoadError(null);

    const apiUrl = typeof window !== 'undefined' ? getBrowserApiBaseUrl() : '';
    const input = encodeURIComponent(JSON.stringify({ agentId: agent.agentId }));

    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/trpc/orders.closerWorkloadOrders?input=${input}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        const json = (await res.json()) as { result?: { data?: CloserWorkloadOrder[] }; error?: { message?: string } };
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setQueueLoadError(json?.error?.message ?? 'Could not load orders');
          setQueueOrders([]);
          return;
        }
        const rows = json?.result?.data;
        setQueueOrders(Array.isArray(rows) ? rows : []);
      } catch (e) {
        if (controller.signal.aborted) return;
        setQueueLoadError(e instanceof Error ? e.message : 'Could not load orders');
        setQueueOrders([]);
      }
    })();

    return () => controller.abort();
  }, [agent?.agentId]);

  if (!agent) return null;

  const utilization = agent.capacity > 0 ? (agent.pendingCount / agent.capacity) * 100 : 0;
  const free = agent.capacity - agent.pendingCount;
  const statusColor =
    utilization >= 90 ? 'text-danger-600 dark:text-danger-400' :
    utilization >= 70 ? 'text-warning-600 dark:text-warning-400' :
    'text-success-600 dark:text-success-400';
  const barColor =
    utilization >= 90 ? 'bg-danger-500' :
    utilization >= 70 ? 'bg-warning-500' :
    'bg-success-500';
  const initials = agent.agentName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const lastAction = agent.lastActionAt
    ? new Date(agent.lastActionAt).toLocaleString('en-NG', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : 'No recent action';

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" contentClassName="p-0 overflow-hidden">
      {/* Header band */}
      <div className="bg-brand-600 dark:bg-brand-700 px-5 pt-5 pb-10 relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Close"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-white">{initials}</span>
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-white leading-tight truncate">{agent.agentName}</p>
            <p className="text-xs text-white/70 mt-0.5">Closer</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="px-5 -mt-6">
        <div className="bg-app-elevated rounded-xl shadow-md border border-app-border p-3.5 grid grid-cols-3 gap-2.5">
          <div className="rounded-lg bg-app-hover border border-app-border px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-[11px] leading-4 text-app-fg-muted uppercase tracking-wide">Active</p>
            <p className="text-xl leading-7 font-bold text-app-fg mt-1">{agent.pendingCount}</p>
          </div>
          <div className="rounded-lg bg-app-hover border border-app-border px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-[11px] leading-4 text-app-fg-muted uppercase tracking-wide">Capacity</p>
            <p className="text-xl leading-7 font-bold text-app-fg mt-1">{agent.capacity}</p>
          </div>
          <div className="rounded-lg bg-app-hover border border-app-border px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-[11px] leading-4 text-app-fg-muted uppercase tracking-wide">Free slots</p>
            <p className={`text-xl leading-7 font-bold mt-1 ${free <= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>{Math.max(0, free)}</p>
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-app-fg-muted">Utilization</p>
          <p className={`text-xs font-bold ${statusColor}`}>{Math.round(utilization)}%</p>
        </div>
        <div className="w-full h-2.5 bg-app-hover rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
        {agent.pendingCount >= agent.capacity && (
          <p className="text-xs font-semibold text-danger-600 dark:text-danger-400 mt-1.5">Queue is full — no new orders can be assigned</p>
        )}
      </div>

      {/* Last action */}
      <div className="px-5 py-4 border-t border-app-border">
        <p className="text-[10px] uppercase tracking-wider font-medium text-app-fg-muted mb-1">Last action</p>
        <p className="text-sm font-medium text-app-fg">{lastAction}</p>
      </div>

      {/* Pending queue: orders + line items (API order = updatedAt desc) */}
      <div className="px-5 py-3 border-t border-app-border max-h-[min(50vh,22rem)] overflow-y-auto">
        <p className="text-[10px] uppercase tracking-wider font-medium text-app-fg-muted mb-2">Orders in queue</p>
        {queueOrders === null ? (
          <div className="flex items-center justify-center py-6 gap-2 text-app-fg-muted text-sm">
            <Spinner size="sm" />
            <span>Loading…</span>
          </div>
        ) : queueLoadError ? (
          <p className="text-sm text-danger-600 dark:text-danger-400">{queueLoadError}</p>
        ) : queueOrders.length === 0 ? (
          <p className="text-sm text-app-fg-muted">No pending orders in this closer&apos;s workload.</p>
        ) : (
          <ul className="space-y-3">
            {queueOrders.map((ord) => (
              <li
                key={ord.id}
                className="rounded-lg border border-app-border bg-app-hover/50 p-3"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <OrderStatusBadge status={ord.status} />
                  <span className="text-sm font-medium text-app-fg truncate min-w-0 flex-1">{ord.customerName}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <OrderIdBadge id={ord.id} linkTo={`/admin/orders/${ord.id}`} />
                  {ord.totalAmount != null && (
                    <span className="text-xs text-app-fg-muted">
                      <NairaPrice amount={ord.totalAmount} />
                    </span>
                  )}
                </div>
                {ord.items.length > 0 ? (
                  <ul className="text-xs text-app-fg-muted space-y-1 pl-0 list-none border-t border-app-border/80 pt-2 mt-1">
                    {ord.items.map((it, idx) => (
                      <li key={`${ord.id}-${idx}`} className="flex flex-wrap gap-x-1.5 gap-y-0.5">
                        <span className="text-app-fg">{it.productName ?? 'Product'}</span>
                        <span>×{it.quantity}</span>
                        {it.offerLabel ? <span className="text-app-fg-muted">({it.offerLabel})</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-app-fg-muted border-t border-app-border/80 pt-2 mt-1">No line items</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-5 pb-5">
        <Link
          to={`/admin/cs/orders?csAgentId=${agent.agentId}&period=all_time`}
          prefetch="intent"
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          View orders
        </Link>
      </div>
    </Modal>
  );
}

// ─── Active order detail modal ───

function ActiveOrderDetailModal({
  order,
  agent,
  onClose,
  onReassign,
  onCancel,
}: {
  order: CSOrder | null;
  agent?: AgentWorkload;
  onClose: () => void;
  onReassign: (order: CSOrder) => void;
  onCancel: (order: CSOrder) => void;
}) {
  return (
    <Modal open={order != null} onClose={onClose} maxWidth="max-w-sm" backdropBlur>
      {order && (
        <div>
          {/* Header */}
          <div className="relative bg-gradient-to-br from-indigo-600 to-indigo-800 dark:from-indigo-700 dark:to-indigo-900 px-5 pt-5 pb-8 rounded-t-2xl md:rounded-t-xl">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="min-w-0 pr-8">
              <p className="text-base font-bold text-white truncate">{order.customerName}</p>
              <p className="text-sm font-mono text-indigo-200 truncate">{order.customerPhoneDisplay}</p>
            </div>
            <div className="mt-3">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                With CS
              </span>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 pt-4 pb-5">
            <div className="bg-app-elevated rounded-xl shadow-sm border border-app-border divide-y divide-app-border mb-4">
              <DetailRow
                label="Order ID"
                value={<OrderIdBadge id={order.id} uppercase ellipsis="" textClassName="text-app-fg" />}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                }
              />
              {order.totalAmount && (
                <DetailRow
                  label="Amount"
                  value={`\u20A6${Number(order.totalAmount).toLocaleString('en-NG')}`}
                  icon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  }
                />
              )}
              <DetailRow
                label="Assigned closer"
                value={agent?.agentName ?? 'Unassigned'}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                }
              />
              <DetailRow
                label="Created"
                value={new Date(order.createdAt).toLocaleString('en-NG', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
                icon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                }
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2">
              <Link
                to={`/admin/orders/${order.id}`}
                onClick={onClose}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                View order
              </Link>
              {order.assignedCsId && (
                <button
                  type="button"
                  onClick={() => { onClose(); onReassign(order); }}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                  Reassign closer
                </button>
              )}
              <button
                type="button"
                onClick={() => { onClose(); onCancel(order); }}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-danger-700 dark:text-danger-300 bg-danger-50 dark:bg-danger-900/20 hover:bg-danger-100 dark:hover:bg-danger-900/40 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel Order
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}


// ─── Component ──────────────────────────────────────────

export function CSDashboardPage({
  workloads,
  unassignedOrders,
  unassignedTotal,
  activeOrders,
  activeTotal,
  hotSwapOrdersPayload,
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
  canDeleteCart = false,
  productsForOfflineOrder = [],
  initialCartActivity,
}: CSDashboardStreamData) {
  const adminRouteData = useRouteLoaderData('routes/admin') as
    | { user?: { currentBranchId?: string | null }; branches?: Array<{ id: string }> }
    | undefined;

  /** SuperAdmin / org-wide HoCS have no session branch — tRPC requires explicit `branchId` on scoped mutations. */
  function csMutationBranchPayload(ordersForBranch: Array<{ branchId?: string | null }>): Record<string, string> {
    const sessionBranch = adminRouteData?.user?.currentBranchId;
    if (sessionBranch) return { branchId: sessionBranch };
    const fromOrders = [
      ...new Set(
        ordersForBranch
          .map((o) => o.branchId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    ];
    if (fromOrders.length >= 1) return { branchId: fromOrders[0] as string };
    const fb = adminRouteData?.branches?.[0]?.id;
    return fb ? { branchId: fb } : {};
  }

  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const isRouteLoaderBusy = useLoaderRefetchBusy();
  const [searchParams, setSearchParams] = useSearchParams();
  const [hotSwapSearchPending, startHotSwapSearchTransition] = useTransition();
  const claimFetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const cartsFetcher = useFetcher<{ activityItems?: LiveActivityItem[]; pendingCarts?: PendingCart[]; abandonedCarts?: PendingCart[] }>();
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [createOfflineOpen, setCreateOfflineOpen] = useState(false);
  /** Tab follows `?tab=` so deep links and client <Link> navigations (e.g. Hot Swap from a closer card) switch the panel — local useState did not update when the URL changed. */
  const activeTab = useMemo((): CSQueueTab => {
    return parseCSQueueTabFromSearchParam(searchParams.get('tab'), isClaimMode) ?? 'queue';
  }, [searchParams, isClaimMode]);
  const setActiveTab = useCallback(
    (v: CSQueueTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v === 'queue') {
            next.delete('tab');
          } else {
            next.set('tab', v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // Track which order is being claimed (to show per-row loading state)
  const [claimingOrderId, setClaimingOrderId] = useState<string | null>(null);

  const claimQueueColumns = useMemo((): CompactTableColumn<CSOrder>[] => [
    {
      key: 'order',
      header: 'Order',
      render: (order) => (
        <OrderIdBadge
          id={order.id}
          uppercase
          ellipsis=""
          linkTo={`/admin/orders/${order.id}`}
          textClassName="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
        />
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (order) => <p className="text-sm font-medium text-app-fg">{order.customerName}</p>,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (order) => (
        <span className="text-xs font-mono text-app-fg-muted">{order.customerPhoneDisplay}</span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (order) => (
        <span className="text-sm">
          {order.totalAmount ? `₦${Number(order.totalAmount).toLocaleString()}` : '—'}
        </span>
      ),
    },
    {
      key: 'received',
      header: 'Received',
      nowrap: true,
      render: (order) => (
        <span className="text-xs text-app-fg-muted">
          {new Date(order.createdAt).toLocaleString('en-NG', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      nowrap: true,
      mobileShowLabel: false,
      render: (order) => {
        const isClaiming = claimingOrderId === order.id && claimFetcher.state === 'submitting';
        return (
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
                {
                  intent: 'claimOrder',
                  orderId: order.id,
                  ...csMutationBranchPayload([order]),
                },
                { method: 'post' },
              );
            }}
          >
            Claim
          </Button>
        );
      },
    },
    // csMutationBranchPayload is stable enough per render; omit from deps to avoid column churn.
  ], [claimingOrderId, claimFetcher.state, claimFetcher, setClaimingOrderId]);

  const leaderboardColumns = useMemo((): CompactTableColumn<CSLeaderboardEntry>[] => [
    {
      key: 'rank',
      header: '#',
      render: (_e, index) => (
        <span className="font-mono text-sm text-app-fg-muted">{index + 1}</span>
      ),
    },
    {
      key: 'closer',
      header: 'Closer',
      render: (e) => (
        <Link
          to={`/hr/users/${e.agentId}`}
          prefetch="intent"
          className="text-sm font-medium text-brand-500 hover:text-brand-600 hover:underline"
        >
          {e.agentName}
        </Link>
      ),
    },
    {
      key: 'engaged',
      header: 'Engaged',
      align: 'right',
      render: (e) => <span className="text-right text-sm">{e.ordersEngaged}</span>,
    },
    {
      key: 'confirmed',
      header: 'Confirmed',
      align: 'right',
      render: (e) => (
        <span className="text-right text-sm text-success-600 dark:text-success-400">{e.ordersConfirmed}</span>
      ),
    },
    {
      key: 'delivered',
      header: 'Delivered',
      align: 'right',
      render: (e) => (
        <span className="text-right text-sm font-medium text-brand-600 dark:text-brand-400">{e.ordersDelivered}</span>
      ),
    },
    {
      key: 'calls',
      header: 'Calls',
      align: 'right',
      render: (e) => <span className="text-right text-sm">{e.callsMade}</span>,
    },
    {
      key: 'confRate',
      header: 'Conf. Rate',
      align: 'right',
      render: (e) => <span className="text-right text-sm">{e.confirmationRate.toFixed(1)}%</span>,
    },
    {
      key: 'delRate',
      header: 'Del. Rate',
      align: 'right',
      render: (e) => (
        <span
          className={`text-sm font-bold ${
            e.deliveryRate >= 70
              ? 'text-success-600 dark:text-success-400'
              : e.deliveryRate >= 50
                ? 'text-warning-600 dark:text-warning-400'
                : 'text-app-fg'
          }`}
        >
          {e.deliveryRate.toFixed(1)}%
        </span>
      ),
    },
    {
      key: 'avgCall',
      header: 'Avg Call',
      align: 'right',
      render: (e) => (
        <span className="text-right text-sm text-app-fg-muted">
          {e.avgCallDurationSeconds >= 60
            ? `${Math.floor(e.avgCallDurationSeconds / 60)}m ${e.avgCallDurationSeconds % 60}s`
            : `${e.avgCallDurationSeconds}s`}
        </span>
      ),
    },
  ], []);

  /** URL-driven so socket `revalidate()` keeps loading the same closer's orders (see usePageRefreshOnEvent). */
  const hotSwapFrom =
    searchParams.get('hotSwapFrom')?.trim() || searchParams.get('from')?.trim() || '';
  const [hotSwapTo, setHotSwapTo] = useState('');
  const [hotSwapOrderIds, setHotSwapOrderIds] = useState<string[]>([]);
  /** Reassign order modal: order + current assignee so we can pick new agent */
  const [reassignOrder, setReassignOrder] = useState<{
    orderId: string;
    customerName: string;
    assignedCsId: string;
    branchId?: string | null;
  } | null>(null);
  const [reassignToAgentId, setReassignToAgentId] = useState('');
  /** Pending confirm for Cancel order (replaces window.confirm) */
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState<{
    orderId: string;
    customerName: string;
    branchId?: string | null;
  } | null>(null);
  /** Reason typed/picked in the cancel modal — required, min 10 chars before Submit enables. */
  const [cancelReason, setCancelReason] = useState('Customer not picking');
  /** Selected live activity item for detail modal */
  const [selectedLiveCart, setSelectedLiveCart] = useState<LiveActivityItem | null>(null);
  /** Selected active (CS_ENGAGED) order for detail modal */
  const [selectedActiveOrder, setSelectedActiveOrder] = useState<CSOrder | null>(null);
  /** Selected unassigned queue order for detail modal */
  const [selectedQueueOrder, setSelectedQueueOrder] = useState<CSOrder | null>(null);
  // Lazy-fetched full order details for the queue preview modal. Populated when
  // the user clicks "View details" on an unassigned card; cleared when modal closes.
  const [queueOrderDetails, setQueueOrderDetails] = useState<{
    loading: boolean;
    error: string | null;
    items: Array<{ id: string; productId: string; quantity: number; unitPrice: string; productName: string | null }>;
    deliveryAddress: string | null;
    deliveryNotes: string | null;
    deliveryState: string | null;
    customerEmail: string | null;
    customerGender: string | null;
    preferredDeliveryDate: string | null;
    paymentMethod: string | null;
    campaignName: string | null;
    mediaBuyerName: string | null;
  } | null>(null);

  useEffect(() => {
    if (!selectedQueueOrder) {
      setQueueOrderDetails(null);
      return;
    }
    const orderId = selectedQueueOrder.id;
    const controller = new AbortController();
    setQueueOrderDetails({
      loading: true,
      error: null,
      items: [],
      deliveryAddress: null,
      deliveryNotes: null,
      deliveryState: null,
      customerEmail: null,
      customerGender: null,
      preferredDeliveryDate: null,
      paymentMethod: null,
      campaignName: null,
      mediaBuyerName: null,
    });
    const apiUrl = typeof window !== 'undefined' ? getBrowserApiBaseUrl() : '';
    const input = encodeURIComponent(JSON.stringify({ orderId }));
    void (async () => {
      try {
        const res = await fetch(`${apiUrl}/trpc/orders.getById?input=${input}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        const json = (await res.json()) as {
          result?: {
            data?: {
              order?: {
                deliveryAddress?: string | null;
                deliveryNotes?: string | null;
                deliveryState?: string | null;
                customerEmail?: string | null;
                customerGender?: string | null;
                preferredDeliveryDate?: string | null;
                paymentMethod?: string | null;
                campaignName?: string | null;
                mediaBuyerName?: string | null;
              };
              items?: Array<{ id: string; productId: string; quantity: number; unitPrice: string; productName: string | null }>;
            };
          };
          error?: { message?: string };
        };
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setQueueOrderDetails((prev) => prev && { ...prev, loading: false, error: json?.error?.message ?? 'Could not load order details' });
          return;
        }
        const data = json?.result?.data;
        const order = data?.order ?? {};
        setQueueOrderDetails({
          loading: false,
          error: null,
          items: data?.items ?? [],
          deliveryAddress: order.deliveryAddress ?? null,
          deliveryNotes: order.deliveryNotes ?? null,
          deliveryState: order.deliveryState ?? null,
          customerEmail: order.customerEmail ?? null,
          customerGender: order.customerGender ?? null,
          preferredDeliveryDate: order.preferredDeliveryDate ?? null,
          paymentMethod: order.paymentMethod ?? null,
          campaignName: order.campaignName ?? null,
          mediaBuyerName: order.mediaBuyerName ?? null,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        setQueueOrderDetails((prev) => prev && {
          ...prev,
          loading: false,
          error: e instanceof Error ? e.message : 'Could not load order details',
        });
      }
    })();
    return () => controller.abort();
  }, [selectedQueueOrder]);
  /** Multi-select for bulk-assign on the Unassigned Queue tab. */
  const [selectedQueueIds, setSelectedQueueIds] = useState<Set<string>>(new Set());
  /** Chosen closer inside the Unassigned "Assign" modal (assignable only). */
  const [bulkAssignAgentId, setBulkAssignAgentId] = useState<string>('');
  const [assignCloserModalOpen, setAssignCloserModalOpen] = useState(false);
  const bulkAssignFetcher = useFetcher<{ success?: boolean; error?: string; assigned?: number }>();
  const isBulkAssigning = bulkAssignFetcher.state !== 'idle';

  const toggleQueueSelection = (orderId: string) => {
    setSelectedQueueIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const clearQueueSelection = () => setSelectedQueueIds(new Set());

  // Clear selection and close the assign modal after successful bulk assign.
  useEffect(() => {
    if (bulkAssignFetcher.state === 'idle' && bulkAssignFetcher.data?.success) {
      setBulkAssignAgentId('');
      clearQueueSelection();
      setAssignCloserModalOpen(false);
    }
  }, [bulkAssignFetcher.state, bulkAssignFetcher.data]);
  const [selectedAgent, setSelectedAgent] = useState<AgentWorkload | null>(null);
  /** Agent Workloads: View all modal and pagination */
  const [viewAllAgentsOpen, setViewAllAgentsOpen] = useState(false);
  const [viewAllPage, setViewAllPage] = useState(1);
  /** Prefill Create Offline Order modal when opening from Cart Abandonment */
  const [createOfflinePrefill, setCreateOfflinePrefill] = useState<{ customerName: string } | null>(null);
  /** Delete abandoned cart confirmation modal */
  const [deleteCartConfirm, setDeleteCartConfirm] = useState<PendingCart | null>(null);
  /** IDs of carts that just appeared — used for NEW badge + slide-in animation */
  const [newCartIds, setNewCartIds] = useState<Set<string>>(new Set());
  /** IDs of carts that were updated (already known but data changed) — green ring flash */
  const [updatedCartIds, setUpdatedCartIds] = useState<Set<string>>(new Set());
  const knownCartIdsRef = useRef<Set<string>>(new Set());
  const prevCartsDataRef = useRef<Map<string, string>>(new Map());
  /** Agent IDs that just received a new order — for green highlight + sort-to-front */
  const [newAgentIds, setNewAgentIds] = useState<Set<string>>(new Set());
  const prevWorkloadCountsRef = useRef<Map<string, number>>(new Map());
  const liveActivityData = cartsFetcher.data ?? initialCartActivity ?? { activityItems: [], pendingCarts: [], abandonedCarts: [] };
  const deleteCartFetcher = useFetcher<{ ok: boolean; error?: string }>();
  const overviewScrollRef = useRef<HTMLDivElement>(null);
  const agentScrollRef = useRef<HTMLDivElement>(null);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const unassignedQueueScrollRef = useRef<HTMLDivElement>(null);
  const [viewAllActivityOpen, setViewAllActivityOpen] = useState(false);
  const [viewAllActivityPage, setViewAllActivityPage] = useState(1);
  const scrollOverviewStrip = useCallback((delta: number) => {
    overviewScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollAgentStrip = useCallback((delta: number) => {
    agentScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollActivityStrip = useCallback((delta: number) => {
    activityScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollUnassignedQueueStrip = useCallback((delta: number) => {
    unassignedQueueScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  const overviewStripOverflowKey = useMemo(() => {
    const tp = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.pendingCount, 0);
    const cap = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.capacity, 0);
    const sc = statusCounts as Record<string, number>;
    return [
      workloads.length,
      tp,
      unassignedTotal,
      sc['CONFIRMED'] ?? 0,
      sc['DELIVERED'] ?? 0,
      cap,
      sc['CS_ENGAGED'] ?? 0,
      sc['CANCELLED'] ?? 0,
      cartStats ? '1' : '0',
    ].join('|');
  }, [workloads, unassignedTotal, statusCounts, cartStats]);

  const overviewHasOverflow = useHasHorizontalOverflow(overviewScrollRef, overviewStripOverflowKey);

  useEffect(() => {
    if (viewAllAgentsOpen) setViewAllPage(1);
  }, [viewAllAgentsOpen]);

  useEffect(() => {
    if (viewAllActivityOpen) setViewAllActivityPage(1);
  }, [viewAllActivityOpen]);

  useEffect(() => {
    if (!viewAllAgentsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewAllAgentsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewAllAgentsOpen]);

  // Fetch cart data on mount and whenever user switches to the Cart Abandonment tab
  useEffect(() => {
    cartsFetcher.load('/admin/cs/queue/carts');
  }, []);

  // Reload activity on any order event
  useSocketEvent('order:new', () => {
    cartsFetcher.load('/admin/cs/queue/carts');
  });
  useSocketEvent('order:status_changed', () => {
    cartsFetcher.load('/admin/cs/queue/carts');
  });

  const actionError = (fetcher.data as { error?: string })?.error;
  const [dismissedError, setDismissedError] = useState(false);
  const distributeResult = fetcher.data as { success?: boolean; distributed?: number } | undefined;
  const successMessage =
    distributeResult && 'distributed' in distributeResult
      ? distributeResult.distributed === 0
        ? 'No unassigned orders to distribute'
        : `${distributeResult.distributed} order(s) distributed to closers`
      : 'CS action completed';
  useFetcherToast(fetcher.data, { successMessage });
  useFetcherToast(claimFetcher.data, { successMessage: claimFetcher.data?.message ?? 'Order claimed' });
  useFetcherToast(deleteCartFetcher.data, { successMessage: 'Cart deleted' });
  useFetcherToast(bulkAssignFetcher.data, { successMessage: 'Order(s) assigned to closer' });

  // Close delete modal and refresh carts list after successful delete
  useEffect(() => {
    if (deleteCartFetcher.state === 'idle' && deleteCartFetcher.data?.ok) {
      setDeleteCartConfirm(null);
      cartsFetcher.load('/admin/cs/queue/carts');
    }
  }, [deleteCartFetcher.state, deleteCartFetcher.data]);

  // cart:updated socket event → reload carts fetcher directly (main loader revalidation won't refresh fetcher data)
  useSocketEvent('cart:updated', () => {
    cartsFetcher.load('/admin/cs/queue/carts');
  });

  // Detect newly arrived + updated activity items after each fetcher response
  useEffect(() => {
    const items = cartsFetcher.data?.activityItems;
    if (!items || cartsFetcher.state !== 'idle') return;

    const freshIds = new Set<string>();
    const changedIds = new Set<string>();

    for (const c of items) {
      const fingerprint = `${c.cartStatus}|${c.orderStatus ?? ''}|${c.offerLabel ?? ''}|${String(c.updatedAt)}`;
      if (!knownCartIdsRef.current.has(c.id)) {
        freshIds.add(c.id);
      } else if (prevCartsDataRef.current.get(c.id) !== fingerprint) {
        changedIds.add(c.id);
      }
      prevCartsDataRef.current.set(c.id, fingerprint);
    }

    knownCartIdsRef.current = new Set(items.map((c) => c.id));

    if (freshIds.size > 0) {
      setNewCartIds((prev) => new Set([...prev, ...freshIds]));
      setTimeout(() => {
        setNewCartIds((prev) => {
          const next = new Set(prev);
          freshIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }

    if (changedIds.size > 0) {
      setUpdatedCartIds((prev) => new Set([...prev, ...changedIds]));
      setTimeout(() => {
        setUpdatedCartIds((prev) => {
          const next = new Set(prev);
          changedIds.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }
  }, [cartsFetcher.data, cartsFetcher.state]);

  // Detect agents whose pendingCount increased → flash green "new order" highlight
  useEffect(() => {
    const freshAgents = new Set<string>();
    for (const w of workloads) {
      const prev = prevWorkloadCountsRef.current.get(w.agentId) ?? w.pendingCount;
      if (w.pendingCount > prev) {
        freshAgents.add(w.agentId);
      }
      prevWorkloadCountsRef.current.set(w.agentId, w.pendingCount);
    }
    if (freshAgents.size > 0) {
      setNewAgentIds((prev) => new Set([...prev, ...freshAgents]));
      setTimeout(() => {
        setNewAgentIds((prev) => {
          const next = new Set(prev);
          freshAgents.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }
  }, [workloads]);

  // Clear claiming state after claim response
  useEffect(() => {
    if (claimFetcher.state === 'idle' && claimingOrderId) {
      setClaimingOrderId(null);
    }
  }, [claimFetcher.state]);

  useEffect(() => {
    if (actionError) setDismissedError(false);
  }, [actionError]);

  // Close reassign / cancel modals on success — edge-trigger via shared hook.
  const handleQueueFetcherSuccess = useCallback(() => {
    if (reassignOrder) {
      setReassignOrder(null);
      setReassignToAgentId('');
    }
    if (cancelConfirmOrder) {
      setCancelConfirmOrder(null);
      setCancelReason('Customer not picking');
    }
  }, [reassignOrder, cancelConfirmOrder]);
  useCloseOnFetcherSuccess(fetcher, handleQueueFetcherSuccess);

  // Hot Swap selection clear — only on bulkReassign success.
  const handleBulkReassignSuccess = useCallback(() => {
    setHotSwapOrderIds([]);
  }, []);
  useCloseOnFetcherSuccess(fetcher, handleBulkReassignSuccess, { intent: 'bulkReassign' });

  const totalPending = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.pendingCount, 0);
  const totalCapacity = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.capacity, 0);
  const confirmedCount = (statusCounts as Record<string, number>)['CONFIRMED'] ?? 0;
  const cancelledCount = (statusCounts as Record<string, number>)['CANCELLED'] ?? 0;
  const assignableCloserOptions = useMemo(
    () =>
      workloads
        .filter((w: AgentWorkload) => w.pendingCount < w.capacity)
        .map((w: AgentWorkload) => ({
          value: w.agentId,
          label: `${w.agentName} (${w.pendingCount}/${w.capacity})`,
        })),
    [workloads],
  );

  const effectiveHotSwapPayload =
    hotSwapFrom && hotSwapOrdersPayload?.forAgentId === hotSwapFrom ? hotSwapOrdersPayload : null;

  const hotSwapListLoading =
    Boolean(hotSwapFrom) &&
    hotSwapOrdersPayload?.forAgentId !== hotSwapFrom &&
    (isRouteLoaderBusy || hotSwapSearchPending);

  const hotSwapSourceOrders = effectiveHotSwapPayload?.orders ?? [];
  const hotSwapSourceTotal = effectiveHotSwapPayload?.total ?? 0;

  function handleHotSwap() {
    if (hotSwapOrderIds.length === 0 || !hotSwapFrom || !hotSwapTo) return;
    fetcher.submit(
      {
        intent: 'bulkReassign',
        orderIds: JSON.stringify(hotSwapOrderIds),
        fromAgentId: hotSwapFrom,
        toAgentId: hotSwapTo,
        ...csMutationBranchPayload(hotSwapSourceOrders.filter((o) => hotSwapOrderIds.includes(o.id))),
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
        ...csMutationBranchPayload(
          reassignOrder.branchId
            ? [{ branchId: reassignOrder.branchId }]
            : activeOrders.filter((o) => o.id === reassignOrder.orderId),
        ),
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
          <h1 className="text-2xl font-bold text-app-fg">Live activities</h1>
          <p className="text-sm text-app-fg-muted mt-0.5">
            Manage closers, dispatch orders, and monitor workloads
          </p>
          <p className="text-xs text-app-fg-muted mt-1 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Showing today's data —{' '}
            {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' '}· Resets at midnight
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
          branchId={csMutationBranchPayload(unassignedOrders).branchId}
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
        <div className="flex items-center gap-2 min-w-0">
          <div ref={overviewScrollRef} className="flex flex-1 min-w-0 flex-nowrap gap-3 overflow-x-auto scrollbar-hide pb-1">
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Active closers
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">
              {workloads.length}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Pending confirmation
            </p>
            <p className="text-xl font-bold text-warning-600 dark:text-warning-400 mt-1">
              {totalPending}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Unassigned
            </p>
            <p className="text-xl font-bold text-danger-600 dark:text-danger-400 mt-1">
              {unassignedTotal}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Confirmed
            </p>
            <p className="text-xl font-bold text-brand-600 dark:text-brand-400 mt-1">
              {confirmedCount}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Delivered
            </p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">
              {(statusCounts as Record<string, number>)['DELIVERED'] ?? 0}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Capacity
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">
              {totalPending}
              <span className="text-sm font-normal text-app-fg-muted">
                /{totalCapacity}
              </span>
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              CS Engaged
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">
              {(statusCounts as Record<string, number>)['CS_ENGAGED'] ?? 0}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Cancelled
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">
              {(statusCounts as Record<string, number>)['CANCELLED'] ?? 0}
            </p>
          </div>
          {cartStats && (
            <>
              <DeferredSection resolve={cartStats} skeleton="inline">
                {(stats: { pending: number; abandonedLast24h: number }) => (
                  <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
                    <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
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
                  <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
                    <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
                      Abandoned (24h)
                    </p>
                    <p className="text-xl font-bold text-app-fg mt-1">
                      {stats.abandonedLast24h}
                    </p>
                  </div>
                )}
              </DeferredSection>
            </>
          )}
          </div>
          {overviewHasOverflow && (
          <div className="hidden md:flex shrink-0 items-center gap-0.5 sm:gap-1.5 self-center">
            <button
              type="button"
              onClick={() => scrollOverviewStrip(-280)}
              className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
              aria-label="Scroll overview left"
            >
              <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scrollOverviewStrip(280)}
              className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
              aria-label="Scroll overview right"
            >
              <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          )}
        </div>
      </div>

      {/* ── Live Activity Feed ──────────────────────────────── */}
      <div>
          {(() => {
            // Fall back to pendingCarts if listActivity isn't available yet (API not restarted)
            const rawActivity = liveActivityData.activityItems ?? [];
            const items: LiveActivityItem[] = rawActivity.length > 0
              ? rawActivity
              : (liveActivityData.pendingCarts ?? []).map((c) => ({
                  id: c.id,
                  customerName: c.customerName,
                  customerPhoneDisplay: c.customerPhoneDisplay,
                  productName: c.productName,
                  offerLabel: c.offerLabel,
                  cartStatus: 'PENDING' as const,
                  orderStatus: null,
                  linkedOrderId: null,
                  updatedAt: c.updatedAt,
                }));
            // Sort: new first, then updated, then rest by updatedAt desc
            const sorted = [...items].sort((a, b) => {
              const aNew = newCartIds.has(a.id) ? 2 : updatedCartIds.has(a.id) ? 1 : 0;
              const bNew = newCartIds.has(b.id) ? 2 : updatedCartIds.has(b.id) ? 1 : 0;
              if (aNew !== bNew) return bNew - aNew;
              return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
            });
            return (
              <>
                {/* Header row with controls */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-app-fg flex items-center gap-2">
                      Live Activity
                      {newCartIds.size > 0 && (
                        <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
                          {newCartIds.size} new
                        </span>
                      )}
                      {cartsFetcher.state === 'loading' && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-app-fg-muted font-normal">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Updating…
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-app-fg-muted mt-0.5">
                      Order activity — today · Click a card for details
                    </p>
                  </div>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <div className="hidden md:flex items-center gap-1 sm:gap-2">
                      <button
                        type="button"
                        onClick={() => scrollActivityStrip(-280)}
                        className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
                        aria-label="Scroll left"
                      >
                        <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollActivityStrip(280)}
                        className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
                        aria-label="Scroll right"
                      >
                        <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setViewAllActivityOpen(true)}>
                      View all
                    </Button>
                  </div>
                </div>

                {/* Horizontal scroll strip */}
                {sorted.length > 0 ? (
                  <div
                    ref={activityScrollRef}
                    className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
                  >
                    {sorted.map((item) => (
                      <div key={item.id} className="shrink-0 w-64">
                        <LiveActivityCard
                          item={item}
                          isNew={newCartIds.has(item.id)}
                          isUpdated={updatedCartIds.has(item.id)}
                          onOpen={setSelectedLiveCart}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
                    <div className="w-10 h-10 rounded-full bg-app-hover flex items-center justify-center mb-1">
                      <svg className="w-5 h-5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-app-fg-muted">No order activity today</p>
                    <p className="text-xs text-app-fg-muted">Cards appear here as orders and carts come in</p>
                  </div>
                )}

                {/* View all modal — paginated, matches Closer workloads modal */}
                {viewAllActivityOpen && (
                  <Modal open onClose={() => setViewAllActivityOpen(false)} maxWidth="max-w-4xl" role="dialog" aria-labelledby="view-all-activity-title" contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-app-border shrink-0">
                      <h2 id="view-all-activity-title" className="text-lg font-semibold text-app-fg">
                        All Live Activity
                      </h2>
                      <button
                        type="button"
                        onClick={() => setViewAllActivityOpen(false)}
                        className="p-2 rounded-lg text-app-fg-muted hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                        aria-label="Close"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="px-4 py-2 border-b border-app-border shrink-0">
                      <p className="text-sm text-app-fg-muted">
                        {sorted.length} item{sorted.length !== 1 ? 's' : ''} — today
                      </p>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                      {(() => {
                        const pageSize = 10;
                        const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
                        const page = Math.min(viewAllActivityPage, totalPages);
                        const start = (page - 1) * pageSize;
                        const rows = sorted.slice(start, start + pageSize);
                        return (
                          <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {rows.map((item) => (
                                <LiveActivityCard
                                  key={item.id}
                                  item={item}
                                  isNew={newCartIds.has(item.id)}
                                  isUpdated={updatedCartIds.has(item.id)}
                                  onOpen={(i) => { setViewAllActivityOpen(false); setSelectedLiveCart(i); }}
                                />
                              ))}
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-app-border">
                              <span className="text-sm text-app-fg-muted">
                                Page {page} of {totalPages}
                                {sorted.length > 0 && (
                                  <span className="ml-1">
                                    ({start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length})
                                  </span>
                                )}
                              </span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={page <= 1}
                                  onClick={() => setViewAllActivityPage((p) => Math.max(1, p - 1))}
                                >
                                  Prev
                                </Button>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={page >= totalPages}
                                  onClick={() => setViewAllActivityPage((p) => Math.min(totalPages, p + 1))}
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
              </>
            );
          })()}
      </div>

      {/* Live activity detail modal */}
      <LiveActivityDetailModal item={selectedLiveCart} onClose={() => setSelectedLiveCart(null)} />

      {/* Active order detail modal */}
      <ActiveOrderDetailModal
        order={selectedActiveOrder}
        agent={selectedActiveOrder ? workloads.find((w: AgentWorkload) => w.agentId === selectedActiveOrder.assignedCsId) : undefined}
        onClose={() => setSelectedActiveOrder(null)}
        onReassign={(order) =>
          order.assignedCsId &&
          setReassignOrder({
            orderId: order.id,
            customerName: order.customerName,
            assignedCsId: order.assignedCsId,
            branchId: order.branchId,
          })}
        onCancel={(order) =>
          setCancelConfirmOrder({ orderId: order.id, customerName: order.customerName, branchId: order.branchId })}
      />

      {/* Closer workload detail modal */}
      <AgentWorkloadDetailModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />

      {/* Closer workloads — horizontal scroll strip + View all */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-app-fg">Closer workloads</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {workloads.length} active closer{workloads.length !== 1 ? 's' : ''} · {totalPending}/{totalCapacity} slots filled
            </p>
          </div>
          {workloads.length > 0 && (
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="hidden md:flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => scrollAgentStrip(-280)}
                  className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center"
                  aria-label="Scroll left"
                >
                  <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => scrollAgentStrip(280)}
                  className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center"
                  aria-label="Scroll right"
                >
                  <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
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
            <p className="text-app-fg-muted">No closers found. Manage staff from HR → Users.</p>
          </div>
        ) : (
          <div
            ref={agentScrollRef}
            className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
          >
            {[...workloads]
              .sort(compareCloserWorkloadsByRecency)
              .map((agent: AgentWorkload) => (
                <AgentWorkloadCard
                  key={agent.agentId}
                  agent={agent}
                  className="card shrink-0 w-64"
                  onOpen={setSelectedAgent}
                  isNew={newAgentIds.has(agent.agentId)}
                />
              ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border">
        <Tabs
          value={activeTab}
          onChange={(v) => setActiveTab(v as typeof activeTab)}
          tabs={[
            { value: 'queue', label: `Unassigned Queue (${unassignedTotal})` },
            ...(isClaimMode
              ? [
                  {
                    value: 'claim' as const,
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
                  },
                ]
              : []),
            {
              value: 'active',
              label: `Active Orders (${activeTotal})`,
              badge: (
                <DeferredSection resolve={flaggedDuplicates} skeleton="inline">
                  {(pairs: DuplicatePair[]) =>
                    pairs.length > 0 ? (
                      <span className="ml-1.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400 text-xs font-bold" title={`${pairs.length} duplicate(s)`}>
                        ⚠{pairs.length}
                      </span>
                    ) : null
                  }
                </DeferredSection>
              ),
            },
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
            onClick={() =>
              fetcher.submit(
                { intent: 'redistribute', ...csMutationBranchPayload(unassignedOrders) },
                { method: 'post' },
              )}
          >
            {fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'redistribute'
              ? 'Distributing…'
              : 'Distribute Order'}
          </Button>
        ) : (
          <Link
            to="/admin/cs/orders?period=all_time"
            className="btn-primary btn-sm shrink-0 -mb-px inline-flex items-center justify-center"
          >
            Go to Orders
          </Link>
        )}
      </div>

      {/* Tab Content — fixed height so layout does not shift */}
      {activeTab === 'queue' && (
        <div className="space-y-3">
          {/* Bulk-assign toolbar — only renders when ≥ 1 card is selected. Clicking a card body
              opens the detail modal; toggling the checkbox in the top-left selects without
              opening the modal. Per CEO directive 2026-04-26: HoCS need a way to assign a
              batch of unassigned orders to a closer in one go. */}
          {unassignedOrders.length > 0 && (
            <div className="rounded-lg border border-app-border bg-app-elevated px-3 py-2 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {selectedQueueIds.size === 0 ? (
                    <button
                      type="button"
                      onClick={() => setSelectedQueueIds(new Set(unassignedOrders.map((o) => o.id)))}
                      className="text-xs text-app-fg-muted hover:text-app-fg underline-offset-2 hover:underline"
                    >
                      Select all ({unassignedOrders.length})
                    </button>
                  ) : (
                    <>
                      <span className="text-xs font-medium text-app-fg">
                        {selectedQueueIds.size} selected
                      </span>
                      <button
                        type="button"
                        onClick={clearQueueSelection}
                        className="text-xs text-app-fg-muted hover:text-app-fg underline-offset-2 hover:underline"
                      >
                        Clear
                      </button>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={selectedQueueIds.size === 0}
                    onClick={() => {
                      setBulkAssignAgentId('');
                      setAssignCloserModalOpen(true);
                    }}
                  >
                    Assign{selectedQueueIds.size > 0 ? ` (${selectedQueueIds.size})` : ''}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-app-fg-muted">
                Click cards to select. Use <span className="font-medium">Assign</span> to open the closer list. Only
                closers with free capacity are shown. If everyone is at limit, free up capacity first.
              </p>
              {bulkAssignFetcher.data?.error && !bulkAssignFetcher.data?.success && (
                <p className="text-xs text-danger-600 dark:text-danger-400">{bulkAssignFetcher.data.error}</p>
              )}
            </div>
          )}

          {unassignedOrders.length === 0 ? (
            <div className="rounded-xl border border-app-border bg-app-elevated p-10 text-center text-app-fg-muted">
              No unassigned orders in queue
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <p className="text-xs text-app-fg-muted">
                  Unassigned orders — click a card to select, or use View for details
                </p>
                <div className="hidden md:flex items-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() => scrollUnassignedQueueStrip(-280)}
                    className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
                    aria-label="Scroll unassigned queue left"
                  >
                    <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollUnassignedQueueStrip(280)}
                    className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
                    aria-label="Scroll unassigned queue right"
                  >
                    <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
              <div
                ref={unassignedQueueScrollRef}
                className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
              >
                {unassignedOrders.map((order: CSOrder) => {
                  const isSelected = selectedQueueIds.has(order.id);
                  return (
                    <div
                      key={order.id}
                      onClick={() => toggleQueueSelection(order.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleQueueSelection(order.id);
                        }
                      }}
                      role="checkbox"
                      aria-checked={isSelected}
                      tabIndex={0}
                      className={`group relative shrink-0 w-64 text-left rounded-xl border bg-app-elevated transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                        isSelected
                          ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md'
                          : 'border-warning-200 dark:border-warning-800/60 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                      }`}
                    >
                      <span className="absolute top-3 right-3 flex h-2.5 w-2.5 pointer-events-none">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-400 opacity-60" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning-500" />
                      </span>

                      <div className="p-3.5 pr-8">
                        <div className="mb-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                            Unassigned
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-app-fg truncate leading-tight mb-2 pr-1">
                          {order.customerName}
                        </p>
                        {order.totalAmount && (
                          <div className="mb-2">
                            <span className="text-[11px] font-bold text-app-fg">
                              &#8358;{Number(order.totalAmount).toLocaleString('en-NG')}
                            </span>
                          </div>
                        )}
                        <div className="text-[11px] font-medium text-app-fg-muted">
                          {new Date(order.createdAt).toLocaleString('en-NG', {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </div>

                        <div className="mt-2 pt-2 border-t border-app-border/80">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedQueueOrder(order);
                            }}
                            className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                          >
                            View details
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Unassigned: pick closer in modal (no dropdowns on cards or toolbar) */}
      <Modal
        open={assignCloserModalOpen}
        onClose={() => {
          if (isBulkAssigning) return;
          setAssignCloserModalOpen(false);
          setBulkAssignAgentId('');
        }}
        maxWidth="max-w-md"
        aria-labelledby="assign-closer-title"
        backdropBlur
        contentClassName="p-0 max-h-[min(32rem,90dvh)] overflow-hidden flex flex-col"
      >
        <div className="shrink-0 border-b border-app-border px-4 py-3">
          <h2 id="assign-closer-title" className="text-lg font-semibold text-app-fg">
            Assign to closer
          </h2>
          <p className="text-sm text-app-fg-muted mt-0.5">
            {selectedQueueIds.size} order{selectedQueueIds.size !== 1 ? 's' : ''} selected
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-1.5">
          {assignableCloserOptions.length === 0 ? (
            <p className="text-sm text-app-fg-muted">
              No closers with free capacity. Free a slot or wait for a confirmation, then try again.
            </p>
          ) : (
            assignableCloserOptions.map((opt) => {
              const isPick = bulkAssignAgentId === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setBulkAssignAgentId(opt.value)}
                  className={`w-full text-left rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    isPick
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40 text-app-fg ring-1 ring-brand-500/30'
                      : 'border-app-border bg-app-elevated hover:border-brand-300 dark:hover:border-brand-700'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })
          )}
        </div>
        {bulkAssignFetcher.data?.error && !bulkAssignFetcher.data?.success && (
          <div className="shrink-0 px-4 pb-2">
            <p className="text-xs text-danger-600 dark:text-danger-400">{bulkAssignFetcher.data.error}</p>
          </div>
        )}
        <div className="shrink-0 flex items-center justify-end gap-2 border-t border-app-border px-4 py-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isBulkAssigning}
            onClick={() => {
              setAssignCloserModalOpen(false);
              setBulkAssignAgentId('');
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={
              selectedQueueIds.size === 0 || !bulkAssignAgentId || assignableCloserOptions.length === 0 || isBulkAssigning
            }
            loading={isBulkAssigning}
            loadingText="Assigning…"
            onClick={() => {
              bulkAssignFetcher.submit(
                {
                  intent: 'bulkAssignToCS',
                  orderIds: JSON.stringify(Array.from(selectedQueueIds)),
                  csAgentId: bulkAssignAgentId,
                  ...csMutationBranchPayload(unassignedOrders.filter((o) => selectedQueueIds.has(o.id))),
                },
                { method: 'post' },
              );
            }}
          >
            Assign
          </Button>
        </div>
      </Modal>

      {/* ── Queue Order Detail Modal ── */}
      {selectedQueueOrder && (() => {
        const qOrder = selectedQueueOrder;
        return (
          <Modal open onClose={() => setSelectedQueueOrder(null)} maxWidth="max-w-md" backdropBlur>
            <div>
              {/* Header */}
              <div className="relative bg-gradient-to-br from-warning-500 to-warning-700 dark:from-warning-600 dark:to-warning-900 px-5 pt-5 pb-8 rounded-t-2xl md:rounded-t-xl">
                <button
                  type="button"
                  onClick={() => setSelectedQueueOrder(null)}
                  className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <div className="min-w-0 pr-8">
                  <p className="text-base font-bold text-white truncate">{qOrder.customerName}</p>
                  <p className="text-sm font-mono text-warning-100 truncate">{qOrder.customerPhoneDisplay}</p>
                </div>
                <div className="mt-3">
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                    Unassigned
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="px-5 pt-4 pb-5">
                {/* Order details */}
                <div className="bg-app-elevated rounded-xl shadow-sm border border-app-border divide-y divide-app-border mb-4">
                  <DetailRow
                    label="Order ID"
                    value={<OrderIdBadge id={qOrder.id} uppercase ellipsis="" textClassName="text-app-fg" />}
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    }
                  />
                  {qOrder.totalAmount && (
                    <DetailRow
                      label="Amount"
                      value={`\u20A6${Number(qOrder.totalAmount).toLocaleString('en-NG')}`}
                      icon={
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      }
                    />
                  )}
                  <DetailRow
                    label="Created"
                    value={new Date(qOrder.createdAt).toLocaleString('en-NG', {
                      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                    icon={
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    }
                  />
                  {queueOrderDetails?.campaignName && (
                    <DetailRow
                      label="Campaign"
                      value={queueOrderDetails.campaignName}
                      icon={
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      }
                    />
                  )}
                  {queueOrderDetails?.mediaBuyerName && (
                    <DetailRow
                      label="Media Buyer"
                      value={queueOrderDetails.mediaBuyerName}
                      icon={
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      }
                    />
                  )}
                </div>

                {/* Items — lazy-fetched from `orders.getById`. Skeleton while loading,
                    line items table once they arrive. */}
                <div className="mb-4">
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-app-fg-muted mb-1.5">Items</p>
                  {queueOrderDetails?.loading ? (
                    <div className="rounded-xl border border-app-border p-3 text-xs text-app-fg-muted animate-pulse">
                      Loading items…
                    </div>
                  ) : queueOrderDetails?.error ? (
                    <div className="rounded-xl border border-danger-200 dark:border-danger-800 bg-danger-50 dark:bg-danger-900/20 p-3 text-xs text-danger-700 dark:text-danger-300">
                      {queueOrderDetails.error}
                    </div>
                  ) : queueOrderDetails && queueOrderDetails.items.length === 0 ? (
                    <div className="rounded-xl border border-app-border p-3 text-xs text-app-fg-muted">
                      No items on this order.
                    </div>
                  ) : queueOrderDetails ? (
                    <ul className="rounded-xl border border-app-border bg-app-elevated divide-y divide-app-border overflow-hidden">
                      {queueOrderDetails.items.map((item) => {
                        const subtotal = item.quantity * Number(item.unitPrice);
                        return (
                          <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-app-fg truncate">
                                {item.productName ?? 'Unknown product'}
                              </p>
                              <p className="text-[11px] text-app-fg-muted">
                                {item.quantity} × ₦{Number(item.unitPrice).toLocaleString('en-NG')}
                              </p>
                            </div>
                            <span className="text-sm font-semibold text-app-fg shrink-0">
                              ₦{subtotal.toLocaleString('en-NG')}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>

                {/* Delivery + customer details */}
                {(queueOrderDetails?.deliveryAddress
                  || queueOrderDetails?.deliveryNotes
                  || queueOrderDetails?.deliveryState
                  || queueOrderDetails?.preferredDeliveryDate
                  || queueOrderDetails?.paymentMethod
                  || queueOrderDetails?.customerEmail
                  || queueOrderDetails?.customerGender) && (
                  <div className="bg-app-elevated rounded-xl shadow-sm border border-app-border divide-y divide-app-border mb-4">
                    {queueOrderDetails.deliveryAddress && (
                      <DetailRow
                        label="Address"
                        value={queueOrderDetails.deliveryAddress}
                        icon={
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        }
                      />
                    )}
                    {queueOrderDetails.deliveryState && (
                      <DetailRow label="State" value={queueOrderDetails.deliveryState} />
                    )}
                    {queueOrderDetails.deliveryNotes && (
                      <DetailRow label="Notes" value={queueOrderDetails.deliveryNotes} />
                    )}
                    {queueOrderDetails.preferredDeliveryDate && (
                      <DetailRow
                        label="Preferred date"
                        value={new Date(queueOrderDetails.preferredDeliveryDate).toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })}
                      />
                    )}
                    {queueOrderDetails.paymentMethod && (
                      <DetailRow
                        label="Payment"
                        value={queueOrderDetails.paymentMethod === 'PAY_ONLINE' ? 'Pay online' : 'Pay on delivery'}
                      />
                    )}
                    {queueOrderDetails.customerEmail && (
                      <DetailRow label="Email" value={queueOrderDetails.customerEmail} />
                    )}
                    {queueOrderDetails.customerGender && (
                      <DetailRow label="Gender" value={queueOrderDetails.customerGender} />
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-2 pt-1">
                  <Link
                    to={`/admin/orders/${qOrder.id}`}
                    onClick={() => setSelectedQueueOrder(null)}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    View order
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedQueueOrder(null);
                      setCancelConfirmOrder({
                        orderId: qOrder.id,
                        customerName: qOrder.customerName,
                        branchId: qOrder.branchId,
                      });
                    }}
                    disabled={fetcher.state === 'submitting'}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-danger-700 dark:text-danger-300 bg-danger-50 dark:bg-danger-900/20 hover:bg-danger-100 dark:hover:bg-danger-900/40 transition-colors disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel Order
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {activeTab === 'active' && (
        <div>
          {/* Card grid — matches live activity style */}
          {activeOrders.length === 0 ? (
            <div className="rounded-xl border border-app-border bg-app-elevated p-10 text-center text-app-fg-muted">
              No active CS-engaged orders today
            </div>
          ) : (
            <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
              {activeOrders.map((order: CSOrder) => {
                const agent = workloads.find((w: AgentWorkload) => w.agentId === order.assignedCsId);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => setSelectedActiveOrder(order)}
                    className="group relative shrink-0 w-64 text-left rounded-xl border border-indigo-200 dark:border-indigo-800 bg-app-elevated hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    {/* Live pulse dot */}
                    <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-60" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500" />
                    </span>

                    <div className="p-3.5 pr-8">
                      {/* Status badge */}
                      <div className="mb-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400">
                          With CS
                        </span>
                      </div>

                      {/* Customer name */}
                      <p className="text-sm font-semibold text-app-fg truncate leading-tight mb-2">
                        {order.customerName}
                      </p>

                      {/* Amount */}
                      {order.totalAmount && (
                        <div className="mb-2">
                          <span className="text-[11px] font-bold text-app-fg">
                            &#8358;{Number(order.totalAmount).toLocaleString('en-NG')}
                          </span>
                        </div>
                      )}

                      {/* Closer pill */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <svg className="w-3 h-3 shrink-0 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-[11px] font-medium text-app-fg-muted truncate">
                          {agent?.agentName ?? 'Unassigned'}
                        </span>
                      </div>

                      {/* Timestamp */}
                      <div className="text-[11px] font-medium text-app-fg-muted">
                        {new Date(order.createdAt).toLocaleString('en-NG', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>
                    </div>

                    {/* Hover arrow */}
                    <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                      <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'hotswap' && (
        <div className="h-[28rem] overflow-auto">
          <div className="space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold text-app-fg mb-1">Hot Swap</h2>
            <p className="text-sm text-app-fg-muted mb-4">
              Select orders from one closer and bulk-reassign them to another closer. The list matches each
              closer&apos;s CS queue (Unprocessed, Assigned, Engaged) — the same scope as workload counts, not only
              &quot;engaged today&quot; on the Active tab. Your choice is kept in the URL so live refreshes do not
              clear the list.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <SearchableSelect
                  id="hotswap-from"
                  label="From closer"
                  value={hotSwapFrom}
                  onChange={(v) => {
                    startHotSwapSearchTransition(() => {
                      setHotSwapOrderIds([]);
                      const next = new URLSearchParams(searchParams);
                      next.delete('from');
                      if (v) {
                        next.set('hotSwapFrom', v);
                        next.set('tab', 'hotswap');
                      } else {
                        next.delete('hotSwapFrom');
                      }
                      setSearchParams(next, { replace: true });
                    });
                  }}
                  placeholder="Select source closer..."
                  searchPlaceholder="Search closers..."
                  options={workloads.map((w: AgentWorkload) => ({
                    value: w.agentId,
                    label: `${w.agentName} (${w.pendingCount} orders)`,
                  }))}
                />
              </div>
              <div>
                <SearchableSelect
                  id="hotswap-to"
                  label="To closer"
                  value={hotSwapTo}
                  onChange={setHotSwapTo}
                  placeholder="Select target closer..."
                  searchPlaceholder="Search closers..."
                  options={workloads
                    .filter((w: AgentWorkload) => w.agentId !== hotSwapFrom)
                    .map((w: AgentWorkload) => ({
                      value: w.agentId,
                      label: `${w.agentName} (${w.pendingCount}/${w.capacity})`,
                    }))}
                />
              </div>
            </div>

            {hotSwapFrom && (
              <TableLoadingOverlay show={hotSwapListLoading}>
            {hotSwapSourceOrders.length > 0 ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-app-fg-muted">
                    Select orders to reassign ({hotSwapOrderIds.length} selected)
                    {hotSwapSourceTotal > hotSwapSourceOrders.length ? (
                      <span className="block text-xs mt-0.5 text-warning-600 dark:text-warning-400">
                        Showing {hotSwapSourceOrders.length} of {hotSwapSourceTotal} — narrow by reassigning in batches
                        or use CS Orders with filters for the full list.
                      </span>
                    ) : null}
                  </p>
                  <button
                    onClick={selectAllHotSwap}
                    className="text-sm text-brand-500 hover:text-brand-600 font-medium"
                  >
                    Select All ({hotSwapSourceOrders.length})
                  </button>
                </div>

                <p className="text-xs text-app-fg-muted mb-2">
                  Click cards to select — same layout as Unassigned Queue
                </p>
                <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
                  {hotSwapSourceOrders.map((order: CSOrder) => {
                    const isSelected = hotSwapOrderIds.includes(order.id);
                    return (
                      <div
                        key={order.id}
                        onClick={() => toggleHotSwapOrder(order.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleHotSwapOrder(order.id);
                          }
                        }}
                        role="checkbox"
                        aria-checked={isSelected}
                        tabIndex={0}
                        className={`group relative shrink-0 w-64 text-left rounded-xl border bg-app-elevated transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                          isSelected
                            ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md'
                            : 'border-warning-200 dark:border-warning-800/60 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                        }`}
                      >
                        <div
                          className="absolute top-3 left-3 z-10"
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={isSelected}
                            onChange={() => toggleHotSwapOrder(order.id)}
                          />
                        </div>
                        <span className="absolute top-3 right-3 flex h-2.5 w-2.5 pointer-events-none">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-400 opacity-60" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning-500" />
                        </span>
                        <div className="p-3.5 pl-10 pr-8">
                          <div className="mb-2">
                            <OrderStatusBadge status={order.status} />
                          </div>
                          <p className="text-sm font-semibold text-app-fg truncate leading-tight mb-2 pr-1">
                            {order.customerName}
                          </p>
                          {order.totalAmount ? (
                            <div className="mb-2">
                              <NairaPrice
                                amount={order.totalAmount}
                                className="text-[11px] font-bold text-app-fg"
                              />
                            </div>
                          ) : null}
                          <div className="text-[11px] font-medium text-app-fg-muted">
                            {new Date(order.createdAt).toLocaleString('en-NG', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="mt-2 pt-2 border-t border-app-border/80">
                            <OrderIdBadge
                              id={order.id}
                              length={8}
                              ellipsis=""
                              textClassName="text-[10px] text-app-fg-muted"
                              className="inline-flex"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : !hotSwapListLoading ? (
              <p className="text-sm text-app-fg-muted text-center py-4">
                No open CS-queue orders for this closer (nothing in Unprocessed / Assigned / Engaged with them as
                assignee). If you expected more, confirm branch context and that orders are still in the CS stage.
              </p>
            ) : (
              <div className="min-h-[12rem]" aria-hidden />
            )}
              </TableLoadingOverlay>
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
                    <h2 className="text-lg font-semibold text-app-fg">Claim Queue</h2>
                    <p className="text-sm text-app-fg-muted mt-0.5">
                      Unassigned orders available to claim. First closer to click Claim takes the order.
                      Cap: <strong>{claimCap}</strong> unconfirmed orders per closer.
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-success-600 dark:text-success-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-success-500 inline-block animate-pulse" />
                    Live
                  </span>
                </div>

                {orders.length === 0 ? (
                  <div className="text-center py-12 text-app-fg-muted">
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
                                  <OrderIdBadge
                                    id={order.id}
                                    uppercase
                                    ellipsis=""
                                    linkTo={`/admin/orders/${order.id}`}
                                    textClassName="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
                                  />
                                </td>
                                <td className="table-cell">
                                  <p className="text-sm font-medium text-app-fg">{order.customerName}</p>
                                </td>
                                <td className="table-cell">
                                  <span className="text-xs font-mono text-app-fg-muted">{order.customerPhoneDisplay}</span>
                                </td>
                                <td className="table-cell text-right text-sm">
                                  {order.totalAmount ? `₦${Number(order.totalAmount).toLocaleString()}` : '—'}
                                </td>
                                <td className="table-cell text-xs text-app-fg-muted">
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
                                        {
                                          intent: 'claimOrder',
                                          orderId: order.id,
                                          ...csMutationBranchPayload([order]),
                                        },
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
                            className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <OrderIdBadge
                                  id={order.id}
                                  uppercase
                                  ellipsis=""
                                  linkTo={`/admin/orders/${order.id}`}
                                  textClassName="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
                                />
                                <p className="text-sm font-medium text-app-fg mt-0.5">{order.customerName}</p>
                                <p className="text-xs font-mono text-app-fg-muted">{order.customerPhoneDisplay}</p>
                                {order.totalAmount && (
                                  <p className="text-xs text-app-fg-muted mt-1">₦{Number(order.totalAmount).toLocaleString()}</p>
                                )}
                                <p className="text-xs text-app-fg-muted mt-1">
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
                                    {
                                      intent: 'claimOrder',
                                      orderId: order.id,
                                      ...csMutationBranchPayload([order]),
                                    },
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
              <div className="card p-0 flex flex-col h-[28rem]">
                <div className="px-4 py-3 border-b border-app-border shrink-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-app-fg">Closer performance</h3>
                      <p className="text-xs text-app-fg-muted mt-0.5">
                        Ranked by delivery rate ({leaderboardPeriod === 'all_time' ? 'all time' : 'this month'})
                      </p>
                    </div>
                    <div className="flex gap-1 rounded-lg bg-app-hover p-1">
                      <Link
                        to="/admin/cs/queue?period=this_month"
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          leaderboardPeriod === 'this_month'
                            ? 'bg-app-elevated text-app-fg shadow-sm'
                            : 'text-app-fg-muted hover:text-app-fg'
                        }`}
                      >
                        This month
                      </Link>
                      <Link
                        to="/admin/cs/queue?period=all_time"
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          leaderboardPeriod === 'all_time'
                            ? 'bg-app-elevated text-app-fg shadow-sm'
                            : 'text-app-fg-muted hover:text-app-fg'
                        }`}
                      >
                        All time
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="isolate hidden md:block overflow-auto flex-1 min-h-0 overscroll-y-contain">
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="table-header">#</th>
                        <th className="table-header">Closer</th>
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
                          <td className="table-cell text-app-fg-muted font-mono text-sm">{idx + 1}</td>
                          <td className="table-cell">
                            <Link
                              to={`/hr/users/${e.agentId}`}
                              prefetch="intent"
                              className="text-sm font-medium text-brand-500 hover:text-brand-600 hover:underline"
                            >
                              {e.agentName}
                            </Link>
                          </td>
                          <td className="table-cell text-right text-sm">{e.ordersEngaged}</td>
                          <td className="table-cell text-right text-sm text-success-600 dark:text-success-400">{e.ordersConfirmed}</td>
                          <td className="table-cell text-right text-sm font-medium text-brand-600 dark:text-brand-400">{e.ordersDelivered}</td>
                          <td className="table-cell text-right text-sm">{e.callsMade}</td>
                          <td className="table-cell text-right text-sm">{e.confirmationRate.toFixed(1)}%</td>
                          <td className="table-cell text-right">
                            <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg'}`}>
                              {e.deliveryRate.toFixed(1)}%
                            </span>
                          </td>
                          <td className="table-cell text-right text-sm text-app-fg-muted">
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
                      className="rounded-xl border border-app-border bg-app-elevated p-4 shadow-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-app-fg-muted">#{idx + 1}</span>
                          <Link
                            to={`/hr/users/${e.agentId}`}
                            prefetch="intent"
                            className="min-w-0 truncate font-medium text-sm text-brand-500 hover:text-brand-600 hover:underline"
                          >
                            {e.agentName}
                          </Link>
                        </div>
                        <span className={`text-sm font-bold ${e.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : e.deliveryRate >= 50 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg'}`}>
                          {e.deliveryRate.toFixed(1)}% del.
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-app-fg-muted">Confirmed</span>
                          <p className="font-medium text-app-fg">{e.ordersConfirmed}</p>
                        </div>
                        <div>
                          <span className="text-app-fg-muted">Calls</span>
                          <p className="font-medium text-app-fg">{e.callsMade}</p>
                        </div>
                        <div>
                          <span className="text-app-fg-muted">Conf. Rate</span>
                          <p className="font-medium text-app-fg">{e.confirmationRate.toFixed(1)}%</p>
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
                    <h2 className="text-lg font-semibold text-app-fg">Callback Queue</h2>
                    <p className="text-sm text-app-fg-muted mt-0.5">
                      Orders awaiting callback retry after &ldquo;No Answer&rdquo;
                    </p>
                  </div>
                </div>

                {resolvedCallbacks.length === 0 ? (
                  <div className="text-center py-12 text-app-fg-muted">
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
                              : 'border-app-border bg-app-elevated'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <OrderIdBadge
                                  id={order.id}
                                  linkTo={`/admin/orders/${order.id}`}
                                  textClassName="text-brand-500 hover:text-brand-600 font-medium text-sm"
                                />
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400">
                                  Attempt {order.callbackAttempts ?? 0}/3
                                </span>
                                {isDue && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400">
                                    DUE NOW
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-medium text-app-fg">
                                {order.customerName}
                              </p>
                              <p className="text-xs text-app-fg-muted">
                                {order.customerPhoneDisplay}
                                {agent ? ` \u00b7 Closer: ${agent.agentName}` : ''}
                                {order.totalAmount ? ` \u00b7 \u20A6${Number(order.totalAmount).toLocaleString()}` : ''}
                              </p>
                              {order.callbackScheduledAt && (
                                <p className="text-xs text-app-fg-muted mt-1">
                                  Scheduled: {new Date(order.callbackScheduledAt).toLocaleString('en-NG', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                  })}
                                </p>
                              )}
                              {order.callbackNotes && (
                                <p className="text-xs text-app-fg-muted mt-1 italic">
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

      {/* ── Duplicates warning (shown when Active Orders tab is active) ─── */}
      {activeTab === 'active' && (
        <DeferredSection resolve={flaggedDuplicates} skeleton="inline">
          {(pairs: DuplicatePair[]) =>
            pairs.length > 0 ? (
              <div className="card border-danger-200 dark:border-danger-800 bg-danger-50/40 dark:bg-danger-900/10">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-danger-700 dark:text-danger-400">
                      {pairs.length} potential duplicate{pairs.length > 1 ? 's' : ''} detected
                    </p>
                    <div className="mt-2 space-y-2">
                      {pairs.slice(0, 3).map((pair: DuplicatePair) => (
                        <div key={pair.duplicate.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 text-app-fg-muted truncate">
                            {pair.duplicate.customerName} — #
                            <OrderIdBadge id={pair.duplicate.id} ellipsis="" textClassName="text-app-fg-muted" />
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              type="button"
                              variant="danger"
                              size="sm"
                              className="text-[11px] px-2 py-0.5 h-auto"
                              onClick={() =>
                                fetcher.submit(
                                  {
                                    intent: 'mergeDuplicate',
                                    duplicateId: pair.duplicate.id,
                                    originalId: pair.original?.id ?? '',
                                    ...csMutationBranchPayload(
                                      [pair.duplicate, ...(pair.original ? [pair.original] : [])],
                                    ),
                                  },
                                  { method: 'post' },
                                )}
                              disabled={!pair.original || fetcher.state !== 'idle'}
                            >
                              Merge
                            </Button>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              className="text-[11px] px-2 py-0.5 h-auto"
                              onClick={() =>
                                fetcher.submit(
                                  {
                                    intent: 'dismissDuplicate',
                                    orderId: pair.duplicate.id,
                                    ...csMutationBranchPayload([pair.duplicate]),
                                  },
                                  { method: 'post' },
                                )}
                              disabled={fetcher.state !== 'idle'}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      ))}
                      {pairs.length > 3 && (
                        <p className="text-[11px] text-danger-600 dark:text-danger-400">+{pairs.length - 3} more duplicates</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          }
        </DeferredSection>
      )}

      {/* ── Delete abandoned cart confirmation ─── */}
      {deleteCartConfirm && (
        <Modal open onClose={() => setDeleteCartConfirm(null)} maxWidth="max-w-sm" contentClassName="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-app-fg">Delete abandoned cart?</h3>
              <p className="text-sm text-app-fg-muted mt-1">
                This will permanently remove <span className="font-medium text-app-fg">{deleteCartConfirm.customerName}</span>'s cart entry. This cannot be undone.
              </p>
            </div>
          </div>
          <deleteCartFetcher.Form method="post" action="/admin/cs/queue/carts" className="flex items-center justify-end gap-2">
            <input type="hidden" name="intent" value="deleteAbandoned" />
            <input type="hidden" name="cartId" value={deleteCartConfirm.id} />
            <Button type="button" variant="secondary" size="sm" onClick={() => setDeleteCartConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={deleteCartFetcher.state !== 'idle'}
            >
              {deleteCartFetcher.state !== 'idle' ? 'Deleting…' : 'Delete'}
            </Button>
          </deleteCartFetcher.Form>
        </Modal>
      )}


      {/* ── Reassign order modal ───────────────── */}
      {reassignOrder && (
        <Modal open onClose={() => { setReassignOrder(null); setReassignToAgentId(''); }} maxWidth="max-w-md" contentClassName="p-6">
            <h3 className="text-lg font-semibold text-app-fg mb-1">
              Reassign order
            </h3>
            <p className="text-sm text-app-fg-muted mb-4">
              {reassignOrder.customerName} ({reassignOrder.orderId.slice(0, 8)}...)
            </p>

            <div>
              <SearchableSelect
                id="reassign-to-closer"
                label="Assign to closer"
                value={reassignToAgentId}
                onChange={setReassignToAgentId}
                placeholder="Select closer..."
                searchPlaceholder="Search closers..."
                options={workloads
                  .filter((w: AgentWorkload) => w.agentId !== reassignOrder.assignedCsId && w.pendingCount < w.capacity)
                  .map((w: AgentWorkload) => ({
                    value: w.agentId,
                    label: `${w.agentName} (${w.pendingCount}/${w.capacity})`,
                  }))}
              />
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
        <Modal
          open
          onClose={() => {
            setCancelConfirmOrder(null);
            setCancelReason('Customer not picking');
          }}
          maxWidth="max-w-md"
          contentClassName="p-6"
        >
          <h3 className="text-lg font-semibold text-app-fg mb-1">
            Cancel order for {cancelConfirmOrder.customerName}?
          </h3>
          <p className="text-sm text-app-fg-muted mb-3">
            Please provide a reason (at least 10 characters). The order will be moved to Cancelled.
          </p>
          {/* Preset reason chips — match the bulk cancel modal on the CS Orders page. */}
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
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Enter cancellation reason..."
            rows={3}
          />
          <div className="flex gap-2 mt-4 justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCancelConfirmOrder(null);
                setCancelReason('Customer not picking');
              }}
            >
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              className="border-danger-500 bg-danger-500 hover:bg-danger-600 text-white"
              disabled={cancelReason.trim().length < 10 || fetcher.state === 'submitting'}
              loading={fetcher.state === 'submitting'}
              loadingText="Cancelling..."
              onClick={() => {
                fetcher.submit(
                  {
                    intent: 'transition',
                    orderId: cancelConfirmOrder.orderId,
                    newStatus: 'CANCELLED',
                    reason: cancelReason.trim(),
                    ...csMutationBranchPayload(
                      cancelConfirmOrder.branchId ? [{ branchId: cancelConfirmOrder.branchId }] : [],
                    ),
                  },
                  { method: 'post' },
                );
              }}
            >
              Cancel order
            </Button>
          </div>
        </Modal>
      )}

      {/* View all Closer workloads modal — 20 per page, Prev/Next */}
      {viewAllAgentsOpen && (
        <Modal open onClose={() => setViewAllAgentsOpen(false)} maxWidth="max-w-4xl" role="dialog" aria-labelledby="view-all-closers-title" contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-app-border shrink-0">
              <h2 id="view-all-closers-title" className="text-lg font-semibold text-app-fg">
                Closer workloads
              </h2>
              <button
                type="button"
                onClick={() => setViewAllAgentsOpen(false)}
                className="p-2 rounded-lg text-app-fg-muted hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-2 border-b border-app-border shrink-0">
              <p className="text-sm text-app-fg-muted">
                {workloads.length} closer{workloads.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {(() => {
                const sorted = [...workloads].sort(compareCloserWorkloadsByRecency);
                const pageSize = 20;
                const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
                const page = Math.min(viewAllPage, totalPages);
                const start = (page - 1) * pageSize;
                const rows = sorted.slice(start, start + pageSize);

                return (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                      {rows.map((agent: AgentWorkload) => (
                        <AgentWorkloadCard key={agent.agentId} agent={agent} isNew={newAgentIds.has(agent.agentId)} onOpen={(a) => { setViewAllAgentsOpen(false); setSelectedAgent(a); }} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-app-border">
                      <span className="text-sm text-app-fg-muted">
                        Page {page} of {totalPages}
                        {sorted.length > 0 && (
                          <span className="ml-1">
                            ({start + 1}–{Math.min(start + pageSize, sorted.length)} of {sorted.length})
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
