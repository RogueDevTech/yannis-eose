import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { CompactTable, type CompactTableColumn, CompactTableActionButton } from '~/components/ui/compact-table';
import { CompactUserAvatar } from '~/components/ui/compact-user-avatar';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { SortMenu } from '~/components/ui/sort-menu';
import { SearchInput } from '~/components/ui/search-input';
import { Pagination } from '~/components/ui/pagination';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { formatNaira } from '~/lib/format-amount';
import { MediaBuyerBalanceCard } from './MediaBuyerBalanceCard';
import type { FundingBalanceRow, MarketingTeamOverviewStats } from './types';
import {
  confirmationRateColorClass,
  deliveryRateColorClass,
} from '~/lib/rate-color';

export interface MarketingTeamPageProps {
  teamMembers: FundingBalanceRow[];
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string };
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  leaderboardPeriod: 'this_month' | 'all_time';
  page?: number;
  totalPages?: number;
  /** URL-driven rows-per-page — feeds the `<Pagination>` per-page picker. */
  limit?: number;
  totalCount?: number;
  unfilteredCount?: number;
  q?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Org-wide profitability thresholds — colors the Profitability column. */
  profitabilityConfig?: { targetRoas: number; greenThreshold: number };
  overviewStats: MarketingTeamOverviewStats;
}

