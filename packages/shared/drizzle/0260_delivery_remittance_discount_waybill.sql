-- 0260: Add discount and waybill_cost columns to delivery_remittances
-- These deduction fields were added to the UI and validator but the
-- corresponding DB columns were missing.

ALTER TABLE delivery_remittances
  ADD COLUMN IF NOT EXISTS discount numeric(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waybill_cost numeric(12,2) DEFAULT 0;

-- Sync history table (may not exist on all environments)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'delivery_remittances_history') THEN
    ALTER TABLE delivery_remittances_history
      ADD COLUMN IF NOT EXISTS discount numeric(12,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS waybill_cost numeric(12,2) DEFAULT 0;
  END IF;
END $$;
