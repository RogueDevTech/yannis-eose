-- 0246: Add offline_order_category to orders.
-- Categorises offline orders: 'website_order' or 'referrals'. NULL for non-offline.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS offline_order_category text;

-- Keep orders_history in sync (temporal audit trigger copies full row).
ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS offline_order_category text;
