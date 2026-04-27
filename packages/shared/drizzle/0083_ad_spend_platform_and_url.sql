-- Ad spend: ad_url + platform.
-- Media Buyers now record platform (Facebook default, TikTok, Google) and an
-- optional link to the actual ad creative when logging spend. The Add Expense
-- modal lets them submit multiple lines for one day in a single batch.
-- (Renamed from orphan `0082_ad_spend_platform_and_url.sql`.)

DO $$ BEGIN
  CREATE TYPE ad_platform AS ENUM ('FACEBOOK', 'TIKTOK', 'GOOGLE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE ad_spend_logs
  ADD COLUMN IF NOT EXISTS ad_url text,
  ADD COLUMN IF NOT EXISTS platform ad_platform NOT NULL DEFAULT 'FACEBOOK';

ALTER TABLE ad_spend_logs_history
  ADD COLUMN IF NOT EXISTS ad_url text,
  ADD COLUMN IF NOT EXISTS platform ad_platform NOT NULL DEFAULT 'FACEBOOK';

CREATE OR REPLACE FUNCTION yannis_capture_history_insert_ad_spend_logs()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO ad_spend_logs_history (
    id, media_buyer_id, product_id, campaign_id, spend_amount, screenshot_url,
    ad_url, platform,
    spend_date,
    status, approved_at, approved_by,
    rejection_reason, rejected_at, rejected_by,
    created_at,
    valid_from, valid_to, modified_by
  ) SELECT
    NEW.id, NEW.media_buyer_id, NEW.product_id, NEW.campaign_id, (NEW.spend_amount)::numeric,
    NEW.screenshot_url,
    NEW.ad_url, NEW.platform,
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
