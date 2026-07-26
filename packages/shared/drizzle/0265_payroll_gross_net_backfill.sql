-- Backfill payout gross/net from legacy rows where PRD columns defaulted to 0
-- but total_payout was populated by commission math.

UPDATE payout_records
SET
  gross_pay = COALESCE(base_salary, 0) + COALESCE(performance_bonus, 0)
    + COALESCE(add_ons_total, 0) + COALESCE(allowances_total, 0),
  net_pay = total_payout
WHERE total_payout > 0
  AND (gross_pay IS NULL OR gross_pay = 0)
  AND (net_pay IS NULL OR net_pay = 0);

UPDATE payout_records
SET gross_pay = total_payout
WHERE total_payout > 0 AND (gross_pay IS NULL OR gross_pay = 0);

UPDATE payout_records
SET net_pay = total_payout
WHERE total_payout > 0 AND (net_pay IS NULL OR net_pay = 0);

-- Recompute batch rollups from payout lines (source of truth).
UPDATE payroll_batches b
SET
  staff_count = sub.cnt,
  total_amount = sub.total_amount,
  total_gross = sub.total_gross,
  total_tax = sub.total_tax,
  total_net = sub.total_net,
  updated_at = now()
FROM (
  SELECT
    batch_id,
    count(*)::int AS cnt,
    coalesce(sum(total_payout), 0) AS total_amount,
    coalesce(sum(COALESCE(NULLIF(gross_pay, 0), total_payout)), 0) AS total_gross,
    coalesce(sum(COALESCE(paye_tax, 0)), 0) AS total_tax,
    coalesce(sum(COALESCE(NULLIF(net_pay, 0), total_payout)), 0) AS total_net
  FROM payout_records
  WHERE batch_id IS NOT NULL
  GROUP BY batch_id
) sub
WHERE b.id = sub.batch_id;

-- Batches with header totals but no payout lines: align header to reality.
UPDATE payroll_batches b
SET
  staff_count = 0,
  total_amount = 0,
  total_gross = 0,
  total_tax = 0,
  total_net = 0,
  updated_at = now()
WHERE b.staff_count > 0
  AND NOT EXISTS (SELECT 1 FROM payout_records p WHERE p.batch_id = b.id);
