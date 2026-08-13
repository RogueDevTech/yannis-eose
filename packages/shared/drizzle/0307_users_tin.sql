-- Migration 0307: Staff Tax Identification Number (TIN).
--
-- Adds users.tin for the PAYE remittance report to the Revenue Office (Track D#5).
--
-- users history is captured by EXPLICIT-COLUMN trigger functions
-- (yannis_capture_history_insert_users / yannis_capture_history_users, last
-- rebuilt at mig 0284). Adding a column to users + users_history is NOT enough —
-- the trigger functions list every column by name, so a new column is silently
-- dropped from history unless the functions are rebuilt. This migration rebuilds
-- BOTH with tin inserted (after bank_verification_status, matching schema order),
-- exactly as 0284 did for annual_rent/lifecycle.

-- 1. New column on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS tin text;

-- 2. Mirror onto users_history
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users_history'
  ) THEN
    ALTER TABLE users_history ADD COLUMN IF NOT EXISTS tin text;
  END IF;
END $$;

-- 3. Rebuild history trigger functions with the COMPLETE current column list
--    (tin added after bank_verification_status).

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
    exit_date, exit_reason, valid_from, valid_to, modified_by, created_at, updated_at
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
    NEW.exit_date, NEW.exit_reason, NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
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
    exit_date, exit_reason, valid_from, valid_to, modified_by, created_at, updated_at
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
    OLD.exit_date, OLD.exit_reason, OLD.valid_from, OLD.valid_to, OLD.modified_by,
    OLD.created_at, OLD.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
