/**
 * Pagination — Previous / Page X of Y / Next controls.
 * Works both as a controlled component and via URL search params.
 *
 * URL mode (preferred for server-rendered pages):
 *   <Pagination page={currentPage} totalPages={total} />
 *   — generates <Link> with ?page=N search params (preserves other params)
 *
 * Callback mode (for client-side tables):
 *   <Pagination page={currentPage} totalPages={total} onPageChange={setPage} />
 */

import { Link, useSearchParams } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { FormSelect } from '~/components/ui/form-select';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';

interface PaginationProps {
  page: number;
  totalPages: number;
  /** If provided, clicking changes the URL search param instead of calling onPageChange */
  pageParam?: string;
  /** Callback mode — provide to avoid URL navigation */
  onPageChange?: (page: number) => void;
  /** Show "Page X of Y" label */
  showLabel?: boolean;
  /** Show first/last jump buttons */
  showEdgeButtons?: boolean;
  /** Number of sibling pages shown around the current page */
  siblingCount?: number;
  className?: string;
  /**
   * When true, still render Prev / Page X of Y / Next when there is only one page
   * (buttons disabled as appropriate). Hidden when `totalPages` is 0.
   */
  showWhenSinglePage?: boolean;
  /**
   * Per-page picker. Pass an array of page-size choices (e.g. `[20, 50, 100]`) and the
   * current `pageSize` to render a "Per page" picker beside the controls. URL mode reads
   * from `?perPage=<n>` (or whatever `pageSizeParam` is) and resets to page 1 on change;
   * callback mode fires `onPageSizeChange`. Without `pageSizeOptions` no picker renders —
   * existing call sites are untouched.
   */
  pageSizeOptions?: number[];
  pageSize?: number;
  pageSizeParam?: string;
  onPageSizeChange?: (size: number) => void;
}

function buildPages(page: number, total: number, siblings: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const left = Math.max(2, page - siblings);
  const right = Math.min(total - 1, page + siblings);

  const pages: (number | '...')[] = [1];
  if (left > 2) pages.push('...');
  for (let i = left; i <= right; i++) pages.push(i);
  if (right < total - 1) pages.push('...');
  pages.push(total);
  return pages;
}

