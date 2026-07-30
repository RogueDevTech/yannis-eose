-- 0276: inventory_levels — exactly one row per (product_id, location_id).
--
-- Pre-0276 the level lookups were mutually inconsistent: intake stamped
-- batch_id on first insert, the fast-path transfer destination filtered
-- batch_id IS NULL, and approve/verify transfer used no batch filter. A
-- transfer into an intake-created location therefore inserted a SECOND row
-- for the same (product, location), and every LIMIT 1 availability read
-- (transfers, adjust, low-stock) saw an arbitrary fraction of the real
-- stock. This migration merges the split rows, drops the vestigial batch_id
-- stamps (batch tracking lives in stock_batches), and adds the unique index
-- the new ON CONFLICT upserts in code rely on.

-- 1) Merge duplicates into the oldest row per (product_id, location_id).
--    UUIDv7 ids are time-ordered, so MIN(id) is the original row.
WITH keepers AS (
  SELECT MIN(id::text)::uuid AS keep_id, product_id, location_id
  FROM inventory_levels
  GROUP BY product_id, location_id
  HAVING COUNT(*) > 1
),
extras AS (
  SELECT k.keep_id,
         SUM(il.stock_count) AS extra_stock,
         SUM(il.reserved_count) AS extra_reserved
  FROM inventory_levels il
  JOIN keepers k
    ON il.product_id = k.product_id
   AND il.location_id = k.location_id
   AND il.id <> k.keep_id
  GROUP BY k.keep_id
)
UPDATE inventory_levels il
SET stock_count = il.stock_count + e.extra_stock,
    reserved_count = il.reserved_count + e.extra_reserved,
    updated_at = NOW()
FROM extras e
WHERE il.id = e.keep_id;

-- 2) Delete the merged-away duplicate rows (history trigger records them).
DELETE FROM inventory_levels il
USING (
  SELECT MIN(id::text)::uuid AS keep_id, product_id, location_id
  FROM inventory_levels
  GROUP BY product_id, location_id
  HAVING COUNT(*) > 1
) k
WHERE il.product_id = k.product_id
  AND il.location_id = k.location_id
  AND il.id <> k.keep_id;

-- 3) Levels are per-location totals; batch_id on a level row was never read
--    consistently and caused the split. Null it everywhere.
UPDATE inventory_levels
SET batch_id = NULL, updated_at = NOW()
WHERE batch_id IS NOT NULL;

-- 4) Enforce uniqueness so concurrent first-time credits upsert atomically
--    instead of racing select-then-insert into duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_levels_product_location_uniq
  ON inventory_levels (product_id, location_id);
