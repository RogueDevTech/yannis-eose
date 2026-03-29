import { OverviewStatStripSkeleton } from '~/components/ui/overview-stat-strip';

/**
 * Loading skeleton for the role-based dashboard.
 * Shows header and stat card placeholders with a loading indicator.
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

      <div className="flex items-center justify-center gap-2 py-4">
        <svg
          className="w-5 h-5 animate-spin text-brand-500 dark:text-brand-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="32 32" strokeDashoffset="8" opacity="0.9" />
        </svg>
        <span className="text-sm font-medium text-app-fg-muted">Loading dashboard…</span>
      </div>
    </div>
  );
}
