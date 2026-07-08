/**
 * Seed ad_spend_logs with PENDING expenses for today.
 *
 * Usage:
 *   pnpm --filter @yannis/shared db:seed:expenses-today
 *
 * Resolves MBs, campaigns, and products from a specific company (branch group)
 * then inserts ~15 PENDING expenses so the bulk-approve flow can be tested.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Prefer the API .env (which has the active dev DATABASE_URL), fall back to root .env
config({ path: resolve(__dirname, '../../../../apps/api/.env') });
config({ path: resolve(__dirname, '../../../../.env') });

import postgres from 'postgres';

const COMPANY_ID = '833a1030-292c-4988-9c3f-6bd8450b8635';
const PLATFORMS = ['FACEBOOK', 'TIKTOK', 'GOOGLE', 'FACEBOOK', 'FACEBOOK'] as const;

async function seedExpensesToday() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  console.log('========================================');
  console.log('  Seed Today\'s Expenses (PENDING)');
  console.log(`  Company: ${COMPANY_ID}`);
  console.log('========================================\n');

  // 1. Resolve branches for this company
  const branches = await sql`
    SELECT id, name FROM branches
    WHERE group_id = ${COMPANY_ID} AND status = 'ACTIVE'
  `;
  if (branches.length === 0) {
    console.error('No active branches found for company. Aborting.');
    await sql.end();
    process.exit(1);
  }
  const branchIds = branches.map((b: Record<string, unknown>) => b.id as string);
  console.log(`  Found ${branches.length} branches: ${branches.map((b: Record<string, unknown>) => b.name).join(', ')}`);

  // 2. Find campaigns in these branches (with products)
  const campaigns = await sql`
    SELECT c.id, c.media_buyer_id, c.name, c.product_ids, c.branch_id
    FROM campaigns c
    WHERE c.branch_id = ANY(${branchIds})
      AND c.status = 'ACTIVE'
    ORDER BY random()
    LIMIT 15
  `;
  if (campaigns.length === 0) {
    console.error('No active campaigns found in company branches. Aborting.');
    await sql.end();
    process.exit(1);
  }
  console.log(`  Found ${campaigns.length} active campaigns`);

  // 3. Resolve a product for each campaign
  const allProductIds = new Set<string>();
  for (const c of campaigns) {
    const pids = Array.isArray(c.product_ids) ? c.product_ids : [];
    for (const pid of pids) allProductIds.add(pid as string);
  }

  const products = allProductIds.size > 0
    ? await sql`SELECT id FROM products WHERE id = ANY(${[...allProductIds]})`
    : [];
  const productIdSet = new Set(products.map((p: Record<string, unknown>) => p.id as string));

  // 4. Set actor for audit triggers
  await sql`SELECT set_config('yannis.current_user_id', '00000000-0000-0000-0000-000000000000', false)`;

  // 5. Insert PENDING expenses
  // Use Nigeria timezone (WAT, UTC+1) so the date matches nigeriaDayStart/End filters
  const nowNigeria = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }));
  const todayStr = `${nowNigeria.getFullYear()}-${String(nowNigeria.getMonth() + 1).padStart(2, '0')}-${String(nowNigeria.getDate()).padStart(2, '0')}`;
  const today = new Date(`${todayStr}T12:00:00+01:00`); // noon WAT — safely within the Nigeria day window
  let inserted = 0;

  for (let i = 0; i < campaigns.length; i++) {
    const camp = campaigns[i]!;
    const pids = Array.isArray(camp.product_ids) ? camp.product_ids : [];
    const productId = pids.find((pid: unknown) => productIdSet.has(pid as string)) as string | undefined ?? null;
    const amount = 5000 + Math.floor(Math.random() * 75000);
    const platform = PLATFORMS[i % PLATFORMS.length]!;

    await sql`
      INSERT INTO ad_spend_logs (
        id, media_buyer_id, product_id, campaign_id,
        spend_amount, screenshot_url, ad_url, platform, category,
        spend_date, status, created_at
      ) VALUES (
        gen_random_uuid(),
        ${camp.media_buyer_id as string},
        ${productId},
        ${camp.id as string},
        ${String(amount)}::numeric(12,2),
        ${'https://storage.example.com/screenshots/test-expense-' + i + '.jpg'},
        ${'https://facebook.com/ads/test-' + i},
        ${platform}::ad_platform,
        'AD_SPEND'::expense_category,
        ${today}::timestamp with time zone,
        'PENDING',
        NOW()
      )
    `;
    inserted++;
    console.log(`    [${inserted}] ${camp.name} — ₦${amount.toLocaleString()} (${platform})`);
  }

  // 6. Also add a couple non-AD_SPEND expenses
  const firstMb = campaigns[0]!;
  const extraCategories = [
    { category: 'WHATSAPP_CAMPAIGN', desc: 'WhatsApp broadcast for June promo', amount: 12000 },
    { category: 'RECRUITMENT_AD', desc: 'Recruitment ad for new closers', amount: 25000 },
    { category: 'UGC_PRODUCTION', desc: 'UGC video production for skincare line', amount: 8500 },
  ];

  for (const extra of extraCategories) {
    await sql`
      INSERT INTO ad_spend_logs (
        id, media_buyer_id, spend_amount, screenshot_url, platform, category, description,
        spend_date, status, created_at
      ) VALUES (
        gen_random_uuid(),
        ${firstMb.media_buyer_id as string},
        ${String(extra.amount)}::numeric(12,2),
        ${'https://storage.example.com/screenshots/test-' + extra.category.toLowerCase() + '.jpg'},
        'OTHER'::ad_platform,
        ${extra.category}::expense_category,
        ${extra.desc},
        ${today}::timestamp with time zone,
        'PENDING',
        NOW()
      )
    `;
    inserted++;
    console.log(`    [${inserted}] ${extra.category} — ₦${extra.amount.toLocaleString()}`);
  }

  console.log(`\n  ✓ Inserted ${inserted} PENDING expenses for ${today.toISOString().slice(0, 10)}`);

  await sql.end();
}

seedExpensesToday().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
