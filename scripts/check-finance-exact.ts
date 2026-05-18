import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../.env') });

import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env['DATABASE_URL']!, { max: 1 });

  // Revenue: ONLY DELIVERED (how finance.service.ts calculates it)
  const rev = await sql`SELECT COALESCE(SUM(total_amount::numeric), 0) as revenue, COALESCE(SUM(landed_cost::numeric), 0) as landed_cost, COALESCE(SUM(delivery_fee::numeric), 0) as delivery_fee, COUNT(*) as cnt FROM orders WHERE status = 'DELIVERED'`;

  // Ad spend: only APPROVED
  const ads = await sql`SELECT COALESCE(SUM(spend_amount::numeric), 0) as total FROM ad_spend_logs WHERE status = 'APPROVED'`;

  // Commission: APPROVED + PAID payouts
  const comm = await sql`SELECT COALESCE(SUM(total_payout::numeric), 0) as total, COUNT(*) as cnt FROM payout_records WHERE status IN ('APPROVED', 'PAID')`;

  // Fulfillment cost: RECEIVED + DISPUTED transfers
  const fulfillment = await sql`SELECT COALESCE(SUM(transfer_cost::numeric), 0) as total FROM stock_transfers WHERE transfer_status IN ('RECEIVED', 'DISPUTED')`;

  // Write-off loss
  const writeOff = await sql`
    SELECT COALESCE(SUM(
      sm.quantity * (
        SELECT COALESCE(AVG(CAST(sb.total_landed_cost AS numeric) / NULLIF(sb.quantity, 0)), 0)
        FROM stock_batches sb WHERE sb.product_id = sm.product_id
      )
    ), 0) AS total
    FROM stock_movements sm WHERE sm.movement_type = 'WRITE_OFF'
  `;

  // Shrinkage loss
  const shrinkage = await sql`
    SELECT COALESCE(SUM(
      (st.quantity_sent - COALESCE(st.quantity_received, 0)) * (
        SELECT COALESCE(AVG(CAST(sb.total_landed_cost AS numeric) / NULLIF(sb.quantity, 0)), 0)
        FROM stock_batches sb WHERE sb.product_id = st.product_id
      )
    ), 0) AS total
    FROM stock_transfers st WHERE st.transfer_status = 'DISPUTED'
  `;

  const revenue = Number(rev[0]!.revenue);
  const landedCost = Number(rev[0]!.landed_cost);
  const deliveryFee = Number(rev[0]!.delivery_fee);
  const adSpend = Number(ads[0]!.total);
  const commission = Number(comm[0]!.total);
  const fulfillmentCost = Number(fulfillment[0]!.total);
  const writeOffLoss = Number(writeOff[0]!.total);
  const shrinkageLoss = Number(shrinkage[0]!.total);
  const operationalLoss = writeOffLoss + shrinkageLoss;
  const totalCosts = landedCost + deliveryFee + adSpend + commission + fulfillmentCost + operationalLoss;
  const trueProfit = revenue - totalCosts;
  const margin = revenue > 0 ? (trueProfit / revenue) * 100 : 0;

  console.log('========================================');
  console.log('  Finance Dashboard P&L (Exact Match)');
  console.log('========================================');
  console.log(`  Delivered orders: ${rev[0]!.cnt}`);
  console.log(`  Revenue:            ₦${revenue.toLocaleString()}`);
  console.log(`  Landed COGS:       -₦${landedCost.toLocaleString()}`);
  console.log(`  Delivery Fees:     -₦${deliveryFee.toLocaleString()}`);
  console.log(`  Ad Spend (approved):-₦${adSpend.toLocaleString()}`);
  console.log(`  Commission (payouts):-₦${commission.toLocaleString()}`);
  console.log(`  Fulfillment:       -₦${fulfillmentCost.toLocaleString()}`);
  console.log(`  Write-offs:        -₦${writeOffLoss.toLocaleString()}`);
  console.log(`  Shrinkage:         -₦${shrinkageLoss.toLocaleString()}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Total Costs:       -₦${totalCosts.toLocaleString()}`);
  console.log(`  True Profit:        ₦${trueProfit.toLocaleString()}`);
  console.log(`  Net Margin:         ${margin.toFixed(1)}%`);

  if (trueProfit < 0) {
    const deficit = Math.abs(trueProfit);
    console.log(`\n  STILL NEGATIVE by ₦${deficit.toLocaleString()}`);
    // Each boost order: ~₦10.5k revenue, ~₦2.8k landed, ~₦2k delivery = ~₦5.7k net before ad/comm
    console.log(`  Need ~${Math.ceil(deficit / 4000) + 200} more boost orders`);
  }

  await sql.end();
}
main();
