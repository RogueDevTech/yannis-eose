/**
 * Nigerian PAYE calculation — config-driven bands and reliefs.
 * Finance must confirm band thresholds against official publications before live use.
 */

import type { PayeBandConfig, PayeReliefConfig } from '../validators/payroll';

export interface PayeCalcInput {
  monthlyGross: number;
  taxStatus: 'STANDARD_PAYE' | 'EMPLOYER_SUBSIDIZED_PAYE' | 'GROSS_NO_DEDUCTION';
  employerSubsidyPercent?: number;
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
}

function applyReliefs(
  annualGross: number,
  monthlyGross: number,
  reliefs: PayeReliefConfig[],
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
    };
  }

  const annualGross = input.monthlyGross * 12;
  const { chargeable, breakdown } = applyReliefs(annualGross, input.monthlyGross, config.reliefs);
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
  };
}

/** Default Nigeria Tax Act 2025 placeholder bands — Finance must confirm before live use. */
export function defaultPayeBandConfig(): PayeBandConfig {
  return {
    taxFreeThreshold: 800_000,
    bands: [
      { fromAmount: 0, toAmount: 800_000, rate: 0 },
      { fromAmount: 800_000, toAmount: 3_000_000, rate: 15 },
      { fromAmount: 3_000_000, toAmount: 12_000_000, rate: 18 },
      { fromAmount: 12_000_000, toAmount: 25_000_000, rate: 21 },
      { fromAmount: 25_000_000, toAmount: 50_000_000, rate: 23 },
      { fromAmount: 50_000_000, toAmount: null, rate: 25 },
    ],
    reliefs: [
      { name: 'Pension (8%)', basis: 'PERCENT_OF_GROSS', rate: 8 },
      { name: 'NHF (2.5%)', basis: 'PERCENT_OF_GROSS', rate: 2.5 },
    ],
  };
}
