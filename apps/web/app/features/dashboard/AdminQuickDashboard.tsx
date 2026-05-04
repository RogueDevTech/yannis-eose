import { Link } from '@remix-run/react';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';

/**
 * Data shape for the lightweight admin landing. Populated by
 * `dashboard.quickOverview` (single tRPC call, ~50-150ms total).
 */
export interface QuickOverviewData {
  marketing: {
    today: {
      /** All orders created today, any status. */
      newOrders: number;
      /** Orders that reached CONFIRMED today. */
      confirmed: number;
      /** Orders that reached DELIVERED today. */
      delivered: number;
      /** Orders that were cancelled today. */
      cancelled: number;
    };
  };
  cs: {
    /** CS agents with any workload row in the current branch. */
    closerCount: number;
    /** Sum of pending orders across all CS agents. */
    totalPending: number;
    /** CS agents flagged as idle (no action > threshold). */
    idleCount: number;
    /** Orders sitting in UNPROCESSED waiting for CS assignment. */
    unassigned: number;
  };
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
  const m = data.marketing.today;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${getGreeting()}, ${firstName}`}
        description={
          role === 'SUPER_ADMIN'
            ? 'Quick snapshot — open the Executive Overview for the full picture.'
            : 'Quick snapshot of today.'
        }
        actions={<PageRefreshButton />}
      />

      {/* Marketing — today's order pulse. Click header to jump into the marketing module. */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-app-fg">Marketing — today</h2>
          <Link
            to="/admin/marketing/overview"
            prefetch="intent"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            Live activities →
          </Link>
        </div>
        <OverviewStatStrip
          embedded
          showScrollControls={false}
          items={[
            {
              label: 'New orders',
              value: m.newOrders.toString(),
              valueClassName: 'text-app-fg',
              title: 'All orders created today, any status',
            },
            {
              label: 'Confirmed',
              value: m.confirmed.toString(),
              valueClassName: 'text-success-600 dark:text-success-400',
              title: 'Orders that reached CONFIRMED today',
            },
            {
              label: 'Delivered',
              value: m.delivered.toString(),
              valueClassName: 'text-success-600 dark:text-success-400',
              title: 'Orders that reached DELIVERED today',
            },
            {
              label: 'Cancelled',
              value: m.cancelled.toString(),
              valueClassName:
                m.cancelled > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
              title: 'Orders that were cancelled today',
            },
          ]}
        />
      </div>

      {/* CS — current floor snapshot. */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-app-fg">CS — right now</h2>
          <Link
            to="/admin/cs/queue"
            prefetch="intent"
            className="text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            CS queue →
          </Link>
        </div>
        <OverviewStatStrip
          embedded
          showScrollControls={false}
          items={[
            {
              label: 'Closers',
              value: data.cs.closerCount.toString(),
              valueClassName: 'text-app-fg',
              title: 'CS agents with any workload row in the current branch',
            },
            {
              label: 'Pending',
              value: data.cs.totalPending.toString(),
              valueClassName: 'text-app-fg',
              title: 'Total in-flight orders assigned across all closers',
            },
            {
              label: 'Idle',
              value: data.cs.idleCount.toString(),
              valueClassName:
                data.cs.idleCount > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
              title: 'Closers with no action for >10 min',
            },
            {
              label: 'Unassigned',
              value: data.cs.unassigned.toString(),
              valueClassName:
                data.cs.unassigned > 0 ? 'text-warning-600 dark:text-warning-400' : 'text-app-fg',
              title: 'Orders waiting in UNPROCESSED — assign from the CS queue',
            },
          ]}
        />
      </div>

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
