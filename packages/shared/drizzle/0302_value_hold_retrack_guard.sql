-- Migration 0302: Value-hold retrack guard — stop the "retracked for wrong value
-- but never corrected, then silently re-delivered" leak.
--
-- Problem: Finance retracks a DELIVERED/REMITTED order (status-only) when the
-- remitted cash != the posted order value (e.g. paid 120k, order says 60k). The
-- retrack carries no corrected amount, nothing forces the line-price fix, and the
-- CART_SOURCE_MIRROR re-delivers the order at the stale value — so the books stay
-- wrong. ~42 such orders observed Jul27–Aug7, all caught manually by one accountant.
--
-- Fix (write side): a "value hold" on the order that opens when finance retracks
-- for a value reason and clears ONLY when a line-price correction is actually
-- applied. While open, both manual re-delivery and the cart-mirror re-delivery are
-- hard-blocked (enforced in app code). `value_hold_hint` optionally carries the
-- corrected amount finance typed at retrack time (a hint that pre-fills the CS
-- correction form; it does NOT clear the hold by itself).
--
-- HISTORY TWIN: `orders` captures history via yannis_capture_history_insert_orders()
-- (migration 0016) — an EXPLICIT-column, AFTER INSERT trigger (NOT a positional
-- `SELECT ($1).*`, and NOT fired on UPDATE/DELETE). So adding columns here does NOT
-- risk breaking writes, and hold state (set via UPDATE) is not historized by that
-- trigger regardless. We still add the two columns to `orders_history` below to keep
-- the twin schema-aligned per the "alter a table -> sync its _history table" rule;
-- populating them in history is out of scope (would require editing the 0016 trigger
-- and only matters if hold state ever needs auditing, which it currently does not).

-- 1. orders: value-hold flag + optional corrected-value hint.
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS value_hold_pending boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS value_hold_hint    numeric(12, 2);

-- Partial index: quickly find orders currently on hold (small set) for banners /
-- dashboards without scanning the whole table.
CREATE INDEX IF NOT EXISTS orders_value_hold_pending_idx
  ON orders (id)
  WHERE value_hold_pending = true;

-- 2. Keep the history twin schema-aligned (see header — harmless, not required for
--    write safety since orders' history trigger is explicit-column INSERT-only).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders_history'
  ) THEN
    ALTER TABLE orders_history
      ADD COLUMN IF NOT EXISTS value_hold_pending boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS value_hold_hint    numeric(12, 2);
  END IF;
END $$;
