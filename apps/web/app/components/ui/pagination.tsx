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
}: PaginationProps) {
  const [searchParams] = useSearchParams();

  if (totalPages <= 1) return null;

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
        <button type="button" onClick={() => onPageChange(p)} className={btnClass} aria-current={isActive ? 'page' : undefined}>
          {content}
        </button>
      );
    }

    return (
      <Link to={buildHref(p)} className={btnClass} aria-current={isActive ? 'page' : undefined} prefetch="intent">
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
        <button type="button" onClick={() => onPageChange(p)} className={btnClass}>
          {label}
        </button>
      );
    }

    return (
      <Link to={buildHref(p)} className={btnClass} prefetch="intent">
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
        <span className="px-3 text-sm text-app-fg-muted">
          Page <span className="font-semibold text-app-fg">{page}</span> of{' '}
          <span className="font-semibold text-app-fg">{totalPages}</span>
        </span>
      ) : (
        pages.map((p, i) =>
          p === '...' ? (
            <span key={`ellipsis-${i}`} className="flex h-8 w-8 items-center justify-center text-sm text-app-fg-muted">
              …
            </span>
          ) : (
            <PageItem key={p} p={p} />
          )
        )
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
    </nav>
  );
}
