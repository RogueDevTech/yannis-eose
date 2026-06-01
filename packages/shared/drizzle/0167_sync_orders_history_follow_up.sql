-- 0165 added is_follow_up to orders but missed orders_history.
-- The column mismatch caused the generic yannis_capture_history_insert trigger
-- to fail with "INSERT has more expressions than target columns" on any orders UPDATE.
ALTER TABLE orders_history ADD COLUMN IF NOT EXISTS is_follow_up boolean;
