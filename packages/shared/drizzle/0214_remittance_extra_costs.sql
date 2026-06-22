-- Add commitment fee, POS fee, and failed delivery cost columns to delivery_remittances.
-- These are remittance-level deductions (not per-order) recorded at creation time.

ALTER TABLE delivery_remittances
  ADD COLUMN IF NOT EXISTS commitment_fee numeric(12, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS pos_fee numeric(12, 2) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS failed_delivery_cost numeric(12, 2) DEFAULT '0' NOT NULL;
