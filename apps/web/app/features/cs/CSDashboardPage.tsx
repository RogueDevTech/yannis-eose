import { Suspense, lazy, useState, useRef, useCallback, useEffect, useMemo, useTransition } from 'react';
import { Await, Link, useFetcher, useRevalidator, useRouteLoaderData, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { StripToolbar } from '~/components/ui/strip-toolbar';
import { Modal } from '~/components/ui/modal';
import { Textarea } from '~/components/ui/textarea';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageNotification } from '~/components/ui/page-notification';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { RouteFetchErrorBanner } from '~/components/ui/route-fetch-error-banner';
import { Spinner } from '~/components/ui/spinner';
import { EmptyState } from '~/components/ui/empty-state';
import { useFetcherToast, useToast } from '~/components/ui/toast';
import { DeferredError, DeferredSection } from '~/components/ui/deferred-section';
import {
  CSTabCountBadgeSkeleton,
  CSClaimQueueTabDeferredFallback,
  CSCallbacksTabDeferredFallback,
  CSDuplicatesTabDeferredFallback,
  CSHotSwapTabSkeleton,
} from './CSDashboardDeferredFallbacks';
import { Tabs } from '~/components/ui/tabs';
import { SmartPick } from '~/components/ui/smart-pick';
import { Checkbox } from '~/components/ui/checkbox';
import { AssignCloserModal } from '~/components/ui/assign-closer-modal';
import { OrderStatusBadge } from '~/components/ui/order-status-badge';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { TableActionButton } from '~/components/ui/table-action-button';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Pagination } from '~/components/ui/pagination';
import { NairaPrice } from '~/components/ui/naira-price';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import {
  LiveActivityCard,
  LiveActivityDetailModal,
  DetailRow,
} from '~/components/ui/live-activity-card';
import { AbandonedCartDetailModal } from './AbandonedCartDetailModal';
const CreateOfflineOrderModal = lazy(() =>
  import('~/features/orders/CreateOfflineOrderModal').then((m) => ({ default: m.CreateOfflineOrderModal })),
);
const CSDashboardDuplicatesTabPanel = lazy(() =>
  import('./CSDashboardDuplicatesTabPanel').then((m) => ({ default: m.CSDashboardDuplicatesTabPanel })),
);
const DuplicateCompareModal = lazy(() =>
  import('./DuplicateCompareModal').then((m) => ({ default: m.DuplicateCompareModal })),
);
const CSDashboardCallbacksTabPanel = lazy(() =>
  import('./CSDashboardCallbacksTabPanel').then((m) => ({ default: m.CSDashboardCallbacksTabPanel })),
);
const CSDashboardHotSwapTabPanel = lazy(() =>
  import('./CSDashboardHotSwapTabPanel').then((m) => ({ default: m.CSDashboardHotSwapTabPanel })),
);
import { useLiveIndicator, useSocketEvent } from '~/hooks/useSocket';
import { useCloseOnFetcherSuccess } from '~/hooks/useCloseOnFetcherSuccess';
import { useFetcherActionSurface, ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';
import { getBrowserApiBaseUrl } from '~/lib/browser-api-base';
import { useBranchesCatalog } from '~/contexts/branches-catalog-context';
import { CSQueueDataSkeleton } from '~/features/cs/CSOverviewSkeleton';
import {
  parseCSQueueTabFromSearchParam,
  type CSDashboardCriticalPayload,
  type CSDashboardPageProps,
  type CSDashboardShell,
  type AgentWorkload,
  type CSOrder,
  type DuplicatePair,
  type PendingCart,
  type LiveActivityItem,
  type CSQueueTab,
  type CloserWorkloadOrder,
  type AbandonedCartPagination,
  ABANDONED_CARTS_PAGE_SIZE,
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
  const closesToday = agent.todayClosesCount ?? 0;
  const dailyPct = agent.capacity > 0 ? (closesToday / agent.capacity) * 100 : 0;
  const barColor =
    dailyPct >= 100 ? 'bg-success-500' : dailyPct >= 70 ? 'bg-warning-500' : 'bg-brand-500';

  const pctRounded = Math.round(Math.min(dailyPct, 100));
  const inner = (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-6 h-6 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-micro font-bold text-brand-600 dark:text-brand-400">
            {agent.agentName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <p className="text-sm font-medium text-app-fg truncate min-w-0 flex-1">
          {agent.agentName}
        </p>
      </div>
      <p className="text-mini text-app-fg-muted mb-1.5 truncate">
        Duty {closesToday}/{agent.capacity} · Backlog {agent.pendingCount}
      </p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-1.5 bg-app-hover rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.min(dailyPct, 100)}%` }}
          />
        </div>
        <span className="text-micro font-semibold text-app-fg-muted tabular-nums shrink-0">
          {pctRounded}%
        </span>
      </div>
      {(closesToday >= agent.capacity || agent.pendingCount >= agent.capacity || isNew) && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          {closesToday >= agent.capacity && (
            <span className="text-micro font-medium text-success-600 dark:text-success-400">Target met</span>
          )}
          {agent.pendingCount >= agent.capacity && (
            <span className="text-micro font-medium text-warning-600 dark:text-warning-400">At quota</span>
          )}
          {isNew && (
            <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-micro font-bold bg-success-500 text-white">
              NEW ORDER
            </span>
          )}
        </div>
      )}
    </>
  );

  const newClass = isNew
    ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
    : '';

  const viewOrdersLink = (
    <div className="flex flex-wrap items-center gap-3 w-full">
      {onOpen ? (
        <button
          type="button"
          title="Quick view this closer's workload"
          className="text-mini font-medium text-brand-600 dark:text-brand-400 hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(agent);
          }}
        >
          View
        </button>
      ) : (
        <Link
          to={`/admin/sales/orders?csCloserId=${agent.agentId}&period=all_time`}
          prefetch="intent"
          title="View orders for this closer"
          className="text-mini font-medium text-brand-600 dark:text-brand-400 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          View
        </Link>
      )}
      <Link
        to={`/admin/sales/queue?tab=hotswap&hotSwapFrom=${encodeURIComponent(agent.agentId)}`}
        prefetch="intent"
        title="Hot swap orders from this closer"
        className="text-mini font-medium text-app-fg-muted hover:text-app-fg hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        Swap
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
          className="text-left cursor-pointer flex-1 px-3.5 pt-3 pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 rounded-t-xl"
        >
          {inner}
        </button>
        <div className="px-3.5 pb-3 pt-0">
          {viewOrdersLink}
        </div>
      </div>
    );
  }
  return (
    <div className={`${className ?? 'card'} ${newClass} flex flex-col overflow-hidden p-0`}>
      <div className="px-3.5 pt-3 pb-2 flex-1">{inner}</div>
      <div className="px-3.5 pb-3 pt-0">{viewOrdersLink}</div>
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

  const closesToday = agent.todayClosesCount ?? 0;
  const dailyPct = agent.capacity > 0 ? (closesToday / agent.capacity) * 100 : 0;
  const statusColor =
    dailyPct >= 100 ? 'text-success-600 dark:text-success-400' :
    dailyPct >= 70 ? 'text-warning-600 dark:text-warning-400' :
    'text-brand-600 dark:text-brand-400';
  const barColor =
    dailyPct >= 100 ? 'bg-success-500' :
    dailyPct >= 70 ? 'bg-warning-500' :
    'bg-brand-500';
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
            <p className="text-mini leading-4 text-app-fg-muted uppercase tracking-wide">Backlog</p>
            <p className="text-xl leading-7 font-bold text-app-fg mt-1">{agent.pendingCount}</p>
          </div>
          <div className="rounded-lg bg-app-hover border border-app-border px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-mini leading-4 text-app-fg-muted uppercase tracking-wide">Daily target</p>
            <p className="text-xl leading-7 font-bold text-app-fg mt-1">{agent.capacity}</p>
          </div>
          <div className="rounded-lg bg-app-hover border border-app-border px-2.5 py-2.5 text-center min-h-[74px] flex flex-col justify-center">
            <p className="text-mini leading-4 text-app-fg-muted uppercase tracking-wide">Closed today</p>
            <p className={`text-xl leading-7 font-bold mt-1 ${closesToday >= agent.capacity ? 'text-success-600 dark:text-success-400' : 'text-app-fg'}`}>{closesToday}</p>
          </div>
        </div>
      </div>

      {/* Utilization bar */}
      <div className="px-5 pt-5 pb-2">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-app-fg-muted">Today&apos;s duty (Lagos)</p>
          <p className={`text-xs font-bold ${statusColor}`}>{closesToday} / {agent.capacity}</p>
        </div>
        <div className="w-full h-2.5 bg-app-hover rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${Math.min(dailyPct, 100)}%` }}
          />
        </div>
        {agent.pendingCount >= agent.capacity && (
          <p className="text-xs font-semibold text-danger-600 dark:text-danger-400 mt-1.5">
            Pipeline at concurrent limit — dispatch may block until backlog clears.
          </p>
        )}
      </div>

      {/* Last action */}
      <div className="px-5 py-4 border-t border-app-border">
        <p className="text-micro uppercase tracking-wider font-medium text-app-fg-muted mb-1">Last action</p>
        <p className="text-sm font-medium text-app-fg">{lastAction}</p>
      </div>

      {/* Pending queue: orders + line items (API order = updatedAt desc) */}
      <div className="px-5 py-3 border-t border-app-border max-h-[min(50vh,22rem)] overflow-y-auto">
        <p className="text-micro uppercase tracking-wider font-medium text-app-fg-muted mb-2">Orders in queue</p>
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

      <div className="px-5 pb-5 flex flex-col gap-2">
        <Link
          to={`/admin/sales/orders?csCloserId=${agent.agentId}&period=all_time`}
          prefetch="intent"
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700 transition-colors"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          View orders
        </Link>
        <Link
          to={`/admin/sales/queue?tab=hotswap&hotSwapFrom=${encodeURIComponent(agent.agentId)}`}
          prefetch="intent"
          onClick={onClose}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold text-app-fg bg-app-hover hover:bg-app-border border border-app-border transition-colors"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Hot swap
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
  canCancelOrders,
}: {
  order: CSOrder | null;
  agent?: AgentWorkload;
  onClose: () => void;
  onReassign: (order: CSOrder) => void;
  onCancel: (order: CSOrder) => void;
  /** Head of CS / Branch Admin / Admin only — closers can no longer cancel. */
  canCancelOrders: boolean;
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
              {canCancelOrders && (
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
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}


type CSDashboardPageLoadedProps = Omit<
  CSDashboardPageProps,
  'shell' | 'criticalData'
> & {
  critical: CSDashboardCriticalPayload;
  shell: CSDashboardShell;
  createOfflineOpen: boolean;
  onCreateOfflineOpenChange: (open: boolean) => void;
};

// ─── Static header (instant paint — not blocked by queue bundle) ───

function CSQueueStaticHeader({
  canCreateOffline,
  onCreateOffline,
  liveEvents,
}: {
  canCreateOffline: boolean;
  onCreateOffline: () => void;
  liveEvents?: string[];
}) {
  const liveState = useLiveIndicator(liveEvents ?? []);
  return (
    <PageHeader
      title="Live Activities"
      mobileInlineActions
      description="Today's queue and closer activity."
      actions={
        <PageHeaderMobileTools
          sheetTitle="Sales queue tools"
          sheetSubtitle={<span>Create offline orders and refresh the queue</span>}
          triggerAriaLabel="Sales queue tools"
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
              {canCreateOffline && (
                <Button variant="primary" size="sm" onClick={onCreateOffline}>
                  Create offline order
                </Button>
              )}
              <PageRefreshButton />
            </>
          }
          sheet={({ closeSheet }) => (
            <>
              {canCreateOffline ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full justify-center"
                  onClick={() => {
                    closeSheet();
                    onCreateOffline();
                  }}
                >
                  Create offline order
                </Button>
              ) : (
                <p className="text-sm text-app-fg-muted">Use the refresh icon to reload the queue.</p>
              )}
            </>
          )}
        />
      }
    />
  );
}

