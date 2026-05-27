import { useSearchParams } from '@remix-run/react';

/**
 * ClearFiltersButton — red pill showing active filter count + "Clear filters".
 * Clears all URL search params except those in `preserve` (e.g. `perPage`).
 * Reusable across any page with URL-driven filters.
 *
 * Usage:
 *   <ClearFiltersButton count={3} />
 *   <ClearFiltersButton count={3} preserve={['perPage']} />
 */

interface ClearFiltersButtonProps {
  /** Number of active filters. Button is hidden when 0. */
  count: number;
  /** URL param keys to keep when clearing (e.g. 'perPage'). */
  preserve?: string[];
  className?: string;
}

export function ClearFiltersButton({ count, preserve = [], className = '' }: ClearFiltersButtonProps) {
  const [, setSearchParams] = useSearchParams();

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => {
        setSearchParams((prev) => {
          const next = new URLSearchParams();
          for (const key of preserve) {
            const val = prev.get(key);
            if (val) next.set(key, val);
          }
          return next;
        });
      }}
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
