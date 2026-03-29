-- Orders created before branch_id was set on insert had branch_id NULL and were hidden from
-- branch-scoped lists (marketing orders, CS, etc.). Backfill from campaign, then media buyer membership.

UPDATE orders o
SET branch_id = c.branch_id
FROM campaigns c
WHERE o.campaign_id = c.id
  AND o.branch_id IS NULL
  AND c.branch_id IS NOT NULL;

UPDATE orders o
SET branch_id = sub.branch_id
FROM (
  SELECT DISTINCT ON (user_id) user_id, branch_id
  FROM user_branches
  ORDER BY user_id, is_primary DESC
) sub
WHERE o.branch_id IS NULL
  AND o.media_buyer_id = sub.user_id;
