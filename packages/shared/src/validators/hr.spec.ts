import { describe, it, expect } from 'vitest';
import {
  setSettlementConfigSchema,
  generatePayoutsSchema,
  createCommissionPlanSchema,
  createAdjustmentSchema,
  approvePayoutSchema,
  generateBatchSchema,
  generateBatchesBulkSchema,
  previewSelectionSchema,
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
    role: 'CS_CLOSER',
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

  it('accepts a contractor-targeted adjustment', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        contractorId: VALID_UUID,
        amount: 3000,
        category: 'DEDUCTION',
        reason: 'Damaged equipment recovery',
      }),
    ).not.toThrow();
  });

  it('rejects when neither staffId nor contractorId is set', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        amount: 3000,
        category: 'BONUS',
        reason: 'Missing target party',
      }),
    ).toThrow();
  });

  it('rejects when BOTH staffId and contractorId are set', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        contractorId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        amount: 3000,
        category: 'BONUS',
        reason: 'Ambiguous target party',
      }),
    ).toThrow();
  });

  it('coerces a negative add-on amount to positive by category', () => {
    const result = createAdjustmentSchema.parse({
      staffId: VALID_UUID,
      amount: -500,
      category: 'BONUS',
      reason: 'Performance bonus',
    });
    expect(result.amount).toBe(500);
  });

  it('stores deduction categories as negative regardless of input sign', () => {
    const result = createAdjustmentSchema.parse({
      staffId: VALID_UUID,
      amount: 500,
      category: 'DEDUCTION',
      reason: 'Uniform cost recovery',
    });
    expect(result.amount).toBe(-500);
  });

  it('rejects a zero amount', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        amount: 0,
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

  it('accepts an optional periodMonth in YYYY-MM-01 form', () => {
    const result = createAdjustmentSchema.parse({
      staffId: VALID_UUID,
      amount: 5000,
      category: 'BONUS',
      reason: 'Earmarked for August',
      periodMonth: '2026-08-01',
    });
    expect(result.periodMonth).toBe('2026-08-01');
  });

  it('omits periodMonth when not provided (legacy next-batch behavior)', () => {
    const result = createAdjustmentSchema.parse({
      staffId: VALID_UUID,
      amount: 5000,
      category: 'BONUS',
      reason: 'No month earmark',
    });
    expect(result.periodMonth).toBeUndefined();
  });

  it('rejects a periodMonth that is not the first of the month', () => {
    expect(() =>
      createAdjustmentSchema.parse({
        staffId: VALID_UUID,
        amount: 5000,
        category: 'BONUS',
        reason: 'Bad month value',
        periodMonth: '2026-08-15',
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

// ---------------------------------------------------------------------------
// generateBatchSchema — scope types (staff vs null-scope CONTRACTORS / ALL)
// ---------------------------------------------------------------------------

describe('generateBatchSchema', () => {
  const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts a normal staff batch with branch + department', () => {
    expect(() =>
      generateBatchSchema.parse({
        branchId: UUID,
        department: 'CS',
        periodMonth: '2026-08-01',
      }),
    ).not.toThrow();
  });

  it('rejects a staff batch missing department', () => {
    expect(() =>
      generateBatchSchema.parse({
        branchId: UUID,
        periodMonth: '2026-08-01',
      }),
    ).toThrow();
  });

  it('accepts a CONTRACTORS batch with no branch or department', () => {
    expect(() =>
      generateBatchSchema.parse({
        periodMonth: '2026-08-01',
        scopeType: 'CONTRACTORS',
      }),
    ).not.toThrow();
  });

  it('accepts a branch-pinned CONTRACTORS batch (Head running own branch)', () => {
    expect(() =>
      generateBatchSchema.parse({
        branchId: UUID,
        periodMonth: '2026-08-01',
        scopeType: 'CONTRACTORS',
      }),
    ).not.toThrow();
  });

  it('rejects a CONTRACTORS batch that targets a department', () => {
    expect(() =>
      generateBatchSchema.parse({
        periodMonth: '2026-08-01',
        scopeType: 'CONTRACTORS',
        department: 'CS',
      }),
    ).toThrow();
  });

  it('accepts an ALL batch with no branch or department', () => {
    expect(() =>
      generateBatchSchema.parse({
        periodMonth: '2026-08-01',
        scopeType: 'ALL',
      }),
    ).not.toThrow();
  });

  it('rejects an ALL batch that targets a specific branch', () => {
    expect(() =>
      generateBatchSchema.parse({
        branchId: UUID,
        periodMonth: '2026-08-01',
        scopeType: 'ALL',
      }),
    ).toThrow();
  });
});

describe('generateBatchesBulkSchema', () => {
  const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('requires at least one branch and department for a staff fan-out', () => {
    expect(() =>
      generateBatchesBulkSchema.parse({
        branchIds: [],
        departments: [],
        periodMonth: '2026-08-01',
      }),
    ).toThrow();
  });

  it('accepts a null-scope run with empty branch/department arrays', () => {
    expect(() =>
      generateBatchesBulkSchema.parse({
        branchIds: [],
        departments: [],
        periodMonth: '2026-08-01',
        scopeType: 'CONTRACTORS',
      }),
    ).not.toThrow();
  });

  it('accepts a normal staff fan-out', () => {
    expect(() =>
      generateBatchesBulkSchema.parse({
        branchIds: [UUID],
        departments: ['CS', 'MARKETING'],
        periodMonth: '2026-08-01',
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// previewSelectionSchema — looser than generate; allows multi-department preview
// ---------------------------------------------------------------------------

describe('previewSelectionSchema', () => {
  const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('accepts a multi-department preview (departments[] instead of a single dept)', () => {
    expect(() =>
      previewSelectionSchema.parse({
        periodMonth: '2026-08-01',
        scopeType: 'DEPARTMENT',
        scopeBranchIds: [UUID],
        departments: ['CS', 'MARKETING', 'HR'],
      }),
    ).not.toThrow();
  });

  it('accepts a single-department preview', () => {
    expect(() =>
      previewSelectionSchema.parse({
        periodMonth: '2026-08-01',
        branchId: UUID,
        department: 'CS',
      }),
    ).not.toThrow();
  });

  it('accepts CONTRACTORS / ALL preview with no department', () => {
    expect(() =>
      previewSelectionSchema.parse({ periodMonth: '2026-08-01', scopeType: 'CONTRACTORS' }),
    ).not.toThrow();
    expect(() =>
      previewSelectionSchema.parse({ periodMonth: '2026-08-01', scopeType: 'ALL' }),
    ).not.toThrow();
  });

  it('rejects a staff preview with no department at all', () => {
    expect(() =>
      previewSelectionSchema.parse({ periodMonth: '2026-08-01', scopeBranchIds: [UUID] }),
    ).toThrow();
  });
});
