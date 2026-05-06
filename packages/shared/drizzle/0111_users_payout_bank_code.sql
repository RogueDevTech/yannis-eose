-- Add payout_bank_code so the staff onboarding flow can capture the bank's
-- routing/sort code alongside the bank name + account name + account number
-- (added in 0090). Surfaced on /admin/finance/staff-accounts and used by
-- finance payout exports.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payout_bank_code text;

ALTER TABLE users_history
  ADD COLUMN IF NOT EXISTS payout_bank_code text;
