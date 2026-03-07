import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from '@remix-run/react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { HighCpaWarningBanner } from '~/features/marketing/HighCpaWarningBanner';
import { MediaBuyerBalanceCard } from '~/features/marketing/MediaBuyerBalanceCard';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Button } from '~/components/ui/button';
import { useLiveIndicator } from '~/hooks/useSocket';
import { formatNaira } from '~/lib/format-amount';
import { STATUS_COLORS, formatStatus } from '~/features/shared/order-status';
import type { LeaderboardEntry, Metrics, FundingBalanceRow, MarketingOverviewRecentOrder } from './types';

function renderMediaBuyerLeaderboardCard(
  buyer: LeaderboardEntry,
  balancesList: FundingBalanceRow[],
  className = ''
) {
  const isHighCpa = buyer.cpa > HIGH_CPA_THRESHOLD && buyer.totalOrders > 0;
  const roasColor = buyer.trueRoas >= 2
    ? 'text-success-600 dark:text-success-400'
    : buyer.trueRoas >= 1
      ? 'text-warning-600 dark:text-warning-400'
      : 'text-danger-600 dark:text-danger-400';
  const balanceRow = balancesList.find((b) => b.userId === buyer.mediaBuyerId);
  return (
    <div
      key={buyer.mediaBuyerId}
      className={`card ${isHighCpa ? 'ring-2 ring-warning-400 dark:ring-warning-500' : ''} ${className}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
            {buyer.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to={`/hr/users/${buyer.mediaBuyerId}`}
            prefetch="intent"
            className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate block hover:text-brand-600 dark:hover:text-brand-400"
          >
            {buyer.name}
          </Link>
          <p className="text-xs text-surface-800 dark:text-surface-200 truncate">
            {buyer.email}
          </p>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">Spend</span>
          <span className="font-medium">{formatNaira(Math.round(buyer.totalSpend))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">Orders</span>
          <span>{buyer.totalOrders}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">Delivered</span>
          <span className="text-success-600 dark:text-success-400">{buyer.deliveredOrders}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">Confirmed</span>
          <span className="text-success-600 dark:text-success-400">{buyer.confirmedOrders}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">CPA</span>
          <span className={isHighCpa ? 'font-medium text-danger-600 dark:text-danger-400' : ''}>
            {formatNaira(Math.round(buyer.cpa))}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">ROAS</span>
          <span className={`font-bold ${roasColor}`}>{buyer.trueRoas.toFixed(2)}x</span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">Del. Rate</span>
          <span>{buyer.deliveryRate.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-surface-700 dark:text-surface-300">Conf. Rate</span>
          <span>{buyer.confirmationRate.toFixed(1)}%</span>
        </div>
        {balanceRow != null && (
          <div className="flex justify-between pt-1 border-t border-surface-100 dark:border-surface-800">
            <span className="text-surface-700 dark:text-surface-300">Balance</span>
            <span className="font-medium text-brand-600 dark:text-brand-400">
              {formatNaira(Number(balanceRow.balance))}
            </span>
          </div>
        )}
      </div>
      <Link
        to={`/hr/users/${buyer.mediaBuyerId}`}
        prefetch="intent"
        className="mt-3 block text-center text-xs font-medium text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
      >
        View profile
      </Link>
    </div>
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
}

export function MarketingOverviewPage({
  metrics,
  leaderboard,
  balancesList = [],
  leaderboardPeriod = 'this_month',
  filters,
  liveEvents,
  recentOrders = [],
}: MarketingOverviewPageProps) {
  const liveState = useLiveIndicator(liveEvents ?? []);
  const [liveOrdersPage, setLiveOrdersPage] = useState(1);
  const pageSize = 5;
  const mediaBuyerScrollRef = useRef<HTMLDivElement>(null);
  const [viewAllMediaBuyersOpen, setViewAllMediaBuyersOpen] = useState(false);
  const [viewAllMediaBuyerPage, setViewAllMediaBuyerPage] = useState(1);
  const scrollMediaBuyerStrip = useCallback((delta: number) => {
    mediaBuyerScrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  }, []);
  const liveOrdersTotalPages = Math.max(1, Math.ceil(recentOrders.length / pageSize));
  const prevOrdersLengthRef = useRef(recentOrders.length);
  useEffect(() => {
    if (liveOrdersPage > liveOrdersTotalPages) setLiveOrdersPage(1);
  }, [recentOrders.length, liveOrdersTotalPages, liveOrdersPage]);
  // When new orders arrive (live update), show page 1 so the latest order is visible
  useEffect(() => {
    if (recentOrders.length > prevOrdersLengthRef.current) {
      setLiveOrdersPage(1);
    }
    prevOrdersLengthRef.current = recentOrders.length;
  }, [recentOrders.length]);
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

  const highCpaBuyers = leaderboard.filter(
    (b) => b.cpa > HIGH_CPA_THRESHOLD && b.totalOrders > 0,
  );

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Live Activities</h1>
          <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
            Manage media buyers, monitor team performance, and track funding
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

      {/* High CPA Alert Banner */}
      <HighCpaWarningBanner
        buyers={highCpaBuyers.map((b) => ({ mediaBuyerId: b.mediaBuyerId, name: b.name, cpa: b.cpa }))}
        threshold={HIGH_CPA_THRESHOLD}
      />

      {/* Stats strip — CS-style horizontal scroll */}
      <div className="card">
        <div className="flex flex-nowrap gap-3 overflow-x-auto pb-1">
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Media Buyers
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {leaderboard.length > 0 ? leaderboard.length : balancesList.filter((b) => b.role === 'MEDIA_BUYER').length}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Total Spend
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {formatNaira(Math.round(metrics.totalSpend))}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Total Orders
            </p>
            <p className="text-xl font-bold text-brand-600 dark:text-brand-400 mt-1">{metrics.totalOrders}</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Delivered
            </p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">{metrics.deliveredOrders}</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Confirmed
            </p>
            <p className="text-xl font-bold text-success-600 dark:text-success-400 mt-1">{metrics.confirmedOrders}</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Avg CPA
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {formatNaira(Math.round(avgCpa))}
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Delivery Rate
            </p>
            <p className={`text-xl font-bold mt-1 ${metrics.deliveryRate >= 70 ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
              {metrics.deliveryRate.toFixed(1)}%
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Confirmation Rate
            </p>
            <p className={`text-xl font-bold mt-1 ${metrics.confirmationRate >= 70 ? 'text-success-600 dark:text-success-400' : 'text-warning-600 dark:text-warning-400'}`}>
              {metrics.confirmationRate.toFixed(1)}%
            </p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              True ROAS
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">{metrics.trueRoas.toFixed(2)}x</p>
          </div>
          <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-surface-50 dark:bg-surface-800">
            <p className="text-xs font-medium text-surface-800 dark:text-surface-200 uppercase tracking-wider">
              Del. Revenue
            </p>
            <p className="text-xl font-bold text-surface-900 dark:text-white mt-1">
              {formatNaira(Math.round(metrics.deliveredRevenue))}
            </p>
          </div>
        </div>
      </div>

      {/* Live orders — paginated like CS Live activities (no scroll), View all link */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Live orders</h2>
            <p className="text-sm text-surface-700 dark:text-surface-300 mt-0.5">
              Recent orders — updates live when new orders arrive or status changes.
            </p>
          </div>
          <Link
            to="/admin/marketing/orders"
            className="btn-primary btn-sm shrink-0 inline-flex items-center justify-center"
          >
            View all
          </Link>
        </div>
        <div className="card p-0 overflow-hidden flex flex-col">
          {recentOrders.length === 0 ? (
            <div className="px-4 py-8 text-center text-surface-700 dark:text-surface-300">
              No recent orders
            </div>
          ) : (
            (() => {
              const totalPages = liveOrdersTotalPages;
              const page = Math.min(liveOrdersPage, totalPages);
              const start = (page - 1) * pageSize;
              const rows = recentOrders.slice(start, start + pageSize);
              return (
                <>
                  <div className="hidden md:flex flex-1 min-h-0 flex-col">
                    <div className="overflow-x-auto flex-1 min-h-0">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="h-10">
                            <th className="table-header text-left">Order</th>
                            <th className="table-header text-left">Customer</th>
                            <th className="table-header text-left">Status</th>
                            <th className="table-header text-right">Amount</th>
                            <th className="table-header text-left">Media Buyer</th>
                            <th className="table-header text-left">Created</th>
                            <th className="table-header text-center">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((order) => (
                            <tr key={order.id} className="table-row h-10">
                              <td className="table-cell">
                                <Link
                                  to={`/admin/orders/${order.id}`}
                                  className="text-brand-500 hover:text-brand-600 font-medium truncate block"
                                >
                                  {order.id.slice(0, 8)}...
                                </Link>
                              </td>
                              <td className="table-cell font-medium text-surface-900 dark:text-surface-100 truncate">
                                {order.customerName}
                              </td>
                              <td className="table-cell">
                                <span className={STATUS_COLORS[order.status] ?? 'badge'}>
                                  {formatStatus(order.status)}
                                </span>
                              </td>
                              <td className="table-cell text-right font-medium">
                                {order.totalAmount ? formatNaira(Number(order.totalAmount)) : '—'}
                              </td>
                              <td className="table-cell text-surface-800 dark:text-surface-200 truncate">
                                {order.mediaBuyerName ?? '—'}
                              </td>
                              <td className="table-cell text-surface-800 dark:text-surface-200 whitespace-nowrap">
                                {new Date(order.createdAt).toLocaleDateString('en-NG', {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </td>
                              <td className="table-cell text-center">
                                <Link
                                  to={`/admin/orders/${order.id}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/20 hover:bg-brand-100 dark:hover:bg-brand-900/30 transition-colors"
                                >
                                  View
                                </Link>
                              </td>
                            </tr>
                          ))}
                          {rows.length < pageSize &&
                            Array.from({ length: pageSize - rows.length }).map((_, i) => (
                              <tr key={`empty-${i}`} className="h-10" aria-hidden="true">
                                <td colSpan={7} className="table-cell border-b border-transparent" />
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-surface-100 dark:border-surface-800 shrink-0">
                      <span className="text-xs text-surface-600 dark:text-surface-400">
                        Page {page} of {totalPages}
                        {recentOrders.length > 0 && (
                          <span className="ml-1">
                            ({start + 1}–{Math.min(start + pageSize, recentOrders.length)} of {recentOrders.length})
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setLiveOrdersPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page >= totalPages}
                          onClick={() => setLiveOrdersPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="md:hidden flex flex-col flex-1 min-h-0">
                    <div className="flex-1 min-h-0 overflow-auto divide-y divide-surface-100 dark:divide-surface-800">
                      {rows.map((order) => (
                        <div key={order.id} className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <Link
                              to={`/admin/orders/${order.id}`}
                              className="text-brand-500 hover:text-brand-600 font-medium text-sm"
                            >
                              {order.customerName}
                            </Link>
                            <span className={STATUS_COLORS[order.status] ?? 'badge'}>{formatStatus(order.status)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm text-surface-800 dark:text-surface-200">
                            <span>{order.mediaBuyerName ?? '—'}</span>
                            <span className="font-medium">
                              {order.totalAmount ? formatNaira(Number(order.totalAmount)) : '—'}
                            </span>
                          </div>
                          <p className="text-xs text-surface-700 dark:text-surface-300">
                            {new Date(order.createdAt).toLocaleDateString('en-NG', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                          <Link
                            to={`/admin/orders/${order.id}`}
                            className="inline-flex text-xs font-medium text-brand-500 hover:text-brand-600"
                          >
                            View order
                          </Link>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-surface-100 dark:border-surface-800 shrink-0">
                      <span className="text-xs text-surface-600 dark:text-surface-400">
                        Page {page} of {totalPages}
                        {recentOrders.length > 0 && (
                          <span className="ml-1">
                            ({start + 1}–{Math.min(start + pageSize, recentOrders.length)} of {recentOrders.length})
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page <= 1}
                          onClick={() => setLiveOrdersPage((p) => Math.max(1, p - 1))}
                        >
                          Previous
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={page >= totalPages}
                          onClick={() => setLiveOrdersPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              );
            })()
          )}
        </div>
      </div>

      {/* Media Buyer Performance — horizontal scroll strip + View all modal */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Media Buyer Performance</h2>
            <p className="text-xs text-surface-700 dark:text-surface-300 mt-0.5">
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => scrollMediaBuyerStrip(-280)}
                  className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                  aria-label="Scroll left"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => scrollMediaBuyerStrip(280)}
                  className="p-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 text-surface-700 dark:text-surface-300 hover:bg-surface-50 dark:hover:bg-surface-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                  aria-label="Scroll right"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                <p className="text-surface-700 dark:text-surface-300">No media buyer data for {periodLabel}.</p>
              </div>
            );
          }

          return (
            <div
              ref={mediaBuyerScrollRef}
              className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden pb-1"
            >
              {cardsSource != null && cardsSource.map((buyer) => renderMediaBuyerLeaderboardCard(buyer, balancesList, 'shrink-0 w-64'))}
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
          ...(cardsSource ?? []).map((e) => ({ type: 'leaderboard' as const, data: e })),
          ...(balanceOnlySource ?? []).map((r) => ({ type: 'balance' as const, data: r })),
        ];
        const modalPageSize = 20;
        const totalPages = Math.max(1, Math.ceil(allItems.length / modalPageSize));
        const page = Math.min(viewAllMediaBuyerPage, totalPages);
        const start = (page - 1) * modalPageSize;
        const pageItems = allItems.slice(start, start + modalPageSize);

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => setViewAllMediaBuyersOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="view-all-media-buyers-title"
          >
            <div
              className="bg-white dark:bg-surface-900 rounded-xl shadow-xl max-w-4xl w-full max-h-[90dvh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-surface-100 dark:border-surface-800 shrink-0">
                <h2 id="view-all-media-buyers-title" className="text-lg font-semibold text-surface-900 dark:text-white">
                  Media Buyer Performance
                </h2>
                <button
                  type="button"
                  onClick={() => setViewAllMediaBuyersOpen(false)}
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
                  {allItems.length} media buyer{allItems.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex-1 min-h-0 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                  {pageItems.map((item) =>
                    item.type === 'leaderboard' ? (
                      <div key={item.data.mediaBuyerId}>{renderMediaBuyerLeaderboardCard(item.data, balancesList)}</div>
                    ) : (
                      <MediaBuyerBalanceCard key={item.data.userId} row={item.data} />
                    )
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-surface-100 dark:border-surface-800">
                  <span className="text-sm text-surface-600 dark:text-surface-400">
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
            </div>
          </div>
        );
      })()}

      {/* Team Management / Quick links */}
      <div className="card">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white mb-2">Team Management</h2>
        <p className="text-sm text-surface-800 dark:text-surface-200 mb-4">
          Send funding, manage campaigns, and view detailed performance.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/marketing/funding" prefetch="intent" className="btn-primary btn-sm">
            Funding & Ad Spend
          </Link>
          <Link to="/admin/marketing/leaderboard" prefetch="intent" className="btn-secondary btn-sm">
            Marketing Leaderboard
          </Link>
          <Link to="/admin/marketing/forms" prefetch="intent" className="btn-secondary btn-sm">
            Forms
          </Link>
        </div>
      </div>
    </div>
  );
}
