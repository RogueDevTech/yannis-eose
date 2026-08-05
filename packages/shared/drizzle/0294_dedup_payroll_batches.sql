-- Migration 0294: Deduplicate payroll batches that occupy the same slot.
--
-- CONTEXT / ROOT CAUSE
-- --------------------
-- generateBatch / generateNullScopeBatch (payroll-batch.service.ts) "regenerate"
-- a batch with a read-modify-write: SELECT the existing row by its discriminator
-- tuple, then UPDATE it in place (else INSERT). The lookup is `.limit(1)`. If a
-- slot ever came to hold TWO rows (a concurrency race between two regenerate
-- calls, or drift in scope_type / run_label between runs so the SELECT missed the
-- original and the else-branch INSERTed a second batch), every later regenerate
-- only ever refreshes ONE of them. The other becomes an orphaned duplicate that
-- shadows the slot forever. This collapses each such slot back to a single batch.
--
-- SLOT DEFINITIONS (mirror the two partial unique indexes from migration 0287)
--   1. Classic staff slot : (branch_id, period_month, department)
--                            WHERE branch_id IS NOT NULL AND department IS NOT NULL
--   2. Null-scope slot     : (scope_type, period_month,
--                             COALESCE(branch_id, <zero-uuid>), COALESCE(run_label,''))
--                            WHERE department IS NULL
--
-- MERGE RULE (per CEO decision 2026-08-05)
--   - Survivor = the NEWEST batch in the group by created_at (tiebreak: id).
--     The survivor KEEPS ITS OWN STATUS untouched.
--   - Losers = every other batch in the group.
--   - Each loser's payout_records are RE-PARENTED onto the survivor (batch_id
--     rewired), then the loser batch row is DELETED.
--   - earnings_adjustments follow their payout (they FK payout_records.id, not the
--     batch), so re-parenting payouts carries their adjustments automatically.
--   - Survivor's denormalised summary (staff_count, total_*) is recomputed from
--     its now-complete payout set so the list view stays truthful.
--
-- PAID SAFETY (Pillar 4 — paid payroll is an immutable financial record)
--   A group containing a PAID batch is LEFT ALONE. A PAID batch is never deleted
--   and never has another batch's payouts folded into it. Any duplicate sharing a
--   slot with a PAID batch is reported below and requires manual review, never an
--   automated merge. (In practice the app forbids two PAID batches in one slot, so
--   this only defers the rare mixed PAID+draft slot to a human.)
--
-- HISTORY-TRIGGER SAFETY
--   payout_records and payroll_batches both carry the generic
--   yannis_capture_history trigger (positional `INSERT ... SELECT ($1).*`). This
--   migration only UPDATEs existing columns and DELETEs whole rows — no schema
--   change — so both history tables stay column-aligned and every re-parent /
--   delete is captured normally.
--
-- IDEMPOTENT: once each slot holds one non-PAID batch there is nothing to merge,
-- so re-running is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Identify duplicate groups and elect a survivor per group.
--    dup_groups = every non-PAID batch that shares a slot with >= 1 other
--    non-PAID batch, tagged with its slot key and a per-slot recency rank.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    pb.id,
    pb.status,
    pb.created_at,
    -- Slot key: one expression that is identical for every row in the same slot.
    -- Classic staff slot uses branch/dept; null-scope slot uses scope_type +
    -- coalesced branch + coalesced run_label. department IS NULL cleanly splits
    -- the two families (matching the 0287 partial-index predicates).
    CASE
      WHEN pb.department IS NOT NULL AND pb.branch_id IS NOT NULL THEN
        'dept:' || pb.branch_id::text || ':' || pb.period_month::text || ':' || pb.department::text
      WHEN pb.department IS NULL THEN
        'null:' || COALESCE(pb.scope_type::text, '') || ':' || pb.period_month::text
             || ':' || COALESCE(pb.branch_id::text, '00000000-0000-0000-0000-000000000000')
             || ':' || COALESCE(pb.run_label, '')
      -- Rows with a NULL branch but non-null department fall through both 0287
      -- indexes; give them their own key so any such duplicates still collapse.
      ELSE
        'orphan:' || COALESCE(pb.branch_id::text, 'x') || ':' || pb.period_month::text
                  || ':' || COALESCE(pb.department::text, 'x')
    END AS slot_key,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN pb.department IS NOT NULL AND pb.branch_id IS NOT NULL THEN
            'dept:' || pb.branch_id::text || ':' || pb.period_month::text || ':' || pb.department::text
          WHEN pb.department IS NULL THEN
            'null:' || COALESCE(pb.scope_type::text, '') || ':' || pb.period_month::text
                 || ':' || COALESCE(pb.branch_id::text, '00000000-0000-0000-0000-000000000000')
                 || ':' || COALESCE(pb.run_label, '')
          ELSE
            'orphan:' || COALESCE(pb.branch_id::text, 'x') || ':' || pb.period_month::text
                      || ':' || COALESCE(pb.department::text, 'x')
        END
      ORDER BY pb.created_at DESC, pb.id DESC
    ) AS rn
  FROM payroll_batches pb
  WHERE pb.status <> 'PAID'
    -- Exclude any batch whose slot ALSO contains a PAID batch: PAID rows must
    -- never be merged into or displaced. Such slots are reported below and
    -- handled manually.
    AND NOT EXISTS (
      SELECT 1 FROM payroll_batches paid
      WHERE paid.status = 'PAID'
        AND paid.period_month = pb.period_month
        AND paid.department IS NOT DISTINCT FROM pb.department
        AND paid.branch_id IS NOT DISTINCT FROM pb.branch_id
        AND paid.scope_type IS NOT DISTINCT FROM pb.scope_type
        AND COALESCE(paid.run_label, '') = COALESCE(pb.run_label, '')
    )
),
groups AS (
  -- Only slots that actually have more than one non-PAID batch.
  SELECT slot_key
  FROM ranked
  GROUP BY slot_key
  HAVING COUNT(*) > 1
),
survivors AS (
  SELECT r.slot_key, r.id AS survivor_id
  FROM ranked r
  JOIN groups g USING (slot_key)
  WHERE r.rn = 1
),
losers AS (
  SELECT r.slot_key, r.id AS loser_id, s.survivor_id
  FROM ranked r
  JOIN groups g USING (slot_key)
  JOIN survivors s USING (slot_key)
  WHERE r.rn > 1
)
-- 2. Re-parent every loser's payout_records onto the slot's survivor.
--    (payout_records has no updated_at column — temporal-only — so we set just
--    batch_id; the history trigger captures the re-parent from the UPDATE itself.)
UPDATE payout_records pr
   SET batch_id = l.survivor_id
  FROM losers l
 WHERE pr.batch_id = l.loser_id;

