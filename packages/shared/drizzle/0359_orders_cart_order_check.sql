-- Migration 0359: orders.cart_order_check — "Already a cart order" (2026-11-04).
--
-- A form order for a customer who already has a cart order used to DELETE that
-- cart order whatever its stage (orders.create supersede step, since 0729
-- bb5d8111), including cart orders CS had confirmed or delivered. CS lost their
-- work and the same customer could be delivered twice (CO-146896 delivered
-- Nov 3, deleted Nov 4 by YNS-147334).
--
-- Now only cart orders nobody has called (UNPROCESSED / CS_ASSIGNED) are
-- removed. When the customer's cart order is further along, the form order is
-- still created (never rejected) and this column holds that cart order's id:
-- the order cannot be CONFIRMED until CS checks with the customer and clears it
-- (orders.clearCartOrderCheck). NULL = no live worked cart order.
--
-- Deliberately NO foreign key: this column is written on the intake path, and an
-- FK that cannot resolve would abort the order insert (the 2026-09 cart_id FK
-- incident destroyed orders). A stale id can only mean a stale warning.
--
-- orders IS system-versioned: orders_history gets the same column (last on both
-- sides), and the NAMED insert capture yannis_capture_history_insert_orders is
-- rebuilt from the catalog so it copies it (same method as 0355).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cart_order_check uuid;

DO $$ BEGIN
  IF to_regclass('public.orders_history') IS NOT NULL THEN
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS cart_order_check uuid;
  END IF;
END $$;

-- Rebuild the named orders insert capture with every orders column that also
-- exists in orders_history (a named list can only miss a value, never reject an
-- order; see 0355).
DO $$
DECLARE
  _cols text;
  _vals text;
BEGIN
  IF to_regclass('public.orders_history') IS NULL THEN
    RETURN;
  END IF;
  SELECT string_agg(quote_ident(l.attname), ', ' ORDER BY l.attnum),
         string_agg('NEW.' || quote_ident(l.attname), ', ' ORDER BY l.attnum)
    INTO _cols, _vals
  FROM pg_attribute l
  WHERE l.attrelid = 'public.orders'::regclass AND l.attnum > 0 AND NOT l.attisdropped
    AND EXISTS (
      SELECT 1 FROM pg_attribute h
      WHERE h.attrelid = 'public.orders_history'::regclass
        AND h.attnum > 0 AND NOT h.attisdropped AND h.attname = l.attname
    );
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION yannis_capture_history_insert_orders() RETURNS trigger AS $f$ BEGIN INSERT INTO orders_history (%s) VALUES (%s); RETURN NEW; END; $f$ LANGUAGE plpgsql',
    _cols, _vals
  );
END $$;

CREATE INDEX IF NOT EXISTS orders_cart_order_check_idx ON orders (cart_order_check) WHERE cart_order_check IS NOT NULL;
