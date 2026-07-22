-- 0259: Copy timeline events for orders graduated by migration 0258
--
-- The 80 follow-up orders and 4 cart orders backfilled in 0258 were inserted
-- into the orders table without their timeline events. This migration copies
-- events from follow_up_order_timeline_events and cart_order_timeline_events
-- to order_timeline_events so the Order Activity log is complete.

-- 1. Copy follow-up order timeline events to graduated orders
INSERT INTO order_timeline_events (id, order_id, event_type, actor_id, actor_name, description, metadata, branch_id, created_at)
SELECT
  gen_random_uuid(),
  o.id,
  fote.event_type::text::timeline_event_type,
  fote.actor_id,
  fote.actor_name,
  fote.description,
  fote.metadata,
  fote.branch_id,
  fote.created_at
FROM follow_up_order_timeline_events fote
JOIN follow_up_orders fo ON fo.id = fote.follow_up_order_id
JOIN orders o ON o.customer_phone_hash = fo.customer_phone_hash
  AND o.is_follow_up = true
  AND o.status = 'DELIVERED'
  AND o.deleted_at IS NULL
  AND o.delivered_at = fo.delivered_at
  AND (
    (fo.source_order_id IS NOT NULL AND o.follow_up_source_order_id = fo.source_order_id)
    OR (fo.source_order_id IS NULL AND o.follow_up_source_order_id IS NULL)
  )
WHERE fo.status = 'DELIVERED'
  AND fo.deleted_at IS NULL
  -- Only for graduated orders that don't have timeline events yet (idempotent)
  AND NOT EXISTS (
    SELECT 1 FROM order_timeline_events ote WHERE ote.order_id = o.id
  );

-- 2. Copy cart order timeline events to graduated orders
INSERT INTO order_timeline_events (id, order_id, event_type, actor_id, actor_name, description, metadata, branch_id, created_at)
SELECT
  gen_random_uuid(),
  o.id,
  cote.event_type::text::timeline_event_type,
  cote.actor_id,
  cote.actor_name,
  cote.description,
  cote.metadata,
  cote.branch_id,
  cote.created_at
FROM cart_order_timeline_events cote
JOIN cart_orders co ON co.id = cote.cart_order_id
JOIN orders o ON o.customer_phone_hash = co.customer_phone_hash
  AND o.order_source = 'online'
  AND o.status = 'DELIVERED'
  AND o.deleted_at IS NULL
  AND o.delivered_at = co.delivered_at
WHERE co.status = 'DELIVERED'
  AND co.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM order_timeline_events ote WHERE ote.order_id = o.id
  );
