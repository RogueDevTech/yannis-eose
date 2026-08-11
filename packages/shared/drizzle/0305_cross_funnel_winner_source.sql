-- Migration 0305: Cross-funnel attempts — record the winner's SOURCE TABLE.
--
-- Problem this fixes
-- ------------------
-- When the universal 14-day dedup blocks a duplicate, it records a
-- `cross_funnel_attempts` row whose `original_order_id` points at the winning
-- order. But the winner can live in ANY of three tables — `orders`,
-- `cart_orders`, or `follow_up_orders` — and the whole cross-funnel READ path
-- (marketing.service.ts listMyCrossFunnelAttempts / crossFunnelStats) joins
-- `original_order_id` ONLY to `orders`. So when the winner is a follow-up or
-- cart order:
--   * every `orders.*` column (campaign, status, order number, amount) comes
--     back NULL, so the row renders as a blank winner, AND
--   * the duplicate-type classifier (which compares the attempt's campaign to
--     `orders.campaign_id`) misfires — the row can never be "resubmission" and
--     may drop out of the tab the MB is looking at.
--
-- Real incident: follow-up order YNS-74266 (a DELIVERED follow_up_orders row)
-- was the correct dedup winner for a re-submission, but nothing usable showed
-- on the cross-funnel page.
--
-- Fix: denormalize the winner's identity onto the CFA row at write time so the
-- read path no longer depends on the winner living in `orders`. Reads COALESCE
-- these stored columns over the legacy `orders` join, so historical rows
-- (always `orders` winners) keep working unchanged.
--
-- HISTORY TWIN: `cross_funnel_attempts` has NO `_history` table (it is an
-- append-only audit-support table, never itself audited). Verified: no
-- cross_funnel_attempts_history object exists. So there is no twin to sync.

-- 0. Drop the orders-only foreign key. `original_order_id` is now POLYMORPHIC —
--    it may reference a row in `orders`, `cart_orders`, OR `follow_up_orders`.
--    Migration 0082 created it inline as
--      original_order_id uuid REFERENCES orders(id) ON DELETE SET NULL
--    which Postgres auto-named `cross_funnel_attempts_original_order_id_fkey`.
--    If we keep it, any INSERT whose winner lives in cart_orders/follow_up_orders
--    violates the FK and the row is NEVER written (the caller swallows the error)
--    — which is precisely the bug this migration fixes. Drop it so polymorphic
--    winner ids are insertable. (The covering index cfa_original_order_idx from
--    0082 is kept — it is independent of the constraint.)
ALTER TABLE cross_funnel_attempts
  DROP CONSTRAINT IF EXISTS cross_funnel_attempts_original_order_id_fkey;

-- 1. original_order_source — which table the winning order lives in.
--    Legacy rows predate this and were ALWAYS `orders` winners (the read path
--    only ever surfaced orders winners), so backfill existing rows to 'orders'.
ALTER TABLE cross_funnel_attempts
  ADD COLUMN IF NOT EXISTS original_order_source text;

UPDATE cross_funnel_attempts
  SET original_order_source = 'orders'
  WHERE original_order_source IS NULL;

-- 2. Denormalized winner identity — populated at insert for ALL sources so the
--    read path never has to know which table the winner is in.
ALTER TABLE cross_funnel_attempts
  ADD COLUMN IF NOT EXISTS original_campaign_id uuid;

ALTER TABLE cross_funnel_attempts
  ADD COLUMN IF NOT EXISTS original_order_number integer;

ALTER TABLE cross_funnel_attempts
  ADD COLUMN IF NOT EXISTS original_order_status text;

-- 3a. Backfill the denormalized columns for existing ORDERS-winner rows from
--     the `orders` table, so old and new rows are shaped identically for reads.
UPDATE cross_funnel_attempts cfa
  SET original_campaign_id = o.campaign_id,
      original_order_number = o.order_number,
      original_order_status = o.status
  FROM orders o
  WHERE o.id = cfa.original_order_id
    AND cfa.original_campaign_id IS NULL;

-- 3b. Repair existing rows whose winner is actually a FOLLOW-UP order. Step 1
--     set every row to source='orders'; correct the ones that resolve in
--     follow_up_orders (and NOT in orders) here so the source label + denorm
--     fields are right even if the companion backfill script never runs.
UPDATE cross_funnel_attempts cfa
  SET original_order_source = 'follow_up_orders',
      original_campaign_id = fo.campaign_id,
      original_order_number = fo.order_number,
      original_order_status = fo.status
  FROM follow_up_orders fo
  WHERE fo.id = cfa.original_order_id
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = cfa.original_order_id);

-- 3c. Same repair for CART-order winners.
UPDATE cross_funnel_attempts cfa
  SET original_order_source = 'cart_orders',
      original_campaign_id = co.campaign_id,
      original_order_number = co.order_number,
      original_order_status = co.status
  FROM cart_orders co
  WHERE co.id = cfa.original_order_id
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = cfa.original_order_id)
    AND NOT EXISTS (SELECT 1 FROM follow_up_orders fo WHERE fo.id = cfa.original_order_id);

-- 4. NOTE ON FK: the orders-only FK was dropped in step 0 above. `original_order_id`
--    is now FK-free BY REQUIREMENT, because it can reference any of three order
--    tables. Do NOT re-add a single-table FK.

COMMENT ON COLUMN cross_funnel_attempts.original_order_source IS
  'Which table the winning order lives in: orders | cart_orders | follow_up_orders. Reads must not assume orders.';
COMMENT ON COLUMN cross_funnel_attempts.original_campaign_id IS
  'Denormalized winner campaign_id (source-agnostic). Prefer this over joining original_order_id to orders.';
COMMENT ON COLUMN cross_funnel_attempts.original_order_number IS
  'Denormalized winner human order number (YNS-XXXXX) across all three order tables.';
COMMENT ON COLUMN cross_funnel_attempts.original_order_status IS
  'Denormalized winner lifecycle status at time of the blocked attempt.';
