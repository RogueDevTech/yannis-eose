-- 0238: Backfill NULL branch_id on cart_orders and graduated orders.
--
-- Root cause: the original cart pull INSERT (pre-7c33748, before 2026-07-01)
-- omitted the branch_id column entirely. All cart_orders created before July 1
-- have NULL branch_id, and orders graduated from those carts inherited the NULL.
--
-- This migration:
-- 1. Backfills cart_orders.branch_id from campaigns.branch_id (skipping sentinel)
-- 2. Backfills cart_orders.branch_id from the MB's branch (for sentinel campaigns)
-- 3. Backfills orders.branch_id from campaigns.branch_id (real branch, non-sentinel)
-- 4. Backfills orders.branch_id from the MB's branch (sentinel campaigns)
-- 5. Fixes sentinel campaign branch_ids to point to the MB's actual branch

-- ── 1. cart_orders: backfill from campaign (real branch) ──────────────
UPDATE cart_orders co
SET branch_id = camp.branch_id
FROM campaigns camp
WHERE camp.id = co.campaign_id
  AND co.branch_id IS NULL
  AND camp.branch_id IS NOT NULL
  AND camp.branch_id != '00000000-0000-0000-0000-000000000001';

-- ── 2. cart_orders: backfill from MB's branch (sentinel campaigns) ───
UPDATE cart_orders co
SET branch_id = ub.branch_id
FROM user_branches ub
WHERE ub.user_id = co.media_buyer_id
  AND co.branch_id IS NULL;

-- ── 3. orders: backfill from campaign (real branch, non-sentinel) ────
UPDATE orders o
SET branch_id = camp.branch_id
FROM campaigns camp
WHERE camp.id = o.campaign_id
  AND o.branch_id IS NULL
  AND o.order_source = 'online'
  AND camp.branch_id IS NOT NULL
  AND camp.branch_id != '00000000-0000-0000-0000-000000000001';

-- ── 4. orders: backfill from MB's branch (sentinel campaigns) ────────
UPDATE orders o
SET branch_id = ub.branch_id
FROM user_branches ub
WHERE ub.user_id = o.media_buyer_id
  AND o.branch_id IS NULL
  AND o.order_source = 'online';

-- ── 5. Fix sentinel campaigns → use MB's actual branch ──────────────
-- So future cart pulls via camp.branch_id get the right value.
UPDATE campaigns c
SET branch_id = ub.branch_id
FROM user_branches ub
WHERE ub.user_id = c.media_buyer_id
  AND c.branch_id = '00000000-0000-0000-0000-000000000001';
