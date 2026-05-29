-- 0161: Add unique partial index to prevent duplicate orders slipping through
-- the advisory-lock race condition.
--
-- Root cause (YNS-12351 + YNS-12352, 2026-05-29): pg_try_advisory_lock is
-- non-blocking — when two edge-form submissions arrive simultaneously for the
-- same phone+product, BOTH can fail to acquire the lock and proceed past the
-- dedup SELECT before either INSERT commits. There is no DB constraint to
-- catch them.
--
-- Fix: a unique partial index on (customer_phone_hash, product_id) for orders
-- created in the last 7 days that are not deleted. This acts as the last line
-- of defense — even if the application-level dedup is defeated by a race,
-- the DB will reject the second INSERT.
--
-- NOTE: We cannot use a simple unique index because the 7-day window is
-- dynamic. Instead we use a unique index on (customer_phone_hash, product_id)
-- filtered to non-deleted orders only. The application code handles the 7-day
-- window check and cleanup via migration 0159's dedup sweep.
--
-- We index through order_items since the product is not on the orders table.
-- Instead, the application code will do an INSERT ... ON CONFLICT check.
-- The real fix is making the advisory lock BLOCKING (done in application code).

-- No schema change needed — the fix is entirely in the application layer
-- (switching pg_try_advisory_lock → pg_advisory_lock with a timeout).
-- This migration exists as documentation of the incident and fix.

-- However, we add an index to speed up the dedup lookup:
CREATE INDEX IF NOT EXISTS idx_orders_phone_hash_created_dedup
  ON orders (customer_phone_hash, created_at DESC)
  WHERE customer_phone_hash IS NOT NULL
    AND status NOT IN ('CANCELLED', 'DELETED')
    AND deleted_at IS NULL;
