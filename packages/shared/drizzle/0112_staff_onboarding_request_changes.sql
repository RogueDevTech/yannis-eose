-- Add HR "Request changes" path so a SUBMITTED onboarding can be sent back
-- to the staff member with a reason. Captures who asked, when, and why so the
-- staff side can show a banner ("HR requested changes: …") instead of just
-- silently flipping the form back to editable.

ALTER TABLE staff_onboarding
  ADD COLUMN IF NOT EXISTS changes_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS changes_requested_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS changes_requested_reason text;

ALTER TABLE staff_onboarding_history
  ADD COLUMN IF NOT EXISTS changes_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS changes_requested_by uuid,
  ADD COLUMN IF NOT EXISTS changes_requested_reason text;
