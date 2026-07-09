-- Asset depreciation methods
CREATE TYPE asset_depreciation_method AS ENUM ('STRAIGHT_LINE', 'REDUCING_BALANCE', 'UNITS_OF_PRODUCTION');

-- Asset status
CREATE TYPE asset_status AS ENUM ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED');

-- Asset register
CREATE TABLE IF NOT EXISTS fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES branch_groups(id),
  asset_name TEXT NOT NULL,
  asset_category TEXT NOT NULL, -- 'Motor Vehicles', 'Computers & IT', 'Furniture & Fittings', etc.
  acquisition_date DATE NOT NULL,
  cost NUMERIC(14, 2) NOT NULL,
  residual_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  useful_life_months INTEGER, -- for SLM
  depreciation_rate NUMERIC(5, 2), -- for RBM (e.g. 25.00 = 25%)
  depreciation_method asset_depreciation_method NOT NULL DEFAULT 'STRAIGHT_LINE',
  accumulated_depreciation NUMERIC(14, 2) NOT NULL DEFAULT 0,
  status asset_status NOT NULL DEFAULT 'ACTIVE',
  location TEXT,
  serial_number TEXT,
  invoice_url TEXT,
  disposal_date DATE,
  disposal_proceeds NUMERIC(14, 2),
  disposal_gain_loss NUMERIC(14, 2),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Depreciation run log (one row per asset per monthly run)
CREATE TABLE IF NOT EXISTS depreciation_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fixed_asset_id UUID NOT NULL REFERENCES fixed_assets(id),
  posting_date DATE NOT NULL,
  opening_nbv NUMERIC(14, 2) NOT NULL,
  depreciation_amount NUMERIC(14, 2) NOT NULL,
  closing_nbv NUMERIC(14, 2) NOT NULL,
  gl_voucher_id UUID, -- links to journal_entries.id for the GL posting
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_group_id ON fixed_assets(group_id);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_status ON fixed_assets(status);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_asset ON depreciation_entries(fixed_asset_id);
