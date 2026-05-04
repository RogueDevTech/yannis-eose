-- 0093 added permission-first columns to `users` only. The generic
-- `yannis_capture_history_insert` does `INSERT INTO users_history SELECT ($1).*`,
-- which requires identical column sets *and* identical physical column order.
-- Missing history columns → "INSERT has more expressions than target columns".
--
-- Fix: mirror the known gap on users_history, then use an explicit insert trigger
-- (same pattern as products / orders) so future column-order drift cannot break audit.

ALTER TABLE users_history ADD COLUMN IF NOT EXISTS role_template_id uuid;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS scope_global boolean;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS scope_org_wide_head boolean;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS scope_team_supervisor boolean;

-- Older DBs sometimes added these on `users` without mirroring `users_history`.
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS logistics_location_id uuid;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS visible_order_statuses jsonb;
ALTER TABLE users_history ADD COLUMN IF NOT EXISTS commission_plan_id uuid;

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
    is_finance_officer,
    notification_preferences,
    login_count,
    last_login_at,
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
    NEW.is_finance_officer,
    NEW.notification_preferences,
    NEW.login_count,
    NEW.last_login_at,
    NEW.valid_from,
    NEW.valid_to,
    NEW.modified_by,
    NEW.created_at,
    NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_capture_history_insert ON users;
CREATE TRIGGER trg_users_capture_history_insert
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_users();
