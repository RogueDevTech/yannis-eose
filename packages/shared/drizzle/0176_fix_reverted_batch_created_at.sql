-- Fix: Restore created_at for orders from reverted follow-up batches.
-- reopenForFollowUp set created_at = NOW() on all batch orders, making
-- old orders appear as if they were created on June 4th.
--
-- Restore created_at from orders_history — the row where is_follow_up
-- IS DISTINCT FROM true has the original created_at.

UPDATE orders o
SET created_at = sub.original_created_at
FROM (
  SELECT DISTINCT ON (fbi.order_id)
    fbi.order_id,
    oh.created_at AS original_created_at
  FROM follow_up_batch_items fbi
  INNER JOIN follow_up_batches fb ON fb.id = fbi.batch_id
  INNER JOIN orders_history oh ON oh.id = fbi.order_id
    AND oh.is_follow_up IS DISTINCT FROM true
  WHERE fb.status = 'REVERTED'
    AND fbi.original_status = 'UNKNOWN'
  ORDER BY fbi.order_id, oh.valid_from DESC
) sub
WHERE o.id = sub.order_id;
