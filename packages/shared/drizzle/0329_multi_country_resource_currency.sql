-- ============================================
-- Multi-country — Phase 0: currency_code on physical resources
-- ============================================
-- Country is NOT tied to a branch. It is a property of the ORDER (currency_code,
-- already on orders/cart_orders since 0318) and of each PHYSICAL resource:
-- a logistics provider, a stock batch, a shipment. Each carries its own
-- currency_code (1 country = 1 currency in this business), set at create time.
--
-- Everything backfills to 'NGN' so single-currency installs behave EXACTLY as
-- today. The feature stays dormant until a company has a 2nd active currency
-- (hasMultipleCurrencies()); these columns are inert until then.
--
-- HISTORY TWINS (trigger-trap rule): every one of these tables has a temporal
-- history twin captured by BOTH a positional UPDATE/DELETE trigger
-- (yannis_capture_history, `SELECT (OLD).*`) and, for stock_batches, an
-- explicit-column INSERT trigger. Rules honoured below:
--   1. ADD COLUMN on BOTH the table and its _history twin, in the same order
--      (appending keeps the positional UPDATE capture aligned).
--   2. History twin column is nullable, no default (a positional capture of any
--      pre-migration row version must never be rejected).
--   3. stock_batches' explicit-column INSERT trigger function is rebuilt to
--      carry currency_code through to history.

-- ── logistics_providers ──────────────────────────────────────
ALTER TABLE logistics_providers
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='logistics_providers_history') THEN
    ALTER TABLE logistics_providers_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

-- ── stock_batches ────────────────────────────────────────────
ALTER TABLE stock_batches
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='stock_batches_history') THEN
    ALTER TABLE stock_batches_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

-- Rebuild the stock_batches explicit-column INSERT capture trigger (0073) so the
-- new currency_code is copied into history on INSERT. Appended last to match the
-- appended table column position.
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_stock_batches()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO stock_batches_history (
    id,
    product_id,
    factory_cost,
    landing_cost,
    total_landed_cost,
    quantity,
    remaining_quantity,
    received_at,
    valid_from,
    valid_to,
    modified_by,
    created_at,
    updated_at,
    currency_code
  ) SELECT
    NEW.id,
    NEW.product_id,
    (NEW.factory_cost)::numeric,
    (NEW.landing_cost)::numeric,
    (NEW.total_landed_cost)::numeric,
    NEW.quantity,
    NEW.remaining_quantity,
    NEW.received_at,
    NEW.valid_from,
    NEW.valid_to,
    NEW.modified_by,
    NEW.created_at,
    NEW.updated_at,
    NEW.currency_code;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── shipments ────────────────────────────────────────────────
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='shipments_history') THEN
    ALTER TABLE shipments_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

-- ── Indexes for country-scoped filtering (Phase 1 threads these into lists) ──
CREATE INDEX IF NOT EXISTS logistics_providers_currency_code_idx ON logistics_providers (currency_code);
CREATE INDEX IF NOT EXISTS stock_batches_currency_code_idx       ON stock_batches (currency_code);
CREATE INDEX IF NOT EXISTS shipments_currency_code_idx           ON shipments (currency_code);

-- Composite index for the per-country FIFO read (Phase 5):
--   WHERE product_id = ? AND currency_code = ? AND remaining_quantity > 0
--   ORDER BY received_at ASC, id ASC
CREATE INDEX IF NOT EXISTS stock_batches_fifo_country_idx
  ON stock_batches (product_id, currency_code, received_at, id)
  WHERE remaining_quantity > 0;

-- Existing rows already default to 'NGN' via the column default; no UPDATE needed.
