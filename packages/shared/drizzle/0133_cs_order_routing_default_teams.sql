-- Default Marketing + CS branch_teams for branches missing a department team.
-- CS order routing rules (per owning branch + optional product → CS teams).

INSERT INTO branch_teams (id, branch_id, department, name, created_at, updated_at)
SELECT gen_random_uuid(), b.id, 'CS'::branch_team_department, 'Customer support', now(), now()
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM branch_teams t WHERE t.branch_id = b.id AND t.department = 'CS'
);

INSERT INTO branch_teams (id, branch_id, department, name, created_at, updated_at)
SELECT gen_random_uuid(), b.id, 'MARKETING'::branch_team_department, 'Marketing', now(), now()
FROM branches b
WHERE NOT EXISTS (
  SELECT 1 FROM branch_teams t WHERE t.branch_id = b.id AND t.department = 'MARKETING'
);

CREATE TYPE cs_order_routing_strategy AS ENUM ('WEIGHTED', 'EQUAL');

CREATE TABLE cs_order_routing_rules (
  id uuid PRIMARY KEY NOT NULL,
  owner_branch_id uuid NOT NULL REFERENCES branches (id),
  product_id uuid REFERENCES products (id),
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  strategy cs_order_routing_strategy NOT NULL DEFAULT 'EQUAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cs_order_routing_rules_owner_enabled_idx ON cs_order_routing_rules (owner_branch_id, enabled);

CREATE TABLE cs_order_routing_rule_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  rule_id uuid NOT NULL REFERENCES cs_order_routing_rules (id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES branch_teams (id) ON DELETE CASCADE,
  weight integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cs_order_routing_rule_targets_rule_idx ON cs_order_routing_rule_targets (rule_id);
