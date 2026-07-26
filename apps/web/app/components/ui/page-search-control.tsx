import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { SearchInput } from '~/components/ui/search-input';

export type PageSearchControlProps = {
  /** Currently applied search string (drives the active chip). */
  value: string;
  /** Called with a trimmed query when the user applies, or `''` when cleared. */
  onApply: (query: string) => void;
  placeholder?: string;
  /** Modal heading. Default "Search". */
  title?: string;
  /** Accessible name for the toolbar icon. Default "Search". */
  'aria-label'?: string;
  className?: string;
};

function SearchIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
    </svg>
  );
}

/**
 * Compact toolbar search: icon opens a modal; active query shows as a chip.
 * Use in `ToolbarFiltersCollapsible` `searchRow` instead of an always-visible `SearchInput`.
 */
export function PageSearchControl({
  value,
  onApply,
  placeholder = 'Search…',
  title = 'Search',
  'aria-label': ariaLabel = 'Search',
  className = '',
}: PageSearchControlProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const applied = value.trim();

  useEffect(() => {
    if (open) {
      setDraft(value);
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open, value]);

  const close = () => setOpen(false);

  const apply = (raw: string) => {
    onApply(raw.trim());
    close();
  };

  return (
    <>
      <div className={['flex min-w-0 items-center gap-1.5', className].filter(Boolean).join(' ')}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={applied ? `Search: ${applied}` : ariaLabel}
          aria-label={applied ? `Search (active: ${applied})` : ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={[
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors',
            applied
              ? 'border-brand-500/40 bg-brand-500/10 text-brand-600 dark:text-brand-400'
              : 'border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover hover:text-app-fg',
          ].join(' ')}
        >
          <SearchIcon />
        </button>
        {applied ? (
          <div className="flex min-w-0 max-w-[14rem] items-center rounded-full border border-app-border bg-app-hover text-xs text-app-fg">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="min-w-0 truncate px-2 py-1 text-left hover:text-brand-600 dark:hover:text-brand-400"
              title={applied}
            >
              {applied}
            </button>
            <button
              type="button"
              aria-label="Clear search"
              className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-app-fg-muted hover:bg-app-border hover:text-app-fg"
              onClick={() => onApply('')}
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>

      {open ? (
        <Modal
          open
          onClose={close}
          maxWidth="max-w-md"
          backdropBlur
          aria-labelledby={titleId}
          contentClassName="p-0 overflow-hidden"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply(draft);
            }}
            className="flex flex-col"
          >
            <div className="border-b border-app-border px-4 py-3">
              <h2 id={titleId} className="text-base font-semibold text-app-fg">
                {title}
              </h2>
            </div>
            <div className="px-4 py-4">
              <SearchInput
                ref={inputRef}
                value={draft}
                onChange={setDraft}
                placeholder={placeholder}
                clearable
                withSubmitButton={false}
                wrapperClassName="w-full"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-app-border px-4 py-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDraft('');
                  apply('');
                }}
                disabled={!draft.trim() && !applied}
              >
                Clear
              </Button>
              <Button type="submit" variant="primary" size="sm">
                Search
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
