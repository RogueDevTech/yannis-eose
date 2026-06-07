-- Add OTHER to expense_category enum so users can log miscellaneous expenses
-- with a free-text description of what was purchased.
ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'OTHER';
