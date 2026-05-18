-- Permission requests: HR submits sensitive role/permission assignments for SuperAdmin approval

CREATE TYPE "permission_request_type" AS ENUM (
  'USER_CREATION',
  'ROLE_CHANGE',
  'PERMISSION_GRANT'
);

CREATE TYPE "permission_request_status" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE IF NOT EXISTS "permission_requests" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" "permission_request_type" NOT NULL,
  "status" "permission_request_status" NOT NULL DEFAULT 'PENDING',
  "requester_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "target_user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "requested_role" "user_role",
  "permission_code" text,
  "reason" text NOT NULL,
  "approver_id" text REFERENCES "users"("id"),
  "approval_reason" text,
  "approved_at" timestamp with time zone,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "permission_requests_status_idx" ON "permission_requests" ("status");
CREATE INDEX IF NOT EXISTS "permission_requests_requester_id_idx" ON "permission_requests" ("requester_id");
