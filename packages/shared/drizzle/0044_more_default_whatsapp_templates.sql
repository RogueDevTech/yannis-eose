-- ============================================================
-- Migration 0044: Additional default WhatsApp templates (Main Branch)
-- Brings default WhatsApp presets to five (with 0043's "Order status update").
-- Idempotent per template name + branch.
-- ============================================================

DO $$
DECLARE
  actor_id TEXT;
  branch_main TEXT := '00000000-0000-0000-0000-000000000001';
BEGIN
  SELECT u.id INTO actor_id
  FROM users u
  WHERE u.role = 'HEAD_OF_CS'
  ORDER BY u.created_at ASC NULLS LAST
  LIMIT 1;

  IF actor_id IS NULL THEN
    SELECT u.id INTO actor_id FROM users u WHERE u.role = 'SUPER_ADMIN' LIMIT 1;
  END IF;

  IF actor_id IS NULL THEN
    SELECT u.id INTO actor_id FROM users u LIMIT 1;
  END IF;

  IF actor_id IS NULL THEN
    RAISE NOTICE 'Skipping WhatsApp template seed: no users';
    RETURN;
  END IF;

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Dispatch notification',
    'WHATSAPP'::message_channel,
    'Hello {{customer_name}}, your order {{order_id}} ({{product_name}}) has been dispatched and is on the way to {{delivery_address}}. We will let you know if there are any changes.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Dispatch notification'
  );

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Address reconfirm',
    'WHATSAPP'::message_channel,
    'Hi {{customer_name}}, please confirm your delivery address is still correct for order {{order_id}}: {{delivery_address}}. Reply here if anything needs updating.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Address reconfirm'
  );

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Delivery scheduled today',
    'WHATSAPP'::message_channel,
    'Hello {{customer_name}}, your order {{order_id}} for {{product_name}} is scheduled for delivery today. Please ensure someone is available at {{delivery_address}}. Thank you.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Delivery scheduled today'
  );

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Thank you for your order',
    'WHATSAPP'::message_channel,
    'Thank you {{customer_name}} for choosing us. Your order {{order_id}} ({{product_name}}) is important to us. If you have questions about delivery to {{delivery_address}}, reply here anytime.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Thank you for your order'
  );
END $$;
