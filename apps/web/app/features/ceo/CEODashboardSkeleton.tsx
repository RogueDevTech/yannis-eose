/**
 * Loading skeleton for the CEO Executive Overview (chart view).
 * Mirrors the layout so the transition to real data feels seamless.
 */
export function CEODashboardSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="h-8 w-64 rounded bg-app-hover animate-pulse" />
          <div className="h-4 w-80 rounded bg-app-hover mt-2 animate-pulse" />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="h-9 w-32 rounded-lg bg-app-hover animate-pulse" />
          <div className="h-9 w-48 rounded-lg bg-app-hover animate-pulse" />
        </div>
      </div>

      {/* Chart topic row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="h-4 w-20 rounded bg-app-hover animate-pulse" />
        <div className="h-10 w-36 rounded-lg bg-app-hover animate-pulse" />
      </div>

      {/* Revenue & orders over time — large chart placeholder */}
      <div>
        <div className="h-4 w-48 rounded bg-app-hover animate-pulse mb-3" />
        <div className="card">
          <div className="h-4 w-full max-w-2xl rounded bg-app-hover animate-pulse mb-4" />
          <div className="h-72 min-h-[288px] w-full rounded-lg bg-app-hover animate-pulse" />
        </div>
      </div>

      {/* Cost Breakdown + Status Distribution — two cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="h-6 w-32 rounded bg-app-hover animate-pulse mb-4" />
          <div className="h-48 min-h-[192px] w-full rounded-lg bg-app-hover animate-pulse" />
        </div>
        <div className="card">
          <div className="h-5 w-40 rounded bg-app-hover animate-pulse mb-4" />
          <div className="h-52 min-h-[208px] w-full rounded-lg bg-app-hover animate-pulse" />
        </div>
      </div>

      {/* Order funnel — full width */}
      <div className="card">
        <div className="h-6 w-28 rounded bg-app-hover animate-pulse mb-2" />
        <div className="h-4 w-full max-w-xl rounded bg-app-hover animate-pulse mb-4" />
        <div className="h-64 min-h-[256px] w-full rounded-lg bg-app-hover animate-pulse" />
      </div>

      {/* Loading label */}
      <div className="flex items-center justify-center gap-2 py-2">
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
