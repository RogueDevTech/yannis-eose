-- 0098 fixed AFTER INSERT (capture_history_insert). UPDATE/DELETE still used the generic
-- `yannis_capture_history()` → `INSERT INTO users_history SELECT ($1).*`, which maps OLD.*
-- **positionally** into users_history. Any column-order drift → wrong types
-- (e.g. "login_count is integer but expression is uuid").
--
-- Mirror products/orders: explicit column list for the archived row (OLD), with valid_to = now().

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
    OLD.is_finance_officer,
    OLD.notification_preferences,
    OLD.login_count,
    OLD.last_login_at,
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

DROP TRIGGER IF EXISTS trg_users_capture_history ON users;
CREATE TRIGGER trg_users_capture_history
  BEFORE UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_users();
