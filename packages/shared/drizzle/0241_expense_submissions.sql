CREATE TYPE expense_submission_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE IF NOT EXISTS expense_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES companies(id),
  submitter_id UUID NOT NULL,
  vendor_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  receipt_url TEXT, -- stored in object storage
  gl_account_id UUID, -- Finance Officer codes this on approval
  status expense_submission_status NOT NULL DEFAULT 'PENDING',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  gl_voucher_id UUID, -- links to the GL journal entry on approval
  branch_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_submissions_group_id ON expense_submissions(group_id);
CREATE INDEX IF NOT EXISTS idx_expense_submissions_status ON expense_submissions(status);
CREATE INDEX IF NOT EXISTS idx_expense_submissions_submitter ON expense_submissions(submitter_id);
