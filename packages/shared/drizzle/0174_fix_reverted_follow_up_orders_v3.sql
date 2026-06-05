-- Fix v3: Restore orders from reverted follow-up batches to their correct
-- pre-batch status using the ORDER_RESTORED timeline event which stores
-- the previousStatus in its metadata.
--
-- Previous fixes (0172, 0173) failed because:
-- - 0172: orders_history.is_follow_up was NULL not false (comparison failed)
-- - 0173: same NULL issue with IS DISTINCT FROM (or history rows not matching)
--
-- This approach uses order_timeline_events which reliably recorded
-- "Reopened for follow-up. Previous status: REMITTED." with
-- metadata->>'previousStatus' = 'REMITTED'.

UPDATE orders o
SET
  status = sub.previous_status::text,
  is_follow_up = false,
  assigned_cs_id = NULL
FROM (
  SELECT DISTINCT ON (fbi.order_id)
    fbi.order_id,
    ote.metadata->>'previousStatus' AS previous_status
  FROM follow_up_batch_items fbi
  INNER JOIN follow_up_batches fb ON fb.id = fbi.batch_id
  INNER JOIN order_timeline_events ote ON ote.order_id = fbi.order_id
    AND ote.event_type = 'ORDER_RESTORED'
    AND ote.metadata->>'previousStatus' IS NOT NULL
  WHERE fb.status = 'REVERTED'
    AND fbi.original_status = 'UNKNOWN'
  ORDER BY fbi.order_id, ote.created_at DESC
) sub
WHERE o.id = sub.order_id
  AND o.is_follow_up = false;
