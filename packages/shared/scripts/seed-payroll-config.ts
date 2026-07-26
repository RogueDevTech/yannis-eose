/**
 * Seed payroll PRD config: pay roles, product tiers, PAYE bands, commission formulas.
 * Seeds each ACTIVE company (branch_groups row) independently — no shared null group_id rows.
 * Usage: pnpm --filter @yannis/shared db:seed-payroll-config
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';
import { defaultPayeBandConfig } from '../src/hr/paye-calc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

type Sql = ReturnType<typeof postgres>;

async function getActiveGroupIds(sql: Sql): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM branch_groups WHERE status = 'ACTIVE' ORDER BY created_at ASC
  `;
  return rows.map((r) => r.id);
}

async function getSuperAdminId(sql: Sql): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

/** Section 6 canonical role formulas as payroll_v1 JSONB. */
function buildCanonicalFormulas(): Array<{
  name: string;
  category: string;
  reportsToRequired: boolean;
  perProductBonus: boolean;
  rules: Record<string, unknown>;
}> {
  return [
    {
      name: 'Sales Closer (CS)',
      category: 'CS',
      reportsToRequired: false,
      perProductBonus: true,
      rules: {
        schemaVersion: 'payroll_v1',
        baseSalaryTiers: [
          { metric: 'INDIVIDUAL_DR', operator: 'LT', threshold: 40, amount: 75000 },
          { metric: 'INDIVIDUAL_DR', operator: 'GTE', threshold: 40, amount: 120000 },
        ],
        perProductBonus: true,
        bonusTiers: [],
      },
    },
    {
      name: 'Customer Service (Remote CS)',
      category: 'CS',
      reportsToRequired: false,
      perProductBonus: false,
      rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 150000 },
    },
    {
      name: 'Customer Experience Centre (Onsite CS)',
      category: 'CS',
      reportsToRequired: false,
      perProductBonus: false,
      rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 80000 },
    },
    {
      name: 'Head of CS',
      category: 'LEADERSHIP',
      reportsToRequired: true,
      perProductBonus: false,
      rules: {
        schemaVersion: 'payroll_v1',
        flatBaseSalary: 350000,
        allowances: [{ name: 'Transport', amount: 0, taxable: true }],
        bonusTiers: [
          { metric: 'TEAM_DR', operator: 'GTE', threshold: 60, kind: 'FLAT', amount: 400000 },
          { metric: 'TEAM_DR', operator: 'GTE', threshold: 50, kind: 'FLAT', amount: 300000 },
          { metric: 'TEAM_DR', operator: 'GTE', threshold: 40, kind: 'FLAT', amount: 200000 },
        ],
        employerPayeSubsidy: { metric: 'TEAM_DR', operator: 'GTE', threshold: 60, subsidyPercent: 50 },
      },
    },
    {
      name: 'Remote Media Buyer',
      category: 'MEDIA_BUYING',
      reportsToRequired: false,
      perProductBonus: false,
      rules: {
        schemaVersion: 'payroll_v1',
        flatBaseSalary: 100000,
        allowances: [{ name: 'Data', amount: 20000, taxable: true }],
        minimumFloor: { metric: 'INDIVIDUAL_DR', operator: 'LT', threshold: 35, fallbackBonus: 0 },
        bonusTiers: [
          { metric: 'CPA', operator: 'LTE', threshold: 10000, kind: 'PER_ORDER', amount: 1000 },
          { metric: 'CPA', operator: 'GT', threshold: 10000, kind: 'PER_ORDER', amount: 500 },
        ],
      },
    },
    {
      name: 'Onsite Media Buyer',
      category: 'MEDIA_BUYING',
      reportsToRequired: false,
      perProductBonus: false,
      rules: {
        schemaVersion: 'payroll_v1',
        flatBaseSalary: 150000,
        minimumFloor: { metric: 'INDIVIDUAL_DR', operator: 'LT', threshold: 35, fallbackBonus: 0 },
        bonusTiers: [
          { metric: 'CPA', operator: 'LTE', threshold: 10000, kind: 'PER_ORDER', amount: 500 },
          { metric: 'CPA', operator: 'LTE', threshold: 11000, kind: 'PER_ORDER', amount: 250 },
          { metric: 'CPA', operator: 'LTE', threshold: 12000, kind: 'PER_ORDER', amount: 200 },
          { metric: 'CPA', operator: 'LTE', threshold: 13000, kind: 'PER_ORDER', amount: 100 },
        ],
      },
    },
    {
      name: 'Video Editor',
      category: 'OPERATIONS',
      reportsToRequired: false,
      perProductBonus: false,
      rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 150000 },
    },
    {
      name: 'Company Driver',
      category: 'OPERATIONS',
      reportsToRequired: false,
      perProductBonus: false,
      rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 200000 },
    },
    {
      name: 'Cleaner',
      category: 'OPERATIONS',
      reportsToRequired: false,
      perProductBonus: false,
      rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 70000 },
    },
  ];
}

