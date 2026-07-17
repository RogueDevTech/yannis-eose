-- ============================================
-- Landed cost component breakdown on shipments
-- ============================================
-- Decomposes the existing lump `total_landing_cost` into four auditable
-- components. The sum of the four equals `total_landing_cost` (enforced at
-- the application layer on VERIFY, not via CHECK constraint, to allow
-- partial entry during CREATED/IN_TRANSIT stages).
--
-- Components:
--   purchase_price_total   — total purchase price for the batch (factory invoice)
--   inbound_logistics_cost — freight / shipping to warehouse
--   offloading_cost        — offloading & handling at destination
--   import_duties          — customs / import duties

-- ── Add columns to shipments ─────────────────────────────────
ALTER TABLE shipments
  ADD COLUMN IF NOT EXISTS purchase_price_total   numeric(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_logistics_cost numeric(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offloading_cost        numeric(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_duties          numeric(20,4) DEFAULT 0;

-- ── Sync shipments_history ───────────────────────────────────
ALTER TABLE shipments_history
  ADD COLUMN IF NOT EXISTS purchase_price_total   numeric(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_logistics_cost numeric(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offloading_cost        numeric(20,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS import_duties          numeric(20,4) DEFAULT 0;

-- ── Rebuild the explicit-cast INSERT trigger ─────────────────
-- Must include the new numeric columns with ::numeric casts.
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_shipments()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO shipments_history (
    id, reference_number, label, status,
    destination_location_id, supplier_name, supplier_reference,
    expected_arrival_at, arrived_at, verified_at, closed_at, cancelled_at,
    total_landing_cost,
    purchase_price_total, inbound_logistics_cost, offloading_cost, import_duties,
    cancelled_reason,
    verified_by, closed_by, cancelled_by, notes,
    valid_from, valid_to, modified_by,
    created_at, updated_at
  ) SELECT
    NEW.id, NEW.reference_number, NEW.label, NEW.status,
    NEW.destination_location_id, NEW.supplier_name, NEW.supplier_reference,
    NEW.expected_arrival_at, NEW.arrived_at, NEW.verified_at, NEW.closed_at, NEW.cancelled_at,
    (NEW.total_landing_cost)::numeric,
    (NEW.purchase_price_total)::numeric, (NEW.inbound_logistics_cost)::numeric,
    (NEW.offloading_cost)::numeric, (NEW.import_duties)::numeric,
    NEW.cancelled_reason,
    NEW.verified_by, NEW.closed_by, NEW.cancelled_by, NEW.notes,
    NEW.valid_from, NEW.valid_to, NEW.modified_by,
    NEW.created_at, NEW.updated_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
