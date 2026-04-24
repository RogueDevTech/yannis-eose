/**
 * Minimal database seed.
 *
 * Seeds only:
 *  - message_templates
 *  - offer_templates
 *
 * Usage:
 *   pnpm db:seed
 *
 * Notes:
 * - This script does NOT create users, products, campaigns, or other mock data.
 * - It is dependency-aware and skips inserts when required FK rows are missing.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';

// Load .env from monorepo root when run from packages/shared
config({ path: resolve(__dirname, '../../../../.env') });

const MAIN_BRANCH_ID = '00000000-0000-0000-0000-000000000001';

const DEFAULT_MESSAGE_TEMPLATES: Array<{ name: string; channel: 'SMS' | 'WHATSAPP'; body: string }> = [
  {
    name: 'Order confirmation',
    channel: 'SMS',
    body: 'Hi {{customer_name}}, thank you for your order {{order_id}} for {{product_name}}. We are confirming your details and will share delivery updates soon.',
  },
  {
    name: 'Delivery address check',
    channel: 'SMS',
    body: 'Hello {{customer_name}}, please confirm your delivery address for order {{order_id}}: {{delivery_address}}. Reply if this is correct or send the updated address.',
  },
  {
    name: 'Out for delivery',
    channel: 'SMS',
    body: 'Hi {{customer_name}}, your order {{order_id}} is out for delivery to {{delivery_address}}. Please keep your phone available. Thank you.',
  },
  {
    name: 'Follow-up / callback',
    channel: 'SMS',
    body: 'Hi {{customer_name}}, we tried to reach you about order {{order_id}} for {{product_name}}. Please reply when you can or let us know a better time to call.',
  },
  {
    name: 'Order status update',
    channel: 'WHATSAPP',
    body: 'Hello {{customer_name}}, your order {{order_id}} ({{product_name}}) is being processed. Delivery address on file: {{delivery_address}}. We will notify you when it is dispatched.',
  },
  {
    name: 'Dispatch notification',
    channel: 'WHATSAPP',
    body: 'Hello {{customer_name}}, your order {{order_id}} ({{product_name}}) has been dispatched and is on the way to {{delivery_address}}. We will let you know if there are any changes.',
  },
  {
    name: 'Address reconfirm',
    channel: 'WHATSAPP',
    body: 'Hi {{customer_name}}, please confirm your delivery address is still correct for order {{order_id}}: {{delivery_address}}. Reply here if anything needs updating.',
  },
  {
    name: 'Delivery scheduled today',
    channel: 'WHATSAPP',
    body: 'Hello {{customer_name}}, your order {{order_id}} for {{product_name}} is scheduled for delivery today. Please ensure someone is available at {{delivery_address}}. Thank you.',
  },
  {
    name: 'Thank you for your order',
    channel: 'WHATSAPP',
    body: 'Thank you {{customer_name}} for choosing us. Your order {{order_id}} ({{product_name}}) is important to us. If you have questions about delivery to {{delivery_address}}, reply here anytime.',
  },
];

const DEFAULT_OFFER_TEMPLATES: Array<{ productName: string; name: string; price: string; variants: string | null }> = [
  {
    productName: 'Amoxicillin 500mg Capsules',
    name: 'Amoxicillin Bulk Discount',
    price: '3800.00',
    variants: JSON.stringify([{ dosage: '500mg', price: 3800 }, { dosage: '250mg', price: 2500 }]),
  },
  {
    productName: 'Metformin 850mg Tablets',
    name: 'Metformin Monthly Supply',
    price: '11500.00',
    variants: null,
  },
  {
    productName: 'Vitamin C 1000mg Effervescent',
    name: 'Vitamin C Family Pack',
    price: '16000.00',
    variants: null,
  },
];

async function resolveActorId(sql: postgres.Sql): Promise<string | null> {
  const actorRows = await sql`
    SELECT COALESCE(
      (SELECT id FROM users WHERE role = 'HEAD_OF_CS' ORDER BY created_at ASC NULLS LAST LIMIT 1),
      (SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1),
      (SELECT id FROM users ORDER BY created_at ASC NULLS LAST LIMIT 1)
    ) AS id
  `;
  const actorId = (actorRows[0] as { id: string | null } | undefined)?.id ?? null;
  return actorId;
}

async function seedMessageTemplates(sql: postgres.Sql): Promise<void> {
  console.log('  Seeding message templates...');
  const actorId = await resolveActorId(sql);
  if (!actorId) {
    console.log('  Skipping message_templates: no users found for created_by.');
    return;
  }

  for (const template of DEFAULT_MESSAGE_TEMPLATES) {
    await sql`
      INSERT INTO message_templates (id, name, channel, body, created_by, branch_id, status)
      SELECT gen_random_uuid(), ${template.name}, ${template.channel}::message_channel, ${template.body},
        ${actorId}, ${MAIN_BRANCH_ID}, 'ACTIVE'::template_status
      WHERE NOT EXISTS (
        SELECT 1
        FROM message_templates mt
        WHERE mt.branch_id = ${MAIN_BRANCH_ID} AND mt.name = ${template.name}
      )
    `;
  }
}

async function seedOfferTemplates(sql: postgres.Sql): Promise<void> {
  console.log('  Seeding offer templates...');

  const actorRows = await sql`
    SELECT COALESCE(
      (SELECT id FROM users WHERE role = 'STOCK_MANAGER' ORDER BY created_at ASC NULLS LAST LIMIT 1),
      (SELECT id FROM users WHERE role = 'SUPER_ADMIN' LIMIT 1),
      (SELECT id FROM users ORDER BY created_at ASC NULLS LAST LIMIT 1)
    ) AS id
  `;
  const createdBy = (actorRows[0] as { id: string | null } | undefined)?.id ?? null;

  if (!createdBy) {
    console.log('  Skipping offer_templates: no users found for created_by.');
    return;
  }

  const productRows = await sql`
    SELECT id, name
    FROM products
    WHERE name = ANY(${DEFAULT_OFFER_TEMPLATES.map((o) => o.productName)})
      AND status = 'ACTIVE'
  `;
  const productIdByName = new Map(
    productRows.map((row) => [String((row as { name: string }).name), String((row as { id: string }).id)]),
  );

  let insertedOrExisting = 0;
  for (const offer of DEFAULT_OFFER_TEMPLATES) {
    const productId = productIdByName.get(offer.productName);
    if (!productId) {
      console.log(`  Skipping offer template "${offer.name}": product not found (${offer.productName}).`);
      continue;
    }

    await sql`
      INSERT INTO offer_templates (id, product_id, name, price, variants, created_by, status)
      SELECT gen_random_uuid(), ${productId}, ${offer.name}, ${offer.price}, ${offer.variants}::jsonb, ${createdBy}, 'ACTIVE'
      WHERE NOT EXISTS (
        SELECT 1
        FROM offer_templates ot
        WHERE ot.product_id = ${productId} AND ot.name = ${offer.name}
      )
    `;
    insertedOrExisting++;
  }

  if (insertedOrExisting === 0) {
    console.log('  No offer_templates inserted (all dependencies missing or records already present).');
  }
}

/**
 * Ensures every non-SuperAdmin user has at least one user_branches row.
 * Uses the MAIN_BRANCH_ID constant. Idempotent — safe to run repeatedly.
 */
