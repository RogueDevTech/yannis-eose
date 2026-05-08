/**
 * Route-transition + deferred fallback shell for HR user detail.
 * Mirrors profile header card, tab strip, and overview two-column grid (pulse only).
 */
export function UserDetailShellSkeleton() {
  return (
    <div className="space-y-6 animate-fade-in" aria-busy="true" aria-live="polite">
      <div className="card p-0 overflow-hidden">
        <div className="h-28 sm:h-32 bg-app-hover animate-pulse" aria-hidden />
        <div className="px-4 sm:px-6 pb-5 -mt-12 sm:-mt-14 relative">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div
              className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-app-hover ring-4 ring-white dark:ring-surface-900 shadow-lg flex-shrink-0 animate-pulse"
              aria-hidden
            />
            <div className="flex-1 min-w-0 pb-1 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-2">
                  <div className="h-7 sm:h-8 w-48 sm:w-64 rounded bg-app-hover animate-pulse" aria-hidden />
                  <div className="h-4 w-56 sm:w-72 rounded bg-app-hover animate-pulse" aria-hidden />
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <div className="h-9 w-24 rounded-lg bg-app-hover animate-pulse" aria-hidden />
                  <div className="h-9 w-28 rounded-lg bg-app-hover animate-pulse" aria-hidden />
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-6 w-20 rounded-full bg-app-hover animate-pulse" aria-hidden />
                ))}
              </div>
              <div className="h-3 w-full max-w-md rounded bg-app-hover animate-pulse mt-3" aria-hidden />
            </div>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-app-border pb-px">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-9 w-24 sm:w-28 rounded-t-md bg-app-hover animate-pulse mb-px" aria-hidden />
        ))}
      </div>

      {/* Overview grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="card space-y-4 animate-pulse">
            <div className="h-5 w-40 rounded bg-app-hover" aria-hidden />
            <div className="h-3 w-full rounded bg-app-hover" aria-hidden />
            <div className="h-3 w-4/5 rounded bg-app-hover" aria-hidden />
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="h-24 rounded-lg bg-app-hover" aria-hidden />
              <div className="h-24 rounded-lg bg-app-hover" aria-hidden />
            </div>
          </div>
          <div className="card space-y-3 animate-pulse">
            <div className="h-5 w-36 rounded bg-app-hover" aria-hidden />
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-4 w-full rounded bg-app-hover" aria-hidden />
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="card space-y-3 animate-pulse">
              <div className="h-4 w-24 rounded bg-app-hover" aria-hidden />
              <div className="h-8 w-16 rounded bg-app-hover" aria-hidden />
              <div className="h-3 w-full rounded bg-app-hover" aria-hidden />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
