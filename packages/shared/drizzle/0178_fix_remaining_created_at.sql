-- Full restore for ALL orders in the reverted batch.
-- reopenForFollowUp overwrote: created_at, assigned_cs_id, servicing_branch_id.
-- Use the LAST orders_history row BEFORE the follow-up (is_follow_up IS DISTINCT
-- FROM true) to restore these fields to their pre-batch values.

UPDATE orders o
SET
  created_at = sub.orig_created_at,
  assigned_cs_id = sub.orig_assigned_cs_id,
  servicing_branch_id = sub.orig_servicing_branch_id,
  media_buyer_id = sub.orig_media_buyer_id,
  campaign_id = sub.orig_campaign_id,
  branch_id = sub.orig_branch_id
FROM (
  SELECT DISTINCT ON (i.order_id)
    i.order_id,
    oh.created_at AS orig_created_at,
    oh.assigned_cs_id AS orig_assigned_cs_id,
    oh.servicing_branch_id AS orig_servicing_branch_id,
    oh.media_buyer_id AS orig_media_buyer_id,
    oh.campaign_id AS orig_campaign_id,
    oh.branch_id AS orig_branch_id
  FROM follow_up_batch_items i
  INNER JOIN follow_up_batches b ON b.id = i.batch_id
  INNER JOIN orders_history oh ON oh.id = i.order_id
    AND oh.is_follow_up IS DISTINCT FROM true
  WHERE b.status = 'REVERTED'
  ORDER BY i.order_id, oh.valid_from DESC
) sub
WHERE o.id = sub.order_id;

-- Fallback: for orders where the above didn't match (no history with
-- is_follow_up != true), use the EARLIEST history row instead.
UPDATE orders o
SET
  created_at = sub.orig_created_at,
  assigned_cs_id = sub.orig_assigned_cs_id,
  servicing_branch_id = sub.orig_servicing_branch_id,
  media_buyer_id = sub.orig_media_buyer_id,
  campaign_id = sub.orig_campaign_id,
  branch_id = sub.orig_branch_id
FROM (
  SELECT DISTINCT ON (i.order_id)
    i.order_id,
    oh.created_at AS orig_created_at,
    oh.assigned_cs_id AS orig_assigned_cs_id,
    oh.servicing_branch_id AS orig_servicing_branch_id,
    oh.media_buyer_id AS orig_media_buyer_id,
    oh.campaign_id AS orig_campaign_id,
    oh.branch_id AS orig_branch_id
  FROM follow_up_batch_items i
  INNER JOIN follow_up_batches b ON b.id = i.batch_id
  INNER JOIN orders_history oh ON oh.id = i.order_id
  WHERE b.status = 'REVERTED'
  ORDER BY i.order_id, oh.valid_from ASC
) sub
WHERE o.id = sub.order_id
  AND o.created_at >= '2026-06-04T00:00:00+01:00';
