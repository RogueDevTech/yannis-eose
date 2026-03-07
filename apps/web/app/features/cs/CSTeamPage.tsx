import { useState, useEffect, useRef } from 'react';
import { Link, useFetcher, useRevalidator } from '@remix-run/react';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';
import type { CSTeamMemberOverview } from './types';

export interface CSTeamPageProps {
  teamMembers: CSTeamMemberOverview[];
  summary: { agentCount: number; totalPending: number; idleCount: number };
  canReassign?: boolean;
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

function CSTeamMemberCard({
  member,
  canReassign,
  onRedistribute,
}: {
  member: CSTeamMemberOverview;
  canReassign: boolean;
  onRedistribute: (member: CSTeamMemberOverview) => void;
}) {
  const initials = member.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const isAgent = member.role === 'CS_AGENT';
  const workload = member.workload;
  const leaderboard = member.leaderboardEntry;

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <span className="text-sm font-bold text-brand-600 dark:text-brand-400">{initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-surface-900 dark:text-surface-100 truncate">
            {member.name}
          </p>
          <p className="text-xs text-surface-800 dark:text-surface-200 truncate">
            {member.role.replace(/_/g, ' ')}
          </p>
        </div>
        {isAgent && member.isIdle && (
          <span className="shrink-0 text-xs font-medium text-warning-600 dark:text-warning-400">Idle</span>
        )}
      </div>

      {isAgent && workload && (
        <>
          <div className="mb-3">
            <p className="text-xs text-surface-700 dark:text-surface-300 mb-1">
              {workload.pendingCount} of {workload.capacity} slots
              {!member.isIdle && (
                <span className="ml-1">· {formatLastActive(workload.lastActionAt)}</span>
              )}
            </p>
            <div className="w-full h-2 bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
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
            <div className="grid grid-cols-3 gap-2 mb-3 text-xs text-surface-700 dark:text-surface-300">
              <div>
                <span className="font-medium text-surface-900 dark:text-surface-100">{leaderboard.ordersDelivered}</span>
                <span className="block text-surface-500 dark:text-surface-400">Delivered</span>
              </div>
              <div>
                <span className="font-medium text-surface-900 dark:text-surface-100">{Math.round(leaderboard.confirmationRate)}%</span>
                <span className="block text-surface-500 dark:text-surface-400">Confirm</span>
              </div>
              <div>
                <span className="font-medium text-surface-900 dark:text-surface-100">{Math.round(leaderboard.deliveryRate)}%</span>
                <span className="block text-surface-500 dark:text-surface-400">Delivery</span>
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

export function CSTeamPage({ teamMembers, summary, canReassign = false }: CSTeamPageProps) {
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
      <div>
        <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Team</h1>
        <p className="text-sm text-surface-800 dark:text-surface-200 mt-0.5">
          Sales & CS team overview — workload, activity, and this month’s performance. View orders or profile per member.
        </p>
      </div>

      {teamMembers.length > 0 && (
        <div className="card py-3 px-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-surface-700 dark:text-surface-300">
          <span>
            <strong className="text-surface-900 dark:text-surface-100">{summary.agentCount}</strong> agents
          </span>
          <span>
            <strong className="text-surface-900 dark:text-surface-100">{summary.totalPending}</strong> total pending
          </span>
          {summary.idleCount > 0 && (
            <span>
              <strong className="text-warning-600 dark:text-warning-400">{summary.idleCount}</strong> idle
            </span>
          )}
          <Link to="/admin/cs/queue" prefetch="intent" className="text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300 ml-auto">
            Live activities →
          </Link>
        </div>
      )}

      {teamMembers.length === 0 ? (
        <div className="card text-center py-12 text-surface-500 dark:text-surface-400">
          No team members yet. Manage staff from HR → Users.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {teamMembers.map((m) => (
            <CSTeamMemberCard
              key={m.id}
              member={m}
              canReassign={canReassign}
              onRedistribute={setRedistributeMember}
            />
          ))}
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
                <strong>{redistributeMember.name}</strong> to other agents? Orders will be reassigned using the same
                dispatch rules (load-balanced or performance).
              </>
            ) : (
              <>Redistribute all active orders from <strong>{redistributeMember.name}</strong> to other agents?</>
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
        <p className="text-sm text-surface-700 dark:text-surface-300">
          <Link to="/admin/cs/queue" prefetch="intent" className="text-brand-500 hover:text-brand-600">
            Live activities
          </Link>
          {' — '}dashboard with workloads, unassigned orders, and leaderboard.
        </p>
      </div>
    </div>
  );
}
