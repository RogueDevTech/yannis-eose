-- 0278: Sync user earnings to assigned pay-role formulas
--
-- One-time restamp only: active users with a pay_role_id switch to
-- FORMULA_BASED and clear flat_monthly_amount so profile/earnings follow
-- Payroll Config. Pay role setup and staff assignment stay HR-configured
-- (no seeded Media Buyer / branch mapping).

UPDATE users
SET
  salary_basis = 'FORMULA_BASED',
  flat_monthly_amount = NULL,
  updated_at = now()
WHERE pay_role_id IS NOT NULL
  AND status = 'ACTIVE'
  AND (
    salary_basis IS DISTINCT FROM 'FORMULA_BASED'
    OR flat_monthly_amount IS NOT NULL
  );
