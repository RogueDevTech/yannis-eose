import { useRef } from 'react';
import { Link } from '@remix-run/react';
import { EmptyState } from '~/components/ui/empty-state';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { StripToolbar } from '~/components/ui/strip-toolbar';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBy = (delta: number) =>
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  return (
    <div className="h-[28rem] overflow-auto">
      <div className="space-y-4">
        <div className="card">
          <StripToolbar
            title="Potential duplicates"
            description={
              <>
                <span className="font-semibold text-danger-700 dark:text-danger-400">Duplicate</span> = same buyer
                phone in the last 24 hours.{' '}
                <span className="font-semibold text-warning-700 dark:text-warning-400">Possibly dup</span> = same
                phone older than 24 hours but within 30 days. Merge into the original or dismiss.
              </>
            }
            onScrollLeft={pairs.length > 0 ? () => scrollBy(-280) : undefined}
            onScrollRight={pairs.length > 0 ? () => scrollBy(280) : undefined}
            scrollAriaSubject="duplicates"
            viewAllTo="/admin/cs/queue?tab=duplicates"
          />

          {pairs.length === 0 ? (
            <EmptyState title="No flagged duplicates" description="Nothing needs review right now." />
          ) : (
            <div
              ref={scrollRef}
              className="flex flex-nowrap gap-3 overflow-x-auto overflow-y-hidden scrollbar-hide pb-1"
            >
              {pairs.map((pair: DuplicatePair) => {
                const isSoft = pair.flagKind === 'POSSIBLY_DUPLICATE';
                const cardBorder = isSoft
                  ? 'border-warning-200 dark:border-warning-800/80 bg-warning-50/30 dark:bg-warning-900/10 hover:border-warning-300 dark:hover:border-warning-700'
                  : 'border-danger-200 dark:border-danger-800/80 bg-danger-50/40 dark:bg-danger-900/15 hover:border-danger-300 dark:hover:border-danger-700';
                const dotPing = isSoft ? 'bg-warning-400' : 'bg-danger-400';
                const dotSolid = isSoft ? 'bg-warning-500' : 'bg-danger-500';
                const pillTone = isSoft
                  ? 'bg-warning-100 dark:bg-warning-900/35 text-warning-700 dark:text-warning-400'
                  : 'bg-danger-100 dark:bg-danger-900/35 text-danger-700 dark:text-danger-400';
                const pillLabel = isSoft ? 'Possibly dup' : 'Duplicate';
                return (
                <div
                  key={pair.duplicate.id}
                  className={`group relative shrink-0 w-48 rounded-xl border transition-all duration-200 hover:shadow-md ${cardBorder}`}
                  title={
                    isSoft
                      ? 'Same phone has a non-cancelled order older than 24h but within 30 days.'
                      : 'Same phone has a non-cancelled order in the last 24 hours.'
                  }
                >
                  <span className="absolute top-2 right-2 flex h-2 w-2 pointer-events-none">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${dotPing}`} />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${dotSolid}`} />
                  </span>

                  <div className="px-2.5 py-2 pr-5">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-app-fg truncate leading-tight min-w-0 flex-1">
                        {pair.duplicate.customerName}
                      </p>
                      {pair.duplicate.totalAmount ? (
                        <span className="text-[11px] font-bold text-app-fg shrink-0 tabular-nums">
                          ₦{Number(pair.duplicate.totalAmount).toLocaleString('en-NG')}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[10px] font-mono text-app-fg-muted truncate mb-1">
                      {pair.duplicate.customerPhoneDisplay ?? '—'}
                    </p>
                    <div className="flex items-center gap-1.5 mb-1 min-w-0">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide shrink-0 ${pillTone}`}>
                        {pillLabel}
                      </span>
                      <span className="text-[10px] font-medium text-app-fg-muted truncate">
                        {new Date(pair.duplicate.createdAt).toLocaleString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {pair.original ? (
                      <div className="text-[10px] text-app-fg-muted mb-1.5 truncate">
                        Orig:{' '}
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
                      <p className="text-[10px] text-warning-700 dark:text-warning-400 mb-1.5">
                        Original missing
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/admin/orders/${pair.duplicate.id}`}
                        className="text-[11px] font-medium text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        View
                      </Link>
                      <button
                        type="button"
                        disabled={!pair.original || !fetcherIdle}
                        onClick={() => onMerge(pair)}
                        className="text-[11px] font-medium text-app-fg hover:underline disabled:opacity-50"
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        disabled={!fetcherIdle}
                        onClick={() => onDismiss(pair)}
                        className="text-[11px] font-medium text-danger-600 dark:text-danger-400 hover:underline disabled:opacity-50"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
