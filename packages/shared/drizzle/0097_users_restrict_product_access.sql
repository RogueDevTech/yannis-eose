-- Align DB with packages/shared/src/db/schema/users.ts — restrict MB catalog to assigned products.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS restrict_product_access boolean NOT NULL DEFAULT false;

ALTER TABLE users_history
  ADD COLUMN IF NOT EXISTS restrict_product_access boolean;
