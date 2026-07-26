-- Sync journal_entries_history with Phase 5 approval columns (0243).
-- Without this, yannis_capture_history_insert fails on INSERT with:
-- "INSERT has more expressions than target columns"

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'journal_entries_history'
  ) THEN
    ALTER TABLE journal_entries_history ADD COLUMN IF NOT EXISTS approved_by uuid;
    ALTER TABLE journal_entries_history ADD COLUMN IF NOT EXISTS approved_at timestamptz;
  END IF;
END $$;
