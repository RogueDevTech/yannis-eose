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

      {/* Single row: title/description shrink/truncate; actions stay right (never wrap under title). */}
      <div className="flex flex-nowrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-app-fg">{title}</h1>
          {description && (
            <div className="mt-0.5 min-w-0 break-words text-sm text-app-fg-muted">{description}</div>
          )}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
        )}
      </div>

      {children && <div>{children}</div>}
    </div>
  );
}
