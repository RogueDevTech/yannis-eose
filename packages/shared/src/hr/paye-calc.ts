/**
 * Nigerian PAYE calculation — config-driven bands and reliefs.
 * Finance must confirm band thresholds against official publications before live use.
 */

import type {
  PayeBandConfig,
  PayeReliefConfig,
  PayeStatutoryDeductionConfig,
} from '../validators/payroll';

export interface PayeCalcInput {
  monthlyGross: number;
  taxStatus: 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION';
  employerSubsidyPercent?: number;
  /**
   * Employee's declared ANNUAL rent. Drives the PERCENT_OF_ANNUAL_RENT relief
   * (HR policy: 20% of rent, capped at ₦500k/yr). Undefined/0 → zero rent relief.
   */
  annualRent?: number;
}

export interface PayeCalcResult {
  monthlyGross: number;
  annualGross: number;
  chargeableAnnual: number;
  annualTax: number;
  monthlyPaye: number;
  employerSubsidy: number;
  employeePaye: number;
  reliefBreakdown: Array<{ name: string; amount: number }>;
  /** Monthly statutory deductions (Pension, NHIS, ...) taken off gross before PAYE. */
  statutoryBreakdown: Array<{ name: string; amount: number }>;
  /** Total monthly statutory deductions. */
  statutoryTotal: number;
  /** Monthly gross minus statutory deductions — the basis for the low-income exemption. */
  netBeforePaye: number;
  /** True when the low-income exemption zeroed PAYE for this staff. */
  exempt: boolean;
}

/** Monthly statutory deductions (Pension/NHIS) off gross, before PAYE. */
function computeStatutory(
  monthlyGross: number,
  deductions: PayeStatutoryDeductionConfig[] | undefined,
): { total: number; breakdown: Array<{ name: string; amount: number }> } {
  const breakdown: Array<{ name: string; amount: number }> = [];
  let total = 0;
  for (const d of deductions ?? []) {
    let amount = 0;
    switch (d.basis) {
      case 'PERCENT_OF_MONTHLY_GROSS':
        amount = monthlyGross * (d.rate / 100);
        break;
      case 'FLAT_MONTHLY':
        amount = d.amount ?? 0;
        break;
      default:
        amount = 0;
    }
    if (d.cap != null) amount = Math.min(amount, d.cap);
    amount = Math.max(0, amount);
    total += amount;
    breakdown.push({ name: d.name, amount });
  }
  return { total, breakdown };
}

function applyReliefs(
  annualGross: number,
  monthlyGross: number,
  reliefs: PayeReliefConfig[],
  annualRent: number,
): { chargeable: number; breakdown: Array<{ name: string; amount: number }> } {
  let totalRelief = 0;
  const breakdown: Array<{ name: string; amount: number }> = [];

  for (const relief of reliefs) {
    let amount = 0;
    switch (relief.basis) {
      case 'PERCENT_OF_GROSS':
        amount = annualGross * (relief.rate / 100);
        break;
      case 'PERCENT_OF_MONTHLY_GROSS':
        amount = monthlyGross * (relief.rate / 100) * 12;
        break;
      case 'FLAT_ANNUAL':
        amount = relief.amount ?? 0;
        break;
      case 'PERCENT_OF_ANNUAL_RENT':
        // HR rent relief: rate% of the employee's declared annual rent.
        // No declared rent → zero relief (not a salary-derived proxy).
        amount = annualRent * (relief.rate / 100);
        break;
      default:
        amount = 0;
    }
    if (relief.cap != null) amount = Math.min(amount, relief.cap);
    totalRelief += amount;
    breakdown.push({ name: relief.name, amount });
  }

  return { chargeable: Math.max(0, annualGross - totalRelief), breakdown };
}

function progressiveTax(chargeableAnnual: number, bands: PayeBandConfig['bands'], taxFreeThreshold: number): number {
  let remaining = Math.max(0, chargeableAnnual - taxFreeThreshold);
  if (remaining <= 0) return 0;

  let tax = 0;
  const sorted = [...bands].sort((a, b) => a.fromAmount - b.fromAmount);

  for (const band of sorted) {
    const bandStart = band.fromAmount;
    const bandEnd = band.toAmount ?? Infinity;
    if (remaining <= 0) break;
    if (chargeableAnnual <= bandStart) continue;

    const taxableInBand = Math.min(remaining, bandEnd - bandStart);
    if (taxableInBand > 0) {
      tax += taxableInBand * (band.rate / 100);
      remaining -= taxableInBand;
    }
  }

  return Math.max(0, tax);
}

