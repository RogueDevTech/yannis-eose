import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { CompactTable, CompactTableActionButton, type CompactTableColumn } from '~/components/ui/compact-table';
import { TableRowActionsSheet } from '~/components/ui/table-row-actions-sheet';
import { CompactUserAvatar } from '~/components/ui/compact-user-avatar';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
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
import { SupervisorBadge } from '~/components/ui/supervisor-badge';
import type { FundingBalanceRow, MarketingTeamOverviewStats } from './types';
import {
  confirmationRateColorClass,
  deliveryRateColorClass,
} from '~/lib/rate-color';

export interface MarketingTeamPageProps {
  teamMembers: FundingBalanceRow[];
  fundingSummary: { totalSent: string; totalCompleted: string; totalDisputed: string; sentCount: number; completedCount: number; disputedCount: number };
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
  /** Cart order per-status counts — only DELIVERED/REMITTED count toward marketing total. */
  cartOrdersCounts?: Record<string, number>;
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
    balance < 0
      ? 'text-danger-600 dark:text-danger-400'
      : balance < 50000
        ? 'text-danger-600 dark:text-danger-400'
        : 'text-success-600 dark:text-success-400';
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

      <div className="grid grid-cols-2 gap-2">
        <MarketingTeamCompactStat
          label="Balance"
          value={formatNaira(balance)}
          valueClassName={balanceToneClass}
        />
        <MarketingTeamCompactStat label="Received" value={formatNaira(Number(member.totalReceived))} />
        <MarketingTeamCompactStat label="Total Spent" value={formatNaira(Number(member.totalSpend))} />
        <MarketingTeamCompactStat
          label="Distributed"
          value={Number(member.totalDistributed) > 0 ? formatNaira(Number(member.totalDistributed)) : '—'}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MarketingTeamCompactStat
          label="Ad Spend"
          value={member.adSpend != null ? formatNaira(member.adSpend) : '—'}
        />
        <MarketingTeamCompactStat
          label="CPA"
          value={member.cpa != null ? formatNaira(member.cpa) : '—'}
        />
        <MarketingTeamCompactStat
          label="Orders"
          value={member.totalOrders != null ? member.totalOrders.toLocaleString() : '—'}
          valueClassName="text-brand-600 dark:text-brand-400"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MarketingTeamCompactStat
          label="Profitability"
          value={member.profitabilityScore != null ? member.profitabilityScore.toFixed(1) : '—'}
          valueClassName={profitabilityToneClass}
        />
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
        <div className="grid grid-cols-3 gap-2">
          <CompactTableActionButton
            to={buildOrdersQuery(member.userId, dateFilters)}
            className="w-full justify-center"
            tone="brand"
          >
            Orders
          </CompactTableActionButton>
          <CompactTableActionButton
            to={`/admin/marketing/funding/ledger?userId=${member.userId}${dateFilters.periodAllTime ? '&period=all_time' : dateFilters.startDate && dateFilters.endDate ? `&startDate=${dateFilters.startDate}&endDate=${dateFilters.endDate}` : ''}`}
            className="w-full justify-center"
          >
            Ledger
          </CompactTableActionButton>
          <CompactTableActionButton
            to={`/hr/users/${member.userId}`}
            className="w-full justify-center"
          >
            Profile
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
    label: 'Total Spent',
    description: 'All expense categories (ad spend + operational).',
    ascLabel: 'Lowest first',
    descLabel: 'Highest first',
    defaultDir: 'desc' as const,
  },
  {
    value: 'adSpend',
    label: 'Ad Spend',
    description: 'Approved ad spend only (drives CPA).',
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

function StatInfoIcon({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }}
      className="ml-1 inline-flex items-center justify-center rounded-full text-app-fg-muted hover:text-app-fg transition-colors"
      aria-label="View breakdown"
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
      </svg>
    </button>
  );
}

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
  cartOrdersCounts,
}: MarketingTeamPageProps) {
  const greenThreshold = profitabilityConfig.greenThreshold;
  const cartGraduatedDelivered = (cartOrdersCounts?.['DELIVERED'] ?? 0) + (cartOrdersCounts?.['REMITTED'] ?? 0);
  const totalOrdersWithCart = overviewStats.totalOrders + cartGraduatedDelivered;
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(q);
  const [showExportModal, setShowExportModal] = useState(false);
  const [previewMember, setPreviewMember] = useState<FundingBalanceRow | null>(null);
  const [breakdownModal, setBreakdownModal] = useState(false);

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
            className="inline-flex items-center gap-1.5 min-w-0 font-medium text-app-fg hover:text-brand-600 dark:hover:text-brand-400"
          >
            <span className="truncate">{m.name}</span>
            {m.role === 'HEAD_OF_MARKETING' && (
              <span className="shrink-0 rounded-full bg-purple-100 dark:bg-purple-900/30 px-2 py-0.5 text-micro font-semibold text-purple-700 dark:text-purple-300">HoM</span>
            )}
            {m.isTeamSupervisor && <SupervisorBadge size="sm" />}
            {m.userStatus === 'INACTIVE' && (
              <span className="shrink-0 rounded-full bg-danger-100 dark:bg-danger-900/30 px-2 py-0.5 text-micro font-semibold text-danger-700 dark:text-danger-300">Inactive</span>
            )}
          </Link>
        ),
      },
      {
        key: 'balance',
        header: 'Balance',
        align: 'right',
        nowrap: true,
        render: (m) => {
          const bal = Number(m.balance);
          const cls = bal < 50000
            ? 'font-medium text-danger-600 dark:text-danger-400'
            : 'font-medium text-brand-600 dark:text-brand-400';
          return <span className={cls}>{formatNaira(bal)}</span>;
        },
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
        header: 'Total Spent',
        align: 'right',
        nowrap: true,
        render: (m) => <span className="text-app-fg-muted">{formatNaira(Number(m.totalSpend))}</span>,
      },
      {
        key: 'distributed',
        header: 'Distributed',
        align: 'right',
        nowrap: true,
        render: (m) => {
          const dist = Number(m.totalDistributed);
          return dist > 0
            ? <span className="text-app-fg-muted">{formatNaira(dist)}</span>
            : <span className="text-app-fg-muted">—</span>;
        },
      },
      {
        key: 'adSpend',
        header: 'Ad Spend',
        align: 'right',
        nowrap: true,
        render: (m) => m.adSpend != null ? <span className="text-app-fg-muted">{formatNaira(m.adSpend)}</span> : '\u2014',
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
        render: (m) => {
          if (m.confirmedOrders == null && m.confirmationRate == null) return '\u2014';
          const inPipeline = m.confirmedOrders != null ? m.confirmedOrders - (m.deliveredOrders ?? 0) : null;
          return (
            <span className="tabular-nums">
              {inPipeline != null && <span className="text-brand-600 dark:text-brand-400">{Math.max(0, inPipeline).toLocaleString()}</span>}
              {inPipeline != null && m.confirmationRate != null && <span className="text-app-fg-muted mx-0.5">·</span>}
              {m.confirmationRate != null && <span className={confirmationRateColorClass(m.confirmationRate)}>{Math.round(m.confirmationRate)}%</span>}
            </span>
          );
        },
      },
      {
        key: 'delivered',
        header: 'Delivered',
        align: 'right',
        nowrap: true,
        render: (m) => {
          if (m.deliveredOrders == null && m.deliveryRate == null) return '\u2014';
          return (
            <span className="tabular-nums">
              {m.deliveredOrders != null && <span className="text-success-600 dark:text-success-400">{m.deliveredOrders.toLocaleString()}</span>}
              {m.deliveredOrders != null && m.deliveryRate != null && <span className="text-app-fg-muted mx-0.5">·</span>}
              {m.deliveryRate != null && <span className={deliveryRateColorClass(m.deliveryRate)}>{Math.round(m.deliveryRate)}%</span>}
            </span>
          );
        },
      },
      {
        key: 'profitability',
        header: 'Profit',
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
        key: 'actions',
        header: '',
        align: 'right',
        tight: true,
        nowrap: true,
        mobileShowLabel: false,
        render: (m) => (
          <TableRowActionsSheet
            ariaLabel={`Actions for ${m.name}`}
            sheetTitle={m.name}
            actions={[
              {
                key: 'orders',
                kind: 'link',
                label: 'Orders',
                to: buildOrdersQuery(m.userId, dateFilters),
              },
              {
                key: 'ledger',
                kind: 'link',
                label: 'Ledger',
                to: `/admin/marketing/funding/ledger?userId=${m.userId}${dateFilters.periodAllTime ? '&period=all_time' : dateFilters.startDate && dateFilters.endDate ? `&startDate=${dateFilters.startDate}&endDate=${dateFilters.endDate}` : ''}`,
              },
              {
                key: 'expenses',
                kind: 'link',
                label: 'Expenses',
                to: `/admin/marketing/expenses?mediaBuyerId=${m.userId}${dateFilters.periodAllTime ? '&period=all_time' : dateFilters.startDate && dateFilters.endDate ? `&startDate=${dateFilters.startDate}&endDate=${dateFilters.endDate}` : ''}`,
              },
              {
                key: 'profile',
                kind: 'link',
                label: 'Profile',
                to: `/hr/users/${m.userId}`,
              },
            ]}
          />
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
            sheetTitle="Actions"
            triggerAriaLabel="Team analysis toolbar and date range"
            saveFilterKey
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
                className="h-12 w-full justify-center"
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
            label: `Team Members`,
            value: overviewStats.teamMembers.toLocaleString(),
            valueClassName: 'text-app-fg',
          },
          {
            label: <span className="flex items-center">Total Orders<StatInfoIcon onClick={() => setBreakdownModal(true)} /></span>,
            value: totalOrdersWithCart.toLocaleString(),
            valueClassName: 'text-app-fg',
          },
          {
            label: 'Avg Confirmation %',
            value:
              overviewStats.averageConfirmationRate != null
                ? `${Math.round(overviewStats.averageConfirmationRate)}%`
                : '\u2014',
            valueClassName: confirmationRateColorClass(overviewStats.averageConfirmationRate),
          },
          {
            label: 'Avg Delivery %',
            value:
              overviewStats.averageDeliveryRate != null
                ? `${Math.round(overviewStats.averageDeliveryRate)}%`
                : '\u2014',
            valueClassName: deliveryRateColorClass(overviewStats.averageDeliveryRate),
          },
          {
            label: 'Total Ad Spend',
            value: <NairaPrice amount={overviewStats.totalAdSpend} />,
            valueClassName: overviewStats.totalAdSpend > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-app-fg',
            title: 'Sum of ad spend across all media buyers in this period',
          },
          {
            label: 'Avg CPA',
            value: overviewStats.avgCpa > 0 ? <NairaPrice amount={Math.round(overviewStats.avgCpa)} /> : '\u2014',
            valueClassName: 'text-app-fg',
            title: `Total ad spend ÷ total orders = ₦${Math.round(overviewStats.avgCpa).toLocaleString()}`,
          },
          {
            label: 'MB Unspent Balance (all-time)',
            value: <NairaPrice amount={overviewStats.mbUnspentBalance} />,
            valueClassName: overviewStats.mbUnspentBalance > 0
              ? 'text-blue-600 dark:text-blue-400'
              : overviewStats.mbUnspentBalance < 0
                ? 'text-danger-600 dark:text-danger-400'
                : 'text-app-fg',
            title: 'Cumulative unspent funding across all media buyers (received − ad spend − distributed)',
          },
        ]}
      />
      <Modal open={breakdownModal} onClose={() => setBreakdownModal(false)} maxWidth="max-w-sm" contentClassName="p-5">
        <h2 className="text-base font-semibold text-app-fg mb-3">Order Breakdown</h2>
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-4 py-1.5">
            <span className="text-sm text-app-fg">Active media buyers</span>
            <span className="text-sm tabular-nums text-app-fg">{overviewStats.activeOrders.toLocaleString()}</span>
          </div>
          {overviewStats.inactiveOrders > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <span className="text-sm text-app-fg">Inactive media buyers</span>
              <span className="text-sm tabular-nums text-app-fg">{overviewStats.inactiveOrders.toLocaleString()}</span>
            </div>
          )}
          {cartGraduatedDelivered > 0 && (
            <div className="flex items-center justify-between gap-4 py-1.5">
              <span className="text-sm text-app-fg">Delivered cart orders</span>
              <span className="text-sm tabular-nums text-app-fg">{cartGraduatedDelivered.toLocaleString()}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-1.5 font-semibold border-t border-app-border pt-2.5 mt-1">
            <span className="text-sm text-app-fg">Total</span>
            <span className="text-sm tabular-nums text-app-fg">{totalOrdersWithCart.toLocaleString()}</span>
          </div>
        </div>
      </Modal>

      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 !px-0 !py-0"
          hideMobileSheet
          badgeCount={teamToolbarFilterBadge}
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
                <div className="relative">
                  {!!q && (
                    <FilterDismiss onClear={() => mergeListParams({ q: '', page: 1 })} />
                  )}
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
                </div>
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
                <div className="relative">
                  {!!q && (
                    <FilterDismiss onClear={() => mergeListParams({ q: '', page: 1 })} />
                  )}
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
                </div>
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
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-fg">
                        {m.name}
                        {m.userStatus === 'INACTIVE' && (
                          <span className="ml-1.5 inline-flex rounded-full bg-danger-100 dark:bg-danger-900/30 px-1.5 py-0.5 text-micro font-semibold text-danger-700 dark:text-danger-300 align-middle">Inactive</span>
                        )}
                      </span>
                      <span className={`shrink-0 text-sm font-medium tabular-nums ${Number(m.balance) < 50000 ? 'text-danger-600 dark:text-danger-400' : 'text-brand-600 dark:text-brand-400'}`}>
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
                <Pagination page={page} totalPages={totalPages} pageParam="page" pageSize={limit} pageSizeParam="perPage" />
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
