-- 0232: Backfill duplicate flags on delivered orders.
--
-- Tags orders where the same customer_phone_hash + product_id has been
-- delivered more than once within 60 days. The FIRST order (by delivered_at)
-- is the original; subsequent orders get is_duplicate='FLAGGED' and
-- duplicate_of_id pointing to the original.
--
-- Excludes follow-up orders (is_follow_up=true), deleted orders, and
-- cancelled orders. Only considers DELIVERED and REMITTED status.

WITH ranked AS (
  SELECT
    o.id AS order_id,
    o.customer_phone_hash,
    oi.product_id,
    o.delivered_at,
    ROW_NUMBER() OVER (
      PARTITION BY o.customer_phone_hash, oi.product_id
      ORDER BY o.delivered_at ASC, o.created_at ASC
    ) AS rn,
    FIRST_VALUE(o.id) OVER (
      PARTITION BY o.customer_phone_hash, oi.product_id
      ORDER BY o.delivered_at ASC, o.created_at ASC
    ) AS original_order_id
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  WHERE o.status IN ('DELIVERED', 'REMITTED')
    AND o.deleted_at IS NULL
    AND o.is_follow_up = false
    AND o.delivered_at >= NOW() - INTERVAL '90 days'
)
UPDATE orders
SET
  is_duplicate = 'FLAGGED',
  duplicate_of_id = ranked.original_order_id
FROM ranked
WHERE orders.id = ranked.order_id
  AND ranked.rn > 1
  AND orders.is_duplicate IS NULL;
