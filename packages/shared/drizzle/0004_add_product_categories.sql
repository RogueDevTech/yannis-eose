-- Create product_categories table
CREATE TABLE IF NOT EXISTS "product_categories" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL UNIQUE,
  "brand_name" text NOT NULL,
  "brand_phone" text,
  "brand_email" text,
  "brand_whatsapp" text,
  "sms_sender_id" text,
  "status" "record_status" DEFAULT 'ACTIVE' NOT NULL,
  "valid_from" timestamp with time zone DEFAULT now() NOT NULL,
  "valid_to" timestamp with time zone,
  "modified_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Create history table for temporal audit
CREATE TABLE IF NOT EXISTS "product_categories_history" (LIKE "product_categories" INCLUDING ALL);

-- Drop the unique constraint on history table (multiple versions of same record)
ALTER TABLE "product_categories_history" DROP CONSTRAINT IF EXISTS "product_categories_history_pkey";
ALTER TABLE "product_categories_history" DROP CONSTRAINT IF EXISTS "product_categories_history_name_unique";

-- Add audit triggers (same pattern as other tables)
CREATE OR REPLACE TRIGGER trg_product_categories_stamp
  BEFORE INSERT OR UPDATE ON "product_categories"
  FOR EACH ROW EXECUTE FUNCTION yannis_stamp_actor();

CREATE OR REPLACE TRIGGER trg_product_categories_history
  BEFORE UPDATE OR DELETE ON "product_categories"
  FOR EACH ROW EXECUTE FUNCTION yannis_capture_history();

-- Add category_id column to products table
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "category_id" text REFERENCES "product_categories"("id");

-- Also add to products_history to keep history table in sync
ALTER TABLE "products_history" ADD COLUMN IF NOT EXISTS "category_id" text;
