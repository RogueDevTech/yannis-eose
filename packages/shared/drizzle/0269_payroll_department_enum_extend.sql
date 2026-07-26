-- Extend payroll_department enum with Operations, Finance, Support
ALTER TYPE payroll_department ADD VALUE IF NOT EXISTS 'OPERATIONS';
ALTER TYPE payroll_department ADD VALUE IF NOT EXISTS 'FINANCE';
ALTER TYPE payroll_department ADD VALUE IF NOT EXISTS 'SUPPORT';
