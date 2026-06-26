-- Cart Order Routing Rules
-- Admin-configured rules that determine which branch cart orders are routed to.
-- Evaluated in priority order (highest first). First matching rule wins.
-- NULL targetBranchId = round-robin across active CS branches.

CREATE TABLE IF NOT EXISTS cart_order_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  source_branch_id UUID REFERENCES branches(id),
  target_branch_id UUID REFERENCES branches(id),
  priority INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sys_period tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- History table for temporal audit
CREATE TABLE IF NOT EXISTS cart_order_routing_rules_history (
  LIKE cart_order_routing_rules INCLUDING ALL
);

-- Sync Logs for auto-pull cron
CREATE TABLE IF NOT EXISTS cart_order_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by TEXT NOT NULL,
  triggered_by_user_id UUID REFERENCES users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  total_pulled INTEGER NOT NULL DEFAULT 0,
  rule_results JSONB,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add routing_rule_id FK to cart_orders so we can track which rule routed each order
ALTER TABLE cart_orders ADD COLUMN IF NOT EXISTS routing_rule_id UUID REFERENCES cart_order_routing_rules(id);
