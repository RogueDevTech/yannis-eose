-- Add receipt_url to marketing_funding_requests so HoM can attach receipt when approving
ALTER TABLE marketing_funding_requests
  ADD COLUMN IF NOT EXISTS receipt_url text;

COMMENT ON COLUMN marketing_funding_requests.receipt_url IS 'S3/R2 URL of receipt image attached by Head of Marketing when approving (after sending money manually)';
