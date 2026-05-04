-- 0106_funding_requests_target_user.sql
--
-- CEO directive 2026-05-03: funding requests target a specific recipient instead
-- of broadcasting based on requester role. Media Buyers can choose between Head
-- of Marketing (default, branch-scoped) and Finance Officer (org-wide). Heads of
-- Marketing target a specific Finance Officer. Only the chosen recipient (plus
-- admin-class) sees and acts on the request.
--
-- Backwards compatibility: existing rows have target_user_id = NULL. Listing /
-- approval logic treats NULL as "legacy broadcast" — visible to the historical
-- audience (HoM for MB requests, Finance/SuperAdmin for HoM requests).
--
-- This migration:
--   1. Adds target_user_id to marketing_funding_requests
--   2. Adds target_user_id to marketing_funding_requests_history
--   3. Refreshes the capture-history trigger so new INSERTs propagate the column

ALTER TABLE marketing_funding_requests
  ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES users(id);

ALTER TABLE marketing_funding_requests_history
  ADD COLUMN IF NOT EXISTS target_user_id uuid;

CREATE INDEX IF NOT EXISTS idx_marketing_funding_requests_target_user_id
  ON marketing_funding_requests (target_user_id)
  WHERE target_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION marketing_funding_requests_capture_history_insert()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO marketing_funding_requests_history (
    id, requester_id, amount, reason, status, receipt_url,
    created_at, resolved_at, resolved_by, target_user_id,
    valid_from, valid_to, modified_by
  ) SELECT
    NEW.id, NEW.requester_id, (NEW.amount)::numeric, NEW.reason, NEW.status, NEW.receipt_url,
    NEW.created_at, NEW.resolved_at, NEW.resolved_by, NEW.target_user_id,
    NEW.valid_from, NEW.valid_to, NEW.modified_by;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_marketing_funding_requests_capture_history_insert ON marketing_funding_requests;
CREATE TRIGGER trg_marketing_funding_requests_capture_history_insert
  AFTER INSERT ON marketing_funding_requests
  FOR EACH ROW
  EXECUTE FUNCTION marketing_funding_requests_capture_history_insert();
