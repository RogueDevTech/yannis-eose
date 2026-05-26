-- Migration 0159: Universal dedup cleanup (CEO directive 2026-05-26)
--
-- One order per customer phone × product within 7 days. No exceptions.
-- This migration finds all duplicate groups and soft-deletes the losers,
-- recording cross_funnel_attempts rows for each.
--
-- Winner selection: highest lifecycle status wins. Ties → oldest created_at.
-- Losers are soft-deleted regardless of status (even post-confirmation).

-- Step 1: Identify duplicate groups and pick winners/losers.
-- A "group" is all orders sharing the same (customer_phone_hash, product_id)
-- where created_at values are within 7 days of the group's earliest order.
WITH status_rank AS (
  SELECT unnest(ARRAY[
    'REMITTED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'IN_TRANSIT',
    'DISPATCHED', 'AGENT_ASSIGNED', 'CONFIRMED', 'CS_ENGAGED',
    'CS_ASSIGNED', 'UNPROCESSED'
  ]::order_status[]) AS status,
  unnest(ARRAY[10, 9, 8, 7, 6, 5, 4, 3, 2, 1]) AS rank
),
-- Find all (order, product) pairs for non-deleted orders
order_products AS (
  SELECT
    o.id AS order_id,
    o.customer_phone_hash,
    oi.product_id,
    o.status,
    o.media_buyer_id,
    o.campaign_id,
    o.branch_id,
    o.customer_name,
    o.customer_phone,
    o.created_at,
    COALESCE(sr.rank, 0) AS status_rank
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  LEFT JOIN status_rank sr ON sr.status = o.status
  WHERE o.status NOT IN ('CANCELLED', 'DELETED')
    AND o.deleted_at IS NULL
    AND o.customer_phone_hash IS NOT NULL
),
-- Self-join to find duplicate pairs within 7 days on same phone+product
dup_pairs AS (
  SELECT
    winner.order_id AS winner_id,
    winner.media_buyer_id AS winner_mb_id,
    loser.order_id AS loser_id,
    loser.customer_phone_hash,
    loser.customer_phone,
    loser.customer_name AS loser_customer_name,
    loser.media_buyer_id AS loser_mb_id,
    loser.campaign_id AS loser_campaign_id,
    loser.branch_id AS loser_branch_id,
    loser.product_id
  FROM order_products winner
  JOIN order_products loser
    ON loser.customer_phone_hash = winner.customer_phone_hash
    AND loser.product_id = winner.product_id
    AND loser.order_id != winner.order_id
    AND ABS(EXTRACT(EPOCH FROM (loser.created_at - winner.created_at))) < 604800 -- 7 days in seconds
  WHERE (winner.status_rank > loser.status_rank)
     OR (winner.status_rank = loser.status_rank AND winner.created_at < loser.created_at)
     OR (winner.status_rank = loser.status_rank AND winner.created_at = loser.created_at AND winner.order_id < loser.order_id)
),
-- Deduplicate: each loser appears once (pick the best winner for them)
losers AS (
  SELECT DISTINCT ON (loser_id, product_id)
    winner_id,
    winner_mb_id,
    loser_id,
    customer_phone_hash,
    customer_phone,
    loser_customer_name,
    loser_mb_id,
    loser_campaign_id,
    loser_branch_id,
    product_id
  FROM dup_pairs
  ORDER BY loser_id, product_id, winner_id
),
-- Filter out losers that already have a CFA row for this winner+product
new_cfas AS (
  SELECT l.*
  FROM losers l
  WHERE NOT EXISTS (
    SELECT 1 FROM cross_funnel_attempts cfa
    WHERE cfa.customer_phone_hash = l.customer_phone_hash
      AND cfa.media_buyer_id = l.loser_mb_id
      AND cfa.original_order_id = l.winner_id
      AND cfa.product_id = l.product_id
  )
  -- Only record CFA when the loser has an MB (edge-form orders)
  AND l.loser_mb_id IS NOT NULL
),
-- Insert cross_funnel_attempts for all new losers
inserted_cfas AS (
  INSERT INTO cross_funnel_attempts (
    id, customer_phone_hash, customer_phone, customer_name,
    product_id, media_buyer_id, campaign_id, branch_id,
    original_order_id, original_media_buyer_id,
    attempted_at, created_at
  )
  SELECT
    gen_random_uuid(),
    customer_phone_hash,
    customer_phone,
    loser_customer_name,
    product_id,
    loser_mb_id,
    loser_campaign_id,
    loser_branch_id,
    winner_id,
    winner_mb_id,
    now(),
    now()
  FROM new_cfas
  RETURNING original_order_id
),
-- Get unique loser order IDs to soft-delete
loser_order_ids AS (
  SELECT DISTINCT loser_id FROM losers
)
-- Soft-delete all loser orders
UPDATE orders
SET
  status = 'DELETED',
  deleted_at = now(),
  updated_at = now(),
  is_duplicate = 'FLAGGED'
FROM loser_order_ids
WHERE orders.id = loser_order_ids.loser_id
  AND orders.status != 'DELETED'
  AND orders.deleted_at IS NULL;

-- Step 2: Insert timeline events for deleted losers
INSERT INTO order_timeline_events (
  id, order_id, event_type, actor_id, actor_name, description, branch_id, created_at
)
SELECT
  gen_random_uuid(),
  o.id,
  'ORDER_DELETED',
  NULL,
  'System',
  'Auto-deleted: universal dedup cleanup (same phone + product within 7 days — migration 0159)',
  o.branch_id,
  now()
FROM orders o
WHERE o.is_duplicate = 'FLAGGED'
  AND o.deleted_at IS NOT NULL
  AND o.status = 'DELETED'
  -- Only for orders that don't already have a migration-0159 timeline event
  AND NOT EXISTS (
    SELECT 1 FROM order_timeline_events ote
    WHERE ote.order_id = o.id
      AND ote.description LIKE '%migration 0159%'
  );
