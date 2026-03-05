-- Add CS_ASSIGNED order status (between UNPROCESSED and CS_ENGAGED in the lifecycle).
-- Used when algorithm or HoS assigns an order to a sales agent; agent engages to reach CS_ENGAGED.
-- Idempotent: no-op if value already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'order_status' AND e.enumlabel = 'CS_ASSIGNED'
  ) THEN
    ALTER TYPE "public"."order_status" ADD VALUE 'CS_ASSIGNED';
  END IF;
END $$;
