-- order_items indexes for orders.list product filter (2026-05).
--
-- orders.list supports filtering by productId using an EXISTS subquery on order_items:
--   WHERE EXISTS (SELECT 1 FROM order_items WHERE order_id = orders.id AND product_id = $productId)
--
-- This index supports that access pattern.

CREATE INDEX IF NOT EXISTS idx_order_items_product_id_order_id
  ON order_items (product_id, order_id);

