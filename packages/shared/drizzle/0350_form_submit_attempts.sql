-- Migration 0350: form_submit_attempts — submits on the public order form that
-- did NOT go through (CEO escalation 2026-10-07).
--
-- Written by the edge worker's fire-and-forget /track-submit beacon. One row per
-- blocked attempt:
--   BROWSER_BLOCKED  the browser refused a field (required / pattern); reason = field names
--   FORM_BLOCKED     the form's own checks showed an error before sending; reason = message
--   SERVER_REJECTED  an error shown after sending; reason = message
-- Reasons are field names or the message the customer saw, never typed values.
--
-- Non-temporal telemetry, like campaign_views (0296): no _history twin, not in
-- the history-capture trigger loop, no valid_from/valid_to/modified_by.

CREATE TABLE IF NOT EXISTS form_submit_attempts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  media_buyer_id uuid REFERENCES users(id),
  branch_id uuid REFERENCES branches(id),
  session_id text,
  outcome text NOT NULL,
  reason text,
  deployment_type text,
  user_agent text,
  country text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_submit_attempts_campaign_attempted_idx ON form_submit_attempts (campaign_id, attempted_at);
CREATE INDEX IF NOT EXISTS form_submit_attempts_attempted_idx ON form_submit_attempts (attempted_at);
CREATE INDEX IF NOT EXISTS form_submit_attempts_branch_idx ON form_submit_attempts (branch_id);
CREATE INDEX IF NOT EXISTS form_submit_attempts_session_idx ON form_submit_attempts (session_id);
