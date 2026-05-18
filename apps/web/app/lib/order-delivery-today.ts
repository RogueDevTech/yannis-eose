/** Org ops default — matches CS schedule heat / `orders.list` delivery filters. */
const LAGOS_TZ = 'Africa/Lagos';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Statuses where a “due today” delivery reminder is no longer meaningful. */
const TERMINAL_FOR_DUE_TAG = new Set([
  'DELIVERED',
  'REMITTED',
  'CANCELLED',
  'RETURNED',
  'WRITTEN_OFF',
  'RESTOCKED',
]);

/** Today’s calendar date in Lagos as `YYYY-MM-DD` (for comparison to `preferred_delivery_date`). */
export function getLagosCalendarYmd(reference: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: LAGOS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);
}

export function isPreferredDeliveryDueToday(
  preferredDeliveryDate: string | null | undefined,
  orderStatus: string,
): boolean {
  if (!preferredDeliveryDate?.trim()) return false;
  const d = preferredDeliveryDate.trim();
  if (!ISO_DATE.test(d)) return false;
  if (TERMINAL_FOR_DUE_TAG.has(orderStatus)) return false;
  return d === getLagosCalendarYmd();
}

/** Preferred delivery date is earlier than today (Lagos), order not yet in a terminal state. */
export function isPreferredDeliveryOverdue(
  preferredDeliveryDate: string | null | undefined,
  orderStatus: string,
): boolean {
  if (!preferredDeliveryDate?.trim()) return false;
  const d = preferredDeliveryDate.trim();
  if (!ISO_DATE.test(d)) return false;
  if (TERMINAL_FOR_DUE_TAG.has(orderStatus)) return false;
  return d < getLagosCalendarYmd();
}

/** Callback scheduled for now/earlier — still actionable, not terminal yet. */
export function isCallbackDue(
  callbackScheduledAt: string | null | undefined,
  orderStatus: string,
): boolean {
  if (!callbackScheduledAt) return false;
  if (TERMINAL_FOR_DUE_TAG.has(orderStatus)) return false;
  const t = Date.parse(callbackScheduledAt);
  if (Number.isNaN(t)) return false;
  return t <= Date.now();
}
