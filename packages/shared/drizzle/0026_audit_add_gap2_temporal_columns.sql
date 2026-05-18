-- ============================================
-- Comprehensive Audit Coverage — Gap 2
-- Add temporal columns + history + triggers for tables that did not have
-- temporal columns. Only runs for tables that exist.
-- ============================================

DO $$
DECLARE
  _tables TEXT[] := ARRAY[
    'marketing_funding_requests',
    'ad_spend_logs',
    'call_logs',
    'order_transfer_requests',
    'stock_movements',
    'email_change_requests',
    'user_product_assignments'
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

    -- Add temporal columns
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS valid_from timestamptz NOT NULL DEFAULT now()', _t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS valid_to timestamptz', _t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS modified_by text', _t);

    -- Create history table
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

    RAISE NOTICE 'Temporal audit configured for: %', _t;
  END LOOP;
END;
$$;

-- Generic INSERT triggers for tables without numeric type issues
DO $$
DECLARE
  _tables TEXT[] := ARRAY['call_logs', 'order_transfer_requests', 'stock_movements', 'email_change_requests', 'user_product_assignments'];
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

-- marketing_funding_requests: table-specific INSERT (numeric amount)
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_marketing_funding_requests()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO marketing_funding_requests_history (
    id, requester_id, amount, reason, status, receipt_url,
    created_at, resolved_at, resolved_by,
    valid_from, valid_to, modified_by
  ) SELECT
    NEW.id, NEW.requester_id, (NEW.amount)::numeric, NEW.reason, NEW.status, NEW.receipt_url,
    NEW.created_at, NEW.resolved_at, NEW.resolved_by,
    NEW.valid_from, NEW.valid_to, NEW.modified_by;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_funding_requests_capture_history_insert ON marketing_funding_requests;
CREATE TRIGGER trg_marketing_funding_requests_capture_history_insert
  AFTER INSERT ON marketing_funding_requests
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_marketing_funding_requests();

-- ad_spend_logs: table-specific INSERT (numeric spend_amount)
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_ad_spend_logs()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ad_spend_logs_history (
    id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date,
    status, approved_at, approved_by, created_at,
    valid_from, valid_to, modified_by
  ) SELECT
    NEW.id, NEW.media_buyer_id, NEW.product_id, NEW.campaign_id, (NEW.spend_amount)::numeric,
    NEW.screenshot_url, NEW.spend_date,
    NEW.status, NEW.approved_at, NEW.approved_by, NEW.created_at,
    NEW.valid_from, NEW.valid_to, NEW.modified_by;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'marketing_funding_requests') THEN
    DROP TRIGGER IF EXISTS trg_marketing_funding_requests_capture_history_insert ON marketing_funding_requests;
    CREATE TRIGGER trg_marketing_funding_requests_capture_history_insert
      AFTER INSERT ON marketing_funding_requests
      FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_marketing_funding_requests();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ad_spend_logs') THEN
    DROP TRIGGER IF EXISTS trg_ad_spend_logs_capture_history_insert ON ad_spend_logs;
    CREATE TRIGGER trg_ad_spend_logs_capture_history_insert
      AFTER INSERT ON ad_spend_logs
      FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_ad_spend_logs();
  END IF;
END;
$$;