async function seedUserBranches(sql: postgres.Sql): Promise<void> {
  console.log('  Seeding user_branches memberships...');

  // Check the main branch exists first
  const branchRows = await sql`SELECT id FROM branches WHERE id = ${MAIN_BRANCH_ID} LIMIT 1`;
  if (branchRows.length === 0) {
    console.log(`  Skipping user_branches: branch ${MAIN_BRANCH_ID} not found.`);
    return;
  }

  const result = await sql`
    INSERT INTO user_branches (user_id, branch_id, is_primary)
    SELECT u.id, ${MAIN_BRANCH_ID}, true
    FROM users u
    WHERE u.role != 'SUPER_ADMIN'
      AND NOT EXISTS (
        SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id
      )
    ON CONFLICT DO NOTHING
  `;
  console.log(`  user_branches: ${result.count ?? 0} new memberships assigned.`);
}

async function seed() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });
  try {
    console.log('Seeding minimal data...\n');
    await seedUserBranches(sql);
    await seedMessageTemplates(sql);
    await seedOfferTemplates(sql);

    console.log('\n========================================');
    console.log('  Minimal seed complete');
    console.log('========================================');
    console.log('  Seeded domains: user_branches, message_templates, offer_templates');
    console.log('');
  } finally {
    await sql.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
