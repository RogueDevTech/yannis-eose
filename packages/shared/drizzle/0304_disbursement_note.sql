-- Disbursement note: free-text reason captured when a disbursement is sent, so
-- reviewers (Finance / CEO) can see why the money moved. Optional. Mirrored on
-- the _history table so the generic `SELECT ($1).*` capture trigger keeps working
-- (a column present on the base table but missing on _history breaks all UPDATEs).

ALTER TABLE marketing_funding
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE marketing_funding_history
  ADD COLUMN IF NOT EXISTS notes text;
