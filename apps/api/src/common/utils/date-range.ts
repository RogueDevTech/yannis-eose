/**
 * Date-range filter parsing pinned to the company's operational calendar
 * (Africa/Lagos, WAT, UTC+1, no DST).
 *
 * Without these helpers, filter endpoints did `new Date(YYYY-MM-DD)` — which
 * parses as UTC midnight — and then `end.setHours(23,59,59,999)` in the
 * server's local TZ. With the API in UTC that left the first hour of every
 * WAT day (00:00–01:00) outside the window: "Today" filters at 00:14 WAT
 * showed zero rows even though business is running for the day.
 *
 *  - A `YYYY-MM-DD` is taken to mean 00:00:00 (start) or 23:59:59.999 (end)
 *    *in Nigeria*. The resulting UTC instant is one hour earlier.
 *  - An ISO datetime with a `T` is parsed directly — caller supplied a
 *    precise instant (often already with `+01:00`).
 */
const NIGERIA_OFFSET = '+01:00';

/** Lower bound (`gte`) of a Nigeria-calendar day filter. */
export function nigeriaDayStart(input: string): Date {
  if (input.includes('T')) return new Date(input);
  return new Date(`${input}T00:00:00${NIGERIA_OFFSET}`);
}

/** Upper bound (`lte`) of a Nigeria-calendar day filter. */
export function nigeriaDayEnd(input: string): Date {
  if (input.includes('T')) return new Date(input);
  return new Date(`${input}T23:59:59.999${NIGERIA_OFFSET}`);
}

/**
 * Nigeria-calendar month window for a payroll period given as `YYYY-MM-01`.
 *
 * IMPORTANT: derive the last day from the MONTH STRING, never from
 * `nigeriaDayStart(periodMonth)`. That start is a UTC+1 instant whose UTC
 * representation for the 1st of the month rolls back into the PREVIOUS calendar
 * month (e.g. `2026-07-01T00:00+01:00` === `2026-06-30T23:00Z`), so
 * `periodStart.getUTCMonth()` returns June for a July period. Doing
 * `Date.UTC(year, getUTCMonth()+1, 0)` then collapses the window to a single
 * inverted day (end < start) and every delivered-count / metric query matches
 * ZERO rows — which silently zeroed every performance bonus.
 *
 * @param periodMonth `YYYY-MM-01` (or any `YYYY-MM-DD`; only year+month used).
 */
export function nigeriaMonthWindow(periodMonth: string): { periodStart: Date; periodEnd: Date } {
  const ym = periodMonth.slice(0, 7); // "YYYY-MM"
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const periodStart = nigeriaDayStart(`${ym}-01`);
  // Day 0 of the next month = last day of THIS month. Computed from the string's
  // own year/month, so it is immune to the UTC-shift trap described above.
  const lastDay = new Date(Date.UTC(y, m, 0)); // m is 1-based here → next month index is m
  const periodEnd = nigeriaDayEnd(lastDay.toISOString().slice(0, 10));
  return { periodStart, periodEnd };
}

const NIGERIA_MONTH_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
});

/**
 * Start (`gte` lower bound) of the LAST Nigeria calendar month covered by a
 * filter range, derived from the range's `periodEnd` instant.
 *
 * "Carry-over Delivered" is anchored to the last month of the selected range:
 * orders delivered in that final month but generated before it began. Given
 * the range's end instant, this returns 00:00 WAT on the 1st of that month.
 * For a single whole-month filter (July 1 → July 31) it returns July 1, so
 * that common case is unchanged; only multi-month / partial / all-time ranges
 * shift from "before the range" to "before the range's last month".
 */
export function nigeriaCarryOverMonthStart(periodEnd: Date): Date {
  // Format the end instant in Nigeria time to get its YYYY-MM, then take the
  // 1st of that month at Nigeria midnight. Avoids server-TZ month arithmetic.
  const ym = NIGERIA_MONTH_FORMATTER.format(periodEnd); // e.g. "2026-07"
  return new Date(`${ym}-01T00:00:00${NIGERIA_OFFSET}`);
}

const NIGERIA_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Current Nigeria calendar date as `YYYY-MM-DD`, regardless of the server's TZ. */
export function nigeriaToday(now: Date = new Date()): string {
  return NIGERIA_DATE_FORMATTER.format(now);
}

/**
 * Calendar date (`YYYY-MM-DD`) in Africa/Lagos for a timestamp.
 * Prefer this over `date.toISOString().slice(0, 10)` for GL posting dates
 * (UTC midnight can land on the previous Nigeria calendar day).
 */
export function nigeriaCalendarDate(input: Date | string = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return nigeriaToday();
  return NIGERIA_DATE_FORMATTER.format(d);
}
