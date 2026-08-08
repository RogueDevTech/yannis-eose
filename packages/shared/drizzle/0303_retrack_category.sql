-- Migration 0303: Retrack categories.
--
-- Finance now picks a REQUIRED category when directly retracking an order (instead
-- of a free-text reason only). The category drives a color-coded banner shown to
-- closers on the order detail, notifies the assigned closer + Head of CS, and opens
-- the retrack hold (generalized from the value hold in 0302) that blocks
-- re-delivery/re-remittance until CS/HoCS explicitly RESOLVES it.
--
-- Behaviour change vs 0302: the hold no longer auto-clears when a price edit is
-- applied. It clears ONLY via the explicit "Resolve retrack" action. This applies
-- to EVERY category (price, quantity, agent, duplicate, not-delivered).
--
-- HISTORY TWIN: orders' history trigger (yannis_capture_history_insert_orders, mig
-- 0016) is explicit-column, AFTER INSERT-only — adding a column does NOT break
-- writes. We still add retrack_category to orders_history to keep the twin
-- schema-aligned per the "alter a table -> sync its _history table" rule.

-- 1. retrack_category enum type.
DO $$ BEGIN
  CREATE TYPE retrack_category AS ENUM (
    'wrong_remittance_price',
    'understated_overstated_price',
    'wrong_quantity',
    'wrong_delivery_agent',
    'duplicate_delivery',
    'not_delivered_moved_by_cs'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. orders.retrack_category — the category of the CURRENT open retrack hold.
--    Null when no retrack hold is open (or after Resolve retrack clears it).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS retrack_category retrack_category;

-- 3. Keep the history twin schema-aligned (harmless; see header).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'orders_history'
  ) THEN
    ALTER TABLE orders_history
      ADD COLUMN IF NOT EXISTS retrack_category retrack_category;
  END IF;
END $$;

-- 4. Timeline event for the explicit "Resolve retrack" action.
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'ORDER_RETRACK_RESOLVED';
