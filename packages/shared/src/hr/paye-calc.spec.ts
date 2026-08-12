import { describe, it, expect } from 'vitest';
import { computePaye, defaultPayeBandConfig, computeSupplementaryBalance } from './paye-calc';
import type { PayeBandConfig } from '../validators/payroll';

const base = defaultPayeBandConfig();

/** Config with the low-income exemption disabled, to test raw band math. */
const noExemption: PayeBandConfig = { ...base, lowIncomeExemptionMonthly: 0 };

describe('computePaye — low-income exemption', () => {
  it('exempts staff earning below ₦66,667/mo (gross check)', () => {
    const r = computePaye({ monthlyGross: 60_000, taxStatus: 'STANDARD_PAYE' }, base);
    expect(r.exempt).toBe(true);
    expect(r.monthlyPaye).toBe(0);
    expect(r.employeePaye).toBe(0);
  });

  it('does NOT exempt staff at exactly the threshold (₦66,667)', () => {
    // threshold is strict "<", so 66,667 is NOT exempt
    const r = computePaye({ monthlyGross: 66_667, taxStatus: 'STANDARD_PAYE' }, base);
    expect(r.exempt).toBe(false);
  });

  it('exempts when net-before-PAYE falls below threshold after statutory deductions', () => {
    // gross 70,000 is above threshold, but 8% pension drops net to 64,400 < 66,667
    const cfg: PayeBandConfig = {
      ...base,
      statutoryDeductions: [{ name: 'Pension', basis: 'PERCENT_OF_MONTHLY_GROSS', rate: 8 }],
    };
    const r = computePaye({ monthlyGross: 70_000, taxStatus: 'STANDARD_PAYE' }, cfg);
    expect(r.statutoryTotal).toBeCloseTo(5_600, 2);
    expect(r.netBeforePaye).toBeCloseTo(64_400, 2);
    expect(r.exempt).toBe(true);
    expect(r.monthlyPaye).toBe(0);
  });

  it('threshold of 0 disables the exemption', () => {
    const r = computePaye({ monthlyGross: 10_000, taxStatus: 'STANDARD_PAYE' }, noExemption);
    expect(r.exempt).toBe(false);
  });
});

describe('computePaye — statutory deductions', () => {
  it('computes percent-of-gross statutory (pension) and flat statutory (NHIS)', () => {
    const cfg: PayeBandConfig = {
      ...noExemption,
      statutoryDeductions: [
        { name: 'Pension', basis: 'PERCENT_OF_MONTHLY_GROSS', rate: 8 },
        { name: 'NHIS', basis: 'FLAT_MONTHLY', rate: 0, amount: 2_000 },
      ],
    };
    const r = computePaye({ monthlyGross: 200_000, taxStatus: 'STANDARD_PAYE' }, cfg);
    expect(r.statutoryBreakdown).toEqual([
      { name: 'Pension', amount: 16_000 },
      { name: 'NHIS', amount: 2_000 },
    ]);
    expect(r.statutoryTotal).toBe(18_000);
    expect(r.netBeforePaye).toBe(182_000);
  });

  it('respects a statutory cap', () => {
    const cfg: PayeBandConfig = {
      ...noExemption,
      statutoryDeductions: [
        { name: 'Pension', basis: 'PERCENT_OF_MONTHLY_GROSS', rate: 8, cap: 10_000 },
      ],
    };
    const r = computePaye({ monthlyGross: 500_000, taxStatus: 'STANDARD_PAYE' }, cfg);
    // 8% of 500k = 40k, capped at 10k
    expect(r.statutoryTotal).toBe(10_000);
  });

  it('applies statutory to GROSS_NO_DEDUCTION staff but still zeroes their PAYE', () => {
    const cfg: PayeBandConfig = {
      ...base,
      statutoryDeductions: [{ name: 'Pension', basis: 'PERCENT_OF_MONTHLY_GROSS', rate: 8 }],
    };
    const r = computePaye({ monthlyGross: 300_000, taxStatus: 'GROSS_NO_DEDUCTION' }, cfg);
    expect(r.monthlyPaye).toBe(0);
    expect(r.statutoryTotal).toBe(24_000);
    expect(r.netBeforePaye).toBe(276_000);
    expect(r.exempt).toBe(false);
  });
});

