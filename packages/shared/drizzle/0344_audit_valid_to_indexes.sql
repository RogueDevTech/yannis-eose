-- Audit log: index `valid_to` on every *_history table.
--
-- The audit UI orders and date-filters by "when did this change happen". That is
-- `valid_to`, NOT `valid_from`: `yannis_capture_history()` sets
-- `OLD.valid_to := now()` on every UPDATE and never touches `valid_from`, so all
-- history rows for one record share a single `valid_from` (the record's creation
-- instant) while `valid_to` carries the actual transition time.
--
-- Migration 0118 indexed (valid_from DESC) for the old sort. Switching the audit
-- query to `valid_to` without a matching index would drop index support across
-- 30+ history tables, so mirror 0118's index set onto valid_to.
--
-- Idempotent + defensive, same as 0118: some early history tables were created
-- with `LIKE` without `INCLUDING DEFAULTS` and are missing these columns.

DO $$
DECLARE
  hist_table TEXT;
BEGIN
  FOR hist_table IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name LIKE '%\_history'
      AND table_type = 'BASE TABLE'
  LOOP
    -- Primary sort key for the global audit log.
    -- NULLS FIRST matches `ORDER BY valid_to DESC NULLS FIRST` in
    -- audit.service.ts — the live row (valid_to IS NULL) is the newest state.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = hist_table
        AND column_name = 'valid_to'
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (valid_to DESC NULLS FIRST)',
        hist_table || '_valid_to_desc_idx',
        hist_table
      );
    END IF;

    -- Actor-filtered audit queries (`?actorId=X`) need the composite so the
    -- planner can filter by actor and still walk the sort order.
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = hist_table
        AND column_name = 'modified_by'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = hist_table
        AND column_name = 'valid_to'
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (modified_by, valid_to DESC NULLS FIRST)',
        hist_table || '_modified_by_valid_to_idx',
        hist_table
      );
    END IF;
  END LOOP;
END $$;
