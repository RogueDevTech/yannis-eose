import { useRef } from 'react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { EmptyState } from '~/components/ui/empty-state';
import { OrderIdBadge } from '~/components/ui/order-id-badge';
import { SmartPick } from '~/components/ui/smart-pick';
import { StripToolbar } from '~/components/ui/strip-toolbar';
import type { DuplicatePair } from './types';

export function CSDashboardDuplicatesTabPanel({
  pairs,
  onView,
  selectedIds,
  onToggle,
  onPickFirst,
  onClearSelection,
  onBulkDismiss,
  bulkDismissBusy,
}: {
  pairs: DuplicatePair[];
  /** Opens the side-by-side compare modal; Merge/Dismiss live there. */
  onView: (pair: DuplicatePair) => void;
  selectedIds: Set<string>;
  onToggle: (orderId: string) => void;
  onPickFirst: (count: number) => void;
  onClearSelection: () => void;
  onBulkDismiss: () => void;
  bulkDismissBusy: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollBy = (delta: number) =>
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });

  return (
    <div className="h-[28rem] overflow-auto">
      <div className="space-y-4">
        <div className="card">
          {pairs.length > 0 && (
            <div className="mb-2 rounded-lg border border-app-border bg-app-elevated px-3 py-2 -mx-1 overflow-x-auto scrollbar-hide">
              <div className="flex min-w-max items-center gap-2 px-1">
                <SmartPick
                  total={pairs.length}
                  selectedCount={selectedIds.size}
                  onPick={onPickFirst}
                  onClear={onClearSelection}
                  itemNoun="duplicates"
                  compactMobile
                  className="shrink-0"
                />
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  disabled={selectedIds.size === 0 || bulkDismissBusy}
                  onClick={onBulkDismiss}
                >
                  Dismiss{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </Button>
              </div>
            </div>
          )}
          <StripToolbar
            title="Potential duplicates"
            description="Same phone in 24h = duplicate. Older within 30 days = possible duplicate. Merge or dismiss."
            onScrollLeft={pairs.length > 0 ? () => scrollBy(-280) : undefined}
            onScrollRight={pairs.length > 0 ? () => scrollBy(280) : undefined}
            scrollAriaSubject="duplicates"
            viewAllTo="/admin/sales/queue?tab=duplicates"
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
                const isSelected = selectedIds.has(pair.duplicate.id);
                const cardBorder = isSelected
                  ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md bg-app-elevated'
                  : isSoft
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
                  onClick={() => onToggle(pair.duplicate.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onToggle(pair.duplicate.id);
                    }
                  }}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  className={`group relative shrink-0 w-48 text-left rounded-xl border transition-all duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                    isSelected
                      ? 'border-brand-500 ring-1 ring-brand-500/40 shadow-md bg-app-elevated'
                      : cardBorder + ' hover:shadow-md'
                  }`}
                  title={
                    isSoft
                      ? 'Same phone has a non-cancelled order older than 24h but within 30 days.'
                      : 'Same phone has a non-cancelled order in the last 24 hours.'
                  }
                >
                  <span className="absolute top-1.5 left-1.5 z-10" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      onChange={() => onToggle(pair.duplicate.id)}
                      aria-label={`Select duplicate for ${pair.duplicate.customerName}`}
                    />
                  </span>
                  <span className="absolute top-2 right-2 flex h-2 w-2 pointer-events-none">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${dotPing}`} />
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${dotSolid}`} />
                  </span>

                  <div className="px-2.5 py-2 pl-7 pr-5">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                      <p className="text-xs font-semibold text-app-fg truncate leading-tight min-w-0 flex-1">
                        {pair.duplicate.customerName}
                      </p>
                      {pair.duplicate.totalAmount ? (
                        <span className="text-mini font-bold text-app-fg shrink-0 tabular-nums">
                          ₦{Number(pair.duplicate.totalAmount).toLocaleString('en-NG')}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-micro font-mono text-app-fg-muted truncate mb-1">
                      {pair.duplicate.customerPhoneDisplay ?? '—'}
                    </p>
                    <div className="flex items-center gap-1.5 mb-1 min-w-0">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-bold uppercase tracking-wide shrink-0 ${pillTone}`}>
                        {pillLabel}
                      </span>
                      <span className="text-micro font-medium text-app-fg-muted truncate">
                        {new Date(pair.duplicate.createdAt).toLocaleString('en-NG', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {pair.original ? (
                      <div className="text-micro text-app-fg-muted mb-1.5 truncate">
                        Orig:{' '}
                        <OrderIdBadge
                          id={pair.original.id}
                          length={8}
                          ellipsis=""
                          linkTo={`/admin/orders/${pair.original.id}`}
                          textClassName="text-micro text-brand-500 hover:text-brand-600"
                          className="inline-flex"
                        />
                      </div>
                    ) : (
                      <p className="text-micro text-warning-700 dark:text-warning-400 mb-1.5">
                        Original missing
                      </p>
                    )}

                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => onView(pair)}
                        className="text-mini font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                      >
                        View →
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
