-- Migration 0358: month-end FX snapshot for payroll (2026-10-29).
--
-- Payroll PPD ROAS converts each media buyer's international delivered revenue
-- to ₦. HR/Finance asked for an approved month-end rate saved per payroll
-- period, so recalculating a past month never moves with today's rate.
--
-- One row per company × month × currency, written once (ON CONFLICT DO NOTHING)
-- when a finished month's payroll is generated, copied from
-- currencies.fx_rate_to_base. Append-only: no history twin.

CREATE TABLE IF NOT EXISTS payroll_fx_rates (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES branch_groups(id),
  period_month date NOT NULL,
  currency_code text NOT NULL,
  rate numeric(18, 6) NOT NULL CHECK (rate > 0),
  locked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_fx_rates_group_month_currency_uq
  ON payroll_fx_rates (group_id, period_month, currency_code);
