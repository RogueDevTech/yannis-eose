-- Add branch_id column to notifications for company-scoping.
-- Notifications without a branch_id are considered global (visible in all companies).
-- The service auto-stamps branch_id on creation from data->>'branchId' or by resolving
-- data->>'orderId' → orders.servicing_branch_id.

ALTER TABLE notifications ADD COLUMN branch_id uuid REFERENCES branches(id);

CREATE INDEX idx_notifications_branch_id ON notifications (branch_id) WHERE branch_id IS NOT NULL;

-- Backfill: stamp branch_id from data->>'branchId' where it exists
UPDATE notifications
SET branch_id = (data->>'branchId')::uuid
WHERE data->>'branchId' IS NOT NULL
  AND branch_id IS NULL;

-- Backfill: stamp branch_id from order's servicing_branch_id where orderId exists
UPDATE notifications n
SET branch_id = o.servicing_branch_id
FROM orders o
WHERE (n.data->>'orderId')::uuid = o.id
  AND n.branch_id IS NULL
  AND o.servicing_branch_id IS NOT NULL;

-- For remaining notifications with orderId but no servicing_branch_id, fall back to branch_id
UPDATE notifications n
SET branch_id = o.branch_id
FROM orders o
WHERE (n.data->>'orderId')::uuid = o.id
  AND n.branch_id IS NULL
  AND o.branch_id IS NOT NULL;
