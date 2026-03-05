-- marketing_funding_requests: Media Buyer requests for funds (HoM sees and approves by sending actual funding)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'funding_request_status') THEN
    CREATE TYPE funding_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS marketing_funding_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id text NOT NULL REFERENCES users(id),
  amount numeric(12, 2) NOT NULL,
  reason text,
  status funding_request_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_funding_requests_requester ON marketing_funding_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_marketing_funding_requests_status ON marketing_funding_requests(status);
