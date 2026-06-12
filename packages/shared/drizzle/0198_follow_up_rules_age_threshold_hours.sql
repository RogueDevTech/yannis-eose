-- Follow-up rules: add optional hours-based threshold for sub-day rules (e.g. cart abandonment @ 2h).
-- When age_threshold_hours IS NOT NULL it takes precedence over age_threshold_days.
ALTER TABLE "follow_up_rules"
  ADD COLUMN "age_threshold_hours" integer;

-- Update default cart-abandonment rule to 2 hours (CEO directive 2026-06-12).
UPDATE "follow_up_rules"
  SET "age_threshold_hours" = 2,
      "age_threshold_days" = 1,
      "name" = 'Cart abandonments older than 2 hours'
  WHERE "source_status" = 'CART_ABANDONMENT'
    AND "age_threshold_hours" IS NULL;
