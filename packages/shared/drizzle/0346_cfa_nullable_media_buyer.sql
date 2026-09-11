-- Record EVERY blocked edge-form attempt, including those with no resolvable
-- media buyer.
--
-- `cross_funnel_attempts.media_buyer_id` was NOT NULL, so orders.service.ts had
-- to guard the insert with `if (cfaMbId)`. When neither the submission nor the
-- winning order yielded a media buyer, the attempt was silently DROPPED: the
-- order was still blocked, but nothing recorded it beyond a `cfa_skipped_no_mb`
-- log line. That is the one case where a blocked submission leaves no trace a
-- human can find.
--
-- media_buyer_id doubles as the row's visibility key (an MB sees their own rows
-- via media_buyer_id = caller.id). A NULL row is therefore invisible to any
-- individual MB, but REMAINS visible to Admin/HoM, who scope by branch_id.
-- That is the correct outcome: with no MB to attribute the attempt to, there is
-- no MB whose funnel caught it, and an admin-visible row beats no row at all.
--
-- No cross_funnel_attempts_history twin exists (see 0305), so nothing to sync.
ALTER TABLE cross_funnel_attempts
  ALTER COLUMN media_buyer_id DROP NOT NULL;

-- Unattributed attempts are only findable by branch, so make that lookup cheap.
CREATE INDEX IF NOT EXISTS cfa_unattributed_branch_attempted_at_idx
  ON cross_funnel_attempts (branch_id, attempted_at DESC)
  WHERE media_buyer_id IS NULL;
