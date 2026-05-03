import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MediaBuyerBalanceCard } from '~/features/marketing/MediaBuyerBalanceCard';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { LiveActivityCard, LiveActivityDetailModal } from '~/components/ui/live-activity-card';
import { useLiveIndicator, useSocketEvent } from '~/hooks/useSocket';
import { formatNaira } from '~/lib/format-amount';
import { STATUS_COLORS, formatStatus } from '~/features/shared/order-status';
import type { LeaderboardEntry, Metrics, FundingBalanceRow, MarketingOverviewRecentOrder } from './types';
import type { LiveActivityItem } from '~/features/cs/types';

function renderMediaBuyerLeaderboardCard(
  buyer: LeaderboardEntry,
  balancesList: FundingBalanceRow[],
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
      to={`/admin/marketing/orders?mediaBuyerId=${buyer.mediaBuyerId}`}
      prefetch="intent"
      className={`card block transition-all duration-200 cursor-pointer ${isHighCpa ? 'ring-2 ring-warning-400 dark:ring-warning-500' : ''} ${newClass} ${className}`}
      title={`View ${buyer.name}'s orders`}
    >
      {/* Avatar + name */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{initials}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-app-fg truncate">{buyer.name}</p>
          <p className="text-xs text-app-fg-muted">
            {buyer.totalOrders} order{buyer.totalOrders !== 1 ? 's' : ''} · {buyer.deliveredOrders} delivered
          </p>
        </div>
      </div>

      {/* ROAS progress bar */}
      <div className="w-full h-2 bg-app-hover rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${roasBarWidth}%` }}
        />
      </div>

      {/* ROAS label + High CPA tag */}
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-app-fg-muted">
          ROAS <span className={`font-bold ${roasTextColor}`}>{buyer.trueRoas.toFixed(2)}x</span>
        </span>
        {isHighCpa && (
          <span className="text-xs font-medium text-danger-600 dark:text-danger-400">HIGH CPA</span>
        )}
      </div>

      {/* NEW ORDER flash */}
      {isNew && (
        <div className="mt-2 pt-2 border-t border-success-200 dark:border-success-800/50 flex items-center gap-1.5">
          <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
            NEW ORDER
          </span>
        </div>
      )}
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

  const statsScrollRef = useRef<HTMLDivElement>(null);
  const mediaBuyerScrollRef = useRef<HTMLDivElement>(null);
  const [viewAllMediaBuyersOpen, setViewAllMediaBuyersOpen] = useState(false);
  const [viewAllMediaBuyerPage, setViewAllMediaBuyerPage] = useState(1);

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
  const scrollStatsStrip = useCallback((delta: number) => {
    statsScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const scrollMediaBuyerStrip = useCallback((delta: number) => {
    mediaBuyerScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
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
  useEffect(() => {
    if (viewAllMediaBuyersOpen) setViewAllMediaBuyerPage(1);
  }, [viewAllMediaBuyersOpen]);
  useEffect(() => {
    if (!viewAllMediaBuyersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewAllMediaBuyersOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewAllMediaBuyersOpen]);
  const periodLabel = leaderboardPeriod === 'all_time'
    ? 'all time'
    : (filters?.startDate && filters?.endDate)
      ? `${filters.startDate} – ${filters.endDate}`
      : 'this month';
  const avgCpa = leaderboard.length > 0
    ? leaderboard.reduce((sum, b) => sum + b.cpa, 0) / leaderboard.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-app-fg">Live Activities</h1>
          <p className="text-sm text-app-fg-muted mt-0.5">
            Manage media buyers, monitor team performance, and track funding
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
        <div className="flex flex-wrap items-center gap-3">
          <PageRefreshButton />
          {liveEvents != null && liveEvents.length > 0 && (
            <LiveIndicator isConnected={liveState.isConnected} showGreen={liveState.showGreen} />
          )}
          <DateFilterBar
            startDate={filters?.startDate ?? ''}
            endDate={filters?.endDate ?? ''}
            periodAllTime={filters?.periodAllTime ?? false}
          />
        </div>
      </div>

      {/* Stats strip — arrows sit in-line on the right (matches the CS queue layout). */}
      <div className="card">
        <div className="flex items-center gap-2 min-w-0">
          <div ref={statsScrollRef} className="flex flex-1 min-w-0 flex-nowrap gap-3 overflow-x-auto scrollbar-hide pb-1">
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Total Spend
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">
              {formatNaira(Math.round(metrics.totalSpend))}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Total Orders
            </p>
            <p className="text-xl font-bold text-brand-600 dark:text-brand-400 mt-1">{metrics.totalOrders}</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Delivered
            </p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">{metrics.deliveredOrders}</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Confirmed
            </p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">{metrics.confirmedOrders}</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Avg CPA
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">
              {formatNaira(Math.round(avgCpa))}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Delivery Rate
            </p>
            <p className={`text-xl font-bold mt-1 ${metrics.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
              {metrics.deliveryRate.toFixed(1)}%
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Confirmation Rate
            </p>
            <p className={`text-xl font-bold mt-1 ${metrics.confirmationRate >= 70 ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
              {metrics.confirmationRate.toFixed(1)}%
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              True ROAS
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">{metrics.trueRoas.toFixed(2)}x</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover">
            <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">
              Del. Revenue
            </p>
            <p className="text-xl font-bold text-app-fg mt-1">
              {formatNaira(Math.round(metrics.deliveredRevenue))}
            </p>
          </div>
          </div>
          {/* Scroll arrows — placed in-line on the right next to the strip (CS queue layout). */}
          <div className="hidden md:flex shrink-0 items-center gap-0.5 sm:gap-1.5 self-center">
            <button
              type="button"
              onClick={() => scrollStatsStrip(-280)}
              className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
              aria-label="Scroll stats left"
            >
              <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => scrollStatsStrip(280)}
              className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center"
              aria-label="Scroll stats right"
            >
              <svg className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

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
                  <span className="animate-new-badge inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
                    {highlightedIds.size} updated
                  </span>
                )}
              </h2>
              <p className="text-xs text-app-fg-muted mt-0.5">
                {localOrders.length} orders · updates instantly
              </p>
            </div>
          </div>
          <Link
            to="/admin/marketing/orders"
            className="btn-primary btn-sm shrink-0 inline-flex items-center justify-center"
          >
            View all
          </Link>
        </div>
        {localOrders.length === 0 ? (
          <div className="rounded-xl border border-app-border bg-app-elevated flex flex-col items-center justify-center py-12 gap-2">
            <span className="h-3 w-3 rounded-full bg-app-border animate-pulse" />
            <p className="text-sm text-app-fg-muted">Waiting for orders…</p>
          </div>
        ) : (
          (() => {
            const totalPages = liveOrdersTotalPages;
            const page = Math.min(liveOrdersPage, totalPages);
            const start = (page - 1) * pageSize;
            const rows = localOrders.slice(start, start + pageSize);
            return (
              <>
                {/* Card grid — same density as the CS Live Activities cards. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {rows.map((order) => {
                    const isHighlighted = highlightedIds.has(order.id);
                    const statusBadge = STATUS_COLORS[order.status] ?? 'badge';
                    return (
                      <Link
                        key={order.id}
                        to={`/admin/orders/${order.id}`}
                        prefetch="intent"
                        className={`
                          group relative block rounded-xl border transition-all duration-200 cursor-pointer
                          ${isHighlighted
                            ? 'animate-slide-in-up border-success-400 dark:border-success-500 bg-gradient-to-br from-success-50 to-white dark:from-success-900/20 dark:to-surface-800 shadow-md'
                            : 'bg-app-elevated border-app-border hover:shadow-md hover:border-brand-300 dark:hover:border-brand-700'
                          }
                          ${isHighlighted ? 'row-new-highlight' : ''}
                          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                        `}
                      >
                        {/* Live dot */}
                        <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                          {isHighlighted ? (
                            <>
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success-500" />
                            </>
                          ) : (
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-app-border" />
                          )}
                        </span>

                        <div className="p-3.5 pr-8">
                          {/* Status pill */}
                          <div className="mb-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${statusBadge}`}>
                              {formatStatus(order.status)}
                            </span>
                          </div>

                          {/* Customer name */}
                          <div className="mb-2">
                            <p className="text-sm font-semibold text-app-fg truncate leading-tight">
                              {order.customerName}
                            </p>
                          </div>

                          {/* Media buyer pill */}
                          <div className="mb-1.5 min-w-0">
                            <span className="inline-flex max-w-full items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-app-hover text-app-fg-muted">
                              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                              </svg>
                              <span className="truncate min-w-0">{order.mediaBuyerName ?? 'No media buyer'}</span>
                            </span>
                          </div>

                          {/* Amount — own line for uniform card height */}
                          <div className="mb-2 text-[11px] font-bold text-app-fg">
                            {order.totalAmount ? formatNaira(Number(order.totalAmount)) : '—'}
                          </div>

                          {/* Timestamp */}
                          <div className="text-[11px] font-medium text-app-fg-muted">
                            {new Date(order.createdAt).toLocaleString('en-NG', {
                              weekday: 'short', month: 'short', day: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </div>

                          {/* LIVE flash */}
                          {isHighlighted && (
                            <div className="mt-2 pt-2 border-t flex items-center gap-1.5 border-success-200 dark:border-success-800/50">
                              <span className="animate-new-badge inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-success-500 text-white">
                                LIVE
                              </span>
                              <span className="text-[11px] text-success-600 dark:text-success-400">
                                Just received
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Hover arrow */}
                        <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                          <svg className="w-3.5 h-3.5 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Pagination footer */}
                <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-app-border">
                  <span className="text-xs text-app-fg-muted">
                    {start + 1}–{Math.min(start + pageSize, localOrders.length)} of {localOrders.length} orders
                  </span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setLiveOrdersPage((p) => Math.max(1, p - 1))}>
                      ← Newer
                    </Button>
                    <Button type="button" variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setLiveOrdersPage((p) => Math.min(totalPages, p + 1))}>
                      Older →
                    </Button>
                  </div>
                </div>
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
                <Button type="button" variant="secondary" size="sm" onClick={() => setViewAllMediaBuyersOpen(true)}>
                  View all
                </Button>
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
              {sortedSource != null && sortedSource.map((buyer) => renderMediaBuyerLeaderboardCard(buyer, balancesList, 'shrink-0 w-64', newBuyerIds.has(buyer.mediaBuyerId)))}
              {balanceOnlySource != null && balanceOnlySource.map((row) => (
                <MediaBuyerBalanceCard key={row.userId} row={row} className="shrink-0 w-64" />
              ))}
            </div>
          );
        })()}
      </div>

      {/* View all Media Buyer Performance modal — 20 per page, Prev/Next */}
      {viewAllMediaBuyersOpen && (() => {
        const teamFromBalances = balancesList.filter((b) => b.role === 'MEDIA_BUYER');
        const hasLeaderboard = leaderboard.length > 0;
        const showCardsFromBalances = !hasLeaderboard && teamFromBalances.length > 0;
        const cardsSource = hasLeaderboard ? leaderboard : null;
        const balanceOnlySource = showCardsFromBalances ? teamFromBalances : null;
        type CardItem = { type: 'leaderboard'; data: import('./types').LeaderboardEntry } | { type: 'balance'; data: import('./types').FundingBalanceRow };
        const allItems: CardItem[] = [
          ...(cardsSource ?? [])
            .slice()
            .sort((a, b) => (newBuyerIds.has(b.mediaBuyerId) ? 1 : 0) - (newBuyerIds.has(a.mediaBuyerId) ? 1 : 0))
            .map((e) => ({ type: 'leaderboard' as const, data: e })),
          ...(balanceOnlySource ?? []).map((r) => ({ type: 'balance' as const, data: r })),
        ];
        const modalPageSize = 20;
        const totalPages = Math.max(1, Math.ceil(allItems.length / modalPageSize));
        const page = Math.min(viewAllMediaBuyerPage, totalPages);
        const start = (page - 1) * modalPageSize;
        const pageItems = allItems.slice(start, start + modalPageSize);

        return (
          <Modal
            open
            onClose={() => setViewAllMediaBuyersOpen(false)}
            maxWidth="max-w-4xl"
            role="dialog"
            aria-labelledby="view-all-media-buyers-title"
            contentClassName="p-0 max-h-[90dvh] overflow-hidden flex flex-col"
          >
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-app-border shrink-0">
                <h2 id="view-all-media-buyers-title" className="text-lg font-semibold text-app-fg">
                  Media Buyer Performance
                </h2>
                <button
                  type="button"
                  onClick={() => setViewAllMediaBuyersOpen(false)}
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
                  {allItems.length} media buyer{allItems.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                  {pageItems.map((item) =>
                    item.type === 'leaderboard' ? (
                      <div key={item.data.mediaBuyerId}>{renderMediaBuyerLeaderboardCard(item.data, balancesList, '', newBuyerIds.has(item.data.mediaBuyerId))}</div>
                    ) : (
                      <MediaBuyerBalanceCard key={item.data.userId} row={item.data} />
                    )
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-app-border">
                  <span className="text-sm text-app-fg-muted">
                    Page {page} of {totalPages}
                    {allItems.length > 0 && (
                      <span className="ml-1">
                        ({start + 1}–{Math.min(start + modalPageSize, allItems.length)} of {allItems.length})
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setViewAllMediaBuyerPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setViewAllMediaBuyerPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
          </Modal>
        );
      })()}

    </div>
  );
}
