-- ============================================
-- Multi-currency — Phase 2: Per-currency offer prices
-- ============================================
-- Offers price in two parallel systems, each with a single `price` numeric that
-- is the DEFAULT-currency (NGN) price:
--   offer_templates.price      (single-SKU tiers)
--   offer_group_items.price    (multi-item offer groups)
--
-- We add sibling tables holding the price for ADDITIONAL currencies. The base
-- (NGN) price stays on the original `.price` column untouched, so every existing
-- read path is byte-for-byte unchanged when only NGN exists. A currency with NO
-- row here (or price <= 0) is "not priced" → hidden on forms (guarded in the
-- read layer, not here).
--
-- offer_group_items are FULL-REPLACED on every group update (delete + reinsert,
-- new ids), so these price rows CASCADE on delete and are rebuilt each update.
-- No history/temporal: this is derived pricing config, not a financial record
-- (mirrors offer_group_items itself, which is not history-backed).

CREATE TABLE IF NOT EXISTS offer_template_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_template_id uuid NOT NULL REFERENCES offer_templates(id) ON DELETE CASCADE,
  currency_code text NOT NULL,
  price numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS offer_template_prices_uniq
  ON offer_template_prices (offer_template_id, currency_code);
CREATE INDEX IF NOT EXISTS offer_template_prices_tpl_idx
  ON offer_template_prices (offer_template_id);

CREATE TABLE IF NOT EXISTS offer_group_item_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_group_item_id uuid NOT NULL REFERENCES offer_group_items(id) ON DELETE CASCADE,
  currency_code text NOT NULL,
  price numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS offer_group_item_prices_uniq
  ON offer_group_item_prices (offer_group_item_id, currency_code);
CREATE INDEX IF NOT EXISTS offer_group_item_prices_item_idx
  ON offer_group_item_prices (offer_group_item_id);

-- NOTE: We intentionally do NOT backfill an 'NGN' row for every existing offer.
-- The NGN price already lives on offer_templates.price / offer_group_items.price
-- and the read layer treats that column AS the default-currency price. These
-- sibling tables hold ONLY non-default currency prices. Keeping NGN out of them
-- avoids a dual source of truth for the base price.
