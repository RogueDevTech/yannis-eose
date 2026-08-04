-- Migration 0292: Grant HR_MANAGER the payroll.run.disburse permission.
--
-- HR must be able to COMPLETE the payroll process end-to-end: run the bank-pay
-- export (bank-upload file) and mark a batch Paid. Both endpoints
-- (hr.exportBankUpload, hr.markBatchPaid) were gated on finance.disburse only,
-- so HR couldn't finish payroll without a Finance handoff.
--
-- We deliberately grant the NARROWER, payroll-scoped `payroll.run.disburse`
-- (not finance.disburse): the payroll endpoints now accept EITHER key, so HR
-- gains bank-export + mark-paid WITHOUT the finance.disburse side effects
-- (funding-request approvals, the finance disbursements page). FINANCE_OFFICER
-- already holds both keys, so Finance access is unchanged.
--
-- The `payroll.run.disburse` permission code already exists in the catalog
-- (seeded on boot); this migration only adds the HR_MANAGER grant.
--
-- PURELY ADDITIVE — every INSERT is guarded by ON CONFLICT DO NOTHING or a
-- NOT EXISTS check. Never UPDATEs or DELETEs an existing row, so any custom
-- per-user grant is left exactly as it was.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Grant via role_permissions (role -> permission).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_permissions (role, permission_id)
SELECT 'HR_MANAGER'::user_role, p.id
FROM permissions p
WHERE p.code = 'payroll.run.disburse'
ON CONFLICT (role, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Grant via SYSTEM role_template_permissions, so HR_MANAGER users on the
--    standard template pick the code up through the template path too.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO role_template_permissions (role_template_id, permission_id)
SELECT rt.id, p.id
FROM role_templates rt
CROSS JOIN permissions p
WHERE rt.kind = 'SYSTEM'
  AND rt.mapped_role = 'HR_MANAGER'::user_role
  AND p.code = 'payroll.run.disburse'
ON CONFLICT (role_template_id, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Backfill user_permissions for ACTIVE HR_MANAGER users so the grant is
--    visible immediately on the next session refresh (the session builder reads
--    the per-user snapshot directly), without waiting for the boot seed runner
--    to re-derive it. INSERT-only, NOT EXISTS-guarded.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO user_permissions (id, user_id, permission_id, granted, granted_by, created_at, valid_from)
SELECT
  gen_random_uuid(),
  u.id,
  p.id,
  true,
  NULL,
  now(),
  now()
FROM users u
CROSS JOIN permissions p
WHERE u.role = 'HR_MANAGER'
  AND u.status = 'ACTIVE'
  AND p.code = 'payroll.run.disburse'
  AND NOT EXISTS (
    SELECT 1 FROM user_permissions up
    WHERE up.user_id = u.id
      AND up.permission_id = p.id
      AND up.valid_to IS NULL
  );
