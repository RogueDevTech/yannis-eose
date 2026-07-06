-- ============================================
-- 004: Order Status Retrack Requests
-- Finance-access users can request a status retrack on
-- DELIVERED/REMITTED orders. Requires dual approval from
-- HoCS + HoL before execution. Reuses the existing
-- dual-approval columns (cs_approved_by, logi_approved_by)
-- on permission_requests.
-- ============================================

-- 1. Add new permission_request_type enum value
ALTER TYPE permission_request_type ADD VALUE IF NOT EXISTS 'ORDER_STATUS_RETRACK';
