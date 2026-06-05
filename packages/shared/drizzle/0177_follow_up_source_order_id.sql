-- Add follow_up_source_order_id to orders: links a follow-up copy back to
-- the original order it was created from. NULL for normal orders.
-- This replaces the old approach of mutating the original order.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS follow_up_source_order_id uuid REFERENCES orders(id);

CREATE INDEX IF NOT EXISTS idx_orders_follow_up_source
  ON orders(follow_up_source_order_id)
  WHERE follow_up_source_order_id IS NOT NULL;

-- Sync orders_history
ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS follow_up_source_order_id uuid;
