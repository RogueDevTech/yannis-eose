-- ============================================
-- 0074: Fix `yannis_capture_history()` BEFORE DELETE return value.
--
-- Why:
--   The trigger is `BEFORE UPDATE OR DELETE`. For DELETE, PostgreSQL sets NEW
--   to NULL. Returning NULL from a BEFORE DELETE row trigger cancels the delete
--   (see PostgreSQL docs: "If NULL is returned, the operation for the current
--   row is skipped"). The function always `RETURN NEW`, so DELETE never removed
--   rows from temporal main tables — maintenance scripts (e.g. product dedupe)
--   appeared to succeed while leaving duplicate rows in place.
--
-- Fix:
--   On DELETE, return OLD so the row is removed after history capture.
--   On UPDATE, keep returning NEW.
-- ============================================

CREATE OR REPLACE FUNCTION yannis_capture_history()
RETURNS TRIGGER AS $$
DECLARE
  _history_table TEXT;
BEGIN
  _history_table := TG_TABLE_NAME || '_history';
  OLD.valid_to := now();
  EXECUTE format('INSERT INTO %I SELECT ($1).*', _history_table) USING OLD;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
