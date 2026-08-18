-- Migration 0327: Track CONTRACTOR attendance on the same sheet as staff.
--
-- attendance_records was staff-only (staff_id NOT NULL → users). Contractors live
-- in payroll_contractors, so to mark their attendance we make the record polymorphic:
-- EXACTLY ONE of staff_id (users) OR contractor_id (payroll_contractors) is set,
-- mirroring earnings_adjustments' staff/contractor XOR.
--
-- HISTORY TWIN: attendance_records_history uses the POSITIONAL yannis_capture_history()
-- trigger (INSERT ... SELECT ($1).*), so every column added to the live table MUST be
-- appended to the history twin in the SAME ORDER. We append contractor_id to BOTH.

-- ── 1. Add contractor_id + relax staff_id NOT NULL on the live table ─────────
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES payroll_contractors(id);
ALTER TABLE attendance_records
  ALTER COLUMN staff_id DROP NOT NULL;

-- Exactly one party (staff XOR contractor).
DO $$ BEGIN
  ALTER TABLE attendance_records
    ADD CONSTRAINT attendance_records_party_xor
    CHECK ((staff_id IS NOT NULL) <> (contractor_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Mirror the column onto the history twin (positional alignment) ────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'attendance_records_history'
  ) THEN
    ALTER TABLE attendance_records_history
      ADD COLUMN IF NOT EXISTS contractor_id uuid;
  END IF;
END $$;

-- ── 3. Unique indexes: partial per party (one record per party per day) ──────
-- The old plain unique index on (staff_id, attendance_date) breaks now that
-- staff_id can be NULL (multiple contractor rows share NULL staff_id). Replace
-- with partial indexes scoped to non-null party.
DROP INDEX IF EXISTS uq_attendance_staff_day;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_staff_day
  ON attendance_records (staff_id, attendance_date)
  WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_contractor_day
  ON attendance_records (contractor_id, attendance_date)
  WHERE contractor_id IS NOT NULL;
-- Scan index for grid/summary lookups by contractor.
CREATE INDEX IF NOT EXISTS attendance_records_contractor_idx
  ON attendance_records (contractor_id)
  WHERE contractor_id IS NOT NULL;
