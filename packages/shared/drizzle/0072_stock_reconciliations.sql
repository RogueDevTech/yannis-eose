-- stock_reconciliations + reconciliation_status enum
-- Drizzle schema existed in packages/shared but no migration created the table;
-- inventory.createReconciliation failed with: relation "stock_reconciliations" does not exist.

DO $$ BEGIN
  CREATE TYPE reconciliation_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS stock_reconciliations (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  location_id           TEXT NOT NULL REFERENCES logistics_locations (id),
  product_id            TEXT NOT NULL REFERENCES products (id),
  digital_count         INTEGER NOT NULL,
  physical_count        INTEGER NOT NULL,
  discrepancy           INTEGER NOT NULL,
  reason_code           TEXT NOT NULL,
  notes                 TEXT,
  reconciliation_status reconciliation_status NOT NULL DEFAULT 'PENDING'::reconciliation_status,
  submitted_by          TEXT NOT NULL REFERENCES users (id),
  approved_by           TEXT REFERENCES users (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  valid_from            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to              TIMESTAMPTZ,
  modified_by           TEXT
);

CREATE INDEX IF NOT EXISTS stock_reconciliations_location_id_idx ON stock_reconciliations (location_id);
CREATE INDEX IF NOT EXISTS stock_reconciliations_status_idx ON stock_reconciliations (reconciliation_status);
CREATE INDEX IF NOT EXISTS stock_reconciliations_created_at_idx ON stock_reconciliations (created_at DESC);

-- History + temporal audit triggers (same pattern as 0052_add_settlement_configs.sql)
DO $$
DECLARE
  _t TEXT := 'stock_reconciliations';
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
