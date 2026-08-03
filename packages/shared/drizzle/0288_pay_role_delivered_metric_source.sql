-- Migration 0288: Delivered-metric source on pay roles
--
-- Context: CS staff fall into distinct populations by the order category they
-- work. The FUNNEL closers work the main `orders` funnel; the RECOVERY closers
-- work the recovery pipelines (cart orders, follow-up orders, delivered-follow-up
-- orders). Payroll for a "Customer Support – Follow-up on Delivered Orders" role
-- must qualify + pay on the RECOVERY delivered-order count, not the funnel count.
--
-- `delivered_metric_source` is the per-pay-role discriminator the payroll metrics
-- engine reads to decide WHICH pipelines feed deliveredCount / totalOrders /
-- deliveredCohortCount / returnedCount for staff assigned to the role:
--   FUNNEL            — orders table funnel only (existing behaviour; the default,
--                       so every current row keeps computing exactly as before).
--   RECOVERY_COMBINED — orders WHERE is_delivered_follow_up = true (this already
--                       includes graduated follow_up_orders AND CS-created
--                       delivered-follow-up orders) PLUS cart_orders. The
--                       follow_up_orders table is deliberately NOT summed: its
--                       delivered rows graduate into orders as
--                       is_delivered_follow_up = true, so counting both would
--                       double-count (and double-pay) every graduated follow-up.
--                       Cart deliveries graduate as order_source='online' (NOT
--                       flagged is_delivered_follow_up), so there is no overlap.
--
-- HISTORY-TRIGGER SAFETY: payroll_pay_roles uses the generic capture function
-- (INSERT INTO payroll_pay_roles_history SELECT ($1).*), a positional copy. The
-- new column MUST be mirrored on the history table or every payroll_pay_roles
-- UPDATE breaks. Both tables are updated below. The history column is a bare enum
-- with no NOT NULL / default so it never rejects a captured historical row.

BEGIN;

-- Dedicated enum for the discriminator. CREATE TYPE + first use in the same
-- transaction is safe (only ALTER TYPE ... ADD VALUE has the commit-boundary
-- restriction). Guarded so re-running the migration set is a no-op.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payroll_delivered_metric_source') THEN
    CREATE TYPE payroll_delivered_metric_source AS ENUM ('FUNNEL', 'RECOVERY_COMBINED');
  END IF;
END $$;

-- Live table: default FUNNEL keeps every existing pay role on today's behaviour.
ALTER TABLE payroll_pay_roles
  ADD COLUMN IF NOT EXISTS delivered_metric_source payroll_delivered_metric_source
    NOT NULL
    DEFAULT 'FUNNEL';

-- History table: mirror the column (nullable, no default) so the positional
-- SELECT ($1).* capture always succeeds.
ALTER TABLE payroll_pay_roles_history
  ADD COLUMN IF NOT EXISTS delivered_metric_source payroll_delivered_metric_source;

COMMIT;
