import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import type { CSOrder } from './types';

/** Matches overview strip tiles for deferred cart stats (Cart Pending / Abandoned). */
export function CSCartOverviewStatTileSkeleton() {
  return (
    <div className="shrink-0 min-w-[5rem] text-center p-3 rounded-lg bg-app-hover" aria-hidden>
      <div className="h-3 w-14 mx-auto rounded bg-app-border/90 animate-pulse" />
      <div className="h-7 w-8 mx-auto mt-2 rounded bg-app-border/80 animate-pulse" />
      <div className="h-2.5 w-10 mx-auto mt-2 rounded bg-app-hover/80 animate-pulse opacity-70" />
    </div>
  );
}

/** Tab label badge pulse (claim queue / duplicates / callbacks counts). */
export function CSTabCountBadgeSkeleton() {
  return (
    <span
      className="ml-1.5 inline-flex w-5 h-5 shrink-0 items-center justify-center rounded-full bg-app-hover animate-pulse"
      aria-hidden
    />
  );
}

const claimQueueSkeletonCols: CompactTableColumn<CSOrder>[] = [
  { key: 'order', header: 'Order', render: () => null },
  { key: 'customer', header: 'Customer', render: () => null },
  { key: 'phone', header: 'Phone', render: () => null },
  { key: 'amount', header: 'Amount', align: 'right', render: () => null },
  { key: 'received', header: 'Received', nowrap: true, render: () => null },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    nowrap: true,
    mobileShowLabel: false,
    render: () => null,
  },
];

export function CSClaimQueueTabDeferredFallback() {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="space-y-2 min-w-0 flex-1">
            <div className="h-6 w-40 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-4 w-full max-w-xl rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-4 w-2/3 max-w-lg rounded bg-app-hover animate-pulse" aria-hidden />
          </div>
          <span className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-app-fg-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-app-hover animate-pulse" aria-hidden />
            Live
          </span>
        </div>
        <CompactTable<CSOrder>
          caption="Claim queue"
          columns={claimQueueSkeletonCols}
          rows={[]}
          rowKey={(o) => o.id}
          withCard={false}
          loading
          loadingVariant="overlay"
          emptyTitle="Loading claim queue…"
          emptyDescription="Available orders stream in shortly."
        />
      </div>
    </div>
  );
}

function CallbackOrDuplicateCardRowSkeleton({ tone }: { tone: 'neutral' | 'warning' }) {
  const border =
    tone === 'warning'
      ? 'border-warning-200/90 dark:border-warning-800/50 bg-warning-50/40 dark:bg-warning-950/15'
      : 'border-danger-200/80 dark:border-danger-800/60 bg-danger-50/25 dark:bg-danger-950/15';
  return (
    <div className={`rounded-lg border p-4 space-y-3 ${border}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex flex-wrap gap-2">
            <div className="h-6 w-24 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-5 w-20 rounded-full bg-app-hover animate-pulse" aria-hidden />
          </div>
          <div className="h-4 w-40 rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="h-3 w-56 rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="h-3 w-44 rounded bg-app-hover animate-pulse" aria-hidden />
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="h-8 w-16 rounded-md bg-app-hover animate-pulse" aria-hidden />
          <div className="h-8 w-20 rounded-md bg-app-hover animate-pulse" aria-hidden />
        </div>
      </div>
    </div>
  );
}

export function CSCallbacksTabDeferredFallback() {
  return (
    <div className="h-[28rem] overflow-hidden">
      <div className="space-y-4">
        <div className="card">
          <div className="mb-4 space-y-2">
            <div className="h-7 w-48 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-4 w-full max-w-lg rounded bg-app-hover animate-pulse" aria-hidden />
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((k) => (
              <CallbackOrDuplicateCardRowSkeleton key={k} tone="warning" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CSDuplicatesTabDeferredFallback() {
  return (
    <div className="h-[28rem] overflow-hidden">
      <div className="space-y-4">
        <div className="card">
          <div className="mb-4 space-y-2">
            <div className="h-7 w-52 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-4 w-full max-w-2xl rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-4 w-full max-w-xl rounded bg-app-hover animate-pulse" aria-hidden />
          </div>
          <div className="space-y-3">
            {[1, 2].map((k) => (
              <CallbackOrDuplicateCardRowSkeleton key={k} tone="neutral" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hot Swap tab: two searchable-select rows + horizontal order cards (lazy chunk Suspense). */
export function CSHotSwapTabSkeleton() {
  return (
    <div className="h-[28rem] overflow-auto" aria-busy="true">
      <div className="space-y-4">
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="h-7 w-32 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="flex gap-2">
              <div className="h-9 w-28 rounded-lg bg-app-hover animate-pulse" aria-hidden />
              <div className="h-9 w-36 rounded-lg bg-app-hover animate-pulse" aria-hidden />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="space-y-2">
              <div className="h-3 w-24 rounded bg-app-hover animate-pulse" aria-hidden />
              <div className="h-10 w-full rounded-lg border border-app-border bg-app-hover/80 animate-pulse" aria-hidden />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" aria-hidden />
              <div className="h-10 w-full rounded-lg border border-app-border bg-app-hover/80 animate-pulse" aria-hidden />
            </div>
          </div>
          <p className="text-xs text-app-fg-muted mb-2">Select orders to reassign</p>
          <div className="flex flex-nowrap gap-3 overflow-x-auto pb-1">
            {[1, 2, 3].map((k) => (
              <div
                key={k}
                className="shrink-0 w-64 rounded-xl border border-app-border bg-app-elevated p-3.5 pl-10 space-y-2 animate-pulse"
                aria-hidden
              >
                <div className="h-5 w-20 rounded bg-app-hover" />
                <div className="h-4 w-full rounded bg-app-hover" />
                <div className="h-3 w-24 rounded bg-app-hover" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
