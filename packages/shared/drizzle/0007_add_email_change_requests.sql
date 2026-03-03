-- Email change requests — require SuperAdmin approval before taking effect
-- Uses text + check constraint to avoid dependency on approval_status enum (may not exist in all DBs)
CREATE TABLE IF NOT EXISTS "email_change_requests" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "requested_new_email" text NOT NULL,
  "requester_id" text NOT NULL REFERENCES "users"("id"),
  "status" text DEFAULT 'PENDING' NOT NULL CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'QUERIED')),
  "approver_id" text REFERENCES "users"("id"),
  "approval_reason" text,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
