-- Backfill: set servicing_branch_id on existing cart_orders from their
-- campaign's branch_id. The cron and backfill migration 0209 created
-- cart_orders with NULL servicing_branch_id, making them invisible to
-- branch-scoped queries on the Cart Orders page.

UPDATE cart_orders co
SET servicing_branch_id = c.branch_id,
    updated_at = NOW()
FROM campaigns c
WHERE co.campaign_id = c.id
  AND co.servicing_branch_id IS NULL
  AND c.branch_id IS NOT NULL;
