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
 */

interface PageHeaderProps {
  title: string;
  /** Subtitle below the title. Plain string for short copy, or ReactNode when
   * the description needs inline elements (icons, badges, copyable IDs). */
  description?: React.ReactNode;
  /** Breadcrumb path shown above the title */
  breadcrumb?: React.ReactNode;
  /** Right-side action buttons / controls */
  actions?: React.ReactNode;
  /** Extra content below title/description (e.g. filter bar) */
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, breadcrumb, actions, children, className = '' }: PageHeaderProps) {
  return (
    <div className={['flex flex-col gap-2', className].filter(Boolean).join(' ')}>
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
        <div className="min-w-0 md:flex-1">
          <h1 className="text-xl font-bold text-app-fg md:truncate">{title}</h1>
          {description && (
            <div className="mt-0.5 min-w-0 break-words text-sm text-app-fg-muted">{description}</div>
          )}
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
            {actions}
          </div>
        )}
      </div>

      {children && <div>{children}</div>}
    </div>
  );
}
