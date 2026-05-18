-- ============================================
-- Comprehensive Audit Coverage — Gap 1
-- Add temporal audit (history + triggers) for tables that already have
-- temporal columns but were not in the original audit migration list:
-- stock_reconciliations, approval_requests, budgets, settlement_configs
-- ============================================

DO $$
DECLARE
  _tables TEXT[] := ARRAY[
    'stock_reconciliations',
    'approval_requests',
    'budgets',
    'settlement_configs'
  ];
  _t TEXT;
  _constraint RECORD;
  _exists BOOLEAN;
BEGIN
  FOREACH _t IN ARRAY _tables
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _t
    ) INTO _exists;
    IF NOT _exists THEN
      RAISE NOTICE 'Skipping % (table does not exist)', _t;
      CONTINUE;
    END IF;

    -- Create history table as a copy of the main table structure
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL)',
      _t || '_history',
      _t
    );

    -- Drop ALL primary key and unique constraints on history table
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

-- ============================================
-- INSERT capture triggers (generic for stock_reconciliations, settlement_configs)
-- ============================================

DO $$
DECLARE
  _tables TEXT[] := ARRAY['stock_reconciliations', 'settlement_configs'];
  _t TEXT;
BEGIN
  FOREACH _t IN ARRAY _tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _t || '_history'
    ) THEN
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
      RAISE NOTICE 'INSERT audit trigger added for: %', _t;
    END IF;
  END LOOP;
END;
$$;

-- ============================================
-- approval_requests: table-specific INSERT trigger (numeric amount)
-- ============================================

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_approval_requests()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO approval_requests_history (
    id, type, requester_id, amount, description, status,
    approver_id, approval_reason, approved_at, budget_id,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.type, NEW.requester_id, (NEW.amount)::numeric, NEW.description, NEW.status,
    NEW.approver_id, NEW.approval_reason, NEW.approved_at, NEW.budget_id,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_budgets()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO budgets_history (
    id, name, department_or_campaign, total_budget, period_start, period_end, created_by,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.name, NEW.department_or_campaign, (NEW.total_budget)::numeric,
    NEW.period_start, NEW.period_end, NEW.created_by,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Only attach triggers if tables exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'approval_requests') THEN
    DROP TRIGGER IF EXISTS trg_approval_requests_capture_history_insert ON approval_requests;
    CREATE TRIGGER trg_approval_requests_capture_history_insert
      AFTER INSERT ON approval_requests
      FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_approval_requests();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'budgets') THEN
    DROP TRIGGER IF EXISTS trg_budgets_capture_history_insert ON budgets;
    CREATE TRIGGER trg_budgets_capture_history_insert
      AFTER INSERT ON budgets
      FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_budgets();
  END IF;
END;
$$;
