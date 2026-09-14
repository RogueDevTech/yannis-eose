-- Branch name + code are unique PER COMPANY, not org-wide.
--
-- `branches.code` carried a global UNIQUE (branches_code_key, from 0041) and
-- branches.router.ts checked `name` against every row in the table. Both
-- predate companies (group_id, 0187): before branch groups existed, org-wide
-- WAS the company boundary. Once a second company was onboarded the checks
-- became wrong — creating "Kenya"/KENYA under 2B21 was rejected because
-- Yannis Marketing already had a branch by that name, leaking one company's
-- branch namespace into another's create form.
--
-- group_id is nullable, and NULLs are never equal in a btree unique index, so
-- a plain UNIQUE (group_id, code) would silently stop constraining ungrouped
-- rows. COALESCE to the nil UUID pins every ungrouped branch into one shared
-- bucket, preserving today's org-wide guarantee for them.
--
-- Verified before writing: no duplicate names or codes exist under any
-- grouping, so both indexes build without cleanup. `code` is never used as a
-- lookup key anywhere in the app (only ever SELECTed for display), so dropping
-- the global constraint does not break resolution by code.
--
-- branches_history has no unique constraints and gains no columns here, so
-- there is nothing to sync.
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS branches_group_code_uniq
  ON branches (COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(code));

CREATE UNIQUE INDEX IF NOT EXISTS branches_group_name_uniq
  ON branches (COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(name));
