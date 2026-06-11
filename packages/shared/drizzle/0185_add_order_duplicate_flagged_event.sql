-- Migration 0185: Add ORDER_DUPLICATE_FLAGGED timeline event type
-- The universal dedup cron now flags duplicates instead of deleting them.
-- No order should ever be auto-deleted by the dedup system — only flagged
-- so CS can see the duplicate and decide what to do.

ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'ORDER_DUPLICATE_FLAGGED';
