import { useState } from 'react';
import { Link } from '@remix-run/react';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Pagination } from '~/components/ui/pagination';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { Button } from '~/components/ui/button';
import { ExportModal } from '~/components/ui/export-modal';
import { EXPORT_CONFIGS } from '~/lib/export-config';
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
  /** Date filter from URL — controls the leaderboard window for order counts. */
  dateFilters?: { startDate: string; endDate: string; periodAllTime: boolean };
}

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
  return role === 'CS_AGENT' ? 'Closer' : role.replace(/_/g, ' ');
}

function memberInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function CSTeamMemberCard({ member }: { member: CSTeamMemberOverview }) {
  const initials = memberInitials(member.name);
  const isAgent = member.role === 'CS_AGENT';
  const workload = member.workload;
  const leaderboard = member.leaderboardEntry;
  const roleLabel = csRoleLabel(member.role);

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-app-fg truncate">
            {member.name}
          </p>
          <p className="text-xs text-app-fg-muted truncate">
            {roleLabel}
          </p>
          <div className="mt-1">
            <UserBranchBadges branches={member.branchMemberships} compact />
          </div>
        </div>
        {isAgent && member.isIdle && (
          <span className="shrink-0 text-xs font-medium text-warning-600 dark:text-warning-400">Idle</span>
        )}
      </div>

      {isAgent && workload && (
        <>
          <div className="mb-3">
            <p className="text-xs text-app-fg-muted mb-1">
              {workload.pendingCount} of {workload.capacity} slots
              {!member.isIdle && (
                <span className="ml-1">· {formatLastActive(workload.lastActionAt)}</span>
              )}
            </p>
            <div className="w-full h-2 bg-app-hover rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  (workload.capacity > 0 ? (workload.pendingCount / workload.capacity) * 100 : 0) >= 90
                    ? 'bg-danger-500'
                    : (workload.capacity > 0 ? (workload.pendingCount / workload.capacity) * 100 : 0) >= 70
                    ? 'bg-warning-500'
                    : 'bg-success-500'
                }`}
                style={{
                  width: `${Math.min(workload.capacity > 0 ? (workload.pendingCount / workload.capacity) * 100 : 0, 100)}%`,
                }}
              />
            </div>
          </div>
          {leaderboard && (
            <div className="grid grid-cols-3 gap-2 mb-2 text-xs text-app-fg-muted">
              <div>
                <span className="font-medium text-app-fg">{leaderboard.ordersEngaged}</span>
                <span className="block text-app-fg-muted">Assigned</span>
              </div>
              <div>
                <span className="font-medium text-app-fg">{leaderboard.ordersDelivered}</span>
                <span className="block text-app-fg-muted">Delivered</span>
              </div>
              <div>
                <span className="font-medium text-app-fg">{leaderboard.ordersConfirmed}</span>
                <span className="block text-app-fg-muted">Confirmed</span>
              </div>
            </div>
          )}
          {leaderboard && (
            <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-app-fg-muted">
              <div>
                <span className={`font-medium ${confirmationRateColorClass(leaderboard.confirmationRate)}`}>
                  {formatRate(leaderboard.confirmationRate)}
                </span>
                <span className="block text-app-fg-muted">Conf. rate</span>
              </div>
              <div>
                <span className={`font-medium ${deliveryRateColorClass(leaderboard.deliveryRate)}`}>
                  {formatRate(leaderboard.deliveryRate)}
                </span>
                <span className="block text-app-fg-muted">Delivery rate</span>
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-nowrap items-center gap-2">
        <Link
          to={`/admin/cs/orders?csAgentId=${member.id}&period=all_time`}
          prefetch="intent"
          className="btn-primary btn-sm text-xs inline-flex items-center justify-center shrink-0"
        >
          View orders
        </Link>
        <Link
          to={`/hr/users/${member.id}`}
          prefetch="intent"
          className="btn-secondary btn-sm text-xs inline-flex items-center justify-center shrink-0"
        >
          View profile
        </Link>
      </div>
    </div>
  );
}

function activityCell(member: CSTeamMemberOverview): string {
  const isAgent = member.role === 'CS_AGENT';
  if (!isAgent) return '\u2014';
  if (member.isIdle) return 'Idle';
  if (member.workload) return formatLastActive(member.workload.lastActionAt);
  return '\u2014';
}

export function CSTeamPage({ teamMembers, summary, page = 1, totalPages = 1, dateFilters }: CSTeamPageProps) {
  const [showExportModal, setShowExportModal] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Team Analysis"
        description="Closer workload, activity, and assigned / delivered / confirmed counts for the selected period. View orders or profile per member."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {dateFilters ? (
              <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                <DateFilterBar
                  startDate={dateFilters.startDate}
                  endDate={dateFilters.endDate}
                  periodAllTime={dateFilters.periodAllTime}
                />
              </div>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowExportModal(true)}
            >
              Generate report
            </Button>
          </div>
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

      {summary.agentCount > 0 && (
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

      {teamMembers.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No team members yet"
            description="Manage staff from HR → Users."
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-app-fg">Team members</h2>
              <p className="text-sm text-app-fg-muted mt-0.5">
                Workload, activity, and order counts for the selected period.
              </p>
            </div>
          </div>

          {/* Mobile: always render card grid (the table view is unusable on a narrow viewport) */}
          <div className="md:hidden grid grid-cols-1 gap-3">
            {teamMembers.map((m) => (
              <CSTeamMemberCard key={m.id} member={m} />
            ))}
          </div>

          {/* Desktop: table view */}
          <div className="hidden md:block">
            <div className="card p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px]">
                  <thead>
                    <tr>
                      <th className="table-header">Member</th>
                      <th className="table-header">Workload</th>
                      <th className="table-header">Activity</th>
                      <th className="table-header text-right">Assigned</th>
                      <th className="table-header text-right">Delivered</th>
                      <th className="table-header text-right">Confirmed</th>
                      <th className="table-header text-right">Conf. rate</th>
                      <th className="table-header text-right">Delivery rate</th>
                      <th className="table-header">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamMembers.map((member) => {
                      const isAgent = member.role === 'CS_AGENT';
                      const workload = member.workload;
                      const lb = member.leaderboardEntry;
                      const act = activityCell(member);
                      const isIdleText = act === 'Idle';
                      const workloadPct = workload && workload.capacity > 0
                        ? (workload.pendingCount / workload.capacity) * 100
                        : 0;

                      return (
                        <tr key={member.id} className="table-row">
                          <td className="table-cell">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-brand-600 dark:text-brand-400">
                                  {memberInitials(member.name)}
                                </span>
                              </div>
                              <span className="font-medium text-app-fg truncate">{member.name}</span>
                            </div>
                          </td>
                          <td className="table-cell text-sm whitespace-nowrap">
                            {isAgent && workload ? (
                              <span
                                className={`font-medium ${
                                  workloadPct >= 80
                                    ? 'text-danger-600 dark:text-danger-400'
                                    : 'text-success-600 dark:text-success-400'
                                }`}
                              >
                                {workload.pendingCount} / {workload.capacity}
                              </span>
                            ) : (
                              <span className="text-app-fg-muted">{'\u2014'}</span>
                            )}
                          </td>
                          <td className="table-cell text-sm whitespace-nowrap">
                            {isIdleText ? (
                              <span className="font-medium text-warning-600 dark:text-warning-400">Idle</span>
                            ) : (
                              <span className="text-app-fg-muted">{act}</span>
                            )}
                          </td>
                          <td className="table-cell text-sm text-right tabular-nums whitespace-nowrap">
                            {lb ? (
                              <span className="font-medium text-app-fg">{lb.ordersEngaged}</span>
                            ) : (
                              '\u2014'
                            )}
                          </td>
                          <td className="table-cell text-sm text-right tabular-nums whitespace-nowrap">
                            {lb ? (
                              <span className="font-medium text-app-fg">{lb.ordersDelivered}</span>
                            ) : (
                              '\u2014'
                            )}
                          </td>
                          <td className="table-cell text-sm text-right tabular-nums whitespace-nowrap">
                            {lb ? (
                              <span className="font-medium text-app-fg">{lb.ordersConfirmed}</span>
                            ) : (
                              '\u2014'
                            )}
                          </td>
                          <td className="table-cell text-sm text-right tabular-nums whitespace-nowrap">
                            {lb ? (
                              <span className={`font-medium ${confirmationRateColorClass(lb.confirmationRate)}`}>
                                {formatRate(lb.confirmationRate)}
                              </span>
                            ) : (
                              '\u2014'
                            )}
                          </td>
                          <td className="table-cell text-sm text-right tabular-nums whitespace-nowrap">
                            {lb ? (
                              <span className={`font-medium ${deliveryRateColorClass(lb.deliveryRate)}`}>
                                {formatRate(lb.deliveryRate)}
                              </span>
                            ) : (
                              '\u2014'
                            )}
                          </td>
                          <td className="table-cell">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                to={`/admin/cs/orders?csAgentId=${member.id}&period=all_time`}
                                prefetch="intent"
                                className="btn-primary btn-sm text-xs inline-flex items-center justify-center shrink-0"
                              >
                                View orders
                              </Link>
                              <Link
                                to={`/hr/users/${member.id}`}
                                prefetch="intent"
                                className="btn-secondary btn-sm text-xs inline-flex items-center justify-center shrink-0"
                              >
                                View profile
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {totalPages > 1 && (
            <Pagination page={page} totalPages={totalPages} pageParam="page" />
          )}
        </div>
      )}

      <div className="card">
        <p className="text-sm text-app-fg-muted">
          <Link to="/admin/cs/queue" prefetch="intent" className="text-brand-500 hover:text-brand-600">
            Live activities
          </Link>
          {' — '}dashboard with workloads, unassigned orders, and leaderboard.
        </p>
      </div>
    </div>
  );
}
