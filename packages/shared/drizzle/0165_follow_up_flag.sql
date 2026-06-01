-- Add is_follow_up flag to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_follow_up boolean NOT NULL DEFAULT false;

-- Backfill: update ORDER_RECEIVED timeline events for existing follow-up orders
UPDATE order_timeline_events
SET description = 'Order recreated as follow-up',
    actor_name = 'Follow Up'
WHERE event_type = 'ORDER_RECEIVED'
  AND order_id IN (SELECT id FROM orders WHERE is_follow_up = true);
