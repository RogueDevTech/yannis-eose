import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import type { Reconciliation } from './types';

/**
 * Layout-matched fallback while low-stock alerts stream on Stock Levels tab.
 */
export function LowStockAlertsDeferredFallback() {
  return (
    <div className="rounded-lg border border-warning-300 dark:border-warning-700 bg-warning-50 dark:bg-warning-900/20 px-3 py-3 sm:px-4">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded bg-warning-200/70 dark:bg-warning-800/50 shrink-0 animate-pulse" aria-hidden />
        <div className="h-4 flex-1 max-w-md rounded bg-warning-200/60 dark:bg-warning-800/40 animate-pulse" aria-hidden />
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="rounded-md border border-warning-200/90 dark:border-warning-800/80 bg-app-elevated/90 dark:bg-warning-950/25 px-2.5 py-2 shadow-sm space-y-2 min-w-0"
          >
            <div className="h-3.5 w-full rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-3 w-2/3 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-3.5 w-12 rounded bg-app-hover animate-pulse" aria-hidden />
          </div>
        ))}
      </div>
    </div>
  );
}

const reconSkeletonColumns: CompactTableColumn<Reconciliation>[] = [
  { key: 'location', header: 'Location', minWidth: 'min-w-[140px]', render: () => null },
  { key: 'product', header: 'Product', render: () => null },
  { key: 'digital', header: 'Digital', align: 'right', render: () => null },
  { key: 'physical', header: 'Physical', align: 'right', render: () => null },
  { key: 'discrepancy', header: 'Discrepancy', align: 'right', render: () => null },
  { key: 'reason', header: 'Reason', render: () => null },
  { key: 'status', header: 'Status', render: () => null },
  { key: 'date', header: 'Date', nowrap: true, render: () => null },
];

/** Layout-matched fallback for reconciliation tab `CompactTable`. */
export function ReconciliationTableDeferredFallback() {
  return (
    <div className="card p-0">
      <CompactTable<Reconciliation>
        caption="Stock reconciliations"
        columns={reconSkeletonColumns}
        rows={[]}
        rowKey={(r) => r.id}
        withCard={false}
        className="min-w-[960px]"
        loading
        loadingVariant="overlay"
        emptyTitle="Loading reconciliations…"
        emptyDescription="Rows appear when streamed data resolves."
      />
    </div>
  );
}
