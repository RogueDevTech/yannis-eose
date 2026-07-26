-- GL Account Mappings: DB-backed overrides for the auto-posting engine's
-- default account lookups. Each company (branch_group) can remap any
-- mapping key to a different leaf account from their Chart of Accounts.

CREATE TABLE IF NOT EXISTS gl_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES branch_groups(id),
  mapping_key text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(group_id, mapping_key)
);
