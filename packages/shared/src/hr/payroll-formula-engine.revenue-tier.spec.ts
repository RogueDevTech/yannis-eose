import { describe, it, expect } from 'vitest';
import { computePayrollFormula } from './payroll-formula-engine';
import type { PayrollFormula, PayrollMetrics } from '../validators/payroll';

/**
 * Phase E — CS revenue-tier base salary. The 120k/80k rule is expressed purely in
 * config via a QUALIFYING_REVENUE base-salary tier + a flat fallback. These tests
 * exercise the whole chain metricValue → tierMatches → resolveBaseSalary so the
 * threshold decision is verified without a database.
 */

const baseMetrics: PayrollMetrics = {
  individualDr: 100,
  teamDr: 0,
  cpa: 0,
  deliveredCount: 40,
  totalOrders: 40,
  returnedCount: 0,
  qualifyingRevenue: 0,
};

/** CS closer formula: >= ₦4,000,000 qualifying revenue → ₦120k base, else flat ₦80k. */
const csCloserFormula: PayrollFormula = {
  schemaVersion: 'payroll_v1',
  flatBaseSalary: 80_000,
  baseSalaryTiers: [
    { metric: 'QUALIFYING_REVENUE', operator: 'GTE', threshold: 4_000_000, amount: 120_000 },
  ],
};

describe('CS revenue-tier base salary (QUALIFYING_REVENUE)', () => {
  it('pays ₦120k when qualifying revenue is above ₦4M', () => {
    const r = computePayrollFormula(csCloserFormula, { ...baseMetrics, qualifyingRevenue: 5_000_000 });
    expect(r.baseSalary).toBe(120_000);
  });

  it('pays ₦120k at exactly ₦4,000,000 (GTE is inclusive)', () => {
    const r = computePayrollFormula(csCloserFormula, { ...baseMetrics, qualifyingRevenue: 4_000_000 });
    expect(r.baseSalary).toBe(120_000);
  });

  it('pays the flat ₦80k just below the threshold', () => {
    const r = computePayrollFormula(csCloserFormula, { ...baseMetrics, qualifyingRevenue: 3_999_999 });
    expect(r.baseSalary).toBe(80_000);
  });

  it('pays the flat ₦80k with zero revenue', () => {
    const r = computePayrollFormula(csCloserFormula, { ...baseMetrics, qualifyingRevenue: 0 });
    expect(r.baseSalary).toBe(80_000);
  });

  it('treats an absent qualifyingRevenue as 0 (flat ₦80k)', () => {
    const noRev = { ...baseMetrics };
    delete (noRev as { qualifyingRevenue?: number }).qualifyingRevenue;
    const r = computePayrollFormula(csCloserFormula, noRev);
    expect(r.baseSalary).toBe(80_000);
  });

  it('supports multiple revenue tiers (highest matching wins)', () => {
    const tiered: PayrollFormula = {
      schemaVersion: 'payroll_v1',
      flatBaseSalary: 80_000,
      baseSalaryTiers: [
        { metric: 'QUALIFYING_REVENUE', operator: 'GTE', threshold: 4_000_000, amount: 120_000 },
        { metric: 'QUALIFYING_REVENUE', operator: 'GTE', threshold: 8_000_000, amount: 150_000 },
      ],
    };
    expect(computePayrollFormula(tiered, { ...baseMetrics, qualifyingRevenue: 9_000_000 }).baseSalary).toBe(
      150_000,
    );
    expect(computePayrollFormula(tiered, { ...baseMetrics, qualifyingRevenue: 4_500_000 }).baseSalary).toBe(
      120_000,
    );
    expect(computePayrollFormula(tiered, { ...baseMetrics, qualifyingRevenue: 1_000_000 }).baseSalary).toBe(
      80_000,
    );
  });
});
