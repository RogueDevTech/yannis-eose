-- Restoring a cancelled order back to the unprocessed queue (Admin / Super Admin only).
-- A cancelled order is never deleted from the database — it stays visible in the
-- "Deleted" tab and an Admin can move it back to UNPROCESSED for re-distribution.
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'ORDER_RESTORED';
