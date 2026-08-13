import { describe, it, expect } from 'vitest';
import {
  computeAttendanceEligibility,
  resolveAttendanceEnabled,
  type AttendanceConfig,
} from './attendance-eligibility';

/** The HR worked example: 0-3 free, 4-6 → 50%, 7+ → 100%. */
const tieredConfig: AttendanceConfig = {
  enabled: true,
  bands: [
    { minAbsences: 0, deductionPercent: 0 },
    { minAbsences: 4, deductionPercent: 50 },
    { minAbsences: 7, deductionPercent: 100 },
  ],
};

describe('computeAttendanceEligibility — tiered bands', () => {
  it('no deduction within the free band (0-3 absences)', () => {
    for (const a of [0, 1, 2, 3]) {
      const r = computeAttendanceEligibility({ absences: a, config: tieredConfig });
      expect(r.evaluated).toBe(true);
      expect(r.deductionPercent).toBe(0);
      expect(r.baseFraction).toBe(1);
      expect(r.baseReduced).toBe(false);
      expect(r.reason).toBeNull();
    }
  });

  it('crosses into the 50% band at exactly 4 absences', () => {
    const r = computeAttendanceEligibility({ absences: 4, config: tieredConfig });
    expect(r.deductionPercent).toBe(50);
    expect(r.baseFraction).toBe(0.5);
    expect(r.baseReduced).toBe(true);
    expect(r.matchedBand?.minAbsences).toBe(4);
    expect(r.reason).toContain('50%');
  });

  it('stays in the 50% band through 6 absences', () => {
    const r = computeAttendanceEligibility({ absences: 6, config: tieredConfig });
    expect(r.deductionPercent).toBe(50);
  });

  it('full wipe at 7+ absences (base fraction 0)', () => {
    const r = computeAttendanceEligibility({ absences: 9, config: tieredConfig });
    expect(r.deductionPercent).toBe(100);
    expect(r.baseFraction).toBe(0);
    expect(r.baseReduced).toBe(true);
  });
});

describe('computeAttendanceEligibility — disabled / no config', () => {
  it('not evaluated when config is null', () => {
    const r = computeAttendanceEligibility({ absences: 20, config: null });
    expect(r.evaluated).toBe(false);
    expect(r.baseFraction).toBe(1);
  });

  it('not evaluated when role toggle is OFF, regardless of absences', () => {
    const r = computeAttendanceEligibility({
      absences: 30,
      config: { enabled: false, bands: tieredConfig.bands },
    });
    expect(r.evaluated).toBe(false);
    expect(r.baseReduced).toBe(false);
    expect(r.baseFraction).toBe(1);
  });

  it('no deduction when enabled but bands array is empty', () => {
    const r = computeAttendanceEligibility({ absences: 30, config: { enabled: true, bands: [] } });
    expect(r.evaluated).toBe(false);
    expect(r.baseFraction).toBe(1);
  });
});

describe('computeAttendanceEligibility — robustness', () => {
  it('picks the HIGHEST matching band even if bands are unsorted', () => {
    const unsorted: AttendanceConfig = {
      enabled: true,
      bands: [
        { minAbsences: 7, deductionPercent: 100 },
        { minAbsences: 0, deductionPercent: 0 },
        { minAbsences: 4, deductionPercent: 50 },
      ],
    };
    expect(computeAttendanceEligibility({ absences: 8, config: unsorted }).deductionPercent).toBe(100);
    expect(computeAttendanceEligibility({ absences: 5, config: unsorted }).deductionPercent).toBe(50);
  });

  it('clamps a deduction percent above 100', () => {
    const r = computeAttendanceEligibility({
      absences: 5,
      config: { enabled: true, bands: [{ minAbsences: 4, deductionPercent: 150 }] },
    });
    expect(r.deductionPercent).toBe(100);
    expect(r.baseFraction).toBe(0);
  });

  it('floors negative / fractional absence counts', () => {
    expect(computeAttendanceEligibility({ absences: -3, config: tieredConfig }).absences).toBe(0);
    expect(computeAttendanceEligibility({ absences: 4.9, config: tieredConfig }).absences).toBe(4);
  });
});

describe('gate-over-proration semantics (baseFraction is a multiplier)', () => {
  it('multiplies the already-prorated base: mid-month hire + over-limit', () => {
    // Proration gave 12/26 of ₦120,000 = ~₦55,384.62; then the 50% band applies.
    const proratedBase = 120_000 * (12 / 26);
    const r = computeAttendanceEligibility({ absences: 5, config: tieredConfig });
    const finalBase = proratedBase * r.baseFraction;
    expect(finalBase).toBeCloseTo(proratedBase * 0.5, 2);
    expect(finalBase).toBeCloseTo(27_692.31, 2);
  });

  it('full wipe zeroes the base regardless of proration', () => {
    const proratedBase = 120_000 * (12 / 26);
    const r = computeAttendanceEligibility({ absences: 10, config: tieredConfig });
    expect(proratedBase * r.baseFraction).toBe(0);
  });
});

describe('resolveAttendanceEnabled — override folding', () => {
  it('inherits the role default when no override', () => {
    expect(resolveAttendanceEnabled(true, null)).toBe(true);
    expect(resolveAttendanceEnabled(false, null)).toBe(false);
    expect(resolveAttendanceEnabled(true, undefined)).toBe(true);
  });

  it('force ON overrides a role default of OFF', () => {
    expect(resolveAttendanceEnabled(false, true)).toBe(true);
  });

  it('force OFF overrides a role default of ON', () => {
    expect(resolveAttendanceEnabled(true, false)).toBe(false);
  });
});
