-- Backfill branch_id on order_timeline_events (2026-05).
--
-- Why: order_timeline_events is branch-scoped under RLS. Older rows (and some
-- write paths) inserted NULL branch_id, causing the Order Activity timeline
-- to appear empty for branch-scoped viewers.
--
-- This backfill is safe and idempotent.

UPDATE order_timeline_events ote
SET branch_id = o.branch_id
FROM orders o
WHERE ote.order_id = o.id
  AND ote.branch_id IS NULL
  AND o.branch_id IS NOT NULL;

