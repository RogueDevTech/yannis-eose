-- 0163_mv_profit_summary_include_remitted.sql
-- Recreate mv_profit_summary so revenue includes REMITTED orders, not just
-- DELIVERED. Once the accountant marks remittance received, an order's status
-- flips DELIVERED→REMITTED — its revenue and costs are unchanged but the old
-- MV definition excluded those rows, undercounting revenue and order_count on
-- every profit report.

DROP MATERIALIZED VIEW IF EXISTS mv_profit_summary CASCADE;

CREATE MATERIALIZED VIEW mv_profit_summary AS
SELECT
  COALESCE(SUM(CAST(total_amount AS numeric)), 0) AS revenue,
  COALESCE(SUM(CAST(landed_cost AS numeric)), 0) AS landed_cost,
  COALESCE(SUM(CAST(delivery_fee AS numeric)), 0) AS delivery_fee,
  COUNT(*)::integer AS order_count,
  DATE_TRUNC('day', delivered_at) AS delivery_date
FROM orders
WHERE status IN ('DELIVERED', 'REMITTED') AND delivered_at IS NOT NULL
GROUP BY DATE_TRUNC('day', delivered_at)
WITH DATA;

-- Match the unique index the boot-time index sweep expects so
-- REFRESH MATERIALIZED VIEW CONCURRENTLY keeps working.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_profit_summary_date
  ON mv_profit_summary(delivery_date);
