/**
 * Reserved stock release for orders stuck with logistics (reserved-stock
 * ticket, 2026-11-12, owner rule).
 *
 * Allocating an order to a logistics location reserves its stock until the
 * order is delivered, returned or retracked. Orders that sit allocated for
 * weeks kept that stock locked, so CS could not allocate new orders against it.
 *
 * Rule: once an order has held its reservation for N days (per-company setting
 * STOCK_RESERVATION_RELEASE_CONFIG, default 30, 0 = never), the reservation is
 * released automatically. The order keeps its status; `orders.reservation_released_at`
 * records the release so no later step releases it a second time. Authorised
 * users (`inventory.reservations.release`) can also release one early.
 */
export const DEFAULT_RESERVATION_RELEASE_DAYS = 30;
export const RESERVATION_RELEASE_SETTING_KEY = 'STOCK_RESERVATION_RELEASE_CONFIG';
export const MAX_RESERVATION_RELEASE_DAYS = 365;

/** Days after allocation before the reservation is released; 0 = never. */
export function resolveReservationReleaseDays(value: unknown): number {
  const days = (value as { days?: unknown } | null | undefined)?.days;
  if (typeof days !== 'number' || !Number.isInteger(days)) return DEFAULT_RESERVATION_RELEASE_DAYS;
  if (days < 0 || days > MAX_RESERVATION_RELEASE_DAYS) return DEFAULT_RESERVATION_RELEASE_DAYS;
  return days;
}

/** Default "overdue at logistics" threshold, same as the default release delay. */
export const OVERDUE_ALLOCATION_DAYS = DEFAULT_RESERVATION_RELEASE_DAYS;

/** Statuses in which an order holds reserved stock at its logistics location. */
export const STOCK_HOLDING_STATUSES = ['AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since allocation, or null when the order has no allocation date. */
export function daysSinceAllocation(
  allocatedAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!allocatedAt) return null;
  const t = new Date(allocatedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

export function isOverdueAllocation(
  status: string | null | undefined,
  allocatedAt: Date | string | null | undefined,
  now: Date = new Date(),
  thresholdDays: number = OVERDUE_ALLOCATION_DAYS,
): boolean {
  if (!status || !(STOCK_HOLDING_STATUSES as readonly string[]).includes(status)) return false;
  const days = daysSinceAllocation(allocatedAt, now);
  return days != null && days >= thresholdDays;
}
