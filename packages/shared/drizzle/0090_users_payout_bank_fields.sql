ALTER TABLE users
  ADD COLUMN IF NOT EXISTS payout_bank_name text,
  ADD COLUMN IF NOT EXISTS payout_account_name text,
  ADD COLUMN IF NOT EXISTS payout_account_number text;

ALTER TABLE users_history
  ADD COLUMN IF NOT EXISTS payout_bank_name text,
  ADD COLUMN IF NOT EXISTS payout_account_name text,
  ADD COLUMN IF NOT EXISTS payout_account_number text;
