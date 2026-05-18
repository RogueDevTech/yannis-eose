ALTER TABLE "users" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "logistics_locations" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "logistics_providers" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "stock_batches" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "marketing_funding" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "offer_templates" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "commission_plans" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "earnings_adjustments" ADD COLUMN "modified_by" text;--> statement-breakpoint
ALTER TABLE "payout_records" ADD COLUMN "modified_by" text;