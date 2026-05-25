-- Migration 0155: Add customer_phone to cross_funnel_attempts
-- CEO directive 2026-05-25: store raw phone so MBs can see the contact,
-- and cross-funnel detection now BLOCKS order creation (no more duplicates).

ALTER TABLE cross_funnel_attempts
  ADD COLUMN IF NOT EXISTS customer_phone text;
