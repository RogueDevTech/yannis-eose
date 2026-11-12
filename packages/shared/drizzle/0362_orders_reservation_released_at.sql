-- Migration 0362: orders.reservation_released_at — reserved stock release (2026-11-12).
--
-- Stock is reserved when an order is allocated to a logistics location and
-- released when it is delivered, returned or retracked. Prod had 412 orders
-- sitting in AGENT_ASSIGNED for weeks (195 over 90 days), keeping their stock
-- reserved so CS could not allocate new orders against it.
--
-- Owner rule: once an order has held its reservation for N days (per-company
-- setting STOCK_RESERVATION_RELEASE_CONFIG, default 30), the reservation is
-- released automatically; authorised users can release one early. The order
-- keeps its status. This column records WHEN the reservation was released so
-- no later step (delivery, return, retrack, reallocation, item edit) releases
-- it a second time, which would take units reserved by other live orders.
-- NULL = the order still holds its reservation (or never had one). Cleared
-- again when the order is re-reserved (reallocation, retrack back into transit).
--
-- orders IS system-versioned: orders_history gets the same column (last on both
-- sides), and the NAMED insert capture yannis_capture_history_insert_orders is
-- rebuilt from the catalog so it copies it (same method as 0355 / 0359).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS reservation_released_at timestamptz;

DO $$ BEGIN
  IF to_regclass('public.orders_history') IS NOT NULL THEN
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS reservation_released_at timestamptz;
  END IF;
END $$;

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

-- Order activity entry for each release (automatic or manual).
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'STOCK_RESERVATION_RELEASED';
