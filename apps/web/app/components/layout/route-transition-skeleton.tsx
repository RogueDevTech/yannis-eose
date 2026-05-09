/**
 * Generic route-transition skeleton — rendered in place of `<Outlet />` while
 * Remix's loader is in flight for a NEW pathname. The point is purely
 * perceptual: replace the lingering "old page" content with a neutral skeleton
 * the moment the user clicks a sidebar link, so the swap feels instant
 * regardless of how long the destination loader actually takes.
 *
 * Why a generic shape instead of mapping URL → route-specific shell:
 *   - Admin pages share a common chrome (PageHeader, optional stat strip,
 *     content card). A neutral version of that chrome reads as "the page is
 *     loading" without misleading the user about exactly which sub-region
 *     will appear (filters, calendar, chart, etc.) — those vary too much.
 *   - URL → component lookup tables drift fast as routes are added. Keeping
 *     this layout-agnostic avoids that maintenance trap.
 *
 * Lifecycle:
 *   - DashboardLayout flips to render this when `useNavigation()` reports a
 *     pathname change (cross-route nav). NavProgressBar still renders at the
 *     top for cross-route progress feedback (not blocked).
 *   - Once the loader returns and Remix swaps to the new route, the route's
 *     own `<CachedAwait fallback>` (or `<Suspense fallback>`) takes over for
 *     the rest of the data wait. Total perceived states:
 *       old page → THIS skeleton (50–500 ms) → route-specific skeleton
 *       (≤ data fetch) → real content.
 *   - On REVISIT with a hot `cachedClientLoader` cache, the route mounts
 *     instantly with cached data; this skeleton flashes for one paint at most.
 */

export function RouteTransitionSkeleton() {
  return (
    <div className="space-y-4 animate-fade-in" aria-busy="true" aria-live="polite">
      {/* Page header — title + action bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-6 w-44 rounded-md bg-app-border/70 dark:bg-app-border/55 animate-pulse" />
          <div className="h-3.5 w-64 max-w-full rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-8 w-28 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
          <div className="h-8 w-24 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
        </div>
      </div>

      {/* Stat strip — most admin pages have one with 4–6 KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-app-border bg-app-elevated p-3 space-y-2"
          >
            <div className="h-3 w-16 rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
            <div className="h-5 w-12 rounded-md bg-app-border/70 dark:bg-app-border/55 animate-pulse" />
          </div>
        ))}
      </div>

      {/* Content card — toolbar + table-like rows */}
      <div className="rounded-lg border border-app-border bg-app-elevated">
        <div className="flex items-center gap-2 border-b border-app-border px-4 py-3">
          <div className="h-8 flex-1 max-w-md rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
          <div className="hidden sm:block h-8 w-32 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
          <div className="hidden md:block h-8 w-32 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
        </div>
        <div className="divide-y divide-app-border">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-24 rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
              <div className="h-4 flex-1 max-w-[14rem] rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
              <div className="hidden md:block h-4 w-20 rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
              <div className="hidden lg:block h-4 w-24 rounded bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
              <div className="h-6 w-16 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
