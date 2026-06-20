-- Recreate mv_order_pipeline to exclude offline orders so the Marketing Order
-- Funnel on the SuperAdmin dashboard matches the Marketing Orders page exactly.
-- Offline orders belong to CS/Sales metrics only (CEO directive 2026-06-05).

DROP MATERIALIZED VIEW IF EXISTS mv_order_pipeline;
CREATE MATERIALIZED VIEW mv_order_pipeline AS
SELECT
  status,
  COUNT(*)::integer AS order_count,
  COALESCE(SUM(CAST(total_amount AS numeric)), 0) AS total_amount
FROM orders
WHERE is_follow_up = false
  AND (order_source IS NULL OR order_source = 'edge-form')
GROUP BY status
WITH DATA;
CREATE UNIQUE INDEX uq_mv_order_pipeline ON mv_order_pipeline (status);
