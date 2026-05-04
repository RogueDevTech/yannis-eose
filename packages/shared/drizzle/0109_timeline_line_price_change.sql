-- Add timeline event types for the CS line-price-change approval flow.
-- Without these, a CS rep submitting an "Adjust order items → price change" request leaves
-- no trace on the order timeline; only the underlying permission_request row is created,
-- which is invisible from the order detail page.

ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'LINE_PRICE_CHANGE_REQUESTED';
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'LINE_PRICE_CHANGE_APPROVED';
ALTER TYPE timeline_event_type ADD VALUE IF NOT EXISTS 'LINE_PRICE_CHANGE_REJECTED';
