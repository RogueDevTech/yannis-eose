-- ============================================
-- Track C — Attendance foundation
-- ============================================
-- attendance_records — one row per staff member per MARKED day. HR-driven master
--   sheet: days default to PRESENT, so we persist exception days only (a staff/day
--   with no row = Present). Only ABSENT feeds payroll eligibility; OFF_DUTY/SICK are
--   recorded but never reduce pay. Durable + audited → full temporal history.
--
-- Also wires the attendance-eligibility CONFIG surfaces:
--   payroll_pay_roles.attendance_config (jsonb) — per-role bands + on/off (default OFF)
--   users.attendance_affects_pay (boolean)      — per-user override (NULL = inherit role)
--
-- History twins:
--   attendance_records → GENERIC positional trigger yannis_capture_history() (new table,
--     same as target_groups mig 0300).
--   payroll_pay_roles  → generic positional trigger; a plain _history ALTER keeps the twin
--     schema-aligned.
--   users              → EXPLICIT-COLUMN trigger functions (yannis_capture_history_*_users);
--     adding a column requires rebuilding BOTH functions with the new column appended,
--     exactly as mig 0307 did for tin. Done at the bottom.

-- ── Enum ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE attendance_status AS ENUM ('PRESENT', 'ABSENT', 'OFF_DUTY', 'SICK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── attendance_records ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_records (
  id uuid PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES users(id),
  attendance_date date NOT NULL,
  status attendance_status NOT NULL,
  remark text,
  branch_id uuid REFERENCES branches(id),
  group_id uuid REFERENCES branch_groups(id),
  marked_by uuid REFERENCES users(id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  modified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One record per staff per day — markCell UPSERTs on this.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_staff_day
  ON attendance_records (staff_id, attendance_date);
-- Grid + monthly-summary scans: staff/day range within a branch group.
CREATE INDEX IF NOT EXISTS attendance_records_group_date_idx
  ON attendance_records (group_id, attendance_date);
CREATE INDEX IF NOT EXISTS attendance_records_date_idx
  ON attendance_records (attendance_date);

-- Durable + audited → full temporal history table.
CREATE TABLE IF NOT EXISTS attendance_records_history (
  LIKE attendance_records INCLUDING ALL
);

-- Temporal triggers (generic positional, new-table pattern — mirrors target_groups).
DO $$ BEGIN
  DROP TRIGGER IF EXISTS trg_attendance_records_stamp_actor ON attendance_records;
  CREATE TRIGGER trg_attendance_records_stamp_actor
    BEFORE INSERT OR UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

  DROP TRIGGER IF EXISTS trg_attendance_records_capture_history ON attendance_records;
  CREATE TRIGGER trg_attendance_records_capture_history
    BEFORE UPDATE OR DELETE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

  DROP TRIGGER IF EXISTS trg_attendance_records_history_immutable ON attendance_records_history;
  CREATE TRIGGER trg_attendance_records_history_immutable
    BEFORE UPDATE OR DELETE ON attendance_records_history
    FOR EACH ROW EXECUTE FUNCTION yannis_history_immutable();
END $$;

-- Register for audit tooling.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_table_registry') THEN
    INSERT INTO audit_table_registry (table_name) VALUES ('attendance_records')
    ON CONFLICT DO NOTHING;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ── payroll_pay_roles.attendance_config ──────────────────────
-- Default OFF: attendance never affects pay until HR enables it per role.
ALTER TABLE payroll_pay_roles
  ADD COLUMN IF NOT EXISTS attendance_config jsonb NOT NULL DEFAULT '{"enabled": false, "bands": []}'::jsonb;

-- Keep the generic-positional history twin schema-aligned.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payroll_pay_roles_history'
  ) THEN
    -- History twin: bare (nullable, no default) so a positional capture of any
    -- pre-migration row version never rejects. Live table keeps NOT NULL DEFAULT.
    ALTER TABLE payroll_pay_roles_history
      ADD COLUMN IF NOT EXISTS attendance_config jsonb;
  END IF;
END $$;

-- ── users.attendance_affects_pay (per-user override) ─────────
-- NULL = inherit the pay role's attendance_config.enabled.
ALTER TABLE users ADD COLUMN IF NOT EXISTS attendance_affects_pay boolean;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users_history'
  ) THEN
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS attendance_affects_pay boolean;
  END IF;
END $$;

