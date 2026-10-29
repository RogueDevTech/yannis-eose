import { describe, it, expect } from 'vitest';
import { computePayrollFormula, displayRoas, ppdNeedsAttention, validatePayrollFormula } from './payroll-formula-engine';
import type { PayrollFormula, PayrollMetrics } from '../validators/payroll';

const metrics: PayrollMetrics = {
  individualDr: 40,
  cpa: 9000,
  deliveredCount: 220,
  totalOrders: 600,
  returnedCount: 0,
  ppdDeliveredCount: 200,
  ppdRevenue: 5_000_000,
  ppdAdSpend: 2_000_000,
  ppdRoas: 2.5,
  ocOrdersCreated: 1600,
};

/** The MB pay role today: three per-order PPD rows + the flat ₦100k for 200 delivered. */
const existingRows: PayrollFormula['bonusTiers'] = [
  { metric: 'INDIVIDUAL_DR', operator: 'GT', threshold: 34.4, kind: 'PER_ORDER', amount: 500, extraConditions: [{ metric: 'CPA', operator: 'LT', threshold: 10445 }] },
  { metric: 'DELIVERED_COUNT', operator: 'GTE', threshold: 200, kind: 'FLAT', amount: 100_000 },
];

const roasBands = [
  { minRoas: 3, ratePerOrder: 1000 },
  { minRoas: 2.5, ratePerOrder: 750 },
  { minRoas: 2, ratePerOrder: 500 },
  { minRoas: 1.5, ratePerOrder: 250 },
];

const ocBonus: PayrollFormula['ocBonus'] = {
  basis: 'ORDERS_CREATED',
  tiers: [
    { minOrders: 1500, amount: 200_000 },
    { minOrders: 2500, amount: 300_000 },
    { minOrders: 3500, amount: 400_000 },
    { minOrders: 5000, amount: 500_000 },
  ],
};

describe('PPD method selector', () => {
  it('Performance metrics (default) is unchanged: ROAS bands are ignored', () => {
    const withoutBands = computePayrollFormula({ bonusTiers: existingRows }, metrics);
    const withBands = computePayrollFormula({ bonusTiers: existingRows, roasPpdTiers: roasBands }, metrics);
    expect(withBands.performanceBonus).toBe(withoutBands.performanceBonus);
    expect(withBands.bonusBreakdown).toEqual(withoutBands.bonusBreakdown);
  });

  it('ROAS skips the per-order rows and pays the band rate per PPD delivered order', () => {
    const r = computePayrollFormula({ ppdMethod: 'ROAS', bonusTiers: existingRows, roasPpdTiers: roasBands }, metrics);
    // ₦100k flat row still pays (deliveredCount 220 ≥ 200); PPD = 200 × ₦750.
    expect(r.performanceBonus).toBe(100_000 + 200 * 750);
    expect(r.bonusBreakdown.some((l) => l.label.includes('/order') && l.label.startsWith('Bonus'))).toBe(false);
    expect(r.bonusBreakdown.find((l) => l.label.startsWith('PPD'))?.label).toBe('PPD (ROAS 2.50 ≥ 2.5) @ ₦750/order × 200');
  });

  it('compares the unrounded ROAS: 2.499 is in the 2.0 band, shown as 2.49', () => {
    const r = computePayrollFormula({ ppdMethod: 'ROAS', roasPpdTiers: roasBands }, { ...metrics, ppdRoas: 2.499 });
    expect(r.performanceBonus).toBe(200 * 500);
    expect(displayRoas(2.499)).toBe('2.49');
  });

  it('pays ₦0 PPD with an explanation when there is no ad spend or ROAS is below every band', () => {
    const noSpend = computePayrollFormula({ ppdMethod: 'ROAS', roasPpdTiers: roasBands }, { ...metrics, ppdRoas: null });
    expect(noSpend.performanceBonus).toBe(0);
    expect(noSpend.bonusBreakdown[0]?.label).toMatch(/no approved ad spend/);
    const low = computePayrollFormula({ ppdMethod: 'ROAS', roasPpdTiers: roasBands }, { ...metrics, ppdRoas: 1.2 });
    expect(low.performanceBonus).toBe(0);
    expect(low.bonusBreakdown[0]?.label).toMatch(/below the lowest band/);
  });
});

describe('OC Bonus', () => {
  it('pays the highest bracket reached, under either PPD method', () => {
    const perf = computePayrollFormula({ ocBonus }, { ...metrics, ocOrdersCreated: 2600 });
    const roas = computePayrollFormula({ ppdMethod: 'ROAS', roasPpdTiers: roasBands, ocBonus }, { ...metrics, ocOrdersCreated: 2600 });
    expect(perf.performanceBonus).toBe(300_000);
    expect(roas.bonusBreakdown.find((l) => l.label.startsWith('OC Bonus'))?.amount).toBe(300_000);
  });

  it('pays nothing below the first bracket', () => {
    expect(computePayrollFormula({ ocBonus }, { ...metrics, ocOrdersCreated: 1499 }).performanceBonus).toBe(0);
  });

  it('can count delivered orders instead', () => {
    const r = computePayrollFormula(
      { ocBonus: { basis: 'DELIVERED_ORDERS', tiers: [{ minOrders: 150, amount: 50_000 }] } },
      { ...metrics, ocOrdersCreated: 0 },
    );
    expect(r.performanceBonus).toBe(50_000);
  });
});

describe('validation and review flags', () => {
  it('ROAS with no bands is an error; duplicate bands and brackets are errors', () => {
    expect(validatePayrollFormula({ ppdMethod: 'ROAS' }).errors).toContain('ROAS-based PPD needs at least one ROAS band.');
    const dup = validatePayrollFormula({
      ppdMethod: 'ROAS',
      roasPpdTiers: [{ minRoas: 2, ratePerOrder: 1 }, { minRoas: 2, ratePerOrder: 2 }],
      ocBonus: { basis: 'ORDERS_CREATED', tiers: [{ minOrders: 10, amount: 1 }, { minOrders: 10, amount: 2 }] },
    });
    expect(dup.errors).toHaveLength(2);
  });

  it('flags a ROAS line whose revenue could not be fully converted', () => {
    const f: PayrollFormula = { ppdMethod: 'ROAS', roasPpdTiers: roasBands };
    expect(ppdNeedsAttention(f, metrics)).toBe(false);
    expect(ppdNeedsAttention(f, { ...metrics, ppdUnconvertedRevenue: { KES: 1200 } })).toBe(true);
    expect(ppdNeedsAttention({}, { ...metrics, ppdUnconvertedRevenue: { KES: 1200 } })).toBe(false);
  });
});
