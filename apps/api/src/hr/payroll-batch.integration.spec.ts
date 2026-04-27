/**
 * PayrollBatchService.listMonthlyPayrolls — org-wide department heads with null session branch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { getPgClient, getDb, setSessionActor } from '../test/setup-integration';
import { createTestBranch, createTestUser } from '../test/factories/order.factory';
import { PayrollBatchService } from './payroll-batch.service';
import { db as schema } from '@yannis/shared';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('PayrollBatchService — org-wide department heads', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  it('HEAD_OF_CS with null currentBranchId sees CS batches across branches', async () => {
    const b1 = await createTestBranch(db as any);
    const b2 = await createTestBranch(db as any);
    const periodMonth = '2026-04-01';

    await db.insert(schema.payrollBatches).values([
      {
        id: randomUUID(),
        branchId: b1.id,
        periodMonth,
        department: 'CS',
        status: 'DRAFT',
        staffCount: 0,
        totalAmount: '0',
      },
      {
        id: randomUUID(),
        branchId: b2.id,
        periodMonth,
        department: 'CS',
        status: 'DRAFT',
        staffCount: 0,
        totalAmount: '0',
      },
    ]);

    const headUser = await createTestUser(db as any, { role: 'HEAD_OF_CS' });
    await setSessionActor(pgClient, headUser.id, null);

    const svc = new PayrollBatchService(db as any, {} as any);
    const out = await svc.listMonthlyPayrolls(
      {},
      { id: headUser.id, role: 'HEAD_OF_CS', currentBranchId: null } as any,
    );

    expect(out.batches.length).toBeGreaterThanOrEqual(2);
    const branchIds = new Set(out.batches.map((x) => x.branchId));
    expect(branchIds.has(b1.id)).toBe(true);
    expect(branchIds.has(b2.id)).toBe(true);
  });

  it('HEAD_OF_CS with null session and input.branchId returns only that branch', async () => {
    const b1 = await createTestBranch(db as any);
    const b2 = await createTestBranch(db as any);
    const periodMonth = '2026-05-01';

    await db.insert(schema.payrollBatches).values([
      {
        id: randomUUID(),
        branchId: b1.id,
        periodMonth,
        department: 'CS',
        status: 'DRAFT',
        staffCount: 0,
        totalAmount: '0',
      },
      {
        id: randomUUID(),
        branchId: b2.id,
        periodMonth,
        department: 'CS',
        status: 'DRAFT',
        staffCount: 0,
        totalAmount: '0',
      },
    ]);

    const headUser = await createTestUser(db as any, { role: 'HEAD_OF_CS' });
    await setSessionActor(pgClient, headUser.id, null);

    const svc = new PayrollBatchService(db as any, {} as any);
    const out = await svc.listMonthlyPayrolls(
      { branchId: b1.id },
      { id: headUser.id, role: 'HEAD_OF_CS', currentBranchId: null } as any,
    );

    expect(out.batches.every((b) => b.branchId === b1.id)).toBe(true);
    expect(out.batches.some((b) => b.branchId === b2.id)).toBe(false);
  });
});
