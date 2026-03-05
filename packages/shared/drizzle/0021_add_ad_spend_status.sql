-- Add ad spend status and approval audit columns.
-- Only APPROVED ad spend should count toward metrics/profit (handled in app queries and mv).
CREATE TYPE "ad_spend_status" AS ENUM ('PENDING', 'APPROVED');

ALTER TABLE "ad_spend_logs"
  ADD COLUMN IF NOT EXISTS "status" "ad_spend_status" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "approved_by" text REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

-- Backfill existing rows as APPROVED (grandfathered) so current reports stay consistent.
UPDATE "ad_spend_logs" SET "status" = 'APPROVED' WHERE "status" = 'PENDING' AND "approved_at" IS NULL;

-- Recreate ad spend summary MV to only include APPROVED spend.
DROP MATERIALIZED VIEW IF EXISTS mv_ad_spend_summary;
CREATE MATERIALIZED VIEW mv_ad_spend_summary AS
SELECT
  COALESCE(SUM(CAST(spend_amount AS numeric)), 0) AS total_spend,
  spend_date,
  media_buyer_id,
  product_id
FROM ad_spend_logs
WHERE status = 'APPROVED'
GROUP BY spend_date, media_buyer_id, product_id
WITH DATA;
CREATE INDEX IF NOT EXISTS idx_mv_ad_spend_summary_date ON mv_ad_spend_summary (spend_date);
