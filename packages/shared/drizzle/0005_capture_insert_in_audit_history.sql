-- ============================================
-- Capture INSERT events in audit history
-- Ensures new records (categories, users, etc.)
-- appear in the audit log immediately.
-- ============================================

CREATE OR REPLACE FUNCTION yannis_capture_history_insert()
RETURNS TRIGGER AS $$
DECLARE
  _history_table TEXT;
BEGIN
  _history_table := TG_TABLE_NAME || '_history';
  EXECUTE format(
    'INSERT INTO %I SELECT ($1).*',
    _history_table
  ) USING NEW;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  _tables TEXT[] := ARRAY[
    'users',
    'products',
    'product_categories',
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
