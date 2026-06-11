-- Allow follow-up orders created from cart abandonments (no source order).
ALTER TABLE follow_up_orders ALTER COLUMN source_order_id DROP NOT NULL;
