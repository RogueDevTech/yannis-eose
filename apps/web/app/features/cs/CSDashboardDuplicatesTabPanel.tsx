import { Link } from '@remix-run/react';
import { EmptyState } from '~/components/ui/empty-state';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import type { DuplicatePair } from './types';

export function CSDashboardDuplicatesTabPanel({
  pairs,
  fetcherIdle,
  onMerge,
  onDismiss,
}: {
  pairs: DuplicatePair[];
  fetcherIdle: boolean;
  onMerge: (pair: DuplicatePair) => void;
  onDismiss: (pair: DuplicatePair) => void;
}) {
  return (
    <div className="h-[28rem] overflow-auto">
      <div className="space-y-4">
        <div className="card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-app-fg">Potential duplicates</h2>
            <p className="text-sm text-app-fg-muted mt-0.5">
              New orders flagged because another non-cancelled order shares the same buyer phone within the last 6
              hours. Merge into the original or dismiss if this is a legitimate separate order.
            </p>
          </div>

          {pairs.length === 0 ? (
            <EmptyState title="No flagged duplicates" description="Nothing needs review right now." />
          ) : (
            <div className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1">
              {pairs.map((pair: DuplicatePair) => (
                <div
                  key={pair.duplicate.id}
                  className="group relative shrink-0 w-64 rounded-xl border border-danger-200 dark:border-danger-800/80 bg-danger-50/40 dark:bg-danger-900/15 transition-all duration-200 hover:shadow-md hover:border-danger-300 dark:hover:border-danger-700"
                >
                  <span className="absolute top-3 right-3 flex h-2.5 w-2.5 pointer-events-none">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-400 opacity-60" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger-500" />
                  </span>

                  <div className="p-3.5 pr-8">
                    <div className="mb-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-danger-100 dark:bg-danger-900/35 text-danger-700 dark:text-danger-400">
                        Flagged duplicate
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-app-fg truncate leading-tight mb-2 pr-1">
                      {pair.duplicate.customerName}
                    </p>
                    <p className="text-[11px] text-app-fg truncate mb-1">
                      <span className="font-mono">{pair.duplicate.customerPhoneDisplay ?? '—'}</span>
                      {pair.duplicate.totalAmount ? (
                        <span className="text-app-fg-muted">
                          {' · '}₦{Number(pair.duplicate.totalAmount).toLocaleString('en-NG')}
                        </span>
                      ) : null}
                    </p>
                    <div className="text-[11px] font-medium text-app-fg-muted">
                      {new Date(pair.duplicate.createdAt).toLocaleString('en-NG', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                    <div className="text-[11px] text-app-fg-muted mt-1 truncate">
                      <span className="text-app-fg-muted">Order: </span>
                      <OrderIdBadge
                        id={pair.duplicate.id}
                        length={8}
                        ellipsis=""
                        textClassName="text-[10px] text-app-fg-muted"
                        className="inline-flex"
                      />
                    </div>
                    {pair.original ? (
                      <div className="text-[11px] text-app-fg-muted mt-0.5 truncate">
                        <span className="text-app-fg-muted">Original: </span>
                        <OrderIdBadge
                          id={pair.original.id}
                          length={8}
                          ellipsis=""
                          linkTo={`/admin/orders/${pair.original.id}`}
                          textClassName="text-[10px] text-brand-500 hover:text-brand-600"
                          className="inline-flex"
                        />
                      </div>
                    ) : (
                      <p className="text-[11px] text-warning-700 dark:text-warning-400 mt-0.5">
                        Original missing — merge unavailable.
                      </p>
                    )}

                    <div className="mt-2 pt-2 border-t border-app-border/80 flex flex-wrap items-center gap-2.5">
                      <Link
                        to={`/admin/orders/${pair.duplicate.id}`}
                        className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        disabled={!pair.original || !fetcherIdle}
                        onClick={() => onMerge(pair)}
                        className="text-xs font-medium text-app-fg hover:underline disabled:opacity-50"
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        disabled={!fetcherIdle}
                        onClick={() => onDismiss(pair)}
                        className="text-xs font-medium text-danger-600 dark:text-danger-400 hover:underline disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
