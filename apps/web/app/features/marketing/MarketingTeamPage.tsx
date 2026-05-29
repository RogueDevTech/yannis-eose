import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { CompactTable, type CompactTableColumn, CompactTableActionButton } from '~/components/ui/compact-table';
import { CompactUserAvatar } from '~/components/ui/compact-user-avatar';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { ClearFiltersButton } from '~/components/ui/clear-filters-button';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { EmptyState } from '~/components/ui/empty-state';
import { NairaPrice } from '~/components/ui/naira-price';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { SortMenu } from '~/components/ui/sort-menu';
import { SearchInput } from '~/components/ui/search-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { Pagination } from '~/components/ui/pagination';
import { ExportModal } from '~/components/ui/export-modal';
import { Modal } from '~/components/ui/modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { formatNaira } from '~/lib/format-amount';
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
  /**
   * Full team roster (id + name only) for the Media Buyer SearchableSelect.
   * Sourced from the pre-search team set so the dropdown shows every buyer,
   * even when `q` has already narrowed the visible rows.
   */
  allMembersForFilter?: Array<{ id: string; name: string }>;
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

/** Single compact stat tile — mirrors `CSTeamCompactStat` from Sales for visual parity. */
function MarketingTeamCompactStat({
  label,
  value,
  valueClassName = 'text-app-fg',
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-app-border bg-app-hover/40 px-2.5 py-2">
      <span className={['block text-sm font-semibold leading-none tabular-nums', valueClassName].filter(Boolean).join(' ')}>
        {value}
      </span>
      <span className="mt-1 block text-micro font-medium uppercase tracking-[0.14em] text-app-fg-muted">
        {label}
      </span>
    </div>
  );
}

/**
 * Media buyer peek card — visual mirror of `CSTeamMemberCard`.
 * Header + stacked stat-tile grids + actions row. Use `embedded` inside the
 * mobile peek modal (no outer card chrome); omit it for stand-alone use.
 */
