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

-- 3. Performance indexes for delivery remittances queries
CREATE INDEX IF NOT EXISTS idx_delivery_remittances_sent_at_desc
  ON delivery_remittances (sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_remittances_location_sent_at
  ON delivery_remittances (logistics_location_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_status_logistics_location_delivered_at
  ON orders (status, logistics_location_id, delivered_at DESC)
  WHERE status = 'DELIVERED' AND logistics_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status_delivered_servicing_branch
  ON orders (status, servicing_branch_id, delivered_at DESC)
  WHERE status = ANY(ARRAY['DELIVERED'::order_status, 'REMITTED'::order_status]);

-- 4. Sync history table if it exists (temporal audit trail)
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
