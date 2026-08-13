/**
 * Attendance-based base-salary eligibility (Track C).
 *
 * A staff member's base salary can be reduced when their ABSENT count for the
 * period exceeds an HR-configured threshold. Only ABSENT days matter — Off-duty
 * (O) and Sick (S) never affect pay. The consequence is expressed as tiered
 * absence BANDS, each with a base-salary deduction percent, configured per pay
 * role (see `payroll_pay_roles.attendance_config`).
 *
 * Design decisions (locked with HR):
 *  - Bands are keyed on the ABSENT count only.
 *  - The deduction is a PERCENT of base; PAYE then follows the reduced base (we
 *    do NOT separately zero PAYE — a 100% band leaves base 0 so PAYE on base is
 *    naturally 0; a 50% band leaves half the base, correctly taxed).
 *  - The gate is ABSOLUTE and applies AFTER proration: it multiplies whatever
 *    base survived mid-month proration. Over the limit = the band's cut, period.
 *  - Attendance affects pay ONLY when the role's config `enabled` is true
 *    (default OFF). A per-user override can force it OFF (or ON) — resolved by
 *    the caller before this function runs.
 */

/** One configured absence band. Matches from `minAbsences` upward until the next band's floor. */
export interface AbsenceBand {
  /** Inclusive lower bound on the ABSENT count for this band to apply. */
  minAbsences: number;
  /** Percent of base salary to DEDUCT while in this band. 0 = no cut, 100 = full wipe. */
  deductionPercent: number;
}

/** Per-pay-role attendance configuration (stored as JSONB on payroll_pay_roles). */
export interface AttendanceConfig {
  /** When false, attendance never affects pay for this role. Default OFF. */
  enabled: boolean;
  /**
   * Tiered absence bands. Need not be sorted or cover 0 — a count matching no
   * band incurs no deduction. Conventionally the first band is `{minAbsences: 0,
   * deductionPercent: 0}` (or omitted) and higher bands add cuts.
   */
  bands: AbsenceBand[];
}

export interface AttendanceEligibilityResult {
  /** Whether attendance was evaluated at all (role enabled + override didn't disable). */
  evaluated: boolean;
  /** The ABSENT count fed in. */
  absences: number;
  /** The band that matched (highest `minAbsences` <= absences), or null if none. */
  matchedBand: AbsenceBand | null;
  /** Percent of base deducted (0 when no band matched or not evaluated). */
  deductionPercent: number;
  /** Multiplier applied to the (already-prorated) base: 1 - deductionPercent/100, clamped [0,1]. */
  baseFraction: number;
  /** True when the deduction is > 0 (base was reduced). Drives the "at risk" flag + payslip reason. */
  baseReduced: boolean;
  /** Human-readable reason for the payslip snapshot + readiness panel. Null when no reduction. */
  reason: string | null;
}

/**
 * Resolve the base-salary consequence of a staff member's absences for a period.
 *
 * `enabled` should already fold in the per-user override (role default unless the
 * user forces ON/OFF) — this function only sees the effective on/off + bands.
 */
export function computeAttendanceEligibility(input: {
  absences: number;
  config: AttendanceConfig | null | undefined;
}): AttendanceEligibilityResult {
  const absences = Number.isFinite(input.absences) ? Math.max(0, Math.trunc(input.absences)) : 0;

  const notEvaluated: AttendanceEligibilityResult = {
    evaluated: false,
    absences,
    matchedBand: null,
    deductionPercent: 0,
    baseFraction: 1,
    baseReduced: false,
    reason: null,
  };

  const config = input.config;
  if (!config || !config.enabled || !Array.isArray(config.bands) || config.bands.length === 0) {
    return notEvaluated;
  }

  // Highest band whose floor the absent count reaches.
  let matchedBand: AbsenceBand | null = null;
  for (const band of config.bands) {
    if (!band || !Number.isFinite(band.minAbsences)) continue;
    if (absences >= band.minAbsences) {
      if (matchedBand == null || band.minAbsences > matchedBand.minAbsences) {
        matchedBand = band;
      }
    }
  }

  const deductionPercent = matchedBand
    ? Math.min(100, Math.max(0, Number(matchedBand.deductionPercent) || 0))
    : 0;
  const baseFraction = Math.min(1, Math.max(0, 1 - deductionPercent / 100));
  const baseReduced = deductionPercent > 0;

  return {
    evaluated: true,
    absences,
    matchedBand,
    deductionPercent,
    baseFraction,
    baseReduced,
    reason: baseReduced
      ? `${absences} absence${absences === 1 ? '' : 's'} — ${deductionPercent}% base salary deduction (attendance band ≥${matchedBand!.minAbsences})`
      : null,
  };
}

/**
 * Count ABSENT days from a fetched set of attendance records for a staff member.
 * Only status === 'ABSENT' counts toward pay eligibility; PRESENT/OFF_DUTY/SICK
 * (and days with no record) do not. Pure — the caller fetches the window.
 */
export function countAbsencesInWindow(
  records: Array<{ status: string }> | null | undefined,
): number {
  if (!Array.isArray(records)) return 0;
  let n = 0;
  for (const r of records) {
    if (r && r.status === 'ABSENT') n++;
  }
  return n;
}

/**
 * Whether attendance is effectively ON for a staff member, folding the per-user
 * override over the pay role's default. Override values:
 *   - null/undefined → inherit the role default (`roleEnabled`)
 *   - true  → force ON
 *   - false → force OFF
 */
export function resolveAttendanceEnabled(
  roleEnabled: boolean | null | undefined,
  userOverride: boolean | null | undefined,
): boolean {
  if (userOverride === true) return true;
  if (userOverride === false) return false;
  return roleEnabled === true;
}
