import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';

/** Narrow executor so default-team seeding can run inside `db.transaction` callbacks. */
type BranchTeamsDbExecutor = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert'>;
import { TRPCError } from '@trpc/server';
import { DRIZZLE } from '../database/database.module';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isBranchTeamsSchemaMissingError } from '../common/db/branch-teams-schema';

export type BranchTeamDepartment = 'CS' | 'MARKETING';

@Injectable()
export class BranchTeamsService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /** Read paths only — mutations must surface errors when tables are missing. */
  private async safeBranchTeamsRead<T>(fallback: T, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isBranchTeamsSchemaMissingError(err)) return fallback;
      throw err;
    }
  }

  /**
   * Write paths should fail explicitly (not silently) when branch-team schema is absent.
   * This turns low-level Postgres 42P01 into a stable product error.
   */
  private async safeBranchTeamsWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isBranchTeamsSchemaMissingError(err)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Supervisor teams are unavailable because branch-team tables are missing. Apply database migration 0076 and retry.',
        });
      }
      throw err;
    }
  }

  private async assertUserBranchMember(userId: string, branchId: string): Promise<void> {
    const [row] = await this.db
      .select({ one: sql`1` })
      .from(schema.userBranches)
      .where(and(eq(schema.userBranches.userId, userId), eq(schema.userBranches.branchId, branchId)))
      .limit(1);
    if (!row) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'User is not a member of this branch — add them to the branch before adding to a team.',
      });
    }
  }

  async listTeamsWithMembers(branchId: string) {
    return this.safeBranchTeamsRead([], async () => {
      const teams = await this.db
        .select()
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.branchId, branchId))
        .orderBy(asc(schema.branchTeams.createdAt));

      if (teams.length === 0) return [];

      const teamIds = teams.map((t) => t.id);
      const members = await this.db
        .select({
          teamId: schema.branchTeamMembers.teamId,
          userId: schema.branchTeamMembers.userId,
          isSupervisor: schema.branchTeamMembers.isSupervisor,
          name: schema.users.name,
          role: schema.users.role,
        })
        .from(schema.branchTeamMembers)
        .innerJoin(schema.users, eq(schema.branchTeamMembers.userId, schema.users.id))
        .where(inArray(schema.branchTeamMembers.teamId, teamIds));

      const byTeam = new Map<string, typeof members>();
      for (const m of members) {
        const list = byTeam.get(m.teamId) ?? [];
        list.push(m);
        byTeam.set(m.teamId, list);
      }

      return teams.map((t) => ({
        ...t,
        members: (byTeam.get(t.id) ?? []).map((m) => ({
          ...m,
          teamId: t.id,
        })),
      }));
    });
  }

  /**
   * Departments (Marketing / CS) with teamless roster + nested squads — branch detail UI.
   */
  async listBranchOrgStructure(branchId: string) {
    return this.safeBranchTeamsRead({ departments: [] }, async () => {
      const departments = await this.db
        .select()
        .from(schema.branchDepartments)
        .where(eq(schema.branchDepartments.branchId, branchId))
        .orderBy(asc(schema.branchDepartments.department));

      if (departments.length === 0) {
        return { departments: [] };
      }

      const deptIds = departments.map((d) => d.id);

      const rosterRows = await this.db
        .select({
          branchDepartmentId: schema.branchDepartmentMembers.branchDepartmentId,
          userId: schema.branchDepartmentMembers.userId,
          name: schema.users.name,
          role: schema.users.role,
        })
        .from(schema.branchDepartmentMembers)
        .innerJoin(schema.users, eq(schema.branchDepartmentMembers.userId, schema.users.id))
        .where(inArray(schema.branchDepartmentMembers.branchDepartmentId, deptIds));

      const rosterByDept = new Map<string, typeof rosterRows>();
      for (const r of rosterRows) {
        const list = rosterByDept.get(r.branchDepartmentId) ?? [];
        list.push(r);
        rosterByDept.set(r.branchDepartmentId, list);
      }

      const teams = await this.db
        .select()
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.branchId, branchId))
        .orderBy(asc(schema.branchTeams.createdAt));

      const teamIds = teams.map((t) => t.id);
      const members =
        teamIds.length === 0
          ? []
          : await this.db
              .select({
                teamId: schema.branchTeamMembers.teamId,
                userId: schema.branchTeamMembers.userId,
                isSupervisor: schema.branchTeamMembers.isSupervisor,
                name: schema.users.name,
                role: schema.users.role,
              })
              .from(schema.branchTeamMembers)
              .innerJoin(schema.users, eq(schema.branchTeamMembers.userId, schema.users.id))
              .where(inArray(schema.branchTeamMembers.teamId, teamIds));

      const byTeam = new Map<string, typeof members>();
      for (const m of members) {
        const list = byTeam.get(m.teamId) ?? [];
        list.push(m);
        byTeam.set(m.teamId, list);
      }

      const teamsWithMembers = teams.map((t) => ({
        ...t,
        members: (byTeam.get(t.id) ?? []).map((m) => ({
          ...m,
          teamId: t.id,
        })),
      }));

      const teamsByDeptId = new Map<string, typeof teamsWithMembers>();
      for (const tw of teamsWithMembers) {
        const list = teamsByDeptId.get(tw.branchDepartmentId) ?? [];
        list.push(tw);
        teamsByDeptId.set(tw.branchDepartmentId, list);
      }

      const departmentsOut = departments.map((d) => {
        const teamsInDept = teamsByDeptId.get(d.id) ?? [];
        const teamUserIds = new Set<string>();
        for (const tm of teamsInDept) {
          for (const mem of tm.members) {
            teamUserIds.add(mem.userId);
          }
        }
        const rosterFull = rosterByDept.get(d.id) ?? [];
        const roster = rosterFull.filter((r) => !teamUserIds.has(r.userId));

        return {
          department: d,
          roster: roster.map((r) => ({
            userId: r.userId,
            name: r.name,
            role: r.role,
          })),
          teams: teamsInDept,
        };
      });

      return { departments: departmentsOut };
    });
  }

  /** Ensures CS + Marketing department rows exist for a branch (idempotent). */
  private async ensureBranchDepartmentsRows(
    branchId: string,
    executor: BranchTeamsDbExecutor = this.db,
  ): Promise<void> {
    for (const department of ['CS', 'MARKETING'] as const) {
      const existing = await executor
        .select({ id: schema.branchDepartments.id })
        .from(schema.branchDepartments)
        .where(
          and(
            eq(schema.branchDepartments.branchId, branchId),
            eq(schema.branchDepartments.department, department),
          ),
        )
        .limit(1);
      if (existing[0]) continue;
      await executor.insert(schema.branchDepartments).values({ branchId, department });
    }
  }

  async createTeam(
    branchId: string,
    department: BranchTeamDepartment,
    name: string | undefined,
    _actor: SessionUser,
  ) {
    return this.safeBranchTeamsWrite(async () => {
      await this.ensureBranchDepartmentsRows(branchId, this.db);
      const [deptRow] = await this.db
        .select({ id: schema.branchDepartments.id })
        .from(schema.branchDepartments)
        .where(
          and(
            eq(schema.branchDepartments.branchId, branchId),
            eq(schema.branchDepartments.department, department),
          ),
        )
        .limit(1);
      if (!deptRow) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Branch department row missing after ensure',
        });
      }
      const [row] = await this.db
        .insert(schema.branchTeams)
        .values({
          branchId,
          branchDepartmentId: deptRow.id,
          department,
          name: name?.trim() || null,
        })
        .returning();
      return row;
    });
  }

  async updateTeam(teamId: string, input: { name?: string | null }) {
    return this.safeBranchTeamsWrite(async () => {
      const [row] = await this.db
        .update(schema.branchTeams)
        .set({
          ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.branchTeams.id, teamId))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
      return row;
    });
  }

  async deleteTeam(teamId: string) {
    await this.safeBranchTeamsWrite(async () => {
      await this.db.delete(schema.branchTeams).where(eq(schema.branchTeams.id, teamId));
    });
  }

  /**
   * Idempotent default squads for a new branch: one CS + one Marketing team.
   * Safe inside `db.transaction` — pass the transaction client as `executor`.
   */
  async ensureDefaultDepartmentTeams(
    branchId: string,
    executor: BranchTeamsDbExecutor = this.db,
  ): Promise<void> {
    await this.safeBranchTeamsWrite(async () => {
      await this.ensureBranchDepartmentsRows(branchId, executor);
      const defaults: Array<{ department: BranchTeamDepartment; name: string }> = [
        { department: 'CS', name: 'Customer support' },
        { department: 'MARKETING', name: 'Marketing' },
      ];
      for (const { department, name } of defaults) {
        const existing = await executor
          .select({ id: schema.branchTeams.id })
          .from(schema.branchTeams)
          .where(
            and(eq(schema.branchTeams.branchId, branchId), eq(schema.branchTeams.department, department)),
          )
          .limit(1);
        if (existing[0]) continue;
        const [deptRow] = await executor
          .select({ id: schema.branchDepartments.id })
          .from(schema.branchDepartments)
          .where(
            and(
              eq(schema.branchDepartments.branchId, branchId),
              eq(schema.branchDepartments.department, department),
            ),
          )
          .limit(1);
        if (!deptRow) continue;
        await executor.insert(schema.branchTeams).values({
          branchId,
          branchDepartmentId: deptRow.id,
          department,
          name,
        });
      }
    });
  }

  /**
   * Reject promoting/adding a member as supervisor if the team already has a
   * different supervisor. A team is allowed exactly one supervisor (CEO directive
   * 2026-05-10). Pass the user-id being added/promoted in `exceptUserIds` so an
   * idempotent re-add of the existing supervisor isn't blocked.
   */
  private async assertSingleSupervisor(teamId: string, exceptUserIds: string[]): Promise<void> {
    const existing = await this.db
      .select({ userId: schema.branchTeamMembers.userId })
      .from(schema.branchTeamMembers)
      .where(
        and(
          eq(schema.branchTeamMembers.teamId, teamId),
          eq(schema.branchTeamMembers.isSupervisor, true),
        ),
      );
    const conflicts = existing.filter((row) => !exceptUserIds.includes(row.userId));
    if (conflicts.length > 0) {
      throw new TRPCError({
        code: 'CONFLICT',
        message:
          'This team already has a supervisor. Only one supervisor is allowed per team — demote the current one first.',
      });
    }
  }

  async addTeamMember(teamId: string, userId: string, isSupervisor: boolean, _actor: SessionUser) {
    await this.safeBranchTeamsWrite(async () => {
      const [team] = await this.db
        .select({
          branchId: schema.branchTeams.branchId,
          branchDepartmentId: schema.branchTeams.branchDepartmentId,
        })
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.id, teamId))
        .limit(1);
      if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
      await this.assertUserBranchMember(userId, team.branchId);
      if (isSupervisor) {
        await this.assertSingleSupervisor(teamId, [userId]);
      }
      await this.db
        .delete(schema.branchDepartmentMembers)
        .where(
          and(
            eq(schema.branchDepartmentMembers.branchDepartmentId, team.branchDepartmentId),
            eq(schema.branchDepartmentMembers.userId, userId),
          ),
        );
      await this.db
        .insert(schema.branchTeamMembers)
        .values({ teamId, userId, isSupervisor })
        .onConflictDoUpdate({
          target: [schema.branchTeamMembers.teamId, schema.branchTeamMembers.userId],
          set: { isSupervisor },
        });
    });
  }

  /**
   * Bulk add/move members into a team (CEO directive 2026-05-10).
   *
   * Per user, in a single transaction:
   *   1. Verify they belong to the team's branch
   *   2. Remove them from any sibling team in the same department (move semantics)
   *   3. Remove them from the department roster (no-team)
   *   4. Upsert into the target team with the supplied supervisor flag
   *
   * Returns `{ added, moved }` so the caller can surface "added 3 / moved 2".
   */
  async addTeamMembersBulk(
    teamId: string,
    userIds: string[],
    isSupervisor: boolean,
    _actor: SessionUser,
  ): Promise<{ added: number; moved: number }> {
    if (userIds.length === 0) return { added: 0, moved: 0 };
    // Single-supervisor constraint: a bulk batch can't promote multiple users to
    // supervisor in one shot, since that would leave the team with several.
    if (isSupervisor && userIds.length > 1) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Only one supervisor is allowed per team. Add a single member as supervisor, or add several without the supervisor flag.',
      });
    }
    let added = 0;
    let moved = 0;
    await this.safeBranchTeamsWrite(async () => {
      const [team] = await this.db
        .select({
          branchId: schema.branchTeams.branchId,
          branchDepartmentId: schema.branchTeams.branchDepartmentId,
        })
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.id, teamId))
        .limit(1);
      if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
      if (isSupervisor) {
        // Allow the candidate to already be the supervisor (idempotent re-add);
        // anyone else holding the role blocks the batch.
        await this.assertSingleSupervisor(teamId, userIds);
      }

      // Sibling teams in the same dept — used to move users away from before
      // inserting them into the target team.
      const siblings = await this.db
        .select({ id: schema.branchTeams.id })
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.branchDepartmentId, team.branchDepartmentId));
      const siblingIds = siblings.map((s) => s.id);
      const otherTeamIds = siblingIds.filter((id) => id !== teamId);

      for (const userId of userIds) {
        await this.assertUserBranchMember(userId, team.branchId);

        // Was the user already on a sibling team? Counts as a move, not an add.
        let wasOnOtherTeam = false;
        if (otherTeamIds.length > 0) {
          const onOther = await this.db
            .select({ teamId: schema.branchTeamMembers.teamId })
            .from(schema.branchTeamMembers)
            .where(
              and(
                eq(schema.branchTeamMembers.userId, userId),
                inArray(schema.branchTeamMembers.teamId, otherTeamIds),
              ),
            )
            .limit(1);
          wasOnOtherTeam = onOther.length > 0;
          if (wasOnOtherTeam) {
            await this.db
              .delete(schema.branchTeamMembers)
              .where(
                and(
                  eq(schema.branchTeamMembers.userId, userId),
                  inArray(schema.branchTeamMembers.teamId, otherTeamIds),
                ),
              );
          }
        }

        // Always clear the dept roster row (a user shouldn't sit on both a
        // team and the roster at once).
        await this.db
          .delete(schema.branchDepartmentMembers)
          .where(
            and(
              eq(schema.branchDepartmentMembers.branchDepartmentId, team.branchDepartmentId),
              eq(schema.branchDepartmentMembers.userId, userId),
            ),
          );

        await this.db
          .insert(schema.branchTeamMembers)
          .values({ teamId, userId, isSupervisor })
          .onConflictDoUpdate({
            target: [schema.branchTeamMembers.teamId, schema.branchTeamMembers.userId],
            set: { isSupervisor },
          });

        if (wasOnOtherTeam) moved += 1;
        else added += 1;
      }
    });
    return { added, moved };
  }

  async addDepartmentMember(branchDepartmentId: string, userId: string, _actor: SessionUser) {
    await this.safeBranchTeamsWrite(async () => {
      const [bd] = await this.db
        .select({ branchId: schema.branchDepartments.branchId })
        .from(schema.branchDepartments)
        .where(eq(schema.branchDepartments.id, branchDepartmentId))
        .limit(1);
      if (!bd) throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
      await this.assertUserBranchMember(userId, bd.branchId);

      const teamsInDept = await this.db
        .select({ id: schema.branchTeams.id })
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.branchDepartmentId, branchDepartmentId));
      const teamIds = teamsInDept.map((t) => t.id);
      if (teamIds.length > 0) {
        await this.db
          .delete(schema.branchTeamMembers)
          .where(
            and(
              eq(schema.branchTeamMembers.userId, userId),
              inArray(schema.branchTeamMembers.teamId, teamIds),
            ),
          );
      }

      const already = await this.db
        .select({ one: sql`1` })
        .from(schema.branchDepartmentMembers)
        .where(
          and(
            eq(schema.branchDepartmentMembers.branchDepartmentId, branchDepartmentId),
            eq(schema.branchDepartmentMembers.userId, userId),
          ),
        )
        .limit(1);
      if (!already[0]) {
        await this.db.insert(schema.branchDepartmentMembers).values({ branchDepartmentId, userId });
      }
    });
  }

  async removeDepartmentMember(branchDepartmentId: string, userId: string) {
    await this.safeBranchTeamsWrite(async () => {
      await this.db
        .delete(schema.branchDepartmentMembers)
        .where(
          and(
            eq(schema.branchDepartmentMembers.branchDepartmentId, branchDepartmentId),
            eq(schema.branchDepartmentMembers.userId, userId),
          ),
        );
    });
  }

  async removeTeamMember(teamId: string, userId: string) {
    await this.safeBranchTeamsWrite(async () => {
      await this.db
        .delete(schema.branchTeamMembers)
        .where(
          and(eq(schema.branchTeamMembers.teamId, teamId), eq(schema.branchTeamMembers.userId, userId)),
        );
    });
  }

  async setMemberSupervisor(teamId: string, userId: string, isSupervisor: boolean) {
    await this.safeBranchTeamsWrite(async () => {
      if (isSupervisor) {
        await this.assertSingleSupervisor(teamId, [userId]);
      }
      const updated = await this.db
        .update(schema.branchTeamMembers)
        .set({ isSupervisor })
        .where(
          and(eq(schema.branchTeamMembers.teamId, teamId), eq(schema.branchTeamMembers.userId, userId)),
        )
        .returning();
      if (!updated[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team member not found' });
    });
  }

  /** Same team, CS department, actor is supervisor, supervisee is non-supervisor CS_CLOSER. */
  async isCsSupervisorOf(actorId: string, superviseeId: string, branchId: string): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const sup = alias(schema.branchTeamMembers, 'sup');
      const mem = alias(schema.branchTeamMembers, 'mem');
      const rows = await this.db
        .select({ x: sql`1` })
        .from(sup)
        .innerJoin(mem, eq(mem.teamId, sup.teamId))
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, sup.teamId))
        .innerJoin(schema.users, eq(schema.users.id, mem.userId))
        .where(
          and(
            eq(sup.userId, actorId),
            eq(sup.isSupervisor, true),
            eq(mem.userId, superviseeId),
            eq(mem.isSupervisor, false),
            eq(schema.branchTeams.branchId, branchId),
            eq(schema.branchTeams.department, 'CS'),
            eq(schema.users.role, 'CS_CLOSER'),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  /** Same team, Marketing department, actor is supervisor, supervisee is MEDIA_BUYER (non-supervisor row). */
  async isMarketingSupervisorOf(
    actorId: string,
    superviseeId: string,
    branchId: string,
  ): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const sup = alias(schema.branchTeamMembers, 'sup_m');
      const mem = alias(schema.branchTeamMembers, 'mem_m');
      const rows = await this.db
        .select({ x: sql`1` })
        .from(sup)
        .innerJoin(mem, eq(mem.teamId, sup.teamId))
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, sup.teamId))
        .innerJoin(schema.users, eq(schema.users.id, mem.userId))
        .where(
          and(
            eq(sup.userId, actorId),
            eq(sup.isSupervisor, true),
            eq(mem.userId, superviseeId),
            eq(mem.isSupervisor, false),
            eq(schema.branchTeams.branchId, branchId),
            eq(schema.branchTeams.department, 'MARKETING'),
            eq(schema.users.role, 'MEDIA_BUYER'),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  /**
   * True if `actorId` is the supervisor on `teamId`. Used by the team-management
   * permission gate (CEO directive 2026-05-10) so a team supervisor can manage
   * members of their own team without being a department head.
   */
  async isSupervisorOfTeam(actorId: string, teamId: string): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const rows = await this.db
        .select({ x: sql`1` })
        .from(schema.branchTeamMembers)
        .where(
          and(
            eq(schema.branchTeamMembers.userId, actorId),
            eq(schema.branchTeamMembers.teamId, teamId),
            eq(schema.branchTeamMembers.isSupervisor, true),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  /**
   * Return every team-id where `actorId` is the supervisor (across all branches).
   * Used by the loader so the UI can enable management controls only on teams
   * the viewer supervises.
   */
  async getSupervisedTeamIds(actorId: string): Promise<string[]> {
    return this.safeBranchTeamsRead([] as string[], async () => {
      const rows = await this.db
        .select({ teamId: schema.branchTeamMembers.teamId })
        .from(schema.branchTeamMembers)
        .where(
          and(
            eq(schema.branchTeamMembers.userId, actorId),
            eq(schema.branchTeamMembers.isSupervisor, true),
          ),
        );
      return rows.map((r) => r.teamId);
    });
  }

  /** True if actor is marked as a CS supervisor on any team for this branch. */
  async isActorCsSupervisorOnBranch(actorId: string, branchId: string): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const rows = await this.db
        .select({ x: sql`1` })
        .from(schema.branchTeamMembers)
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, schema.branchTeamMembers.teamId))
        .where(
          and(
            eq(schema.branchTeamMembers.userId, actorId),
            eq(schema.branchTeamMembers.isSupervisor, true),
            eq(schema.branchTeams.branchId, branchId),
            eq(schema.branchTeams.department, 'CS'),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  /** True if actor is marked as a supervisor on any branch team for this branch. */
  async isActorSupervisorOnBranch(actorId: string, branchId: string): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const rows = await this.db
        .select({ x: sql`1` })
        .from(schema.branchTeamMembers)
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, schema.branchTeamMembers.teamId))
        .where(
          and(
            eq(schema.branchTeamMembers.userId, actorId),
            eq(schema.branchTeamMembers.isSupervisor, true),
            eq(schema.branchTeams.branchId, branchId),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  /**
   * Combined CS + Marketing supervised IDs for a single actor / branch — used by
   * list endpoints to scope a supervisor to "data that concerns them only" (orders
   * **assigned to** their CS team agents AND orders **created by** their MB team).
   * The actor's own id is always included so a supervisor still sees their own work.
   */
  async listSupervisorScopeIds(
    actorId: string,
    branchId: string,
  ): Promise<{ csUserIds: string[]; marketingUserIds: string[]; isSupervisor: boolean }> {
    const [csIds, marketingIds] = await Promise.all([
      this.listSupervisedUserIds(actorId, branchId, 'CS'),
      this.listSupervisedUserIds(actorId, branchId, 'MARKETING'),
    ]);
    const csUserIds = [...new Set([actorId, ...csIds])];
    const marketingUserIds = [...new Set([actorId, ...marketingIds])];
    const isSupervisor = csIds.length > 0 || marketingIds.length > 0;
    return { csUserIds, marketingUserIds, isSupervisor };
  }

  /** Supervisee user IDs on this branch for CS or Marketing teams where actor is a supervisor. */
  async listSupervisedUserIds(
    actorId: string,
    branchId: string,
    department: BranchTeamDepartment,
  ): Promise<string[]> {
    return this.safeBranchTeamsRead([], async () => {
      const sup = alias(schema.branchTeamMembers, 'sup_l');
      const mem = alias(schema.branchTeamMembers, 'mem_l');
      const roleFilter =
        department === 'CS' ? eq(schema.users.role, 'CS_CLOSER') : eq(schema.users.role, 'MEDIA_BUYER');

      const rows = await this.db
        .select({ id: mem.userId })
        .from(sup)
        .innerJoin(mem, eq(mem.teamId, sup.teamId))
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, sup.teamId))
        .innerJoin(schema.users, eq(schema.users.id, mem.userId))
        .where(
          and(
            eq(sup.userId, actorId),
            eq(sup.isSupervisor, true),
            eq(mem.isSupervisor, false),
            eq(schema.branchTeams.branchId, branchId),
            eq(schema.branchTeams.department, department),
            roleFilter,
          ),
        );
      return [...new Set(rows.map((r) => r.id))];
    });
  }

  /**
   * Mirror fallback: true when actor may mirror target via branch team supervision
   * (same branch session as actor.currentBranchId).
   */
  async actorCanMirrorViaSupervision(
    actor: { id: string; currentBranchId?: string | null },
    target: { id: string; role: string },
  ): Promise<boolean> {
    const branchId = actor.currentBranchId;
    if (!branchId) return false;
    if (target.role === 'CS_CLOSER') {
      return this.isCsSupervisorOf(actor.id, target.id, branchId);
    }
    if (target.role === 'MEDIA_BUYER') {
      return this.isMarketingSupervisorOf(actor.id, target.id, branchId);
    }
    return false;
  }
}
