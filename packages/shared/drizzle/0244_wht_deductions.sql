-- 0244: WHT (Withholding Tax) deductions table for certificate generation.
-- Phase 6B — FIRS WHT tracking.

CREATE TABLE IF NOT EXISTS wht_deductions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID REFERENCES branch_groups(id),
  vendor_name TEXT NOT NULL,
  vendor_id   UUID,
  payment_date DATE NOT NULL,
  gross_amount NUMERIC(14,2) NOT NULL,
  wht_rate    NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  wht_amount  NUMERIC(14,2) NOT NULL,
  net_amount  NUMERIC(14,2) NOT NULL,
  description TEXT,
  certificate_generated BOOLEAN NOT NULL DEFAULT false,
  gl_voucher_id UUID,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wht_deductions_group ON wht_deductions(group_id);
CREATE INDEX IF NOT EXISTS idx_wht_deductions_vendor ON wht_deductions(vendor_id);
CREATE INDEX IF NOT EXISTS idx_wht_deductions_payment_date ON wht_deductions(payment_date);
