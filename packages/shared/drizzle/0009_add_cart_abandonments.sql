-- Cart abandonment tracking: capture name+phone before submit, mark as abandoned if no conversion
CREATE TYPE "public"."cart_status" AS ENUM('PENDING', 'CONVERTED', 'ABANDONED');

CREATE TABLE IF NOT EXISTS "cart_abandonments" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" text NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "media_buyer_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "customer_name" text NOT NULL,
  "customer_phone_hash" text NOT NULL,
  "product_id" text NOT NULL REFERENCES "products"("id") ON DELETE CASCADE,
  "offer_label" text,
  "status" "cart_status" NOT NULL DEFAULT 'PENDING',
  "converted_order_id" text REFERENCES "orders"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "cart_abandonments_status_updated_at_idx" ON "cart_abandonments" ("status", "updated_at");
CREATE INDEX IF NOT EXISTS "cart_abandonments_campaign_phone_product_idx" ON "cart_abandonments" ("campaign_id", "customer_phone_hash", "product_id");