-- 3. Delete the loser batches. Recompute the same slot membership as step 1 —
--    a fresh WITH so the deletes see the CURRENT rows (payouts already moved).
--    `rn` (recency rank within slot) + `slot_size` (rows in slot) are computed as
--    window functions so the delete target is a single unambiguous subquery:
--    a batch is a loser iff its slot has >1 row AND it is not the newest (rn > 1).
WITH ranked AS (
  SELECT
    pb.id,
    ROW_NUMBER() OVER w AS rn,
    COUNT(*)     OVER w AS slot_size
  FROM payroll_batches pb
  WHERE pb.status <> 'PAID'
    AND NOT EXISTS (
      SELECT 1 FROM payroll_batches paid
      WHERE paid.status = 'PAID'
        AND paid.period_month = pb.period_month
        AND paid.department IS NOT DISTINCT FROM pb.department
        AND paid.branch_id IS NOT DISTINCT FROM pb.branch_id
        AND paid.scope_type IS NOT DISTINCT FROM pb.scope_type
        AND COALESCE(paid.run_label, '') = COALESCE(pb.run_label, '')
    )
  WINDOW w AS (
    PARTITION BY
      CASE
        WHEN pb.department IS NOT NULL AND pb.branch_id IS NOT NULL THEN
          'dept:' || pb.branch_id::text || ':' || pb.period_month::text || ':' || pb.department::text
        WHEN pb.department IS NULL THEN
          'null:' || COALESCE(pb.scope_type::text, '') || ':' || pb.period_month::text
               || ':' || COALESCE(pb.branch_id::text, '00000000-0000-0000-0000-000000000000')
               || ':' || COALESCE(pb.run_label, '')
        ELSE
          'orphan:' || COALESCE(pb.branch_id::text, 'x') || ':' || pb.period_month::text
                    || ':' || COALESCE(pb.department::text, 'x')
      END
    ORDER BY pb.created_at DESC, pb.id DESC
  )
)
DELETE FROM payroll_batches
 WHERE id IN (
   SELECT id FROM ranked WHERE slot_size > 1 AND rn > 1
 );

