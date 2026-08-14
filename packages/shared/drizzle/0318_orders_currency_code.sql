-- ============================================
-- Multi-currency — Phase 4: Frozen currency_code on orders + cart_orders
-- ============================================
-- Every order permanently stores the currency it was placed in. Amounts
-- (total_amount, delivery_fee, order_items.unit_price) are already frozen
-- numerics — they are now understood to be IN this currency. Default 'NGN' so
-- every existing + future single-currency order is unchanged.
--
-- HISTORY TWINS:
--   orders_history: orders uses the EXPLICIT-COLUMN, AFTER-INSERT-only trigger
--     (yannis_capture_history_insert_orders, mig 0016). Adding a column does NOT
--     break writes; we still add currency_code to keep the twin schema-aligned.
--     (If the UPDATE-capture trigger for orders is also explicit-column, it must
--     be rebuilt separately — but per 0303's note orders' capture is INSERT-only
--     explicit-column, so appending the column suffices.)
--   cart_orders_history: cart_orders uses the GENERIC POSITIONAL trigger
--     (yannis_capture_history, `INSERT ... SELECT (OLD).*`). Column ORDER must
--     match exactly. ALTER ... ADD COLUMN appends on BOTH tables → order stays
--     aligned. (This is the trigger-trap rule; appending on both is safe.)

-- orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='orders_history') THEN
    -- History twin: nullable, no default (a positional/explicit capture of any
    -- pre-migration row version must never be rejected).
    ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

-- cart_orders (parallel table — generic positional history trigger)
ALTER TABLE cart_orders
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='cart_orders_history') THEN
    ALTER TABLE cart_orders_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

-- Filter/group scans by currency on order lists + stat strips.
CREATE INDEX IF NOT EXISTS orders_currency_code_idx ON orders (currency_code);
CREATE INDEX IF NOT EXISTS cart_orders_currency_code_idx ON cart_orders (currency_code);
