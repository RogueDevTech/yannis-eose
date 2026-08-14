-- ============================================
-- Multi-currency — Phase 5: Single-currency remittance batches
-- ============================================
-- A cash remittance batch is single-currency: it holds only one currency's
-- DELIVERED orders and its totals never mix currencies (GH₵5,000 must never
-- appear as ₦5,000). Add currency_code to delivery_remittances, default 'NGN'
-- so every existing + future single-currency batch is unchanged.
--
-- delivery_remittances uses the generic positional history trigger (see 0260
-- which appended discount/waybill_cost to both tables). Appending currency_code
-- to BOTH delivery_remittances and delivery_remittances_history keeps column
-- order aligned — the positional `INSERT ... SELECT (OLD).*` capture stays valid.

ALTER TABLE delivery_remittances
  ADD COLUMN IF NOT EXISTS currency_code text NOT NULL DEFAULT 'NGN';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'delivery_remittances_history') THEN
    -- History twin: nullable, no default (positional capture of pre-migration rows).
    ALTER TABLE delivery_remittances_history
      ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS delivery_remittances_currency_idx
  ON delivery_remittances (currency_code);
