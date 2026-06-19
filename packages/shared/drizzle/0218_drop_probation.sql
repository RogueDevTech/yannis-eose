-- Migration 0218: Remove probation system
-- CEO directive 2026-06-19: probation feature removed entirely.
-- Drops probation columns from users + users_history, drops probation_terminations table,
-- and updates the history trigger to stop capturing probation columns.

-- 1. Drop the probation index
DROP INDEX IF EXISTS users_probation_until_idx;

-- 2. Drop probation columns from users
ALTER TABLE users
  DROP COLUMN IF EXISTS is_probation,
  DROP COLUMN IF EXISTS probation_started_at,
  DROP COLUMN IF EXISTS probation_started_by,
  DROP COLUMN IF EXISTS probation_until,
  DROP COLUMN IF EXISTS terminated_at,
  DROP COLUMN IF EXISTS terminated_by,
  DROP COLUMN IF EXISTS original_role;

-- 3. Drop probation columns from users_history
ALTER TABLE users_history
  DROP COLUMN IF EXISTS is_probation,
  DROP COLUMN IF EXISTS probation_started_at,
  DROP COLUMN IF EXISTS probation_started_by,
  DROP COLUMN IF EXISTS probation_until,
  DROP COLUMN IF EXISTS terminated_at,
  DROP COLUMN IF EXISTS terminated_by,
  DROP COLUMN IF EXISTS original_role;

-- 4. Drop probation_terminations table
DROP TABLE IF EXISTS probation_terminations;

-- 5. Rebuild the users_history trigger functions to exclude dropped columns.
-- Based on 0139 trigger definitions, minus probation columns.

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
