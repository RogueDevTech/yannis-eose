import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { PageHeader } from '~/components/ui/page-header';
import { formatRoleLabel } from '~/components/ui/role-badge';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { FilterDismiss } from '~/components/ui/filter-dismiss';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { Button } from '~/components/ui/button';
import { ExportModal } from '~/components/ui/export-modal';
import { Modal } from '~/components/ui/modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { CompactUserAvatar } from '~/components/ui/compact-user-avatar';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import { SortMenu, type SortMenuOption, type SortMenuValue } from '~/components/ui/sort-menu';
import type { CSTeamMemberOverview } from './types';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';
import {
  confirmationRateColorClass,
  deliveryRateColorClass,
  formatRate,
} from '~/lib/rate-color';

export interface CSTeamPageProps {
  teamMembers: CSTeamMemberOverview[];
  summary: {
    agentCount: number;
    totalPending: number;
    engagedTotal: number;
    confirmedTotal: number;
    deliveredTotal: number;
    cancelledTotal: number;
    callsMadeTotal: number;
    avgCallDuration: number | null;
    confirmationRate: number | null;
    deliveryRate: number | null;
  };
  page?: number;
  totalPages?: number;
  totalCount?: number;
  unfilteredCount?: number;
  q?: string;
  activityFilter?: string;
  backlogFilter?: string;
  sort?: string;
  /** Date filter from URL — controls the leaderboard window for order counts. */
  dateFilters?: { startDate: string; endDate: string; periodAllTime: boolean };
}

const CS_ACTIVITY_OPTIONS = [
  { value: 'ALL', label: 'All activity' },
  { value: 'ACTIVE', label: 'Active only' },
  { value: 'IDLE', label: 'Idle only' },
];

const CS_BACKLOG_OPTIONS = [
  { value: 'ALL', label: 'All backlog' },
  { value: 'HAS_PENDING', label: 'Has pending' },
  { value: 'NO_PENDING', label: 'No pending' },
];

const CS_SORT_MENU_OPTIONS: SortMenuOption[] = [
  { value: 'total', label: 'Total orders', description: 'Orders assigned to the closer.', defaultDir: 'desc', ascLabel: 'Lowest first', descLabel: 'Highest first' },
  { value: 'confirmed', label: 'Confirmed', description: 'Orders the closer confirmed.', defaultDir: 'desc', ascLabel: 'Lowest first', descLabel: 'Highest first' },
  { value: 'delivered', label: 'Delivered', description: 'Orders delivered.', defaultDir: 'desc', ascLabel: 'Lowest first', descLabel: 'Highest first' },
  { value: 'calls', label: 'Calls made', defaultDir: 'desc', ascLabel: 'Fewest first', descLabel: 'Most first' },
  { value: 'conf-rate', label: 'Confirmation rate', defaultDir: 'desc', ascLabel: 'Lowest first', descLabel: 'Highest first' },
  { value: 'delivery-rate', label: 'Delivery rate', defaultDir: 'desc', ascLabel: 'Lowest first', descLabel: 'Highest first' },
  { value: 'backlog', label: 'Backlog', description: 'Pending orders in queue.', defaultDir: 'desc', ascLabel: 'Lowest first', descLabel: 'Highest first' },
  { value: 'name', label: 'Name', defaultDir: 'asc', ascLabel: 'A → Z', descLabel: 'Z → A' },
];
const CS_SORT_DEFAULT: SortMenuValue = { sortBy: 'total', sortDir: 'desc' };

