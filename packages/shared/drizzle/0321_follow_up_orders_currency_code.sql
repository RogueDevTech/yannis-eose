-- ============================================
-- Multi-currency — follow_up_orders currency
-- ============================================
-- follow_up_orders is a SEPARATE pipeline table (not `orders`). Migration 0318
-- added currency_code to orders + cart_orders but not this table, so follow-up
-- orders had no currency and always displayed NGN. Add it here (default 'NGN')
-- and carry it onto the graduated `orders` copy in graduateToOrders().
--
-- History twin: follow_up_orders_history may or may not exist (created lazily by
-- the generic history bootstrap in some envs). Append currency_code to it ONLY
-- when present, nullable (positional/explicit capture of pre-migration rows must
-- never reject). ALTER ... ADD COLUMN appends on both, keeping column order
-- aligned for any generic positional capture trigger.

ALTER TABLE follow_up_orders
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'follow_up_orders_history') THEN
    ALTER TABLE follow_up_orders_history
      ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS follow_up_orders_currency_idx
  ON follow_up_orders (currency_code);
