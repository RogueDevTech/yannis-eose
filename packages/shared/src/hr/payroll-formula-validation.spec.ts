import { describe, it, expect } from 'vitest';
import { computePayrollFormula, validatePayrollFormula } from './payroll-formula-engine';
import type { PayrollFormula, PayrollMetrics } from '../validators/payroll';

// The bug-report scenario: DR 55%, 4 delivered orders, three per-order DR tiers.
const REPORT_FORMULA: PayrollFormula = {
  schemaVersion: 'payroll_v1',
  flatBaseSalary: 120_000,
  bonusTiers: [
    { metric: 'INDIVIDUAL_DR', operator: 'GT', threshold: 39.3, kind: 'PER_ORDER', amount: 500 },
    { metric: 'INDIVIDUAL_DR', operator: 'GT', threshold: 34.4, kind: 'PER_ORDER', amount: 250 },
    { metric: 'INDIVIDUAL_DR', operator: 'LT', threshold: 34.5, kind: 'PER_ORDER', amount: 100 },
  ],
};

describe('performance bonus tier selection (bug report)', () => {
  it('DR 55% + 4 orders → highest tier ₦500/order × 4 = ₦2,000', () => {
    const metrics: PayrollMetrics = { individualDr: 55, deliveredCount: 4, totalOrders: 8 } as PayrollMetrics;
    const r = computePayrollFormula(REPORT_FORMULA, metrics);
    expect(r.performanceBonus).toBe(2_000);
    expect(r.bonusBreakdown[0]?.amount).toBe(2_000);
    expect(r.bonusBreakdown[0]?.label).toContain('39.3');
  });

  it('DR 36% picks the >34.4 tier (₦250/order)', () => {
    const metrics: PayrollMetrics = { individualDr: 36, deliveredCount: 4, totalOrders: 8 } as PayrollMetrics;
    expect(computePayrollFormula(REPORT_FORMULA, metrics).performanceBonus).toBe(1_000);
  });

  it('edge: exactly 39.3 does NOT qualify the > tier (falls to >34.4)', () => {
    const metrics: PayrollMetrics = { individualDr: 39.3, deliveredCount: 4, totalOrders: 8 } as PayrollMetrics;
    // 39.3 is not > 39.3, but IS > 34.4 → ₦250 × 4
    expect(computePayrollFormula(REPORT_FORMULA, metrics).performanceBonus).toBe(1_000);
  });

  it('per-order bonus is 0 when delivered count is 0', () => {
    const metrics: PayrollMetrics = { individualDr: 55, deliveredCount: 0, totalOrders: 8 } as PayrollMetrics;
    expect(computePayrollFormula(REPORT_FORMULA, metrics).performanceBonus).toBe(0);
  });
});

describe('validatePayrollFormula', () => {
  it('accepts the report formula (no errors)', () => {
    const v = validatePayrollFormula(REPORT_FORMULA);
    expect(v.errors).toEqual([]);
  });

  it('rejects a DR threshold above 100', () => {
    const v = validatePayrollFormula({
      bonusTiers: [{ metric: 'INDIVIDUAL_DR', operator: 'GT', threshold: 150, kind: 'FLAT', amount: 500 }],
    });
    expect(v.errors.some((e) => e.includes('cannot exceed 100'))).toBe(true);
  });

  it('rejects a per-order tier with a ₦0 rate', () => {
    const v = validatePayrollFormula({
      bonusTiers: [{ metric: 'INDIVIDUAL_DR', operator: 'GT', threshold: 40, kind: 'PER_ORDER', amount: 0 }],
    });
    expect(v.errors.some((e) => e.includes('rate greater than ₦0'))).toBe(true);
  });

  it('flags duplicate/conflicting tiers (same metric+operator+threshold)', () => {
    const v = validatePayrollFormula({
      bonusTiers: [
        { metric: 'INDIVIDUAL_DR', operator: 'GT', threshold: 40, kind: 'FLAT', amount: 500 },
        { metric: 'INDIVIDUAL_DR', operator: 'GT', threshold: 40, kind: 'FLAT', amount: 300 },
      ],
    });
    expect(v.errors.some((e) => e.includes('duplicate/conflicting'))).toBe(true);
  });

  it('does NOT flag tiers that share a primary condition but differ by extraConditions', () => {
    const v = validatePayrollFormula({
      bonusTiers: [
        {
          metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 34.5, kind: 'FLAT', amount: 500,
          extraConditions: [{ metric: 'TEAM_DR', operator: 'GTE', threshold: 40 }],
        },
        {
          metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 34.5, kind: 'FLAT', amount: 800,
          extraConditions: [{ metric: 'TEAM_DR', operator: 'GTE', threshold: 50 }],
        },
      ],
    });
    expect(v.errors.some((e) => e.includes('duplicate/conflicting'))).toBe(false);
  });

  it('still flags tiers with an identical full condition set (primary + same extras)', () => {
    const v = validatePayrollFormula({
      bonusTiers: [
        {
          metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 34.5, kind: 'FLAT', amount: 500,
          extraConditions: [{ metric: 'TEAM_DR', operator: 'GTE', threshold: 40 }],
        },
        {
          metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 34.5, kind: 'FLAT', amount: 800,
          extraConditions: [{ metric: 'TEAM_DR', operator: 'GTE', threshold: 40 }],
        },
      ],
    });
    expect(v.errors.some((e) => e.includes('duplicate/conflicting'))).toBe(true);
  });

  it('warns (not errors) on a per-order bonus formula', () => {
    const v = validatePayrollFormula(REPORT_FORMULA);
    expect(v.warnings.some((w) => w.includes('Per-order bonus'))).toBe(true);
  });
});
