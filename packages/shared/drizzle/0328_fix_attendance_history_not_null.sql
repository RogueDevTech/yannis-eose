-- Migration 0328: Drop NOT NULL constraints on attendance_records_history.
--
-- BUG (prod): attendance.mark for a CONTRACTOR (staff_id NULL, contractor_id set)
-- fails with:
--   null value in column "staff_id" of relation "attendance_records_history"
--   violates not-null constraint
--
-- ROOT CAUSE: 0309 created the history twin via `LIKE attendance_records INCLUDING
-- ALL` while attendance_records.staff_id was still NOT NULL, so the twin inherited
-- staff_id NOT NULL. 0327 relaxed NOT NULL on the LIVE table (staff XOR contractor)
-- but never relaxed it on the twin. The positional yannis_capture_history() trigger
-- does `INSERT INTO ..._history SELECT ($1).*`, so a NULL staff_id row (contractor
-- attendance) is rejected by the twin's leftover NOT NULL.
--
-- History twins must NEVER enforce NOT NULL: they store many versions of a row,
-- including partial/old shapes, positionally. The generic 0003 bootstrap strips
-- NOT NULL for registered tables, but attendance_records_history was provisioned
-- directly in 0309 and never went through that loop (same gap 0310 patched for
-- PK/UNIQUE constraints). Strip ALL NOT NULL now — idempotent, mirrors 0003.

DO $$
DECLARE
  _col text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'attendance_records_history'
  ) THEN
    RETURN;
  END IF;

  FOR _col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'attendance_records_history'
      AND is_nullable = 'NO'
  LOOP
    EXECUTE format(
      'ALTER TABLE attendance_records_history ALTER COLUMN %I DROP NOT NULL',
      _col
    );
  END LOOP;
END $$;
