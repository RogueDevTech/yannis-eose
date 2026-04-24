-- Add ADMIN to user_role enum.
-- ADMIN = SuperAdmin-equivalent privileges EXCEPT cannot manage other Admins or the SuperAdmin.
-- Multiple ADMINs can exist per org; SUPER_ADMIN remains a singleton.
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older PG versions.
-- PostgreSQL 12+ allows it; this project is on PG 18. Safe to run in migration.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'ADMIN';
