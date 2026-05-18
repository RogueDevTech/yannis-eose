-- Partial index for FIFO walks: remaining_quantity > 0, ORDER BY received_at, id.
-- Migration runner wraps each file in a transaction — do not use CONCURRENTLY here.
CREATE INDEX IF NOT EXISTS stock_batches_fifo_active_idx
  ON stock_batches (product_id, received_at ASC, id ASC)
  WHERE remaining_quantity > 0;
