-- Migration 0355: cross_funnel_attempts.duplicate_order_id (2026-10-15).
--
-- A cross-funnel row is written in two different situations:
--   1. Blocked at entry (intakeBlock / manualOrderBlock = BLOCK): no order was
--      created. duplicate_order_id stays NULL.
--   2. Duplicate cleanup cron: the order WAS created, and the cron later
--      deleted or flagged it. duplicate_order_id = that order.
-- The compare screen used to say "duplicate was blocked" for both, which read
-- as "orders are rejected on entry" when the order had in fact been created
-- (Oct 15 escalation, orders 138014/138016). This column lets the screen say
-- what actually happened and show the real creation time.
--
-- No cross_funnel_attempts_history twin exists (see 0305), so nothing to sync.

ALTER TABLE cross_funnel_attempts ADD COLUMN IF NOT EXISTS duplicate_order_id uuid;

-- Backfill cleanup-cron rows. The cron writes, per removed order, an
-- ORDER_DUPLICATE_FLAGGED timeline event (metadata.reason = 'DUPLICATE_RULE',
-- metadata.winnerId) and then the cross-funnel row a moment later, for the same
-- phone, campaign and winner. Intake-blocked rows have no such order and stay NULL.
UPDATE cross_funnel_attempts cfa
SET duplicate_order_id = o.id
FROM orders o
JOIN order_timeline_events te
  ON te.order_id = o.id
 AND te.event_type = 'ORDER_DUPLICATE_FLAGGED'
 AND te.metadata->>'reason' = 'DUPLICATE_RULE'
WHERE cfa.duplicate_order_id IS NULL
  AND o.customer_phone_hash = cfa.customer_phone_hash
  AND o.campaign_id IS NOT DISTINCT FROM cfa.campaign_id
  AND te.metadata->>'winnerId' = cfa.original_order_id::text
  AND te.created_at BETWEEN cfa.attempted_at - interval '10 minutes' AND cfa.attempted_at + interval '10 minutes';
