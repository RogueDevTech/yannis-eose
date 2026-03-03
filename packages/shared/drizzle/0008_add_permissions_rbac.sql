-- RBAC: Role + Permission tables
-- SuperAdmin bypasses all checks; roles grant default permissions; user_permissions allows cross-department overrides.

CREATE TABLE IF NOT EXISTS "permissions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL UNIQUE,
  "resource" text NOT NULL,
  "action" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "role_permissions" (
  "role" "user_role" NOT NULL,
  "permission_id" text NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  PRIMARY KEY ("role", "permission_id")
);

CREATE TABLE IF NOT EXISTS "user_permissions" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "permission_id" text NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  "granted" boolean NOT NULL DEFAULT true,
  "granted_by" text REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE ("user_id", "permission_id")
);

CREATE INDEX IF NOT EXISTS "user_permissions_user_id_idx" ON "user_permissions" ("user_id");
