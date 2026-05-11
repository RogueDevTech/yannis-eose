/**
 * Branch team supervision graph — mirror eligibility helper.
 * Requires migrations with branch_teams / branch_team_members.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { db as schema } from '@yannis/shared';
import { getPgClient, getDb, closeConnections } from '../test/setup-integration';
import { createTestUser, createTestBranch, insertTestBranchTeam } from '../test/factories/order.factory';
import { BranchTeamsService } from './branch-teams.service';

const SKIP_IF_NO_DB = !process.env['TEST_DATABASE_URL'] && !process.env['DATABASE_URL'];

describe.skipIf(SKIP_IF_NO_DB)('BranchTeamsService — supervision mirror helper', () => {
  const pgClient = getPgClient();
  const db = getDb();

  beforeEach(async () => {
    await pgClient`BEGIN`;
  });

  afterEach(async () => {
    await pgClient`ROLLBACK`;
  });

  afterAll(async () => {
    await closeConnections();
  });

  it('actorCanMirrorViaSupervision is true for CS supervisor → CS_CLOSER on same branch', async () => {
    const branch = await createTestBranch(db as any);
    const sup = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const agent = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await db.insert(schema.userBranches).values([
      { userId: sup.id, branchId: branch.id, isPrimary: true },
      { userId: agent.id, branchId: branch.id, isPrimary: true },
    ]);
    const team = await insertTestBranchTeam(db as any, branch.id, 'CS', 'Squad');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: team!.id, userId: sup.id, isSupervisor: true },
      { teamId: team!.id, userId: agent.id, isSupervisor: false },
    ]);

    const svc = new BranchTeamsService(db as any);
    const ok = await svc.actorCanMirrorViaSupervision(
      { id: sup.id, currentBranchId: branch.id },
      { id: agent.id, role: 'CS_CLOSER' },
    );
    expect(ok).toBe(true);
  });

  it('actorCanMirrorViaSupervision is false when no team edge exists', async () => {
    const branch = await createTestBranch(db as any);
    const a = await createTestUser(db as any, { role: 'CS_CLOSER' });
    const b = await createTestUser(db as any, { role: 'CS_CLOSER' });
    await db.insert(schema.userBranches).values([
      { userId: a.id, branchId: branch.id, isPrimary: true },
      { userId: b.id, branchId: branch.id, isPrimary: true },
    ]);
    const svc = new BranchTeamsService(db as any);
    const ok = await svc.actorCanMirrorViaSupervision(
      { id: a.id, currentBranchId: branch.id },
      { id: b.id, role: 'CS_CLOSER' },
    );
    expect(ok).toBe(false);
  });

  it('actorCanMirrorViaSupervision is true for a direct supervisee even without an active branch', async () => {
    const branch = await createTestBranch(db as any);
    const sup = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    const buyer = await createTestUser(db as any, { role: 'MEDIA_BUYER' });
    await db.insert(schema.userBranches).values([
      { userId: sup.id, branchId: branch.id, isPrimary: true },
      { userId: buyer.id, branchId: branch.id, isPrimary: true },
    ]);
    const team = await insertTestBranchTeam(db as any, branch.id, 'MARKETING', 'Buyers');
    await db.insert(schema.branchTeamMembers).values([
      { teamId: team!.id, userId: sup.id, isSupervisor: true },
      { teamId: team!.id, userId: buyer.id, isSupervisor: false },
    ]);

    const svc = new BranchTeamsService(db as any);
    const ok = await svc.actorCanMirrorViaSupervision(
      { id: sup.id, currentBranchId: null },
      { id: buyer.id, role: 'MEDIA_BUYER' },
    );
    expect(ok).toBe(true);
  });
});
