import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { Button } from '~/components/ui/button';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
import { CompactUserAvatar } from '~/components/ui/compact-user-avatar';
import { SearchInput } from '~/components/ui/search-input';
import { FormSelect } from '~/components/ui/form-select';
import type { CSTeamMemberOverview } from './types';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';
import {
  confirmationRateColorClass,
  deliveryRateColorClass,
  formatRate,
} from '~/lib/rate-color';

export interface CSTeamPageProps {
  teamMembers: CSTeamMemberOverview[];
  summary: { agentCount: number; totalPending: number; idleCount: number };
  page?: number;
  totalPages?: number;
  totalCount?: number;
  unfilteredCount?: number;
  q?: string;
  activityFilter?: string;
  backlogFilter?: string;
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
  return role === 'CS_CLOSER' ? 'Closer' : role.replace(/_/g, ' ');
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
          {leaderboard && (
            <div className="grid grid-cols-3 gap-2">
              <CSTeamCompactStat label="Assigned" value={leaderboard.ordersEngaged} />
              <CSTeamCompactStat label="Delivered" value={leaderboard.ordersDelivered} />
              <CSTeamCompactStat label="Confirmed" value={leaderboard.ordersConfirmed} />
            </div>
          )}
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
  dateFilters,
}: CSTeamPageProps) {
  const [showExportModal, setShowExportModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(q);

  useEffect(() => {
    setSearchQuery(q);
  }, [q]);

  const mergeListParams = (overrides: {
    q?: string;
    activity?: string;
    backlog?: string;
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

  const filtersBadgeCount = useMemo(() => {
    let count = 0;
    if (activityFilter !== 'ALL') count += 1;
    if (backlogFilter !== 'ALL') count += 1;
    return count;
  }, [activityFilter, backlogFilter]);

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
        key: 'assigned',
        header: 'Assigned',
        align: 'right',
        nowrap: true,
        render: (member) => {
          const lb = member.leaderboardEntry;
          return lb ? (
            <span className="text-sm font-medium text-app-fg tabular-nums">{lb.ordersEngaged}</span>
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
              sheetTitle="Sales team tools"
              sheetSubtitle={<span>Filters, date range and export</span>}
              triggerAriaLabel="Sales team toolbar and date range"
              filtersBadgeCount={filtersBadgeCount}
              filters={
                <>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Activity</span>
                    <FormSelect
                      value={activityFilter}
                      onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                      options={CS_ACTIVITY_OPTIONS}
                      wrapperClassName="w-full"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Backlog</span>
                    <FormSelect
                      value={backlogFilter}
                      onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                      options={CS_BACKLOG_OPTIONS}
                      wrapperClassName="w-full"
                    />
                  </div>
                </>
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
                <>
                  <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                    <DateFilterBar
                      startDate={dateFilters.startDate}
                      endDate={dateFilters.endDate}
                      periodAllTime={dateFilters.periodAllTime}
                      triggerLayout="blockCenter"
                    />
                  </div>
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
                </>
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
          items={[
            {
              label: 'Closers',
              value: summary.agentCount.toString(),
              valueClassName: 'text-app-fg',
            },
            {
              label: 'Total pending',
              value: summary.totalPending.toString(),
              valueClassName: 'text-app-fg',
            },
            {
              label: 'Idle',
              value: summary.idleCount.toString(),
              valueClassName:
                summary.idleCount > 0
                  ? 'text-warning-600 dark:text-warning-400'
                  : 'text-app-fg',
            },
          ]}
        />
      )}

      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 px-0 py-0"
          hideMobileSheet
          badgeCount={filtersBadgeCount}
          sheetSubtitle={<span>Filter closers by live activity and backlog</span>}
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
              <FormSelect
                value={activityFilter}
                onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                options={CS_ACTIVITY_OPTIONS}
                wrapperClassName="w-full min-w-0 sm:w-44"
              />
              <FormSelect
                value={backlogFilter}
                onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                options={CS_BACKLOG_OPTIONS}
                wrapperClassName="w-full min-w-0 sm:w-44"
              />
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Activity</span>
                <FormSelect
                  value={activityFilter}
                  onChange={(event) => mergeListParams({ activity: event.target.value, page: 1 })}
                  options={CS_ACTIVITY_OPTIONS}
                  wrapperClassName="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Backlog</span>
                <FormSelect
                  value={backlogFilter}
                  onChange={(event) => mergeListParams({ backlog: event.target.value, page: 1 })}
                  options={CS_BACKLOG_OPTIONS}
                  wrapperClassName="w-full"
                />
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
              renderMobileCard={(m) => <CSTeamMemberCard member={m} embedded />}
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
    </div>
  );
}
