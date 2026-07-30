import { describe, it, expect } from 'vitest';
import { computePayrollFormula } from './payroll-formula-engine';
import type { PayrollFormula, PayrollMetrics } from '../validators/payroll';

const baseMetrics: PayrollMetrics = {
  individualDr: 0,
  teamDr: 0,
  cpa: 0,
  deliveredCount: 10,
  totalOrders: 12,
  returnedCount: 0,
};

/** A bonus tier that pays 1000 only when DR% >= 85 AND CPA < 1000. */
const andFormula: PayrollFormula = {
  schemaVersion: 'payroll_v1',
  flatBaseSalary: 0,
  bonusTiers: [
    {
      metric: 'INDIVIDUAL_DR',
      operator: 'GTE',
      threshold: 85,
      kind: 'FLAT',
      amount: 1000,
      extraConditions: [{ metric: 'CPA', operator: 'LT', threshold: 1000 }],
    },
  ],
};

describe('multi-condition (AND) bonus tiers', () => {
  it('pays the bonus when BOTH conditions pass (DR high, CPA low)', () => {
    const r = computePayrollFormula(andFormula, { ...baseMetrics, individualDr: 90, cpa: 500 });
    expect(r.performanceBonus).toBe(1000);
  });

  it('does NOT pay when only DR passes (CPA too high)', () => {
    const r = computePayrollFormula(andFormula, { ...baseMetrics, individualDr: 90, cpa: 5000 });
    expect(r.performanceBonus).toBe(0);
  });

  it('does NOT pay when only CPA passes (DR too low)', () => {
    const r = computePayrollFormula(andFormula, { ...baseMetrics, individualDr: 50, cpa: 500 });
    expect(r.performanceBonus).toBe(0);
  });

  it('does NOT pay when neither passes', () => {
    const r = computePayrollFormula(andFormula, { ...baseMetrics, individualDr: 50, cpa: 5000 });
    expect(r.performanceBonus).toBe(0);
  });

  it('is backward compatible: a single-condition tier (no extraConditions) still pays on its own', () => {
    const single: PayrollFormula = {
      schemaVersion: 'payroll_v1',
      flatBaseSalary: 0,
      bonusTiers: [{ metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 85, kind: 'FLAT', amount: 1000 }],
    };
    const r = computePayrollFormula(single, { ...baseMetrics, individualDr: 90, cpa: 999999 });
    expect(r.performanceBonus).toBe(1000);
  });

  it('applies AND logic to base salary tiers too', () => {
    const baseAnd: PayrollFormula = {
      schemaVersion: 'payroll_v1',
      flatBaseSalary: 100,
      baseSalaryTiers: [
        {
          metric: 'INDIVIDUAL_DR',
          operator: 'GTE',
          threshold: 85,
          amount: 5000,
          extraConditions: [{ metric: 'CPA', operator: 'LT', threshold: 1000 }],
        },
      ],
    };
    // Both pass -> tier amount
    expect(computePayrollFormula(baseAnd, { ...baseMetrics, individualDr: 90, cpa: 500 }).baseSalary).toBe(5000);
    // Only DR passes -> falls back to flat base
    expect(computePayrollFormula(baseAnd, { ...baseMetrics, individualDr: 90, cpa: 5000 }).baseSalary).toBe(100);
  });
});
