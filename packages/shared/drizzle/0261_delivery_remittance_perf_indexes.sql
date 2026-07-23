-- 0261: Performance indexes for the Cash Remittances page
-- Addresses slow stat strip + listing queries on the delivery remittances flow.

-- 1. delivery_remittances.sent_at — heavily used for date-range filtering and
--    ORDER BY on the batch list. No index existed.
CREATE INDEX IF NOT EXISTS idx_delivery_remittances_sent_at
  ON delivery_remittances (sent_at DESC);

-- 2. Composite index on orders for the "awaiting remittance" anti-join pattern:
--    WHERE status = 'DELIVERED' AND deleted_at IS NULL
--    + NOT EXISTS (SELECT 1 FROM delivery_remittance_orders WHERE order_id = orders.id)
--    The status + deleted_at partial index accelerates the base scan.
CREATE INDEX IF NOT EXISTS idx_orders_delivered_not_deleted
  ON orders (id)
  WHERE status = 'DELIVERED' AND deleted_at IS NULL;

-- 3. Composite on delivery_remittances for the summary aggregation path:
--    JOIN delivery_remittance_orders + JOIN orders, scoped by location + status.
CREATE INDEX IF NOT EXISTS idx_delivery_remittances_location_status
  ON delivery_remittances (logistics_location_id, status);