-- Rebuild the users EXPLICIT-COLUMN history trigger functions with
-- attendance_affects_pay appended (after exit_reason, matching schema order).
-- Column list is the full 0307 list + attendance_affects_pay.

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_users()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users_history (
    id, name, email, password_hash, role, role_template_id, scope_global,
    scope_org_wide_head, scope_team_supervisor, status, capacity,
    logistics_location_id, phone, visible_order_statuses, restrict_product_access,
    commission_plan_id, last_action_at, primary_branch_id, app_theme, font_scale,
    payout_bank_name, payout_account_name, payout_account_number, payout_bank_code,
    notification_preferences, login_count, last_login_at, is_team_supervisor,
    user_number, pay_role_id, employment_type, salary_basis, tax_status,
    flat_monthly_amount, reports_to_user_id, crm_linked, onboarding_payroll_status,
    payroll_employee_id, bank_verification_status, tin, annual_rent, date_of_joining,
    exit_date, exit_reason, attendance_affects_pay, valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.name, NEW.email, NEW.password_hash, NEW.role, NEW.role_template_id,
    NEW.scope_global, NEW.scope_org_wide_head, NEW.scope_team_supervisor, NEW.status,
    NEW.capacity, NEW.logistics_location_id, NEW.phone, NEW.visible_order_statuses,
    NEW.restrict_product_access, NEW.commission_plan_id, NEW.last_action_at,
    NEW.primary_branch_id, NEW.app_theme, NEW.font_scale, NEW.payout_bank_name,
    NEW.payout_account_name, NEW.payout_account_number, NEW.payout_bank_code,
    NEW.notification_preferences, NEW.login_count, NEW.last_login_at,
    NEW.is_team_supervisor, NEW.user_number, NEW.pay_role_id, NEW.employment_type,
    NEW.salary_basis, NEW.tax_status, NEW.flat_monthly_amount, NEW.reports_to_user_id,
    NEW.crm_linked, NEW.onboarding_payroll_status, NEW.payroll_employee_id,
    NEW.bank_verification_status, NEW.tin, NEW.annual_rent, NEW.date_of_joining,
    NEW.exit_date, NEW.exit_reason, NEW.attendance_affects_pay, NEW.valid_from,
    NEW.valid_to, NEW.modified_by, NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION yannis_capture_history_users()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users_history (
    id, name, email, password_hash, role, role_template_id, scope_global,
    scope_org_wide_head, scope_team_supervisor, status, capacity,
    logistics_location_id, phone, visible_order_statuses, restrict_product_access,
    commission_plan_id, last_action_at, primary_branch_id, app_theme, font_scale,
    payout_bank_name, payout_account_name, payout_account_number, payout_bank_code,
    notification_preferences, login_count, last_login_at, is_team_supervisor,
    user_number, pay_role_id, employment_type, salary_basis, tax_status,
    flat_monthly_amount, reports_to_user_id, crm_linked, onboarding_payroll_status,
    payroll_employee_id, bank_verification_status, tin, annual_rent, date_of_joining,
    exit_date, exit_reason, attendance_affects_pay, valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    OLD.id, OLD.name, OLD.email, OLD.password_hash, OLD.role, OLD.role_template_id,
    OLD.scope_global, OLD.scope_org_wide_head, OLD.scope_team_supervisor, OLD.status,
    OLD.capacity, OLD.logistics_location_id, OLD.phone, OLD.visible_order_statuses,
    OLD.restrict_product_access, OLD.commission_plan_id, OLD.last_action_at,
    OLD.primary_branch_id, OLD.app_theme, OLD.font_scale, OLD.payout_bank_name,
    OLD.payout_account_name, OLD.payout_account_number, OLD.payout_bank_code,
    OLD.notification_preferences, OLD.login_count, OLD.last_login_at,
    OLD.is_team_supervisor, OLD.user_number, OLD.pay_role_id, OLD.employment_type,
    OLD.salary_basis, OLD.tax_status, OLD.flat_monthly_amount, OLD.reports_to_user_id,
    OLD.crm_linked, OLD.onboarding_payroll_status, OLD.payroll_employee_id,
    OLD.bank_verification_status, OLD.tin, OLD.annual_rent, OLD.date_of_joining,
    OLD.exit_date, OLD.exit_reason, OLD.attendance_affects_pay, OLD.valid_from,
    OLD.valid_to, OLD.modified_by, OLD.created_at, OLD.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
