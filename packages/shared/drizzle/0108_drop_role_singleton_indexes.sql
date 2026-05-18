-- 0108_drop_role_singleton_indexes.sql
--
-- CEO directive 2026-05-03: drop the org-wide / per-branch role singletons for
-- HEAD_OF_CS, HEAD_OF_MARKETING, HEAD_OF_LOGISTICS, and HR_MANAGER. The product
-- now relies on the permission system to gate capability, not on role
-- uniqueness. Allowing multiple holders supports:
--   - retiring head + incoming head overlapping for a handover
--   - co-heads during a busy season
--   - one head per region as the org grows
--
-- The DB unique indexes were the safety net behind the service-layer hard
-- throws. Both layers are removed in this migration; the service throws are
-- removed in the same commit (apps/api/src/users/users.service.ts).
--
-- What stays singleton:
--   - SUPER_ADMIN (security boundary, created only via /auth/setup)
--   - Finance hat (`users.is_finance_officer` — explicit deputy slot, has its
--     own swap UX; the partial unique index `users_only_one_finance_officer`
--     is intentionally NOT touched here)
--
-- Idempotent: every DROP uses IF EXISTS.

-- Org-wide head indexes (added in migration 0080).
DROP INDEX IF EXISTS uq_active_head_of_cs_org_wide;
DROP INDEX IF EXISTS uq_active_head_of_marketing_org_wide;
DROP INDEX IF EXISTS uq_active_head_of_logistics_org_wide;

-- Per-branch HR Manager index (added in migration 0060).
DROP INDEX IF EXISTS uq_active_hr_manager_per_branch;

-- Defensive: drop any pre-0080 per-branch head indexes if they still exist on
-- this DB (older clones may have been pinned at an intermediate migration).
DROP INDEX IF EXISTS uq_active_head_of_cs_per_branch;
DROP INDEX IF EXISTS uq_active_head_of_marketing_per_branch;
DROP INDEX IF EXISTS uq_active_head_of_logistics_per_branch;
