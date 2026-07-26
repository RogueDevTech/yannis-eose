/**
 * Seed payroll history for a specific contractor.
 * Creates batches + payout records across several months with varying statuses.
 *
 * Usage:
 *   pnpm --filter @yannis/shared tsx scripts/seed-contractor-history.ts <contractorId>
 *
 * Example:
 *   pnpm --filter @yannis/shared tsx scripts/seed-contractor-history.ts 019f9513-0b25-7cb9-a065-9107422b7eda
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

type Sql = ReturnType<typeof postgres>;

async function main() {
  const contractorId = process.argv[2];
  if (!contractorId) {
    console.error('Usage: tsx scripts/seed-contractor-history.ts <contractorId>');
    process.exit(1);
  }

  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  try {
    // 1. Fetch the contractor
    const contractors = await sql<{ id: string; name: string; monthly_fee: string; branch_id: string | null; group_id: string | null }[]>`
      SELECT id, name, monthly_fee, branch_id, group_id
      FROM payroll_contractors
      WHERE id = ${contractorId} AND valid_to IS NULL
    `;
    if (!contractors[0]) {
      console.error(`Contractor ${contractorId} not found`);
      process.exit(1);
    }
    const contractor = contractors[0]!;
    console.log(`\nSeeding history for contractor: ${contractor.name} (fee: ${contractor.monthly_fee})\n`);

    // 2. Pick a branch — use contractor's branch or first active branch
    let branchId = contractor.branch_id;
    if (!branchId) {
      const branches = await sql<{ id: string }[]>`
        SELECT id FROM branches WHERE status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1
      `;
      branchId = branches[0]?.id ?? null;
    }
    if (!branchId) {
      console.error('No active branch found');
      process.exit(1);
    }

    // 3. Get a SuperAdmin for prepared_by / submitted_by etc.
    const admins = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1
    `;
    const adminId = admins[0]?.id;
    if (!adminId) {
      console.error('No active SUPER_ADMIN found');
      process.exit(1);
    }

    // Try to find an HR_MANAGER for hr_reviewed_by
    const hrManagers = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'HR_MANAGER' AND status = 'ACTIVE' LIMIT 1
    `;
    const hrManagerId = hrManagers[0]?.id ?? adminId;

    // Try to find a FINANCE_OFFICER for finance_processed_by
    const financeUsers = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'FINANCE_OFFICER' AND status = 'ACTIVE' LIMIT 1
    `;
    const financeId = financeUsers[0]?.id ?? adminId;

    const fee = contractor.monthly_fee;

    // 4. Define months to seed — 6 months of history
    const months: Array<{
      periodMonth: string;
      department: string;
      batchStatus: 'DRAFT' | 'PENDING_HR' | 'PENDING_FINANCE' | 'PAID';
      payoutStatus: 'DRAFT' | 'APPROVED' | 'PAID';
      financeRef?: string;
      disbursementDate?: string;
    }> = [
      {
        periodMonth: '2026-01-01',
        department: 'HR',
        batchStatus: 'PAID',
        payoutStatus: 'PAID',
        financeRef: 'TRF-JAN-2026-001',
        disbursementDate: '2026-02-05',
      },
      {
        periodMonth: '2026-02-01',
        department: 'HR',
        batchStatus: 'PAID',
        payoutStatus: 'PAID',
        financeRef: 'TRF-FEB-2026-001',
        disbursementDate: '2026-03-04',
      },
      {
        periodMonth: '2026-03-01',
        department: 'HR',
        batchStatus: 'PAID',
        payoutStatus: 'PAID',
        financeRef: 'TRF-MAR-2026-001',
        disbursementDate: '2026-04-03',
      },
      {
        periodMonth: '2026-04-01',
        department: 'HR',
        batchStatus: 'PAID',
        payoutStatus: 'PAID',
        financeRef: 'TRF-APR-2026-001',
        disbursementDate: '2026-05-06',
      },
      {
        periodMonth: '2026-05-01',
        department: 'HR',
        batchStatus: 'PAID',
        payoutStatus: 'PAID',
        financeRef: 'TRF-MAY-2026-001',
        disbursementDate: '2026-06-04',
      },
      {
        periodMonth: '2026-06-01',
        department: 'HR',
        batchStatus: 'PENDING_FINANCE',
        payoutStatus: 'APPROVED',
      },
      {
        periodMonth: '2026-07-01',
        department: 'HR',
        batchStatus: 'DRAFT',
        payoutStatus: 'DRAFT',
      },
    ];

    for (const m of months) {
      // Check if a batch already exists for this branch/month/department
      const existing = await sql<{ id: string }[]>`
        SELECT id FROM payroll_batches
        WHERE branch_id = ${branchId}
          AND period_month = ${m.periodMonth}
          AND department = ${m.department}::payroll_department
          AND valid_to IS NULL
        LIMIT 1
      `;

      let batchId: string;

      if (existing[0]) {
        batchId = existing[0].id;
        // Check if payout already exists for this contractor in this batch
        const existingPayout = await sql<{ id: string }[]>`
          SELECT id FROM payout_records
          WHERE batch_id = ${batchId} AND contractor_id = ${contractorId} AND valid_to IS NULL
          LIMIT 1
        `;
        if (existingPayout[0]) {
          console.log(`  ${m.periodMonth} — payout already exists, skipping`);
          continue;
        }
      } else {
        // Create batch
        batchId = uuidv7();
        const periodStart = new Date(m.periodMonth);
        const preparedAt = new Date(periodStart);
        preparedAt.setDate(25); // Prepared on the 25th of the month

        const submittedAt = m.batchStatus !== 'DRAFT' ? new Date(preparedAt.getTime() + 2 * 86400_000) : null;
        const hrReviewedAt = (m.batchStatus === 'PENDING_FINANCE' || m.batchStatus === 'PAID')
          ? new Date((submittedAt?.getTime() ?? preparedAt.getTime()) + 2 * 86400_000)
          : null;
        const financeProcessedAt = m.batchStatus === 'PAID'
          ? new Date((hrReviewedAt?.getTime() ?? preparedAt.getTime()) + 3 * 86400_000)
          : null;

        await sql`
          INSERT INTO payroll_batches (
            id, branch_id, period_month, department, status,
            include_contractors, staff_count, total_amount, total_gross, total_tax, total_net,
            prepared_by, prepared_at,
            submitted_by, submitted_at,
            hr_reviewed_by, hr_reviewed_at,
            finance_processed_by, finance_processed_at,
            finance_reference, disbursement_date,
            created_at, updated_at
          ) VALUES (
            ${batchId}, ${branchId}, ${m.periodMonth}, ${m.department}::payroll_department, ${m.batchStatus}::payroll_batch_status,
            true, 1, ${fee}::numeric, ${fee}::numeric, ${'0'}::numeric, ${fee}::numeric,
            ${adminId}, ${preparedAt.toISOString()},
            ${submittedAt ? adminId : null}, ${submittedAt?.toISOString() ?? null},
            ${hrReviewedAt ? hrManagerId : null}, ${hrReviewedAt?.toISOString() ?? null},
            ${financeProcessedAt ? financeId : null}, ${financeProcessedAt?.toISOString() ?? null},
            ${m.financeRef ?? null}, ${m.disbursementDate ?? null},
            now(), now()
          )
        `;
      }

      // Create payout record
      const payoutId = uuidv7();
      const periodStart = new Date(m.periodMonth);
      const periodEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59);

      await sql`
        INSERT INTO payout_records (
          id, batch_id, staff_id, contractor_id,
          period_start, period_end,
          base_salary, performance_bonus, add_ons_total, deductions_total, total_payout,
          allowances_total, gross_pay, paye_tax, employer_paye_subsidy, net_pay,
          pay_role_name, line_status, status, created_at
        ) VALUES (
          ${payoutId}, ${batchId}, NULL, ${contractorId},
          ${periodStart.toISOString()}, ${periodEnd.toISOString()},
          ${fee}::numeric, ${'0'}::numeric, ${'0'}::numeric, ${'0'}::numeric, ${fee}::numeric,
          ${'0'}::numeric, ${fee}::numeric, ${'0'}::numeric, ${'0'}::numeric, ${fee}::numeric,
          ${contractor.name}, 'OK'::payroll_payslip_line_status, ${m.payoutStatus}::payout_status, now()
        )
      `;

      console.log(`  ${m.periodMonth} — batch ${m.batchStatus}, payout ${m.payoutStatus} ✓`);
    }

    console.log('\n  Done — contractor now has 7 months of payroll history.\n');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
