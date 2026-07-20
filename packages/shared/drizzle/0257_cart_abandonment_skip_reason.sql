-- Tag abandoned carts that were skipped during auto-pull with the reason
-- and a reference to the duplicate order so CS can see why recovery was blocked.

ALTER TABLE cart_abandonments
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS duplicate_of_order_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_of_cart_order_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_of_follow_up_order_id uuid,
  ADD COLUMN IF NOT EXISTS skip_tagged_at timestamptz;

-- History table sync
ALTER TABLE cart_abandonments_history
  ADD COLUMN IF NOT EXISTS skip_reason text,
  ADD COLUMN IF NOT EXISTS duplicate_of_order_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_of_cart_order_id uuid,
  ADD COLUMN IF NOT EXISTS duplicate_of_follow_up_order_id uuid,
  ADD COLUMN IF NOT EXISTS skip_tagged_at timestamptz;
