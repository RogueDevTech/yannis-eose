-- Migration 006: Restore orders wrongly flagged as duplicates
--
-- The purgeUniversalDuplicates cron had NO time-window constraint between
-- winner and loser. Any order with the same phone+product as ANY older/higher-status
-- order was flagged, regardless of how far apart they were created.
-- This restores orders where the gap to the winner exceeds 14 days (legitimate repeat purchases).

BEGIN;

-- Identify wrongly deleted orders by re-checking the winner relationship.
-- The dedup cron wrote ORDER_DUPLICATE_FLAGGED timeline events with metadata->>'winnerId'.
-- Join back to the winner to check the time gap.
WITH wrongly_deleted AS (
  SELECT DISTINCT o.id AS order_id, o.order_number, o.branch_id
  FROM orders o
  JOIN order_timeline_events te
    ON te.order_id = o.id
    AND te.event_type = 'ORDER_DUPLICATE_FLAGGED'
    AND te.actor_name = 'System'
    AND te.metadata IS NOT NULL
  JOIN orders winner
    ON winner.id = (te.metadata->>'winnerId')::uuid
  WHERE o.is_duplicate = 'FLAGGED'
    AND o.status = 'DELETED'
    AND o.deleted_at IS NOT NULL
    AND ABS(EXTRACT(EPOCH FROM (o.created_at - winner.created_at))) > 14 * 86400
),
restored AS (
  UPDATE orders
  SET
    deleted_at = NULL,
    is_duplicate = NULL,
    status = 'UNPROCESSED',
    updated_at = NOW()
  WHERE id IN (SELECT order_id FROM wrongly_deleted)
  RETURNING id, branch_id
)
INSERT INTO order_timeline_events (id, order_id, event_type, actor_id, actor_name, description, branch_id, created_at)
SELECT
  gen_random_uuid(),
  r.id,
  'ORDER_RESTORED',
  NULL,
  'System',
  'Restored: duplicate flag was incorrect (repeat purchase > 14 days after original). Migration 006.',
  r.branch_id,
  NOW()
FROM restored r;

COMMIT;
