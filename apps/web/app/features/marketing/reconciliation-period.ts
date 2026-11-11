/**
 * Lagos calendar periods for the Funding Reconciliation page. Weeks run Monday
 * to Sunday. Mirrors apps/api/src/marketing/funding-reconciliation.pure.ts,
 * which owns the maths; this file only picks dates.
 */
import type { ReconciliationCompare, ReconciliationView } from './types';

const VIEWS: readonly ReconciliationView[] = ['day', 'week', 'month', 'custom', 'all'];

export function isReconciliationView(v: string | null | undefined): v is ReconciliationView {
  return !!v && (VIEWS as readonly string[]).includes(v);
}

/** Today in Africa/Lagos (UTC+1, no DST). */
export function lagosToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStart(ymd: string): string {
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export function monthStart(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function monthEnd(ymd: string): string {
  const [y, m] = ymd.slice(0, 7).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function addMonths(ymd: string, n: number): string {
  const [y, m] = ymd.slice(0, 7).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}

/** The period of a view that contains `anchor`. */
export function periodFor(view: ReconciliationView, anchor: string): { startDate: string; endDate: string } {
  switch (view) {
    case 'day':
      return { startDate: anchor, endDate: anchor };
    case 'week': {
      const s = weekStart(anchor);
      return { startDate: s, endDate: addDays(s, 6) };
    }
    default:
      return { startDate: monthStart(anchor), endDate: monthEnd(anchor) };
  }
}

export function defaultPeriod(view: ReconciliationView): { startDate: string; endDate: string } {
  return periodFor(view === 'custom' || view === 'all' ? 'month' : view, lagosToday());
}

/** Previous / next period of the same view. */
export function shiftPeriod(view: ReconciliationView, startDate: string, dir: -1 | 1): { startDate: string; endDate: string } {
  if (view === 'day') return periodFor('day', addDays(startDate, dir));
  if (view === 'week') return periodFor('week', addDays(startDate, 7 * dir));
  return periodFor('month', addMonths(startDate, dir));
}

const fmtDay = (ymd: string, withYear = false) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });

export function periodLabel(view: ReconciliationView, startDate: string, endDate: string): string {
  if (view === 'all') return 'All time';
  if (view === 'day') return fmtDay(startDate, true);
  if (view === 'month' || (startDate === monthStart(startDate) && endDate === monthEnd(startDate))) {
    return new Date(`${startDate}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return `${fmtDay(startDate)} to ${fmtDay(endDate, true)}`;
}

export function isReconciliationCompare(v: string | null | undefined): v is ReconciliationCompare {
  return v === 'none' || v === 'previous' || v === 'year';
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

function minusYear(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate(); // 29 Feb -> 28 Feb
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** The period to compare with: the one just before (same length), or the same dates a year earlier. */
export function comparePeriod(
  view: ReconciliationView,
  startDate: string,
  endDate: string,
  compare: ReconciliationCompare,
): { startDate: string; endDate: string } | null {
  if (compare === 'none' || view === 'all') return null;
  const wholeMonth = startDate === monthStart(startDate) && endDate === monthEnd(startDate);
  if (compare === 'year') {
    if (wholeMonth) {
      const s = addMonths(startDate, -12);
      return { startDate: s, endDate: monthEnd(s) };
    }
    return { startDate: minusYear(startDate), endDate: minusYear(endDate) };
  }
  if (view !== 'custom' || wholeMonth) return shiftPeriod(view === 'custom' ? 'month' : view, startDate, -1);
  const len = daysBetween(startDate, endDate) + 1;
  return { startDate: addDays(startDate, -len), endDate: addDays(startDate, -1) };
}
