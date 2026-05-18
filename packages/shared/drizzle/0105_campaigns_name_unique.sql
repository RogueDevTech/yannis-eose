-- Form (campaign) names are now unique org-wide, case-insensitive (CEO directive).
-- Two media buyers picking the same funnel name caused operational confusion in CS
-- ("which 'Lagos Funnel' is this order from?"). Names must be globally distinct
-- among current (non-soft-deleted) rows.
--
-- Behaviour:
--   • Partial unique index on lower(name) WHERE valid_to IS NULL — only current
--     versions of the row count. Temporal history (rows with valid_to set) is
--     unconstrained, so a name that was used by a now-deleted campaign can be
--     reclaimed.
--   • Idempotent rename pass first: any existing duplicate group is auto-renamed
--     "<name> (2)", "<name> (3)", … so the index creation never fails on legacy
--     data. Order is by created_at ASC — the original keeps its name, copies get
--     suffixed.

DO $$
DECLARE
  dup_row record;
BEGIN
  FOR dup_row IN
    SELECT id, name, rn
    FROM (
      SELECT
        id,
        name,
        ROW_NUMBER() OVER (
          PARTITION BY lower(name)
          ORDER BY created_at ASC, id ASC
        ) AS rn
      FROM campaigns
      WHERE valid_to IS NULL
    ) ranked
    WHERE rn > 1
  LOOP
    UPDATE campaigns
    SET name = dup_row.name || ' (' || dup_row.rn || ')'
    WHERE id = dup_row.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaigns_name_active
  ON campaigns (lower(name))
  WHERE valid_to IS NULL;
