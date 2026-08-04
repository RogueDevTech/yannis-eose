-- Migration 0293: Backfill period_month on floating earnings adjustments.
--
-- Adjustments (deductions / add-ons, incl. auto return-clawbacks) created before
-- period-targeting shipped (migration 0286) carry period_month = NULL. A NULL
-- month means "next batch, any month", so such a row shows in EVERY month's
-- Earnings Outlook and is swept into whichever batch generates first. This
-- backfills a concrete month so each floating adjustment lands in exactly one
-- payroll period.
--
-- Target month, per party:
--   1. The period_month of the party's OPEN (non-PAID) payroll batch — the batch
--      that would actually absorb it. Most recent open batch wins if several.
--   2. Fallback: the calendar month (Africa/Lagos) the adjustment was created in.
--
-- Scope: ONLY rows with period_month IS NULL AND payout_id IS NULL. Never touches
-- an adjustment already linked into a finalized/paid batch. Idempotent: once a
-- row has a period_month it is skipped, so re-running is a no-op.
--
-- HISTORY-TRIGGER SAFETY: earnings_adjustments carries the generic
-- yannis_capture_history trigger (positional `SELECT ($1).*`). This migration
-- only UPDATEs an existing column's value — no schema change — so the history
-- table stays column-aligned and each UPDATE is captured normally.

UPDATE earnings_adjustments ea
   SET period_month = t.target_month
  FROM (
    SELECT f.id,
           COALESCE(pb.batch_month, f.created_month) AS target_month
      FROM (
        SELECT ea2.id,
               ea2.staff_id,
               ea2.contractor_id,
               (date_trunc('month', (ea2.created_at AT TIME ZONE 'Africa/Lagos'))::date) AS created_month
          FROM earnings_adjustments ea2
         WHERE ea2.period_month IS NULL
           AND ea2.payout_id IS NULL
      ) f
      LEFT JOIN LATERAL (
        SELECT pb2.period_month AS batch_month
          FROM payout_records pr
          JOIN payroll_batches pb2
            ON pb2.id = pr.batch_id
           AND pb2.status <> 'PAID'
         WHERE (f.staff_id IS NOT NULL AND pr.staff_id = f.staff_id)
            OR (f.contractor_id IS NOT NULL AND pr.contractor_id = f.contractor_id)
         ORDER BY pb2.created_at DESC
         LIMIT 1
      ) pb ON TRUE
  ) t
 WHERE ea.id = t.id
   AND ea.period_month IS NULL
   AND ea.payout_id IS NULL;
