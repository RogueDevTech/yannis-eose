-- Fix v2: Previous migration (0172) failed because orders_history.is_follow_up
-- is nullable — pre-existing rows have NULL, not false. The WHERE clause
-- `oh.is_follow_up = false` matched nothing, so no orders were restored.
--
-- This version uses `is_follow_up IS DISTINCT FROM true` to match both
-- NULL and false history rows (i.e. the state before follow-up was set).
--
-- Restores each affected order to its last known status before the batch
-- set is_follow_up = true.

UPDATE orders o
SET
  status = sub.restored_status,
  is_follow_up = false,
  assigned_cs_id = NULL
FROM (
  SELECT
    fbi.order_id,
    (
      SELECT oh.status
      FROM orders_history oh
      WHERE oh.id = fbi.order_id
        AND oh.is_follow_up IS DISTINCT FROM true
      ORDER BY oh.valid_from DESC
      LIMIT 1
    ) AS restored_status
  FROM follow_up_batch_items fbi
  INNER JOIN follow_up_batches fb ON fb.id = fbi.batch_id
  WHERE fb.status = 'REVERTED'
    AND fbi.original_status = 'UNKNOWN'
) sub
WHERE o.id = sub.order_id
  AND sub.restored_status IS NOT NULL;
