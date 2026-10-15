-- ============================================================================
-- 0355: History table drift repair.
--
-- Measured on a database built from every migration (2026-10-15):
--   1. budgets_history is missing group_id (added to budgets later). The
--      positional capture trigger (SELECT ($1).*) makes every budgets UPDATE or
--      DELETE fail with "INSERT has more expressions than target columns".
--   2. Six hand-written INSERT capture triggers name their columns and were
--      never updated when columns were added, so the first history row of each
--      record silently lacks them:
--        orders 19, payroll_batches 13, ad_spend_logs 4, products 3,
--        budgets 1, shipments 1.
--
-- Fix:
--   - Add group_id to budgets_history (last column on both sides, so the
--     positional copy lines up again).
--   - ad_spend_logs, budgets, payroll_batches, products, shipments: switch the
--     INSERT capture to the generic yannis_capture_history_insert(), the same
--     positional copy their UPDATE/DELETE capture already runs, so it can never
--     miss a column again. Only done when the history table lines up by name
--     and position; otherwise the named trigger is rebuilt (below) instead.
--   - orders: keep a NAMED insert trigger on purpose. It runs on every order
--     intake; a positional copy would turn a forgotten orders_history column
--     into failed order inserts (lost orders). A named list can only miss a
--     value, never reject an order. Rebuilt from the catalog with every orders
--     column that exists in orders_history.
--
-- Enforced from now on by apps/api/src/database/history-drift.integration.spec.ts.
-- ============================================================================

ALTER TABLE budgets_history ADD COLUMN IF NOT EXISTS group_id uuid;

DO $$
DECLARE
  _t text;
  _aligned boolean;
  _cols text;
  _vals text;
  _skipped text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['ad_spend_logs', 'budgets', 'orders', 'payroll_batches', 'products', 'shipments']
  LOOP
    -- Same column names in the same positions on both sides?
    SELECT NOT EXISTS (
      SELECT 1
      FROM (
        SELECT attname, row_number() OVER (ORDER BY attnum) AS pos
        FROM pg_attribute
        WHERE attrelid = format('public.%I', _t)::regclass AND attnum > 0 AND NOT attisdropped
      ) l
      FULL JOIN (
        SELECT attname, row_number() OVER (ORDER BY attnum) AS pos
        FROM pg_attribute
        WHERE attrelid = format('public.%I', _t || '_history')::regclass AND attnum > 0 AND NOT attisdropped
      ) h ON h.pos = l.pos
      WHERE l.attname IS DISTINCT FROM h.attname
    ) INTO _aligned;

    IF _t <> 'orders' AND _aligned THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || _t || '_capture_history_insert', _t);
      EXECUTE format(
        'CREATE TRIGGER %I AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert()',
        'trg_' || _t || '_capture_history_insert', _t
      );
      EXECUTE format('DROP FUNCTION IF EXISTS %I()', 'yannis_capture_history_insert_' || _t);
      CONTINUE;
    END IF;

    -- Named insert: every live column that also exists in the history table.
    SELECT string_agg(quote_ident(l.attname), ', ' ORDER BY l.attnum),
           string_agg('NEW.' || quote_ident(l.attname), ', ' ORDER BY l.attnum)
      INTO _cols, _vals
    FROM pg_attribute l
    WHERE l.attrelid = format('public.%I', _t)::regclass AND l.attnum > 0 AND NOT l.attisdropped
      AND EXISTS (
        SELECT 1 FROM pg_attribute h
        WHERE h.attrelid = format('public.%I', _t || '_history')::regclass
          AND h.attnum > 0 AND NOT h.attisdropped AND h.attname = l.attname
      );

    SELECT string_agg(l.attname, ', ' ORDER BY l.attnum) INTO _skipped
    FROM pg_attribute l
    WHERE l.attrelid = format('public.%I', _t)::regclass AND l.attnum > 0 AND NOT l.attisdropped
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute h
        WHERE h.attrelid = format('public.%I', _t || '_history')::regclass
          AND h.attnum > 0 AND NOT h.attisdropped AND h.attname = l.attname
      );
    IF _skipped IS NOT NULL THEN
      RAISE WARNING '0355: %_history has no column(s) %, insert capture skips them', _t, _skipped;
    END IF;

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION %I() RETURNS trigger AS $f$ BEGIN INSERT INTO %I (%s) VALUES (%s); RETURN NEW; END; $f$ LANGUAGE plpgsql',
      'yannis_capture_history_insert_' || _t, _t || '_history', _cols, _vals
    );
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || _t || '_capture_history_insert', _t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
      'trg_' || _t || '_capture_history_insert', _t, 'yannis_capture_history_insert_' || _t
    );
  END LOOP;
END $$;
