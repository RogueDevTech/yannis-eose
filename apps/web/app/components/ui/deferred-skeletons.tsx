/**
 * Reusable pulse blocks for deferred loader data: keep real layout (labels, cards, toolbars)
 * and replace only the values / chart regions until `secondary` resolves.
 */

export function StatValuePulse({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-7 rounded-md bg-app-hover animate-pulse ${className}`}
      aria-hidden
    />
  );
}

/**
 * Mirrors `OrdersChartView` (trend card, pie + bar grid) while deferred data streams.
 * Used on order list pages with chart toggle.
 */
export function OrdersChartViewShellSkeleton() {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 h-4 max-w-[14rem] rounded bg-app-hover animate-pulse" aria-hidden />
        <div className="h-72 w-full rounded-lg bg-app-hover/90 animate-pulse" aria-hidden />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="mb-3 h-4 max-w-[12rem] rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="flex justify-center py-6">
            <div className="h-44 w-44 rounded-full bg-app-hover animate-pulse" aria-hidden />
          </div>
        </div>
        <div className="card">
          <div className="mb-3 h-4 max-w-[10rem] rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="h-72 w-full rounded-lg bg-app-hover/90 animate-pulse" aria-hidden />
        </div>
      </div>
    </div>
  );
}
