-- Migration 0285: Allow earnings adjustments (deductions / bonuses / penalties)
-- against external contractors, not just staff users.
--
-- Contractors live in a separate `payroll_contractors` table (fixed monthly fee).
-- Previously `earnings_adjustments.staff_id` was NOT NULL with an FK to users, so
-- contractors could never be adjusted. This mirrors the earlier payout_records
-- change (migration 0283): add `contractor_id`, make `staff_id` nullable, and
-- enforce that exactly one party is set.
--
-- HISTORY-TRIGGER SAFETY: earnings_adjustments uses the GENERIC capture functions
-- (yannis_capture_history / yannis_capture_history_insert), which do
-- `INSERT INTO earnings_adjustments_history SELECT ($1).*` — a positional copy.
-- The history table MUST stay column-compatible, so every change below is applied
-- to BOTH tables. `ADD COLUMN` appends in the same relative position on each, so
-- positional order stays aligned.

-- 1. Live table: make staff_id nullable + add contractor_id.
ALTER TABLE earnings_adjustments
  ALTER COLUMN staff_id DROP NOT NULL;

ALTER TABLE earnings_adjustments
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES payroll_contractors(id);

-- Exactly one of staff_id / contractor_id must be set.
DO $$ BEGIN
  ALTER TABLE earnings_adjustments
    ADD CONSTRAINT earnings_adjustments_party_xor
    CHECK ((staff_id IS NOT NULL) <> (contractor_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Mirror onto earnings_adjustments_history (no CHECK — history holds all
--    historical shapes and must never reject a captured row).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'earnings_adjustments_history'
  ) THEN
    ALTER TABLE earnings_adjustments_history ALTER COLUMN staff_id DROP NOT NULL;
    ALTER TABLE earnings_adjustments_history ADD COLUMN IF NOT EXISTS contractor_id uuid;
  END IF;
END $$;
