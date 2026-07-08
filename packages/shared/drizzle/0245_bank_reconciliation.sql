-- Migration 0245: Bank Reconciliation tables
-- Phase 6D — reconcile bank statement lines against GL entries

CREATE TYPE bank_recon_status AS ENUM ('IN_PROGRESS', 'COMPLETED');
CREATE TYPE bank_recon_line_status AS ENUM ('MATCHED', 'UNMATCHED');

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID,
  bank_account_id UUID NOT NULL,
  statement_date DATE NOT NULL,
  statement_balance NUMERIC(14,2) NOT NULL,
  gl_balance NUMERIC(14,2) NOT NULL,
  difference NUMERIC(14,2) NOT NULL DEFAULT 0,
  status bank_recon_status NOT NULL DEFAULT 'IN_PROGRESS',
  completed_by UUID,
  completed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bank_recon_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id UUID NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
  -- Statement side
  statement_date DATE,
  statement_description TEXT,
  statement_amount NUMERIC(14,2),
  -- GL side
  gl_entry_id UUID,
  gl_date DATE,
  gl_description TEXT,
  gl_amount NUMERIC(14,2),
  -- Match
  status bank_recon_line_status NOT NULL DEFAULT 'UNMATCHED',
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_group ON bank_reconciliations(group_id);
CREATE INDEX IF NOT EXISTS idx_bank_recon_lines_recon ON bank_recon_lines(reconciliation_id);
