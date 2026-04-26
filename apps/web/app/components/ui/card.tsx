/**
 * Card — base surface card with consistent padding, shadow, and border.
 * Use for panels, stat cards, form sections, and list items.
 *
 * CardHeader, CardBody, and CardFooter are optional sub-components
 * for structured cards with distinct sections.
 */

type CardVariant = 'default' | 'elevated' | 'flat' | 'outlined' | 'ghost';
type CardPadding = 'none' | 'sm' | 'md' | 'lg';

interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  /** Clickable card — adds hover + cursor-pointer */
  interactive?: boolean;
  /** Show a danger/warning/success border accent */
  accent?: 'danger' | 'warning' | 'success' | 'info' | 'brand';
  className?: string;
  children: React.ReactNode;
  /** Works for any `as` element (`div`, `li`, etc.) */
  onClick?: React.MouseEventHandler<HTMLElement>;
  as?: 'div' | 'article' | 'section' | 'li';
}

const variantClasses: Record<CardVariant, string> = {
  default: 'bg-app-elevated border border-app-border shadow-card',
  elevated: 'bg-app-elevated border border-app-border shadow-md',
  flat: 'bg-app-elevated border border-app-border',
  outlined: 'bg-transparent border border-app-border',
  ghost: 'bg-transparent',
};

const paddingClasses: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const accentClasses: Record<NonNullable<CardProps['accent']>, string> = {
  danger: 'border-l-4 border-l-danger-500',
  warning: 'border-l-4 border-l-warning-500',
  success: 'border-l-4 border-l-success-500',
  info: 'border-l-4 border-l-info-500',
  brand: 'border-l-4 border-l-brand-500',
};

export function Card({
  variant = 'default',
  padding = 'md',
  interactive = false,
  accent,
  className = '',
  children,
  onClick,
  as: Tag = 'div',
}: CardProps) {
  return (
    <Tag
      onClick={onClick}
      className={[
        'rounded-xl transition-colors',
        variantClasses[variant],
        paddingClasses[padding],
        accent ? accentClasses[accent] : '',
        interactive ? 'cursor-pointer hover:shadow-card-hover hover:bg-app-hover' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Tag>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface CardHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Right-side actions/badge slot */
  actions?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, className = '' }: CardHeaderProps) {
  return (
    <div className={['flex items-start justify-between gap-3 mb-4', className].filter(Boolean).join(' ')}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-app-fg">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-app-fg-muted">{description}</p>}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

interface CardBodyProps {
  className?: string;
  children: React.ReactNode;
}

export function CardBody({ className = '', children }: CardBodyProps) {
  return <div className={className}>{children}</div>;
}

interface CardFooterProps {
  className?: string;
  children: React.ReactNode;
}

export function CardFooter({ className = '', children }: CardFooterProps) {
  return (
    <div
      className={[
        'mt-4 border-t border-app-border pt-4 flex flex-wrap items-center justify-between gap-2',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

// ─── Stat Card (common KPI card pattern) ─────────────────────────────────────

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Optional change indicator */
  change?: { value: string; positive: boolean };
  icon?: React.ReactNode;
  /** Accent bar color on the left */
  accent?: CardProps['accent'];
  loading?: boolean;
  className?: string;
}

export function StatCard({ label, value, change, icon, accent, loading = false, className = '' }: StatCardProps) {
  return (
    <Card variant="default" padding="md" accent={accent} className={className}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-app-fg-muted truncate">{label}</p>
          {loading ? (
            <div className="mt-1.5 h-6 w-24 animate-pulse rounded bg-app-hover" />
          ) : (
            <p className="mt-1 text-2xl font-bold text-app-fg tabular-nums">{value}</p>
          )}
          {change && !loading && (
            <p
              className={[
                'mt-1 text-xs font-medium',
                change.positive ? 'text-success-600 dark:text-success-400' : 'text-danger-600 dark:text-danger-400',
              ].join(' ')}
            >
              {change.positive ? '↑' : '↓'} {change.value}
            </p>
          )}
        </div>
        {icon && (
          <div className="shrink-0 rounded-lg bg-app-hover p-2 text-app-fg-muted">{icon}</div>
        )}
      </div>
    </Card>
  );
}
