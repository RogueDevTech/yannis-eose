/**
 * AssignCloserModal — shared modal for assigning/reassigning orders to Sales closers.
 *
 * Features:
 * - Search input to filter closers by name
 * - Infinite-scroll pagination (renders a batch at a time, loads more on scroll)
 * - Multi-select via checkboxes
 *
 * Used by: CSDashboardPage (Sales Live Activities) and OrdersListPage (Sales Orders).
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Modal } from '~/components/ui/modal';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { SearchInput } from '~/components/ui/search-input';
import { ModalFetcherInlineError } from '~/hooks/use-fetcher-action-surface';

export interface CloserOption {
  value: string;
  label: string;
}

interface AssignCloserModalProps {
  open: boolean;
  onClose: () => void;
  /** Total number of selected orders. */
  selectedCount: number;
  /** Available closer options (pre-filtered for capacity etc. by the caller). */
  options: CloserOption[];
  /** Currently selected closer IDs. */
  selectedIds: Set<string>;
  /** Toggle a closer's selection. */
  onToggle: (id: string) => void;
  /** Fires when the user clicks Assign / Reassign. */
  onSubmit: () => void;
  /** Whether an assignment request is in flight. */
  isSubmitting: boolean;
  /** Optional inline error message from the fetcher. */
  errorMessage?: string | null;
  /** 'assign' or 'reassign' — changes title and button label. */
  mode?: 'assign' | 'reassign';
  /** Empty-state message when no closers are available. */
  emptyMessage?: string;
}

const PAGE_SIZE = 20;

export function AssignCloserModal({
  open,
  onClose,
  selectedCount,
  options,
  selectedIds,
  onToggle,
  onSubmit,
  isSubmitting,
  errorMessage,
  mode = 'assign',
  emptyMessage = 'No closers available.',
}: AssignCloserModalProps) {
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reset search + pagination when modal opens/closes or options change
  useEffect(() => {
    if (open) {
      setSearch('');
      setVisibleCount(PAGE_SIZE);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase().trim();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleCount < filtered.length;

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore) return;
    // Load more when within 80px of the bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
    }
  }, [hasMore, filtered.length]);

  // Reset visible count when search changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [search]);

  const isAssign = mode === 'assign';
  const title = isAssign
    ? 'Assign to closer'
    : `Reassign ${selectedCount} order${selectedCount !== 1 ? 's' : ''} to closers`;
  const buttonLabel = isAssign ? 'Assign' : 'Reassign';
  const loadingText = isAssign ? 'Assigning…' : 'Reassigning…';

  return (
    <Modal
      open={open}
      onClose={() => {
        if (isSubmitting) return;
        onClose();
      }}
      maxWidth="max-w-md"
      backdropBlur
      contentClassName="p-0 max-h-[min(32rem,90dvh)] overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 border-b border-app-border px-4 py-3">
        <h2 className="text-lg font-semibold text-app-fg">{title}</h2>
        <p className="text-sm text-app-fg-muted mt-0.5">
          {selectedCount} order{selectedCount !== 1 ? 's' : ''} selected
        </p>
        <p className="text-xs text-app-fg-muted mt-1.5">
          Select one or more closers — selected orders are split among them at random.
        </p>
      </div>

      {/* Search */}
      <form onSubmit={(e) => e.preventDefault()} className="shrink-0 px-4 pt-3 pb-1">
        <SearchInput
          placeholder="Search closers…"
          value={search}
          onChange={setSearch}
          controlSize="sm"
          withSubmitButton
          wrapperClassName="w-full"
        />
      </form>

      {errorMessage && (
        <ModalFetcherInlineError message={errorMessage} className="shrink-0 px-4 pt-2" />
      )}

      {/* Closer list with infinite scroll */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-2 space-y-1.5"
      >
        {options.length === 0 ? (
          <p className="text-sm text-app-fg-muted py-2">{emptyMessage}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-app-fg-muted py-2">No closers matching &ldquo;{search}&rdquo;</p>
        ) : (
          <>
            {visible.map((opt) => {
              const checked = selectedIds.has(opt.value);
              return (
                <label
                  key={opt.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                    checked
                      ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40 text-app-fg ring-1 ring-brand-500/30'
                      : 'border-app-border bg-app-elevated hover:border-brand-300 dark:hover:border-brand-700'
                  }`}
                >
                  <Checkbox
                    className="mt-0.5 shrink-0"
                    checked={checked}
                    onChange={() => onToggle(opt.value)}
                    aria-label={opt.label}
                  />
                  <span className="min-w-0 flex-1 text-left leading-snug">{opt.label}</span>
                </label>
              );
            })}
            {hasMore && (
              <p className="text-center text-xs text-app-fg-muted py-2">
                Showing {visible.length} of {filtered.length} — scroll for more
              </p>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-end gap-2 border-t border-app-border px-4 py-3">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isSubmitting}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={selectedCount === 0 || selectedIds.size === 0 || options.length === 0 || isSubmitting}
          loading={isSubmitting}
          loadingText={loadingText}
          onClick={onSubmit}
        >
          {buttonLabel}
        </Button>
      </div>
    </Modal>
  );
}
