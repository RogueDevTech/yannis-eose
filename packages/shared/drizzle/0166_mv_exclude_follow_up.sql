-- Recreate materialized views to exclude follow-up orders from pipeline and profit metrics.
-- Follow-up orders have their own isolated stats on the Follow Up page.

DROP MATERIALIZED VIEW IF EXISTS mv_profit_summary;
CREATE MATERIALIZED VIEW mv_profit_summary AS
SELECT
  COALESCE(SUM(CAST(total_amount AS numeric)), 0) AS revenue,
  COALESCE(SUM(CAST(landed_cost AS numeric)), 0) AS landed_cost,
  COALESCE(SUM(CAST(delivery_fee AS numeric)), 0) AS delivery_fee,
  COUNT(*)::integer AS order_count,
  DATE_TRUNC('day', delivered_at) AS delivery_date
FROM orders
WHERE status IN ('DELIVERED', 'REMITTED') AND delivered_at IS NOT NULL AND is_follow_up = false
GROUP BY DATE_TRUNC('day', delivered_at)
WITH DATA;
CREATE UNIQUE INDEX uq_mv_profit_summary ON mv_profit_summary (delivery_date);

DROP MATERIALIZED VIEW IF EXISTS mv_order_pipeline;
CREATE MATERIALIZED VIEW mv_order_pipeline AS
SELECT
  status,
  COUNT(*)::integer AS order_count,
  COALESCE(SUM(CAST(total_amount AS numeric)), 0) AS total_amount
FROM orders
WHERE is_follow_up = false
GROUP BY status
WITH DATA;
CREATE UNIQUE INDEX uq_mv_order_pipeline ON mv_order_pipeline (status);
