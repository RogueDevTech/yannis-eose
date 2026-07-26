import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { csOrdersStatPulseStripItems } from '~/features/cs/CSDeferredLoadingShells';

/**
 * Data-region skeleton only — use under a real page header so chrome stays visible while queue bundle streams.
 */
export function CSQueueDataSkeleton() {
  return (
    <div className="space-y-4">
      <OverviewStatStrip items={csOrdersStatPulseStripItems()} />

      {/* Live carts card */}
      <div className="card">
        <div className="h-4 w-36 rounded bg-app-hover mb-2 animate-pulse" />
        <div className="h-3 w-full max-w-md rounded bg-app-hover mb-3 animate-pulse" />
        <div className="min-h-[15rem] flex flex-col">
          <div className="overflow-x-auto -mx-4 px-4 flex-1 min-h-0">
            <div className="w-full text-sm table-fixed min-w-[520px]" role="presentation">
              <div className="grid grid-cols-5 gap-2 border-b border-app-border pb-2 mb-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={`h-${i}`} className="h-3 rounded bg-app-hover animate-pulse" />
                ))}
              </div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="grid grid-cols-5 gap-2 py-2.5 border-b border-app-border/60">
                  <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
                  <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
                  <div className="h-3 w-28 rounded bg-app-hover animate-pulse" />
                  <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
                  <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-app-border shrink-0">
            <div className="h-3 w-32 rounded bg-app-hover animate-pulse" />
            <div className="flex gap-1">
              <div className="h-8 w-12 rounded bg-app-hover animate-pulse" />
              <div className="h-8 w-12 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* Closer workloads section */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="h-5 w-36 rounded bg-app-hover animate-pulse" />
          <div className="flex gap-2">
            <div className="h-9 w-9 rounded-lg bg-app-hover animate-pulse" />
            <div className="h-9 w-9 rounded-lg bg-app-hover animate-pulse" />
            <div className="h-8 w-16 rounded bg-app-hover animate-pulse" />
          </div>
        </div>
        <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card shrink-0 w-64 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-app-hover shrink-0 animate-pulse" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="h-4 w-24 rounded bg-app-hover animate-pulse" />
                  <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
                </div>
              </div>
              <div className="w-full h-2 rounded-full bg-app-hover animate-pulse" />
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Tabs row + toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border pb-0">
        <div className="flex gap-1 flex-1 min-w-0">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-9 w-24 rounded-t bg-app-hover shrink-0 animate-pulse" />
          ))}
        </div>
        <div className="h-8 w-24 rounded bg-app-hover shrink-0 -mb-px animate-pulse" />
      </div>

      {/* Tab content: table card */}
      <div className="card p-0">
        <div className="hidden md:block overflow-x-auto px-1">
          <div className="w-full min-w-[720px]" role="presentation">
            <div className="grid grid-cols-7 gap-2 border-b border-app-border px-3 py-2">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={`th-${i}`} className="h-3 rounded bg-app-hover animate-pulse" />
              ))}
            </div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid grid-cols-7 gap-2 items-center px-3 py-3 border-b border-app-border/60">
                <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
                <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
                <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
                <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
                <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
                <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
                <div className="h-6 w-16 rounded bg-app-hover justify-self-start animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Page skeleton for Live Activities (/admin/sales/queue) and legacy CS dashboard layout.
 * Mirrors the layout of CSDashboardPage so the loading state matches the final UI.
 */
export function CSOverviewSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Page header */}
      <div>
        <div className="h-8 w-48 rounded bg-app-hover" />
        <div className="h-4 w-80 rounded bg-app-hover mt-2" />
      </div>

      <CSQueueDataSkeleton />
    </div>
  );
}
