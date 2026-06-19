-- 0220: Re-apply yannis_capture_history() DELETE fix.
--
-- The function must RETURN OLD on DELETE (not RETURN NEW, which is NULL and
-- silently cancels the delete). Migration 0074 fixed this originally, but
-- migration 0066 (which ran before 0074 in sequence but was re-applied or
-- the DB was restored from a pre-0074 state) overwrote it with RETURN NEW.
--
-- Impact: every DELETE on any temporal table (orders, order_items,
-- cart_order_items, follow_up_order_items, etc.) was silently no-op'd.
-- Items appeared to duplicate because adjustItems delete+reinsert only
-- inserted — the delete was swallowed.

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
