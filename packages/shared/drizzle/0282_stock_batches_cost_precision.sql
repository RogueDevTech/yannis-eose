-- 0277: widen stock_batches cost columns from numeric(12,2) to numeric(14,4).
--
-- Landed cost per unit is derived as (allocated line landing / received qty).
-- Stored at 2dp, a 3-unit line with ₦100 landing keeps 33.33/unit: FIFO can
-- only ever recover 99.99 while the GL capitalised the exact 100.00, leaving
-- a permanent Stock-In-Hand vs batch-valuation residue on almost every line.
-- 4dp shrinks the residue 100x (to fractions of a kobo). Existing values are
-- preserved exactly (widening precision/scale never truncates).
--
-- History table synced in the same migration (yannis_capture_history does
-- `SELECT ($1).*` — a column-type mismatch would break every UPDATE).

ALTER TABLE stock_batches
  ALTER COLUMN factory_cost      TYPE numeric(14,4),
  ALTER COLUMN landing_cost      TYPE numeric(14,4),
  ALTER COLUMN total_landed_cost TYPE numeric(14,4);

ALTER TABLE stock_batches_history
  ALTER COLUMN factory_cost      TYPE numeric(14,4),
  ALTER COLUMN landing_cost      TYPE numeric(14,4),
  ALTER COLUMN total_landed_cost TYPE numeric(14,4);
