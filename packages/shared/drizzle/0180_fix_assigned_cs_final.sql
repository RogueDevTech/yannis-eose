-- Fix assigned_cs_id: 0179 restored created_at correctly but DISTINCT ON
-- picked a history row with NULL assigned_cs_id when multiple rows shared
-- the same valid_from. This migration specifically restores assigned_cs_id
-- from the most recent history row that HAS an assigned closer.

UPDATE orders o
SET assigned_cs_id = sub.h_assigned
FROM (
  SELECT DISTINCT ON (i.order_id)
    i.order_id,
    oh.assigned_cs_id AS h_assigned
  FROM follow_up_batch_items i
  INNER JOIN follow_up_batches b ON b.id = i.batch_id
  INNER JOIN orders_history oh ON oh.id = i.order_id
    AND oh.valid_from < '2026-06-04T14:17:00Z'
    AND oh.assigned_cs_id IS NOT NULL
  WHERE b.status = 'REVERTED'
  ORDER BY i.order_id, oh.valid_from DESC
) sub
WHERE o.id = sub.order_id
  AND o.assigned_cs_id IS NULL;
