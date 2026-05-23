-- Add SUPPORT role — read-only tech support with full visibility (SUPER_ADMIN
-- equivalent for reads) and mirror access. All tRPC mutations are blocked at
-- the middleware layer. Used by the dev/ops team to inspect prod data.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPPORT';

-- Update yannis_is_super_admin to also treat SUPPORT as a global-admin role
-- so RLS branch policies pass for SUPPORT users with null branch context.
-- yannis_branch_matches already calls yannis_is_super_admin() as its first
-- check, so no separate update needed there.
CREATE OR REPLACE FUNCTION yannis_is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT yannis_current_user_role() IN ('SUPER_ADMIN', 'SUPPORT');
$$ LANGUAGE sql STABLE;
