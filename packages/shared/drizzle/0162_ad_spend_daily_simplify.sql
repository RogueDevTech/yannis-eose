-- Migration 0162: Simplify ad spend — daily (MB × date) granularity
-- Make campaign/product/screenshot nullable for new-flow rows.
-- Add order_count_snapshot to freeze system-derived count at log time.

ALTER TABLE ad_spend_logs ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE ad_spend_logs ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE ad_spend_logs ALTER COLUMN screenshot_url DROP NOT NULL;
ALTER TABLE ad_spend_logs ADD COLUMN IF NOT EXISTS order_count_snapshot integer;

-- Mirror on history table
ALTER TABLE ad_spend_logs_history ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE ad_spend_logs_history ALTER COLUMN campaign_id DROP NOT NULL;
ALTER TABLE ad_spend_logs_history ALTER COLUMN screenshot_url DROP NOT NULL;
ALTER TABLE ad_spend_logs_history ADD COLUMN IF NOT EXISTS order_count_snapshot integer;
