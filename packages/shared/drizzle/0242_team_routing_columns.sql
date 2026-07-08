-- 0242: Add team routing columns for team-scoped auto-assignment.
--
-- cart_order_routing_rules.team_id — optional target team on routing rules
-- cart_orders.routing_team_id — resolved team stored on cart orders
-- follow_up_rules.team_id — optional target team on follow-up rules
-- follow_up_orders.routing_team_id — resolved team stored on follow-up orders

ALTER TABLE cart_order_routing_rules ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE cart_orders ADD COLUMN IF NOT EXISTS routing_team_id uuid;
ALTER TABLE follow_up_rules ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE follow_up_orders ADD COLUMN IF NOT EXISTS routing_team_id uuid;

-- Sync history tables (temporal audit triggers)
DO $sync$
BEGIN
  -- cart_orders_history
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cart_orders_history') THEN
    ALTER TABLE cart_orders_history ADD COLUMN IF NOT EXISTS routing_team_id uuid;
  END IF;

  -- follow_up_orders_history
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'follow_up_orders_history') THEN
    ALTER TABLE follow_up_orders_history ADD COLUMN IF NOT EXISTS routing_team_id uuid;
  END IF;

  -- cart_order_routing_rules_history (if exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cart_order_routing_rules_history') THEN
    ALTER TABLE cart_order_routing_rules_history ADD COLUMN IF NOT EXISTS team_id uuid;
  END IF;

  -- follow_up_rules_history (if exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'follow_up_rules_history') THEN
    ALTER TABLE follow_up_rules_history ADD COLUMN IF NOT EXISTS team_id uuid;
  END IF;
END $sync$;
