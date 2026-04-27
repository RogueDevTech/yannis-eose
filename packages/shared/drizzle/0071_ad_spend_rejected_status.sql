-- Ad spend: REJECTED status + rejection audit columns (main + history + insert trigger).

ALTER TYPE ad_spend_status ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE ad_spend_logs
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES users (id);

ALTER TABLE ad_spend_logs_history
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rejected_by uuid;

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_ad_spend_logs()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ad_spend_logs_history (
    id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url, spend_date,
    status, approved_at, approved_by,
    rejection_reason, rejected_at, rejected_by,
    created_at,
    valid_from, valid_to, modified_by
  ) SELECT
    NEW.id, NEW.media_buyer_id, NEW.product_id, NEW.campaign_id, (NEW.spend_amount)::numeric,
    NEW.screenshot_url, NEW.spend_date,
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
