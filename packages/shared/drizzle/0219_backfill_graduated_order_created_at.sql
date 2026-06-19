-- Backfill created_at on graduated orders so they reflect the original order date,
-- not the graduation (delivery) date.  CEO directive 2026-06-19.

-- 1) Follow-up graduated orders: set created_at = source order's created_at
UPDATE orders o
SET    created_at = src.created_at
FROM   orders src
WHERE  o.is_follow_up = true
  AND  o.follow_up_source_order_id IS NOT NULL
  AND  src.id = o.follow_up_source_order_id
  AND  o.created_at <> src.created_at;

-- 2) Cart-graduated orders: set created_at = cart_orders.created_at
--    Link: orders.id ← cart_abandonments.converted_order_id,
--          cart_abandonments.id ← cart_orders.source_cart_id
UPDATE orders o
SET    created_at = co.created_at
FROM   cart_abandonments ca
JOIN   cart_orders co ON co.source_cart_id = ca.id
WHERE  ca.converted_order_id = o.id
  AND  o.created_at <> co.created_at;
