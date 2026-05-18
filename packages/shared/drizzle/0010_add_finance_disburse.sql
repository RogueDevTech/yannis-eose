-- Add finance.disburse permission for tier-1 disbursement (SA/FO → HoM)
INSERT INTO permissions (id, code, resource, action, description)
VALUES (gen_random_uuid(), 'finance.disburse', 'finance', 'disburse', 'Disburse funds to Head of Marketing')
ON CONFLICT (code) DO NOTHING;

-- Assign to FINANCE_OFFICER (SuperAdmin bypasses all checks)
INSERT INTO role_permissions (role, permission_id)
SELECT 'FINANCE_OFFICER'::user_role, id FROM permissions WHERE code = 'finance.disburse'
ON CONFLICT (role, permission_id) DO NOTHING;
