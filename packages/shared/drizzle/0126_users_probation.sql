-- ============================================
-- Probation user type (CEO directive 2026-05-08)
-- ============================================
-- Probation is a soft tag layered on top of any non-admin role. A probation user
-- has the FULL permission set of their role; the only difference is that they can
-- be **terminated** with a complete PII scrub if they don't meet expectations.
--
-- Termination:
--   1. Blocks if they have active orders / callbacks / unpaid payroll / Finance hat / etc.
--   2. Inserts a permanent `probation_terminations` audit row (the carve-out's audit record).
--   3. UPDATEs the live `users` row to scrub PII (name → "Terminated probation user #N",
--      email → unique anonymized address, phone/bank/password → null, status → DEACTIVATED).
--   4. Issues a SECONDARY scrub against `users_history` to NULL the same PII columns on
--      every prior version of the row. This is the ONE Pillar 4 carve-out — only allowed
--      via the termination code path. The non-PII history (id, role, scope, timestamps)
--      survives, and `probation_terminations` records that the scrub happened.
--
-- Eligibility (enforced in UsersService): not SUPER_ADMIN, not ADMIN. Everyone else is
-- eligible. Authority for set/unset/extend/terminate: HR_MANAGER + SUPER_ADMIN only.

-- ── Columns on users (mirrored to users_history) ──────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_probation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS probation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS probation_started_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS probation_until timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS original_role user_role;

ALTER TABLE users_history
  ADD COLUMN IF NOT EXISTS is_probation boolean,
  ADD COLUMN IF NOT EXISTS probation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS probation_started_by uuid,
  ADD COLUMN IF NOT EXISTS probation_until timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_by uuid,
  ADD COLUMN IF NOT EXISTS original_role user_role;

-- HR review queue: surface probations whose review window is approaching/expired.
CREATE INDEX IF NOT EXISTS users_probation_until_idx
  ON users (is_probation, probation_until)
  WHERE is_probation = true;

-- ── Replace users history-capture trigger functions with explicit columns
-- (See 0098 / 0100 / 0101 — generic positional INSERT into users_history breaks
-- when column order drifts; we use explicit-list functions per the same pattern.)

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_users()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users_history (
    id,
    name,
    email,
    password_hash,
    role,
    role_template_id,
    scope_global,
    scope_org_wide_head,
    scope_team_supervisor,
    status,
    capacity,
    logistics_location_id,
    phone,
    visible_order_statuses,
    restrict_product_access,
    commission_plan_id,
    last_action_at,
    primary_branch_id,
    app_theme,
    font_scale,
    payout_bank_name,
    payout_account_name,
    payout_account_number,
    payout_bank_code,
    notification_preferences,
    login_count,
    last_login_at,
    is_probation,
    probation_started_at,
    probation_started_by,
    probation_until,
    terminated_at,
    terminated_by,
    original_role,
    valid_from,
    valid_to,
    modified_by,
    created_at,
    updated_at
  ) SELECT
    NEW.id,
    NEW.name,
    NEW.email,
    NEW.password_hash,
    NEW.role,
    NEW.role_template_id,
    NEW.scope_global,
    NEW.scope_org_wide_head,
    NEW.scope_team_supervisor,
    NEW.status,
    NEW.capacity,
    NEW.logistics_location_id,
    NEW.phone,
    NEW.visible_order_statuses,
    NEW.restrict_product_access,
    NEW.commission_plan_id,
    NEW.last_action_at,
    NEW.primary_branch_id,
    NEW.app_theme,
    NEW.font_scale,
    NEW.payout_bank_name,
    NEW.payout_account_name,
    NEW.payout_account_number,
    NEW.payout_bank_code,
    NEW.notification_preferences,
    NEW.login_count,
    NEW.last_login_at,
    NEW.is_probation,
    NEW.probation_started_at,
    NEW.probation_started_by,
    NEW.probation_until,
    NEW.terminated_at,
    NEW.terminated_by,
    NEW.original_role,
    NEW.valid_from,
    NEW.valid_to,
    NEW.modified_by,
    NEW.created_at,
    NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION yannis_capture_history_users()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO users_history (
    id,
    name,
    email,
    password_hash,
    role,
    role_template_id,
    scope_global,
    scope_org_wide_head,
    scope_team_supervisor,
    status,
    capacity,
    logistics_location_id,
    phone,
    visible_order_statuses,
    restrict_product_access,
    commission_plan_id,
    last_action_at,
    primary_branch_id,
    app_theme,
    font_scale,
    payout_bank_name,
    payout_account_name,
    payout_account_number,
    payout_bank_code,
    notification_preferences,
    login_count,
    last_login_at,
    is_probation,
    probation_started_at,
    probation_started_by,
    probation_until,
    terminated_at,
    terminated_by,
    original_role,
    valid_from,
    valid_to,
    modified_by,
    created_at,
    updated_at
  ) SELECT
    OLD.id,
    OLD.name,
    OLD.email,
    OLD.password_hash,
    OLD.role,
    OLD.role_template_id,
    OLD.scope_global,
    OLD.scope_org_wide_head,
    OLD.scope_team_supervisor,
    OLD.status,
    OLD.capacity,
    OLD.logistics_location_id,
    OLD.phone,
    OLD.visible_order_statuses,
    OLD.restrict_product_access,
    OLD.commission_plan_id,
    OLD.last_action_at,
    OLD.primary_branch_id,
    OLD.app_theme,
    OLD.font_scale,
    OLD.payout_bank_name,
    OLD.payout_account_name,
    OLD.payout_account_number,
    OLD.payout_bank_code,
    OLD.notification_preferences,
    OLD.login_count,
    OLD.last_login_at,
    OLD.is_probation,
    OLD.probation_started_at,
    OLD.probation_started_by,
    OLD.probation_until,
    OLD.terminated_at,
    OLD.terminated_by,
    OLD.original_role,
    OLD.valid_from,
    now(),
    OLD.modified_by,
    OLD.created_at,
    OLD.updated_at;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── probation_terminations: permanent record of every termination act ──
-- Append-only ledger. Survives even after the user's PII is scrubbed.
-- Distinct from users_history (which IS PII-scrubbable on termination).
CREATE TABLE IF NOT EXISTS probation_terminations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  terminated_at timestamptz NOT NULL DEFAULT now(),
  terminated_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  original_role user_role NOT NULL,
  original_branch_id uuid,
  blockers_resolved jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS probation_terminations_user_id_idx
  ON probation_terminations (user_id);
CREATE INDEX IF NOT EXISTS probation_terminations_terminated_at_idx
  ON probation_terminations (terminated_at DESC);
CREATE INDEX IF NOT EXISTS probation_terminations_terminated_by_idx
  ON probation_terminations (terminated_by);
