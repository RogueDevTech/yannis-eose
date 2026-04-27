-- Add ADMIN to user_role enum.
-- ADMIN = SuperAdmin-equivalent privileges EXCEPT cannot manage other Admins or the SuperAdmin.
-- Multiple ADMINs can exist per org; SUPER_ADMIN remains a singleton.
-- PostgreSQL 12+ allows ALTER TYPE ... ADD VALUE in a transaction; project targets PG 18.
-- (Renamed from orphan `0058_add_admin_role.sql` — duplicate numeric prefix with journaled 0058_logistics.)

ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'ADMIN';
