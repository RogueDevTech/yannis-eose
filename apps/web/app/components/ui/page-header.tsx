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
  description?: string;
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

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-app-fg">{title}</h1>
          {description && (
            <p className="mt-0.5 text-sm text-app-fg-muted">{description}</p>
          )}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {children && <div>{children}</div>}
    </div>
  );
}
