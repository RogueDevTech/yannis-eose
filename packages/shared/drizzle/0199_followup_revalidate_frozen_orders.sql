-- 0199: Re-evaluate frozen orders against current follow-up rules.
--
-- The old pullOrdersForRule used createdAt for age checks instead of the
-- status-specific timestamp (confirmedAt, allocatedAt, etc.). This caused
-- orders to be pulled prematurely. This migration:
--   1. Finds all frozen orders whose UNPROCESSED follow-up copy should not
--      have been created under the corrected timestamp logic.
--   2. Deletes those follow-up copies + their line items.
--   3. Unfreezes the original orders.
--
-- Orders whose follow-up copies have progressed beyond UNPROCESSED are left
-- alone — CS already started working them.

BEGIN;

-- Step 1: Identify follow-up copies that are still UNPROCESSED and were
-- pulled by a rule. Re-check each against the rule's age threshold using the
-- correct status timestamp. If the original order does NOT meet the threshold
-- when measured from the right timestamp, the pull was unjust.

CREATE TEMP TABLE _unjust_followups AS
SELECT fo.id AS followup_id, fo.source_order_id
FROM follow_up_orders fo
JOIN orders o ON o.id = fo.source_order_id
JOIN follow_up_rules r ON r.id = fo.follow_up_rule_id
WHERE fo.status = 'UNPROCESSED'
  AND fo.source_order_id IS NOT NULL
  AND fo.follow_up_rule_id IS NOT NULL
  -- Re-evaluate: use the status-specific timestamp (COALESCE to created_at
  -- for old orders missing it). If the order is YOUNGER than the threshold
  -- when measured correctly, the pull was premature.
  AND COALESCE(
    CASE r.source_status
      WHEN 'CONFIRMED'      THEN o.confirmed_at
      WHEN 'AGENT_ASSIGNED' THEN o.allocated_at
      WHEN 'DISPATCHED'     THEN o.dispatched_at
      WHEN 'DELIVERED'      THEN o.delivered_at
      ELSE NULL
    END,
    o.created_at
  ) > (
    NOW() - MAKE_INTERVAL(
      days  := r.age_threshold_days,
      hours := COALESCE(r.age_threshold_hours, 0)
    )
  );

-- Step 2: Delete follow-up order items for unjust copies
DELETE FROM follow_up_order_items
WHERE follow_up_order_id IN (SELECT followup_id FROM _unjust_followups);

-- Step 3: Delete the unjust follow-up copies
DELETE FROM follow_up_orders
WHERE id IN (SELECT followup_id FROM _unjust_followups);

-- Step 4: Unfreeze the original orders (only those that no longer have
-- ANY follow-up copy — in case another rule validly pulled them too)
UPDATE orders
SET frozen_for_follow_up = false
WHERE frozen_for_follow_up = true
  AND id IN (SELECT source_order_id FROM _unjust_followups)
  AND id NOT IN (
    SELECT source_order_id FROM follow_up_orders
    WHERE source_order_id IS NOT NULL
  );

DROP TABLE _unjust_followups;

COMMIT;