function MarketingTeamMemberCard({
  member,
  dateFilters,
  greenThreshold,
  embedded,
}: {
  member: FundingBalanceRow;
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  greenThreshold: number;
  embedded?: boolean;
}) {
  const balance = Number(member.balance);
  const balanceToneClass =
    balance > 0
      ? 'text-success-600 dark:text-success-400'
      : balance < 0
        ? 'text-danger-600 dark:text-danger-400'
        : 'text-brand-600 dark:text-brand-400';
  const profitabilityToneClass =
    member.profitabilityScore != null && member.trueRoas != null
      ? member.trueRoas >= greenThreshold
        ? 'text-success-600 dark:text-success-400'
        : 'text-danger-600 dark:text-danger-400'
      : 'text-app-fg';

  return (
    <div className={embedded ? 'space-y-3' : 'card space-y-3'}>
      <div className="flex items-start gap-3">
        <CompactUserAvatar name={member.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-app-fg">{member.name}</p>
          <p className="truncate text-mini font-medium uppercase tracking-[0.14em] text-app-fg-muted">
            Media Buyer
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MarketingTeamCompactStat
          label="Balance"
          value={formatNaira(balance)}
          valueClassName={balanceToneClass}
        />
        <MarketingTeamCompactStat label="Received" value={formatNaira(Number(member.totalReceived))} />
        <MarketingTeamCompactStat label="Spent" value={formatNaira(Number(member.totalSpend))} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MarketingTeamCompactStat
          label="Orders"
          value={member.totalOrders != null ? member.totalOrders.toLocaleString() : '—'}
          valueClassName="text-brand-600 dark:text-brand-400"
        />
        <MarketingTeamCompactStat
          label="CPA"
          value={member.cpa != null ? formatNaira(member.cpa) : '—'}
        />
        <MarketingTeamCompactStat
          label="Profitability"
          value={member.profitabilityScore != null ? member.profitabilityScore.toFixed(1) : '—'}
          valueClassName={profitabilityToneClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MarketingTeamCompactStat
          label="Conf. rate"
          value={member.confirmationRate != null ? `${Math.round(member.confirmationRate)}%` : '—'}
          valueClassName={confirmationRateColorClass(member.confirmationRate)}
        />
        <MarketingTeamCompactStat
          label="Delivery rate"
          value={member.deliveryRate != null ? `${Math.round(member.deliveryRate)}%` : '—'}
          valueClassName={deliveryRateColorClass(member.deliveryRate)}
        />
      </div>

      <div className="border-t border-app-border pt-3">
        <div className="grid grid-cols-2 gap-2">
          <CompactTableActionButton
            to={buildOrdersQuery(member.userId, dateFilters)}
            className="w-full justify-center"
            tone="brand"
          >
            View orders
          </CompactTableActionButton>
          <CompactTableActionButton
            to={`/hr/users/${member.userId}`}
            className="w-full justify-center"
          >
            View profile
          </CompactTableActionButton>
        </div>
      </div>
    </div>
  );
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
  allMembersForFilter = [],
}: MarketingTeamPageProps) {
  const greenThreshold = profitabilityConfig.greenThreshold;
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(q);
  const [showExportModal, setShowExportModal] = useState(false);
  const [previewMember, setPreviewMember] = useState<FundingBalanceRow | null>(null);

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

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (searchParams.get('q')) n += 1;
    const sb = searchParams.get('sortBy');
    const sd = searchParams.get('sortDir');
    if ((sb && sb !== 'name') || (sd && sd !== 'asc')) n += 1;
    if (searchParams.get('startDate') || searchParams.get('endDate') || searchParams.get('period')) n += 1;
    return n;
  }, [searchParams]);

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
        key: 'cpa',
        header: 'CPA',
        align: 'right',
        nowrap: true,
        render: (m) => (m.cpa != null ? <NairaPrice amount={m.cpa} /> : '\u2014'),
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
        key: 'confirmed',
        header: 'Confirmed',
        align: 'right',
        nowrap: true,
        // confirmedOrders from the API is "confirmed or beyond" (includes delivered).
        // Display only the in-pipeline portion so the column doesn't overlap with Delivered.
        render: (m) => {
          if (m.confirmedOrders == null) return '\u2014';
          const inPipeline = m.confirmedOrders - (m.deliveredOrders ?? 0);
          return <span className="tabular-nums text-brand-600 dark:text-brand-400">{Math.max(0, inPipeline).toLocaleString()}</span>;
        },
      },
      {
        key: 'delivered',
        header: 'Delivered',
        align: 'right',
        nowrap: true,
        render: (m) =>
          m.deliveredOrders != null ? (
            <span className="tabular-nums text-success-600 dark:text-success-400">{m.deliveredOrders.toLocaleString()}</span>
          ) : (
            '\u2014'
          ),
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
                <PageRefreshButton />
                <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime} chrome="pill" />
                <Button type="button" variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                  Generate report
                </Button>
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
          className="mb-4 !border-0 !px-0 !py-0"
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
            <>
              {allMembersForFilter.length > 0 ? (
                <SearchableSelect
                  id="marketing-team-filter-buyer"
                  value={(() => {
                    const match = allMembersForFilter.find((m) => m.name === q);
                    return match ? match.id : 'ALL';
                  })()}
                  onChange={(v) => {
                    const picked = allMembersForFilter.find((m) => m.id === v);
                    // Picking a buyer drives the existing `q` filter to that exact
                    // name. "All" / clear resets `q`. Reuses the loader's name
                    // filter — no new URL param or backend change needed.
                    mergeListParams({ q: picked ? picked.name : '', page: 1 });
                  }}
                  options={[
                    { value: 'ALL', label: 'All media buyers' },
                    ...allMembersForFilter.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                  placeholder="All media buyers"
                  searchPlaceholder="Search buyers…"
                  wrapperClassName="w-auto min-w-[12rem] sm:w-56"
                />
              ) : null}
              <SortMenu
                value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
                onChange={(next) =>
                  mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
                }
                defaultValue={{ sortBy: 'name', sortDir: 'asc' }}
                options={TEAM_SORT_MENU_OPTIONS}
              />
            </>
          }
          sheetFilterBody={
            <div className="flex flex-col gap-3">
              {allMembersForFilter.length > 0 ? (
                <SearchableSelect
                  id="marketing-team-filter-buyer-sheet"
                  value={(() => {
                    const match = allMembersForFilter.find((m) => m.name === q);
                    return match ? match.id : 'ALL';
                  })()}
                  onChange={(v) => {
                    const picked = allMembersForFilter.find((m) => m.id === v);
                    mergeListParams({ q: picked ? picked.name : '', page: 1 });
                  }}
                  options={[
                    { value: 'ALL', label: 'All media buyers' },
                    ...allMembersForFilter.map((m) => ({ value: m.id, label: m.name })),
                  ]}
                  placeholder="All media buyers"
                  searchPlaceholder="Search buyers…"
                  controlSize="lg"
                  triggerClassName="!bg-app-hover text-center"
                  wrapperClassName="w-full"
                />
              ) : null}
              <SortMenu
                value={{ sortBy: sortByFromLoader, sortDir: sortDirFromLoader }}
                onChange={(next) =>
                  mergeListParams({ sortBy: next.sortBy, sortDir: next.sortDir, page: 1 })
                }
                defaultValue={{ sortBy: 'name', sortDir: 'asc' }}
                options={TEAM_SORT_MENU_OPTIONS}
                className="w-full justify-center"
              />
            </div>
          }
        />
        <ClearFiltersButton count={activeFilterCount} preserve={['perPage']} className="mt-2" />

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
            <CompactTable
              columns={teamColumns}
              rows={teamMembers}
              rowKey={(m) => m.userId}
              className="md:min-w-[960px]"
              renderMobileCard={(m) => {
                const initials = m.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <button
                    type="button"
                    onClick={() => setPreviewMember(m)}
                    className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
                  >
                    {/* Row 1: avatar + name + balance */}
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-brand-600 dark:text-brand-400">{initials}</span>
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-fg">{m.name}</span>
                      <span className="shrink-0 text-sm font-medium text-brand-600 dark:text-brand-400 tabular-nums">
                        {formatNaira(Number(m.balance))}
                      </span>
                    </div>
                    {/* Row 2: orders + confirmed + delivered + CR% + DR% */}
                    <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums pl-[calc(1.75rem+0.625rem)] flex-wrap">
                      {m.totalOrders != null && <span>{m.totalOrders.toLocaleString()} orders</span>}
                      {m.confirmedOrders != null && <span>{m.confirmedOrders.toLocaleString()} conf</span>}
                      {m.deliveredOrders != null && <span>{m.deliveredOrders.toLocaleString()} del</span>}
                      {m.confirmationRate != null && (
                        <span className={confirmationRateColorClass(m.confirmationRate)}>
                          CR {Math.round(m.confirmationRate)}%
                        </span>
                      )}
                      {m.deliveryRate != null && (
                        <span className={deliveryRateColorClass(m.deliveryRate)}>
                          DR {Math.round(m.deliveryRate)}%
                        </span>
                      )}
                    </div>
                  </button>
                );
              }}
            />

            {totalPages > 1 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <p className="text-sm text-app-fg-muted">
                  {totalCount > 0
                    ? `Showing ${(page - 1) * (limit ?? 0) + 1}–${Math.min(page * (limit ?? totalCount), totalCount)} of ${totalCount} ${totalCount === 1 ? 'member' : 'members'}`
                    : 'No members'}
                </p>
                <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Mobile peek modal — full media-buyer detail + actions, mirrors Sales pattern */}
      <Modal
        open={!!previewMember}
        onClose={() => setPreviewMember(null)}
        maxWidth="max-w-sm"
        contentClassName="p-4"
      >
        {previewMember && (
          <MarketingTeamMemberCard
            member={previewMember}
            dateFilters={dateFilters}
            greenThreshold={greenThreshold}
            embedded
          />
        )}
      </Modal>
    </div>
  );
}
