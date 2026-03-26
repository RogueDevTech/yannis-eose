-- Tighten yannis_branch_matches() so a null session branch only bypasses RLS
-- when the user's role is explicitly in the global set (SUPER_ADMIN).
-- Previously, any null currentBranchId (e.g. orphan user with no membership)
-- would silently get cross-branch access. This closes that gap.

CREATE OR REPLACE FUNCTION yannis_branch_matches(row_branch_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT
    -- SuperAdmin always passes (belt + suspenders with role check below)
    yannis_is_super_admin()
    -- Explicit global visibility: role must be SUPER_ADMIN for null-branch bypass
    OR (
      current_setting('yannis.current_user_role', true) = 'SUPER_ADMIN'
      AND yannis_current_branch_id() IS NULL
    )
    -- Row has no branch_id (global / unscoped data)
    OR row_branch_id IS NULL
    -- Row branch matches the session's active branch
    OR row_branch_id = yannis_current_branch_id();
$$ LANGUAGE sql STABLE;
