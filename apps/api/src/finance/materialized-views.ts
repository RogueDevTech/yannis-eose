/**
 * Materialized Views for Finance Report Performance.
 *
 * These views pre-compute the expensive aggregations used by getProfitReport(),
 * reducing query time from O(n) per-report to O(1) reads.
 *
 * Views are refreshed on-demand (after order delivery, cost update) or periodically.
 */

/**
 * SQL to create the profit summary materialized view.
 * Aggregates: revenue, landed cost, delivery fee, order count from delivered orders.
 */
export const MV_PROFIT_SUMMARY = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS mv_profit_summary AS
  SELECT
    COALESCE(SUM(CAST(total_amount AS numeric)), 0) AS revenue,
    COALESCE(SUM(CAST(landed_cost AS numeric)), 0) AS landed_cost,
    COALESCE(SUM(CAST(delivery_fee AS numeric)), 0) AS delivery_fee,
    COUNT(*)::integer AS order_count,
    DATE_TRUNC('day', delivered_at) AS delivery_date
  FROM orders
  WHERE status IN ('DELIVERED', 'REMITTED') AND delivered_at IS NOT NULL AND is_follow_up = false
  GROUP BY DATE_TRUNC('day', delivered_at)
  WITH DATA
`;

/**
 * SQL to create the ad spend summary materialized view.
 * Only APPROVED ad spend counts toward profit/metrics.
 */
export const MV_AD_SPEND_SUMMARY = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS mv_ad_spend_summary AS
  SELECT
    COALESCE(SUM(CAST(spend_amount AS numeric)), 0) AS total_spend,
    spend_date,
    media_buyer_id,
    product_id
  FROM ad_spend_logs
  WHERE status = 'APPROVED'
  GROUP BY spend_date, media_buyer_id, product_id
  WITH DATA
`;

/**
 * SQL to create the order pipeline materialized view.
 * Pre-aggregated count by status for the funnel dashboard.
 */
export const MV_ORDER_PIPELINE = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS mv_order_pipeline AS
  SELECT
    status,
    COUNT(*)::integer AS order_count,
    COALESCE(SUM(CAST(total_amount AS numeric)), 0) AS total_amount
  FROM orders
  WHERE is_follow_up = false
  GROUP BY status
  WITH DATA
`;

/**
 * SQL to create the commission summary materialized view.
 */
export const MV_COMMISSION_SUMMARY = `
  CREATE MATERIALIZED VIEW IF NOT EXISTS mv_commission_summary AS
  SELECT
    COALESCE(SUM(CAST(total_payout AS numeric)), 0) AS total_commission,
    DATE_TRUNC('month', period_start) AS period_month
  FROM payout_records
  WHERE status IN ('APPROVED', 'PAID')
  GROUP BY DATE_TRUNC('month', period_start)
  WITH DATA
`;

/**
 * SQL to create unique indexes on the materialized views for fast refresh.
 *
 * Every MV needs a UNIQUE index for `REFRESH MATERIALIZED VIEW CONCURRENTLY`
 * to work; without it the refresh takes an `ACCESS EXCLUSIVE` lock and blocks
 * every reader for the whole refresh duration. `mv_ad_spend_summary` groups by
 * (spend_date, media_buyer_id, product_id) so that triple is its natural key.
 */
export const MV_INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_profit_summary_date ON mv_profit_summary (delivery_date)',
  'CREATE UNIQUE INDEX IF NOT EXISTS uq_mv_ad_spend_summary ON mv_ad_spend_summary (spend_date, media_buyer_id, product_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_order_pipeline_status ON mv_order_pipeline (status)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_commission_summary_month ON mv_commission_summary (period_month)',
];

/**
 * Refresh commands for each materialized view.
 * CONCURRENTLY allows reads during refresh (requires unique index — see MV_INDEXES).
 */
export const MV_REFRESH_COMMANDS = {
  profitSummary: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_profit_summary',
  adSpendSummary: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ad_spend_summary',
  orderPipeline: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_pipeline',
  commissionSummary: 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_commission_summary',
};

/**
 * Query to get the aggregated profit from materialized views.
 * Used as a fast alternative to getProfitReport when date range is not specified.
 */
export const MV_FAST_PROFIT_QUERY = `
  SELECT
    COALESCE(SUM(revenue), 0) AS revenue,
    COALESCE(SUM(landed_cost), 0) AS landed_cost,
    COALESCE(SUM(delivery_fee), 0) AS delivery_fee,
    COALESCE(SUM(order_count), 0) AS order_count
  FROM mv_profit_summary
`;

export const MV_FAST_PROFIT_QUERY_WITH_DATES = `
  SELECT
    COALESCE(SUM(revenue), 0) AS revenue,
    COALESCE(SUM(landed_cost), 0) AS landed_cost,
    COALESCE(SUM(delivery_fee), 0) AS delivery_fee,
    COALESCE(SUM(order_count), 0) AS order_count
  FROM mv_profit_summary
  WHERE delivery_date >= $1 AND delivery_date <= $2
`;