-- 4. Recompute the survivor's denormalised summary from its (now merged) payouts.
--    Only survivors could have gained payouts, but recomputing every non-PAID
--    batch is cheap and keeps the whole table self-consistent. total_payout is the
--    per-line settled amount; gross/tax/net mirror the payslip snapshot columns.
UPDATE payroll_batches pb
   SET staff_count  = agg.cnt,
       total_amount = agg.total_payout,
       total_gross  = agg.gross,
       total_tax    = agg.tax,
       total_net    = agg.net,
       updated_at   = now()
  FROM (
    SELECT pr.batch_id,
           COUNT(*)                          AS cnt,
           COALESCE(SUM(pr.total_payout), 0) AS total_payout,
           COALESCE(SUM(pr.gross_pay), 0)    AS gross,
           COALESCE(SUM(pr.paye_tax), 0)     AS tax,
           COALESCE(SUM(pr.net_pay), 0)      AS net
      FROM payout_records pr
     WHERE pr.batch_id IS NOT NULL
     GROUP BY pr.batch_id
  ) agg
 WHERE pb.id = agg.batch_id
   AND pb.status <> 'PAID';

-- Batches that ended with zero payouts (all their lines belonged to a loser that
-- had none, or the batch was empty) get a zeroed summary so stale denormalised
-- totals never linger.
UPDATE payroll_batches pb
   SET staff_count = 0, total_amount = 0, total_gross = 0, total_tax = 0, total_net = 0,
       updated_at = now()
 WHERE pb.status <> 'PAID'
   AND NOT EXISTS (SELECT 1 FROM payout_records pr WHERE pr.batch_id = pb.id);

-- 5. Report any slot that STILL holds duplicates — i.e. a slot that also contains
--    a PAID batch, which this migration intentionally refused to touch. These need
--    a human decision (you cannot silently fold rows into paid payroll). Emitted as
--    a NOTICE so it shows in the boot log without failing the migration.
DO $$
DECLARE
  leftover_count integer;
  r record;
BEGIN
  SELECT COUNT(*) INTO leftover_count FROM (
    SELECT pb.period_month, pb.branch_id, pb.department, pb.scope_type, pb.run_label
    FROM payroll_batches pb
    GROUP BY pb.period_month, pb.branch_id, pb.department, pb.scope_type, pb.run_label
    HAVING COUNT(*) > 1
  ) dups;

  IF leftover_count > 0 THEN
    RAISE WARNING '[0294] % payroll slot(s) still hold duplicates (PAID batch present — left for manual review):', leftover_count;
    FOR r IN
      SELECT pb.period_month, pb.branch_id, pb.department, pb.scope_type, pb.run_label,
             COUNT(*) AS n, array_agg(pb.id::text ORDER BY pb.created_at) AS ids
      FROM payroll_batches pb
      GROUP BY pb.period_month, pb.branch_id, pb.department, pb.scope_type, pb.run_label
      HAVING COUNT(*) > 1
    LOOP
      RAISE WARNING '[0294]   slot month=% branch=% dept=% scope=% label=% -> % batches: %',
        r.period_month, r.branch_id, r.department, r.scope_type, r.run_label, r.n, r.ids;
    END LOOP;
  ELSE
    RAISE NOTICE '[0294] payroll batch dedup complete — no remaining duplicate slots.';
  END IF;
END $$;
