-- Fix orders that were incorrectly reverted from a follow-up batch.
-- The batch revert set them to UNPROCESSED + isFollowUp=false because their
-- original_status was stored as UNKNOWN. This flooded normal order views.
--
-- Strategy: use orders_history to find each order's status BEFORE the
-- reopenForFollowUp changed it to UNPROCESSED. Restore that status and
-- clear the follow-up flag so they return to their pre-batch state.
--
-- Only affects orders in REVERTED batches where original_status = 'UNKNOWN'.

-- Step 1: Restore the correct pre-batch status from orders_history.
-- The history row we want is the most recent one where is_follow_up = false
-- (i.e. the last state before the batch set is_follow_up = true).
UPDATE orders o
SET
  status = COALESCE(
    (
      SELECT oh.status
      FROM orders_history oh
      WHERE oh.id = o.id
        AND oh.is_follow_up = false
      ORDER BY oh.valid_from DESC
      LIMIT 1
    ),
    o.status  -- fallback: keep current if no history found
  ),
  is_follow_up = false,
  assigned_cs_id = NULL
WHERE o.id IN (
  SELECT fbi.order_id
  FROM follow_up_batch_items fbi
  INNER JOIN follow_up_batches fb ON fb.id = fbi.batch_id
  WHERE fb.status = 'REVERTED'
    AND fbi.original_status = 'UNKNOWN'
);
