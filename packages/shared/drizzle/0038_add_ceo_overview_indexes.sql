-- Indexes for CEO Overview and dashboard hot paths (getStatusCounts, getProfitReport, getPerformanceMetrics, getCSAgentWorkloads).

-- orders: status counts by date, profit report by delivered_at, performance metrics, CS workload aggregation
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_created_at_status ON orders(created_at, status);
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at_status ON orders(delivered_at, status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_cs_id_status ON orders(assigned_cs_id, status);

-- ad_spend_logs: profit report and performance metrics by date + status
CREATE INDEX IF NOT EXISTS idx_ad_spend_logs_spend_date_status ON ad_spend_logs(spend_date, status);

-- payout_records: profit report commission by period overlap
CREATE INDEX IF NOT EXISTS idx_payout_records_period_start_period_end ON payout_records(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_payout_records_status ON payout_records(status);

-- stock_transfers: profit report fulfillment cost by verified_at + transfer_status
CREATE INDEX IF NOT EXISTS idx_stock_transfers_verified_at_transfer_status ON stock_transfers(verified_at, transfer_status);

-- stock_movements: profit report write-off by created_at + movement_type
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at_movement_type ON stock_movements(created_at, movement_type);
