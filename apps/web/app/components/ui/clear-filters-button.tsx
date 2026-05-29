import { useSearchParams } from '@remix-run/react';

/**
 * ActiveFilter describes a single active filter for display as a dismissable pill.
 * `param` is the URL search param key(s) to remove when dismissed.
 */
export interface ActiveFilter {
  /** Display label, e.g. "Status: Confirmed" or "MB: Gbenga Soyinka". */
  label: string;
  /** URL param key(s) to remove when this pill is dismissed. */
  param: string | string[];
}

interface ClearFiltersButtonProps {
  /** Number of active filters. Component is hidden when 0. */
  count: number;
  /** URL param keys to keep when clearing all (e.g. 'perPage'). */
  preserve?: string[];
  /** Individual active filters to show as dismissable pills. Falls back to a single "Clear filters" button when omitted. */
  activeFilters?: ActiveFilter[];
  className?: string;
}

export function ClearFiltersButton({ count, preserve = [], activeFilters, className = '' }: ClearFiltersButtonProps) {
  const [, setSearchParams] = useSearchParams();

  if (count === 0) return null;

  const clearAll = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      for (const key of preserve) {
        const val = prev.get(key);
        if (val) next.set(key, val);
      }
      return next;
    });
  };

  const dismiss = (param: string | string[]) => {
    const keys = Array.isArray(param) ? param : [param];
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of keys) next.delete(key);
      next.set('page', '1');
      return next;
    });
  };

  // Individual pills mode
  if (activeFilters && activeFilters.length > 0) {
    return (
      <div className={['flex flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}>
        {activeFilters.map((f) => (
          <button
            key={typeof f.param === 'string' ? f.param : f.param.join(',')}
            type="button"
            onClick={() => dismiss(f.param)}
            className="inline-flex items-center gap-1 rounded-full bg-app-hover px-2.5 py-1 text-xs font-medium text-app-fg transition-colors hover:bg-danger-100 hover:text-danger-700 dark:hover:bg-danger-900/30 dark:hover:text-danger-400"
            title={`Remove filter: ${f.label}`}
          >
            {f.label}
            <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ))}
        {activeFilters.length > 1 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-danger-600 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300"
          >
            Clear all
          </button>
        )}
      </div>
    );
  }

  // Fallback: single "Clear filters" button
  return (
    <button
      type="button"
      onClick={clearAll}
      className={[
        'btn-danger btn-sm inline-flex items-center gap-1.5',
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className="inline-flex items-center justify-center h-4 min-w-4 rounded bg-white/25 text-white text-[10px] font-bold leading-none px-1">
        {count}
      </span>
      Clear filters
    </button>
  );
}
