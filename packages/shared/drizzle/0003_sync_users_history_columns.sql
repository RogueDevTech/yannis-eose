-- ============================================
-- Create core *_history tables and audit functions if they don't exist.
-- On dev/prod these were created manually; on a fresh CI database they
-- need to be created here before any later migration references them.
-- ============================================

-- 0000 created stock_movements + call_logs without temporal columns; stamp_actor + the
-- temporal index below require valid_from/valid_to/modified_by (same as other audited tables).
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "modified_by" text;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "valid_from" timestamptz DEFAULT now() NOT NULL;
ALTER TABLE "stock_movements" ADD COLUMN IF NOT EXISTS "valid_to" timestamptz;

ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "modified_by" text;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "valid_from" timestamptz DEFAULT now() NOT NULL;
ALTER TABLE "call_logs" ADD COLUMN IF NOT EXISTS "valid_to" timestamptz;

-- ad_spend_logs: same gap as above (0000 has no temporal / modified_by columns).
ALTER TABLE "ad_spend_logs" ADD COLUMN IF NOT EXISTS "modified_by" text;
ALTER TABLE "ad_spend_logs" ADD COLUMN IF NOT EXISTS "valid_from" timestamptz DEFAULT now() NOT NULL;
ALTER TABLE "ad_spend_logs" ADD COLUMN IF NOT EXISTS "valid_to" timestamptz;

-- Core audit functions (idempotent — CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION yannis_stamp_actor()
RETURNS TRIGGER AS $$
BEGIN
  NEW.modified_by := current_setting('yannis.current_user_id', true);
  IF NEW.valid_from IS NULL THEN
    NEW.valid_from := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE FUNCTION yannis_history_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'History table % is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Create history tables for all core tables from migration 0000
DO $$
DECLARE
  _tables TEXT[] := ARRAY[
    'users',
    'products',
    'logistics_locations',
    'logistics_providers',
    'inventory_levels',
    'stock_batches',
    'stock_movements',
    'stock_transfers',
    'ad_spend_logs',
    'campaigns',
    'marketing_funding',
    'offer_templates',
    'call_logs',
    'order_items',
    'orders',
    'invoices',
    'commission_plans',
    'earnings_adjustments',
    'payout_records'
  ];
  _t TEXT;
  _constraint RECORD;
BEGIN
  FOREACH _t IN ARRAY _tables
  LOOP
    -- Only create if the main table exists (safety guard)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = _t
    ) THEN
      RAISE NOTICE 'Skipping % (main table does not exist)', _t;
      CONTINUE;
    END IF;

    -- Create history table as a copy of the main table structure
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I (LIKE %I INCLUDING ALL)',
      _t || '_history', _t
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
        _t || '_history', _constraint.constraint_name
      );
    END LOOP;

    -- Temporal index (only if LIKE copy included valid_from/valid_to — 0000 is not uniform)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = _t || '_history' AND c.column_name = 'valid_from'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = _t || '_history' AND c.column_name = 'valid_to'
    ) THEN
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I (id, valid_from, valid_to)',
        _t || '_history_temporal_idx', _t || '_history'
      );
    ELSE
      RAISE NOTICE 'Skipping temporal index for % (history copy lacks valid_from/valid_to)', _t;
    END IF;

    -- stamp_actor trigger on main table
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_stamp_actor ON %I', _t, _t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_stamp_actor
       BEFORE INSERT OR UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor()',
      _t, _t
    );

    -- capture_history trigger on main table
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_capture_history ON %I', _t, _t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_capture_history
       BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION yannis_capture_history()',
      _t, _t
    );

    -- immutability trigger on history table
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_immutable ON %I',
      _t || '_history', _t || '_history'
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_immutable
       BEFORE UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable()',
      _t || '_history', _t || '_history'
    );

    RAISE NOTICE 'Temporal audit configured for: %', _t;
  END LOOP;
END;
$$;

-- ============================================
-- Sync users_history: add last_action_at column added in migration 0002
-- ============================================
ALTER TABLE "users_history" ADD COLUMN IF NOT EXISTS "last_action_at" timestamp with time zone;
