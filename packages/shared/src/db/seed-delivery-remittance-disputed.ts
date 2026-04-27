import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';
import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';

config({ path: resolve(__dirname, '../../../../.env') });

faker.seed(20260427);

const TARGET_COUNT = 4;
const DISPUTE_REASON_PREFIX = '[SEED] Demo disputed remittance';

async function seedDisputedDeliveryRemittances() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  const users = await sql`
    SELECT id, role, logistics_location_id
    FROM users
    WHERE status = 'ACTIVE'
  `;
  const superAdmin = users.find((u: Record<string, unknown>) => u.role === 'SUPER_ADMIN');
  const financeOfficer = users.find((u: Record<string, unknown>) => u.role === 'FINANCE_OFFICER');
  const csAgent = users.find((u: Record<string, unknown>) => u.role === 'CS_AGENT');
  const mediaBuyer = users.find((u: Record<string, unknown>) => u.role === 'MEDIA_BUYER');
  const tplManager = users.find((u: Record<string, unknown>) => u.role === 'TPL_MANAGER');
  const rider = users.find((u: Record<string, unknown>) => u.role === 'TPL_RIDER');

  if (!superAdmin || !csAgent || !mediaBuyer || !tplManager) {
    console.error('Missing required users (SUPER_ADMIN, CS_AGENT, MEDIA_BUYER, TPL_MANAGER).');
    await sql.end();
    process.exit(1);
  }

  const [branch] = await sql`SELECT id FROM branches WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`;
  const [campaign] = await sql`SELECT id FROM campaigns WHERE media_buyer_id = ${mediaBuyer.id as string} ORDER BY created_at LIMIT 1`;
  const [product] = await sql`SELECT id FROM products WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1`;
  const [location] = await sql`
    SELECT id, provider_id
    FROM logistics_locations
    WHERE status = 'ACTIVE'
      AND id = ${tplManager.logistics_location_id as string}
    LIMIT 1
  `;

  if (!branch || !campaign || !product || !location) {
    console.error('Missing required branch/campaign/product/location base data.');
    await sql.end();
    process.exit(1);
  }

  await sql`SELECT set_config('yannis.current_user_id', ${superAdmin.id as string}, true)`;

  const existing = await sql`
    SELECT id
    FROM delivery_remittances
    WHERE status = 'DISPUTED'
      AND dispute_reason LIKE ${DISPUTE_REASON_PREFIX + '%'}
    ORDER BY sent_at DESC
  `;
  const remaining = Math.max(0, TARGET_COUNT - existing.length);
  if (remaining === 0) {
    console.log(`Already have ${TARGET_COUNT} disputed remittance demo rows. Nothing to do.`);
    await sql.end();
    return;
  }

  console.log(`Creating ${remaining} disputed remittance demo row(s)...`);
  for (let i = 0; i < remaining; i++) {
    const orderId = randomUUID();
    const now = new Date();
    const createdAt = new Date(now.getTime() - faker.number.int({ min: 1, max: 7 }) * 24 * 60 * 60 * 1000);
    const deliveredAt = new Date(createdAt.getTime() + faker.number.int({ min: 6, max: 24 }) * 60 * 60 * 1000);
    const qty = faker.number.int({ min: 1, max: 2 });
    const unitPrice = faker.number.int({ min: 12000, max: 32000 });
    const totalAmount = qty * unitPrice;

    await sql`
      INSERT INTO orders (
        id, branch_id, campaign_id, media_buyer_id, assigned_cs_id, logistics_provider_id,
        logistics_location_id, rider_id, status, customer_name, customer_phone_hash, customer_phone,
        customer_address, delivery_address, total_amount, landed_cost, delivery_fee, delivery_otp,
        items, created_at, delivered_at, preferred_delivery_date
      ) VALUES (
        ${orderId}, ${branch.id as string}, ${campaign.id as string}, ${mediaBuyer.id as string},
        ${csAgent.id as string}, ${location.provider_id as string}, ${location.id as string},
        ${(rider?.id as string) ?? null}, 'DELIVERED', ${faker.person.fullName()},
        ${'seed_disputed_' + faker.string.alphanumeric(8)},
        ${'0' + faker.helpers.arrayElement(['7', '8', '9']) + faker.string.numeric(9)},
        ${faker.location.streetAddress()}, ${faker.location.streetAddress()},
        ${String(totalAmount)}, ${String(Math.round(totalAmount * 0.45))}, '2000',
        ${faker.string.numeric(4)},
        ${JSON.stringify([{ productId: product.id as string, quantity: qty, unitPrice }])}::jsonb,
        ${createdAt}, ${deliveredAt}, ${deliveredAt}
      )
    `;

    await sql`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, batch_id)
      VALUES (gen_random_uuid(), ${orderId}, ${product.id as string}, ${qty}, ${String(unitPrice)}, NULL)
    `;

    const remittanceId = randomUUID();
    await sql`
      INSERT INTO delivery_remittances (
        id, logistics_location_id, sent_by, receipt_urls, status, sent_at, received_at, received_by, dispute_reason
      ) VALUES (
        ${remittanceId}, ${location.id as string}, ${tplManager.id as string},
        ${JSON.stringify(['https://storage.example.com/receipts/demo-disputed-remittance.jpg'])}::jsonb,
        'DISPUTED', ${deliveredAt}, ${new Date(deliveredAt.getTime() + 60 * 60 * 1000)},
        ${(financeOfficer?.id as string) ?? (superAdmin.id as string)},
        ${`${DISPUTE_REASON_PREFIX} #${existing.length + i + 1}`}
      )
    `;

    await sql`
      INSERT INTO delivery_remittance_orders (id, delivery_remittance_id, order_id)
      VALUES (gen_random_uuid(), ${remittanceId}, ${orderId})
    `;
  }

  console.log('Done. Refresh /admin/finance/delivery-remittances and filter to Disputed.');
  await sql.end();
}

seedDisputedDeliveryRemittances().catch((err) => {
  console.error('Failed to seed disputed delivery remittances:', err);
  process.exit(1);
});
