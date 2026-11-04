/**
 * Head of CS team delivery rate (PM 2026-11-04): orders serviced by the Head's
 * branch, handled by any closer (whatever the closer's own branch), offline
 * excluded, DELETED excluded, unassigned excluded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb } from '../test/setup-integration';
import { createTestBranch, createTestUser, createTestOrder } from '../test/factories/order.factory';
import { PayrollMetricsService } from './payroll-metrics.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];
const PERIOD_START = new Date('2026-05-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-05-31T23:59:59.999Z');
const IN_PERIOD = new Date('2026-05-15T12:00:00.000Z');
const BEFORE = new Date('2026-04-15T12:00:00.000Z');

describe.skipIf(SKIP_IF_NO_DB)('Head of CS team DR = orders serviced by her branch', () => {
  const pgClient = getPgClient();
  const db = getDb();
  beforeEach(async () => {
    await pgClient`BEGIN`;
  });
  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  it('counts closers from any branch, skips offline, deleted, unassigned, other branches and other months', async () => {
    const metrics = new PayrollMetricsService(db as any);
    const ife = await createTestBranch(db as any);
    const lagos = await createTestBranch(db as any);
    const head = await createTestUser(db as any, { role: 'HEAD_OF_CS', branchId: ife.id });
    const ifeCloser = await createTestUser(db as any, { role: 'CS_CLOSER', branchId: ife.id });
    const lagosCloser = await createTestUser(db as any, { role: 'CS_CLOSER', branchId: lagos.id });

    const make = async (
      status: string,
      cs: string | null,
      opts: { branch?: string; source?: string | null; at?: Date } = {},
    ) => {
      const o = await createTestOrder(db as any, { status: status as any, assignedCsId: cs ?? undefined });
      await db
        .update(schema.orders)
        .set({
          servicingBranchId: opts.branch ?? ife.id,
          orderSource: opts.source === undefined ? 'edge-form' : opts.source,
          assignedCsId: cs,
          createdAt: opts.at ?? IN_PERIOD,
        })
        .where(eq(schema.orders.id, o.orderId));
    };

    // Counted: 4 orders, 2 delivered (one by a Lagos-registered closer) = 50%.
    await make('DELIVERED', ifeCloser.id);
    await make('REMITTED', lagosCloser.id, { source: 'import' });
    await make('CONFIRMED', ifeCloser.id);
    await make('CS_ENGAGED', lagosCloser.id, { source: null });
    // Not counted.
    await make('DELIVERED', ifeCloser.id, { source: 'offline' });
    await make('DELIVERED', ifeCloser.id, { source: 'offline' });
    await make('DELETED', ifeCloser.id);
    await make('UNPROCESSED', null);
    await make('DELIVERED', lagosCloser.id, { branch: lagos.id });
    await make('DELIVERED', ifeCloser.id, { at: BEFORE });

    const m = await metrics.getStaffMetrics({
      staffId: head.id,
      staffRole: 'HEAD_OF_CS',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      crmLinked: true,
      teamServicingBranchId: ife.id,
    });
    expect(m.teamDr).toBe(50);

    const batched = await metrics.computeServicedTeamDrBatched(
      db as any,
      new Map([[head.id, ife.id]]),
      PERIOD_START,
      PERIOD_END,
    );
    expect(batched.get(head.id)).toBe(50);
  });
});
