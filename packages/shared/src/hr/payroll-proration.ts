/**
 * Mid-month proration for payroll.
 *
 * Staff who join or leave partway through a payroll period should only be paid
 * for the days they were active. We scale the FIXED monthly components (base
 * salary + allowances) by the fraction of the period the staff member was
 * active. Performance-based components (bonuses, penalties) are NOT prorated —
 * those are already earned on the actual delivered work within the window.
 *
 * All boundaries are inclusive day counts. Dates are compared on the calendar
 * day only (time-of-day is ignored) so a hire on the 15th counts the 15th as an
 * active day.
 */

/** Parse a `YYYY-MM-DD` or Date into a UTC-midnight day index (days since epoch). */
function toDayIndex(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  let y: number;
  let m: number;
  let d: number;
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]) - 1;
    d = Number(match[3]);
  } else {
    y = value.getUTCFullYear();
    m = value.getUTCMonth();
    d = value.getUTCDate();
  }
  return Math.floor(Date.UTC(y, m, d) / 86_400_000);
}

export interface ProrationInput {
  /** First day of the payroll period (inclusive). */
  periodStart: Date | string;
  /** Last day of the payroll period (inclusive). */
  periodEnd: Date | string;
  /** Staff start date. If it falls after periodStart, days before it are unpaid. */
  dateOfJoining?: Date | string | null;
  /** Staff exit date (last active day, inclusive). If before periodEnd, later days are unpaid. */
  exitDate?: Date | string | null;
}

export interface ProrationResult {
  /** Total inclusive days in the period. */
  periodDays: number;
  /** Days the staff member was active within the period (inclusive). */
  activeDays: number;
  /** activeDays / periodDays, clamped to [0, 1]. 1 when no proration applies. */
  fraction: number;
  /** True when the active window is a strict subset of the period (partial month). */
  isProrated: boolean;
  /** Why proration applied, for audit/labels. */
  reason: 'FULL' | 'MID_MONTH_HIRE' | 'MID_MONTH_EXIT' | 'HIRE_AND_EXIT' | 'NOT_ACTIVE';
}

/**
 * Compute the active-days proration fraction for a staff member over a payroll
 * period. Returns fraction=1 (no change) when neither date narrows the window.
 */
export function computeProration(input: ProrationInput): ProrationResult {
  const start = toDayIndex(input.periodStart);
  const end = toDayIndex(input.periodEnd);
  if (start == null || end == null || end < start) {
    return { periodDays: 0, activeDays: 0, fraction: 1, isProrated: false, reason: 'FULL' };
  }

  const periodDays = end - start + 1;

  const join = toDayIndex(input.dateOfJoining);
  const exit = toDayIndex(input.exitDate);

  // Active window = intersection of [start, end] with [join, +inf) and (-inf, exit].
  const activeStart = join != null && join > start ? join : start;
  const activeEnd = exit != null && exit < end ? exit : end;

  const hiredMidMonth = join != null && join > start && join <= end;
  const exitedMidMonth = exit != null && exit >= start && exit < end;

  if (activeEnd < activeStart) {
    // Staff was not active at all during this period (joined after it ended, or
    // left before it began).
    return { periodDays, activeDays: 0, fraction: 0, isProrated: true, reason: 'NOT_ACTIVE' };
  }

  const activeDays = activeEnd - activeStart + 1;
  const fraction = Math.min(1, Math.max(0, activeDays / periodDays));
  const isProrated = activeDays < periodDays;

  let reason: ProrationResult['reason'] = 'FULL';
  if (isProrated) {
    if (hiredMidMonth && exitedMidMonth) reason = 'HIRE_AND_EXIT';
    else if (hiredMidMonth) reason = 'MID_MONTH_HIRE';
    else if (exitedMidMonth) reason = 'MID_MONTH_EXIT';
  }

  return { periodDays, activeDays, fraction, isProrated, reason };
}
