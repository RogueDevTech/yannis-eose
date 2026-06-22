-- Expense category enum + column on ad_spend_logs
-- Only AD_SPEND rows feed into CPA/ROAS; other categories deduct from balance only.

DO $$ BEGIN
  CREATE TYPE "expense_category" AS ENUM (
    'AD_SPEND',
    'AD_ACCOUNT',
    'RECRUITMENT_AD',
    'WHATSAPP_CAMPAIGN',
    'UGC_PRODUCTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ad_spend_logs"
  ADD COLUMN IF NOT EXISTS "category" "expense_category" NOT NULL DEFAULT 'AD_SPEND',
  ADD COLUMN IF NOT EXISTS "description" text;

-- Sync history table
ALTER TABLE "ad_spend_logs_history"
  ADD COLUMN IF NOT EXISTS "category" "expense_category",
  ADD COLUMN IF NOT EXISTS "description" text;

-- Recreate MV to only include AD_SPEND category in CPA/profit calculations
DROP MATERIALIZED VIEW IF EXISTS mv_ad_spend_summary;
CREATE MATERIALIZED VIEW mv_ad_spend_summary AS
SELECT
  COALESCE(SUM(CAST(spend_amount AS numeric)), 0) AS total_spend,
  spend_date,
  media_buyer_id,
  product_id
FROM ad_spend_logs
WHERE status = 'APPROVED' AND category = 'AD_SPEND'
GROUP BY spend_date, media_buyer_id, product_id
WITH DATA;
CREATE UNIQUE INDEX uq_mv_ad_spend_summary ON mv_ad_spend_summary (spend_date, media_buyer_id, product_id);
