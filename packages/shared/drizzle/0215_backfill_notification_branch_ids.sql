-- Backfill branchId in notification data from linked orders.
-- After this migration, all order-related notifications will have data->>'branchId' set,
-- enabling the company-group notification filter to work correctly.

-- 1. Order notifications: stamp from orders.servicing_branch_id
UPDATE notifications n
SET data = n.data || jsonb_build_object('branchId', o.servicing_branch_id)
FROM orders o
WHERE n.data->>'orderId' IS NOT NULL
  AND n.data->>'branchId' IS NULL
  AND o.id = (n.data->>'orderId')::uuid
  AND o.servicing_branch_id IS NOT NULL;

-- 2. Media buyer notifications: stamp from the MB's primary branch
UPDATE notifications n
SET data = n.data || jsonb_build_object('branchId', ub.branch_id)
FROM user_branches ub
WHERE n.data->>'mediaBuyerId' IS NOT NULL
  AND n.data->>'branchId' IS NULL
  AND n.data->>'orderId' IS NULL
  AND ub.user_id = (n.data->>'mediaBuyerId')::uuid
  AND ub.is_primary = true;

-- 3. Funding notifications: stamp from the requester's primary branch
UPDATE notifications n
SET data = n.data || jsonb_build_object('branchId', ub.branch_id)
FROM user_branches ub
WHERE n.data->>'requesterId' IS NOT NULL
  AND n.data->>'branchId' IS NULL
  AND ub.user_id = (n.data->>'requesterId')::uuid
  AND ub.is_primary = true;
