-- ============================================
-- Team supervisor user-level flag (CEO directive 2026-05-10)
-- ============================================
-- Marketing / CS team supervisors are currently identified by joining on
-- `branch_team_members.is_supervisor = true`. That works for the per-branch
-- session capability flag (`isMarketingTeamSupervisorOnActiveBranch`) but it
-- means anywhere we want to *display* "this user is a supervisor anywhere"
-- (UserDetail, Staff Accounts list/filter, header chip) we'd have to JOIN.
--
-- Add a denormalised `users.is_team_supervisor` boolean — surface it as a
-- pill/filter, kept in sync by `BranchTeamsService` whenever supervisor
-- membership is granted/revoked. Source of truth stays the team-membership
-- rows; this column is derived state, not an independent grant.
--
-- Eligibility: same as today — any user who holds an `is_supervisor=true`
-- row in `branch_team_members`. No admin role is supervisor here (admin/HoM
-- power comes from role, not from being marked supervisor on a team).

-- ── Columns on users (mirrored to users_history) ──────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_team_supervisor boolean NOT NULL DEFAULT false;

ALTER TABLE users_history
  ADD COLUMN IF NOT EXISTS is_team_supervisor boolean;

-- ── Backfill from existing branch_team_members rows ─────────────────
-- Every user who currently holds at least one supervisor row gets the flag
-- flipped on. Rest stay false.
UPDATE users
SET is_team_supervisor = true
WHERE id IN (
  SELECT DISTINCT user_id
  FROM branch_team_members
  WHERE is_supervisor = true
);

-- Filter index for "show me all supervisors" queries on Staff Accounts.
CREATE INDEX IF NOT EXISTS users_is_team_supervisor_idx
  ON users (is_team_supervisor)
  WHERE is_team_supervisor = true;

-- ── Replace users history-capture trigger functions ──────────────────
-- Same explicit-list pattern as 0126 (probation): generic positional INSERT
-- breaks when column order drifts. Adding `is_team_supervisor` to the column
-- list keeps history rows complete on every insert/update.

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
    is_team_supervisor,
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
    NEW.is_team_supervisor,
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
    is_team_supervisor,
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
    OLD.is_team_supervisor,
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
