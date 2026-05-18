-- Sync ad_spend_logs_history with ad_spend_logs: add status, approved_at, approved_by (from 0021).
ALTER TABLE ad_spend_logs_history
  ADD COLUMN IF NOT EXISTS status ad_spend_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS approved_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS approved_by text;
