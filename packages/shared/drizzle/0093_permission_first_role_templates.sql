-- Permission-first RBAC: role templates + explicit scope flags.
-- Includes temporal history mirrors consistent with the rest of the platform.

BEGIN;

-- ── Tables ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  kind text NOT NULL DEFAULT 'CUSTOM', -- SYSTEM | CUSTOM
  status text NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | ARCHIVED
  locked boolean NOT NULL DEFAULT false,
  mapped_role user_role, -- nullable pointer to legacy enum role when kind=SYSTEM

  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_template_permissions (
  role_template_id uuid NOT NULL REFERENCES role_templates(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,

  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by text,

  PRIMARY KEY (role_template_id, permission_id)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role_template_id uuid REFERENCES role_templates(id),
  ADD COLUMN IF NOT EXISTS scope_global boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scope_org_wide_head boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS scope_team_supervisor boolean NOT NULL DEFAULT false;

-- Backfill explicit scope flags from legacy roles (keeps existing cross-branch behavior).
UPDATE users
SET
  scope_global = CASE
    WHEN role::text IN ('SUPER_ADMIN', 'ADMIN') THEN true
    ELSE scope_global
  END,
  scope_org_wide_head = CASE
    WHEN role::text IN ('HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS') THEN true
    ELSE scope_org_wide_head
  END
WHERE true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_role_template_id_not_null
  ON users (role_template_id)
  WHERE role_template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_templates_kind_status ON role_templates (kind, status);
CREATE INDEX IF NOT EXISTS idx_users_role_template_id ON users (role_template_id);

-- ── History tables + temporal triggers (mirror 0067 pattern) ─────────
DO $$
DECLARE
  _constraint RECORD;
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS role_templates_history (LIKE role_templates INCLUDING ALL)';
  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'role_templates_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE role_templates_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS role_templates_history_temporal_idx
    ON role_templates_history (id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_role_templates_stamp_actor ON role_templates;
  CREATE TRIGGER trg_role_templates_stamp_actor
    BEFORE INSERT OR UPDATE ON role_templates
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_role_templates_capture_history ON role_templates;
  CREATE TRIGGER trg_role_templates_capture_history
    BEFORE UPDATE OR DELETE ON role_templates
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_role_templates_history_immutable ON role_templates_history;
  CREATE TRIGGER trg_role_templates_history_immutable
    BEFORE UPDATE OR DELETE ON role_templates_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

DO $$
DECLARE
  _constraint RECORD;
BEGIN
  EXECUTE 'CREATE TABLE IF NOT EXISTS role_template_permissions_history (LIKE role_template_permissions INCLUDING ALL)';
  FOR _constraint IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'role_template_permissions_history'
      AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
  LOOP
    EXECUTE format('ALTER TABLE role_template_permissions_history DROP CONSTRAINT IF EXISTS %I', _constraint.constraint_name);
  END LOOP;

  CREATE INDEX IF NOT EXISTS role_template_permissions_history_temporal_idx
    ON role_template_permissions_history (role_template_id, permission_id, valid_from, valid_to);

  DROP TRIGGER IF EXISTS trg_role_template_permissions_stamp_actor ON role_template_permissions;
  CREATE TRIGGER trg_role_template_permissions_stamp_actor
    BEFORE INSERT OR UPDATE ON role_template_permissions
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_role_template_permissions_capture_history ON role_template_permissions;
  CREATE TRIGGER trg_role_template_permissions_capture_history
    BEFORE UPDATE OR DELETE ON role_template_permissions
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_role_template_permissions_history_immutable ON role_template_permissions_history;
  CREATE TRIGGER trg_role_template_permissions_history_immutable
    BEFORE UPDATE OR DELETE ON role_template_permissions_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- ── Seed SYSTEM role templates from legacy enum + copy role_permissions ─
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_templates_system_mapped_role
  ON role_templates (mapped_role)
  WHERE kind = 'SYSTEM' AND mapped_role IS NOT NULL;

INSERT INTO role_templates (key, name, description, kind, status, locked, mapped_role)
VALUES
  ('system_SUPER_ADMIN', 'Super Admin', 'System-protected org owner template', 'SYSTEM', 'ACTIVE', true, 'SUPER_ADMIN'),
  ('system_ADMIN', 'Admin', 'System template for org-wide administrators', 'SYSTEM', 'ACTIVE', true, 'ADMIN'),
  ('system_BRANCH_ADMIN', 'Branch Admin', 'System template for branch operators', 'SYSTEM', 'ACTIVE', true, 'BRANCH_ADMIN'),
  ('system_HEAD_OF_MARKETING', 'Head of Marketing', 'System template', 'SYSTEM', 'ACTIVE', true, 'HEAD_OF_MARKETING'),
  ('system_MEDIA_BUYER', 'Media Buyer', 'System template', 'SYSTEM', 'ACTIVE', true, 'MEDIA_BUYER'),
  ('system_HEAD_OF_CS', 'Head of CS', 'System template', 'SYSTEM', 'ACTIVE', true, 'HEAD_OF_CS'),
  ('system_CS_AGENT', 'CS Agent', 'System template', 'SYSTEM', 'ACTIVE', true, 'CS_AGENT'),
  ('system_FINANCE_OFFICER', 'Finance Officer', 'System template', 'SYSTEM', 'ACTIVE', true, 'FINANCE_OFFICER'),
  ('system_HEAD_OF_LOGISTICS', 'Head of Logistics', 'System template', 'SYSTEM', 'ACTIVE', true, 'HEAD_OF_LOGISTICS'),
  ('system_STOCK_MANAGER', 'Stock Manager', 'System template', 'SYSTEM', 'ACTIVE', true, 'STOCK_MANAGER'),
  ('system_TPL_MANAGER', '3PL Manager', 'System template', 'SYSTEM', 'ACTIVE', true, 'TPL_MANAGER'),
  ('system_TPL_RIDER', '3PL Rider', 'System template', 'SYSTEM', 'ACTIVE', true, 'TPL_RIDER'),
  ('system_HR_MANAGER', 'HR Manager', 'System template', 'SYSTEM', 'ACTIVE', true, 'HR_MANAGER')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_template_permissions (role_template_id, permission_id)
SELECT rt.id, rp.permission_id
FROM role_permissions rp
JOIN role_templates rt
  ON rt.mapped_role = rp.role
 AND rt.kind = 'SYSTEM'
ON CONFLICT DO NOTHING;

UPDATE users u
SET role_template_id = rt.id
FROM role_templates rt
WHERE rt.kind = 'SYSTEM'
  AND rt.mapped_role = u.role
  AND u.role_template_id IS NULL;

COMMIT;
