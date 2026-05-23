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