// ─── Component ──────────────────────────────────────────

function CSDashboardPageLoaded({
  critical,
  shell,
  createOfflineOpen,
  onCreateOfflineOpenChange,
  inactiveAgents: _inactiveAgents,
  callbackOrders,
  flaggedDuplicates,
  leaderboard: _leaderboard,
  leaderboardPeriod: _leaderboardPeriod = 'this_month',
  cartStats,
  claimQueue,
  liveEvents,
  canCreateOffline = false,
  canDeleteCart = false,
  canCancelOrders = false,
  productsForOfflineOrder,
}: CSDashboardPageLoadedProps) {
  const {
    workloads,
    unassignedOrders,
    unassignedTotal,
    activeOrders,
    activeTotal,
    hotSwapOrdersPayload,
    statusCounts,
    initialCartActivity,
    criticalFetchErrors,
  } = critical;
  const { isClaimMode, claimCap } = shell;
  const adminRouteData = useRouteLoaderData('routes/admin') as
    | { user?: { currentBranchId?: string | null } }
    | undefined;
  const branchesCatalog = useBranchesCatalog();

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
    const fb = branchesCatalog[0]?.id;
    return fb ? { branchId: fb } : {};
  }

  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const abandonedPageFromUrl = useMemo(() => {
    const n = parseInt(searchParams.get('abandonedPage') ?? '1', 10);
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }, [searchParams]);
  const abandonedPageFromUrlRef = useRef(abandonedPageFromUrl);
  abandonedPageFromUrlRef.current = abandonedPageFromUrl;
  // URL-driven page size for the abandoned-carts table — written by the `<Pagination>`
  // per-page picker as `?abandonedPerPage=`. The carts fetcher reloads when it changes.
  const abandonedPerPageFromUrl = useMemo(() => {
    const n = parseInt(searchParams.get('abandonedPerPage') ?? '', 10);
    return [ABANDONED_CARTS_PAGE_SIZE, 50, 100].includes(n) ? n : ABANDONED_CARTS_PAGE_SIZE;
  }, [searchParams]);
  const abandonedPerPageFromUrlRef = useRef(abandonedPerPageFromUrl);
  abandonedPerPageFromUrlRef.current = abandonedPerPageFromUrl;
  /** Build the carts resource-route URL with both abandoned pagination params. */
  const buildCartsUrl = useCallback(
    (page: number, perPage: number) =>
      `/admin/sales/queue/carts?abandonedPage=${page}&abandonedPerPage=${perPage}`,
    [],
  );
  const [, startHotSwapSearchTransition] = useTransition();
  const claimFetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();
  const cartsFetcher = useFetcher<{
    activityItems?: LiveActivityItem[];
    pendingCarts?: PendingCart[];
    abandonedCarts?: PendingCart[];
    abandonedPagination?: AbandonedCartPagination;
  }>();
  /** Tab follows `?tab=` so deep links and client <Link> navigations (e.g. Hot Swap from a closer card) switch the panel — local useState did not update when the URL changed. */
  const settledTab = useMemo((): CSQueueTab => {
    return parseCSQueueTabFromSearchParam(searchParams.get('tab'), isClaimMode) ?? 'queue';
  }, [searchParams, isClaimMode]);
  /** Optimistic tab override — set the moment the user clicks a tab so the visual indicator
   *  AND the content area swap immediately, without waiting for Remix to commit the new URL
   *  + revalidate the loader. Cleared once the URL catches up with the chosen tab. */
  const [optimisticTab, setOptimisticTab] = useState<CSQueueTab | null>(null);
  useEffect(() => {
    if (optimisticTab !== null && optimisticTab === settledTab) {
      setOptimisticTab(null);
    }
  }, [optimisticTab, settledTab]);
  const activeTab = optimisticTab ?? settledTab;
  /** True while we've optimistically switched but the loader hasn't caught up yet — used to
   *  drive the in-tab loading state below so the user gets immediate feedback. */
  const isTabSwitching = optimisticTab !== null && optimisticTab !== settledTab;
  const setActiveTab = useCallback(
    (v: CSQueueTab) => {
      setOptimisticTab(v);
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
  ], [claimingOrderId, claimFetcher.state, claimFetcher, setClaimingOrderId]);

  /** URL-driven so socket `revalidate()` keeps loading the same closer's orders (see usePageRefreshOnEvent). */
  const hotSwapFrom =
    searchParams.get('hotSwapFrom')?.trim() || searchParams.get('from')?.trim() || '';
  /** Tracks the closer the user just picked — updates immediately (outside transition) so
   *  stale cards are replaced by the skeleton the instant the dropdown changes. */
  const [pendingHotSwapFrom, setPendingHotSwapFrom] = useState(hotSwapFrom);
  const prevHotSwapFromRef = useRef(hotSwapFrom);
  if (prevHotSwapFromRef.current !== hotSwapFrom) {
    prevHotSwapFromRef.current = hotSwapFrom;
    if (hotSwapFrom !== pendingHotSwapFrom) {
      setPendingHotSwapFrom(hotSwapFrom);
    }
  }
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
    /** Source order status — used for optimistic count adjustment when cancelling. */
    fromStatus?: string;
  } | null>(null);
  /** Reason typed/picked in the cancel modal — required, min 10 chars before Submit enables. */
  const [cancelReason, setCancelReason] = useState('Customer not picking');
  /** Selected live activity item for detail modal (order-stage items only) */
  const [selectedLiveCart, setSelectedLiveCart] = useState<LiveActivityItem | null>(null);
  /** Selected cart for the cart detail modal (browsing + abandoned — rich fields, phone, actions). */
  const [selectedAbandonedCart, setSelectedAbandonedCart] = useState<PendingCart | null>(null);
  /** Tracks whether the opened cart modal is for a PENDING (browsing) or ABANDONED cart. */
  const [selectedCartStatus, setSelectedCartStatus] = useState<'PENDING' | 'ABANDONED'>('ABANDONED');
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
  /** Multi-select for bulk actions on the Cart abandonment tab. */
  const [selectedAbandonedIds, setSelectedAbandonedIds] = useState<Set<string>>(new Set());
  /** Multi-select for bulk dismiss on the Possible duplicates tab. */
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<string>>(new Set());
  /** Multi-select for the Callbacks tab. */
  const [selectedCallbackIds, setSelectedCallbackIds] = useState<Set<string>>(new Set());
  const bulkDismissDuplicatesFetcher = useFetcher<{
    success?: boolean;
    dismissed?: number;
    failed?: number;
    total?: number;
    error?: string;
  }>();
  const [bulkDismissDuplicatesConfirmOpen, setBulkDismissDuplicatesConfirmOpen] = useState(false);

  const toggleDuplicateSelection = (orderId: string) => {
    setSelectedDuplicateIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };
  const clearDuplicateSelection = () => setSelectedDuplicateIds(new Set());
  const bulkDeleteCartsFetcher = useFetcher<{
    ok: boolean;
    deleted?: number;
    failed?: number;
    total?: number;
    error?: string;
  }>();
  const [bulkDeleteCartsConfirmOpen, setBulkDeleteCartsConfirmOpen] = useState(false);
  // Optimistic delete overlay — captures the IDs at submit time so we can hide
  // them from the rendered list immediately, instead of waiting for the
  // cartsFetcher reload to return. Cleared once the server data no longer
  // contains them (or on failure).
  const [bulkDeletingAbandonedIds, setBulkDeletingAbandonedIds] = useState<string[]>([]);

  const toggleCallbackSelection = (orderId: string) => {
    setSelectedCallbackIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleAbandonedSelection = (cartId: string) => {
    setSelectedAbandonedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cartId)) next.delete(cartId);
      else next.add(cartId);
      return next;
    });
  };
  const clearAbandonedSelection = () => setSelectedAbandonedIds(new Set());
  /** Selected closers inside the Unassigned "Assign" modal (assignable only). */
  const [bulkAssignAgentIds, setBulkAssignAgentIds] = useState<Set<string>>(() => new Set());
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

  // Edge-trigger close-on-success — fires the instant `bulkAssignFetcher.data`
  // flips to `{ success: true }` (not on idle, which waits for loader
  // revalidation and lags 100–500ms behind the toast). See CLAUDE.md →
  // "Modal + Optimistic UI Pattern".
  useCloseOnFetcherSuccess(bulkAssignFetcher, () => {
    setBulkAssignAgentIds(new Set());
    clearQueueSelection();
    setAssignCloserModalOpen(false);
  });

  /** IDs of orders currently being bulk-assigned — derived from the in-flight
   *  fetcher payload. We hide these from the Unassigned Queue strip the same
   *  tick the user clicks Assign so the modal close, toast, and visual list
   *  update happen together. The loader revalidation (after the action
   *  resolves) brings the list back in sync; on error, the toast surfaces and
   *  the orders re-appear because the formData is gone. */
  const inFlightAssignIds = useMemo(() => {
    const fd = bulkAssignFetcher.formData;
    if (!fd) return new Set<string>();
    if (fd.get('intent') !== 'bulkAssignToCS') return new Set<string>();
    const json = fd.get('orderIds')?.toString();
    if (!json) return new Set<string>();
    try {
      const arr = JSON.parse(json) as unknown;
      if (!Array.isArray(arr)) return new Set<string>();
      return new Set<string>(arr.filter((x): x is string => typeof x === 'string'));
    } catch {
      return new Set<string>();
    }
  }, [bulkAssignFetcher.formData]);

  /** Visible cards in the strip — strips out orders currently being assigned
   *  so the list "moves" the same tick the user clicks Assign. */
  const displayedUnassignedOrders = useMemo(
    () =>
      inFlightAssignIds.size === 0
        ? unassignedOrders
        : unassignedOrders.filter((o) => !inFlightAssignIds.has(o.id)),
    [unassignedOrders, inFlightAssignIds],
  );
  const [selectedAgent, setSelectedAgent] = useState<AgentWorkload | null>(null);
  /** Agent Workloads: View all modal and pagination */
  const [viewAllAgentsOpen, setViewAllAgentsOpen] = useState(false);
  const [viewAllPage, setViewAllPage] = useState(1);
  /** Prefill Create Offline Order modal when opening from Cart Abandonment */
  const [createOfflinePrefill, setCreateOfflinePrefill] = useState<{
    customerName: string;
    cartPrefill?: import('~/features/orders/CreateOfflineOrderModal').CartPrefill;
  } | null>(null);
  /** Delete abandoned cart confirmation modal */
  const [deleteCartConfirm, setDeleteCartConfirm] = useState<PendingCart | null>(null);
  /** Side-by-side compare modal opened from the Possible duplicates tab.
   *  Hosts the Merge / Dismiss actions, which hand off to the existing confirm modals below. */
  const [compareDuplicatePair, setCompareDuplicatePair] = useState<DuplicatePair | null>(null);
  /** Merge / dismiss duplicate confirmation modals */
  const [mergeDuplicateConfirm, setMergeDuplicateConfirm] = useState<DuplicatePair | null>(null);
  const [dismissDuplicateConfirm, setDismissDuplicateConfirm] = useState<DuplicatePair | null>(null);
  /** IDs of carts that just appeared — used for NEW badge + slide-in animation */
  const [newCartIds, setNewCartIds] = useState<Set<string>>(new Set());
  /** IDs of carts that were updated (already known but data changed) — green ring flash */
  const [updatedCartIds, setUpdatedCartIds] = useState<Set<string>>(new Set());
  const knownCartIdsRef = useRef<Set<string>>(new Set());
  const prevCartsDataRef = useRef<Map<string, string>>(new Map());
  /** Agent IDs that just received a new order — for green highlight + sort-to-front */
  const [newAgentIds, setNewAgentIds] = useState<Set<string>>(new Set());
  const prevWorkloadCountsRef = useRef<Map<string, number>>(new Map());
  const liveActivityData =
    cartsFetcher.data ??
    initialCartActivity ?? {
      activityItems: [] as LiveActivityItem[],
      pendingCarts: [] as PendingCart[],
      abandonedCarts: [] as PendingCart[],
    };
  const abandonedPagination: AbandonedCartPagination = liveActivityData.abandonedPagination ?? {
    total: liveActivityData.abandonedCarts?.length ?? 0,
    page: 1,
    limit: ABANDONED_CARTS_PAGE_SIZE,
  };
  const serverAbandonedCartsList = liveActivityData.abandonedCarts ?? [];

  /** Route live activity card clicks: browsing/abandoned → rich cart modal, order stages → order modal. */
  const handleLiveActivityOpen = useCallback((item: LiveActivityItem) => {
    if (item.cartStatus === 'PENDING' || item.cartStatus === 'ABANDONED') {
      // Look up full PendingCart from loaded data (pendingCarts covers PENDING, abandonedCarts covers ABANDONED)
      const full =
        (liveActivityData.pendingCarts ?? []).find((c) => c.id === item.id) ??
        (liveActivityData.abandonedCarts ?? []).find((c) => c.id === item.id);
      if (full) {
        setSelectedCartStatus(item.cartStatus);
        setSelectedAbandonedCart(full);
        return;
      }
    }
    // Order-stage items → generic live activity detail modal
    setSelectedLiveCart(item);
  }, [liveActivityData.pendingCarts, liveActivityData.abandonedCarts]);
  const deleteCartFetcher = useFetcher<{ ok: boolean; error?: string }>();
  // Optimistic overlay: hide rows currently being deleted (single or bulk) so
  // the UI updates the instant the user confirms, not after the refetch returns.
  const abandonedCartsList = useMemo(() => {
    const hidden = new Set(bulkDeletingAbandonedIds);
    // Single delete in-flight — extract cart ID from the fetcher form data
    if (deleteCartFetcher.formData?.get('intent') === 'deleteAbandoned') {
      const singleId = deleteCartFetcher.formData.get('cartId')?.toString();
      if (singleId) hidden.add(singleId);
    }
    if (hidden.size === 0) return serverAbandonedCartsList;
    return serverAbandonedCartsList.filter((c) => !hidden.has(c.id));
  }, [serverAbandonedCartsList, bulkDeletingAbandonedIds, deleteCartFetcher.formData]);
  const abandonedTotalPages =
    abandonedPagination.total === 0 ? 0 : Math.ceil(abandonedPagination.total / abandonedPagination.limit);
  const { toast } = useToast();
  const agentScrollRef = useRef<HTMLDivElement>(null);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const unassignedQueueScrollRef = useRef<HTMLDivElement>(null);
  const abandonedScrollRef = useRef<HTMLDivElement>(null);
  const [viewAllActivityOpen, setViewAllActivityOpen] = useState(false);
  const [viewAllActivityPage, setViewAllActivityPage] = useState(1);
  const scrollAgentStrip = useCallback((delta: number) => {
    agentScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollActivityStrip = useCallback((delta: number) => {
    activityScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollUnassignedQueueStrip = useCallback((delta: number) => {
    unassignedQueueScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollAbandonedStrip = useCallback((delta: number) => {
    abandonedScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

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

  /** Align browser URL when API clamps abandoned page (e.g. delete shrunk total pages). */
  useEffect(() => {
    const serverPage = liveActivityData.abandonedPagination?.page;
    if (serverPage == null) return;
    if (serverPage !== abandonedPageFromUrl) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('abandonedPage', String(serverPage));
          return next;
        },
        { replace: true },
      );
    }
  }, [liveActivityData.abandonedPagination?.page, abandonedPageFromUrl, setSearchParams]);

  // Refresh cart payloads whenever abandoned pagination URL changes (and on first paint)
  useEffect(() => {
    cartsFetcher.load(buildCartsUrl(abandonedPageFromUrl, abandonedPerPageFromUrl));
  }, [abandonedPageFromUrl, abandonedPerPageFromUrl]);

  // Reload activity on any order event
  useSocketEvent('order:new', () => {
    cartsFetcher.load(buildCartsUrl(abandonedPageFromUrlRef.current, abandonedPerPageFromUrlRef.current));
  });
  useSocketEvent('order:status_changed', () => {
    cartsFetcher.load(buildCartsUrl(abandonedPageFromUrlRef.current, abandonedPerPageFromUrlRef.current));
  });

  const actionError = (fetcher.data as { error?: string })?.error;
  const fetcherSurface = useFetcherActionSurface(fetcher);
  const bulkAssignSurface = useFetcherActionSurface(bulkAssignFetcher);
  const deleteCartSurface = useFetcherActionSurface(deleteCartFetcher);

  type FetcherSubmissionMeta =
    | { intent: string; orderIdsLen?: number; newStatus?: string }
    | null;
  const fetcherSubmissionMetaRef = useRef<FetcherSubmissionMeta>(null);
  useEffect(() => {
    if (fetcher.state !== 'submitting' && fetcher.state !== 'loading') return;
    const fd = fetcher.formData;
    if (!fd) return;
    const intentRaw = fd.get('intent');
    if (typeof intentRaw !== 'string' || !intentRaw) return;
    const meta: NonNullable<FetcherSubmissionMeta> = { intent: intentRaw };
    if (intentRaw === 'bulkReassign') {
      try {
        const ids = JSON.parse(fd.get('orderIds')?.toString() ?? '[]');
        meta.orderIdsLen = Array.isArray(ids) ? ids.length : undefined;
      } catch {
        meta.orderIdsLen = undefined;
      }
    }
    if (intentRaw === 'transition') {
      const ns = fd.get('newStatus');
      meta.newStatus = typeof ns === 'string' ? ns : undefined;
    }
    fetcherSubmissionMetaRef.current = meta;
  }, [fetcher.state, fetcher.formData]);

  function fetcherCsModalError(kind: 'reassign' | 'cancel'): string | null {
    if (!fetcherSurface.friendlyError) return null;
    const m = fetcherSubmissionMetaRef.current;
    if (!m) return null;
    if (kind === 'cancel')
      return m.intent === 'transition' && m.newStatus === 'CANCELLED' ? fetcherSurface.friendlyError : null;
    if (kind === 'reassign')
      return m.intent === 'bulkReassign' && m.orderIdsLen === 1 ? fetcherSurface.friendlyError : null;
    return null;
  }

  const csMainFetcherModalOpen = reassignOrder != null || cancelConfirmOrder != null;
  const [dismissedError, setDismissedError] = useState(false);
  const distributeResult = fetcher.data as { success?: boolean; distributed?: number } | undefined;
  const successMessage =
    distributeResult && 'distributed' in distributeResult
      ? distributeResult.distributed === 0
        ? 'No unassigned orders to distribute'
        : `${distributeResult.distributed} order(s) distributed to closers`
      : 'CS action completed';
  useFetcherToast(fetcher.data, { successMessage, skipErrorToast: csMainFetcherModalOpen });
  useFetcherToast(claimFetcher.data, { successMessage: claimFetcher.data?.message ?? 'Order claimed' });
  useFetcherToast(deleteCartFetcher.data, {
    successMessage: 'Cart deleted',
    skipErrorToast: deleteCartConfirm != null,
  });
  useFetcherToast(bulkDeleteCartsFetcher.data, {
    successMessage: bulkDeleteCartsFetcher.data?.deleted
      ? `${bulkDeleteCartsFetcher.data.deleted} cart(s) cleared`
      : 'Carts cleared',
  });
  useFetcherToast(bulkDismissDuplicatesFetcher.data, {
    successMessage: bulkDismissDuplicatesFetcher.data?.dismissed
      ? `${bulkDismissDuplicatesFetcher.data.dismissed} duplicate(s) dismissed`
      : 'Duplicates dismissed',
  });
  useFetcherToast(bulkAssignFetcher.data, {
    successMessage: 'Order(s) assigned to closer',
    skipErrorToast: assignCloserModalOpen,
  });

  // Close delete modal and refresh carts list after successful delete
  useEffect(() => {
    if (deleteCartFetcher.state === 'idle' && deleteCartFetcher.data?.ok) {
      setDeleteCartConfirm(null);
      cartsFetcher.load(buildCartsUrl(abandonedPageFromUrlRef.current, abandonedPerPageFromUrlRef.current));
    }
  }, [deleteCartFetcher.state, deleteCartFetcher.data]);

  // Bulk delete carts — close confirm, clear selection, refresh
  useEffect(() => {
    if (bulkDeleteCartsFetcher.state !== 'idle' || !bulkDeleteCartsFetcher.data) return;
    const succeeded =
      bulkDeleteCartsFetcher.data.ok || (bulkDeleteCartsFetcher.data.deleted ?? 0) > 0;
    if (succeeded) {
      setBulkDeleteCartsConfirmOpen(false);
      clearAbandonedSelection();
      cartsFetcher.load(buildCartsUrl(abandonedPageFromUrlRef.current, abandonedPerPageFromUrlRef.current));
    } else {
      // Action errored — drop the optimistic filter so the rows reappear.
      setBulkDeletingAbandonedIds([]);
    }
  }, [bulkDeleteCartsFetcher.state, bulkDeleteCartsFetcher.data]);

  // Drop the optimistic delete overlay once the server-side refetch has
  // returned and the deleted carts are no longer in the response.
  useEffect(() => {
    if (bulkDeletingAbandonedIds.length === 0) return;
    if (cartsFetcher.state !== 'idle' || !cartsFetcher.data) return;
    const stillPresent =
      cartsFetcher.data.abandonedCarts?.some((c: PendingCart) => bulkDeletingAbandonedIds.includes(c.id)) ?? false;
    if (!stillPresent) setBulkDeletingAbandonedIds([]);
  }, [cartsFetcher.state, cartsFetcher.data, bulkDeletingAbandonedIds]);

  // Bulk dismiss duplicates — close confirm, clear selection, force loader revalidation
  useEffect(() => {
    if (bulkDismissDuplicatesFetcher.state !== 'idle' || !bulkDismissDuplicatesFetcher.data) return;
    if (bulkDismissDuplicatesFetcher.data.success || (bulkDismissDuplicatesFetcher.data.dismissed ?? 0) > 0) {
      setBulkDismissDuplicatesConfirmOpen(false);
      clearDuplicateSelection();
      revalidator.revalidate();
    }
  }, [bulkDismissDuplicatesFetcher.state, bulkDismissDuplicatesFetcher.data, revalidator]);

  // cart:updated socket event → reload carts fetcher directly (main loader revalidation won't refresh fetcher data)
  useSocketEvent('cart:updated', () => {
    cartsFetcher.load(buildCartsUrl(abandonedPageFromUrlRef.current, abandonedPerPageFromUrlRef.current));
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

  // Hot Swap selection clear + reset target + revalidate (so the From-closer
  // card count drops to reflect the swap, and the To-dropdown is fresh for the next swap).
  const handleBulkReassignSuccess = useCallback(() => {
    setHotSwapOrderIds([]);
    setHotSwapTo('');
    revalidator.revalidate();
  }, [revalidator]);
  useCloseOnFetcherSuccess(fetcher, handleBulkReassignSuccess, { intent: 'bulkReassign' });

  // Close duplicate-action confirm modals on success.
  useCloseOnFetcherSuccess(fetcher, () => setMergeDuplicateConfirm(null), {
    intent: 'mergeDuplicate',
  });
  useCloseOnFetcherSuccess(fetcher, () => setDismissDuplicateConfirm(null), {
    intent: 'dismissDuplicate',
  });

  const totalPending = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.pendingCount, 0);
  const totalCapacity = workloads.reduce((sum: number, w: AgentWorkload) => sum + w.capacity, 0);
  const totalClosesToday = workloads.reduce((sum: number, w: AgentWorkload) => sum + (w.todayClosesCount ?? 0), 0);

  // ── Optimistic count deltas ─────────────────────────────────────
  // Collect in-flight mutations from ALL fetchers and compute a unified
  // delta map: { STATUS: +N/-N }. Applied to rawCounts so the overview
  // stat strip updates the same tick the modal closes.
  const rawCounts = statusCounts as Record<string, number>;
  const optimisticDeltas = useMemo(() => {
    const d: Record<string, number> = {};
    const bump = (key: string, n: number) => { d[key] = (d[key] ?? 0) + n; };

    // 1. Bulk assign: UNPROCESSED → CS_ASSIGNED
    if (inFlightAssignIds.size > 0) {
      bump('UNPROCESSED', -inFlightAssignIds.size);
      bump('CS_ASSIGNED', inFlightAssignIds.size);
    }

    // 2. Cancel order: fromStatus → CANCELLED
    if (fetcher.formData?.get('intent') === 'transition' && fetcher.formData?.get('newStatus') === 'CANCELLED') {
      const fromStatus = cancelConfirmOrder?.fromStatus;
      if (fromStatus) bump(fromStatus, -1);
      bump('CANCELLED', 1);
    }

    // 3. Claim order: UNPROCESSED → CS_ASSIGNED
    if (claimFetcher.formData?.get('intent') === 'claimOrder') {
      bump('UNPROCESSED', -1);
      bump('CS_ASSIGNED', 1);
    }

    return d;
  }, [inFlightAssignIds, fetcher.formData, cancelConfirmOrder?.fromStatus, claimFetcher.formData]);

  const oCount = (key: string) => Math.max(0, (rawCounts[key] ?? 0) + (optimisticDeltas[key] ?? 0));
  const optimisticUnassigned = Math.max(0, unassignedTotal + (optimisticDeltas['UNPROCESSED'] ?? 0));

  // "Confirmed" rolls up the full post-confirmation in-flight pipeline so the
  // CEO bucket count matches the OrderStatusBadge default (which collapses
  // AGENT_ASSIGNED / DISPATCHED / IN_TRANSIT into "Confirmed").
  const confirmedCount = oCount('CONFIRMED') + oCount('AGENT_ASSIGNED') + oCount('DISPATCHED') + oCount('IN_TRANSIT');
  const cancelledCount = oCount('CANCELLED');
  const overviewStatItems: OverviewStatStripItem[] = [
    { label: 'Active closers', value: workloads.length, valueClassName: 'text-app-fg' },
    {
      label: 'Pending confirmation',
      value: totalPending,
      valueClassName: 'text-warning-600 dark:text-warning-400',
    },
    {
      label: 'Unassigned',
      value: optimisticUnassigned,
      valueClassName: 'text-danger-600 dark:text-danger-400',
    },
    {
      label: 'Assigned',
      value: oCount('CS_ASSIGNED'),
      valueClassName: 'text-info-600 dark:text-info-400',
    },
    {
      label: 'Unconfirmed',
      value: oCount('CS_ENGAGED'),
      valueClassName: 'text-cyan-600 dark:text-cyan-400',
    },
    {
      label: 'Confirmed',
      value: confirmedCount,
      valueClassName: 'text-brand-600 dark:text-brand-400',
    },
    {
      label: 'Delivered',
      value: oCount('DELIVERED'),
      valueClassName: 'text-success-600 dark:text-success-400',
    },
    {
      label: 'Cash Remitted',
      value: oCount('REMITTED'),
      valueClassName: 'text-green-600 dark:text-green-400',
    },
    {
      label: 'Backlog / cap',
      value: (
        <>
          {totalPending}
          <span className="text-sm font-normal text-app-fg-muted">/{totalCapacity}</span>
        </>
      ),
      valueClassName: 'text-app-fg',
    },
    {
      label: 'Duty today · Lagos',
      value: (
        <>
          {totalClosesToday}
          <span className="text-sm font-normal text-app-fg-muted">/{totalCapacity}</span>
        </>
      ),
      valueClassName: 'text-brand-600 dark:text-brand-400',
    },
    { label: 'Cancelled', value: cancelledCount, valueClassName: 'text-app-fg' },
    ...(cartStats
      ? ([
          {
            label: 'Cart Pending',
            value: (
              <DeferredSection
                resolve={cartStats}
                fallback={
                  <span
                    className="inline-block h-5 w-9 rounded-md bg-app-border/80 align-middle animate-pulse dark:bg-app-border/65"
                    aria-hidden
                  />
                }
              >
                {(stats: { pending: number; abandonedOpen: number }) => stats.pending}
              </DeferredSection>
            ),
            valueClassName: 'text-warning-600 dark:text-warning-400',
          },
          {
            label: 'Abandoned',
            value: (
              <DeferredSection
                resolve={cartStats}
                fallback={
                  <span
                    className="inline-block h-5 w-9 rounded-md bg-app-border/80 align-middle animate-pulse dark:bg-app-border/65"
                    aria-hidden
                  />
                }
              >
                {(stats: { pending: number; abandonedOpen: number }) => stats.abandonedOpen}
              </DeferredSection>
            ),
            valueClassName: 'text-app-fg',
          },
        ] satisfies OverviewStatStripItem[])
      : []),
  ];
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

  /** Use pendingHotSwapFrom so the UI reacts immediately when the dropdown changes,
   *  even before the URL-driven transition commits. */
  const activeHotSwapFrom = pendingHotSwapFrom || hotSwapFrom;

  const effectiveHotSwapPayload =
    activeHotSwapFrom && hotSwapOrdersPayload?.forAgentId === activeHotSwapFrom ? hotSwapOrdersPayload : null;

  const hotSwapListLoading =
    Boolean(activeHotSwapFrom) &&
    hotSwapOrdersPayload?.forAgentId !== activeHotSwapFrom;

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
      {criticalFetchErrors.length > 0 && (
        <RouteFetchErrorBanner messages={criticalFetchErrors} variant="danger" />
      )}

      {canCreateOffline && (
        <Suspense fallback={null}>
          <Await resolve={productsForOfflineOrder}>
            {(products) => (
              <Suspense fallback={null}>
                <CreateOfflineOrderModal
                  open={createOfflineOpen}
                  onClose={() => { onCreateOfflineOpenChange(false); setCreateOfflinePrefill(null); }}
                  onSuccess={() => { onCreateOfflineOpenChange(false); setCreateOfflinePrefill(null); }}
                  initialCustomerName={createOfflinePrefill?.customerName}
                  cartPrefill={createOfflinePrefill?.cartPrefill ?? null}
                  products={products}
                  branchId={csMutationBranchPayload(unassignedOrders).branchId}
                />
              </Suspense>
            )}
          </Await>
        </Suspense>
      )}

      {actionError && !dismissedError && !csMainFetcherModalOpen && (
        <PageNotification
          variant="error"
          message={fetcherSurface.friendlyError || actionError}
          durationMs={5000}
          onDismiss={() => setDismissedError(true)}
        />
      )}

      <OverviewStatStrip mobileGrid items={overviewStatItems} />

      {/* ── Live Activity Feed ──────────────────────────────── */}
      <div>
          {(() => {
            // Fall back to pendingCarts if listActivity isn't available yet (API not restarted)
            const rawActivity = liveActivityData.activityItems ?? [];
            const items: LiveActivityItem[] = rawActivity.length > 0
              ? rawActivity
              : (liveActivityData.pendingCarts ?? []).map<LiveActivityItem>((c) => ({
                  id: c.id,
                  customerName: c.customerName,
                  customerPhoneDisplay: c.customerPhoneDisplay,
                  productName: c.productName,
                  offerLabel: c.offerLabel,
                  cartStatus: 'PENDING',
                  orderStatus: null,
                  linkedOrderId: null,
                  totalAmount: null,
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
                        <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-micro font-bold bg-success-500 text-white">
                          {newCartIds.size} new
                        </span>
                      )}
                      {cartsFetcher.state === 'loading' && (
                        <span className="inline-flex items-center gap-1 text-mini text-app-fg-muted font-normal">
                          <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          Updating…
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-app-fg-muted mt-0.5">Today's orders and carts. Tap a card.</p>
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
                      <div key={item.id} className="shrink-0 w-48">
                        <LiveActivityCard
                          item={item}
                          isNew={newCartIds.has(item.id)}
                          isUpdated={updatedCartIds.has(item.id)}
                          onOpen={handleLiveActivityOpen}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    variant="inline"
                    icon={
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    }
                    title="No activity yet today"
                    description="Orders and carts will show here."
                  />
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
                                  onOpen={(i) => { setViewAllActivityOpen(false); handleLiveActivityOpen(i); }}
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

      {/* Abandoned cart detail modal — reveals raw phone (audited) for recovery */}
      <AbandonedCartDetailModal
        cart={selectedAbandonedCart}
        canReveal={canDeleteCart}
        canRecover={canDeleteCart}
        cartStatus={selectedCartStatus}
        onClose={() => setSelectedAbandonedCart(null)}
        onClear={canDeleteCart ? (c) => { setSelectedAbandonedCart(null); setDeleteCartConfirm(c); } : undefined}
      />

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
          setCancelConfirmOrder({ orderId: order.id, customerName: order.customerName, branchId: order.branchId, fromStatus: order.status })}
        canCancelOrders={canCancelOrders}
      />

      {/* Closer workload detail modal */}
      <AgentWorkloadDetailModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />

      {/* Closer workloads — horizontal scroll strip + View all */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-app-fg">Closer workloads</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">
              {workloads.length} active closer{workloads.length !== 1 ? 's' : ''} · {totalPending}/{totalCapacity}{' '}
              backlog · {totalClosesToday} closed today (Lagos)
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
          <EmptyState
            variant="inline"
            title="No closers found"
            description="Manage staff from HR → Users."
          />
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
                  className="card shrink-0 w-44"
                  onOpen={setSelectedAgent}
                  isNew={newAgentIds.has(agent.agentId)}
                />
              ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border">
        <Tabs
          size="sm"
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
                      <DeferredSection resolve={claimQueue} fallback={<CSTabCountBadgeSkeleton />}>
                        {(orders: CSOrder[]) =>
                          orders.length > 0 ? (
                            <span className="ml-1 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-400 text-micro font-bold">
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
              value: 'abandoned',
              label: 'Cart abandonment',
              badge:
                abandonedPagination.total > 0 ? (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-surface-200 dark:bg-surface-700 text-app-fg-muted text-micro font-bold">
                    {abandonedPagination.total}
                  </span>
                ) : undefined,
            },
            {
              value: 'callbacks',
              label: 'Callbacks',
              badge: (
                <DeferredSection resolve={callbackOrders} fallback={<CSTabCountBadgeSkeleton />}>
                  {(orders: CSOrder[]) =>
                    orders.length > 0 ? (
                      <span className="ml-1 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 rounded-full bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400 text-micro font-bold">
                        {orders.length}
                      </span>
                    ) : null
                  }
                </DeferredSection>
              ),
            },
            { value: 'hotswap', label: 'Hot Swap' },
          ]}
          className="border-b-0 flex-1 min-w-0"
        />
      </div>

      {/* Per-tab loading is handled by `<NavProgressBar />` at the top of the
          dashboard layout (the brand-coloured rail) plus tab-specific skeletons
          below. The previous global "Loading…" rail kept showing even when data
          was already on screen, so the user couldn't tell whether to wait or
          act — removed per CEO feedback. */}

      {/* Tab Content — fixed height so layout does not shift */}
      {activeTab === 'queue' && (
        <div className="space-y-3">
          {/* Bulk-assign toolbar — only renders when ≥ 1 card is selected. Clicking a card body
              opens the detail modal; toggling the checkbox in the top-left selects without
              opening the modal. Per CEO directive 2026-04-26: HoCS need a way to assign a
              batch of unassigned orders to a closer in one go. */}
          {displayedUnassignedOrders.length > 0 && (
            <div className="rounded-lg border border-app-border bg-app-elevated px-3 py-2 space-y-2">
              <div className="-mx-1 overflow-x-auto scrollbar-hide">
                <div className="flex min-w-max items-center gap-2 px-1">
                <SmartPick
                  total={displayedUnassignedOrders.length}
                  selectedCount={selectedQueueIds.size}
                  onPick={(count) =>
                    setSelectedQueueIds(
                      new Set(displayedUnassignedOrders.slice(0, count).map((o) => o.id)),
                    )
                  }
                  onClear={clearQueueSelection}
                  itemNoun="orders"
                  compactMobile
                  className="shrink-0"
                />
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={selectedQueueIds.size === 0}
                    onClick={() => {
                      setBulkAssignAgentIds(new Set());
                      setAssignCloserModalOpen(true);
                    }}
                  >
                    Assign{selectedQueueIds.size > 0 ? ` (${selectedQueueIds.size})` : ''}
                  </Button>
                </div>
                </div>
              </div>

              {bulkAssignFetcher.data?.error && !bulkAssignFetcher.data?.success && (
                <p className="text-xs text-danger-600 dark:text-danger-400">{bulkAssignFetcher.data.error}</p>
              )}
            </div>
          )}

          {displayedUnassignedOrders.length === 0 ? (
            <div className="rounded-xl border border-app-border bg-app-elevated p-10 text-center text-app-fg-muted">
              No unassigned orders in queue
            </div>
          ) : (
            <div>
              <StripToolbar
                title="Unassigned queue"
                description="New orders waiting for assignment. Pick one or bulk-assign."
                onScrollLeft={() => scrollUnassignedQueueStrip(-280)}
                onScrollRight={() => scrollUnassignedQueueStrip(280)}
                scrollAriaSubject="unassigned queue"
                viewAllTo="/admin/sales/orders?status=UNPROCESSED&period=all_time"
              />
              <div
                ref={unassignedQueueScrollRef}
                className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
              >
                {displayedUnassignedOrders.map((order: CSOrder) => {
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
                      className={`group relative shrink-0 w-48 text-left rounded-xl border bg-app-elevated transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                        isSelected
                          ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md'
                          : 'border-warning-200 dark:border-warning-800/60 hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                      }`}
                    >
                      <span className="absolute top-2 right-2 flex h-2 w-2 pointer-events-none">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning-400 opacity-60" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-warning-500" />
                      </span>

                      <span
                        className="absolute top-1.5 left-1.5 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleQueueSelection(order.id)}
                          aria-label={`Select order for ${order.customerName}`}
                        />
                      </span>

                      <div className="px-2.5 py-2 pl-7 pr-5">
                        <div className="flex items-baseline justify-between gap-2 mb-1">
                          <p className="text-xs font-semibold text-app-fg truncate leading-tight min-w-0 flex-1">
                            {order.customerName}
                          </p>
                          {order.totalAmount && (
                            <span className="text-mini font-bold text-app-fg shrink-0 tabular-nums">
                              &#8358;{Number(order.totalAmount).toLocaleString('en-NG')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mb-1 min-w-0">
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold uppercase tracking-wide bg-warning-100 dark:bg-warning-900/30 text-warning-700 dark:text-warning-400 shrink-0">
                            Unassigned
                          </span>
                          <span className="text-micro font-medium text-app-fg-muted truncate">
                            {new Date(order.createdAt).toLocaleString('en-NG', {
                              month: 'short', day: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedQueueOrder(order);
                          }}
                          className="text-mini font-medium text-brand-600 dark:text-brand-400 hover:underline"
                        >
                          View
                        </button>
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
      <AssignCloserModal
        open={assignCloserModalOpen}
        onClose={() => {
          setAssignCloserModalOpen(false);
          setBulkAssignAgentIds(new Set());
        }}
        selectedCount={selectedQueueIds.size}
        options={assignableCloserOptions}
        selectedIds={bulkAssignAgentIds}
        onToggle={(id) =>
          setBulkAssignAgentIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onSubmit={() => {
          bulkAssignFetcher.submit(
            {
              intent: 'bulkAssignToCS',
              orderIds: JSON.stringify(Array.from(selectedQueueIds)),
              csCloserIds: JSON.stringify(Array.from(bulkAssignAgentIds)),
              ...csMutationBranchPayload(unassignedOrders.filter((o) => selectedQueueIds.has(o.id))),
            },
            { method: 'post' },
          );
        }}
        isSubmitting={isBulkAssigning}
        errorMessage={bulkAssignSurface.errorMatchingIntent('bulkAssignToCS')}
        emptyMessage="No closers with free capacity. Free a slot or wait for a confirmation, then try again."
      />

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
                  <p className="text-mini uppercase tracking-wider font-semibold text-app-fg-muted mb-1.5">Items</p>
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
                        return (
                          <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-app-fg truncate">
                                {item.productName ?? 'Unknown product'}
                              </p>
                              <p className="text-mini text-app-fg-muted">
                                Qty: {item.quantity}{item.offerLabel ? ` · ${item.offerLabel}` : ''}
                              </p>
                            </div>
                            <span className="text-sm font-semibold text-app-fg shrink-0">
                              ₦{Number(item.unitPrice).toLocaleString('en-NG')}
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
                  {canCancelOrders && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedQueueOrder(null);
                        setCancelConfirmOrder({
                          orderId: qOrder.id,
                          customerName: qOrder.customerName,
                          branchId: qOrder.branchId,
                          fromStatus: qOrder.status,
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
                  )}
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {activeTab === 'hotswap' && (
        <Suspense fallback={<CSHotSwapTabSkeleton />}>
          <CSDashboardHotSwapTabPanel
            hotSwapFrom={activeHotSwapFrom}
            hotSwapTo={hotSwapTo}
            hotSwapOrderIds={hotSwapOrderIds}
            hotSwapListLoading={hotSwapListLoading}
            hotSwapSourceOrders={hotSwapSourceOrders}
            hotSwapSourceTotal={hotSwapSourceTotal}
            workloads={workloads}
            fetcherSubmitting={fetcher.state === 'submitting'}
            onClearSelection={() => setHotSwapOrderIds([])}
            onReassign={handleHotSwap}
            onFromCloserChange={(v) => {
              setPendingHotSwapFrom(v);
              setHotSwapOrderIds([]);
              startHotSwapSearchTransition(() => {
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
            onToCloserChange={setHotSwapTo}
            toggleHotSwapOrder={toggleHotSwapOrder}
            selectAllHotSwap={selectAllHotSwap}
          />
        </Suspense>
      )}

      {/* ── Claim Queue Tab ──────────────────────────── */}
      {activeTab === 'claim' && claimQueue && (
        <DeferredSection resolve={claimQueue} fallback={<CSClaimQueueTabDeferredFallback />}>
          {(rawClaimOrders: CSOrder[]) => {
            // Optimistic: hide the order being claimed so the list updates instantly.
            const claimInFlightId = claimFetcher.formData?.get('intent') === 'claimOrder'
              ? claimFetcher.formData?.get('orderId')?.toString()
              : null;
            const orders = claimInFlightId
              ? rawClaimOrders.filter((o) => o.id !== claimInFlightId)
              : rawClaimOrders;
            return (
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

                <CompactTable<CSOrder>
                  caption="Claim queue"
                  columns={claimQueueColumns}
                  rows={orders}
                  rowKey={(order) => order.id}
                  withCard={false}
                  emptyTitle="No orders in the claim queue right now."
                  renderMobileCard={(order) => {
                    const isClaiming = claimingOrderId === order.id && claimFetcher.state === 'submitting';
                    return (
                      <div className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <OrderIdBadge
                              id={order.id}
                              uppercase
                              ellipsis=""
                              linkTo={`/admin/orders/${order.id}`}
                              textClassName="text-brand-500 hover:text-brand-600 font-mono text-xs font-medium"
                            />
                            <p className="mt-0.5 text-sm font-medium text-app-fg">{order.customerName}</p>
                            <p className="text-xs font-mono text-app-fg-muted">{order.customerPhoneDisplay}</p>
                            {order.totalAmount && (
                              <p className="mt-1 text-xs text-app-fg-muted">₦{Number(order.totalAmount).toLocaleString()}</p>
                            )}
                            <p className="mt-1 text-xs text-app-fg-muted">
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
                  }}
                />
              </div>
            </div>
          );
          }}
        </DeferredSection>
      )}

      {/* ── Performance Tab ─────────────────────────── */}
      {/* ── Callbacks Tab ──────────────────────────── */}
      {activeTab === 'callbacks' && (
        <DeferredSection resolve={callbackOrders} fallback={<CSCallbacksTabDeferredFallback />}>
          {(resolvedCallbacks: CSOrder[]) => (
            <Suspense fallback={<CSCallbacksTabDeferredFallback />}>
              <CSDashboardCallbacksTabPanel
                orders={resolvedCallbacks}
                workloads={workloads}
                selectedIds={selectedCallbackIds}
                onToggle={toggleCallbackSelection}
              />
            </Suspense>
          )}
        </DeferredSection>
      )}

      {/* ── Cart abandonment Tab ──────────────────────────── */}
      {activeTab === 'abandoned' && (
        <div className="space-y-3">
          {abandonedCartsList.length === 0 && cartsFetcher.state === 'loading' ? (
            // Skeleton cards — only while we genuinely have no data yet AND a
            // fetch is in flight. Once carts land they replace the skeletons;
            // background revalidation paints under the cards (no flicker).
            <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={`abandoned-skeleton-${i}`}
                  className="shrink-0 w-48 rounded-xl border border-app-border bg-app-elevated"
                >
                  <div className="px-2.5 py-2 space-y-2">
                    <div className="h-3 rounded bg-app-hover animate-pulse w-3/4" />
                    <div className="h-2.5 rounded bg-app-hover animate-pulse w-2/3" />
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-12 rounded bg-app-hover animate-pulse" />
                      <div className="h-2.5 rounded bg-app-hover animate-pulse flex-1" />
                    </div>
                    <div className="h-2.5 rounded bg-app-hover animate-pulse w-1/2" />
                    <div className="flex gap-2 pt-1">
                      <div className="h-3 w-8 rounded bg-app-hover animate-pulse" />
                      <div className="h-3 w-8 rounded bg-app-hover animate-pulse" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : abandonedCartsList.length === 0 ? (
            <EmptyState
              variant="inline"
              title={
                abandonedPagination.total === 0
                  ? 'No abandoned carts'
                  : 'No carts on this page'
              }
              description={
                abandonedPagination.total === 0
                  ? 'Dropped-off sessions appear here until cleared.'
                  : 'Try another page or go back to page 1.'
              }
            />
          ) : (
            <div>
              {canDeleteCart && abandonedCartsList.length > 0 && (
                <div className="mb-2 rounded-lg border border-app-border bg-app-elevated px-3 py-2 -mx-1 overflow-x-auto scrollbar-hide">
                  <div className="flex min-w-max items-center gap-2 px-1">
                    <SmartPick
                      total={abandonedCartsList.length}
                      selectedCount={selectedAbandonedIds.size}
                      onPick={(count) =>
                        setSelectedAbandonedIds(
                          new Set(abandonedCartsList.slice(0, count).map((c) => c.id)),
                        )
                      }
                      onClear={clearAbandonedSelection}
                      itemNoun="carts"
                      compactMobile
                      className="shrink-0"
                    />
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={selectedAbandonedIds.size === 0 || bulkDeleteCartsFetcher.state !== 'idle'}
                      onClick={() => setBulkDeleteCartsConfirmOpen(true)}
                    >
                      Clear{selectedAbandonedIds.size > 0 ? ` (${selectedAbandonedIds.size})` : ''}
                    </Button>
                  </div>
                </div>
              )}
              <StripToolbar
                title="Cart abandonment"
                description={`Dropped sessions stay here until cleared. Backlog: ${abandonedPagination.total}.`}
                onScrollLeft={() => scrollAbandonedStrip(-280)}
                onScrollRight={() => scrollAbandonedStrip(280)}
                scrollAriaSubject="abandoned carts"
                viewAllTo="/admin/sales/queue?tab=abandoned&abandonedPage=1"
              />
              <div
                ref={abandonedScrollRef}
                className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
              >
                {abandonedCartsList.map((c: PendingCart) => {
                  const isSelected = selectedAbandonedIds.has(c.id);
                  return (
                  <div
                    key={c.id}
                    onClick={canDeleteCart ? () => toggleAbandonedSelection(c.id) : undefined}
                    onKeyDown={canDeleteCart ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleAbandonedSelection(c.id);
                      }
                    } : undefined}
                    role={canDeleteCart ? 'checkbox' : undefined}
                    aria-checked={canDeleteCart ? isSelected : undefined}
                    tabIndex={canDeleteCart ? 0 : undefined}
                    className={`group relative shrink-0 w-48 text-left rounded-xl border bg-app-elevated transition-all duration-200 ${
                      canDeleteCart ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500' : ''
                    } ${
                      isSelected
                        ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md'
                        : 'border-app-border hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                    }`}
                  >
                    <span className="absolute top-2 right-2 flex h-2 w-2 pointer-events-none">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-fg-muted/40 opacity-60" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-app-fg-muted/70" />
                    </span>

                    {canDeleteCart && (
                      <span className="absolute top-1.5 left-1.5 z-10" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onChange={() => toggleAbandonedSelection(c.id)}
                          aria-label={`Select cart for ${c.customerName}`}
                        />
                      </span>
                    )}

                    <div className={`px-2.5 py-2 pr-5 ${canDeleteCart ? 'pl-7' : ''}`}>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <p className="text-xs font-semibold text-app-fg truncate leading-tight min-w-0 flex-1">
                          {c.customerName}
                        </p>
                      </div>
                      <p className="text-micro font-mono text-app-fg-muted truncate mb-1">
                        {c.customerPhoneDisplay}
                      </p>
                      <div className="flex items-center gap-1.5 mb-1 min-w-0">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold uppercase tracking-wide bg-app-hover text-app-fg-muted shrink-0">
                          Dropped
                        </span>
                        <span className="text-micro text-app-fg-muted truncate min-w-0">
                          {c.productName ?? '—'}
                        </span>
                      </div>
                      <div className="text-micro font-medium text-app-fg-muted truncate mb-1.5">
                        {new Date(c.updatedAt).toLocaleString('en-NG', {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </div>

                      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                      <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => { setSelectedCartStatus('ABANDONED'); setSelectedAbandonedCart(c); }}
                          className="text-mini font-medium text-brand-700 dark:text-brand-300 hover:underline"
                        >
                          View
                        </button>
                        {canDeleteCart ? (
                          <button
                            type="button"
                            onClick={() => setDeleteCartConfirm(c)}
                            className="text-mini font-medium text-danger-600 dark:text-danger-400 hover:underline"
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
              {abandonedTotalPages >= 1 ? (
                <div className="mt-4 flex justify-center border-t border-app-border pt-4">
                  <Pagination
                    page={abandonedPagination.page}
                    totalPages={abandonedTotalPages}
                    pageParam="abandonedPage"
                    pageSize={abandonedPagination.limit}
                    pageSizeParam="abandonedPerPage"
                    pageSizeOptions={[ABANDONED_CARTS_PAGE_SIZE, 50, 100]}
                    showWhenSinglePage
                  />
                </div>
              ) : null}
            </div>
          )}
        </div>
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
          <ModalFetcherInlineError message={deleteCartSurface.errorMatchingIntent('deleteAbandoned')} className="mb-4" />
          <deleteCartFetcher.Form method="post" action="/admin/sales/queue/carts" className="flex items-center justify-end gap-2">
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

      {/* ── Bulk dismiss duplicates confirmation ─── */}
      {bulkDismissDuplicatesConfirmOpen && (
        <Modal open onClose={() => setBulkDismissDuplicatesConfirmOpen(false)} maxWidth="max-w-sm" contentClassName="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-app-fg">
                Dismiss {selectedDuplicateIds.size} flag{selectedDuplicateIds.size === 1 ? '' : 's'}?
              </h3>
              <p className="text-sm text-app-fg-muted mt-1">
                Selected orders will keep their data but the duplicate flag will be cleared. This can't be undone.
              </p>
            </div>
          </div>
          <bulkDismissDuplicatesFetcher.Form method="post" action="/admin/sales/queue" className="flex items-center justify-end gap-2">
            <input type="hidden" name="intent" value="bulkDismissDuplicates" />
            <input type="hidden" name="orderIds" value={Array.from(selectedDuplicateIds).join(',')} />
            <Button type="button" variant="secondary" size="sm" onClick={() => setBulkDismissDuplicatesConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={bulkDismissDuplicatesFetcher.state !== 'idle'}
            >
              {bulkDismissDuplicatesFetcher.state !== 'idle' ? 'Dismissing…' : 'Dismiss all'}
            </Button>
          </bulkDismissDuplicatesFetcher.Form>
        </Modal>
      )}

      {/* ── Bulk clear abandoned carts confirmation ─── */}
      {bulkDeleteCartsConfirmOpen && (
        <Modal open onClose={() => setBulkDeleteCartsConfirmOpen(false)} maxWidth="max-w-sm" contentClassName="p-6">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-danger-100 dark:bg-danger-900/30 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-danger-600 dark:text-danger-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-app-fg">Clear {selectedAbandonedIds.size} abandoned cart{selectedAbandonedIds.size === 1 ? '' : 's'}?</h3>
              <p className="text-sm text-app-fg-muted mt-1">
                Selected carts will be permanently removed. This cannot be undone.
              </p>
            </div>
          </div>
          <bulkDeleteCartsFetcher.Form method="post" action="/admin/sales/queue/carts" className="flex items-center justify-end gap-2">
            <input type="hidden" name="intent" value="deleteAbandonedMany" />
            <input type="hidden" name="cartIds" value={Array.from(selectedAbandonedIds).join(',')} />
            <Button type="button" variant="secondary" size="sm" onClick={() => setBulkDeleteCartsConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              loading={bulkDeleteCartsFetcher.state !== 'idle'}
              loadingText="Clearing…"
              onClick={() => setBulkDeletingAbandonedIds(Array.from(selectedAbandonedIds))}
            >
              Clear all
            </Button>
          </bulkDeleteCartsFetcher.Form>
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

            <ModalFetcherInlineError message={fetcherCsModalError('reassign')} className="mb-4" />

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
          <ModalFetcherInlineError message={fetcherCsModalError('cancel')} className="mb-3" />
          {/* Preset reason chips — match the bulk cancel modal on the Sales Orders page. */}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

      {/* Side-by-side comparison — opened from the "View" affordance on each
          duplicate card. Hands off Merge/Dismiss to the existing confirm
          modals below so the audit-confirm step is preserved. */}
      <Suspense fallback={null}>
        <DuplicateCompareModal
          pair={compareDuplicatePair}
          onClose={() => setCompareDuplicatePair(null)}
          actionsBusy={fetcher.state !== 'idle' && (fetcher.formData?.get('intent') === 'mergeDuplicate' || fetcher.formData?.get('intent') === 'dismissDuplicate')}
          onMerge={(pair) => {
            setCompareDuplicatePair(null);
            setMergeDuplicateConfirm(pair);
          }}
          onDismiss={(pair) => {
            setCompareDuplicatePair(null);
            setDismissDuplicateConfirm(pair);
          }}
        />
      </Suspense>

      {/* Merge duplicate confirmation */}
      <ConfirmActionModal
        open={mergeDuplicateConfirm != null}
        onClose={() => setMergeDuplicateConfirm(null)}
        title="Merge duplicate order?"
        variant="warning"
        confirmLabel={
          fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'mergeDuplicate'
            ? 'Merging…'
            : 'Merge into original'
        }
        loading={fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'mergeDuplicate'}
        description={
          mergeDuplicateConfirm ? (
            <>
              This will mark{' '}
              <span className="font-medium text-app-fg">
                {mergeDuplicateConfirm.duplicate.customerName}
              </span>
              's flagged order as a duplicate and link it to the original order. The duplicate will be
              cancelled and removed from the queue. This cannot be undone.
            </>
          ) : null
        }
        onConfirm={() => {
          if (!mergeDuplicateConfirm || !mergeDuplicateConfirm.original) return;
          fetcher.submit(
            {
              intent: 'mergeDuplicate',
              duplicateId: mergeDuplicateConfirm.duplicate.id,
              originalId: mergeDuplicateConfirm.original.id,
              ...csMutationBranchPayload([
                mergeDuplicateConfirm.duplicate,
                mergeDuplicateConfirm.original,
              ]),
            },
            { method: 'post' },
          );
        }}
      />

      {/* Dismiss duplicate confirmation */}
      <ConfirmActionModal
        open={dismissDuplicateConfirm != null}
        onClose={() => setDismissDuplicateConfirm(null)}
        title="Dismiss duplicate flag?"
        variant="danger"
        confirmLabel={
          fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'dismissDuplicate'
            ? 'Dismissing…'
            : 'Dismiss flag'
        }
        loading={
          fetcher.state !== 'idle' && fetcher.formData?.get('intent') === 'dismissDuplicate'
        }
        description={
          dismissDuplicateConfirm ? (
            <>
              This will clear the duplicate flag on{' '}
              <span className="font-medium text-app-fg">
                {dismissDuplicateConfirm.duplicate.customerName}
              </span>
              's order and treat it as a legitimate separate order. It will continue through the normal
              queue.
            </>
          ) : null
        }
        onConfirm={() => {
          if (!dismissDuplicateConfirm) return;
          fetcher.submit(
            {
              intent: 'dismissDuplicate',
              orderId: dismissDuplicateConfirm.duplicate.id,
              ...csMutationBranchPayload([dismissDuplicateConfirm.duplicate]),
            },
            { method: 'post' },
          );
        }}
      />
    </div>
  );
}

export function CSDashboardPage({
  shell,
  criticalData,
  productsForOfflineOrder,
  inactiveAgents,
  callbackOrders,
  flaggedDuplicates,
  leaderboard,
  leaderboardPeriod,
  cartStats,
  claimQueue,
  liveEvents,
  canCreateOffline,
  canDeleteCart,
  canCancelOrders = false,
}: CSDashboardPageProps) {
  const [createOfflineOpen, setCreateOfflineOpen] = useState(false);
  const queueBundle = useMemo(
    () =>
      Promise.all([shell, criticalData]).then(([shellResolved, critical]) => ({
        shell: shellResolved,
        critical,
      })),
    [shell, criticalData],
  );

  return (
    <div className="space-y-4">
      <CSQueueStaticHeader
        canCreateOffline={canCreateOffline ?? false}
        onCreateOffline={() => setCreateOfflineOpen(true)}
        liveEvents={liveEvents}
      />
      <Suspense fallback={<CSQueueDataSkeleton />}>
        <Await resolve={queueBundle} errorElement={<DeferredError />}>
          {({ shell: shellResolved, critical }) => (
            <CSDashboardPageLoaded
              critical={critical}
              shell={shellResolved}
              createOfflineOpen={createOfflineOpen}
              onCreateOfflineOpenChange={setCreateOfflineOpen}
              productsForOfflineOrder={productsForOfflineOrder}
              inactiveAgents={inactiveAgents}
              callbackOrders={callbackOrders}
              flaggedDuplicates={flaggedDuplicates}
              leaderboard={leaderboard}
              leaderboardPeriod={leaderboardPeriod}
              cartStats={cartStats}
              claimQueue={claimQueue}
              liveEvents={liveEvents}
              canCreateOffline={canCreateOffline}
              canDeleteCart={canDeleteCart}
              canCancelOrders={canCancelOrders}
            />
          )}
        </Await>
      </Suspense>
    </div>
  );
}