export function Pagination({
  page,
  totalPages,
  pageParam = 'page',
  onPageChange,
  showLabel = true,
  showEdgeButtons = false,
  siblingCount = 1,
  className = '',
  showWhenSinglePage = false,
  pageSizeOptions,
  pageSize,
  pageSizeParam = 'perPage',
  onPageSizeChange,
}: PaginationProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  // Loader-refetch indicator: in URL mode the loader re-runs on click; in callback mode the
  // consumer manages loading. We arm a local "navigating" flag the moment a click happens so
  // the spinner paints on the same frame as the click; clear it when the loader settles.
  const refetchBusy = useLoaderRefetchBusy();
  const [callbackNavigating, setCallbackNavigating] = useState(false);
  const callbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // In callback mode there's no router signal; we auto-clear after a short window so the
  // spinner doesn't get stuck if the consumer's update is synchronous.
  useEffect(() => {
    return () => {
      if (callbackTimerRef.current) clearTimeout(callbackTimerRef.current);
    };
  }, []);
  const isPaginating = onPageChange ? callbackNavigating : refetchBusy.busy;
  const armCallbackNavigating = () => {
    setCallbackNavigating(true);
    if (callbackTimerRef.current) clearTimeout(callbackTimerRef.current);
    callbackTimerRef.current = setTimeout(() => setCallbackNavigating(false), 1200);
  };

  // Picker is exposed when the caller passes a current `pageSize` (the URL-driven limit).
  // We default the choices to [20, 50, 100] so individual list pages don't need to repeat
  // the options array — just pass `pageSize={limit}` and the picker appears. Pages can
  // still override with `pageSizeOptions` when they want a different set.
  const resolvedPageSizeOptions =
    Array.isArray(pageSizeOptions) && pageSizeOptions.length > 0
      ? pageSizeOptions
      : [20, 50, 100];
  const showPageSizePicker = typeof pageSize === 'number';

  if (totalPages < 1 && !showPageSizePicker) return null;
  if (totalPages === 1 && !showWhenSinglePage && !showPageSizePicker) return null;

  function commitPageSize(nextSize: number) {
    if (typeof pageSize === 'number' && nextSize === pageSize) return;
    if (onPageSizeChange) {
      onPageSizeChange(nextSize);
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(pageSizeParam, String(nextSize));
        // Always reset to page 1 — landing on "page 5 of /20" then switching to /50
        // would silently scroll past rows.
        next.delete(pageParam);
        return next;
      },
      { replace: true, preventScrollReset: true },
    );
  }

  function buildHref(p: number) {
    const params = new URLSearchParams(searchParams);
    params.set(pageParam, String(p));
    return `?${params.toString()}`;
  }

  function PageItem({ p, label }: { p: number; label?: React.ReactNode }) {
    const isActive = p === page;
    const content = label ?? p;
    const btnClass = [
      'flex h-8 min-w-[2rem] items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors',
      isActive
        ? 'bg-brand-500 text-white'
        : 'text-app-fg hover:bg-app-hover',
    ].join(' ');

    if (onPageChange) {
      return (
        <button
          type="button"
          onClick={() => {
            armCallbackNavigating();
            onPageChange(p);
          }}
          className={btnClass}
          aria-current={isActive ? 'page' : undefined}
        >
          {content}
        </button>
      );
    }

    return (
      <Link
        to={buildHref(p)}
        className={btnClass}
        aria-current={isActive ? 'page' : undefined}
        prefetch="intent"
        onClick={() => refetchBusy.primeSamePathRefetch()}
      >
        {content}
      </Link>
    );
  }

  function NavBtn({ p, label, disabled }: { p: number; label: React.ReactNode; disabled: boolean }) {
    const btnClass = [
      'flex h-8 items-center gap-1 rounded-lg px-2.5 text-sm font-medium transition-colors',
      disabled
        ? 'cursor-not-allowed text-app-fg-muted opacity-40'
        : 'text-app-fg hover:bg-app-hover',
    ].join(' ');

    if (disabled) return <span className={btnClass}>{label}</span>;

    if (onPageChange) {
      return (
        <button
          type="button"
          onClick={() => {
            armCallbackNavigating();
            onPageChange(p);
          }}
          className={btnClass}
        >
          {label}
        </button>
      );
    }

    return (
      <Link
        to={buildHref(p)}
        className={btnClass}
        prefetch="intent"
        onClick={() => refetchBusy.primeSamePathRefetch()}
      >
        {label}
      </Link>
    );
  }

  const pages = buildPages(page, totalPages, siblingCount);

  return (
    <nav
      aria-label="Pagination"
      className={['flex flex-wrap items-center justify-center gap-1', className].filter(Boolean).join(' ')}
    >
      {showEdgeButtons && (
        <NavBtn p={1} label="«" disabled={page === 1} />
      )}

      <NavBtn
        p={page - 1}
        disabled={page === 1}
        label={
          <>
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
            </svg>
            <span className="sr-only sm:not-sr-only">Prev</span>
          </>
        }
      />

      {showLabel ? (
        <span className="px-3 text-sm text-app-fg-muted inline-flex items-center gap-2">
          Page <span className="font-semibold text-app-fg">{page}</span> of{' '}
          <span className="font-semibold text-app-fg">{totalPages}</span>
          {isPaginating ? <PaginationSpinner /> : null}
        </span>
      ) : (
        <>
          {pages.map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className="flex h-8 w-8 items-center justify-center text-sm text-app-fg-muted">
                …
              </span>
            ) : (
              <PageItem key={p} p={p} />
            )
          )}
          {isPaginating ? (
            <span className="ml-1 inline-flex items-center">
              <PaginationSpinner />
            </span>
          ) : null}
        </>
      )}

      <NavBtn
        p={page + 1}
        disabled={page === totalPages}
        label={
          <>
            <span className="sr-only sm:not-sr-only">Next</span>
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
            </svg>
          </>
        }
      />

      {showEdgeButtons && (
        <NavBtn p={totalPages} label="»" disabled={page === totalPages} />
      )}

      {showPageSizePicker ? (
        <div className="ml-3 inline-flex items-center gap-1.5 text-xs text-app-fg-muted">
          <label htmlFor="pagination-per-page" className="whitespace-nowrap">
            Per page
          </label>
          <FormSelect
            id="pagination-per-page"
            value={String(pageSize)}
            onChange={(e) => commitPageSize(Number.parseInt(e.target.value, 10))}
            options={resolvedPageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
            controlSize="sm"
            wrapperClassName="min-w-[4.5rem]"
            className="font-medium"
            aria-label="Rows per page"
          />
        </div>
      ) : null}
    </nav>
  );
}

/** Small inline spinner shown next to the page label / number row while a page change is in flight. */
function PaginationSpinner() {
  return (
    <svg
      className="w-3.5 h-3.5 animate-spin text-app-fg-muted"
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
