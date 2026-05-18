-- Junction table for Media Buyer ↔ Product assignments. The Drizzle schema
-- (`packages/shared/src/db/schema/users.ts::userProductAssignments`) has always
-- declared this table, but no early migration ever created it on databases that
-- never ran the original baseline. `products.list` joins this table when filtering
-- by viewer's assigned products → it errors with
--   relation "user_product_assignments" does not exist
-- on those installs.
--
-- Idempotent: only creates the table + history table + trigger if missing.

CREATE TABLE IF NOT EXISTS user_product_assignments (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id),
  product_id   uuid NOT NULL REFERENCES products(id),
  valid_from   timestamptz NOT NULL DEFAULT now(),
  valid_to     timestamptz,
  modified_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_product_assignments_user_id_idx
  ON user_product_assignments (user_id);

CREATE INDEX IF NOT EXISTS user_product_assignments_product_id_idx
  ON user_product_assignments (product_id);

CREATE TABLE IF NOT EXISTS user_product_assignments_history (
  id           uuid NOT NULL,
  user_id      uuid,
  product_id   uuid,
  valid_from   timestamptz NOT NULL,
  valid_to     timestamptz,
  modified_by  uuid,
  created_at   timestamptz,
  updated_at   timestamptz
);

CREATE INDEX IF NOT EXISTS user_product_assignments_history_id_idx
  ON user_product_assignments_history (id);

-- Wire the standard temporal triggers if they don't already exist.
-- The generic `yannis_capture_history_insert` and `yannis_capture_history` functions
-- copy NEW.* / OLD.* into the matching `_history` table — column order matches.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_user_product_assignments_capture_history_insert'
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_user_product_assignments_capture_history_insert
             AFTER INSERT ON user_product_assignments
             FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert()';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_user_product_assignments_capture_history'
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_user_product_assignments_capture_history
             BEFORE UPDATE OR DELETE ON user_product_assignments
             FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_user_product_assignments_stamp_actor'
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_user_product_assignments_stamp_actor
             BEFORE INSERT OR UPDATE ON user_product_assignments
             FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()';
  END IF;
END
$$;
