-- Ensure branch_team_settings exists. Original migration 0127 used uuidv7()
-- which doesn't exist in PostgreSQL — if 0127 was recorded as applied but
-- failed silently or ran on a DB with that function, this catches up.

CREATE TABLE IF NOT EXISTS branch_team_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES branch_teams(id) ON DELETE CASCADE,
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT branch_team_settings_team_key_unique UNIQUE (team_id, key)
);

CREATE INDEX IF NOT EXISTS idx_branch_team_settings_team_id
  ON branch_team_settings(team_id);

CREATE INDEX IF NOT EXISTS idx_branch_team_settings_key
  ON branch_team_settings(key);

-- Also ensure is_enforced on system_settings (from same migration 0127)
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS is_enforced boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'system_settings_history'
  ) THEN
    ALTER TABLE system_settings_history
      ADD COLUMN IF NOT EXISTS is_enforced boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Ensure cs_order_routing tables from 0133
DO $$ BEGIN
  CREATE TYPE cs_order_routing_strategy AS ENUM ('WEIGHTED', 'EQUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS cs_order_routing_rules (
  id uuid PRIMARY KEY NOT NULL,
  owner_branch_id uuid NOT NULL REFERENCES branches (id),
  product_id uuid REFERENCES products (id),
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  strategy cs_order_routing_strategy NOT NULL DEFAULT 'EQUAL',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cs_order_routing_rules_owner_enabled_idx
  ON cs_order_routing_rules (owner_branch_id, enabled);

CREATE TABLE IF NOT EXISTS cs_order_routing_rule_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  rule_id uuid NOT NULL REFERENCES cs_order_routing_rules (id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES branch_teams (id) ON DELETE CASCADE,
  weight integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure branch_departments from 0135
CREATE TABLE IF NOT EXISTS branch_departments (
  id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  department branch_team_department NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, department)
);

-- Ensure default teams exist (from 0133)
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
