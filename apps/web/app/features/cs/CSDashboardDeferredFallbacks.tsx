import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import type { CSLeaderboardEntry, CSOrder } from './types';

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

const leaderboardSkeletonCols: CompactTableColumn<CSLeaderboardEntry>[] = [
  { key: 'rank', header: '#', render: () => null },
  { key: 'closer', header: 'Closer', render: () => null },
  { key: 'engaged', header: 'Engaged', align: 'right', render: () => null },
  { key: 'confirmed', header: 'Confirmed', align: 'right', render: () => null },
  { key: 'delivered', header: 'Delivered', align: 'right', render: () => null },
  { key: 'calls', header: 'Calls', align: 'right', render: () => null },
  { key: 'confRate', header: 'Conf. Rate', align: 'right', render: () => null },
  { key: 'delRate', header: 'Del. Rate', align: 'right', render: () => null },
  { key: 'avgCall', header: 'Avg Call', align: 'right', render: () => null },
];

export function CSLeaderboardTabDeferredFallback() {
  return (
    <div className="card p-0 flex flex-col h-[28rem]" aria-busy="true">
      <div className="px-4 py-3 border-b border-app-border shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-6 w-48 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-3 w-64 rounded bg-app-hover animate-pulse" aria-hidden />
          </div>
          <div className="flex gap-1 rounded-lg bg-app-hover p-1">
            <div className="h-8 w-24 rounded-md bg-app-elevated/50 animate-pulse" aria-hidden />
            <div className="h-8 w-20 rounded-md bg-app-elevated/50 animate-pulse" aria-hidden />
          </div>
        </div>
      </div>
      <div className="isolate flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3">
        <CompactTable<CSLeaderboardEntry>
          caption="Closer performance"
          columns={leaderboardSkeletonCols}
          rows={[]}
          rowKey={(e) => e.agentId}
          withCard={false}
          className="min-w-[900px]"
          loading
          loadingVariant="overlay"
          emptyTitle="Loading leaderboard…"
          emptyDescription="Performance data is streaming."
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
