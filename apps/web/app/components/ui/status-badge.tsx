/**
 * StatusBadge — generic colored badge for any status string.
 * Extend `STATUS_COLOR_MAP` with new status values as they are introduced.
 *
 * For order-specific statuses use <OrderStatusBadge> which has richer dot styling.
 */

import { STATUS_LABELS as ORDER_STATUS_LABELS } from '~/features/shared/order-status';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
type BadgeSize = 'sm' | 'md' | 'lg';

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-success-50 text-success-700 border border-success-200 dark:bg-success-900/20 dark:text-success-400 dark:border-success-800',
  warning: 'bg-warning-50 text-warning-700 border border-warning-200 dark:bg-warning-900/20 dark:text-warning-400 dark:border-warning-800',
  danger: 'bg-danger-50 text-danger-700 border border-danger-200 dark:bg-danger-900/20 dark:text-danger-400 dark:border-danger-800',
  info: 'bg-info-50 text-info-700 border border-info-200 dark:bg-info-900/20 dark:text-info-400 dark:border-info-800',
  neutral: 'bg-surface-100 text-surface-600 border border-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:border-surface-700',
  brand: 'bg-brand-50 text-brand-700 border border-brand-200 dark:bg-brand-900/20 dark:text-brand-400 dark:border-brand-800',
};

const dotColorClasses: Record<BadgeVariant, string> = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  neutral: 'bg-surface-400',
  brand: 'bg-brand-500',
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'text-2xs px-1.5 py-0.5 gap-1',
  md: 'text-xs px-2 py-0.5 gap-1.5',
  lg: 'text-sm px-2.5 py-1 gap-1.5',
};

/**
 * A map from arbitrary status string → badge variant.
 * Add entries here as new status values are introduced across modules.
 */
const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  // Generic
  active: 'success',
  inactive: 'neutral',
  enabled: 'success',
  disabled: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'danger',
  completed: 'success',
  failed: 'danger',
  draft: 'neutral',
  archived: 'neutral',
  // Finance / Funding
  sent: 'info',
  received: 'success',
  disputed: 'danger',
  paid: 'success',
  unpaid: 'warning',
  overdue: 'danger',
  partial: 'warning',
  // Marketing
  running: 'success',
  paused: 'warning',
  ended: 'neutral',
  // Push delivery
  delivered: 'success',
  shown: 'info',
  clicked: 'brand',
  // Misc
  new: 'brand',
  open: 'info',
  closed: 'neutral',
  resolved: 'success',
  escalated: 'danger',
  // Staff onboarding
  not_started: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
};

interface StatusBadgeProps {
  /** The status string to display */
  status: string;
  /** Explicit variant override — inferred from status string if omitted */
  variant?: BadgeVariant;
  /** Custom display label — defaults to formatted status string */
  label?: string;
  showDot?: boolean;
  size?: BadgeSize;
  className?: string;
}

function formatStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({
  status,
  variant,
  label,
  showDot = false,
  size = 'md',
  className = '',
}: StatusBadgeProps) {
  const resolvedVariant = variant ?? STATUS_VARIANT_MAP[status.toLowerCase()] ?? 'neutral';
  const displayLabel = label ?? ORDER_STATUS_LABELS[status] ?? formatStatusLabel(status);

  return (
    <span
      className={[
        'inline-flex items-center rounded-full font-medium leading-none',
        variantClasses[resolvedVariant],
        sizeClasses[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showDot && (
        <span
          className={[
            'rounded-full shrink-0',
            dotColorClasses[resolvedVariant],
            size === 'lg' ? 'w-2 h-2' : 'w-1.5 h-1.5',
          ].join(' ')}
        />
      )}
      {displayLabel}
    </span>
  );
}