function formatLastActive(lastActionAt: string | null): string {
  if (!lastActionAt) return '—';
  const d = new Date(lastActionAt);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function csRoleLabel(role: string): string {
  return role === 'CS_CLOSER' ? 'Closer' : formatRoleLabel(role);
}

function formatCallDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function CSTeamCompactStat({
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
      <span className={['block text-sm font-semibold leading-none', valueClassName].filter(Boolean).join(' ')}>
        {value}
      </span>
      <span className="mt-1 block text-micro font-medium uppercase tracking-[0.14em] text-app-fg-muted">
        {label}
      </span>
    </div>
  );
}

function CSTeamMemberCard({ member, embedded }: { member: CSTeamMemberOverview; embedded?: boolean }) {
  const isAgent = member.role === 'CS_CLOSER';
  const workload = member.workload;
  const leaderboard = member.leaderboardEntry;
  const roleLabel = csRoleLabel(member.role);
  const dailyPct =
    workload && workload.capacity > 0 ? ((workload.todayClosesCount ?? 0) / workload.capacity) * 100 : 0;
  const progressPct = Math.min(dailyPct, 100);
  const dutyToneClass =
    dailyPct >= 100
      ? 'text-success-600 dark:text-success-400'
      : dailyPct >= 70
        ? 'text-warning-600 dark:text-warning-400'
        : 'text-brand-600 dark:text-brand-400';
  const progressBarClass =
    dailyPct >= 100 ? 'bg-success-500' : dailyPct >= 70 ? 'bg-warning-500' : 'bg-brand-500';
  const activityValue = member.isIdle ? 'Idle' : workload ? formatLastActive(workload.lastActionAt) : '—';
  const activityToneClass = member.isIdle ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg';

  return (
    <div className={embedded ? 'space-y-3' : 'card space-y-3'}>
      <div className="flex items-start gap-3">
        <CompactUserAvatar name={member.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-app-fg">{member.name}</p>
              <p className="truncate text-mini font-medium uppercase tracking-[0.14em] text-app-fg-muted">
                {roleLabel}
              </p>
            </div>
            {isAgent && member.isIdle && (
              <span className="shrink-0 rounded-full bg-warning-500/10 px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-300">
                Idle
              </span>
            )}
          </div>
          <div className="mt-1.5">
            <UserBranchBadges branches={member.branchMemberships} compact />
          </div>
        </div>
      </div>

      {isAgent && workload && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-3 gap-2">
            <CSTeamCompactStat
              label="Duty"
              value={`${workload.todayClosesCount ?? 0}/${workload.capacity}`}
              valueClassName={dutyToneClass}
            />
            <CSTeamCompactStat label="Backlog" value={workload.pendingCount} />
            <CSTeamCompactStat label={member.isIdle ? 'Status' : 'Active'} value={activityValue} valueClassName={activityToneClass} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-mini font-medium text-app-fg-muted">
              <span>Lagos duty</span>
              <span className={dutyToneClass}>{Math.round(progressPct)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-app-hover">
              <div
                className={`h-full rounded-full transition-all duration-300 ${progressBarClass}`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          {leaderboard && (() => {
            const pending = Math.max(0, leaderboard.ordersEngaged - leaderboard.ordersConfirmed);
            return (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <CSTeamCompactStat label="Total" value={leaderboard.ordersEngaged} valueClassName="text-brand-600 dark:text-brand-400" />
                  <CSTeamCompactStat
                    label="Pending"
                    value={pending}
                    valueClassName={pending > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg'}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <CSTeamCompactStat label="Confirmed" value={leaderboard.ordersConfirmed} />
                  <CSTeamCompactStat label="Delivered" value={leaderboard.ordersDelivered} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <CSTeamCompactStat label="Calls" value={leaderboard.callsMade} />
                  <CSTeamCompactStat label="Avg call" value={formatCallDuration(leaderboard.avgCallDurationSeconds)} />
                </div>
              </>
            );
          })()}
          {leaderboard && (
            <div className="grid grid-cols-2 gap-2">
              <CSTeamCompactStat
                label="Conf. rate"
                value={formatRate(leaderboard.confirmationRate)}
                valueClassName={confirmationRateColorClass(leaderboard.confirmationRate)}
              />
              <CSTeamCompactStat
                label="Delivery rate"
                value={formatRate(leaderboard.deliveryRate)}
                valueClassName={deliveryRateColorClass(leaderboard.deliveryRate)}
              />
            </div>
          )}
        </div>
      )}

      <div className="border-t border-app-border pt-3">
        <div className="grid grid-cols-2 gap-2">
          <CompactTableActionButton
            to={`/admin/sales/orders?csCloserId=${member.id}&period=all_time`}
            className="w-full justify-center"
          >
            View orders
          </CompactTableActionButton>
          <CompactTableActionButton to={`/hr/users/${member.id}`} className="w-full justify-center">
            View profile
          </CompactTableActionButton>
        </div>
      </div>
    </div>
  );
}

export function CSTeamPage({
  teamMembers,
  summary,
  page = 1,
  totalPages = 1,
  totalCount = 0,
  unfilteredCount = 0,
  q = '',
  activityFilter = 'ALL',
  backlogFilter = 'ALL',
  sort = 'total-desc',
  dateFilters,
}: CSTeamPageProps) {
  // Parse flat sort string (e.g. "total-desc") into SortMenu value
  const sortMenuValue = useMemo((): SortMenuValue => {
    if (sort === 'name') return { sortBy: 'name', sortDir: 'asc' };
    const lastDash = sort.lastIndexOf('-');
    if (lastDash === -1) return CS_SORT_DEFAULT;
    const sortBy = sort.substring(0, lastDash);
    const sortDir = sort.substring(lastDash + 1) as 'asc' | 'desc';
    return { sortBy, sortDir: sortDir === 'asc' || sortDir === 'desc' ? sortDir : 'desc' };
  }, [sort]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [peekMember, setPeekMember] = useState<CSTeamMemberOverview | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(q);

  useEffect(() => {
    setSearchQuery(q);
  }, [q]);

  const mergeListParams = (overrides: {
    q?: string;
    activity?: string;
    backlog?: string;
    sort?: string;
    page?: number;
  }) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (overrides.q !== undefined) {
          const trimmed = overrides.q.trim();
          if (trimmed) params.set('q', trimmed);
          else params.delete('q');
        }
        if (overrides.activity !== undefined) {
          if (overrides.activity === 'ALL') params.delete('activity');
          else params.set('activity', overrides.activity);
        }
        if (overrides.backlog !== undefined) {
          if (overrides.backlog === 'ALL') params.delete('backlog');
          else params.set('backlog', overrides.backlog);
        }
        if (overrides.sort !== undefined) {
          if (overrides.sort === 'total-desc') params.delete('sort');
          else params.set('sort', overrides.sort);
        }
        if (overrides.page !== undefined) {
          if (overrides.page <= 1) params.delete('page');
          else params.set('page', String(overrides.page));
        }
        return params;
      },
      { replace: true },
    );
  };

  const handleSearchSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    mergeListParams({ q: searchQuery, page: 1 });
  };

  const handleSortChange = (next: SortMenuValue) => {
    const flat = next.sortBy === 'name' && next.sortDir === 'asc' ? 'name' : `${next.sortBy}-${next.sortDir}`;
    mergeListParams({ sort: flat, page: 1 });
  };

  /** Mirrors `mergeListParams` but returns a `?query` string for `<Link to>`. */
  const buildListQuery = (overrides: { activity?: string; backlog?: string; page?: number }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.activity !== undefined) {
      if (overrides.activity === 'ALL') params.delete('activity');
      else params.set('activity', overrides.activity);
    }
    if (overrides.backlog !== undefined) {
      if (overrides.backlog === 'ALL') params.delete('backlog');
      else params.set('backlog', overrides.backlog);
    }
    if (overrides.page !== undefined) {
      if (overrides.page <= 1) params.delete('page');
      else params.set('page', String(overrides.page));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '?';
  };

  const filtersBadgeCount = useMemo(() => {
    let count = 0;
    if (activityFilter !== 'ALL') count += 1;
    if (backlogFilter !== 'ALL') count += 1;
    if (sort !== 'total-desc') count += 1;
    return count;
  }, [activityFilter, backlogFilter, sort]);

  const showFilteredEmpty = unfilteredCount > 0 && totalCount === 0;
  const hasActiveFilters = q.length > 0 || activityFilter !== 'ALL' || backlogFilter !== 'ALL';

  const teamColumns = useMemo<CompactTableColumn<CSTeamMemberOverview>[]>(
    () => [
      {
        key: 'member',
        header: 'Member',
        render: (member) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <CompactUserAvatar name={member.name} />
            <span className="font-medium text-app-fg truncate">{member.name}</span>
          </div>
        ),
      },
      {
        key: 'workload',
        header: 'Workload',
        nowrap: true,
        render: (member) => {
          const isAgent = member.role === 'CS_CLOSER';
          const workload = member.workload;
          const dailyPct =
            workload && workload.capacity > 0 ? ((workload.todayClosesCount ?? 0) / workload.capacity) * 100 : 0;
          return isAgent && workload ? (
            <span className="text-sm text-app-fg">
              <span className={`font-medium ${dailyPct >= 100 ? 'text-success-600 dark:text-success-400' : 'text-app-fg'}`}>
                {workload.todayClosesCount ?? 0}/{workload.capacity}
              </span>
              <span className="text-app-fg-muted font-normal"> duty · </span>
              <span className="font-medium text-app-fg-muted">{workload.pendingCount}</span>
              <span className="text-app-fg-muted font-normal"> backlog</span>
            </span>
          ) : (
            <span className="text-sm text-app-fg-muted">{'\u2014'}</span>
          );
        },
      },
      {
        key: 'totalOrders',
        header: 'Total',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          return lb ? (
            <span className="text-sm font-semibold text-brand-600 dark:text-brand-400 tabular-nums">{lb.ordersEngaged}</span>
          ) : (
            '\u2014'
          );
        },
      },
      {
        key: 'pending',
        header: 'Pending',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          if (!lb) return '\u2014';
          // engaged = all orders assigned (DELETED excluded); confirmed = confirmed-or-beyond.
          // Pending is the unworked-or-in-conversation backlog (UNPROCESSED + CS_ASSIGNED + CS_ENGAGED).
          // Surfacing it here makes Total = Pending + Confirmed visible at a glance.
          const pending = Math.max(0, lb.ordersEngaged - lb.ordersConfirmed);
          return (
            <span className={`text-sm font-medium tabular-nums ${pending > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg-muted'}`}>
              {pending}
            </span>
          );
        },
      },
      {
        key: 'confirmed',
        header: 'Confirmed',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          return lb ? (
            <span className="text-sm font-medium text-app-fg tabular-nums">{lb.ordersConfirmed}</span>
          ) : (
            '\u2014'
          );
        },
      },
      {
        key: 'delivered',
        header: 'Delivered',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          return lb ? (
            <span className="text-sm font-medium text-app-fg tabular-nums">{lb.ordersDelivered}</span>
          ) : (
            '\u2014'
          );
        },
      },
      {
        key: 'calls',
        header: 'Calls',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          return lb ? (
            <span className="text-sm font-medium text-app-fg tabular-nums">{lb.callsMade}</span>
          ) : (
            '\u2014'
          );
        },
      },
      {
        key: 'confRate',
        header: 'Conf. rate',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          return lb ? (
            <span className={`text-sm font-medium tabular-nums ${confirmationRateColorClass(lb.confirmationRate)}`}>
              {formatRate(lb.confirmationRate)}
            </span>
          ) : (
            '\u2014'
          );
        },
      },
      {
        key: 'deliveryRate',
        header: 'Delivery rate',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          return lb ? (
            <span className={`text-sm font-medium tabular-nums ${deliveryRateColorClass(lb.deliveryRate)}`}>
              {formatRate(lb.deliveryRate)}
            </span>
          ) : (
            '\u2014'
          );
        },
      },
      {
        key: 'actions',
        header: 'Actions',
        tight: true,
        render: (member) => (
          <div className="inline-flex items-center gap-1.5">
            <CompactTableActionButton to={`/admin/sales/orders?csCloserId=${member.id}&period=all_time`}>
              View orders
            </CompactTableActionButton>
            <CompactTableActionButton to={`/hr/users/${member.id}`}>View profile</CompactTableActionButton>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team Analysis"
        mobileInlineActions
        description="View closer workload and performance."
        actions={
          dateFilters ? (
            <PageHeaderMobileTools
              sheetTitle="Actions"
              triggerAriaLabel="Sales team toolbar and date range"
              filtersBadgeCount={filtersBadgeCount}
              filters={
                <>
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <FormSelect
                      value={activityFilter}
                      onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                      options={CS_ACTIVITY_OPTIONS}
                      className="!bg-transparent !border-transparent !text-center"
                      controlSize="sm"
                      openAs="modal"
                      wrapperClassName="w-full"
                    />
                  </div>
                  <div className="relative flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5">
                    <FormSelect
                      value={backlogFilter}
                      onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                      options={CS_BACKLOG_OPTIONS}
                      className="!bg-transparent !border-transparent !text-center"
                      controlSize="sm"
                      openAs="modal"
                      wrapperClassName="w-full"
                    />
                  </div>
                  <div className="relative">
                    {sort !== 'total-desc' && (
                      <FilterDismiss onClear={() => mergeListParams({ sort: 'total-desc', page: 1 })} />
                    )}
                    <SortMenu
                      value={sortMenuValue}
                      onChange={handleSortChange}
                      options={CS_SORT_MENU_OPTIONS}
                      defaultValue={CS_SORT_DEFAULT}
                    />
                  </div>
                </>
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
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <Button type="button" variant="secondary" size="sm" onClick={() => setShowExportModal(true)}>
                Generate report
              </Button>
              <PageRefreshButton />
            </div>
          )
        }
      />

      {dateFilters ? (
        <MobileDateFilterRow
          startDate={dateFilters.startDate}
          endDate={dateFilters.endDate}
          periodAllTime={dateFilters.periodAllTime}
        />
      ) : null}

      <ExportModal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        config={EXPORT_CONFIGS.cs_team}
        initialFilters={
          dateFilters
            ? dateFilters.periodAllTime
              ? { periodAllTime: true as const }
              : dateFilters.startDate && dateFilters.endDate
                ? { startDate: dateFilters.startDate, endDate: dateFilters.endDate }
                : {}
            : {}
        }
      />

      {unfilteredCount > 0 && (
        <OverviewStatStrip
          mobileGrid
          items={[
            {
              label: 'Closers',
              value: summary.agentCount.toString(),
              valueClassName: 'text-app-fg',
            },
            {
              label: 'Total orders',
              value: summary.engagedTotal.toString(),
              valueClassName: 'text-brand-600 dark:text-brand-400',
              title: 'Total orders assigned to the team in this period',
            },
            {
              label: 'Backlog (unworked)',
              value: summary.totalPending.toString(),
              valueClassName: summary.totalPending > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
              title: 'Orders assigned to closers but not yet engaged or confirmed',
            },
            {
              label: 'Confirmed',
              value: summary.confirmedTotal.toString(),
              valueClassName: 'text-app-fg',
              title: 'Total orders the team confirmed in this period',
            },
            {
              label: 'Delivered',
              value: summary.deliveredTotal.toString(),
              valueClassName: 'text-success-600 dark:text-success-400',
              title: 'Total orders attributed to the team that were delivered',
            },
            {
              label: 'Confirm rate',
              value: formatRate(summary.confirmationRate),
              valueClassName: confirmationRateColorClass(summary.confirmationRate),
              title: 'Confirmed ÷ Engaged across the whole team in this period',
            },
            {
              label: 'Delivery rate',
              value: formatRate(summary.deliveryRate),
              valueClassName: deliveryRateColorClass(summary.deliveryRate),
              title: 'Delivered ÷ Engaged across the whole team in this period',
            },
            {
              label: 'Calls made',
              value: summary.callsMadeTotal.toString(),
              valueClassName: 'text-app-fg',
              title: 'Total calls made by the team in this period',
            },
            {
              label: 'Avg call',
              value: formatCallDuration(summary.avgCallDuration),
              valueClassName: 'text-app-fg',
              title: 'Average call duration across the team',
            },
          ]}
        />
      )}

      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 !px-0 !py-0"
          hideMobileSheet
          badgeCount={filtersBadgeCount}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                value={searchQuery}
                onChange={(value) => {
                  setSearchQuery(value);
                  if (value === '' && q.length > 0) mergeListParams({ q: '', page: 1 });
                }}
                placeholder="Search by closer, role, or branch…"
                withSubmitButton
                wrapperClassName="min-w-0 flex-1"
                name="q"
                autoComplete="off"
              />
            </form>
          }
          desktopInlineFilters={
            <>
              <div className="relative">
                {activityFilter !== 'ALL' && (
                  <FilterDismiss onClear={() => mergeListParams({ activity: 'ALL', page: 1 })} />
                )}
                <FormSelect
                  value={activityFilter}
                  onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                  options={CS_ACTIVITY_OPTIONS}
                  wrapperClassName="w-full min-w-0 sm:w-44"
                />
              </div>
              <div className="relative">
                {backlogFilter !== 'ALL' && (
                  <FilterDismiss onClear={() => mergeListParams({ backlog: 'ALL', page: 1 })} />
                )}
                <FormSelect
                  value={backlogFilter}
                  onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                  options={CS_BACKLOG_OPTIONS}
                  wrapperClassName="w-full min-w-0 sm:w-44"
                />
              </div>
              <div className="relative">
                {sort !== 'total-desc' && (
                  <FilterDismiss onClear={() => mergeListParams({ sort: 'total-desc', page: 1 })} />
                )}
                <SortMenu
                  value={sortMenuValue}
                  onChange={handleSortChange}
                  options={CS_SORT_MENU_OPTIONS}
                  defaultValue={CS_SORT_DEFAULT}
                />
              </div>
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Activity</span>
                <div className="relative">
                  {activityFilter !== 'ALL' && (
                    <FilterDismiss onClear={() => mergeListParams({ activity: 'ALL', page: 1 })} />
                  )}
                  <FormSelect
                    value={activityFilter}
                    onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                    options={CS_ACTIVITY_OPTIONS}
                    wrapperClassName="w-full"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Backlog</span>
                <div className="relative">
                  {backlogFilter !== 'ALL' && (
                    <FilterDismiss onClear={() => mergeListParams({ backlog: 'ALL', page: 1 })} />
                  )}
                  <FormSelect
                    value={backlogFilter}
                    onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                    options={CS_BACKLOG_OPTIONS}
                    wrapperClassName="w-full"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Sort by</span>
                <div className="relative">
                  {sort !== 'total-desc' && (
                    <FilterDismiss onClear={() => mergeListParams({ sort: 'total-desc', page: 1 })} />
                  )}
                  <SortMenu
                    value={sortMenuValue}
                    onChange={handleSortChange}
                    options={CS_SORT_MENU_OPTIONS}
                    defaultValue={CS_SORT_DEFAULT}
                  />
                </div>
              </div>
            </>
          }
        />

        {hasActiveFilters && (
          <p className="mb-3 text-xs text-app-fg-muted" aria-live="polite">
            {totalCount} closer{totalCount === 1 ? '' : 's'}
            {q ? ` matching "${q}"` : ''}
            {activityFilter !== 'ALL' ? ` · ${CS_ACTIVITY_OPTIONS.find((option) => option.value === activityFilter)?.label}` : ''}
            {backlogFilter !== 'ALL' ? ` · ${CS_BACKLOG_OPTIONS.find((option) => option.value === backlogFilter)?.label}` : ''}
          </p>
        )}
      </div>

      {unfilteredCount === 0 ? (
        <div className="card">
          <EmptyState
            title="No team members yet"
            description="Manage staff from HR → Users."
          />
        </div>
      ) : showFilteredEmpty ? (
        <div className="card">
          <EmptyState
            title="No matching closers"
            description="Try a different search, activity filter, or backlog filter."
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="list-panel">
            <CompactTable
              withCard={false}
              columns={teamColumns}
              rows={teamMembers}
              rowKey={(m) => m.id}
              renderMobileCard={(m) => {
                const workload = m.workload;
                const leaderboard = m.leaderboardEntry;
                return (
                  <button
                    type="button"
                    onClick={() => setPeekMember(m)}
                    className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5 text-left"
                  >
                    {/* Row 1: avatar + name + backlog/idle */}
                    <div className="flex items-center gap-2.5">
                      <CompactUserAvatar name={m.name} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-app-fg">{m.name}</span>
                      {m.isIdle ? (
                        <span className="shrink-0 text-xs font-semibold text-warning-600 dark:text-warning-400">Idle</span>
                      ) : workload ? (
                        <span className="shrink-0 text-xs tabular-nums text-app-fg-muted">
                          {workload.pendingCount} pending
                        </span>
                      ) : null}
                    </div>
                    {/* Row 2: total orders + CR + DR */}
                    <div className="flex items-center gap-3 text-xs text-app-fg-muted tabular-nums pl-[calc(1.75rem+0.625rem)]">
                      {leaderboard && (
                        <span className="font-medium text-brand-600 dark:text-brand-400">{leaderboard.ordersEngaged} orders</span>
                      )}
                      {leaderboard?.confirmationRate != null && (
                        <span className={confirmationRateColorClass(leaderboard.confirmationRate)}>
                          CR {Math.round(leaderboard.confirmationRate)}%
                        </span>
                      )}
                      {leaderboard?.deliveryRate != null && (
                        <span className={deliveryRateColorClass(leaderboard.deliveryRate)}>
                          DR {Math.round(leaderboard.deliveryRate)}%
                        </span>
                      )}
                    </div>
                  </button>
                );
              }}
              pagination={
                totalPages > 1 ? { page, totalPages, pageParam: 'page' } : undefined
              }
            />
          </div>
        </div>
      )}

      <div className="card">
        <p className="text-sm text-app-fg-muted">
          <Link to="/admin/sales/queue" prefetch="intent" className="text-brand-500 hover:text-brand-600">
            Live activities
          </Link>
          {' — '}dashboard with workloads, unassigned orders, and leaderboard.
        </p>
      </div>

      {/* Mobile peek modal — full closer detail + actions */}
      <Modal
        open={!!peekMember}
        onClose={() => setPeekMember(null)}
        maxWidth="max-w-sm"
        contentClassName="p-4"
      >
        {peekMember && (
          <CSTeamMemberCard member={peekMember} />
        )}
      </Modal>
    </div>
  );
}