/** Compute monthly PAYE from gross pay and tax band config. */
export function computePaye(
  input: PayeCalcInput,
  config: PayeBandConfig,
): PayeCalcResult {
  // Statutory deductions (Pension, NHIS, ...) come off gross for EVERYONE, even
  // GROSS_NO_DEDUCTION staff (that flag only exempts them from PAYE, not from
  // statutory contributions), and they define the "net before PAYE" used by the
  // low-income exemption below.
  const { total: statutoryTotal, breakdown: statutoryBreakdown } = computeStatutory(
    input.monthlyGross,
    config.statutoryDeductions,
  );
  const netBeforePaye = input.monthlyGross - statutoryTotal;

  if (input.taxStatus === 'GROSS_NO_DEDUCTION') {
    return {
      monthlyGross: input.monthlyGross,
      annualGross: input.monthlyGross * 12,
      chargeableAnnual: 0,
      annualTax: 0,
      monthlyPaye: 0,
      employerSubsidy: 0,
      employeePaye: 0,
      reliefBreakdown: [],
      statutoryBreakdown,
      statutoryTotal,
      netBeforePaye,
      exempt: false,
    };
  }

  // HR low-income exemption: if monthly gross < threshold OR net-before-PAYE <
  // threshold, no PAYE is due. Threshold 0 disables the rule.
  const exemptionThreshold = Number(config.lowIncomeExemptionMonthly ?? 0);
  const exempt =
    exemptionThreshold > 0 &&
    (input.monthlyGross < exemptionThreshold || netBeforePaye < exemptionThreshold);
  if (exempt) {
    return {
      monthlyGross: input.monthlyGross,
      annualGross: input.monthlyGross * 12,
      chargeableAnnual: 0,
      annualTax: 0,
      monthlyPaye: 0,
      employerSubsidy: 0,
      employeePaye: 0,
      reliefBreakdown: [],
      statutoryBreakdown,
      statutoryTotal,
      netBeforePaye,
      exempt: true,
    };
  }

  const annualGross = input.monthlyGross * 12;
  const { chargeable, breakdown } = applyReliefs(
    annualGross,
    input.monthlyGross,
    config.reliefs,
    Math.max(0, input.annualRent ?? 0),
  );
  const annualTax = progressiveTax(chargeable, config.bands, Number(config.taxFreeThreshold));
  const monthlyPaye = annualTax / 12;

  let employerSubsidy = 0;
  let employeePaye = monthlyPaye;

  if (input.taxStatus === 'EMPLOYER_SUBSIDIZED_PAYE' && (input.employerSubsidyPercent ?? 0) > 0) {
    employerSubsidy = monthlyPaye * (input.employerSubsidyPercent! / 100);
    employeePaye = monthlyPaye - employerSubsidy;
  }

  return {
    monthlyGross: input.monthlyGross,
    annualGross,
    chargeableAnnual: chargeable,
    annualTax,
    monthlyPaye,
    employerSubsidy,
    employeePaye,
    reliefBreakdown: breakdown,
    statutoryBreakdown,
    statutoryTotal,
    netBeforePaye,
    exempt: false,
  };
}

/** Default PAYE bands — HR rule: 15% minimum first band; only Annual Rent Relief (20%). */
export function defaultPayeBandConfig(): PayeBandConfig {
  return {
    taxFreeThreshold: 800_000,
    bands: [
      { fromAmount: 0, toAmount: 2_200_000, rate: 15 },
      { fromAmount: 2_200_000, toAmount: 11_200_000, rate: 18 },
      { fromAmount: 11_200_000, toAmount: 24_200_000, rate: 21 },
      { fromAmount: 24_200_000, toAmount: 49_200_000, rate: 23 },
      { fromAmount: 49_200_000, toAmount: null, rate: 25 },
    ],
    reliefs: [
      // HR policy: 20% of the employee's declared annual rent, capped at ₦500k/yr.
      { name: 'Annual Rent Relief (20%)', basis: 'PERCENT_OF_ANNUAL_RENT', rate: 20, cap: 500_000 },
    ],
    // Pension/NHIS are OFF by default so we never silently start deducting from
    // net pay — HR enables them per company in the tax-band config. The
    // low-income exemption IS on by default: HR policy is staff earning below
    // ₦66,667/mo pay no PAYE (≈ the ₦800k/yr tax-free floor / 12).
    statutoryDeductions: [],
    lowIncomeExemptionMonthly: 66_667,
  };
}

/**
 * Supplementary payroll balance (Track A). Given what a staff member SHOULD have
 * been paid for a period (intended) versus what they were ACTUALLY paid, compute
 * the outstanding balance to pay now — completing the original salary while
 * collecting the remaining PAYE/statutory, instead of taxing the top-up afresh.
 *
 * All amounts are monthly ₦. Balances floor at 0 (never claw back via a
 * supplementary run — overpayment is a separate reconciliation concern).
 */
export function computeSupplementaryBalance(input: {
  expectedGross: number;
  paidGross: number;
  correctPaye: number;
  paidPaye: number;
  correctStatutory?: number;
  paidStatutory?: number;
}): {
  grossBalance: number;
  remainingPaye: number;
  remainingStatutory: number;
  netPayable: number;
} {
  const grossBalance = Math.max(0, input.expectedGross - input.paidGross);
  const remainingPaye = Math.max(0, input.correctPaye - input.paidPaye);
  const remainingStatutory = Math.max(
    0,
    (input.correctStatutory ?? 0) - (input.paidStatutory ?? 0),
  );
  const netPayable = Math.max(0, grossBalance - remainingPaye - remainingStatutory);
  return { grossBalance, remainingPaye, remainingStatutory, netPayable };
}
