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
import { useEffect, useRef, useState, useMemo } from 'react';
import { useIsMobile } from '~/hooks/useIsMobile';
import { Modal } from '~/components/ui/modal';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { CONTROL_HEIGHT_CLASS } from '~/components/ui/_control-heights';

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
  /** Horizontal alignment of the controls within their row. @default 'center' */
  align?: 'start' | 'center' | 'end';
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
  align = 'center',
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
  const isMobile = useIsMobile();
  // Mobile caps at 500 rows; desktop allows up to 1000.
  const MOBILE_MAX = 500;
  const resolvedPageSizeOptions = useMemo(() => {
    const base =
      Array.isArray(pageSizeOptions) && pageSizeOptions.length > 0
        ? pageSizeOptions
        : [20, 50, 100, 200, 400, 500, 600, 800, 1000];
    return isMobile ? base.filter((n) => n <= MOBILE_MAX) : base;
  }, [pageSizeOptions, isMobile]);
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
      `flex ${CONTROL_HEIGHT_CLASS} min-w-[2.5rem] md:min-w-[2.25rem] items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors`,
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
        prefetch="none"
      >
        {content}
      </Link>
    );
  }

  function NavBtn({ p, label, disabled }: { p: number; label: React.ReactNode; disabled: boolean }) {
    const btnClass = [
      `flex ${CONTROL_HEIGHT_CLASS} items-center gap-1 rounded-lg px-3 md:px-2.5 text-sm font-medium transition-colors`,
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
        prefetch="none"
      >
        {label}
      </Link>
    );
  }

  const pages = buildPages(page, totalPages, siblingCount);

  const alignClass = align === 'end' ? 'justify-end' : align === 'start' ? 'justify-start' : 'justify-center';

  const navControls = (
    <div className={`flex items-center gap-1 ${isMobile ? 'justify-between w-full' : alignClass}`}>
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
        <PageJumpTrigger
          page={page}
          totalPages={totalPages}
          isPaginating={isPaginating}
          onSelect={(p) => {
            if (onPageChange) {
              armCallbackNavigating();
              onPageChange(p);
            }
            // URL-mode: pointerdown capture handler in useLoaderRefetchBusy
            // already arms the overlay — no need to call primeSamePathRefetch
            // here (flushSync during a click handler kills the Link navigation).
          }}
          buildHref={onPageChange ? undefined : buildHref}
        />
      ) : (
        <>
          {pages.map((p, i) =>
            p === '...' ? (
              <span key={`ellipsis-${i}`} className={`flex ${CONTROL_HEIGHT_CLASS} w-10 md:w-9 items-center justify-center text-sm text-app-fg-muted`}>
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
    </div>
  );

  // On mobile, stack nav controls and per-page picker vertically for a cleaner layout.
  // On desktop, keep everything inline.
  if (isMobile && showPageSizePicker) {
    return (
      <nav
        aria-label="Pagination"
        className={['flex flex-col items-center gap-0.5', className].filter(Boolean).join(' ')}
      >
        {navControls}
        <PageSizePicker
          pageSize={pageSize as number}
          options={resolvedPageSizeOptions}
          onSelect={commitPageSize}
        />
      </nav>
    );
  }

  return (
    <nav
      aria-label="Pagination"
      className={[
        'flex flex-wrap items-center gap-1',
        alignClass,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {navControls}

      {showPageSizePicker ? (
        <PageSizePicker
          pageSize={pageSize as number}
          options={resolvedPageSizeOptions}
          onSelect={commitPageSize}
        />
      ) : null}
    </nav>
  );
}

/**
 * Page jump trigger — tappable "Page X of Y" label that opens a modal listing all pages.
 * Uses Link navigation in URL mode, callback in controlled mode.
 */
function PageJumpTrigger({
  page,
  totalPages,
  isPaginating,
  onSelect,
  buildHref,
}: {
  page: number;
  totalPages: number;
  isPaginating: boolean;
  onSelect: (p: number) => void;
  /** When provided (URL mode), renders Links instead of buttons. */
  buildHref?: (p: number) => string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-2 text-sm text-app-fg-muted inline-flex items-center gap-1.5 rounded-lg transition-colors hover:bg-app-hover"
        aria-haspopup="dialog"
      >
        {/* Grid icon — visual hint that the label is tappable */}
        <svg className="h-3.5 w-3.5 text-app-fg-muted" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6" rx="1" />
          <rect x="9" y="1" width="6" height="6" rx="1" />
          <rect x="1" y="9" width="6" height="6" rx="1" />
          <rect x="9" y="9" width="6" height="6" rx="1" />
        </svg>
        <span>
          Page <span className="font-semibold text-app-fg">{page}</span> of{' '}
          <span className="font-semibold text-app-fg">{totalPages}</span>
        </span>
        {isPaginating ? <PaginationSpinner /> : null}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="max-w-sm"
        aria-labelledby="page-jump-title"
      >
        <div className="px-5 pb-1 pt-5">
          <h2 id="page-jump-title" className="text-base font-semibold text-app-fg">
            Go to page
          </h2>
          <p className="mt-0.5 text-sm text-app-fg-muted">
            {totalPages} {totalPages === 1 ? 'page' : 'pages'} available.
          </p>
        </div>
        <div className="p-3 max-h-72 overflow-y-auto">
          <div className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
              const isActive = p === page;
              const cls = [
                'flex items-center justify-center rounded-lg py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-app-fg hover:bg-app-hover',
              ].join(' ');

              if (buildHref && !isActive) {
                return (
                  <Link
                    key={p}
                    to={buildHref(p)}
                    className={cls}
                    prefetch="none"
                    onClick={() => {
                      onSelect(p);
                      setOpen(false);
                    }}
                  >
                    {p}
                  </Link>
                );
              }

              return (
                <button
                  key={p}
                  type="button"
                  disabled={isActive}
                  onClick={() => {
                    onSelect(p);
                    setOpen(false);
                  }}
                  className={cls}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * "Per page" picker — a compact button that opens a modal to choose the rows-per-page size.
 * Replaces the inline native <select>: on mobile the modal slides up from the bottom, giving
 * a larger tap target than a cramped dropdown.
 */
function PageSizePicker({
  pageSize,
  options,
  onSelect,
}: {
  pageSize: number;
  options: number[];
  onSelect: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`ml-3 inline-flex ${CONTROL_HEIGHT_CLASS} items-center gap-1.5 rounded-lg border border-app-border px-2.5 text-xs font-medium text-app-fg transition-colors hover:bg-app-hover`}
        aria-haspopup="dialog"
      >
        <span className="text-app-fg-muted">Per page</span>
        <span className="font-semibold">{pageSize}</span>
        <svg className="h-3.5 w-3.5 text-app-fg-muted" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth="max-w-sm"
        aria-labelledby="page-size-picker-title"
      >
        <div className="px-5 pb-1 pt-5">
          <h2 id="page-size-picker-title" className="text-base font-semibold text-app-fg">
            Rows per page
          </h2>
          <p className="mt-0.5 text-sm text-app-fg-muted">Choose how many rows to show per page.</p>
        </div>
        <div className="p-3">
          {options.map((size) => {
            const isActive = size === pageSize;
            return (
              <button
                key={size}
                type="button"
                onClick={() => {
                  onSelect(size);
                  setOpen(false);
                }}
                className={[
                  'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                    : 'text-app-fg hover:bg-app-hover',
                ].join(' ')}
                aria-current={isActive ? 'true' : undefined}
              >
                <span>{size} rows</span>
                {isActive ? (
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z" clipRule="evenodd" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      </Modal>
    </>
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
