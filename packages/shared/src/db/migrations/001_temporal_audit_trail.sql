-- ============================================
-- Yannis EOSE — Temporal Audit Trail
-- Task 0.3: Immutable audit at the database level
-- ============================================

-- ============================================
-- 1. Actor Injection Function
-- Reads yannis.current_user_id from session config
-- and stamps it on every INSERT/UPDATE
-- ============================================

CREATE OR REPLACE FUNCTION yannis_stamp_actor()
RETURNS TRIGGER AS $$
DECLARE
  _actor_id TEXT;
  _has_updated_at BOOLEAN;
BEGIN
  _actor_id := current_setting('yannis.current_user_id', true);

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    NEW.modified_by := _actor_id;
    NEW.valid_from := now();
    NEW.valid_to := NULL;

    IF TG_OP = 'UPDATE' THEN
      -- Only set updated_at if the column exists on this table
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = TG_TABLE_NAME AND column_name = 'updated_at'
      ) INTO _has_updated_at;

      IF _has_updated_at THEN
        NEW.updated_at := now();
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 2. History Capture Function
-- On UPDATE: copies the OLD row into the _history table
-- with valid_to set to now()
-- On DELETE: copies the OLD row into _history as well
-- ============================================

CREATE OR REPLACE FUNCTION yannis_capture_history()
RETURNS TRIGGER AS $$
DECLARE
  _history_table TEXT;
  _actor_id TEXT;
BEGIN
  _history_table := TG_TABLE_NAME || '_history';
  _actor_id := current_setting('yannis.current_user_id', true);

  -- Close the time range on the old version
  OLD.valid_to := now();
  OLD.modified_by := _actor_id;

  -- Insert old version into history table
  EXECUTE format(
    'INSERT INTO %I SELECT ($1).*',
    _history_table
  ) USING OLD;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 3. Immutability Protection Function
-- Prevents any UPDATE or DELETE on _history tables
-- ============================================

CREATE OR REPLACE FUNCTION yannis_history_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit history records are immutable. Cannot % on %.',
    TG_OP, TG_TABLE_NAME;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 4. Time Travel Query Function
-- Given a table name, record ID, and timestamp,
-- returns the state of that record at that point in time.
-- ============================================

CREATE OR REPLACE FUNCTION yannis_time_travel(
  _table_name TEXT,
  _record_id TEXT,
  _at_time TIMESTAMPTZ
)
RETURNS JSONB AS $$
DECLARE
  _result JSONB;
  _history_table TEXT;
BEGIN
  _history_table := _table_name || '_history';

  -- First check history table for versions valid at _at_time
  EXECUTE format(
    'SELECT to_jsonb(t.*) FROM %I t WHERE t.id = $1 AND t.valid_from <= $2 AND (t.valid_to > $2 OR t.valid_to IS NULL) LIMIT 1',
    _history_table
  ) INTO _result USING _record_id, _at_time;

  -- If not in history, check the current table
  IF _result IS NULL THEN
    EXECUTE format(
      'SELECT to_jsonb(t.*) FROM %I t WHERE t.id = $1 AND t.valid_from <= $2 AND (t.valid_to IS NULL) LIMIT 1',
      _table_name
    ) INTO _result USING _record_id, _at_time;
  END IF;

  RETURN _result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. Create History Tables + Apply Triggers
-- For every business table that has temporal columns
-- ============================================

DO $$
DECLARE
  _tables TEXT[] := ARRAY[
    'users',
    'products',
    'stock_batches',
    'logistics_providers',
    'logistics_locations',
    'inventory_levels',
    'offer_templates',
    'campaigns',
    'orders',
    'order_items',
    'stock_transfers',
    'marketing_funding',
    'invoices',
    'commission_plans',
    'payout_records',
    'earnings_adjustments'
  ];
  _t TEXT;
BEGIN
  FOREACH _t IN ARRAY _tables
  LOOP
    -- Create history table as a copy of the main table structure
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL)',
      _t || '_history',
      _t
    );

    -- Drop ALL primary key and unique constraints on history table
    -- History tables must allow duplicate IDs (multiple versions of same record)
    DECLARE
      _constraint RECORD;
    BEGIN
      FOR _constraint IN
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        WHERE tc.table_name = _t || '_history'
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      LOOP
        EXECUTE format(
          'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
          _t || '_history',
          _constraint.constraint_name
        );
      END LOOP;
    END;

    -- Add composite index on (id, valid_from, valid_to) for time travel queries
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (id, valid_from, valid_to)',
      _t || '_history_temporal_idx',
      _t || '_history'
    );

    -- Trigger: stamp actor on INSERT/UPDATE (main table)
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_stamp_actor ON %I',
      _t, _t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_stamp_actor BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
      _t, _t
    );

    -- Trigger: capture history on UPDATE/DELETE (main table)
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_capture_history ON %I',
      _t, _t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_capture_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
      _t, _t
    );

    -- Trigger: immutability on history table
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_immutable ON %I',
      _t || '_history', _t || '_history'
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
      _t || '_history', _t || '_history'
    );

    RAISE NOTICE 'Temporal audit trail configured for: %', _t;
  END LOOP;
END;
$$;
