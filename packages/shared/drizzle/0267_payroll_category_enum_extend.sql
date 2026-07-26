-- Extend pay role category enum with per-role values (maps 1:1 to user_role)
-- so HR can assign payroll rules to specific system roles like HEAD_OF_MARKETING.
-- Legacy department-level values (CS, MEDIA_BUYING, etc.) remain valid for existing rows.

ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'HR_ADMIN';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'STOCK_MANAGEMENT';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'ADMIN';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'BRANCH_ADMIN';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'HEAD_OF_MARKETING';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'MEDIA_BUYER';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'HEAD_OF_CS';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'CS_CLOSER';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'FINANCE_OFFICER';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'HEAD_OF_LOGISTICS';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'STOCK_MANAGER';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'TPL_MANAGER';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'TPL_RIDER';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'HR_MANAGER';
ALTER TYPE payroll_pay_role_category ADD VALUE IF NOT EXISTS 'AUDITOR';
