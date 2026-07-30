/**
 * Label for the "Carry-over Delivered" stat tile — orders delivered in the
 * LAST month of the selected range but generated before that month began
 * ("orders carried over into the range's final month").
 *
 * The count is anchored server-side to the range's last calendar month, so the
 * label names the month BEFORE that final month — the source month the
 * carry-over came from. For a July filter that is "Carry-over → June"; for a
 * May–July range it is still "Carry-over → June" (June-and-earlier orders that
 * delivered in July). The month comes from `endDate`, matching the query.
 *
 * When the range's final month is only partially covered (endDate is not the
 * last day of its month) the "last month" framing is fuzzy, so it falls back to
 * the period-agnostic "Carry-over Delivered" — the active date filter already
 * shows the exact range.
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
  const priorIndex0 = (m1 - 2 + 12) % 12; // 0-indexed month before m1 (always 0-11)
  return MONTH_NAMES[priorIndex0]!;
}

/**
 * Returns "Carry-over → <PriorMonth>" naming the month BEFORE the range's LAST
 * month (the source month the carry-over came from), as long as that final
 * month is fully covered (endDate lands on its last calendar day). Otherwise
 * returns "Carry-over Delivered". Keys off `endDate` to match the server query,
 * which anchors carry-over to the range's last month.
 */
export function carryOverTileLabel(
  startDate: string | undefined | null,
  endDate: string | undefined | null,
): string {
  const end = parseYmd(endDate);
  if (!end) return CARRY_OVER_FALLBACK_LABEL;

  // Only name the source month when the range's final month is whole — a
  // partial final month makes the "last month" framing ambiguous.
  const endsOnMonthBoundary = end.d === lastDayOfMonth(end.y, end.m);
  if (!endsOnMonthBoundary) return CARRY_OVER_FALLBACK_LABEL;

  return `Carry-over → ${priorMonthName(end.y, end.m)}`;
}
