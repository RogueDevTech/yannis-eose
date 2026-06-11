/**
 * Skeleton mirror of OrderDetailPage. Keeps the page chrome (breadcrumb,
 * section cards, headings, grid columns) visible while `orderDetail`
 * streams from the loader. Only the data-bound bits (customer name,
 * order id, status, line items, timeline rows, action buttons) are
 * replaced with pulse blocks so the user can read what the page IS
 * loading rather than staring at a single spinner.
 */
function Pulse({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-app-hover animate-pulse ${className}`} aria-hidden />;
}

function CardHeading({ width = 'w-40' }: { width?: string }) {
  return <Pulse className={`h-5 ${width} mb-3`} />;
}

export function OrderDetailSkeleton() {
  return (
    <div className="space-y-4 overflow-x-hidden min-w-0" aria-busy="true" aria-live="polite">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-app-fg-muted">Orders</span>
        <svg
          className="w-4 h-4 text-app-border flex-shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <Pulse className="h-4 w-44" />
      </div>

      {/* Header — customer name + phone + status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 min-w-0">
        <div className="min-w-0 space-y-2">
          <Pulse className="h-7 w-56" />
          <Pulse className="h-4 w-40" />
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Pulse className="h-8 w-8 rounded-md" />
          <Pulse className="h-6 w-24 rounded-full" />
        </div>
      </div>

      {/* Two-column layout matches OrderDetailPage */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left col */}
        <div className="lg:col-span-2 space-y-4">
          {/* Order Progress */}
          <div className="card overflow-hidden">
            <h2 className="text-lg font-semibold text-app-fg mb-4">Order Progress</h2>
            <div className="grid grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2">
                  <Pulse className="h-8 w-8 rounded-full" />
                  <Pulse className="h-3 w-14" />
                </div>
              ))}
            </div>
          </div>

          {/* Order Items — compact horizontal rows */}
          <div className="card !p-0 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-app-border flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app-fg">Order Items</h2>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs text-app-fg-muted">Total:</span>
                <Pulse className="h-4 w-16" />
              </div>
            </div>
            <div className="divide-y divide-app-border">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="px-4 py-2 flex items-center gap-3 min-w-0">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Pulse className="h-4 w-40" />
                    <Pulse className="h-3 w-20" />
                  </div>
                  <Pulse className="h-4 w-16 shrink-0" />
                  <Pulse className="h-3 w-8 shrink-0" />
                </div>
              ))}
            </div>
          </div>

          {/* Order Activity */}
          <div className="card">
            <h2 className="text-lg font-semibold text-app-fg mb-1">Order Activity</h2>
            <p className="text-xs text-app-fg-muted mb-4">
              Every step taken on this order, with who did it and when.
            </p>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Pulse className="h-6 w-6 rounded-full mt-0.5 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Pulse className="h-4 w-3/4" />
                    <Pulse className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right col — actions + comms */}
        <div className="space-y-4">
          <div className="card">
            <CardHeading width="w-28" />
            <div className="space-y-2">
              <Pulse className="h-9 w-full rounded-md" />
              <Pulse className="h-9 w-full rounded-md" />
              <Pulse className="h-9 w-2/3 rounded-md" />
            </div>
          </div>

          <div className="card">
            <CardHeading width="w-44" />
            <div className="flex gap-2 mb-3">
              <Pulse className="h-7 w-16 rounded-md" />
              <Pulse className="h-7 w-16 rounded-md" />
              <Pulse className="h-7 w-20 rounded-md" />
            </div>
            <Pulse className="h-24 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
