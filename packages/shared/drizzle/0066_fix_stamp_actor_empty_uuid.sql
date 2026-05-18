-- ============================================
-- 0066: Fix `yannis_stamp_actor()` so it tolerates the unset / empty
--       `yannis.current_user_id` setting.
--
-- Why:
--   Migration 0062 converted the `modified_by` columns on every temporal table
--   from `text` to `uuid`. It updated `yannis_current_user_id()` to return
--   `NULLIF(current_setting('yannis.current_user_id', true), '')::uuid`
--   (so the helper safely yields NULL when the GUC isn't set), but the
--   BEFORE-INSERT/UPDATE trigger function `yannis_stamp_actor()` was left as:
--
--     NEW.modified_by := current_setting('yannis.current_user_id', true);
--
--   `current_setting(..., true)` returns the literal empty string `''` when
--   the GUC is unset. Postgres then tries to coerce `''` into the now-`uuid`
--   `modified_by` column and throws:
--
--     invalid input syntax for type uuid: ""
--
--   This breaks every write that does NOT pass through `withActor()` — most
--   visibly the unauthenticated paths (login attempts, password-reset email
--   flows, signup) where there is no logged-in actor to stamp. Users
--   reported being unable to log in or reset their password.
--
-- Fix:
--   Wrap the read in `NULLIF(..., '')::uuid` so an unset / blank GUC stamps
--   the row with NULL instead of crashing the transaction. Authenticated
--   writes that go through `withActor()` continue to stamp the real UUID.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ============================================

CREATE OR REPLACE FUNCTION yannis_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  -- Empty string GUC -> NULL -> NULL uuid. Any real uuid string casts cleanly.
  NEW.modified_by := NULLIF(current_setting('yannis.current_user_id', true), '')::uuid;
  IF NEW.valid_from IS NULL THEN
    NEW.valid_from := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- `yannis_capture_history()` only copies OLD into the *_history twin and does
-- not call `current_setting()` itself in the canonical definition, so it
-- doesn't need patching. Re-declare it idempotently anyway so any prod-side
-- drift (a hand-edited longer version that read current_setting directly) is
-- replaced with the safe canonical body.
CREATE OR REPLACE FUNCTION yannis_capture_history()
RETURNS TRIGGER AS $$
DECLARE
  _history_table TEXT;
BEGIN
  _history_table := TG_TABLE_NAME || '_history';
  OLD.valid_to := now();
  EXECUTE format('INSERT INTO %I SELECT ($1).*', _history_table) USING OLD;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
