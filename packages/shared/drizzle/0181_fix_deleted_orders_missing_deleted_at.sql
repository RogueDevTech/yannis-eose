-- Fix 68 DELETED orders from reverted batch that are missing deleted_at.
-- reopenForFollowUp cleared deleted_at, migration 0174 restored status
-- to DELETED but didn't restore deleted_at. These orders show up in
-- normal list views because the query filters on deleted_at IS NULL.
--
-- Restore deleted_at from the last pre-batch history row that had it set.

UPDATE orders o
SET deleted_at = sub.h_deleted_at
FROM (
  SELECT DISTINCT ON (i.order_id)
    i.order_id,
    oh.deleted_at AS h_deleted_at
  FROM follow_up_batch_items i
  INNER JOIN follow_up_batches b ON b.id = i.batch_id
  INNER JOIN orders_history oh ON oh.id = i.order_id
    AND oh.valid_from < '2026-06-04T14:17:00Z'
    AND oh.deleted_at IS NOT NULL
  WHERE b.status = 'REVERTED'
  ORDER BY i.order_id, oh.valid_from DESC
) sub
WHERE o.id = sub.order_id
  AND o.status = 'DELETED'
  AND o.deleted_at IS NULL;

-- Fallback: if no history row had deleted_at, just set it to now
-- so they're hidden from normal views.
UPDATE orders
SET deleted_at = NOW()
WHERE id IN (
  SELECT i.order_id
  FROM follow_up_batch_items i
  INNER JOIN follow_up_batches b ON b.id = i.batch_id
  WHERE b.status = 'REVERTED'
)
AND status = 'DELETED'
AND deleted_at IS NULL;
