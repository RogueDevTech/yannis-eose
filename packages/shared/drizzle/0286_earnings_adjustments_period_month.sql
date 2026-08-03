-- Migration 0286: Let an earnings adjustment target a specific payroll month.
--
-- Previously an adjustment (deduction / add-on) had no period. The batch sweep
-- linked EVERY pending adjustment for a staff/contractor (payout_id IS NULL) into
-- whatever batch was generated FIRST for that party, regardless of when the
-- adjustment was made. This adds `period_month` (YYYY-MM-01) so HR can earmark an
-- adjustment for a specific month's batch. NULL keeps the legacy behavior: the
-- adjustment attaches to the next batch generated for that party, any month.
--
-- Sweep predicate becomes:
--   payout_id IS NULL AND (period_month IS NULL OR period_month = <batch month>)
--
-- HISTORY-TRIGGER SAFETY: earnings_adjustments uses the GENERIC capture functions
-- (yannis_capture_history / yannis_capture_history_insert), which do
-- `INSERT INTO earnings_adjustments_history SELECT ($1).*` — a positional copy.
-- The history table MUST stay column-compatible, so the column is added to BOTH
-- tables. `ADD COLUMN` appends in the same relative position on each, so
-- positional order stays aligned.

-- 1. Live table.
ALTER TABLE earnings_adjustments
  ADD COLUMN IF NOT EXISTS period_month date;

-- 2. Mirror onto earnings_adjustments_history (must stay positionally aligned).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'earnings_adjustments_history'
  ) THEN
    ALTER TABLE earnings_adjustments_history ADD COLUMN IF NOT EXISTS period_month date;
  END IF;
END $$;
