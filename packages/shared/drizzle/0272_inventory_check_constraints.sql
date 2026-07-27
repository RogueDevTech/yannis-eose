-- Add CHECK constraints to prevent negative stock_count and reserved_count
-- These serve as a DB-level safety net against race conditions in application code.

ALTER TABLE inventory_levels
  ADD CONSTRAINT inventory_levels_stock_count_non_negative
    CHECK (stock_count >= 0);

ALTER TABLE inventory_levels
  ADD CONSTRAINT inventory_levels_reserved_count_non_negative
    CHECK (reserved_count >= 0);
