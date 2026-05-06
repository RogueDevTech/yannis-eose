-- Backfill legacy manual INTAKE batches into Shipments (2026-05).
--
-- Goal: “lock” current stock so every remaining FIFO batch is attributable to a Shipment.
-- We do this by creating VERIFIED shipments and shipment_lines that point at existing
-- `stock_batches` created via the legacy `inventory.intake()` path.
--
-- Definition of "legacy intake batch" (for backfill):
--  - Has a stock_movements row with movement_type = 'INTAKE'
--  - That INTAKE references the batch directly: stock_movements.reference_id = stock_batches.id
--  - AND the batch is not already linked to a shipment line: NOT EXISTS shipment_lines.batch_id = stock_batches.id
--
-- Notes:
--  - We intentionally do NOT create warehouse→3PL transfer movements here. This backfill
--    only attaches shipment provenance to the existing on-hand stock so the UI can show
--    a shipment tag and filter by shipment.
--  - We set shipments.status = 'VERIFIED' to reflect that inventory is already on hand.
--  - We allocate landing cost = 0 for backfilled rows; factory_cost is sourced from the batch.
--  - Idempotent: safe to run multiple times; only inserts for batches not yet linked.

DO $$
DECLARE
  _now timestamptz := now();
BEGIN
  -- 1) Create one VERIFIED shipment per destination location that has legacy intake batches.
  WITH legacy_intake_locations AS (
    SELECT DISTINCT sm.to_location_id AS destination_location_id
    FROM stock_movements sm
    JOIN stock_batches sb ON sb.id = sm.reference_id
    WHERE sm.movement_type = 'INTAKE'
      AND sm.to_location_id IS NOT NULL
      AND sb.remaining_quantity > 0
      AND NOT EXISTS (SELECT 1 FROM shipment_lines sl WHERE sl.batch_id = sb.id)
  )
  INSERT INTO shipments (
    id,
    label,
    status,
    destination_location_id,
    supplier_name,
    supplier_reference,
    expected_arrival_at,
    arrived_at,
    verified_at,
    notes,
    total_landing_cost,
    created_at,
    updated_at,
    valid_from,
    valid_to,
    modified_by
  )
  SELECT
    gen_random_uuid(),
    'Legacy intake backfill',
    'VERIFIED',
    l.destination_location_id,
    'Legacy intake',
    'BACKFILL',
    NULL,
    _now,
    _now,
    'Auto-created to attach shipment provenance to legacy intake FIFO batches.',
    0,
    _now,
    _now,
    _now,
    NULL,
    'System'
  FROM legacy_intake_locations l
  WHERE NOT EXISTS (
    SELECT 1 FROM shipments s
    WHERE s.destination_location_id = l.destination_location_id
      AND s.label = 'Legacy intake backfill'
      AND s.status = 'VERIFIED'
  );

  -- 2) Insert shipment lines for each legacy intake batch (remaining > 0) at that destination.
  WITH legacy_batches AS (
    SELECT DISTINCT ON (sb.id)
      sb.id                     AS batch_id,
      sb.product_id             AS product_id,
      sb.quantity               AS quantity,
      sb.factory_cost           AS factory_cost,
      sm.to_location_id         AS destination_location_id
    FROM stock_movements sm
    JOIN stock_batches sb ON sb.id = sm.reference_id
    WHERE sm.movement_type = 'INTAKE'
      AND sm.to_location_id IS NOT NULL
      AND sb.remaining_quantity > 0
      AND NOT EXISTS (SELECT 1 FROM shipment_lines sl WHERE sl.batch_id = sb.id)
    ORDER BY sb.id, sm.created_at DESC
  ),
  target_shipments AS (
    SELECT s.id, s.destination_location_id
    FROM shipments s
    WHERE s.label = 'Legacy intake backfill'
      AND s.status = 'VERIFIED'
  )
  INSERT INTO shipment_lines (
    id,
    shipment_id,
    product_id,
    expected_quantity,
    received_quantity,
    factory_cost,
    allocated_landing_cost,
    batch_id,
    variance_reason,
    created_at,
    updated_at,
    valid_from,
    valid_to,
    modified_by
  )
  SELECT
    gen_random_uuid(),
    s.id,
    b.product_id,
    b.quantity,
    b.quantity,
    b.factory_cost,
    0,
    b.batch_id,
    'Backfilled from legacy manual intake',
    _now,
    _now,
    _now,
    NULL,
    'System'
  FROM legacy_batches b
  JOIN target_shipments s
    ON s.destination_location_id = b.destination_location_id;
END $$;

