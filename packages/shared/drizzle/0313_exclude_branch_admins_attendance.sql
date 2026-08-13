-- Migration 0312: Branch Admins are excluded from attendance by default.
--
-- Branch Admins mark their branch's staff on the attendance page; they do not
-- mark their own attendance. One-time backfill sets attendance_excluded = true
-- for every existing BRANCH_ADMIN. New/role-changed Branch Admins are excluded
-- automatically in the user service (application-side).
--
-- This UPDATE fires the users history trigger (rebuilt with attendance_excluded
-- in mig 0311), so each change is captured in users_history. Idempotent — only
-- touches rows not already excluded.

UPDATE users
SET attendance_excluded = true
WHERE role = 'BRANCH_ADMIN'
  AND attendance_excluded = false;
