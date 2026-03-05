-- Order transfer requests: CS agent can request to transfer an order to another agent (pending accept/reject).
CREATE TYPE "order_transfer_request_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TABLE IF NOT EXISTS "order_transfer_requests" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" text NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "from_cs_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "to_cs_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status" "order_transfer_request_status" NOT NULL DEFAULT 'PENDING',
  "requested_at" timestamp with time zone NOT NULL DEFAULT now(),
  "responded_at" timestamp with time zone,
  "responded_by_id" text REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "idx_order_transfer_requests_order_id" ON "order_transfer_requests" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_order_transfer_requests_to_cs_id" ON "order_transfer_requests" ("to_cs_id");
CREATE INDEX IF NOT EXISTS "idx_order_transfer_requests_status" ON "order_transfer_requests" ("status");
