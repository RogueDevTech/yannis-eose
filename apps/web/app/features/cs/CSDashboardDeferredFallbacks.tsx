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
      className="ml-1 inline-flex w-4 h-4 shrink-0 items-center justify-center rounded-full bg-app-hover animate-pulse"
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

/**
 * Compact w-48 card skeleton — mirrors the new compact strip cards used by
 * Unassigned Queue, Hot Swap, Duplicates, Callbacks and Cart abandonment
 * (~CEO directive 2026-05 compaction). One pulsing dot top-right, name +
 * amount on row 1, status pill + secondary line on row 2, action hints on
 * row 3.
 */
function CompactStripCardSkeleton({
  tone,
  withCheckbox,
}: {
  tone: 'neutral' | 'warning' | 'danger';
  withCheckbox?: boolean;
}) {
  const border =
    tone === 'danger'
      ? 'border-danger-200 dark:border-danger-800/80 bg-danger-50/40 dark:bg-danger-900/15'
      : tone === 'warning'
        ? 'border-warning-200 dark:border-warning-800/60 bg-app-elevated'
        : 'border-app-border bg-app-elevated';
  const dot =
    tone === 'danger'
      ? 'bg-danger-400'
      : tone === 'warning'
        ? 'bg-warning-400'
        : 'bg-app-fg-muted/40';
  return (
    <div
      className={`relative shrink-0 w-48 rounded-xl border ${border}`}
      aria-hidden
    >
      <span className={`absolute top-2 right-2 inline-flex h-2 w-2 rounded-full ${dot} animate-pulse`} />
      {withCheckbox ? (
        <span className="absolute top-1.5 left-1.5 inline-block h-4 w-4 rounded border border-app-border bg-app-hover/80 animate-pulse" />
      ) : null}
      <div className={`px-2.5 py-2 pr-5 ${withCheckbox ? 'pl-7' : ''} space-y-1.5`}>
        <div className="flex items-center justify-between gap-2">
          <div className="h-3 flex-1 rounded bg-app-hover animate-pulse" />
          <div className="h-3 w-12 rounded bg-app-hover animate-pulse shrink-0" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-14 rounded bg-app-hover animate-pulse" />
          <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-8 rounded bg-app-hover animate-pulse" />
          <div className="h-3 w-12 rounded bg-app-hover animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/** Mirrors the StripToolbar header that sits above each scroll strip
 *  (title + small description + scroll arrows + "View all" button). */
function StripToolbarSkeleton({
  withDescription = true,
  withViewAll = true,
}: {
  withDescription?: boolean;
  withViewAll?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 mb-2"
      aria-hidden
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="h-4 w-40 rounded bg-app-hover animate-pulse" />
        {withDescription ? (
          <div className="h-3 w-full max-w-md rounded bg-app-hover animate-pulse" />
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="hidden md:flex items-center gap-1.5">
          <div className="h-7 w-7 rounded-md border border-app-border bg-app-hover animate-pulse" />
          <div className="h-7 w-7 rounded-md border border-app-border bg-app-hover animate-pulse" />
        </div>
        {withViewAll ? (
          <div className="h-7 w-20 rounded-md bg-app-hover animate-pulse" />
        ) : null}
      </div>
    </div>
  );
}

export function CSCallbacksTabDeferredFallback() {
  return (
    <div className="h-[28rem] overflow-hidden">
      <div className="space-y-3">
        <StripToolbarSkeleton />
        <div className="flex flex-nowrap gap-3 overflow-x-hidden pb-1">
          {[1, 2, 3, 4].map((k) => (
            <CompactStripCardSkeleton key={k} tone="warning" />
          ))}
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
          <StripToolbarSkeleton />
          <div className="flex flex-nowrap gap-3 overflow-x-hidden pb-1">
            {[1, 2, 3].map((k) => (
              <CompactStripCardSkeleton key={k} tone="danger" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hot Swap tab: StripToolbar + two searchable-select rows + horizontal compact cards. */
export function CSHotSwapTabSkeleton() {
  return (
    <div className="h-[28rem] overflow-auto" aria-busy="true">
      <div className="space-y-4">
        <div className="card">
          <StripToolbarSkeleton />
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
          <div className="flex flex-nowrap gap-3 overflow-x-hidden pb-1">
            {[1, 2, 3, 4].map((k) => (
              <CompactStripCardSkeleton key={k} tone="warning" withCheckbox />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
