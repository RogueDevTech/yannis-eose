-- Migration 0211: Update preferredDeliveryDateOptions in all campaign form_config
--
-- Replaces any stored preferredDeliveryDateOptions with the new defaults:
--   ["Today", "Tomorrow", "Specific date (mention in Notes)"]
-- This covers forms that had the old options ("As soon as possible", "Within 1-2 days",
-- "Within 3-5 days", "Next week", "Specific date (mention in notes)") baked in.
-- Forms without preferredDeliveryDateOptions are left untouched (they already
-- fall back to the edge-worker / builder defaults).

UPDATE campaigns
SET form_config = jsonb_set(
  form_config::jsonb,
  '{preferredDeliveryDateOptions}',
  '["Today", "Tomorrow", "Specific date (mention in Notes)"]'::jsonb
)
WHERE form_config IS NOT NULL
  AND form_config::jsonb ? 'preferredDeliveryDateOptions';
