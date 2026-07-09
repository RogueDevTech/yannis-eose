-- 0248: Backfill missing timeline events for orders restored during the
-- Jul 3 2026 duplicate cleanup. 53 orders were bulk-restored to DELIVERED
-- via SQL (bypassing withActor), leaving no timeline events. This adds
-- an ORDER_DELIVERED event with a system note explaining the restoration.
--
-- Identification: orders where status = 'DELIVERED' and the orders_history
-- row for DELIVERED has modified_by IS NULL, AND no ORDER_DELIVERED timeline
-- event exists. The SYSTEM_ACTOR_ID (00000000-0000-0000-0000-000000000002)
-- is used as the actor.

INSERT INTO order_timeline_events (
  id, order_id, event_type, actor_id, actor_name, description, metadata, branch_id, created_at
)
SELECT
  gen_random_uuid(),
  o.id,
  'ORDER_DELIVERED',
  '00000000-0000-0000-0000-000000000002',  -- SYSTEM_ACTOR_ID
  'System',
  'Order restored to Delivered after duplicate cleanup review (Jul 2026). Original delivery was confirmed legitimate.',
  jsonb_build_object('backfill', true, 'reason', 'duplicate_cleanup_restore_jul2026'),
  o.branch_id,
  COALESCE(o.delivered_at, o.updated_at, NOW())
FROM orders o
WHERE o.status IN ('DELIVERED', 'REMITTED')
  AND o.delivered_at IS NOT NULL
  -- Only orders that have NO ORDER_DELIVERED timeline event
  AND NOT EXISTS (
    SELECT 1 FROM order_timeline_events ote
    WHERE ote.order_id = o.id
      AND ote.event_type = 'ORDER_DELIVERED'
  )
  -- Only orders that were part of the bulk restore (modified_by NULL on DELIVERED history row)
  AND EXISTS (
    SELECT 1 FROM orders_history oh
    WHERE oh.id = o.id
      AND oh.status = 'DELIVERED'
      AND oh.modified_by IS NULL
  );
