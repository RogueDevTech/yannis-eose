import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { MediaBuyerBalanceCard } from '~/features/marketing/MediaBuyerBalanceCard';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { LiveActivityCard, LiveActivityDetailModal } from '~/components/ui/live-activity-card';
import { OverviewStatStrip, type OverviewStatStripItem } from '~/components/ui/overview-stat-strip';
import { useLiveIndicator, useSocketEvent } from '~/hooks/useSocket';
import { formatNaira } from '~/lib/format-amount';
import { STATUS_COLORS, formatStatus } from '~/features/shared/order-status';
import type { LeaderboardEntry, Metrics, FundingBalanceRow, MarketingOverviewRecentOrder } from './types';
import type { LiveActivityItem } from '~/features/cs/types';

/**
 * Build the Marketing Orders link, forwarding the overview's active date range
 * so the orders page opens on the SAME window the leaderboard was computed for.
 * Without this the orders page falls back to its own default (today), so a
 * media buyer with no orders today looks empty — the bug Head of Marketing
 * reported when clicking "View orders" from team analysis. Mirrors
 * `buildOrdersQuery` in MarketingTeamPage.
 */
function buildOrdersQuery(
  filters: { startDate: string; endDate: string; periodAllTime: boolean } | undefined,
  mediaBuyerId?: string,
): string {
  const params = new URLSearchParams();
  if (mediaBuyerId) params.set('mediaBuyerId', mediaBuyerId);
  if (filters?.periodAllTime) {
    params.set('period', 'all_time');
  } else {
    if (filters?.startDate) params.set('startDate', filters.startDate);
    if (filters?.endDate) params.set('endDate', filters.endDate);
  }
  const qs = params.toString();
  return qs ? `/admin/marketing/orders?${qs}` : '/admin/marketing/orders';
}

