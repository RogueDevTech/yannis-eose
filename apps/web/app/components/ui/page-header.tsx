/**
 * PageHeader — consistent title + description + action buttons row used at the
 * top of every feature page.
 *
 * Usage:
 *   <PageHeader
 *     title="Products"
 *     description="Manage your product catalogue"
 *     actions={<Button>Add Product</Button>}
 *   />
 *
 *   // Inner page with back button:
 *   <PageHeader title="New Form" backTo="/admin/marketing/forms" />
 */

import { Link } from '@remix-run/react';

interface PageHeaderProps {
  /** Page title. Usually a string; accepts a node so loading shells can pass a
   *  skeleton placeholder and still reuse the real header chrome. */
  title: React.ReactNode;
  /** Subtitle below the title. Plain string for short copy, or ReactNode when
   * the description needs inline elements (icons, badges, copyable IDs). */
  description?: React.ReactNode;
  /** Breadcrumb path shown above the title */
  breadcrumb?: React.ReactNode;
  /** Link target for a back arrow rendered inline before the title.
   *  Use on detail / create / edit pages that have a clear parent list. */
  backTo?: string;
  /** Right-side action buttons / controls */
  actions?: React.ReactNode;
  /** Keep compact mobile actions on the title row; description stays below. */
  mobileInlineActions?: boolean;
  /** Extra content below title/description (e.g. filter bar) */
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumb,
  backTo,
  actions,
  mobileInlineActions = false,
  children,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={['flex flex-col gap-2 pb-3 md:pb-0', className].filter(Boolean).join(' ')}>
      {breadcrumb && <div className="text-xs text-app-fg-muted">{breadcrumb}</div>}

      {/*
       * Layout — CEO directive 2026-05-11. Below `md`, title + description and
       * actions stack vertically so the heading gets the full row width
       * instead of being truncated by a wide actions block. From `md` up, the
       * original side-by-side row applies (title shrinks, actions pinned
       * right). Consumers that need a tighter mobile chrome use
       * `<PageHeaderMobileTools>` inside `actions` to collapse buttons into a
       * kebab sheet on top of this layout.
       */}
      <div className="flex flex-col gap-3 md:flex-row md:flex-nowrap md:items-start md:gap-3">
        <div
          className={[
            'min-w-0 md:flex-1',
            mobileInlineActions && actions ? 'relative pr-20 md:pr-0' : '',
          ].join(' ')}
        >
          <div className="flex items-center gap-2 min-w-0">
            {backTo && (
              <Link
                to={backTo}
                prefetch="intent"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-app-fg-muted hover:bg-surface-100 hover:text-app-fg dark:hover:bg-surface-800 transition-colors"
                aria-label="Go back"
              >
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
                </svg>
              </Link>
            )}
            <h1 className="min-w-0 text-xl font-bold text-app-fg md:truncate">{title}</h1>
          </div>
          {actions && mobileInlineActions ? (
            <div className="absolute right-0 top-0 flex shrink-0 items-center justify-end md:hidden">
              {actions}
            </div>
          ) : null}
          {description && (
            // CEO directive 2026-05-19: hide page-description on mobile across
            // every admin surface — title + filters carry enough context, and
            // descriptions were creating top-of-page clutter on small screens.
            // Desktop keeps the description (room to spare).
            <div className="mt-0.5 hidden min-w-0 break-words text-sm text-app-fg-muted md:block">{description}</div>
          )}
        </div>

        {actions && (
          <div
            className={[
              mobileInlineActions ? 'hidden md:flex' : 'flex',
              'flex-wrap items-center gap-2 md:shrink-0 md:justify-end',
            ].join(' ')}
          >
            {actions}
          </div>
        )}
      </div>

      {children && <div>{children}</div>}
    </div>
  );
}
