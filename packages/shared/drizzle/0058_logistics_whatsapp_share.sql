-- Phase 4 (CS → 3PL WhatsApp share) — store a WhatsApp group invite link per 3PL location,
-- plus a WHATSAPP_GROUP channel so the existing outbound_messages / message_templates plumbing
-- can carry dispatch messages without being conflated with customer-facing SMS/WhatsApp DMs.

ALTER TABLE "logistics_locations" ADD COLUMN IF NOT EXISTS "whatsapp_group_link" text;
ALTER TABLE "logistics_locations_history" ADD COLUMN IF NOT EXISTS "whatsapp_group_link" text;

-- ALTER TYPE ... ADD VALUE cannot run inside the same transaction that uses the new value,
-- which is why it lives in this dedicated migration.
ALTER TYPE "message_channel" ADD VALUE IF NOT EXISTS 'WHATSAPP_GROUP';
