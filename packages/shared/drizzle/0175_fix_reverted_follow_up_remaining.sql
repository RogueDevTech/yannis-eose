-- Fix v4: Catch remaining orders from the reverted batch that 0174 missed.
-- 0174 had `AND o.is_follow_up = false` which skipped orders still flagged
-- as follow-up. This migration removes that restriction.

UPDATE orders o
SET
  status = sub.previous_status::order_status,
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
WHERE o.id = sub.order_id;
