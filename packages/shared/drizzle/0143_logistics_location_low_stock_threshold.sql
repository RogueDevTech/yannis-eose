-- Per-location low-stock alert threshold.
--
-- Until now the low-stock alert used a single org-wide threshold
-- (`system_settings.INVENTORY_LOW_STOCK_CONFIG.threshold`). Ops wants to set a
-- threshold per location too — e.g. a high-throughput 3PL should alert earlier
-- than the global default. This column is the per-location override; NULL means
-- "fall back to the global threshold". Effective threshold for any
-- (product, location) = COALESCE(logistics_locations.low_stock_threshold, global).
--
-- History table synced in the same migration (temporal audit — Pillar 4).

ALTER TABLE "logistics_locations"
  ADD COLUMN IF NOT EXISTS "low_stock_threshold" integer;

ALTER TABLE "logistics_locations_history"
  ADD COLUMN IF NOT EXISTS "low_stock_threshold" integer;
