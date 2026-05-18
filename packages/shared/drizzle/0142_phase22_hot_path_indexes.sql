-- Phase 22 (Task 22.3) — hot-path indexes for round-trip latency reduction.
--
-- The dev/prod Postgres is remote, so an unindexed filter on a hot table is a
-- seq scan + a wasted network round-trip on every request. These two tables
-- had ZERO indexes on the columns the order + marketing hot paths filter on.
--
-- Audit note: the original audit also flagged stock_batches.location_id and
-- user_branches — both were already fine (stock_batches has no location_id
-- column; user_branches already carries a unique index on (user_id, branch_id)).

-- inventory_levels — hit on every order transition stock gate
-- (assertLocationCanFulfill, reserveForAllocate, completeDelivery). Lookups are
-- always by (product_id, location_id). NOT unique — there is one row per batch
-- via batch_id, so the same (product, location) pair can repeat.
CREATE INDEX IF NOT EXISTS idx_inventory_levels_product_location
  ON inventory_levels (product_id, location_id);

-- campaigns.branch_id — RLS (yannis_branch_matches) filters every campaign query
-- by branch_id; nullable, so a partial index keeps it lean.
CREATE INDEX IF NOT EXISTS idx_campaigns_branch_id
  ON campaigns (branch_id)
  WHERE branch_id IS NOT NULL;

-- campaigns.media_buyer_id — per-buyer campaign lists (Marketing dashboard).
CREATE INDEX IF NOT EXISTS idx_campaigns_media_buyer_id
  ON campaigns (media_buyer_id);
