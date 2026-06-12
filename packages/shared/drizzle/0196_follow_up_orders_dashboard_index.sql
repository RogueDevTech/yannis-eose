-- Composite index for dashboard status-count queries on follow_up_orders.
-- Covers: WHERE deleted_at IS NULL [AND created_at BETWEEN ...] GROUP BY status
-- Note: removed CONCURRENTLY — auto-run migrations execute inside a transaction.
CREATE INDEX IF NOT EXISTS idx_follow_up_orders_dashboard
  ON follow_up_orders (status, created_at)
  WHERE deleted_at IS NULL;
