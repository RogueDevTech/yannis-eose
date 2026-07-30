/**
 * Label for the "Carry-over Delivered" stat tile — orders delivered in the
 * selected period but generated in a prior month ("last month's orders that
 * delivered this month").
 *
 * When the active date filter is exactly one whole calendar month (e.g.
 * 2026-07-01 → 2026-07-31), the label names the month BEFORE it — the source
 * month the carry-over came from: "Carry-over → June". (The count itself
 * includes any prior month, not just the immediately-preceding one; June is
 * simply the representative/dominant source month.) For any other range (custom
 * span, partial month, all-time), it falls back to the period-agnostic
 * "Carry-over Delivered" — the active date filter already shows the exact range.
 *
 * Dates are the raw YYYY-MM-DD strings the marketing filters use. Parsing is
 * done on the numeric parts (no Date timezone games) so the boundary check is
 * exact regardless of the viewer's locale.
 */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Last calendar day of a given 1-indexed month in a year (handles leap Feb). */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

function parseYmd(value: string | undefined | null): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

export const CARRY_OVER_FALLBACK_LABEL = 'Carry-over Delivered';

/** The calendar month immediately before 1-indexed month `m1` of year `y`. */
function priorMonthName(y: number, m1: number): string {
  // m1 is 1-12; the prior month wraps December → previous year.
  const priorIndex0 = (m1 - 2 + 12) % 12; // 0-indexed month before m1
  return MONTH_NAMES[priorIndex0];
}

/**
 * Returns "Carry-over → <PriorMonth>" when [startDate, endDate] is exactly one
 * whole calendar month (naming the month BEFORE the selected one — the source
 * month the carry-over came from), otherwise "Carry-over Delivered".
 */
export function carryOverTileLabel(
  startDate: string | undefined | null,
  endDate: string | undefined | null,
): string {
  const start = parseYmd(startDate);
  const end = parseYmd(endDate);
  if (!start || !end) return CARRY_OVER_FALLBACK_LABEL;

  const isWholeMonth =
    start.y === end.y &&
    start.m === end.m &&
    start.d === 1 &&
    end.d === lastDayOfMonth(end.y, end.m);

  if (!isWholeMonth) return CARRY_OVER_FALLBACK_LABEL;
  return `Carry-over → ${priorMonthName(start.y, start.m)}`;
}