/** Green if trueRoas ≥ green threshold, red below. Neutral when no spend/data. */
function profitabilityCellColorClass(
  row: FundingBalanceRow,
  greenThreshold: number,
): string {
  if (row.profitabilityScore == null || row.trueRoas == null) return 'text-app-fg';
  return row.trueRoas >= greenThreshold
    ? 'text-success-600 dark:text-success-400 font-semibold'
    : 'text-danger-600 dark:text-danger-400 font-semibold';
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

/** SortMenu options for the marketing team list — names use A→Z vocab, numerics use Highest/Lowest. */
const TEAM_SORT_MENU_OPTIONS = [
  {
    value: 'name',
    label: 'Name',
    ascLabel: 'A → Z',
    descLabel: 'Z → A',
    defaultDir: 'asc' as const,
  },
  {
    value: 'balance',
    label: 'Balance',
    description: 'Total received minus approved ad spend.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'received',
    label: 'Received',
    description: 'Funding the buyer has been allocated.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'spent',
    label: 'Ad spend',
    description: 'Approved ad spend in the period.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'orders',
    label: 'Orders',
    description: 'Orders created in the period (by created date).',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'cpa',
    label: 'CPA',
    description: 'Cost per order created.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'asc' as const,
  },
  {
    value: 'profitability',
    label: 'Profitability',
    description: 'True profit attributable to this buyer.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'confirm',
    label: 'Confirm %',
    description: 'Share of orders confirmed by CS.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'delivery',
    label: 'Delivery %',
    description: 'Share of confirmed orders that were delivered.',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
];

export function MarketingTeamPage({
  teamMembers,
  fundingSummary,
  dateFilters,
  page = 1,
  totalPages = 1,
  limit,
  totalCount = 0,
  unfilteredCount = 0,
  q = '',
  sortBy: sortByFromLoader = 'name',
  sortDir: sortDirFromLoader = 'asc',
  profitabilityConfig = { targetRoas: 3, greenThreshold: 2.5 },
  overviewStats,
}: MarketingTeamPageProps) {
  const greenThreshold = profitabilityConfig.greenThreshold;
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(q);
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    setSearchQuery(q);
  }, [q]);

  const mergeListParams = (overrides: {
    q?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    page?: number;
  }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.q !== undefined) {
      const trimmed = overrides.q.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
    }
    if (overrides.sortBy !== undefined) params.set('sortBy', overrides.sortBy);
    if (overrides.sortDir !== undefined) params.set('sortDir', overrides.sortDir);
    if (overrides.page !== undefined) {
      if (overrides.page <= 1) params.delete('page');
      else params.set('page', String(overrides.page));
    }
    setSearchParams(params);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mergeListParams({ q: searchQuery, page: 1 });
  };

  const showSearchEmpty = unfilteredCount > 0 && teamMembers.length === 0;

  const teamToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (sortByFromLoader !== 'name') n += 1;
    if (sortDirFromLoader !== 'asc') n += 1;
    return n;
  }, [sortByFromLoader, sortDirFromLoader]);

  const teamColumns = useMemo((): CompactTableColumn<FundingBalanceRow>[] => {
    return [
      {
        key: 'member',
        header: 'Member',
        render: (m) => (
          <Link
            to={`/hr/users/${m.userId}`}
            prefetch="intent"
            className="inline-flex items-center gap-2.5 min-w-0 font-medium text-app-fg hover:text-brand-600 dark:hover:text-brand-400"
          >
            <CompactUserAvatar name={m.name} />
            <span className="truncate">{m.name}</span>
          </Link>
        ),
      },
      {
        key: 'balance',
        header: 'Balance',
        align: 'right',
        nowrap: true,
        render: (m) => (
          <span className="font-medium text-brand-600 dark:text-brand-400">{formatNaira(Number(m.balance))}</span>
        ),
      },
      {
        key: 'received',
        header: 'Received',
        align: 'right',
        nowrap: true,
        render: (m) => <span className="text-app-fg-muted">{formatNaira(Number(m.totalReceived))}</span>,
      },
      {
        key: 'spent',
        header: 'Spent',
        align: 'right',
        nowrap: true,
        render: (m) => <span className="text-app-fg-muted">{formatNaira(Number(m.totalSpend))}</span>,
      },
      {
        key: 'orders',
        header: 'Orders',
        align: 'right',
        nowrap: true,
        render: (m) =>
          m.totalOrders != null ? (
            <Link
              to={buildOrdersQuery(m.userId, dateFilters)}
              className="tabular-nums text-app-fg hover:text-brand-600 dark:hover:text-brand-400 underline-offset-2 hover:underline"
            >
              {m.totalOrders.toLocaleString()}
            </Link>
          ) : (
            '\u2014'
          ),
      },
      {
        key: 'cpa',
        header: 'CPA',
        align: 'right',
        nowrap: true,
        render: (m) => (m.cpa != null ? <NairaPrice amount={m.cpa} /> : '\u2014'),
      },
      {
        key: 'profitability',
        header: 'Profitability',
        align: 'right',
        nowrap: true,
        cellClassName: (m) => profitabilityCellColorClass(m, greenThreshold),
        cellTitle: (m) =>
          m.profitabilityScore != null && m.trueRoas != null
            ? `True ROAS ${m.trueRoas.toFixed(2)}x · target ${profitabilityConfig.targetRoas}x · green ≥ ${greenThreshold}x`
            : undefined,
        render: (m) => (m.profitabilityScore != null ? m.profitabilityScore.toFixed(1) : '\u2014'),
      },
      {
        key: 'confirm',
        header: 'Confirm %',
        align: 'right',
        nowrap: true,
        cellClassName: (m) => confirmationRateColorClass(m.confirmationRate),
        render: (m) => (m.confirmationRate != null ? `${Math.round(m.confirmationRate)}%` : '\u2014'),
      },
      {
        key: 'delivery',
        header: 'Delivery %',
        align: 'right',
        nowrap: true,
        cellClassName: (m) => deliveryRateColorClass(m.deliveryRate),
        render: (m) => (m.deliveryRate != null ? `${Math.round(m.deliveryRate)}%` : '\u2014'),
      },
      {
        key: 'actions',
        header: 'Actions',
        align: 'right',
        tight: true,
        nowrap: true,
        minWidth: 'min-w-[12rem]',
        mobileShowLabel: false,
        render: (m) => (
          <div className="inline-flex flex-nowrap items-center justify-end gap-1.5 shrink-0">
            <CompactTableActionButton to={buildOrdersQuery(m.userId, dateFilters)} tone="brand">
              View orders
            </CompactTableActionButton>
            <CompactTableActionButton
              to={`/hr/users/${m.userId}`}
              className="!text-app-fg-muted hover:!text-brand-500 dark:hover:!text-brand-400"
            >
              View profile
            </CompactTableActionButton>
          </div>
        ),
      },
    ];
  }, [dateFilters, greenThreshold, profitabilityConfig.targetRoas]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team Analysis"
        mobileInlineActions
        description="View media buyer performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Team analysis tools"
            sheetSubtitle={<span>Date range, sort and export</span>}
            triggerAriaLabel="Team analysis toolbar and date range"
            filtersBadgeCount={teamToolbarFilterBadge}
            filters={
              <SortMenu
                value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
                onChange={(next) =>
                  mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
                }
                defaultValue={{ sortBy: 'name', sortDir: 'asc' }}
                options={TEAM_SORT_MENU_OPTIONS}
                className="w-full justify-center"
              />
            }
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                  Generate report
                </Button>
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full justify-center"
                onClick={() => {
                  closeSheet();
                  setShowExportModal(true);
                }}
              >
                Generate report
              </Button>
            )}
          />
        }
      />

      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={dateFilters.periodAllTime}
      />

      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.marketing_team}
        initialFilters={
          dateFilters.periodAllTime
            ? { periodAllTime: true as const }
            : dateFilters.startDate && dateFilters.endDate
              ? { startDate: dateFilters.startDate, endDate: dateFilters.endDate }
              : {}
        }
      />

      <OverviewStatStrip
        mobileGrid
        showScrollControls={false}
        items={[
          {
            label: 'Team members',
            value: overviewStats.teamMembers.toLocaleString(),
            valueClassName: 'text-app-fg',
          },
          {
            label: 'Total orders',
            value: overviewStats.totalOrders.toLocaleString(),
            valueClassName: 'text-app-fg',
          },
          {
            label: 'Avg confirmation %',
            value:
              overviewStats.averageConfirmationRate != null
                ? `${Math.round(overviewStats.averageConfirmationRate)}%`
                : '\u2014',
            valueClassName: confirmationRateColorClass(overviewStats.averageConfirmationRate),
          },
          {
            label: 'Avg delivery %',
            value:
              overviewStats.averageDeliveryRate != null
                ? `${Math.round(overviewStats.averageDeliveryRate)}%`
                : '\u2014',
            valueClassName: deliveryRateColorClass(overviewStats.averageDeliveryRate),
          },
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

      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 px-0 py-0"
          hideMobileSheet
          badgeCount={teamToolbarFilterBadge}
          sheetSubtitle={<span>Sort options apply immediately</span>}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex w-full min-w-0 gap-2 md:flex-1">
              <SearchInput
                value={searchQuery}
                onChange={(v) => setSearchQuery(v)}
                placeholder="Search by name or role…"
                withSubmitButton
                wrapperClassName="w-full min-w-0 flex-1"
                className="bg-white dark:bg-app-elevated"
                name="q"
                autoComplete="off"
              />
            </form>
          }
          desktopInlineFilters={
            <SortMenu
              value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
              onChange={(next) =>
                mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
              }
              defaultValue={{ sortBy: 'name', sortDir: 'asc' }}
              options={TEAM_SORT_MENU_OPTIONS}
            />
          }
          sheetFilterBody={
            <SortMenu
              value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
              onChange={(next) =>
                mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
              }
              defaultValue={{ sortBy: 'name', sortDir: 'asc' }}
              options={TEAM_SORT_MENU_OPTIONS}
              className="w-full justify-center"
            />
          }
        />

        {totalCount > 0 && (q || sortByFromLoader !== 'name' || sortDirFromLoader !== 'asc') && (
          <p className="text-xs text-app-fg-muted mb-3" aria-live="polite">
            {totalCount} member{totalCount === 1 ? '' : 's'}
            {q ? ` matching "${q}"` : ''}
          </p>
        )}

        {teamMembers.length === 0 && !showSearchEmpty ? (
          <div className="card">
            <EmptyState
              title="No team members yet"
              description="Manage staff from HR → Users."
            />
          </div>
        ) : showSearchEmpty ? (
          <div className="card">
            <EmptyState
              title="No matching team members"
              description="Try a different name, role, or clear the search field."
            />
          </div>
        ) : (
          <>
            {/* Mobile: always render card grid (table is unusable on a narrow viewport) */}
            <div className="md:hidden grid grid-cols-1 gap-3">
              {teamMembers.map((m) => (
                <MediaBuyerBalanceCard
                  key={m.userId}
                  row={m}
                  ordersDateFilters={dateFilters}
                  profitabilityGreenThreshold={greenThreshold}
                />
              ))}
            </div>

            {/* Desktop: table view (Grid toggle removed per CEO directive 2026-04-26 — the
                grid duplicated the mobile card layout for desktop with no extra info). */}
            <div className="hidden md:block">
              <CompactTable
                columns={teamColumns}
                rows={teamMembers}
                rowKey={(m) => m.userId}
                className="min-w-[960px]"
              />
            </div>

            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} align="end" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
