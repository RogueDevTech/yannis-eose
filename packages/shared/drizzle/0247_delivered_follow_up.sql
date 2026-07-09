-- 0247: Add is_delivered_follow_up to orders.
-- When true, the order belongs to the Delivered Follow-Up pipeline —
-- orders created by CS for customers who were previously delivered to.
-- orderSource = 'delivered_follow_up'. Isolated from Offline/Follow-Up pages.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_delivered_follow_up boolean NOT NULL DEFAULT false;

ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS is_delivered_follow_up boolean NOT NULL DEFAULT false;
