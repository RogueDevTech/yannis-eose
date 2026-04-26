import { useState, useEffect, useRef } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import { PageHeader } from '~/components/ui/page-header';
import { EmptyState } from '~/components/ui/empty-state';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { Pagination } from '~/components/ui/pagination';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import type { CSTeamMemberOverview } from './types';
import { UserBranchBadges } from '~/components/ui/user-branch-badges';

export interface CSTeamPageProps {
  teamMembers: CSTeamMemberOverview[];
  summary: { agentCount: number; totalPending: number; idleCount: number };
  canReassign?: boolean;
  page?: number;
  totalPages?: number;
  /** Date filter from URL — controls the leaderboard window for confirm/delivery rates. */
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

function CSTeamMemberCard({
  member,
  canReassign,
  onRedistribute,
}: {
  member: CSTeamMemberOverview;
  canReassign: boolean;
  onRedistribute: (member: CSTeamMemberOverview) => void;
}) {
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
            <div className="grid grid-cols-3 gap-2 mb-3 text-xs text-app-fg-muted">
              <div>
                <span className="font-medium text-app-fg">{leaderboard.ordersDelivered}</span>
                <span className="block text-app-fg-muted">Delivered</span>
              </div>
              <div>
                <span className="font-medium text-app-fg">{Math.round(leaderboard.confirmationRate)}%</span>
                <span className="block text-app-fg-muted">Confirm</span>
              </div>
              <div>
                <span className="font-medium text-app-fg">{Math.round(leaderboard.deliveryRate)}%</span>
                <span className="block text-app-fg-muted">Delivery</span>
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex flex-nowrap items-center gap-2">
        {isAgent && canReassign && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            className="text-xs shrink-0"
            onClick={() => onRedistribute(member)}
          >
            Redistribute
          </Button>
        )}
        <Link
          to={`/admin/cs/orders?csAgentId=${member.id}`}
          prefetch="intent"
          className="btn-secondary btn-sm text-xs inline-flex items-center justify-center shrink-0"
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

export function CSTeamPage({ teamMembers, summary, canReassign = false, page = 1, totalPages = 1, dateFilters }: CSTeamPageProps) {
  const fetcher = useFetcher<{ success?: boolean; error?: string; redistributed?: number }>();
  const revalidator = useRevalidator();
  const { toast } = useToast();
  const [redistributeMember, setRedistributeMember] = useState<CSTeamMemberOverview | null>(null);
  const prevFetcherData = useRef(fetcher.data);

  useEffect(() => {
    if (fetcher.data === prevFetcherData.current) return;
    prevFetcherData.current = fetcher.data;
    if (!fetcher.data || typeof fetcher.data !== 'object') return;
    if (fetcher.data.success) {
      setRedistributeMember(null);
      const n = fetcher.data.redistributed ?? 0;
      toast.success(n === 0 ? 'No orders to redistribute.' : `${n} order${n === 1 ? '' : 's'} redistributed.`);
      revalidator.revalidate();
    } else if (fetcher.data.error) {
      toast.error('Redistribute failed', fetcher.data.error);
    }
  }, [fetcher.data, toast, revalidator]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        description="Sales & CS team overview — workload, activity, and the selected period’s performance. View orders or profile per member."
        actions={
          dateFilters ? (
            <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
              <DateFilterBar
                startDate={dateFilters.startDate}
                endDate={dateFilters.endDate}
                periodAllTime={dateFilters.periodAllTime}
              />
            </div>
          ) : null
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
                Workload, activity, and performance overview.
              </p>
            </div>
          </div>

          {/* Mobile: always render card grid (the table view is unusable on a narrow viewport) */}
          <div className="md:hidden grid grid-cols-1 gap-3">
            {teamMembers.map((m) => (
              <CSTeamMemberCard
                key={m.id}
                member={m}
                canReassign={canReassign}
                onRedistribute={setRedistributeMember}
              />
            ))}
          </div>

          {/* Desktop: table view */}
          <div className="hidden md:block">
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr>
                      <th className="table-header">Member</th>
                      <th className="table-header">Workload</th>
                      <th className="table-header">Activity</th>
                      <th className="table-header">Performance</th>
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
                          <td className="table-cell text-xs text-app-fg-muted max-w-[14rem]">
                            {lb ? (
                              <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <span>
                                  <span className="font-medium text-app-fg">{lb.ordersDelivered}</span> delivered
                                </span>
                                <span className="text-app-border" aria-hidden>
                                  ·
                                </span>
                                <span>
                                  <span className="font-medium text-app-fg">{Math.round(lb.confirmationRate)}%</span>{' '}
                                  confirm
                                </span>
                                <span className="text-app-border" aria-hidden>
                                  ·
                                </span>
                                <span>
                                  <span className="font-medium text-app-fg">{Math.round(lb.deliveryRate)}%</span>{' '}
                                  delivery
                                </span>
                              </span>
                            ) : (
                              '\u2014'
                            )}
                          </td>
                          <td className="table-cell">
                            <div className="flex flex-wrap items-center gap-2">
                              {isAgent && canReassign && (
                                <Button
                                  type="button"
                                  variant="primary"
                                  size="sm"
                                  className="text-xs shrink-0"
                                  onClick={() => setRedistributeMember(member)}
                                >
                                  Redistribute
                                </Button>
                              )}
                              <Link
                                to={`/admin/cs/orders?csAgentId=${member.id}`}
                                prefetch="intent"
                                className="btn-secondary btn-sm text-xs inline-flex items-center justify-center shrink-0"
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

      {redistributeMember && (
        <ConfirmActionModal
          open={!!redistributeMember}
          onClose={() => setRedistributeMember(null)}
          title="Redistribute orders"
          description={
            redistributeMember.workload ? (
              <>
                Redistribute {redistributeMember.workload.pendingCount} order
                {redistributeMember.workload.pendingCount === 1 ? '' : 's'} from{' '}
                <strong>{redistributeMember.name}</strong> to other closers? Orders will be reassigned using the same
                dispatch rules (load-balanced or performance).
              </>
            ) : (
              <>Redistribute all active orders from <strong>{redistributeMember.name}</strong> to other closers?</>
            )
          }
          confirmLabel="Redistribute"
          cancelLabel="Cancel"
          variant="warning"
          loading={fetcher.state === 'submitting'}
          onConfirm={() => {
            fetcher.submit(
              { intent: 'redistribute', agentId: redistributeMember.id },
              { method: 'post' },
            );
          }}
        />
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