function renderMediaBuyerLeaderboardCard(
  buyer: LeaderboardEntry,
  filters: { startDate: string; endDate: string; periodAllTime: boolean } | undefined,
  className = '',
  isNew = false,
) {
  const isHighCpa = buyer.cpa > HIGH_CPA_THRESHOLD && buyer.totalOrders > 0;
  const roasBarWidth = Math.min((buyer.trueRoas / 4) * 100, 100); // cap at 4x ROAS = full bar
  const barColor = buyer.trueRoas >= 2
    ? 'bg-success-500'
    : buyer.trueRoas >= 1
      ? 'bg-warning-500'
      : 'bg-danger-500';
  const roasTextColor = buyer.trueRoas >= 2
    ? 'text-success-600 dark:text-success-400'
    : buyer.trueRoas >= 1
      ? 'text-warning-600 dark:text-warning-400'
      : 'text-danger-600 dark:text-danger-400';
  const initials = buyer.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const newClass = isNew
    ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
    : 'hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md';

  return (
    <Link
      key={buyer.mediaBuyerId}
      to={buildOrdersQuery(filters, buyer.mediaBuyerId)}
      prefetch="intent"
      className={`
        group relative block rounded-xl border transition-all duration-200 cursor-pointer
        ${isHighCpa ? 'ring-2 ring-warning-400 dark:ring-warning-500' : ''}
        ${isNew
          ? 'row-new-highlight'
          : 'bg-app-elevated border-app-border'
        }
        ${newClass}
        ${className}
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
      `}
      title={`View ${buyer.name}'s orders`}
    >
      <span className="absolute top-2 right-2 flex h-2 w-2">
        {isNew ? (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success-500" />
          </>
        ) : (
          <span className="relative inline-flex rounded-full h-2 w-2 bg-app-border" />
        )}
      </span>

      <div className="px-2.5 py-2 pr-5">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
            <span className="text-mini font-bold text-brand-600 dark:text-brand-400">{initials}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-app-fg truncate">{buyer.name}</p>
            <p className="text-micro text-app-fg-muted truncate">
              {buyer.totalOrders} order{buyer.totalOrders !== 1 ? 's' : ''} · {buyer.deliveredOrders} delivered
            </p>
          </div>
          <span className={`text-mini font-bold shrink-0 tabular-nums ${roasTextColor}`}>
            {buyer.trueRoas.toFixed(2)}x
          </span>
        </div>

        <div className="flex items-center gap-1.5 mb-1 min-w-0">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 px-1.5 py-0.5 rounded text-micro font-medium bg-app-hover text-app-fg-muted">
            <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="truncate min-w-0">CPA {formatNaira(Math.round(buyer.cpa))}</span>
          </span>
          {isHighCpa ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold uppercase tracking-wide shrink-0 bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
              High CPA
            </span>
          ) : null}
        </div>

        <div className="mb-1 flex items-center justify-between gap-2 text-micro font-medium text-app-fg-muted">
          <span>Conf {Math.round(buyer.confirmationRate)}%</span>
          <span>Del {Math.round(buyer.deliveryRate)}%</span>
        </div>
        <div className="w-full h-1.5 bg-app-hover rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${roasBarWidth}%` }}
          />
        </div>

        {isNew && (
          <div className="mt-1.5 flex items-center gap-1">
            <span className="animate-new-badge inline-flex items-center px-1 py-0 rounded-full text-2xs font-bold bg-success-500 text-white">
              JUST NOW
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

const HIGH_CPA_THRESHOLD = 5000;

export interface MarketingOverviewPageProps {
  metrics: Metrics;
  leaderboard: LeaderboardEntry[];
  balancesList?: FundingBalanceRow[];
  leaderboardPeriod: 'this_month' | 'all_time';
  filters?: { startDate: string; endDate: string; periodAllTime: boolean };
  liveEvents?: string[];
  recentOrders?: MarketingOverviewRecentOrder[];
  /** Initial cart/order activity rendered on first paint before fetcher refresh. */
  liveActivity?: LiveActivityItem[];
}

export function MarketingOverviewPage({
  metrics,
  leaderboard,
  balancesList = [],
  leaderboardPeriod = 'this_month',
  filters,
  liveEvents,
  recentOrders = [],
  liveActivity = [],
}: MarketingOverviewPageProps) {
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [liveOrdersPage, setLiveOrdersPage] = useState(1);
  const pageSize = 5;
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Local order state for hybrid updates — status changes update in-place, no DB round-trip
  const [localOrders, setLocalOrders] = useState<MarketingOverviewRecentOrder[]>(recentOrders);
  // Sync when loader provides fresh data (new order:new revalidation or initial load)
  useEffect(() => { setLocalOrders(recentOrders); }, [recentOrders]);

  // order:status_changed → patch matching row status in local state only
  useSocketEvent<{ orderId: string; newStatus: string }>('order:status_changed', ({ orderId, newStatus }) => {
    setLocalOrders((prev) => {
      const idx = prev.findIndex((o) => o.id === orderId);
      if (idx === -1) return prev; // order not in this list, ignore
      const next = [...prev];
      next[idx] = { ...next[idx], status: newStatus } as MarketingOverviewRecentOrder;
      // flash highlight
      setHighlightedIds((h) => new Set([...h, orderId]));
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedIds((h) => { const n = new Set(h); n.delete(orderId); return n; });
        highlightTimeoutRef.current = null;
      }, 3000);
      return next;
    });
  });
  /** Media buyer IDs that just received a new order — flash green + sort to front */
  const [newBuyerIds, setNewBuyerIds] = useState<Set<string>>(new Set());
  const prevBuyerOrderCountsRef = useRef<Map<string, number>>(new Map());

  // Detect buyers whose order count increased → flash highlight
  useEffect(() => {
    const freshBuyers = new Set<string>();
    for (const b of leaderboard) {
      const prev = prevBuyerOrderCountsRef.current.get(b.mediaBuyerId) ?? b.totalOrders;
      if (b.totalOrders > prev) freshBuyers.add(b.mediaBuyerId);
      prevBuyerOrderCountsRef.current.set(b.mediaBuyerId, b.totalOrders);
    }
    if (freshBuyers.size > 0) {
      setNewBuyerIds((prev) => new Set([...prev, ...freshBuyers]));
      setTimeout(() => {
        setNewBuyerIds((prev) => {
          const next = new Set(prev);
          freshBuyers.forEach((id) => next.delete(id));
          return next;
        });
      }, 3000);
    }
  }, [leaderboard]);

  const mediaBuyerScrollRef = useRef<HTMLDivElement>(null);
  const liveOrdersScrollRef = useRef<HTMLDivElement>(null);

  // ─── Live Activity strip (mirror of CSDashboardPage strip) ───
  const cartsFetcher = useFetcher<{ activityItems?: LiveActivityItem[] }>();
  const [newCartIds, setNewCartIds] = useState<Set<string>>(new Set());
  const [updatedCartIds, setUpdatedCartIds] = useState<Set<string>>(new Set());
  const knownCartIdsRef = useRef<Set<string>>(new Set(liveActivity.map((c) => c.id)));
  const prevCartsDataRef = useRef<Map<string, string>>(new Map(
    liveActivity.map((c) => [
      c.id,
      `${c.cartStatus}|${c.orderStatus ?? ''}|${c.offerLabel ?? ''}|${String(c.updatedAt)}`,
    ]),
  ));
  const [selectedLiveCart, setSelectedLiveCart] = useState<LiveActivityItem | null>(null);
  const [viewAllActivityOpen, setViewAllActivityOpen] = useState(false);
  const [viewAllActivityPage, setViewAllActivityPage] = useState(1);
  const activityScrollRef = useRef<HTMLDivElement>(null);
  const scrollActivityStrip = useCallback((delta: number) => {
    activityScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);

  // Initial fetch on mount + reload on order/cart events
  useEffect(() => {
    cartsFetcher.load('/admin/marketing/overview/activity');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useSocketEvent('cart:updated', () => {
    cartsFetcher.load('/admin/marketing/overview/activity');
  });
  useSocketEvent('order:new', () => {
    cartsFetcher.load('/admin/marketing/overview/activity');
  });
  useSocketEvent('order:status_changed', () => {
    cartsFetcher.load('/admin/marketing/overview/activity');
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

  useEffect(() => {
    if (viewAllActivityOpen) setViewAllActivityPage(1);
  }, [viewAllActivityOpen]);
  const scrollMediaBuyerStrip = useCallback((delta: number) => {
    mediaBuyerScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollLiveOrdersStrip = useCallback((delta: number) => {
    liveOrdersScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const liveOrdersTotalPages = Math.max(1, Math.ceil(localOrders.length / pageSize));
  const prevOrdersLengthRef = useRef(localOrders.length);
  useEffect(() => {
    if (liveOrdersPage > liveOrdersTotalPages) setLiveOrdersPage(1);
  }, [localOrders.length, liveOrdersTotalPages, liveOrdersPage]);
  // When new orders arrive via revalidation, jump to page 1
  useEffect(() => {
    if (localOrders.length > prevOrdersLengthRef.current) {
      setLiveOrdersPage(1);
    }
    prevOrdersLengthRef.current = localOrders.length;
  }, [localOrders.length]);
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, []);
  const periodLabel = leaderboardPeriod === 'all_time'
    ? 'all time'
    : (filters?.startDate && filters?.endDate)
      ? `${filters.startDate} – ${filters.endDate}`
      : 'this month';
  const avgCpa = leaderboard.length > 0
    ? leaderboard.reduce((sum, b) => sum + b.cpa, 0) / leaderboard.length
    : 0;
  const statItems: OverviewStatStripItem[] = [
    {
      label: 'Total Spend',
      value: formatNaira(Math.round(metrics.totalSpend)),
      valueClassName: 'text-app-fg',
    },
    {
      label: 'Total Orders',
      value: metrics.totalOrders.toString(),
      valueClassName: 'text-brand-600 dark:text-brand-400',
    },
    {
      label: 'Delivered',
      value: metrics.deliveredOrders.toString(),
      valueClassName: 'text-success-600 dark:text-success-400',
    },
    {
      label: 'Confirmed',
      value: metrics.confirmedOrders.toString(),
      valueClassName: 'text-success-600 dark:text-success-400',
    },
    {
      label: 'Avg CPA',
      value: formatNaira(Math.round(avgCpa)),
      valueClassName: 'text-app-fg',
    },
    {
      label: 'Delivery Rate',
      value: `${metrics.deliveryRate.toFixed(1)}%`,
      valueClassName:
        metrics.deliveryRate >= 70
          ? 'text-success-600 dark:text-success-400'
          : 'text-warning-600 dark:text-warning-400',
    },
    {
      label: 'Confirmation Rate',
      value: `${metrics.confirmationRate.toFixed(1)}%`,
      valueClassName:
        metrics.confirmationRate >= 70
          ? 'text-success-600 dark:text-success-400'
          : 'text-warning-600 dark:text-warning-400',
    },
    {
      label: 'True ROAS',
      value: `${metrics.trueRoas.toFixed(2)}x`,
      valueClassName: 'text-app-fg',
    },
    {
      label: 'Del. Revenue',
      value: formatNaira(Math.round(metrics.deliveredRevenue)),
      valueClassName: 'text-app-fg',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live Activities"
        mobileInlineActions
        description="Track marketing activity and funding."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Marketing overview tools"
            sheetSubtitle={<span>Date range and refresh</span>}
            triggerAriaLabel="Marketing overview tools"
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
                    startDate={filters?.startDate ?? ''}
                    endDate={filters?.endDate ?? ''}
                    periodAllTime={filters?.periodAllTime ?? false}
                  />
                </div>
                <PageRefreshButton />
              </>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters?.startDate ?? ''}
        endDate={filters?.endDate ?? ''}
        periodAllTime={filters?.periodAllTime ?? false}
      />

      <OverviewStatStrip mobileGrid items={statItems} />

      {/* ── Live Activity strip (browsing / abandoned / order-placed cards) ── */}
      <div>
        {(() => {
          const liveActivityItems = (cartsFetcher.data?.activityItems ?? liveActivity) as LiveActivityItem[];
          const sorted = [...liveActivityItems].sort((a, b) => {
            const aNew = newCartIds.has(a.id) ? 2 : updatedCartIds.has(a.id) ? 1 : 0;
            const bNew = newCartIds.has(b.id) ? 2 : updatedCartIds.has(b.id) ? 1 : 0;
            if (aNew !== bNew) return bNew - aNew;
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          });
          const stripVisible = sorted.slice(0, 12);
          return (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-app-fg flex items-center gap-2">
                    Live activity
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
                  <p className="text-xs text-app-fg-muted mt-0.5">
                    {sorted.length} customer{sorted.length === 1 ? '' : 's'} — last 6 hours · click a card for details
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
                  {sorted.length > 0 && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setViewAllActivityOpen(true)}>
                      View all
                    </Button>
                  )}
                </div>
              </div>

              {sorted.length > 0 ? (
                <div
                  ref={activityScrollRef}
                  className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
                >
                  {stripVisible.map((item) => (
                    <div key={item.id} className="shrink-0 w-48">
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
                <div className="rounded-xl border border-app-border bg-app-elevated flex flex-col items-center justify-center py-10 gap-2">
                  <span className="h-3 w-3 rounded-full bg-app-border animate-pulse" />
                  <p className="text-sm font-medium text-app-fg-muted">Waiting for activity…</p>
                  <p className="text-xs text-app-fg-muted">Cards appear here as carts and orders come in</p>
                </div>
              )}

              {viewAllActivityOpen && (
                <Modal open onClose={() => setViewAllActivityOpen(false)} maxWidth="max-w-4xl" role="dialog" aria-labelledby="mkt-view-all-activity-title" contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-app-border shrink-0">
                    <h2 id="mkt-view-all-activity-title" className="text-lg font-semibold text-app-fg">
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
                      {sorted.length} item{sorted.length !== 1 ? 's' : ''} — last 6 hours
                    </p>
                  </div>
                  <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                    {(() => {
                      const allPageSize = 10;
                      const totalPages = Math.max(1, Math.ceil(sorted.length / allPageSize));
                      const page = Math.min(viewAllActivityPage, totalPages);
                      const start = (page - 1) * allPageSize;
                      const rows = sorted.slice(start, start + allPageSize);
                      return (
                        <>
                          {/* Match the strip card width (w-48) so cards look
                              identical inside the modal — auto-fill the row. */}
                          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(192px,1fr))]">
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
                                  ({start + 1}–{Math.min(start + allPageSize, sorted.length)} of {sorted.length})
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

      {/* Live activity detail modal — shared with CS dashboard */}
      <LiveActivityDetailModal item={selectedLiveCart} onClose={() => setSelectedLiveCart(null)} />

      {/* Live activity feed */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-lg font-semibold text-app-fg flex items-center gap-2">
                Live orders
                {liveOrdersPage === 1 && highlightedIds.size > 0 && (
                  <span className="animate-new-badge inline-flex items-center px-2 py-0.5 rounded-full text-micro font-bold bg-success-500 text-white">
                    {highlightedIds.size} updated
                  </span>
                )}
              </h2>
              <p className="text-xs text-app-fg-muted mt-0.5">
                {localOrders.length} orders · updates instantly
              </p>
            </div>
          </div>
          {localOrders.length > 0 && (
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => scrollLiveOrdersStrip(-280)}
                className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center"
                aria-label="Scroll live orders left"
              >
                <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => scrollLiveOrdersStrip(280)}
                className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center"
                aria-label="Scroll live orders right"
              >
                <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <Link
                to={buildOrdersQuery(filters)}
                prefetch="intent"
                className="btn-secondary btn-sm inline-flex items-center justify-center"
              >
                View all
              </Link>
            </div>
          )}
        </div>
        {localOrders.length === 0 ? (
          <div className="rounded-xl border border-app-border bg-app-elevated flex flex-col items-center justify-center py-12 gap-2">
            <span className="h-3 w-3 rounded-full bg-app-border animate-pulse" />
            <p className="text-sm text-app-fg-muted">Waiting for orders…</p>
          </div>
        ) : (
          (() => {
            // Single horizontal-scroll strip — matches the Sales Unassigned Queue layout.
            // Cap at 50 cards client-side to keep the DOM bounded on busy days; users
            // who want more click "View all" to land on the full table.
            const rows = localOrders.slice(0, 50);
            return (
              <>
                {/* Compact horizontal-scroll strip — mirrors the LiveActivityCard
                    density (w-48 cards, text-xs/[10px] sizes, px-2.5 py-2). */}
                <div
                  ref={liveOrdersScrollRef}
                  className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
                >
                  {rows.map((order) => {
                    const isHighlighted = highlightedIds.has(order.id);
                    const statusBadge = STATUS_COLORS[order.status] ?? 'badge';
                    return (
                      <Link
                        key={order.id}
                        to={`/admin/orders/${order.id}`}
                        prefetch="intent"
                        className={`
                          group relative shrink-0 w-48 block rounded-xl border transition-all duration-200 cursor-pointer
                          ${isHighlighted
                            ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
                            : 'bg-app-elevated border-app-border hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                          }
                          ${isHighlighted ? 'row-new-highlight' : ''}
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                        `}
                      >
                        {/* Live dot — top-right, smaller */}
                        <span className="absolute top-2 right-2 flex h-2 w-2">
                          {isHighlighted ? (
                            <>
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-success-500" />
                            </>
                          ) : (
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-app-border" />
                          )}
                        </span>

                        <div className="px-2.5 py-2 pr-5">
                          {/* Row 1: customer name + amount */}
                          <div className="flex items-baseline justify-between gap-2 mb-1">
                            <p className="text-xs font-semibold text-app-fg truncate leading-tight min-w-0 flex-1">
                              {order.customerName}
                            </p>
                            <span className="text-mini font-bold text-app-fg shrink-0 tabular-nums">
                              {order.totalAmount ? formatNaira(Number(order.totalAmount)) : '—'}
                            </span>
                          </div>

                          {/* Row 2: media buyer pill + status pill */}
                          <div className="flex items-center gap-1.5 mb-1 min-w-0">
                            <span className="inline-flex min-w-0 max-w-full items-center gap-1 px-1.5 py-0.5 rounded text-micro font-medium bg-app-hover text-app-fg-muted">
                              <svg className="w-2.5 h-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <span className="truncate min-w-0">{order.mediaBuyerName ?? 'No MB'}</span>
                            </span>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold uppercase tracking-wide shrink-0 ${statusBadge}`}>
                              {formatStatus(order.status)}
                            </span>
                          </div>

                          {/* Row 3: timestamp */}
                          <div className="text-micro font-medium text-app-fg-muted truncate">
                            {new Date(order.createdAt).toLocaleString('en-NG', {
                              month: 'short', day: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </div>

                          {/* LIVE flash — compact */}
                          {isHighlighted && (
                            <div className="mt-1.5 flex items-center gap-1">
                              <span className="animate-new-badge inline-flex items-center px-1 py-0 rounded-full text-2xs font-bold bg-success-500 text-white">
                                JUST NOW
                              </span>
                            </div>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {localOrders.length > rows.length ? (
                  <p className="text-mini text-app-fg-muted mt-2">
                    Showing the {rows.length} most recent · {localOrders.length - rows.length} more in the full
                    table.
                  </p>
                ) : null}
              </>
            );
          })()
        )}
      </div>

      {/* Media Buyer Performance — horizontal scroll strip + View all modal */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-app-fg">Media Buyer Performance</h2>
            <p className="text-xs text-app-fg-muted mt-0.5">
              Updates live when orders change.
            </p>
          </div>
          {(() => {
            const teamFromBalances = balancesList.filter((b) => b.role === 'MEDIA_BUYER');
            const hasLeaderboard = leaderboard.length > 0;
            const hasTeamFromBalances = teamFromBalances.length > 0;
            const showCardsFromBalances = !hasLeaderboard && hasTeamFromBalances;
            const hasCards = hasLeaderboard || showCardsFromBalances;
            if (!hasCards) return null;
            return (
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => scrollMediaBuyerStrip(-280)}
                  className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center"
                  aria-label="Scroll left"
                >
                  <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => scrollMediaBuyerStrip(280)}
                  className="p-1 sm:p-2 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center"
                  aria-label="Scroll right"
                >
                  <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <Link
                  to="/admin/marketing/team"
                  prefetch="intent"
                  className="btn-secondary btn-sm inline-flex items-center justify-center"
                >
                  View all
                </Link>
              </div>
            );
          })()}
        </div>
        {(() => {
          const teamFromBalances = balancesList.filter((b) => b.role === 'MEDIA_BUYER');
          const hasLeaderboard = leaderboard.length > 0;
          const hasTeamFromBalances = teamFromBalances.length > 0;
          const showCardsFromBalances = !hasLeaderboard && hasTeamFromBalances;
          const cardsSource = hasLeaderboard ? leaderboard : null;
          const balanceOnlySource = showCardsFromBalances ? teamFromBalances : null;

          if (!hasLeaderboard && !showCardsFromBalances) {
            return (
              <div className="card text-center py-8">
                <p className="text-app-fg-muted">No media buyer data for {periodLabel}.</p>
              </div>
            );
          }

          const sortedSource = cardsSource != null
            ? [...cardsSource].sort((a, b) => {
                const aNew = newBuyerIds.has(a.mediaBuyerId) ? 1 : 0;
                const bNew = newBuyerIds.has(b.mediaBuyerId) ? 1 : 0;
                return bNew - aNew;
              })
            : null;

          return (
            <div
              ref={mediaBuyerScrollRef}
              className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
            >
              {sortedSource != null && sortedSource.map((buyer) => renderMediaBuyerLeaderboardCard(buyer, filters, 'shrink-0 w-48', newBuyerIds.has(buyer.mediaBuyerId)))}
              {balanceOnlySource != null && balanceOnlySource.map((row) => (
                <MediaBuyerBalanceCard key={row.userId} row={row} compact className="shrink-0 w-48" />
              ))}
            </div>
          );
        })()}
      </div>

    </div>
  );
}
