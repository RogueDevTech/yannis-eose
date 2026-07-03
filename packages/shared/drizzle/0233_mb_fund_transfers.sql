-- MB Fund Transfers — peer-to-peer funding between media buyers within a branch.
-- Lifecycle: PENDING → APPROVED → ACCEPTED (or PENDING → REJECTED).

CREATE TYPE mb_fund_transfer_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ACCEPTED');

CREATE TABLE IF NOT EXISTS mb_fund_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_mb_id UUID NOT NULL REFERENCES users(id),
  receiver_mb_id UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(12, 2) NOT NULL,
  reason TEXT,
  status mb_fund_transfer_status NOT NULL DEFAULT 'PENDING',
  branch_id UUID REFERENCES branches(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  rejected_by UUID REFERENCES users(id),
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT,
  accepted_at TIMESTAMPTZ,
  ledger_entry_id UUID REFERENCES marketing_funding(id),
  sys_period tstzrange NOT NULL DEFAULT tstzrange(now(), NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS mb_ft_sender_status_idx ON mb_fund_transfers (sender_mb_id, status);
CREATE INDEX IF NOT EXISTS mb_ft_receiver_status_idx ON mb_fund_transfers (receiver_mb_id, status);
CREATE INDEX IF NOT EXISTS mb_ft_branch_status_idx ON mb_fund_transfers (branch_id, status);

-- History table for temporal audit
CREATE TABLE IF NOT EXISTS mb_fund_transfers_history (
  LIKE mb_fund_transfers INCLUDING ALL
);
