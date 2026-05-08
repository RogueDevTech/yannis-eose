-- List / filter performance for marketing funding, ad spend, finance invoices,
-- and in-app notifications (narrow selects + bounded queries).

-- marketing_funding: listFunding filters by receiver and/or sender, orders by sent_at DESC
CREATE INDEX IF NOT EXISTS idx_marketing_funding_receiver_sent_at
  ON marketing_funding (receiver_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_funding_sender_sent_at
  ON marketing_funding (sender_id, sent_at DESC);

-- ad_spend_logs: list/detail filters often scope by buyer or campaign then spend_date DESC
-- (0038 adds spend_date + status; these complement equality filters.)
CREATE INDEX IF NOT EXISTS idx_ad_spend_logs_media_buyer_spend_date
  ON ad_spend_logs (media_buyer_id, spend_date DESC);

CREATE INDEX IF NOT EXISTS idx_ad_spend_logs_campaign_spend_date
  ON ad_spend_logs (campaign_id, spend_date DESC);

-- invoices: finance.listInvoices orders by created_at DESC; optional status filter
CREATE INDEX IF NOT EXISTS idx_invoices_status_created_at
  ON invoices (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_created_at_desc
  ON invoices (created_at DESC);

-- notifications: per-user feed ordered by created_at DESC
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
  ON notifications (user_id, created_at DESC);
