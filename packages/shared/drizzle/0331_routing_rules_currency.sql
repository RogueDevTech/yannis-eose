-- ============================================
-- Multi-country — Phase 2: country dimension on CS order routing
-- ============================================
-- Routing rules gain an optional currency_code so an order's COUNTRY (its
-- currency) can steer it to a servicing branch, e.g. "Ghana (GHS) orders →
-- Ghana branch". NULL = any-country catch-all (applied after country-specific
-- rules). Order country = orders.currency_code.
--
-- Resolution precedence in resolveServicingBranchForProduct (Phase 2):
--   (country + product) → (country, product NULL) → (product, country NULL)
--   → (both NULL catch-all) → existing default branch.
-- Routing NEVER blocks cross-currency: any country may point at any branch
-- (org's choice). Fulfillment coherence is enforced later at agent-assign/FIFO.
--
-- HISTORY TWIN: cs_order_routing_rules uses POSITIONAL capture for BOTH INSERT
-- (`INSERT ... SELECT NEW.*`) and UPDATE/DELETE (`SELECT (OLD).*`). Column order
-- must match the twin, so append on BOTH in the same order. No trigger-function
-- rebuild needed (positional, not explicit-column).

ALTER TABLE cs_order_routing_rules
  ADD COLUMN IF NOT EXISTS currency_code text;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='cs_order_routing_rules_history') THEN
    ALTER TABLE cs_order_routing_rules_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $$;

-- Existing rules stay country-agnostic (currency_code NULL = any country), so
-- current routing behaviour is unchanged until an admin adds country rules.
CREATE INDEX IF NOT EXISTS cs_order_routing_rules_currency_idx
  ON cs_order_routing_rules (currency_code);
