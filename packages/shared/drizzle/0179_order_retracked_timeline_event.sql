-- Add ORDER_RETRACKED to the timeline_event_type enum.
-- Used when HoCS / HoLogistics / Admin rolls an order back to an earlier status.
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'ORDER_RETRACKED';

-- Also add ORDER_CS_TRANSFERRED_POST_STATUS if missing (used by late-stage CS transfer).
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'ORDER_CS_TRANSFERRED_POST_STATUS';
