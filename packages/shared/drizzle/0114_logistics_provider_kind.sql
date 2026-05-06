-- Discriminator on logistics_providers so company-owned warehouses are cleanly
-- separable from external 3PL partners.
--   THIRD_PARTY — partner logistics company (existing rows; default)
--   WAREHOUSE   — company-owned warehouse (listed on /admin/inventory/warehouses)
--
-- The /admin/logistics/partners page filters to THIRD_PARTY, the new Warehouses
-- page filters to WAREHOUSE, and the inbound shipment destination dropdown
-- filters to WAREHOUSE-kind locations only — shipments land at our warehouses,
-- not at 3PL partners.

ALTER TABLE logistics_providers
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'THIRD_PARTY';

ALTER TABLE logistics_providers_history
  ADD COLUMN IF NOT EXISTS kind text;

DO $$ BEGIN
  ALTER TABLE logistics_providers
    ADD CONSTRAINT logistics_providers_kind_check
    CHECK (kind IN ('THIRD_PARTY', 'WAREHOUSE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS logistics_providers_kind_idx
  ON logistics_providers (kind);
