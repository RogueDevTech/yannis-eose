-- Rename WAREHOUSE_MANAGER → STOCK_MANAGER in the user_role enum.
-- `ALTER TYPE ... RENAME VALUE` is transparent: any existing users, role_permissions,
-- users_history, etc. carrying the old value are automatically seen as the new one.
-- Do NOT try to `ADD VALUE 'STOCK_MANAGER'` and then migrate rows — the rename in-place is
-- a single statement and preserves temporal history without touching row data.

ALTER TYPE "public"."user_role" RENAME VALUE 'WAREHOUSE_MANAGER' TO 'STOCK_MANAGER';
