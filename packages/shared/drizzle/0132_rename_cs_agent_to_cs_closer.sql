-- Rename CS_AGENT → CS_CLOSER (CEO directive 2026-05-10).
--
-- The role is being rebranded across the platform. This migration is the
-- DB-side half — every code call-site is updated in the same release.
--
-- What this does:
--   1. Drops the two RLS policies that compare against the role string
--      literal 'CS_AGENT' (the literal lives inside the policy body — the
--      enum rename in step 2 does NOT auto-update string literals embedded
--      in policy expressions, only enum-typed columns).
--   2. Renames the enum value: `ALTER TYPE user_role RENAME VALUE`. This
--      atomically updates EVERY column of type `user_role` across the
--      schema — `users.role`, `users_history.role`, `role_templates.mapped_role`,
--      `role_templates_history.mapped_role`, etc. — in one shot.
--   3. Recreates the dropped RLS policies with the new role string.
--   4. Updates the SYSTEM `role_templates` row that points to this role:
--      `key` flips from `system_CS_AGENT` to `system_CS_CLOSER` and the
--      human-readable `name` from "CS Agent" to "CS Closer". The seed-runner
--      builds template keys as `system_${roleKey}` and would otherwise try
--      to INSERT a NEW `system_CS_CLOSER` row alongside the existing
--      `system_CS_AGENT`, which would conflict on the
--      `uq_role_templates_system_mapped_role` unique index. Renaming the
--      existing row keeps every `users.role_template_id` FK pointer intact.
--
-- What this does NOT touch:
--   - Historical audit-log rows that contain the literal text 'CS_AGENT'
--     in their JSON payloads. Those are immutable historical truth — they
--     reflect what the role was named WHEN the audit entry was recorded.
--     New audit entries written after this migration will use 'CS_CLOSER'.
--   - Migration files 0000 / 0093 / 0104 / 0128 — those are historical and
--     reflect what was applied at the time. The migration runner tracks
--     applied filenames and never re-runs them.
--
-- Rollout:
--   - The user-bundle cache (60s TTL) may briefly serve stale 'CS_AGENT'
--     role payloads to active sessions. After at most 60s, the cache reads
--     fresh DB state and every session converges to 'CS_CLOSER'. Code
--     deployed alongside this migration expects 'CS_CLOSER'; the brief
--     stale window means a CS user's first request immediately after the
--     deploy may evaluate against an old role string. The cache is also
--     invalidated whenever the user record is rewritten by any service
--     that uses `withActor` — so realistically this is sub-second.

BEGIN;

-- 1. Drop policies that reference the old role string literal.
DROP POLICY IF EXISTS orders_cs_agent ON orders;
DROP POLICY IF EXISTS call_logs_cs_agent ON call_logs;

-- 2. Rename the enum value. Atomically updates every column of type user_role
-- (users.role, users_history.role, role_templates.mapped_role, etc.).
ALTER TYPE user_role RENAME VALUE 'CS_AGENT' TO 'CS_CLOSER';

-- 3. Recreate the policies with the new role string.
CREATE POLICY orders_cs_closer ON orders
  FOR ALL
  USING (
    yannis_current_user_role() = 'CS_CLOSER'
    AND assigned_cs_id = yannis_current_user_id()
  );

CREATE POLICY call_logs_cs_closer ON call_logs
  FOR ALL
  USING (
    yannis_current_user_role() = 'CS_CLOSER'
    AND agent_id = yannis_current_user_id()
  );

-- 4. Rename the SYSTEM role-template row in place. Keeps the row's `id` (UUID
-- PK) stable, so every `users.role_template_id` and
-- `role_template_permissions.role_template_id` pointer remains valid without
-- needing FK juggling.
UPDATE role_templates
   SET key = 'system_CS_CLOSER',
       name = 'CS Closer'
 WHERE key = 'system_CS_AGENT';

COMMIT;
