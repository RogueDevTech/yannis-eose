-- Migration 0352: timeline event types for the "Check price" flag (0351).
-- Dedicated types so a system note is never read as a human CS comment.
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'OFFER_CHECK_FLAGGED';
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'OFFER_CHECK_CLEARED';
