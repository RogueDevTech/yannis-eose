-- ============================================
-- Fix: drop the unique index that LIKE INCLUDING ALL copied to payroll_batches_history.
-- ============================================
-- Migration 0067 created `payroll_batches_history` via `CREATE TABLE … (LIKE payroll_batches
-- INCLUDING ALL)`. INCLUDING ALL clones indexes too, so the main table's unique
-- `uq_payroll_batch_per_branch_dept_month` ended up on history as
-- `payroll_batches_history_branch_id_period_month_department_idx`. The cleanup loop in
-- 0067 dropped CONSTRAINTS but not standalone INDEXES.
--
-- The history table is supposed to hold MULTIPLE rows per (branch, period, department)
-- — one per audited version of the row. The lingering unique index makes the FIRST
-- UPDATE on a payroll_batches row blow up with:
--   duplicate key value violates unique constraint
--   "payroll_batches_history_branch_id_period_month_department_idx"
--
-- Fix: drop the unique index. Keep the non-unique lookup indexes — they're harmless and
-- speed up audit queries by branch / period.

DROP INDEX IF EXISTS payroll_batches_history_branch_id_period_month_department_idx;
