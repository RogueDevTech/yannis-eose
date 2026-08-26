-- Migration 0335: Contractor attendance exemption.
--
-- Users already have `attendance_excluded` to drop staff from the attendance
-- roster. Contractors had no equivalent, so an agency contractor who does not
-- keep standard hours could not be marked exempt and risked being auto-absented.
--
-- Adds a per-contractor exempt flag plus who/when/why for audit. Exempt
-- contractors are excluded from the attendance roster and from any
-- attendance-based pay eligibility.
--
-- payroll_contractors is history-tracked by the positional yannis_capture_history()
-- trigger (INSERT ... SELECT ($1).*), so every new column MUST be appended to the
-- _history twin in the SAME ORDER (see mig 0280).

BEGIN;

ALTER TABLE payroll_contractors
  ADD COLUMN IF NOT EXISTS attendance_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE payroll_contractors
  ADD COLUMN IF NOT EXISTS attendance_exempt_reason text;
ALTER TABLE payroll_contractors
  ADD COLUMN IF NOT EXISTS attendance_exempt_by uuid;
ALTER TABLE payroll_contractors
  ADD COLUMN IF NOT EXISTS attendance_exempt_at timestamptz;

-- History twin: same columns, same order (nullable — history rows are snapshots).
ALTER TABLE payroll_contractors_history
  ADD COLUMN IF NOT EXISTS attendance_exempt boolean;
ALTER TABLE payroll_contractors_history
  ADD COLUMN IF NOT EXISTS attendance_exempt_reason text;
ALTER TABLE payroll_contractors_history
  ADD COLUMN IF NOT EXISTS attendance_exempt_by uuid;
ALTER TABLE payroll_contractors_history
  ADD COLUMN IF NOT EXISTS attendance_exempt_at timestamptz;

COMMIT;
