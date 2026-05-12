import { Link } from '@remix-run/react';
import { OverviewStatStrip, OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { StatValuePulse } from '~/components/ui/deferred-skeletons';
import { isSuperAdminOnly } from '~/lib/rbac';

/**
 * Admin quick-overview skeleton — mirrors AdminQuickDashboard layout exactly.
 * The chrome (page header with greeting, two cards with their links and labels,
 * Executive Overview link, quick-jump grid) is rendered identically; only the
 * eight numbers (4 marketing + 4 CS) are pulsing StatValuePulse placeholders.
 * No layout shift when the loader resolves.
 */
export function AdminQuickDashboardLoadingShell({
  userName,
  role,
}: {
  userName: string;
  role: string;
}) {
  const firstName = userName?.split(' ')[0] ?? 'Admin';
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  const description = isSuperAdminOnly({ role })
    ? 'Quick snapshot — open the Executive Overview for the full picture.'
    : 'Quick snapshot of today.';

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title={`${greeting}, ${firstName}`}
        mobileInlineActions
        description={description}
        actions={
          <>
            <span className="hidden md:inline-flex"><PageRefreshButton /></span>
            <span className="md:hidden"><PageRefreshButton iconOnly /></span>
          </>
        }
      />

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-app-fg">Marketing today</h2>
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
            { label: 'New orders', value: <StatValuePulse className="min-w-[2.25rem]" /> },
            { label: 'Confirmed', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Delivered', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Cancelled', value: <StatValuePulse className="min-w-[2rem]" /> },
          ]}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-app-fg">Customer support today</h2>
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
            { label: 'Closers', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Pending', value: <StatValuePulse className="min-w-[2.25rem]" /> },
            { label: 'Idle', value: <StatValuePulse className="min-w-[2rem]" /> },
            { label: 'Unassigned', value: <StatValuePulse className="min-w-[2.25rem]" /> },
          ]}
        />
      </div>

      <Link to="/admin/ceo" className="card block hover:bg-app-hover/40 transition-colors">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-brand-700/20 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-5 h-5 text-brand-600 dark:text-brand-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-app-fg">Executive Overview</h2>
              <svg
                className="w-5 h-5 text-app-fg-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </div>
            <p className="text-sm text-app-fg-muted mt-1">
              Revenue, true profit, cost breakdown, order pipeline, media buyer &amp; CS
              performance, branch breakdown. Heavier page — loads in 1-2 seconds.
            </p>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: '/admin/cs/queue', label: 'CS Queue' },
          { to: '/admin/logistics/orders', label: 'Logistics' },
          { to: '/admin/marketing', label: 'Marketing' },
          { to: '/admin/finance', label: 'Finance' },
        ].map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className="card text-center py-4 hover:bg-app-hover/40 transition-colors"
          >
            <span className="text-sm font-medium text-app-fg">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading skeleton for the role-based dashboard (non-admin variant).
 * Shows header and stat card placeholders (pulse only).
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="h-8 w-56 rounded bg-app-hover animate-pulse" />
          <div className="h-4 w-72 rounded bg-app-hover mt-2 animate-pulse" />
        </div>
        <div className="h-9 w-44 rounded-lg bg-app-hover animate-pulse shrink-0" />
      </div>

      <OverviewStatStripSkeleton count={4} />

      {/* Content cards placeholder */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card animate-pulse">
          <div className="h-5 w-32 rounded bg-app-hover mb-4" />
          <div className="h-40 rounded-lg bg-app-hover" />
        </div>
        <div className="card animate-pulse">
          <div className="h-5 w-40 rounded bg-app-hover mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 w-full rounded bg-app-hover" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
