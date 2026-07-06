-- ============================================
-- 0235: Add ORDER_REMITTED timeline event type
-- Cash remittance transitions (DELIVERED → REMITTED) were not
-- being recorded in the order timeline. This adds the enum value
-- so we can log who marked the remittance and when.
-- ============================================

ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'ORDER_REMITTED';
