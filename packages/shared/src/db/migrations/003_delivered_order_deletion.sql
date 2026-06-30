-- ============================================
-- 003: Delivered Order Deletion — dual-approval flow
-- Finance requests deletion of DELIVERED/REMITTED orders;
-- both HoCS and HoL must approve before execution.
-- ============================================

-- 1. Add new permission_request_type enum value
ALTER TYPE permission_request_type ADD VALUE IF NOT EXISTS 'DELIVERED_ORDER_DELETION';

-- 2. Add dual-approval columns to permission_requests
ALTER TABLE permission_requests
  ADD COLUMN IF NOT EXISTS cs_approved_by  UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cs_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cs_note         TEXT,
  ADD COLUMN IF NOT EXISTS logi_approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS logi_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS logi_note       TEXT;

-- 3. Sync history table if it exists (temporal audit trail)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'permission_requests_history'
  ) THEN
    ALTER TABLE permission_requests_history
      ADD COLUMN IF NOT EXISTS cs_approved_by  UUID,
      ADD COLUMN IF NOT EXISTS cs_approved_at  TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cs_note         TEXT,
      ADD COLUMN IF NOT EXISTS logi_approved_by UUID,
      ADD COLUMN IF NOT EXISTS logi_approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS logi_note       TEXT;
  END IF;
END $$;
