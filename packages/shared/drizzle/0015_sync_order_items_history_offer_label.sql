-- Migration: sync order_items_history with order_items
-- order_items.offer_label was added but never synced to order_items_history,
-- causing the yannis_capture_history_insert trigger to fail with
-- "INSERT has more expressions than target columns".

ALTER TABLE order_items_history
  ADD COLUMN IF NOT EXISTS offer_label text;
