import { describe, it, expect } from 'vitest';
import {
  setSettlementConfigSchema,
  generatePayoutsSchema,
  createCommissionPlanSchema,
  createAdjustmentSchema,
  approvePayoutSchema,
} from './hr';

// ---------------------------------------------------------------------------
// setSettlementConfigSchema
// ---------------------------------------------------------------------------

describe('setSettlementConfigSchema', () => {
  it('accepts WEEKLY with startDay 1', () => {
    expect(() => setSettlementConfigSchema.parse({ windowType: 'WEEKLY', startDay: 1 })).not.toThrow();
  });

  it('accepts MONTHLY with startDay 28', () => {
    expect(() => setSettlementConfigSchema.parse({ windowType: 'MONTHLY', startDay: 28 })).not.toThrow();
  });

  it('accepts BIWEEKLY', () => {
    expect(() => setSettlementConfigSchema.parse({ windowType: 'BIWEEKLY', startDay: 7 })).not.toThrow();
  });

  it('rejects startDay below 1', () => {
    expect(() => setSettlementConfigSchema.parse({ windowType: 'MONTHLY', startDay: 0 })).toThrow();
  });

  it('rejects startDay above 31', () => {
    expect(() => setSettlementConfigSchema.parse({ windowType: 'MONTHLY', startDay: 32 })).toThrow();
  });

  it('rejects invalid windowType', () => {
    expect(() => setSettlementConfigSchema.parse({ windowType: 'DAILY', startDay: 1 })).toThrow();
  });

  it('rejects missing startDay', () => {
    expect(() => setSettlementConfigSchema.parse({ windowType: 'WEEKLY' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// generatePayoutsSchema
// ---------------------------------------------------------------------------

describe('generatePayoutsSchema', () => {
  it('accepts valid date range', () => {
    expect(() =>
      generatePayoutsSchema.parse({ periodStart: '2026-01-01', periodEnd: '2026-01-31' }),
    ).not.toThrow();
  });

  it('rejects missing periodStart', () => {
    expect(() => generatePayoutsSchema.parse({ periodEnd: '2026-01-31' })).toThrow();
  });

  it('rejects missing periodEnd', () => {
    expect(() => generatePayoutsSchema.parse({ periodStart: '2026-01-01' })).toThrow();
  });

  it('rejects invalid date format for periodStart', () => {
    expect(() =>
      generatePayoutsSchema.parse({ periodStart: '01/01/2026', periodEnd: '2026-01-31' }),
    ).toThrow();
  });

  it('rejects invalid date format for periodEnd', () => {
    expect(() =>
      generatePayoutsSchema.parse({ periodStart: '2026-01-01', periodEnd: 'January 31 2026' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createCommissionPlanSchema
// ---------------------------------------------------------------------------

describe('createCommissionPlanSchema', () => {
  const baseValid = {
    role: 'CS_AGENT',
    planName: 'Standard CS Plan',
    rules: { baseSalary: 50000, baseThreshold: 50, perOrderRate: 1000 },
    effectiveFrom: '2026-01-01',
  };

  it('accepts valid commission plan', () => {
    expect(() => createCommissionPlanSchema.parse(baseValid)).not.toThrow();
  });

  it('treats empty role as universal (per-user assignment template)', () => {
    expect(() => createCommissionPlanSchema.parse({ ...baseValid, role: '' })).not.toThrow();
    const parsed = createCommissionPlanSchema.parse({ ...baseValid, role: null });
    expect(parsed.role).toBeNull();
  });

  it('rejects unknown role value', () => {
    expect(() =>
      createCommissionPlanSchema.parse({ ...baseValid, role: 'NOT_A_REAL_ROLE' }),
    ).toThrow();
  });

  it('rejects planName shorter than 2 chars', () => {
    expect(() => createCommissionPlanSchema.parse({ ...baseValid, planName: 'A' })).toThrow();
  });

  it('rejects planName longer than 200 chars', () => {
    expect(() => createCommissionPlanSchema.parse({ ...baseValid, planName: 'A'.repeat(201) })).toThrow();
  });

  it('rejects negative baseSalary in rules', () => {
    expect(() =>
      createCommissionPlanSchema.parse({ ...baseValid, rules: { baseSalary: -1 } }),
    ).toThrow();
  });

  it('rejects deliveryRateThreshold above 100', () => {
    expect(() =>
      createCommissionPlanSchema.parse({
        ...baseValid,
        rules: { deliveryRateThreshold: 101 },
      }),
    ).toThrow();
  });

  it('rejects invalid date format for effectiveFrom', () => {
    expect(() =>
      createCommissionPlanSchema.parse({ ...baseValid, effectiveFrom: 'Jan 1 2026' }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createAdjustmentSchema
// ---------------------------------------------------------------------------

describe('createAdjustmentSchema', () => {
  const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts valid bonus adjustment', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        amount: 5000,
        category: 'BONUS',
        reason: 'Performance bonus for Q1',
      }),
    ).not.toThrow();
  });

  it('rejects negative amount', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        amount: -500,
        category: 'BONUS',
        reason: 'Performance bonus',
      }),
    ).toThrow();
  });

  it('rejects reason shorter than 5 chars', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        amount: 5000,
        category: 'BONUS',
        reason: 'Hi',
      }),
    ).toThrow();
  });

  it('rejects invalid category', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        amount: 5000,
        category: 'PROMOTION',
        reason: 'Performance bonus for Q1',
      }),
    ).toThrow();
  });

  it('accepts CLAWBACK category', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        amount: 2000,
        category: 'CLAWBACK',
        reason: 'Order returned by customer',
      }),
    ).not.toThrow();
  });

  it('coerces string amount to number', () => {
    const result = createAdjustmentSchema.parse({
      staffId: VALID_UUID,
      amount: '5000',
      category: 'BONUS',
      reason: 'Performance bonus for Q1',
    });
    expect(typeof result.amount).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// approvePayoutSchema
// ---------------------------------------------------------------------------

describe('approvePayoutSchema', () => {
  const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts APPROVED status', () => {
    expect(() => approvePayoutSchema.parse({ payoutId: VALID_UUID, status: 'APPROVED' })).not.toThrow();
  });

  it('accepts PAID status', () => {
    expect(() => approvePayoutSchema.parse({ payoutId: VALID_UUID, status: 'PAID' })).not.toThrow();
  });

  it('accepts REJECTED status', () => {
    expect(() => approvePayoutSchema.parse({ payoutId: VALID_UUID, status: 'REJECTED' })).not.toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => approvePayoutSchema.parse({ payoutId: VALID_UUID, status: 'PENDING' })).toThrow();
  });

  it('rejects notes longer than 500 chars', () => {
    expect(() =>
      approvePayoutSchema.parse({
        payoutId: VALID_UUID,
        status: 'APPROVED',
        notes: 'A'.repeat(501),
      }),
    ).toThrow();
  });
});
