/**
 * Supplement to seed-payroll-config.ts: creates the pay roles the canonical
 * seed does not cover (HoM, Logistics, Stock, Finance, Branch Admin, Auditor,
 * Ops Admin), then auto-assigns EVERY active non-SUPER_ADMIN user to the pay
 * role matching their system role and completes their payroll profile
 * (employment type, salary basis, tax status, CRM link, onboarding ACTIVE).
 *
 * Run AFTER: pnpm --filter @yannis/shared db:seed-payroll-config
 * Usage:     pnpm --filter @yannis/shared db:seed-payroll-staff-assign
 *
 * Idempotent: pay roles reused by (group_id, name); assignment only fills
 * users whose pay_role_id is NULL so manual changes are preserved.
 */

import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import { uuidv7 } from 'uuidv7';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '../../../.env') });

type Sql = ReturnType<typeof postgres>;

interface ExtraRole {
  name: string;
  category: string;
  rules: Record<string, unknown>;
}

/** Pay roles referenced by assignment but absent from the canonical PRD seed. */
const EXTRA_ROLES: ExtraRole[] = [
  {
    name: 'Manager / Head of Marketing (runs ads)',
    category: 'HEAD_OF_MARKETING',
    rules: {
      schemaVersion: 'payroll_v1',
      flatBaseSalary: 300000,
      allowances: [{ name: 'Data', amount: 20000, taxable: true }],
      bonusTiers: [
        { metric: 'TEAM_DR', operator: 'GTE', threshold: 55, kind: 'FLAT', amount: 200000 },
        { metric: 'TEAM_DR', operator: 'GTE', threshold: 45, kind: 'FLAT', amount: 100000 },
        { metric: 'TEAM_DR', operator: 'GTE', threshold: 35, kind: 'FLAT', amount: 50000 },
      ],
    },
  },
  {
    name: 'Head of Logistics',
    category: 'HEAD_OF_LOGISTICS',
    rules: {
      schemaVersion: 'payroll_v1',
      flatBaseSalary: 250000,
      allowances: [{ name: 'Fuel', amount: 30000, taxable: true }],
    },
  },
  {
    name: 'Stock Manager',
    category: 'STOCK_MANAGER',
    rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 180000 },
  },
  {
    name: 'Finance Officer',
    category: 'FINANCE_OFFICER',
    rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 250000 },
  },
  {
    name: 'Branch Admin',
    category: 'BRANCH_ADMIN',
    rules: {
      schemaVersion: 'payroll_v1',
      flatBaseSalary: 220000,
      allowances: [{ name: 'Transport', amount: 15000, taxable: true }],
    },
  },
  {
    name: 'Auditor',
    category: 'AUDITOR',
    rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 200000 },
  },
  {
    name: 'Operations Admin',
    category: 'ADMIN',
    rules: { schemaVersion: 'payroll_v1', flatBaseSalary: 350000 },
  },
];

/** system role → pay role name (canonical seed names + extras above). */
const ROLE_TO_PAY_ROLE: Record<string, string> = {
  CS_CLOSER: 'Sales Closer (CS)',
  MEDIA_BUYER: 'Remote Media Buyer',
  HEAD_OF_CS: 'Head of CS',
  HEAD_OF_MARKETING: 'Manager / Head of Marketing (runs ads)',
  HEAD_OF_LOGISTICS: 'Head of Logistics',
  STOCK_MANAGER: 'Stock Manager',
  FINANCE_OFFICER: 'Finance Officer',
  BRANCH_ADMIN: 'Branch Admin',
  AUDITOR: 'Auditor',
  ADMIN: 'Operations Admin',
};

/** Roles whose pay derives from CRM order metrics. */
const CRM_LINKED_ROLES = ['CS_CLOSER', 'MEDIA_BUYER', 'HEAD_OF_CS', 'HEAD_OF_MARKETING'];

async function seedExtraRoles(sql: Sql, groupId: string, createdBy: string) {
  for (const role of EXTRA_ROLES) {
    const existing = await sql<{ id: string }[]>`
      SELECT id FROM payroll_pay_roles
      WHERE group_id = ${groupId} AND name = ${role.name} AND valid_to IS NULL AND active = true
      LIMIT 1
    `;
    if (existing[0]) {
      console.log(`    = ${role.name} (exists)`);
      continue;
    }

    const roleId = uuidv7();
    const planId = uuidv7();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO payroll_pay_roles (
        id, group_id, name, category, reports_to_required, per_product_bonus,
        commission_plan_id, active, created_at, updated_at
      ) VALUES (
        ${roleId}, ${groupId}, ${role.name}, ${role.category}::payroll_pay_role_category,
        false, false, NULL, true, now(), now()
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
      UPDATE payroll_pay_roles SET commission_plan_id = ${planId}, updated_at = now() WHERE id = ${roleId}
    `;
    console.log(`    + ${role.name}`);
  }
}

async function assignStaff(sql: Sql) {
  let total = 0;
  for (const [systemRole, payRoleName] of Object.entries(ROLE_TO_PAY_ROLE)) {
    const rows = await sql<{ id: string }[]>`
      UPDATE users u
      SET pay_role_id = pr.id, updated_at = now()
      FROM branches b
      INNER JOIN payroll_pay_roles pr
        ON pr.group_id = b.group_id
       AND pr.name = ${payRoleName}
       AND pr.valid_to IS NULL
       AND pr.active = true
      WHERE u.primary_branch_id = b.id
        AND u.role = ${systemRole}::user_role
        AND u.pay_role_id IS NULL
        AND u.status = 'ACTIVE'
      RETURNING u.id
    `;
    if (rows.length) console.log(`    ${rows.length} × ${systemRole} → ${payRoleName}`);
    total += rows.length;
  }

  // Complete the payroll profile for everyone holding a pay role.
  const profiled = await sql<{ id: string }[]>`
    UPDATE users
    SET employment_type = 'STAFF',
        salary_basis = 'FORMULA_BASED',
        tax_status = 'STANDARD_PAYE',
        crm_linked = (role = ANY(${CRM_LINKED_ROLES}::user_role[])),
        onboarding_payroll_status = 'ACTIVE',
        updated_at = now()
    WHERE status = 'ACTIVE'
      AND pay_role_id IS NOT NULL
      AND role <> 'SUPER_ADMIN'
    RETURNING id
  `;
  console.log(`\n  Assigned ${total} new; payroll profile completed for ${profiled.length} staff`);
}

async function main() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }
  const sql = postgres(connectionString, { max: 1 });
  console.log('Seeding supplemental pay roles + staff assignment...\n');

  try {
    const groups = await sql<{ id: string }[]>`
      SELECT id FROM branch_groups WHERE status = 'ACTIVE' ORDER BY created_at ASC
    `;
    const admin = await sql<{ id: string }[]>`
      SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE' LIMIT 1
    `;
    if (!admin[0]) {
      console.warn('  No SUPER_ADMIN found — skipping');
      return;
    }
    for (const g of groups) {
      console.log(`  Company ${g.id}`);
      await seedExtraRoles(sql, g.id, admin[0].id);
    }
    await assignStaff(sql);
    console.log('\n  Done.\n');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
