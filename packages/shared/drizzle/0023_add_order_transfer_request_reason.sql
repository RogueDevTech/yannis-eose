-- Add reason for transfer to order_transfer_requests.
ALTER TABLE "order_transfer_requests"
  ADD COLUMN IF NOT EXISTS "reason" text;
