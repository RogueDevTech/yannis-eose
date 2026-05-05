import { STATUS_COLORS, STATUS_DOT_CLASS, STATUS_LABELS, formatStatus } from '~/features/shared/order-status';

export interface OrderStatusBadgeProps {
  status: string;
  showDot?: boolean;
  className?: string;
}

export function OrderStatusBadge({ status, showDot = true, className }: OrderStatusBadgeProps) {
  const badgeClass = STATUS_COLORS[status] ?? 'badge';
  const dotClass = STATUS_DOT_CLASS[status] ?? 'bg-surface-400';
  const label = STATUS_LABELS[status] ?? formatStatus(status);

  return (
    <span className={[badgeClass, className].filter(Boolean).join(' ')}>
      {showDot && <span className={`status-dot ${dotClass}`} />}
      {label}
    </span>
  );
}
