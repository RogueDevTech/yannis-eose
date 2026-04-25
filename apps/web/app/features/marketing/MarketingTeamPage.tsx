import { useState } from 'react';
import { Link } from '@remix-run/react';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { TeamViewToggle } from '~/components/ui/team-view-toggle';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Pagination } from '~/components/ui/pagination';
import { formatNaira } from '~/lib/format-amount';
import { MediaBuyerBalanceCard } from './MediaBuyerBalanceCard';
import type { FundingBalanceRow } from './types';

export interface MarketingTeamPageProps {
  teamMembers: FundingBalanceRow[];
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  leaderboardPeriod: 'this_month' | 'all_time';
  page?: number;
  totalPages?: number;
}

/** Build the query string to forward the active date filter to /admin/marketing/orders. */
function buildOrdersQuery(
  mediaBuyerId: string,
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean },
): string {
  const params = new URLSearchParams();
  params.set('mediaBuyerId', mediaBuyerId);
  if (dateFilters.periodAllTime) {
    params.set('period', 'all_time');
  } else {
    if (dateFilters.startDate) params.set('startDate', dateFilters.startDate);
    if (dateFilters.endDate) params.set('endDate', dateFilters.endDate);
  }
  return `/admin/marketing/orders?${params.toString()}`;
}

function memberInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function MarketingTeamPage({ teamMembers, fundingSummary, dateFilters, page = 1, totalPages = 1 }: MarketingTeamPageProps) {
  const [view, setView] = useState<'table' | 'grid'>('table');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Media buyers and funding balance — same cards as Live Activities"
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
          <DateFilterBar
            startDate={dateFilters.startDate}
            endDate={dateFilters.endDate}
            periodAllTime={dateFilters.periodAllTime}
          />
        </div>
        <p className="text-xs text-app-fg-muted">
          Confirmation and delivery rates use this range. Funding totals are lifetime.
        </p>
      </div>

      {/* Funding Summary */}
      <div className="card">
        <h2 className="text-lg font-semibold text-app-fg mb-3">Funding Summary</h2>
        <OverviewStatStrip
          embedded
          showScrollControls={false}
          items={[
            {
              label: 'Total Sent',
              value: <NairaPrice amount={parseFloat(fundingSummary.totalSent)} />,
              valueClassName: 'text-app-fg',
            },
            {
              label: 'Completed',
              value: <NairaPrice amount={parseFloat(fundingSummary.totalCompleted)} />,
              valueClassName: 'text-success-600 dark:text-success-400',
            },
            {
              label: 'Disputed',
              value: <NairaPrice amount={parseFloat(fundingSummary.totalDisputed)} />,
              valueClassName:
                parseFloat(fundingSummary.totalDisputed) > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-app-fg',
            },
          ]}
        />
      </div>

      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-app-fg">Team members</h2>
            <p className="text-sm text-app-fg-muted mt-0.5">
              Funding received (confirmed) minus approved ad spend
            </p>
          </div>
          {/* Toggle is desktop-only; mobile always uses the card grid */}
          {teamMembers.length > 0 && (
            <div className="hidden md:block">
              <TeamViewToggle value={view} onChange={setView} />
            </div>
          )}
        </div>

        {teamMembers.length === 0 ? (
          <div className="card">
            <EmptyState
              title="No team members yet"
              description="Manage staff from HR → Users."
            />
          </div>
        ) : (
          <>
            {/* Mobile: always render card grid (table is unusable on a narrow viewport) */}
            <div className="md:hidden grid grid-cols-1 gap-3">
              {teamMembers.map((m) => (
                <MediaBuyerBalanceCard key={m.userId} row={m} ordersDateFilters={dateFilters} />
              ))}
            </div>

            {/* Desktop: respect the table/grid toggle */}
            <div className="hidden md:block">
            {view === 'table' ? (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr>
                    <th className="table-header">Member</th>
                    <th className="table-header text-right">Balance</th>
                    <th className="table-header text-right">Received</th>
                    <th className="table-header text-right">Spent</th>
                    <th className="table-header text-right">Confirm %</th>
                    <th className="table-header text-right">Delivery %</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teamMembers.map((m) => (
                    <tr key={m.userId} className="table-row">
                      <td className="table-cell">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
                            <span className="text-xs font-bold text-brand-600 dark:text-brand-400">
                              {memberInitials(m.name)}
                            </span>
                          </div>
                          <Link
                            to={`/hr/users/${m.userId}`}
                            prefetch="intent"
                            className="font-medium text-app-fg truncate hover:text-brand-600 dark:hover:text-brand-400"
                          >
                            {m.name}
                          </Link>
                        </div>
                      </td>
                      <td className="table-cell text-right font-medium text-brand-600 dark:text-brand-400 whitespace-nowrap">
                        {formatNaira(Number(m.balance))}
                      </td>
                      <td className="table-cell text-right text-app-fg-muted whitespace-nowrap">
                        {formatNaira(Number(m.totalReceived))}
                      </td>
                      <td className="table-cell text-right text-app-fg-muted whitespace-nowrap">
                        {formatNaira(Number(m.totalSpend))}
                      </td>
                      <td className="table-cell text-right text-app-fg whitespace-nowrap">
                        {m.confirmationRate != null ? `${Math.round(m.confirmationRate)}%` : '\u2014'}
                      </td>
                      <td className="table-cell text-right text-app-fg whitespace-nowrap">
                        {m.deliveryRate != null ? `${Math.round(m.deliveryRate)}%` : '\u2014'}
                      </td>
                      <td className="table-cell">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={buildOrdersQuery(m.userId, dateFilters)}
                            prefetch="intent"
                            className="btn-primary btn-sm text-xs inline-flex items-center justify-center shrink-0"
                          >
                            View orders
                          </Link>
                          <Link
                            to={`/hr/users/${m.userId}`}
                            prefetch="intent"
                            className="btn-secondary btn-sm text-xs inline-flex items-center justify-center shrink-0"
                          >
                            View profile
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {teamMembers.map((m) => (
              <MediaBuyerBalanceCard key={m.userId} row={m} ordersDateFilters={dateFilters} />
            ))}
          </div>
            )}
            </div>

            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} pageParam="page" />
            )}
          </>
        )}
      </div>

      <div className="card">
        <p className="text-sm text-app-fg-muted">
          <Link to="/admin/marketing/overview" prefetch="intent" className="text-brand-500 hover:text-brand-600">
            Live Activities
          </Link>
          {' — '}dashboard with performance metrics.
        </p>
      </div>
    </div>
  );
}
