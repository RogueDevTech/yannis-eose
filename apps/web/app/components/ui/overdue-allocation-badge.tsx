import {
  OVERDUE_ALLOCATION_DAYS,
  STOCK_HOLDING_STATUSES,
  daysSinceAllocation,
  isOverdueAllocation,
} from '@yannis/shared';

const PILL = 'inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-semibold';

/**
 * Tag for orders still with logistics (allocated, dispatched or in transit):
 * - "Stock released": the reserved stock was released (automatically after
 *   the company's N days, or manually); the order keeps its status.
 * - "Overdue Nd": past the release limit, waiting for the hourly release.
 * Renders nothing otherwise.
 */
export function OverdueAllocationBadge({
  status,
  allocatedAt,
  reservationReleasedAt,
  thresholdDays = OVERDUE_ALLOCATION_DAYS,
}: {
  status?: string | null;
  allocatedAt?: string | Date | null;
  reservationReleasedAt?: string | Date | null;
  thresholdDays?: number;
}) {
  const withLogistics = !!status && (STOCK_HOLDING_STATUSES as readonly string[]).includes(status);
  if (!withLogistics) return null;
  const days = daysSinceAllocation(allocatedAt);
  if (reservationReleasedAt) {
    return (
      <span
        className={`${PILL} bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300`}
        title={`With logistics for ${days ?? '?'} days. Its reserved stock was released; delivering it still deducts stock.`}
      >
        Stock released
      </span>
    );
  }
  if (thresholdDays <= 0 || !isOverdueAllocation(status, allocatedAt, new Date(), thresholdDays)) return null;
  return (
    <span
      className={`${PILL} bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-300`}
      title={`With logistics for ${days} days (limit ${thresholdDays}). Its reserved stock is released automatically.`}
    >
      Overdue {days}d
    </span>
  );
}
