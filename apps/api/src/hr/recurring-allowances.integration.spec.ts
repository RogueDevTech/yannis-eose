/**
 * Recurring per-staff allowances (0357): a recurring template pays every month
 * from its start month through a per-month row, never twice in one month, and
 * stops when voided. Exercises the sweep predicates against real SQL, including
 * the self-referencing subquery inside an UPDATE.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getPgClient, getDb, setSessionActor } from '../test/setup-integration';
import { createTestBranch, createTestUser } from '../test/factories/order.factory';
import { randomUUID } from 'crypto';
import { db as schema } from '@yannis/shared';
import { pendingStaffAllowanceForMonth, staffAllowanceForMonth } from './payroll-batch.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

const MIGRATION = readFileSync(
  path.resolve(__dirname, '../../../../packages/shared/drizzle/0357_recurring_staff_allowances.sql'),
  'utf8',
);

describe.skipIf(SKIP_IF_NO_DB)('recurring staff allowances', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeEach(async () => {
    await pgClient`BEGIN`;
    // DDL is transactional: the column exists only inside this test's rollback.
    await pgClient.unsafe(MIGRATION);
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  async function setup() {
    const staff = await createTestUser(db, { role: 'MEDIA_BUYER' });
    await setSessionActor(pgClient, staff.id, null);
    const [template] = await db
      .insert(schema.payrollStaffAllowances)
      .values({
        staffId: staff.id,
        amount: '20000',
        name: 'Data bundles',
        recurring: true,
        status: 'APPROVED',
        approvedBy: staff.id,
        periodMonth: '2026-09-01',
      })
      .returning();
    const [oneTime] = await db
      .insert(schema.payrollStaffAllowances)
      .values({
        staffId: staff.id,
        amount: '5000',
        name: 'Makeup',
        recurring: false,
        status: 'APPROVED',
        approvedBy: staff.id,
        periodMonth: '2026-09-01',
      })
      .returning();
    return { staff, template: template!, oneTime: oneTime! };
  }

  async function idsFor(staffId: string, month: string) {
    const rows = await db
      .select({ id: schema.payrollStaffAllowances.id })
      .from(schema.payrollStaffAllowances)
      .where(and(eq(schema.payrollStaffAllowances.staffId, staffId), staffAllowanceForMonth(month)));
    return rows.map((r) => r.id).sort();
  }

  it('pays the template from its start month onward, one-time only in its month', async () => {
    const { staff, template, oneTime } = await setup();
    expect(await idsFor(staff.id, '2026-08-01')).toEqual([]);
    expect(await idsFor(staff.id, '2026-09-01')).toEqual([template.id, oneTime.id].sort());
    expect(await idsFor(staff.id, '2026-10-01')).toEqual([template.id]);
    expect(await idsFor(staff.id, '2026-11-01')).toEqual([template.id]);
  });

  it("uses the month's row instead of the template once it exists (never twice)", async () => {
    const { staff, template } = await setup();
    const [child] = await db
      .insert(schema.payrollStaffAllowances)
      .values({
        staffId: staff.id,
        amount: '20000',
        name: 'Data bundles',
        recurring: true,
        status: 'APPROVED',
        approvedBy: staff.id,
        periodMonth: '2026-10-01',
        sourceAllowanceId: template.id,
      })
      .returning();
    // October: the floating October row (e.g. after a regenerate), not the template.
    expect(await idsFor(staff.id, '2026-10-01')).toEqual([child!.id]);
    // November is still due from the template.
    expect(await idsFor(staff.id, '2026-11-01')).toEqual([template.id]);

    // Inside an UPDATE the outer-table reference must still resolve to the row
    // being updated: only the October row is linkable, never the template.
    const updated = await db
      .update(schema.payrollStaffAllowances)
      .set({ notes: 'linked' })
      .where(and(eq(schema.payrollStaffAllowances.staffId, staff.id), pendingStaffAllowanceForMonth('2026-10-01')))
      .returning({ id: schema.payrollStaffAllowances.id });
    expect(updated.map((r) => r.id)).toEqual([child!.id]);
  });

  it('backfill turns a consumed recurring allowance into a template + its month row', async () => {
    const staff = await createTestUser(db, { role: 'MEDIA_BUYER' });
    await setSessionActor(pgClient, staff.id, null);
    const branch = await createTestBranch(db);
    const batchId = randomUUID();
    await db.insert(schema.payrollBatches).values({
      id: batchId,
      branchId: branch.id,
      periodMonth: '2026-08-01',
      department: 'MARKETING',
      status: 'PAID',
      staffCount: 1,
      totalAmount: '0',
    });
    const [payout] = await db
      .insert(schema.payoutRecords)
      .values({
        batchId,
        staffId: staff.id,
        periodStart: new Date('2026-08-01T00:00:00+01:00'),
        periodEnd: new Date('2026-08-31T23:59:59.999+01:00'),
      })
      .returning();
    // Pre-0357 shape: recurring, no month, consumed by the August payout.
    const [legacy] = await db
      .insert(schema.payrollStaffAllowances)
      .values({
        staffId: staff.id,
        amount: '15000',
        name: 'Transport',
        recurring: true,
        status: 'APPROVED',
        approvedBy: staff.id,
        payoutId: payout!.id,
      })
      .returning();

    await pgClient.unsafe(MIGRATION); // re-run: idempotent, backfills this row

    const rows = await db
      .select()
      .from(schema.payrollStaffAllowances)
      .where(eq(schema.payrollStaffAllowances.staffId, staff.id));
    const template = rows.find((r) => r.id === legacy!.id)!;
    const child = rows.find((r) => r.sourceAllowanceId === legacy!.id)!;
    expect(rows).toHaveLength(2);
    expect(template.payoutId).toBeNull();
    expect(template.periodMonth).toBe('2026-08-01');
    expect(child.payoutId).toBe(payout!.id);
    expect(child.periodMonth).toBe('2026-08-01');
    expect(Number(child.amount)).toBe(15000);
    // August is already paid by the month row; September onward from the template.
    expect(await idsFor(staff.id, '2026-08-01')).toEqual([]);
    expect(await idsFor(staff.id, '2026-09-01')).toEqual([legacy!.id]);

    await pgClient.unsafe(MIGRATION); // a second run changes nothing
    const again = await db
      .select({ id: schema.payrollStaffAllowances.id })
      .from(schema.payrollStaffAllowances)
      .where(eq(schema.payrollStaffAllowances.staffId, staff.id));
    expect(again).toHaveLength(2);
  });

  it('keeps the history twin column-aligned (positional capture)', async () => {
    const cols = await pgClient<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('payroll_staff_allowances', 'payroll_staff_allowances_history')
      ORDER BY table_name, ordinal_position
    `;
    const live = cols.filter((c) => c.table_name === 'payroll_staff_allowances').map((c) => c.column_name);
    const hist = cols.filter((c) => c.table_name === 'payroll_staff_allowances_history').map((c) => c.column_name);
    expect(hist.slice(0, live.length)).toEqual(live);
    expect(live[live.length - 1]).toBe('source_allowance_id');
  });

  it('stops paying, including the open month, once the template is voided', async () => {
    const { staff, template } = await setup();
    await db.insert(schema.payrollStaffAllowances).values({
      staffId: staff.id,
      amount: '20000',
      name: 'Data bundles',
      recurring: true,
      status: 'APPROVED',
      approvedBy: staff.id,
      periodMonth: '2026-10-01',
      sourceAllowanceId: template.id,
    });
    await db
      .update(schema.payrollStaffAllowances)
      .set({ status: 'VOIDED' })
      .where(eq(schema.payrollStaffAllowances.id, template.id));
    expect(await idsFor(staff.id, '2026-10-01')).toEqual([]);
    expect(await idsFor(staff.id, '2026-11-01')).toEqual([]);
  });
});
