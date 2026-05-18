import { STATUS_COLORS, STATUS_DOT_CLASS, STATUS_LABELS, formatStatus } from '~/features/shared/order-status';

export interface OrderStatusBadgeProps {
  status: string;
  showDot?: boolean;
  className?: string;
  /**
   * When false (default), the post-confirmation logistics sub-stages
   * (AGENT_ASSIGNED, DISPATCHED, IN_TRANSIT) render as "Confirmed" — this
   * keeps general admin / CS / Marketing surfaces aligned with the CEO's
   * 6-bucket vocabulary (Unassigned · Assigned · Unconfirmed · Confirmed ·
   * Delivered · Cash Remitted). Logistics + 3PL surfaces pass `expanded`
   * to keep the granular sub-stage they need to drive ops.
   */
  expanded?: boolean;
}

const COLLAPSED_TO_CONFIRMED = new Set(['AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT']);

export function OrderStatusBadge({ status, showDot = true, className, expanded = false }: OrderStatusBadgeProps) {
  const effectiveStatus = !expanded && COLLAPSED_TO_CONFIRMED.has(status) ? 'CONFIRMED' : status;
  const badgeClass = STATUS_COLORS[effectiveStatus] ?? 'badge';
  const dotClass = STATUS_DOT_CLASS[effectiveStatus] ?? 'bg-surface-400';
  const label = STATUS_LABELS[effectiveStatus] ?? formatStatus(effectiveStatus);

  return (
    <span className={[badgeClass, className].filter(Boolean).join(' ')}>
      {showDot && <span className={`status-dot ${dotClass}`} />}
      {label}
    </span>
  );
}
