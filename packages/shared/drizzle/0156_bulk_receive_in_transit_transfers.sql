-- Migration 0156: Bulk-receive all IN_TRANSIT stock transfers
-- CEO directive 2026-05-25: Stock Manager transfers now go straight to RECEIVED.
-- This migration retroactively completes all existing IN_TRANSIT transfers,
-- adds stock to destination locations, writes TRANSFER_IN movements, and
-- creates settlement outcome rows.

-- Step 1a: Update existing destination inventory_levels rows
UPDATE inventory_levels il
SET
  stock_count = il.stock_count + sub.total_qty,
  updated_at = now()
FROM (
  SELECT product_id, to_location_id, SUM(quantity_sent) AS total_qty
  FROM stock_transfers
  WHERE transfer_status = 'IN_TRANSIT'
  GROUP BY product_id, to_location_id
) sub
WHERE il.product_id = sub.product_id
  AND il.location_id = sub.to_location_id;

-- Step 1b: Insert new inventory_levels rows for destinations that don't exist yet
INSERT INTO inventory_levels (id, product_id, location_id, stock_count, reserved_count, status)
SELECT
  gen_random_uuid(),
  sub.product_id,
  sub.to_location_id,
  sub.total_qty,
  0,
  'AVAILABLE'
FROM (
  SELECT product_id, to_location_id, SUM(quantity_sent) AS total_qty
  FROM stock_transfers
  WHERE transfer_status = 'IN_TRANSIT'
  GROUP BY product_id, to_location_id
) sub
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_levels il
  WHERE il.product_id = sub.product_id
    AND il.location_id = sub.to_location_id
);

-- Step 2: Write TRANSFER_IN movement rows for audit trail
INSERT INTO stock_movements (id, product_id, movement_type, quantity, from_location_id, to_location_id, reference_id, actor_id, created_at)
SELECT
  gen_random_uuid(),
  t.product_id,
  'TRANSFER_IN',
  t.quantity_sent,
  t.from_location_id,
  t.to_location_id,
  t.id,
  t.initiated_by,
  now()
FROM stock_transfers t
WHERE t.transfer_status = 'IN_TRANSIT';

-- Step 3: Write settlement outcome rows
INSERT INTO stock_transfer_outcomes (id, transfer_id, status, quantity, recorded_by, recorded_at)
SELECT
  gen_random_uuid(),
  t.id,
  'APPROVED',
  t.quantity_sent,
  t.initiated_by,
  now()
FROM stock_transfers t
WHERE t.transfer_status = 'IN_TRANSIT';

-- Step 4: Mark all IN_TRANSIT transfers as RECEIVED
UPDATE stock_transfers
SET
  transfer_status = 'RECEIVED',
  quantity_received = quantity_sent,
  verified_at = now()
WHERE transfer_status = 'IN_TRANSIT';
