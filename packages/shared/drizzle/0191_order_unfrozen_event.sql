-- Add ORDER_UNFROZEN to timeline_event_type enum
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'ORDER_UNFROZEN';
