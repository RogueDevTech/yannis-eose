-- HR feedback 2026-05 — onboarding "Supporting documents" overhaul.
--
-- Adds typed slots replacing the prior free-form `supporting_documents` JSON
-- as the standard checklist (signed contract, government ID, academic records,
-- employment history, tax ID, rent receipt). Guarantors switch to file-only
-- (form + means of ID); old text columns + signed-letter URL are kept nullable
-- so existing rows stay intact. Adds `current_state_of_residence` and
-- `additional_phone_numbers` per HR. Mirrors every column on
-- `staff_onboarding_history` so temporal audit stays in sync (see CLAUDE.md →
-- "Database Principles · History table sync").

BEGIN;

ALTER TABLE staff_onboarding
  ADD COLUMN IF NOT EXISTS current_state_of_residence text,
  ADD COLUMN IF NOT EXISTS signed_contract_url text,
  ADD COLUMN IF NOT EXISTS government_id_url text,
  ADD COLUMN IF NOT EXISTS additional_phone_numbers text,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS rent_receipt_url text,
  ADD COLUMN IF NOT EXISTS academic_records_url text,
  ADD COLUMN IF NOT EXISTS employment_history_url text,
  ADD COLUMN IF NOT EXISTS guarantor1_form_url text,
  ADD COLUMN IF NOT EXISTS guarantor1_id_url text,
  ADD COLUMN IF NOT EXISTS guarantor2_form_url text,
  ADD COLUMN IF NOT EXISTS guarantor2_id_url text;

ALTER TABLE staff_onboarding_history
  ADD COLUMN IF NOT EXISTS current_state_of_residence text,
  ADD COLUMN IF NOT EXISTS signed_contract_url text,
  ADD COLUMN IF NOT EXISTS government_id_url text,
  ADD COLUMN IF NOT EXISTS additional_phone_numbers text,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS rent_receipt_url text,
  ADD COLUMN IF NOT EXISTS academic_records_url text,
  ADD COLUMN IF NOT EXISTS employment_history_url text,
  ADD COLUMN IF NOT EXISTS guarantor1_form_url text,
  ADD COLUMN IF NOT EXISTS guarantor1_id_url text,
  ADD COLUMN IF NOT EXISTS guarantor2_form_url text,
  ADD COLUMN IF NOT EXISTS guarantor2_id_url text;

COMMIT;
