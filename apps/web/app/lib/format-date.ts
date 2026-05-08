/**
 * Date / datetime formatters used by order list + detail pages.
 *
 * All output is in `en-NG` locale (Africa/Lagos display) so admins reading the
 * UI see times in the same timezone the customer-facing form already uses.
 *
 * Why a shared helper: `toLocaleDateString` silently DROPS `hour` / `minute`
 * options. Hand-rolled call sites (we counted 5+) were passing the time
 * options but actually only rendering the date — explaining why "show the
 * timestamp on order pages" had to be done globally.
 */

const COMMON: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

/** "7 May 2026, 14:32" — the canonical timestamp shown next to a row. */
export function formatOrderTimestamp(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG', {
    ...COMMON,
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "7 May, 14:32" — compact variant for tight columns / mobile cards. */
export function formatOrderTimestampShort(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG', {
    ...COMMON,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "7 May 2026" — date-only (kept for callers that don't want the time). */
export function formatDateOnly(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { ...COMMON, year: 'numeric' });
}