describe('computePaye — band math regression (exemption off)', () => {
  it('still computes progressive tax for a high earner', () => {
    // ₦2.5M/mo = ₦30M/yr, no rent relief. Per prior validated spec: annual 5,830,000.
    const r = computePaye({ monthlyGross: 2_500_000, taxStatus: 'STANDARD_PAYE' }, noExemption);
    expect(r.annualTax).toBeCloseTo(5_830_000, 0);
    expect(r.monthlyPaye).toBeCloseTo(485_833.33, 1);
    expect(r.exempt).toBe(false);
  });

  it('rent relief still reduces chargeable income', () => {
    const withRent = computePaye(
      { monthlyGross: 2_500_000, taxStatus: 'STANDARD_PAYE', annualRent: 3_000_000 },
      noExemption,
    );
    const noRent = computePaye(
      { monthlyGross: 2_500_000, taxStatus: 'STANDARD_PAYE' },
      noExemption,
    );
    // 20% of 3M = 600k relief, capped at 500k → lower chargeable → lower tax
    expect(withRent.annualTax).toBeLessThan(noRent.annualTax);
    expect(withRent.reliefBreakdown[0]?.amount).toBe(500_000);
  });
});

describe('computeSupplementaryBalance — Track A worked example', () => {
  it('completes the original salary and collects remaining PAYE (HR doc example)', () => {
    // Expected gross ₦120k / correct PAYE ₦8k; paid ₦80k / PAYE ₦2k.
    const r = computeSupplementaryBalance({
      expectedGross: 120_000,
      paidGross: 80_000,
      correctPaye: 8_000,
      paidPaye: 2_000,
    });
    expect(r.grossBalance).toBe(40_000);
    expect(r.remainingPaye).toBe(6_000);
    expect(r.netPayable).toBe(34_000); // 40k balance − 6k remaining PAYE
  });

  it('floors balances at 0 when already fully paid (no clawback)', () => {
    const r = computeSupplementaryBalance({
      expectedGross: 100_000,
      paidGross: 120_000, // overpaid
      correctPaye: 5_000,
      paidPaye: 8_000, // over-deducted
    });
    expect(r.grossBalance).toBe(0);
    expect(r.remainingPaye).toBe(0);
    expect(r.netPayable).toBe(0);
  });

  it('yields zero balance on a second run once the top-up is already paid', () => {
    // First run paid the ₦40k balance + ₦6k PAYE. On a re-run, paid-to-date is
    // aggregated (original ₦80k + supplementary ₦40k = ₦120k gross; ₦2k + ₦6k =
    // ₦8k PAYE), so nothing is owed — prevents a duplicate double-payment.
    const r = computeSupplementaryBalance({
      expectedGross: 120_000,
      paidGross: 120_000,
      correctPaye: 8_000,
      paidPaye: 8_000,
    });
    expect(r.grossBalance).toBe(0);
    expect(r.remainingPaye).toBe(0);
    expect(r.netPayable).toBe(0);
  });

  it('subtracts remaining statutory from the net payable', () => {
    const r = computeSupplementaryBalance({
      expectedGross: 120_000,
      paidGross: 80_000,
      correctPaye: 8_000,
      paidPaye: 2_000,
      correctStatutory: 9_600, // 8% pension on 120k
      paidStatutory: 6_400, // 8% on 80k
    });
    expect(r.grossBalance).toBe(40_000);
    expect(r.remainingPaye).toBe(6_000);
    expect(r.remainingStatutory).toBe(3_200);
    expect(r.netPayable).toBe(30_800); // 40k − 6k − 3.2k
  });
});
