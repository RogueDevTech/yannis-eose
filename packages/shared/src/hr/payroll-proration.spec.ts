import { describe, it, expect } from 'vitest';
import { computeProration } from './payroll-proration';
import { computePayrollFormula } from './payroll-formula-engine';
import type { PayrollFormula, PayrollMetrics } from '../validators/payroll';

const AUG_START = '2026-08-01';
const AUG_END = '2026-08-31'; // 31 days

describe('computeProration', () => {
  it('returns full fraction when no join/exit dates', () => {
    const r = computeProration({ periodStart: AUG_START, periodEnd: AUG_END });
    expect(r.fraction).toBe(1);
    expect(r.isProrated).toBe(false);
    expect(r.reason).toBe('FULL');
  });

  it('prorates a mid-month hire from the join date (inclusive)', () => {
    // Joined Aug 17 → active Aug 17..31 = 15 days of 31.
    const r = computeProration({ periodStart: AUG_START, periodEnd: AUG_END, dateOfJoining: '2026-08-17' });
    expect(r.activeDays).toBe(15);
    expect(r.periodDays).toBe(31);
    expect(r.fraction).toBeCloseTo(15 / 31, 6);
    expect(r.isProrated).toBe(true);
    expect(r.reason).toBe('MID_MONTH_HIRE');
  });

  it('prorates a mid-month exit up to and including the exit date', () => {
    // Left Aug 10 → active Aug 1..10 = 10 days of 31.
    const r = computeProration({ periodStart: AUG_START, periodEnd: AUG_END, exitDate: '2026-08-10' });
    expect(r.activeDays).toBe(10);
    expect(r.fraction).toBeCloseTo(10 / 31, 6);
    expect(r.reason).toBe('MID_MONTH_EXIT');
  });

  it('handles hire and exit in the same period', () => {
    // Joined Aug 5, left Aug 14 → 10 days.
    const r = computeProration({
      periodStart: AUG_START,
      periodEnd: AUG_END,
      dateOfJoining: '2026-08-05',
      exitDate: '2026-08-14',
    });
    expect(r.activeDays).toBe(10);
    expect(r.reason).toBe('HIRE_AND_EXIT');
  });

  it('gives zero when the staff was never active in the period', () => {
    const r = computeProration({ periodStart: AUG_START, periodEnd: AUG_END, dateOfJoining: '2026-09-01' });
    expect(r.fraction).toBe(0);
    expect(r.reason).toBe('NOT_ACTIVE');
  });

  it('does not prorate when hire predates the period', () => {
    const r = computeProration({ periodStart: AUG_START, periodEnd: AUG_END, dateOfJoining: '2026-07-01' });
    expect(r.fraction).toBe(1);
    expect(r.isProrated).toBe(false);
  });
});

describe('DELIVERED_COUNT metric in the formula engine', () => {
  const baseMetrics: PayrollMetrics = {
    individualDr: 0,
    deliveredCount: 0,
    totalOrders: 0,
  };

  const formula: PayrollFormula = {
    schemaVersion: 'payroll_v1',
    flatBaseSalary: 1000,
    bonusTiers: [
      // Qualify for a flat 5000 bonus only when >= 60 delivered orders.
      { metric: 'DELIVERED_COUNT', operator: 'GTE', threshold: 60, kind: 'FLAT', amount: 5000 },
    ],
  };

  it('awards the bonus when delivered count meets the threshold', () => {
    const r = computePayrollFormula(formula, { ...baseMetrics, deliveredCount: 60 });
    expect(r.performanceBonus).toBe(5000);
  });

  it('withholds the bonus below the threshold', () => {
    const r = computePayrollFormula(formula, { ...baseMetrics, deliveredCount: 59 });
    expect(r.performanceBonus).toBe(0);
  });
});
