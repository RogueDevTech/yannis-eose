-- Add ACCOUNTANT to the user_role enum.
-- Bookkeeping role: full accounting.* (chart of accounts, journals, GL,
-- reports) plus read context, but no money movement (approve/disburse/
-- cash-remittance). Separated from FINANCE_OFFICER's operational finance hat.
-- Role -> permission grants are seeded from the RBAC catalog on boot.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
