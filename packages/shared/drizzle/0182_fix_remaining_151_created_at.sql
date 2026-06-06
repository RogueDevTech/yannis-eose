-- Fix remaining 151 orders still with June 4th created_at.
-- Use the EARLIEST history row (original creation) since the timestamp
-- boundary approach missed these.

UPDATE orders o
SET created_at = sub.h_created_at
FROM (
  SELECT DISTINCT ON (i.order_id)
    i.order_id,
    oh.created_at AS h_created_at
  FROM follow_up_batch_items i
  INNER JOIN follow_up_batches b ON b.id = i.batch_id
  INNER JOIN orders_history oh ON oh.id = i.order_id
  WHERE b.status = 'REVERTED'
  ORDER BY i.order_id, oh.valid_from ASC
) sub
WHERE o.id = sub.order_id
  AND o.created_at >= '2026-06-04T00:00:00+01:00';
