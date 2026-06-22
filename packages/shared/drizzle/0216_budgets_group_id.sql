-- Add group_id to budgets for company-group scoping.
ALTER TABLE budgets
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES branch_groups(id);
