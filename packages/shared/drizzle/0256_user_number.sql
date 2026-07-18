-- Migration 0256: Sequential user number (USR-1, USR-2, ...)
-- Adds a human-friendly auto-increment identifier to users, backfilled
-- in creation order so the earliest user gets USR-1.

-- 1. Add serial column
ALTER TABLE users ADD COLUMN user_number serial;

-- 2. Backfill in creation order
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) AS rn
  FROM users
)
UPDATE users SET user_number = numbered.rn FROM numbered WHERE users.id = numbered.id;

-- 3. Reset sequence to max + 1
SELECT setval(pg_get_serial_sequence('users', 'user_number'), COALESCE((SELECT MAX(user_number) FROM users), 0) + 1, false);

-- 4. Unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_number ON users (user_number);

-- 5. Mirror column to users_history
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS user_number integer;

-- 6. Rebuild history trigger functions to include user_number

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
    user_number,
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
    NEW.user_number,
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
    user_number,
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
    OLD.user_number,
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
