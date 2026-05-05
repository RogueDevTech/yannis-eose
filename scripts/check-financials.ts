import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env['DATABASE_URL']!, { max: 1 });

  const rev = await sql`SELECT COALESCE(SUM(total_amount::numeric), 0) as revenue, COUNT(*) as cnt FROM orders WHERE status IN ('DELIVERED','REMITTED')`;
  console.log('Revenue (delivered/completed):', Number(rev[0]!.revenue).toLocaleString(), '|', rev[0]!.cnt, 'orders');

  const ads = await sql`SELECT COALESCE(SUM(spend_amount::numeric), 0) as total_ad_spend, COUNT(*) as cnt FROM ad_spend_logs`;
  console.log('Ad Spend:', Number(ads[0]!.total_ad_spend).toLocaleString(), '|', ads[0]!.cnt, 'entries');

  const cogs = await sql`SELECT COALESCE(SUM(landed_cost::numeric), 0) as total_landed_cost FROM orders WHERE status IN ('DELIVERED','REMITTED')`;
  console.log('Landed COGS:', Number(cogs[0]!.total_landed_cost).toLocaleString());

  const del = await sql`SELECT COALESCE(SUM(delivery_fee::numeric), 0) as total_delivery_fees FROM orders WHERE status IN ('DELIVERED','REMITTED')`;
  console.log('Delivery Fees:', Number(del[0]!.total_delivery_fees).toLocaleString());

  const pay = await sql`SELECT COALESCE(SUM(total_payout::numeric), 0) as total_payouts, COUNT(*) as cnt FROM payout_records`;
  console.log('Payouts:', Number(pay[0]!.total_payouts).toLocaleString(), '|', pay[0]!.cnt, 'records');

  const statuses = await sql`SELECT status, COUNT(*) as cnt, COALESCE(SUM(total_amount::numeric), 0) as total FROM orders GROUP BY status ORDER BY cnt DESC`;
  console.log('\nOrders by status:');
  statuses.forEach((r: Record<string, unknown>) => console.log('  ', r.status, ':', r.cnt, 'orders, revenue:', Number(r.total).toLocaleString()));

  const revenue = Number(rev[0]!.revenue);
  const adSpend = Number(ads[0]!.total_ad_spend);
  const landedCost = Number(cogs[0]!.total_landed_cost);
  const deliveryFees = Number(del[0]!.total_delivery_fees);
  const payouts = Number(pay[0]!.total_payouts);
  const totalCosts = landedCost + adSpend + deliveryFees + payouts;
  const profit = revenue - totalCosts;

  console.log('\n========================================');
  console.log('  P&L Summary');
  console.log('========================================');
  console.log(`  Revenue:        ₦${revenue.toLocaleString()}`);
  console.log(`  Landed COGS:   -₦${landedCost.toLocaleString()}`);
  console.log(`  Ad Spend:      -₦${adSpend.toLocaleString()}`);
  console.log(`  Delivery Fees: -₦${deliveryFees.toLocaleString()}`);
  console.log(`  Payouts:       -₦${payouts.toLocaleString()}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Total Costs:   -₦${totalCosts.toLocaleString()}`);
  console.log(`  True Profit:    ₦${profit.toLocaleString()}`);
  console.log(`  Margin:         ${((profit / revenue) * 100).toFixed(1)}%`);
  console.log(`  ROAS:           ${(revenue / adSpend).toFixed(1)}x`);

  // What we need to flip positive
  if (profit < 0) {
    const deficit = Math.abs(profit);
    // Each boost order avg ~₦10k revenue, ~₦3k cost = ~₦7k profit
    const avgProfitPerOrder = 5000;
    const ordersNeeded = Math.ceil(deficit / avgProfitPerOrder) + 100; // buffer
    console.log(`\n  DEFICIT: ₦${deficit.toLocaleString()}`);
    console.log(`  Need ~${ordersNeeded} more high-margin orders to flip positive`);
  }

  await sql.end();
}
main();
