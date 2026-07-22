-- 005: Add missing indexes for delivery remittance queries.
-- The junction table delivery_remittance_orders is joined on delivery_remittance_id
-- in every summary query but had no index (only order_id has a unique constraint).
-- The outcomes table is similarly joined without an index.

CREATE INDEX IF NOT EXISTS idx_dro_remittance_id
  ON delivery_remittance_orders (delivery_remittance_id);

CREATE INDEX IF NOT EXISTS idx_dro_order_id
  ON delivery_remittance_orders (order_id);

CREATE INDEX IF NOT EXISTS idx_delivery_remittance_outcomes_remittance_id
  ON delivery_remittance_outcomes (delivery_remittance_id);

CREATE INDEX IF NOT EXISTS idx_delivery_remittance_outcomes_status
  ON delivery_remittance_outcomes (status);

-- Awaiting query: orders.status = 'DELIVERED' AND deleted_at IS NULL AND NOT EXISTS (dro)
-- This partial index covers exactly that scan.
CREATE INDEX IF NOT EXISTS idx_orders_delivered_not_deleted
  ON orders (status, deleted_at)
  WHERE status = 'DELIVERED' AND deleted_at IS NULL;

-- Batch list + summary: filter/sort by sent_at, status, location
CREATE INDEX IF NOT EXISTS idx_delivery_remittances_sent_at
  ON delivery_remittances (sent_at);

CREATE INDEX IF NOT EXISTS idx_delivery_remittances_status
  ON delivery_remittances (status);

CREATE INDEX IF NOT EXISTS idx_delivery_remittances_location_id
  ON delivery_remittances (logistics_location_id);

-- Orders servicing branch for awaiting query branch scoping
CREATE INDEX IF NOT EXISTS idx_orders_servicing_branch_delivered
  ON orders (servicing_branch_id)
  WHERE status IN ('DELIVERED', 'REMITTED') AND deleted_at IS NULL;

-- New deduction columns: discount and waybill cost
ALTER TABLE delivery_remittances
  ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS waybill_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
