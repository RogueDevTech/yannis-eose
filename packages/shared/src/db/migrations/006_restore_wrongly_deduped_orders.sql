-- Migration 006: Restore orders wrongly auto-deleted as duplicates
--
-- BUG: purgeUniversalDuplicates ranked REMITTED/DELIVERED orders as the highest
-- "winner" and collapsed any same phone+product order within the time window into
-- them — WITHOUT checking whether the winner was already a completed transaction.
-- A delivered+remitted order is a finished sale, not an open duplicate. A new order
-- for the same product placed AFTER that delivery is a legitimate repeat purchase.
--
-- The cron itself is fixed in test-order-purge.service.ts (winners already delivered
-- before the loser was created are now excluded). This migration heals the rows the
-- old logic already wrongly deleted.
--
-- CORRECT PREDICATE (not the naive gap>14d proxy, which skipped in-window cases like
-- YNS-68366 at 11.5 days):
--   The loser is a false-positive when its winner was ALREADY delivered before the
--   loser was even created — i.e. the customer received the first order, then ordered
--   the same product again later. We additionally require the loser to have been
--   created at least 24h after the winner's creation, so genuine same-session
--   double-submissions (e.g. YNS-28291, ~2h apart) stay correctly deleted.

BEGIN;

WITH wrongly_deleted AS (
  SELECT DISTINCT o.id AS order_id, o.branch_id
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
    -- Winner was a COMPLETED transaction, delivered before the loser was created:
    AND winner.status IN ('DELIVERED', 'REMITTED')
    AND winner.delivered_at IS NOT NULL
    AND winner.delivered_at < o.created_at
    -- Exclude genuine same-session double-orders (created < 24h after the winner):
    AND o.created_at >= winner.created_at + INTERVAL '24 hours'
),
restored AS (
  UPDATE orders
  SET deleted_at   = NULL,
      is_duplicate = NULL,
      status       = 'UNPROCESSED',
      updated_at   = NOW()
  WHERE id IN (SELECT order_id FROM wrongly_deleted)
    AND status = 'DELETED'          -- idempotent: skip anything already restored
  RETURNING id, branch_id
)
INSERT INTO order_timeline_events
  (id, order_id, event_type, actor_id, actor_name, description, branch_id, created_at)
SELECT
  gen_random_uuid(),
  r.id,
  'ORDER_RESTORED',
  NULL,
  'System',
  'Restored: auto-deleted as duplicate of an already-delivered order. That order was a completed sale, so this was a legitimate repeat purchase, not a duplicate. Migration 006.',
  r.branch_id,
  NOW()
FROM restored r;

COMMIT;
