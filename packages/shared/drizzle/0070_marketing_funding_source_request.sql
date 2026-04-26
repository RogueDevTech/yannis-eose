-- Link ledger transfers to approved funding requests (one row per request max).
-- Enables idempotent approve + backfill of historical APPROVED rows without duplicate ledgers.

ALTER TABLE marketing_funding
  ADD COLUMN IF NOT EXISTS source_funding_request_id uuid REFERENCES marketing_funding_requests (id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_marketing_funding_source_request
  ON marketing_funding (source_funding_request_id)
  WHERE source_funding_request_id IS NOT NULL;

ALTER TABLE marketing_funding_history
  ADD COLUMN IF NOT EXISTS source_funding_request_id uuid;

-- Backfill: APPROVED requests that never got a ledger row (pre-fix data).
-- Sender must exist as a user; uses resolved_by as the disburser.
INSERT INTO marketing_funding (
  id,
  sender_id,
  receiver_id,
  amount,
  receipt_url,
  status,
  sent_at,
  source_funding_request_id
)
SELECT
  gen_random_uuid(),
  approver.id,
  r.requester_id,
  r.amount,
  r.receipt_url,
  'SENT'::funding_status,
  COALESCE(r.resolved_at, r.created_at),
  r.id
FROM marketing_funding_requests r
INNER JOIN users approver ON approver.id::text = r.resolved_by::text
WHERE r.status = 'APPROVED'
  AND r.resolved_by IS NOT NULL
  AND r.resolved_by::text <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM marketing_funding f
    WHERE f.source_funding_request_id = r.id
  );
