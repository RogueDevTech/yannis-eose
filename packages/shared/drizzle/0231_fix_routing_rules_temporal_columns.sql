-- 0231: Add missing temporal columns to cart_order_routing_rules.
--
-- Migration 0207 created the table without valid_from/valid_to/modified_by
-- even though the Drizzle schema includes ...temporalColumns. Every Drizzle
-- SELECT from this table failed with "column valid_from does not exist",
-- which silently broke the cart pull cron (resolveRoutingBranch).

ALTER TABLE cart_order_routing_rules ADD COLUMN IF NOT EXISTS valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE cart_order_routing_rules ADD COLUMN IF NOT EXISTS valid_to TIMESTAMPTZ;
ALTER TABLE cart_order_routing_rules ADD COLUMN IF NOT EXISTS modified_by TEXT;
