-- Migration 0353: orders.capture_source — how an order was captured (2026-10-07).
--
-- NULL                = the customer submitted it (or it was created by staff).
-- 'UNSUBMITTED_FORM'  = owner decision 2026-10-07: a properly filled public form
--                       (all required fields + an offer) whose customer never
--                       pressed submit. ~30 min after they went quiet the cart is
--                       created as a normal order. INTERNAL ONLY: never shown as a
--                       badge (a "from cart" tag devalues the order with CS); kept
--                       so these orders can be counted and audited.
--
-- orders IS system-versioned: orders_history gets the same column.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS capture_source text;
CREATE INDEX IF NOT EXISTS orders_capture_source_idx ON orders (capture_source) WHERE capture_source IS NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders_history'
  ) THEN
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS capture_source text;
  END IF;
END $$;
