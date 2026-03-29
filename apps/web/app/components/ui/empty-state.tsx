/**
 * EmptyState — shown when a list/table has no data.
 * Supports icon, title, description, and a CTA action.
 */

interface EmptyStateProps {
  /** Icon node (SVG, emoji, or any element) */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Primary CTA button/link */
  action?: React.ReactNode;
  /** Secondary/subtle CTA */
  secondaryAction?: React.ReactNode;
  /** 'page' fills available space; 'card' is compact; 'inline' is minimal */
  variant?: 'page' | 'card' | 'inline';
  /** Show a dashed border around the empty state */
  bordered?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'card',
  bordered = false,
  className = '',
}: EmptyStateProps) {
  const containerClass = {
    page: 'py-24',
    card: 'py-12',
    inline: 'py-6',
  }[variant];

  const iconSizeClass = {
    page: 'w-14 h-14',
    card: 'w-10 h-10',
    inline: 'w-8 h-8',
  }[variant];

  return (
    <div
      className={[
        'flex flex-col items-center justify-center text-center',
        containerClass,
        bordered ? 'rounded-xl border border-dashed border-app-border' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon && (
        <div
          className={[
            'mb-3 flex items-center justify-center rounded-xl bg-app-elevated text-app-fg-muted',
            iconSizeClass,
          ].join(' ')}
        >
          {icon}
        </div>
      )}

      <p
        className={[
          'font-semibold text-app-fg',
          variant === 'page' ? 'text-lg' : variant === 'card' ? 'text-base' : 'text-sm',
        ].join(' ')}
      >
        {title}
      </p>

      {description && (
        <p
          className={[
            'mt-1 max-w-sm text-app-fg-muted',
            variant === 'page' ? 'text-sm' : 'text-xs',
          ].join(' ')}
        >
          {description}
        </p>
      )}

      {(action || secondaryAction) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
