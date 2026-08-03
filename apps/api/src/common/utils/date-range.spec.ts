import { describe, it, expect } from 'vitest';
import { nigeriaMonthWindow } from './date-range';

/**
 * Regression guard for the payroll "empty window" bug: deriving the month's last
 * day from `nigeriaDayStart(periodMonth).getUTCMonth()` collapsed the window to a
 * single inverted day (end < start), because the Nigeria-midnight start instant
 * is the previous calendar day in UTC. That zeroed every delivered-count metric
 * and therefore every performance bonus.
 */
describe('nigeriaMonthWindow', () => {
  const cases: Array<{ pm: string; lastDayYmd: string }> = [
    { pm: '2026-07-01', lastDayYmd: '2026-07-31' },
    { pm: '2026-02-01', lastDayYmd: '2026-02-28' }, // non-leap
    { pm: '2024-02-01', lastDayYmd: '2024-02-29' }, // leap
    { pm: '2026-12-01', lastDayYmd: '2026-12-31' }, // year boundary
    { pm: '2026-01-01', lastDayYmd: '2026-01-31' },
  ];

  for (const { pm, lastDayYmd } of cases) {
    it(`${pm} spans the whole Nigeria month, end after start`, () => {
      const { periodStart, periodEnd } = nigeriaMonthWindow(pm);
      // The window must be forward (this is what broke — end was before start).
      expect(periodEnd.getTime()).toBeGreaterThan(periodStart.getTime());
      // Start is Nigeria-midnight on the 1st (== 23:00Z the previous day).
      const expectedStart = new Date(`${pm.slice(0, 7)}-01T00:00:00.000+01:00`);
      expect(periodStart.toISOString()).toBe(expectedStart.toISOString());
      // End is the last day of THIS month at 23:59:59.999 WAT.
      const expectedEnd = new Date(`${lastDayYmd}T23:59:59.999+01:00`);
      expect(periodEnd.toISOString()).toBe(expectedEnd.toISOString());
    });
  }

  it('accepts a full YYYY-MM-DD and ignores the day component', () => {
    const a = nigeriaMonthWindow('2026-07-01');
    const b = nigeriaMonthWindow('2026-07-15');
    expect(a.periodStart.toISOString()).toBe(b.periodStart.toISOString());
    expect(a.periodEnd.toISOString()).toBe(b.periodEnd.toISOString());
  });
});
