import { describe, it, expect } from 'vitest';
import { PayrollComputeService } from './payroll-compute.service';
import { defaultPayeBandConfig } from '@yannis/shared';
import type { PayrollMetrics } from '@yannis/shared';

/**
 * Phase C — per-staff ad-hoc TAXABLE allowances enter gross BEFORE PAYE. These
 * tests drive the PURE in-memory compute twin (computeForMemberInMemory, zero DB)
 * so we can assert that an allowance both raises gross AND raises PAYE (i.e. it is
 * taxed), and that the recurring portion prorates while one-time is paid in full.
 */

// The twin never touches the metrics service or db — pass null for DI.
const svc = new PayrollComputeService(null as never);

const FULL_MONTH_START = new Date('2026-05-01T00:00:00.000Z');
const FULL_MONTH_END = new Date('2026-05-31T23:59:59.999Z');

const metrics: PayrollMetrics = {
  individualDr: 100,
  teamDr: 0,
  cpa: 0,
  deliveredCount: 40,
  totalOrders: 40,
  returnedCount: 0,
  qualifyingRevenue: 0,
};

// A simple pay-role formula: flat ₦300k base, no bonus/allowances/penalties. Well
// above the PAYE exemption so tax is actually charged and allowance-tax is visible.
const resolvedBase = {
  plan: {
    planName: 'Test',
    rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 300_000 },
  },
  payRole: null,
  taxConfig: defaultPayeBandConfig(),
  attendanceEligibility: null,
};

function run(adHocAllowance: { recurring: number; oneTime: number } | null) {
  return svc.computeForMemberInMemory(
    { id: 'staff-1', role: 'CS_CLOSER', payRoleId: 'pr-1', taxStatus: 'STANDARD_PAYE' },
    FULL_MONTH_START,
    FULL_MONTH_END,
    metrics,
    { ...resolvedBase, adHocAllowance },
  );
}

describe('per-staff taxable allowance (in gross, before PAYE)', () => {
  it('with no allowance produces a baseline line', () => {
    const r = run(null);
    expect(r).not.toBeNull();
    expect(r!.allowancesTotal).toBe(0);
    expect(r!.grossPay).toBe(300_000);
    expect(r!.payeTax).toBeGreaterThan(0);
  });

  it('a one-time allowance raises gross AND PAYE (it is taxed)', () => {
    const baseline = run(null)!;
    const withAllowance = run({ recurring: 0, oneTime: 50_000 })!;
    // Gross rises by exactly the allowance.
    expect(withAllowance.grossPay).toBeCloseTo(baseline.grossPay + 50_000, 2);
    expect(withAllowance.allowancesTotal).toBeCloseTo(50_000, 2);
    // PAYE rises too — proving the allowance was taxed (not post-tax like a refund).
    expect(withAllowance.payeTax).toBeGreaterThan(baseline.payeTax);
  });

  it('a full-month recurring allowance is paid in full (no proration)', () => {
    const r = run({ recurring: 50_000, oneTime: 0 })!;
    // Full month → proration fraction 1 → recurring paid in full.
    expect(r.allowancesTotal).toBeCloseTo(50_000, 2);
  });

  it('recurring + one-time both land in gross for a full month', () => {
    const r = run({ recurring: 30_000, oneTime: 20_000 })!;
    expect(r.allowancesTotal).toBeCloseTo(50_000, 2);
    expect(r.grossPay).toBeCloseTo(350_000, 2);
  });
});

describe('recurring allowance prorates for a mid-month joiner; one-time does not', () => {
  // Joined on the 16th of a 31-day month → ~16/31 active fraction.
  const JOINED_MID = new Date('2026-05-16T00:00:00.000Z');

  function runProrated(adHocAllowance: { recurring: number; oneTime: number }) {
    return svc.computeForMemberInMemory(
      {
        id: 'staff-2',
        role: 'CS_CLOSER',
        payRoleId: 'pr-1',
        taxStatus: 'STANDARD_PAYE',
        dateOfJoining: JOINED_MID,
      },
      FULL_MONTH_START,
      FULL_MONTH_END,
      metrics,
      { ...resolvedBase, adHocAllowance },
    );
  }

  it('recurring allowance is reduced by the active-days fraction', () => {
    const r = runProrated({ recurring: 62_000, oneTime: 0 })!;
    // 62,000 × (16/31) = 32,000. Allow a small rounding window.
    expect(r!.allowancesTotal).toBeGreaterThan(30_000);
    expect(r!.allowancesTotal).toBeLessThan(34_000);
  });

  it('one-time allowance is NOT prorated (paid in full even for a mid-month joiner)', () => {
    const r = runProrated({ recurring: 0, oneTime: 62_000 })!;
    expect(r!.allowancesTotal).toBeCloseTo(62_000, 2);
  });
});
