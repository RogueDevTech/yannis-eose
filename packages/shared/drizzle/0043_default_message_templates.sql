-- ============================================================
-- Migration 0043: Default CS message templates (Main Branch)
--
-- Idempotent: skips each row if same name already exists for Main Branch.
-- Skips entirely if no users exist (avoids FK failure).
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
    RAISE NOTICE 'Skipping default message_templates: no users';
    RETURN;
  END IF;

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Order confirmation',
    'SMS'::message_channel,
    'Hi {{customer_name}}, thank you for your order {{order_id}} for {{product_name}}. We are confirming your details and will share delivery updates soon.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Order confirmation'
  );

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Delivery address check',
    'SMS'::message_channel,
    'Hello {{customer_name}}, please confirm your delivery address for order {{order_id}}: {{delivery_address}}. Reply if this is correct or send the updated address.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Delivery address check'
  );

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Out for delivery',
    'SMS'::message_channel,
    'Hi {{customer_name}}, your order {{order_id}} is out for delivery to {{delivery_address}}. Please keep your phone available. Thank you.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Out for delivery'
  );

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Follow-up / callback',
    'SMS'::message_channel,
    'Hi {{customer_name}}, we tried to reach you about order {{order_id}} for {{product_name}}. Please reply when you can or let us know a better time to call.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Follow-up / callback'
  );

  INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
  SELECT gen_random_uuid(),
    'Order status update',
    'WHATSAPP'::message_channel,
    'Hello {{customer_name}}, your order {{order_id}} ({{product_name}}) is being processed. Delivery address on file: {{delivery_address}}. We will notify you when it is dispatched.',
    actor_id,
    branch_main,
    'ACTIVE'::template_status
  WHERE NOT EXISTS (
    SELECT 1 FROM message_templates t WHERE t.branch_id = branch_main AND t.name = 'Order status update'
  );
END $$;