async function seedCompany(sql: Sql, groupId: string, createdBy: string) {
  console.log(`\n  Company ${groupId}`);

  const paye = defaultPayeBandConfig();
  const existingTax = await sql<{ id: string }[]>`
    SELECT id FROM payroll_tax_band_configs
    WHERE group_id = ${groupId} AND valid_to IS NULL AND effective_to IS NULL
    LIMIT 1
  `;
  if (!existingTax[0]) {
    await sql`
      INSERT INTO payroll_tax_band_configs (
        id, group_id, label, tax_free_threshold, bands, reliefs,
        effective_from, created_by, created_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${groupId}, ${'Default PAYE (placeholder — Finance must confirm)'},
        ${paye.taxFreeThreshold}, ${sql.json(paye.bands)}, ${sql.json(paye.reliefs)},
        ${new Date().toISOString()}, ${createdBy}, now(), now()
      )
    `;
    console.log('    PAYE tax band config seeded');
  } else {
    console.log('    PAYE tax band config already present');
  }

  const productTiers = [
    {
      name: 'Janis Product',
      tiers: [
        { fromPct: 0, toPct: 34.99, ratePerOrder: 100 },
        { fromPct: 35, toPct: 39.99, ratePerOrder: 250 },
        { fromPct: 40, toPct: null, ratePerOrder: 500 },
      ],
    },
    {
      name: 'Life Wellness',
      tiers: [
        { fromPct: 0, toPct: 39.99, ratePerOrder: 100 },
        { fromPct: 40, toPct: 49.99, ratePerOrder: 250 },
        { fromPct: 60, toPct: null, ratePerOrder: 500 },
      ],
    },
  ];

  for (const p of productTiers) {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM payroll_product_tier_configs
      WHERE group_id = ${groupId}
        AND product_name = ${p.name}
        AND valid_to IS NULL
        AND effective_to IS NULL
      LIMIT 1
    `;
    if (existing[0]) continue;
    await sql`
      INSERT INTO payroll_product_tier_configs (
        id, group_id, product_name, active, tier_rows, effective_from, created_by, created_at, updated_at
      ) VALUES (
        ${uuidv7()}, ${groupId}, ${p.name}, true, ${sql.json(p.tiers)},
        ${new Date().toISOString()}, ${createdBy}, now(), now()
      )
    `;
    console.log(`    Product tier config: ${p.name}`);
  }

  for (const role of buildCanonicalFormulas()) {
    const existingRole = await sql<{ id: string }[]>`
      SELECT id FROM payroll_pay_roles
      WHERE group_id = ${groupId}
        AND name = ${role.name}
        AND valid_to IS NULL
        AND active = true
      LIMIT 1
    `;
    if (existingRole[0]) continue;

    const planId = uuidv7();
    const roleId = uuidv7();
    const now = new Date().toISOString();

    // Pay role must exist before commission_plans.pay_role_id FK is set.
    await sql`
      INSERT INTO payroll_pay_roles (
        id, group_id, name, category, reports_to_required, per_product_bonus,
        commission_plan_id, active, created_at, updated_at
      ) VALUES (
        ${roleId}, ${groupId}, ${role.name}, ${role.category}::payroll_pay_role_category,
        ${role.reportsToRequired}, ${role.perProductBonus}, NULL, true, now(), now()
      )
    `;

    await sql`
      INSERT INTO commission_plans (
        id, group_id, pay_role_id, plan_name, rules, effective_from, created_by, created_at, updated_at
      ) VALUES (
        ${planId}, ${groupId}, ${roleId}, ${role.name + ' Formula'},
        ${sql.json(role.rules)}, ${now}, ${createdBy}, now(), now()
      )
    `;

    await sql`
      UPDATE payroll_pay_roles SET commission_plan_id = ${planId}, updated_at = now()
      WHERE id = ${roleId}
    `;
    console.log(`    Pay role: ${role.name}`);
  }

  const contractors = [
    { name: 'Kingstech Network Limited', fee: 381625 },
    { name: 'Duja Training Limited', fee: 600000 },
  ];
  for (const c of contractors) {
    const exists = await sql<{ id: string }[]>`
      SELECT id FROM payroll_contractors
      WHERE group_id = ${groupId}
        AND name = ${c.name}
        AND valid_to IS NULL
        AND active = true
      LIMIT 1
    `;
    if (exists[0]) continue;
    await sql`
      INSERT INTO payroll_contractors (id, group_id, name, monthly_fee, active, created_at, updated_at)
      VALUES (${uuidv7()}, ${groupId}, ${c.name}, ${c.fee}, true, now(), now())
    `;
    console.log(`    Contractor: ${c.name}`);
  }
}

/**
 * Assign pay_role_id using the pay role for the user's branch company.
 * Never links a user to another company's pay role.
 */
async function backfillUserPayRoles(sql: Sql) {
  const roleMap: Record<string, string> = {
    CS_CLOSER: 'Sales Closer (CS)',
    MEDIA_BUYER: 'Remote Media Buyer',
    HEAD_OF_CS: 'Head of CS',
    HEAD_OF_MARKETING: 'Manager / Head of Marketing (runs ads)',
  };

  for (const [systemRole, payRoleName] of Object.entries(roleMap)) {
    await sql`
      UPDATE users u
      SET pay_role_id = pr.id
      FROM branches b
      INNER JOIN payroll_pay_roles pr
        ON pr.group_id = b.group_id
       AND pr.name = ${payRoleName}
       AND pr.valid_to IS NULL
       AND pr.active = true
      WHERE u.branch_id = b.id
        AND u.role = ${systemRole}::user_role
        AND u.pay_role_id IS NULL
        AND u.status = 'ACTIVE'
        AND b.group_id IS NOT NULL
    `;
  }
  console.log('\n  Backfilled users.pay_role_id from system roles (company-scoped)');
}

async function main() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });
  console.log('Seeding payroll PRD config (per company)...\n');

  try {
    const groupIds = await getActiveGroupIds(sql);
    const createdBy = await getSuperAdminId(sql);
    if (!createdBy) {
      console.warn('  No SUPER_ADMIN found — skipping seed');
      return;
    }
    if (groupIds.length === 0) {
      console.warn('  No ACTIVE branch_groups found — skipping seed');
      return;
    }

    for (const groupId of groupIds) {
      await seedCompany(sql, groupId, createdBy);
    }

    await backfillUserPayRoles(sql);

    // Retire legacy null-scoped rows so they cannot leak across companies.
    await sql`UPDATE payroll_pay_roles SET active = false, updated_at = now() WHERE group_id IS NULL AND active = true`;
    await sql`UPDATE payroll_product_tier_configs SET active = false, effective_to = COALESCE(effective_to, now()), updated_at = now() WHERE group_id IS NULL AND active = true`;
    await sql`UPDATE payroll_tax_band_configs SET effective_to = COALESCE(effective_to, now()), updated_at = now() WHERE group_id IS NULL AND effective_to IS NULL`;
    await sql`UPDATE payroll_contractors SET active = false, updated_at = now() WHERE group_id IS NULL AND active = true`;
    await sql`UPDATE commission_plans SET effective_to = COALESCE(effective_to, now()), updated_at = now() WHERE group_id IS NULL AND effective_to IS NULL`;
    console.log('  Retired legacy null-scoped payroll config rows');

    console.log('\n  Done.\n');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
