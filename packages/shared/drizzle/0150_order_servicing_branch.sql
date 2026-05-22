-- ============================================
-- 0150: Split the order's branch into two distinct fields.
--
-- THE BUG:
--   `orders.branch_id` was doing two jobs at once — marketing attribution AND
--   CS servicing — and CS order routing OVERWROTE it at creation time
--   (orders.service.ts: `branchId = servicingBranch`). So an order from a
--   Branch-A form whose product is routing-mapped to a Branch-B CS team was
--   stored with `branch_id = B`. Marketing surfaces that filter `branch_id`
--   (MB leaderboard, Team Analysis) then lost the order from Branch A and
--   leaked it into Branch B. HoM only looked right because it used a
--   campaign-branch sub-query band-aid.
--
-- THE FIX:
--   `branch_id`            = marketing branch (campaign/form branch). Set once
--                            at creation, never changes. Drives MB / HoM /
--                            Team Analysis / Marketing P&L.
--   `servicing_branch_id`  = CS servicing branch (from CS routing rules, or
--                            the marketing branch when no rule matches).
--                            Drives CS queues, claim dispatch, logistics.
--
-- Both `orders` and `orders_history` get the column so the temporal capture
-- trigger does not fail on UPDATE/DELETE (matches the convention from earlier
-- migrations — see 0069, 0142, 0149).
-- ============================================

-- 1. Add the column to BOTH tables BEFORE any UPDATE (temporal trigger copies
--    the old row into history on every UPDATE below).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS servicing_branch_id uuid REFERENCES branches(id);

ALTER TABLE orders_history
  ADD COLUMN IF NOT EXISTS servicing_branch_id uuid;

-- 2. Backfill servicing_branch_id from the CURRENT branch_id.
--    Today's `branch_id` already holds the servicing branch (CS routing
--    clobbered it), so it is the correct seed for servicing_branch_id.
UPDATE orders
  SET servicing_branch_id = branch_id
  WHERE servicing_branch_id IS NULL;

-- 3. Restore the MARKETING branch into branch_id for campaign-attributed
--    orders. The campaign's branch is the true marketing branch; the order's
--    branch_id was overwritten by CS routing. Orders without a campaign keep
--    their existing branch_id (offline / manual orders were never routed).
UPDATE orders o
  SET branch_id = c.branch_id
  FROM campaigns c
  WHERE o.campaign_id = c.id
    AND c.branch_id IS NOT NULL
    AND o.branch_id IS DISTINCT FROM c.branch_id;

-- 4. Index for CS-side branch scoping (CS queues filter by servicing branch).
CREATE INDEX IF NOT EXISTS orders_servicing_branch_id_idx
  ON orders (servicing_branch_id)
  WHERE servicing_branch_id IS NOT NULL;
