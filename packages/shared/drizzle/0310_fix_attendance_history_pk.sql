-- Migration 0310: Fix attendance_records_history — drop PK + UNIQUE constraints.
--
-- BUG: 0309 created attendance_records_history via `LIKE attendance_records
-- INCLUDING ALL`, which copies the PRIMARY KEY on `id` AND the unique index
-- `uq_attendance_staff_day (staff_id, attendance_date)`. History tables store
-- MANY versions of the same row (same id / same staff+day, different valid_from),
-- so those constraints reject the 2nd captured version with:
--   duplicate key value violates unique constraint "attendance_records_history_pkey"
-- (or "..._uq_attendance_staff_day"). This surfaces on bulk-mark, where the same
-- staff/day can be updated more than once and each UPDATE captures history.
--
-- The generic history bootstrap (0003) drops these constraints for tables in its
-- registry loop, but attendance_records was provisioned directly here, so it was
-- never processed. Drop ALL PK + UNIQUE constraints on the history table now
-- (idempotent — mirrors the 0003 loop), and drop any leftover unique INDEXES the
-- LIKE copy may have carried that aren't backed by a constraint.

DO $$
DECLARE
  _constraint text;
  _index text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'attendance_records_history'
  ) THEN
    RETURN;
  END IF;

  -- Drop PRIMARY KEY + UNIQUE constraints.
  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'attendance_records_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE attendance_records_history DROP CONSTRAINT IF EXISTS %I', _constraint);
  END LOOP;

  -- Drop any standalone unique INDEXES copied by LIKE (e.g. uq_attendance_staff_day)
  -- that aren't tied to a constraint above.
  FOR _index IN
    SELECT indexrelid::regclass::text
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE i.indisunique
      AND n.nspname = 'public'
      AND i.indrelid = 'public.attendance_records_history'::regclass
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %s', _index);
  END LOOP;
END $$;
