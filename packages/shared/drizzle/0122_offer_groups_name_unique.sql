-- Offer group names are now unique among non-archived rows, case-insensitive.
-- Repeated saves on the create modal (rapid double / triple click) silently
-- created 3 copies of the same offer group with identical names; preventing
-- this at the DB level is the only durable fix.
--
-- Behaviour:
--   • Pre-pass: deduplicate existing non-archived duplicates by archiving the
--     extras (keep the oldest by created_at). The oldest keeps its name + items.
--   • Partial unique index on lower(name) WHERE status != 'ARCHIVED' — only
--     active / inactive groups are constrained. Reuse a name after archiving
--     the previous group is allowed.
--   • Idempotent: re-running the pre-pass is a no-op once duplicates are gone.

DO $$
DECLARE
  dup_row record;
BEGIN
  FOR dup_row IN
    SELECT id, rn
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY lower(name)
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM offer_groups
      WHERE status <> 'ARCHIVED'
    ) ranked
    WHERE rn > 1
  LOOP
    UPDATE offer_groups
    SET status = 'ARCHIVED',
        updated_at = now()
    WHERE id = dup_row.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_offer_groups_name_active
  ON offer_groups (lower(name))
  WHERE status <> 'ARCHIVED';
