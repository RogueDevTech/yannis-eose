-- Ad spend: attributed_order_count.
-- CEO directive 2026-05-08 — the Add Expense modal now asks the Media Buyer to
-- pick ONE form (campaign) per batch and split the form's actual order count
-- across the lines they're logging. This column persists that manual split per
-- line so the per-line CPA reads from real (saved) data instead of being
-- recomputed from time-window snapshots at view time.
--
-- Default 0 for backfill — existing rows pre-directive don't have a split and
-- the read paths fall back to the old snapshot/interval calc when count = 0.

ALTER TABLE ad_spend_logs
  ADD COLUMN IF NOT EXISTS attributed_order_count integer NOT NULL DEFAULT 0;

ALTER TABLE ad_spend_logs_history
  ADD COLUMN IF NOT EXISTS attributed_order_count integer NOT NULL DEFAULT 0;

-- Sync the capture-history trigger so new INSERTs forward the new column.
CREATE OR REPLACE FUNCTION yannis_capture_history_insert_ad_spend_logs()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ad_spend_logs_history (
    id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url,
    ad_url, platform, platform_custom_label,
    attributed_order_count,
    spend_date,
    status, approved_at, approved_by,
    rejection_reason, rejected_at, rejected_by,
    created_at,
    valid_from, valid_to, modified_by
  ) SELECT
    NEW.id, NEW.media_buyer_id, NEW.product_id, NEW.campaign_id, (NEW.spend_amount)::numeric,
    NEW.screenshot_url,
    NEW.ad_url, NEW.platform, NEW.platform_custom_label,
    (NEW.attributed_order_count)::integer,
    NEW.spend_date,
    NEW.status, NEW.approved_at, NEW.approved_by,
    NEW.rejection_reason, NEW.rejected_at, NEW.rejected_by,
    NEW.created_at,
    NEW.valid_from, NEW.valid_to, NEW.modified_by;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ad_spend_logs_capture_history_insert ON ad_spend_logs;
CREATE TRIGGER trg_ad_spend_logs_capture_history_insert
  AFTER INSERT ON ad_spend_logs
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history_insert_ad_spend_logs();
