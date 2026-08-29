-- 0337: Country/currency-scoped routing for CART and FOLLOW-UP orders.
--
-- Regular orders already route by country (cs_order_routing_rules.currency_code,
-- mig 0331) — a currency-specific rule wins over the NULL catch-all. Cart orders
-- and follow-up orders used their OWN routing tables which had no currency
-- dimension, so they could not be directed per-country. This adds the same
-- currency_code column + matching precedence to both.
--
--   cart_order_routing_rules.currency_code  — NULL = any country; else routes
--     only carts whose currency matches. Specific beats the NULL catch-all.
--   follow_up_rules.currency_code           — same, for follow-up sync.
--
-- Mirrors 0242 (team_id) for the history-twin sync. See MEMORY
-- feedback_history_table_trigger_trap: a column mismatch between a table and its
-- _history twin makes ALL updates fail, so we sync both twins in the SAME migration.

ALTER TABLE cart_order_routing_rules ADD COLUMN IF NOT EXISTS currency_code text;
ALTER TABLE follow_up_rules ADD COLUMN IF NOT EXISTS currency_code text;

-- Non-unique indexes for the country filter (mirrors cs_order_routing_rules_currency_idx).
CREATE INDEX IF NOT EXISTS cart_order_routing_rules_currency_idx
  ON cart_order_routing_rules (currency_code);
CREATE INDEX IF NOT EXISTS follow_up_rules_currency_idx
  ON follow_up_rules (currency_code);

-- Sync history twins (temporal audit) so UPDATEs on the base tables don't fail.
DO $sync$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cart_order_routing_rules_history') THEN
    ALTER TABLE cart_order_routing_rules_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'follow_up_rules_history') THEN
    ALTER TABLE follow_up_rules_history ADD COLUMN IF NOT EXISTS currency_code text;
  END IF;
END $sync$;

-- Re-scope the seeded "All carts → Lagos" default to NGN only, so NGN carts keep
-- their Lagos default while other currencies (e.g. TZS) can be routed to their own
-- CS branch via new rules. The aggressive per-boot backfill that force-moved EVERY
-- cart to Lagos is removed in application code (cart-orders.service seedDefaultRoutingRule);
-- here we just narrow the standing rule's scope. Only touch the known seed rule id.
UPDATE cart_order_routing_rules
  SET currency_code = 'NGN',
      name = 'NGN carts → Lagos'
  WHERE id = 'a0000000-0000-0000-0000-000000000001'
    AND currency_code IS NULL;
