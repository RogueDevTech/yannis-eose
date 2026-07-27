-- Flat monthly amount for users on FLAT_RATE salary basis (payroll profile).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS flat_monthly_amount numeric(14, 2);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users_history'
  ) THEN
    ALTER TABLE users_history
      ADD COLUMN IF NOT EXISTS flat_monthly_amount numeric(14, 2);
  END IF;
END $$;
