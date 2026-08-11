-- =============================================================================
-- BACKFILL: cross-funnel winner source (companion to migration 0305)
-- =============================================================================
--
-- What this does
--   REPAIR existing cross_funnel_attempts rows whose original_order_id points at
--   a cart_orders / follow_up_orders winner, populating original_order_source +
--   the denormalized winner fields (campaign / number / status) from the correct
--   table. Migration 0305 already performs this same repair inline (steps 3b/3c);
--   this script exists as an idempotent, re-runnable safety net you can run on
--   demand (e.g. after a restore, or to verify 0305 landed) without a redeploy.
--
-- Why there is NO "infer missing rows" step
--   A follow-up/cart order being a dedup WINNER means a LATER submission collided
--   with it and was blocked. That blocked submission is exactly what should have
--   become a cross_funnel_attempts row — but a blocked submission creates NO row
--   in ANY table (create() returns early / the offline path throws before insert).
--   So a "never recorded" blocked attempt leaves zero persisted trace: there is
--   nothing to reconstruct it from, and any heuristic that invents rows from
--   order-timing overlaps would FABRICATE cross-funnel counts that never happened.
--   We therefore do NOT infer missing rows. From migration 0305 forward, every
--   newly-blocked duplicate is recorded correctly at the source (the real fix).
--
-- PRECONDITION
--   Migration 0305 must have run first — it DROPS the orders-only foreign key on
--   original_order_id. Without that drop, rows pointing at cart/follow-up winners
--   could not have been inserted in the first place, so this repair would be a
--   no-op anyway; but the guard below makes the dependency explicit.
--
-- SAFETY
--   Runs READ-ONLY by default. It only mutates when you pass -v do_write=1.
--   Wrap in a transaction; review the NOTICE counts, then COMMIT or ROLLBACK.
--
-- USAGE
--   Dry run (counts only, no writes):
--     psql "$DATABASE_URL" -f scripts/backfill-cross-funnel-winner-source.sql
--   Apply the repair:
--     psql "$DATABASE_URL" -v do_write=1 -f scripts/backfill-cross-funnel-winner-source.sql
-- =============================================================================

\set ON_ERROR_STOP on
\if :{?do_write} \else \set do_write 0 \endif

BEGIN;

-- Guard: confirm the orders-only FK is gone (mig 0305 step 0). If it still
-- exists, the repair below can't help and the environment is pre-0305.
SELECT EXISTS (
  SELECT 1 FROM information_schema.table_constraints
  WHERE constraint_name = 'cross_funnel_attempts_original_order_id_fkey'
    AND table_name = 'cross_funnel_attempts'
) AS fk_still_present \gset
\if :fk_still_present
  \echo 'WARNING: cross_funnel_attempts_original_order_id_fkey still present — run migration 0305 first.'
\endif

-- ---------------------------------------------------------------------------
-- REPAIR mis-pointed existing rows (cart / follow-up winners).
-- ---------------------------------------------------------------------------
-- Candidates: CFA rows whose original_order_id does NOT exist in `orders` but
-- DOES exist in follow_up_orders or cart_orders. (Rows that resolve in `orders`
-- are already correct — migration 0305 step 3a handled them.)
CREATE TEMP TABLE _cfa_repair ON COMMIT DROP AS
SELECT
  cfa.id AS cfa_id,
  fo.id  AS fu_id,  fo.campaign_id AS fu_campaign,  fo.order_number AS fu_number,  fo.status AS fu_status,
  co.id  AS co_id,  co.campaign_id AS co_campaign,  co.order_number AS co_number,  co.status AS co_status
FROM cross_funnel_attempts cfa
LEFT JOIN orders o            ON o.id  = cfa.original_order_id
LEFT JOIN follow_up_orders fo ON fo.id = cfa.original_order_id
LEFT JOIN cart_orders co      ON co.id = cfa.original_order_id
WHERE o.id IS NULL
  AND (fo.id IS NOT NULL OR co.id IS NOT NULL)
  -- Only rows that are currently mislabeled or missing denorm fields.
  AND (cfa.original_order_source IS DISTINCT FROM
         CASE WHEN fo.id IS NOT NULL THEN 'follow_up_orders' ELSE 'cart_orders' END
       OR cfa.original_campaign_id IS NULL);

SELECT count(*) AS repair_candidates FROM _cfa_repair \gset
\echo 'REPAIR candidates (cart/follow-up winners currently mislabeled):' :repair_candidates

\if :do_write
  UPDATE cross_funnel_attempts cfa
  SET original_order_source = CASE WHEN r.fu_id IS NOT NULL THEN 'follow_up_orders' ELSE 'cart_orders' END,
      original_campaign_id  = COALESCE(r.fu_campaign, r.co_campaign),
      original_order_number = COALESCE(r.fu_number,   r.co_number),
      original_order_status = COALESCE(r.fu_status,   r.co_status)
  FROM _cfa_repair r
  WHERE r.cfa_id = cfa.id;
  \echo 'REPAIR — APPLIED.'
\else
  \echo 'REPAIR — DRY RUN (no writes). Pass -v do_write=1 to apply.'
\endif

-- ---------------------------------------------------------------------------
-- Summary of the resulting distribution (post-change within this txn).
-- ---------------------------------------------------------------------------
\echo '--- cross_funnel_attempts by source (in-transaction view) ---'
SELECT original_order_source, count(*)
FROM cross_funnel_attempts
GROUP BY original_order_source
ORDER BY count(*) DESC;

-- Review the numbers above, then decide:
--   COMMIT;   -- to keep the changes
--   ROLLBACK; -- to discard (default-safe)
-- This script leaves the transaction OPEN on purpose so you choose explicitly.
\echo '>>> Transaction is OPEN. Type COMMIT; to apply or ROLLBACK; to discard.'
