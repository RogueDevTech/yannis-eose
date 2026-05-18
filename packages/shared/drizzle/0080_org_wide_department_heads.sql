-- Org-wide singletons for HEAD_OF_CS, HEAD_OF_MARKETING, HEAD_OF_LOGISTICS (replaces per-branch unique from 0056).
-- HR_MANAGER remains one per branch via service checks + partial index in 0060.

DROP INDEX IF EXISTS uq_active_head_of_cs_per_branch;
DROP INDEX IF EXISTS uq_active_head_of_marketing_per_branch;
DROP INDEX IF EXISTS uq_active_head_of_logistics_per_branch;

-- Dev/staging (or pre-migration prod) may have multiple ACTIVE holders of the same org-wide head role
-- from the old per-branch model. The partial unique indexes below use ON ((true)), so at most one
-- qualifying row per index — duplicates make CREATE UNIQUE INDEX fail with 23505.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY role
      ORDER BY valid_from ASC NULLS LAST, id ASC
    ) AS rn
  FROM users
  WHERE role IN ('HEAD_OF_CS', 'HEAD_OF_MARKETING', 'HEAD_OF_LOGISTICS')
    AND status = 'ACTIVE'
)
UPDATE users u
SET
  status = 'INACTIVE',
  updated_at = now()
FROM ranked r
WHERE u.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_head_of_cs_org_wide
  ON users ((true))
  WHERE role = 'HEAD_OF_CS'
    AND status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_head_of_marketing_org_wide
  ON users ((true))
  WHERE role = 'HEAD_OF_MARKETING'
    AND status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_head_of_logistics_org_wide
  ON users ((true))
  WHERE role = 'HEAD_OF_LOGISTICS'
    AND status = 'ACTIVE';
