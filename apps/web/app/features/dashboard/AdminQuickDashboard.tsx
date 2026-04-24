import { Link } from '@remix-run/react';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';

/**
 * Data shape for the lightweight admin landing. Populated by
 * `dashboard.quickOverview` (single tRPC call, ~50-150ms total).
 */
export interface QuickOverviewData {
  today: {
    newOrders: number;
    delivered: number;
    cancelled: number;
  };
  /** Total orders currently in any active state (UNPROCESSED..IN_TRANSIT). */
  activeNow: number;
  /** Orders sitting in UNPROCESSED waiting for CS assignment. */
  unprocessedNow: number;
  /** Finance approval requests in PENDING state. */
  pendingApprovals: number;
}

export interface AdminQuickDashboardProps {
  data: QuickOverviewData;
  userName: string;
  role: string;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Lightweight admin landing. Replaces the previous heavy CEO Executive dashboard on /admin.
 * The full Executive Overview (profit aggregation, charts, leaderboards, branch breakdown)
 * lives at /admin/ceo — linked prominently from this page. See CLAUDE.md for context on why.
 */
export function AdminQuickDashboard({ data, userName, role }: AdminQuickDashboardProps) {
  const firstName = userName?.split(' ')[0] ?? 'Admin';
  const hasUnprocessed = data.unprocessedNow > 0;
  const hasPendingApprovals = data.pendingApprovals > 0;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold text-app-fg">
            {getGreeting()}, {firstName}
          </h1>
          <p className="text-sm text-app-fg-muted font-medium mt-1">
            {role === 'SUPER_ADMIN' ? 'Quick snapshot — open the Executive Overview for the full picture.' : 'Quick snapshot of today.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PageRefreshButton />
        </div>
      </div>

      {/* Today's activity */}
      <OverviewStatStrip
        items={[
          { label: 'New today', value: data.today.newOrders.toString(), valueClassName: 'text-app-fg' },
          {
            label: 'Delivered today',
            value: data.today.delivered.toString(),
            valueClassName: 'text-success-600 dark:text-success-400',
          },
          {
            label: 'Cancelled today',
            value: data.today.cancelled.toString(),
            valueClassName:
              data.today.cancelled > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
          },
          { label: 'Active now', value: data.activeNow.toString(), valueClassName: 'text-app-fg' },
        ]}
      />

      {/* Action rail — things that likely need attention */}
      {(hasUnprocessed || hasPendingApprovals) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {hasUnprocessed && (
            <Link
              to="/admin/cs/queue"
              className="card flex items-center justify-between hover:bg-app-hover/40 transition-colors"
            >
              <div>
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Unassigned orders</p>
                <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">
                  {data.unprocessedNow}
                </p>
                <p className="text-xs text-app-fg-muted mt-1">Assign in the CS queue →</p>
              </div>
              <svg className="w-6 h-6 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
          {hasPendingApprovals && (
            <Link
              to="/admin/finance?tab=approvals"
              className="card flex items-center justify-between hover:bg-app-hover/40 transition-colors"
            >
              <div>
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider">Pending approvals</p>
                <p className="text-2xl font-bold text-warning-600 dark:text-warning-400 mt-1">
                  {data.pendingApprovals}
                </p>
                <p className="text-xs text-app-fg-muted mt-1">Review in Finance →</p>
              </div>
              <svg className="w-6 h-6 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>
      )}

      {/* Executive Overview card — the prominent entry point to the heavy report */}
      <Link
        to="/admin/ceo"
        className="card block hover:bg-app-hover/40 transition-colors"
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Executive Overview</h2>
              <svg className="w-5 h-5 text-app-fg-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
            <p className="text-sm text-app-fg-muted mt-1">
              Revenue, true profit, cost breakdown, order pipeline, media buyer &amp; CS performance, branch breakdown. Heavier page — loads in 1-2 seconds.
            </p>
          </div>
        </div>
      </Link>

      {/* Quick jumps */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickJump to="/admin/cs/queue" label="CS Queue" />
        <QuickJump to="/admin/logistics/orders" label="Logistics" />
        <QuickJump to="/admin/marketing" label="Marketing" />
        <QuickJump to="/admin/finance" label="Finance" />
      </div>
    </div>
  );
}

function QuickJump({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="card text-center py-4 hover:bg-app-hover/40 transition-colors"
    >
      <span className="text-sm font-medium text-app-fg">{label}</span>
    </Link>
  );
}
