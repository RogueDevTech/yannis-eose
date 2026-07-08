-- ============================================================================
-- Phase 2–4 — additional GL voucher types.
-- Additive ALTER TYPE ... ADD VALUE (existing rows stay valid). Each guarded so
-- re-running the migration is a no-op.
-- ============================================================================

DO $$ BEGIN
  ALTER TYPE gl_voucher_type ADD VALUE IF NOT EXISTS 'SALES_INVOICE';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE gl_voucher_type ADD VALUE IF NOT EXISTS 'PAYMENT';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE gl_voucher_type ADD VALUE IF NOT EXISTS 'PURCHASE_RECEIPT';
EXCEPTION WHEN others THEN NULL; END $$;
