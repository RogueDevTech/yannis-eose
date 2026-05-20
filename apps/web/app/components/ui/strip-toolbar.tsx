import { Link } from '@remix-run/react';
import { Button } from './button';

/**
 * Toolbar that sits above a horizontally-scrollable card strip.
 *
 * Left side: tab title + small description (always rendered).
 * Right side: optional left/right scroll arrows + optional View all link.
 *
 * Used across the Sales queue tabs (`/admin/sales/queue`) so every strip — Unassigned,
 * Duplicates, Cart Abandonment, Callbacks, Hot Swap — gets the same chrome.
 *
 * The arrows are the consumer's responsibility — wire `onScrollLeft` and
 * `onScrollRight` to a ref-backed `scrollBy({ left: ±n, behavior: 'smooth' })`
 * on the strip element. When both are omitted the arrow cluster is hidden.
 */
export interface StripToolbarProps {
  /** Tab title — displayed in bold on the left. */
  title: string;
  /** Short helper line under the title. Optional but recommended. */
  description?: React.ReactNode;
  /** Wire to `ref.current?.scrollBy({ left: -N, behavior: 'smooth' })`. */
  onScrollLeft?: () => void;
  onScrollRight?: () => void;
  /** Label for scroll-arrow `aria-label` ("Scroll <X> left/right"). */
  scrollAriaSubject?: string;
  /** When set, renders a `<Link>`-wrapped "View all" Button to this URL. */
  viewAllTo?: string;
  viewAllLabel?: string;
  /** Extra classes for the outer wrapper. */
  className?: string;
}

export function StripToolbar({
  title,
  description,
  onScrollLeft,
  onScrollRight,
  scrollAriaSubject = 'strip',
  viewAllTo,
  viewAllLabel = 'View all',
  className,
}: StripToolbarProps) {
  const showArrows = Boolean(onScrollLeft || onScrollRight);

  return (
    <div
      className={[
        'flex flex-wrap items-start justify-between gap-2 mb-2',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-app-fg leading-tight">{title}</h3>
        {description ? (
          <p className="text-xs text-app-fg-muted mt-0.5">{description}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {showArrows ? (
          <div className="hidden md:flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={onScrollLeft}
              disabled={!onScrollLeft}
              className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center disabled:opacity-40"
              aria-label={`Scroll ${scrollAriaSubject} left`}
            >
              <svg
                className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onScrollRight}
              disabled={!onScrollRight}
              className="p-1 sm:p-1.5 rounded-md sm:rounded-lg border border-app-border bg-app-elevated text-app-fg-muted hover:bg-app-hover transition-colors flex items-center justify-center disabled:opacity-40"
              aria-label={`Scroll ${scrollAriaSubject} right`}
            >
              <svg
                className="w-3.5 h-3.5 sm:w-5 sm:h-5 stroke-1 sm:stroke-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        ) : null}
        {viewAllTo ? (
          <Link to={viewAllTo} prefetch="intent">
            <Button type="button" variant="secondary" size="sm">
              {viewAllLabel}
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
