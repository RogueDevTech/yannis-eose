-- Final fix: restore fields from the LAST history row BEFORE the batch
-- was created (June 4th 15:17 WAT). This gets the most recent pre-batch
-- state: correct assigned_cs_id, created_at, branch, etc.

UPDATE orders o
SET
  created_at = sub.h_created_at,
  assigned_cs_id = sub.h_assigned_cs_id,
  servicing_branch_id = sub.h_servicing_branch_id,
  media_buyer_id = sub.h_media_buyer_id,
  campaign_id = sub.h_campaign_id,
  branch_id = sub.h_branch_id
FROM (
  SELECT DISTINCT ON (i.order_id)
    i.order_id,
    oh.created_at AS h_created_at,
    oh.assigned_cs_id AS h_assigned_cs_id,
    oh.servicing_branch_id AS h_servicing_branch_id,
    oh.media_buyer_id AS h_media_buyer_id,
    oh.campaign_id AS h_campaign_id,
    oh.branch_id AS h_branch_id
  FROM follow_up_batch_items i
  INNER JOIN follow_up_batches b ON b.id = i.batch_id
  INNER JOIN orders_history oh ON oh.id = i.order_id
    AND oh.valid_from < '2026-06-04T14:17:00Z'
  WHERE b.status = 'REVERTED'
  ORDER BY i.order_id, oh.valid_from DESC
) sub
WHERE o.id = sub.order_id;
