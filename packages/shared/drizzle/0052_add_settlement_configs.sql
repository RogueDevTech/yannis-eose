-- settlement_configs + temporal audit (table was in Drizzle schema but never migrated;
-- 0025 only attached triggers when the table already existed.)

DO $$ BEGIN
  CREATE TYPE settlement_window AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS settlement_configs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  window_type   settlement_window NOT NULL,
  start_day     INTEGER NOT NULL DEFAULT 1,
  created_by    TEXT NOT NULL REFERENCES users (id),
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to      TIMESTAMPTZ,
  modified_by   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- History + audit triggers (same pattern as 0025_audit_add_gap1_temporal_tables)
DO $$
DECLARE
  _t TEXT := 'settlement_configs';
  _constraint RECORD;
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL)',
    _t || '_history',
    _t
  );

  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = _t || '_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      _t || '_history',
      _constraint.constraint_name
    );
  END LOOP;

  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I ON %I (id, valid_from, valid_to)',
    _t || '_history_temporal_idx',
    _t || '_history'
  );

  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%I_stamp_actor ON %I',
    _t, _t
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%I_stamp_actor BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
    _t, _t
  );

  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%I_capture_history ON %I',
    _t, _t
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%I_capture_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
    _t, _t
  );

  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%I_immutable ON %I',
    _t || '_history', _t || '_history'
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
    _t || '_history', _t || '_history'
  );

  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_%I_capture_history_insert ON %I',
    _t, _t
  );
  EXECUTE format(
    'CREATE TRIGGER trg_%I_capture_history_insert
     AFTER INSERT ON %I
     FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert()',
    _t, _t
  );
END;
$$;
