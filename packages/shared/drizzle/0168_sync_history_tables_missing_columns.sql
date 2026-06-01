-- Sync history tables that drifted from their parent tables.
-- Each ALTER adds the columns that were added to the main table
-- but missed in the corresponding _history table.

-- branches_history: missing created_at, updated_at (from 0041)
ALTER TABLE branches_history ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE branches_history ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- message_templates_history: missing created_at, updated_at (from 0041)
ALTER TABLE message_templates_history ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE message_templates_history ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- cart_abandonments_history: missing 11 columns (from 0125, 0142)
-- Audit triggers were disabled in 0119 so these are not actively written,
-- but syncing prevents future breakage if triggers are re-enabled.
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS customer_phone text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS customer_address text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS delivery_address text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS delivery_state text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS delivery_notes text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS customer_gender text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS preferred_delivery_date timestamptz;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS quantity integer;
ALTER TABLE cart_abandonments_history ADD COLUMN IF NOT EXISTS custom_field_values jsonb;
