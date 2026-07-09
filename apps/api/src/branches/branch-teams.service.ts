import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';

/** Narrow executor so default-team seeding can run inside `db.transaction` callbacks. */
type BranchTeamsDbExecutor = Pick<PostgresJsDatabase<typeof schema>, 'select' | 'insert'>;
import { TRPCError } from '@trpc/server';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isBranchTeamsSchemaMissingError } from '../common/db/branch-teams-schema';
import { CacheService } from '../common/cache/cache.service';

export type BranchTeamDepartment = 'CS' | 'MARKETING';

/** Redis key prefix for the per-(user, branch) team-supervisor flag cache. */
const SUPERVISOR_FLAGS_KEY_PREFIX = 'cache:branchTeams:supervisorFlags:';
/** TTL matches the user bundle cache — both feed the per-request session build. */
const SUPERVISOR_FLAGS_TTL_SECONDS = 60;

@Injectable()
export class BranchTeamsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cache: CacheService,
  ) {}

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
        message: 'User is not a member of this branch. Add them to the branch before adding to a team.',
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
    actor: SessionUser,
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
      const [row] = await withActor(this.db, actor, async (tx) => {
        return tx
          .insert(schema.branchTeams)
          .values({
            branchId,
            branchDepartmentId: deptRow.id,
            department,
            name: name?.trim() || null,
          })
          .returning();
      });
      return row;
    });
  }

  async updateTeam(teamId: string, input: { name?: string | null }, actor: SessionUser) {
    return this.safeBranchTeamsWrite(async () => {
      const [row] = await withActor(this.db, actor, async (tx) => {
        return tx
          .update(schema.branchTeams)
          .set({
            ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.branchTeams.id, teamId))
          .returning();
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
      return row;
    });
  }

  async deleteTeam(teamId: string, actor: SessionUser) {
    // Capture supervisor user IDs BEFORE the cascade so we can resync their
    // user-level supervisor flag after the team's rows are gone (an ex-
    // supervisor whose only team just got deleted should drop the flag).
    const supervisorRows = await this.safeBranchTeamsRead<Array<{ userId: string }>>(
      [],
      async () =>
        this.db
          .select({ userId: schema.branchTeamMembers.userId })
          .from(schema.branchTeamMembers)
          .where(
            and(
              eq(schema.branchTeamMembers.teamId, teamId),
              eq(schema.branchTeamMembers.isSupervisor, true),
            ),
          ),
    );
    await this.safeBranchTeamsWrite(async () => {
      await withActor(this.db, actor, async (tx) => {
        await tx.delete(schema.branchTeams).where(eq(schema.branchTeams.id, teamId));
      });
    });
    for (const row of supervisorRows) {
      await this.syncUserSupervisorFlag(row.userId);
    }
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

  /**
   * Recompute `users.is_team_supervisor` for a single user from the current
   * `branch_team_members` rows. Call this after any mutation that could change
   * the user's supervisor status (add/remove member, promote/demote, bulk add).
   *
   * Cheap: one EXISTS query + one conditional UPDATE. No-ops when the column
   * already matches, so it's safe to call defensively.
   *
   * Source of truth stays the team-membership rows; this column is denormalised
   * state for UI surfaces (header chip, user-detail pill, Staff Accounts list/
   * filter) that don't want to JOIN.
   */
  async syncUserSupervisorFlag(userId: string): Promise<void> {
    await this.safeBranchTeamsWrite(async () => {
      const supervisorRows = await this.db
        .select({ id: schema.branchTeamMembers.userId })
        .from(schema.branchTeamMembers)
        .where(
          and(
            eq(schema.branchTeamMembers.userId, userId),
            eq(schema.branchTeamMembers.isSupervisor, true),
          ),
        )
        .limit(1);
      const shouldBeSupervisor = supervisorRows.length > 0;
      await this.db
        .update(schema.users)
        .set({ isTeamSupervisor: shouldBeSupervisor })
        .where(
          and(
            eq(schema.users.id, userId),
            // Only update when the value actually changes — keeps the temporal
            // history clean (no spurious rows for repeat sync calls).
            ne(schema.users.isTeamSupervisor, shouldBeSupervisor),
          ),
        );
    });
    // Drop the per-branch supervisor-flag cache unconditionally: the branch-
    // scoped flag can flip even when the denormalised `users.is_team_supervisor`
    // column does not (e.g. still a supervisor on another branch).
    await this.invalidateSupervisorFlags(userId);
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
      // Remove from sibling teams in the same department (move semantics —
      // a user can only be on one team per department per branch).
      const siblings = await this.db
        .select({ id: schema.branchTeams.id })
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.branchDepartmentId, team.branchDepartmentId));
      const otherTeamIds = siblings.map((s) => s.id).filter((id) => id !== teamId);
      if (otherTeamIds.length > 0) {
        await this.db
          .delete(schema.branchTeamMembers)
          .where(
            and(
              eq(schema.branchTeamMembers.userId, userId),
              inArray(schema.branchTeamMembers.teamId, otherTeamIds),
            ),
          );
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
    await this.syncUserSupervisorFlag(userId);
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
    // Sync the supervisor flag for every user touched. The bulk caller can only
    // promote one supervisor at a time (validated above), so this only flips
    // the flag for that one user and is a no-op for the rest. Cheap either way.
    for (const userId of userIds) {
      await this.syncUserSupervisorFlag(userId);
    }
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
    // Moving a user to the teamless department roster removes their team
    // memberships above — invalidate in case they were a supervisor.
    await this.invalidateSupervisorFlags(userId);
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
    await this.syncUserSupervisorFlag(userId);
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
    await this.syncUserSupervisorFlag(userId);
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
   * Branch/department-agnostic version of `isCsSupervisorOf` / `isMarketingSupervisorOf`.
   * True if `actorId` is a team supervisor anywhere they share a team with
   * `superviseeId` (where the supervisee row has `is_supervisor = false`).
   *
   * Used by `/hr/users/:id` (CEO directive 2026-05-11) so a Marketing- or CS-
   * team supervisor can open their squad-mates' profile cards without
   * needing the full `users.staff.*` permission family.
   */
  async isSupervisorOfUserAnywhere(actorId: string, superviseeId: string): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const sup = alias(schema.branchTeamMembers, 'sup_any');
      const mem = alias(schema.branchTeamMembers, 'mem_any');
      const rows = await this.db
        .select({ x: sql`1` })
        .from(sup)
        .innerJoin(mem, eq(mem.teamId, sup.teamId))
        .where(
          and(
            eq(sup.userId, actorId),
            eq(sup.isSupervisor, true),
            eq(mem.userId, superviseeId),
            eq(mem.isSupervisor, false),
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
   * **assigned to** their Sales team agents AND orders **created by** their MB team).
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

  /**
   * True when the actor is a marketing team supervisor on this branch with at least one
   * supervised MEDIA_BUYER on the same squad — used for scoped HoM-like marketing surfaces.
   */
  async hasMarketingSuperviseesOnBranch(actorId: string, branchId: string): Promise<boolean> {
    const ids = await this.listSupervisedUserIds(actorId, branchId, 'MARKETING');
    return ids.length > 0;
  }

  /**
   * True when the actor is marked as supervisor on at least one MARKETING team in this branch,
   * regardless of whether the team currently has any supervisees. Use this for capability gates
   * (e.g. "should this user see the supervisor surfaces?") — a supervisor of a freshly-created
   * empty team is still a supervisor and should see Live Activities / Team Analysis so they can
   * onboard members. Use {@link hasMarketingSuperviseesOnBranch} only when the surface is
   * meaningless without supervisees (e.g. team-scope filters that would render empty).
   */
  async isMarketingSupervisorOnBranch(actorId: string, branchId: string): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const rows = await this.db
        .select({ id: schema.branchTeamMembers.userId })
        .from(schema.branchTeamMembers)
        .innerJoin(
          schema.branchTeams,
          eq(schema.branchTeams.id, schema.branchTeamMembers.teamId),
        )
        .where(
          and(
            eq(schema.branchTeamMembers.userId, actorId),
            eq(schema.branchTeamMembers.isSupervisor, true),
            eq(schema.branchTeams.branchId, branchId),
            eq(schema.branchTeams.department, 'MARKETING'),
          ),
        )
        .limit(1);
      return rows.length > 0;
    });
  }

  /**
   * Symmetric to {@link isMarketingSupervisorOnBranch} for the CS lane.
   * True when the actor supervises at least one Sales team on this branch,
   * regardless of whether that team currently has supervisees — same
   * "empty-team supervisor still has the surfaces" rationale.
   */
  async isCsSupervisorOnBranch(actorId: string, branchId: string): Promise<boolean> {
    return this.safeBranchTeamsRead(false, async () => {
      const rows = await this.db
        .select({ id: schema.branchTeamMembers.userId })
        .from(schema.branchTeamMembers)
        .innerJoin(
          schema.branchTeams,
          eq(schema.branchTeams.id, schema.branchTeamMembers.teamId),
        )
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

  /**
   * Get all user IDs belonging to a specific team (both supervisor and members).
   * Used for team-scoped filtering on order pages.
   */
  async listTeamMemberIds(teamId: string): Promise<string[]> {
    return this.safeBranchTeamsRead([], async () => {
      const rows = await this.db
        .select({ userId: schema.branchTeamMembers.userId })
        .from(schema.branchTeamMembers)
        .where(eq(schema.branchTeamMembers.teamId, teamId));
      return rows.map((r) => r.userId);
    });
  }

  /**
   * List teams available for a branch + department, for the team filter dropdown.
   */
  async listTeamsForFilter(branchId: string, department?: 'CS' | 'MARKETING'): Promise<Array<{ id: string; name: string | null; department: string }>> {
    return this.safeBranchTeamsRead([], async () => {
      const conditions = [eq(schema.branchTeams.branchId, branchId)];
      if (department) conditions.push(eq(schema.branchTeams.department, department));
      const rows = await this.db
        .select({
          id: schema.branchTeams.id,
          name: schema.branchTeams.name,
          department: schema.branchTeams.department,
        })
        .from(schema.branchTeams)
        .where(and(...conditions))
        .orderBy(schema.branchTeams.name);
      return rows;
    });
  }

  /**
   * Redis-cached per-(user, branch) team-supervisor flags for both lanes.
   *
   * This feeds {@link attachTeamSupervisorSessionFlags}, which runs on EVERY
   * authenticated request (login / mirror / `/auth/me` / tRPC middleware).
   * Without the cache that was 2 Postgres round-trips per request — expensive
   * on a remote DB. Keyed by `(userId, branchId)` because the flags are
   * branch-scoped: a user can supervise a team on one branch but not another.
   *
   * TTL matches the user bundle cache (60s). Invalidated explicitly by
   * {@link invalidateSupervisorFlags}, called from the `syncUserSupervisorFlag`
   * chokepoint that every team-membership mutation already funnels through.
   */
  async getSupervisorFlagsForBranch(
    userId: string,
    branchId: string,
  ): Promise<{ marketing: boolean; cs: boolean }> {
    const key = `${SUPERVISOR_FLAGS_KEY_PREFIX}${userId}:${branchId}`;
    return this.cache.getOrSet(key, SUPERVISOR_FLAGS_TTL_SECONDS, async () => {
      const [marketing, cs] = await Promise.all([
        this.isMarketingSupervisorOnBranch(userId, branchId),
        this.isCsSupervisorOnBranch(userId, branchId),
      ]);
      return { marketing, cs };
    });
  }

  /**
   * Drop every cached supervisor-flag entry for a user (all branches), so a
   * promote / demote / move / team-delete is reflected on their next request.
   */
  async invalidateSupervisorFlags(userId: string): Promise<void> {
    if (!userId) return;
    await this.cache.delPattern(`${SUPERVISOR_FLAGS_KEY_PREFIX}${userId}:*`);
  }

  /**
   * Attaches BOTH per-branch supervisor lane flags onto the session user. Use
   * this from session-build paths (login / mirror / `/auth/me` / tRPC
   * middleware). The underlying lookup is Redis-cached, so on a warm cache this
   * adds no Postgres round-trip. Global / admin sessions (no active branch)
   * short-circuit with both flags dropped.
   */
  async attachTeamSupervisorSessionFlags(user: SessionUser): Promise<SessionUser> {
    const branchId = user.currentBranchId;
    if (!branchId) {
      // "All Branches" — no single branch to resolve against. Instead of
      // dropping both flags entirely (which hid Team Analysis / Team Orders
      // for MBs on "All Branches"), check if the user is a supervisor on ANY
      // branch. The `users.is_team_supervisor` denormalized flag tells us.
      const isGlobalSupervisor = user.isTeamSupervisor === true || user.scopeTeamSupervisor === true;
      if (!isGlobalSupervisor) {
        const {
          isMarketingTeamSupervisorOnActiveBranch: _drop1,
          isCsTeamSupervisorOnActiveBranch: _drop2,
          ...rest
        } = user;
        return rest;
      }
      // Supervisor somewhere — resolve which departments. One query to check
      // if they supervise any marketing and/or CS team across all branches.
      const rows = await this.db
        .select({ department: schema.branchTeams.department })
        .from(schema.branchTeamMembers)
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, schema.branchTeamMembers.teamId))
        .where(
          and(
            eq(schema.branchTeamMembers.userId, user.id),
            eq(schema.branchTeamMembers.isSupervisor, true),
          ),
        );
      const depts = new Set(rows.map((r) => r.department));
      return {
        ...user,
        isMarketingTeamSupervisorOnActiveBranch: depts.has('MARKETING') ? true : undefined,
        isCsTeamSupervisorOnActiveBranch: depts.has('CS') ? true : undefined,
      } as SessionUser;
    }
    const { marketing, cs } = await this.getSupervisorFlagsForBranch(user.id, branchId);
    // Consumers check `=== true`, so `undefined` is equivalent to "absent".
    return {
      ...user,
      isMarketingTeamSupervisorOnActiveBranch: marketing ? true : undefined,
      isCsTeamSupervisorOnActiveBranch: cs ? true : undefined,
    } as SessionUser;
  }

  /**
   * Reverse direction of {@link listSupervisedUserIds} — given a supervisee
   * (`userId`), return the user IDs of every supervisor on every team they
   * belong to on this branch in the given department. Used by the funding
   * request recipient picker so an MB's modal can preselect "their"
   * supervisor as the default approver.
   *
   * Excludes `userId` themselves (a supervisor of an empty team can be both
   * supervisor and member of the same row in some edge schemas — we never
   * want to suggest "send funding to yourself").
   */
  async listSupervisorIdsForUser(
    userId: string,
    branchId: string,
    department: BranchTeamDepartment,
  ): Promise<string[]> {
    return this.safeBranchTeamsRead([], async () => {
      // Find every team the user is a (non-supervisor) member of, then
      // return every OTHER member on those teams flagged as supervisor.
      const mem = alias(schema.branchTeamMembers, 'mem_self');
      const sup = alias(schema.branchTeamMembers, 'sup_for_self');
      const rows = await this.db
        .select({ supervisorId: sup.userId })
        .from(mem)
        .innerJoin(sup, eq(sup.teamId, mem.teamId))
        .innerJoin(schema.branchTeams, eq(schema.branchTeams.id, mem.teamId))
        .where(
          and(
            eq(mem.userId, userId),
            eq(mem.isSupervisor, false),
            eq(sup.isSupervisor, true),
            ne(sup.userId, userId),
            eq(schema.branchTeams.branchId, branchId),
            eq(schema.branchTeams.department, department),
          ),
        );
      return [...new Set(rows.map((r) => r.supervisorId))];
    });
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
   * Mirror fallback: true when actor may mirror target via the branch-team
   * supervision graph anywhere they directly supervise that user.
   *
   * This intentionally matches `/trpc/branches.amISupervisorOfUser` and the
   * `/hr/users/:id` profile-access rule: if a supervisor can open a direct
   * report's staff profile, they should also see the mirror affordance there,
   * even before their active branch is switched to that supervisee's branch.
   */
  // ── Department Deactivation ──────────────────────────────────────

  /** Pre-flight counts for the deactivation modal. */
  async preflightDeactivateDepartment(branchDepartmentId: string) {
    const [dept] = await this.db
      .select({ id: schema.branchDepartments.id, branchId: schema.branchDepartments.branchId, department: schema.branchDepartments.department, status: schema.branchDepartments.status })
      .from(schema.branchDepartments)
      .where(eq(schema.branchDepartments.id, branchDepartmentId))
      .limit(1);
    if (!dept) throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
    if (dept.status !== 'ACTIVE') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Department is already deactivated' });

    // Check if this is the last active department of its type
    const [sameTypeCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.branchDepartments)
      .where(and(eq(schema.branchDepartments.department, dept.department), eq(schema.branchDepartments.status, 'ACTIVE')));
    const isLast = (sameTypeCount?.count ?? 0) <= 1;

    // Count affected data
    const isCS = dept.department === 'CS';
    const activeOrderStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'];
    const branchColName = isCS ? 'servicing_branch_id' : 'branch_id';
    const [[orderCount], [fuOrderCount], [userCount], [campaignCount]] = await Promise.all([
      this.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM orders WHERE ${sql.raw(branchColName)} = ${dept.branchId} AND status IN (${sql.join(activeOrderStatuses.map(s => sql`${s}`), sql`, `)}) AND deleted_at IS NULL`),
      this.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM follow_up_orders WHERE ${sql.raw(branchColName)} = ${dept.branchId} AND deleted_at IS NULL`),
      this.db.select({ count: sql<number>`count(*)::int` }).from(schema.branchDepartmentMembers)
        .where(eq(schema.branchDepartmentMembers.branchDepartmentId, branchDepartmentId)),
      this.db.select({ count: sql<number>`count(*)::int` }).from(schema.campaigns)
        .where(and(eq(schema.campaigns.branchId, dept.branchId), eq(schema.campaigns.status, 'ACTIVE'))),
    ]);

    // Get eligible target branches (same department type, active)
    const targets = await this.db
      .select({ branchId: schema.branchDepartments.branchId, branchName: schema.branches.name })
      .from(schema.branchDepartments)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.branchDepartments.branchId))
      .where(and(
        eq(schema.branchDepartments.department, dept.department),
        eq(schema.branchDepartments.status, 'ACTIVE'),
        ne(schema.branchDepartments.id, branchDepartmentId),
      ));

    return {
      department: dept.department,
      branchId: dept.branchId,
      isLast,
      activeOrders: orderCount?.count ?? 0,
      followUpOrders: fuOrderCount?.count ?? 0,
      users: userCount?.count ?? 0,
      campaigns: campaignCount?.count ?? 0,
      eligibleTargets: targets,
    };
  }

  /** Deactivate a department and transfer active data to the target branch. */
  async deactivateDepartment(branchDepartmentId: string, targetBranchId: string, actor: SessionUser) {
    const [dept] = await this.db
      .select()
      .from(schema.branchDepartments)
      .where(eq(schema.branchDepartments.id, branchDepartmentId))
      .limit(1);
    if (!dept) throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
    if (dept.status !== 'ACTIVE') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Department is already deactivated' });

    // Block if last of its type
    const [sameTypeCount] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.branchDepartments)
      .where(and(eq(schema.branchDepartments.department, dept.department), eq(schema.branchDepartments.status, 'ACTIVE')));
    if ((sameTypeCount?.count ?? 0) <= 1) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Cannot deactivate the last active ${dept.department} department.` });
    }

    // Verify target has same department type
    const [targetDept] = await this.db
      .select({ id: schema.branchDepartments.id })
      .from(schema.branchDepartments)
      .where(and(
        eq(schema.branchDepartments.branchId, targetBranchId),
        eq(schema.branchDepartments.department, dept.department),
        eq(schema.branchDepartments.status, 'ACTIVE'),
      ))
      .limit(1);
    if (!targetDept) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Target branch does not have an active department of the same type.' });

    const isCS = dept.department === 'CS';
    const activeOrderStatuses = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'];
    const nowIso = new Date().toISOString();

    await withActor(this.db, actor, async (tx) => {
      // 1. Transfer active orders (keep assignedCsId — follows the CS)
      if (isCS) {
        await tx.execute(sql`UPDATE orders SET servicing_branch_id = ${targetBranchId}, updated_at = ${nowIso}::timestamptz WHERE servicing_branch_id = ${dept.branchId} AND status IN (${sql.join(activeOrderStatuses.map(s => sql`${s}`), sql`, `)}) AND deleted_at IS NULL`);
      } else {
        await tx.execute(sql`UPDATE orders SET branch_id = ${targetBranchId}, updated_at = ${nowIso}::timestamptz WHERE branch_id = ${dept.branchId} AND status IN (${sql.join(activeOrderStatuses.map(s => sql`${s}`), sql`, `)}) AND deleted_at IS NULL`);
      }

      // 2. Transfer active follow-up orders
      if (isCS) {
        await tx.execute(sql`UPDATE follow_up_orders SET servicing_branch_id = ${targetBranchId}, updated_at = ${nowIso}::timestamptz WHERE servicing_branch_id = ${dept.branchId} AND deleted_at IS NULL`);
      } else {
        await tx.execute(sql`UPDATE follow_up_orders SET branch_id = ${targetBranchId}, updated_at = ${nowIso}::timestamptz WHERE branch_id = ${dept.branchId} AND deleted_at IS NULL`);
      }

      // 3. Move users: add to target department + target branch
      const members = await tx
        .select({ userId: schema.branchDepartmentMembers.userId })
        .from(schema.branchDepartmentMembers)
        .where(eq(schema.branchDepartmentMembers.branchDepartmentId, branchDepartmentId));

      if (members.length > 0) {
        const memberIds = members.map((m) => m.userId);

        // Add to target department roster (skip duplicates)
        for (const m of members) {
          await tx.insert(schema.branchDepartmentMembers)
            .values({ branchDepartmentId: targetDept.id, userId: m.userId })
            .onConflictDoNothing();
        }

        // Add to target branch membership (skip duplicates)
        for (const m of members) {
          const [existing] = await tx
            .select({ userId: schema.userBranches.userId })
            .from(schema.userBranches)
            .where(and(eq(schema.userBranches.userId, m.userId), eq(schema.userBranches.branchId, targetBranchId)))
            .limit(1);
          if (!existing) {
            await tx.insert(schema.userBranches).values({ userId: m.userId, branchId: targetBranchId, isPrimary: false });
          }
        }

        // Remove from source department roster
        await tx.delete(schema.branchDepartmentMembers)
          .where(eq(schema.branchDepartmentMembers.branchDepartmentId, branchDepartmentId));

        // Remove from source branch team memberships
        const sourceTeams = await tx
          .select({ id: schema.branchTeams.id })
          .from(schema.branchTeams)
          .where(eq(schema.branchTeams.branchDepartmentId, branchDepartmentId));
        if (sourceTeams.length > 0) {
          await tx.delete(schema.branchTeamMembers)
            .where(and(
              inArray(schema.branchTeamMembers.teamId, sourceTeams.map((t) => t.id)),
              inArray(schema.branchTeamMembers.userId, memberIds),
            ));
        }
      }

      // 4. Move active campaigns (Marketing department only)
      if (!isCS) {
        await tx.execute(sql`UPDATE campaigns SET branch_id = ${targetBranchId} WHERE branch_id = ${dept.branchId} AND status = 'ACTIVE'`);
      }

      // 5. Mark department as deactivated
      await tx.update(schema.branchDepartments)
        .set({ status: 'DEACTIVATED', deactivatedAt: new Date(), deactivatedBy: actor.id, updatedAt: new Date() })
        .where(eq(schema.branchDepartments.id, branchDepartmentId));
    });

    // Invalidate caches
    await this.cache.delPattern('cache:branchTeams:*').catch(() => {});
    await this.cache.delPattern('cache:branches:*').catch(() => {});

    return { success: true };
  }

  /** Reactivate a previously deactivated department. */
  async reactivateDepartment(branchDepartmentId: string, _actor: SessionUser) {
    const [dept] = await this.db
      .select()
      .from(schema.branchDepartments)
      .where(eq(schema.branchDepartments.id, branchDepartmentId))
      .limit(1);
    if (!dept) throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
    if (dept.status === 'ACTIVE') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Department is already active' });

    await this.db
      .update(schema.branchDepartments)
      .set({ status: 'ACTIVE', deactivatedAt: null, deactivatedBy: null, updatedAt: new Date() })
      .where(eq(schema.branchDepartments.id, branchDepartmentId));

    await this.cache.delPattern('cache:branchTeams:*').catch(() => {});
    await this.cache.delPattern('cache:branches:*').catch(() => {});

    return { success: true };
  }

  async actorCanMirrorViaSupervision(
    actor: { id: string; currentBranchId?: string | null },
    target: { id: string; role: string },
  ): Promise<boolean> {
    if (target.role !== 'CS_CLOSER' && target.role !== 'MEDIA_BUYER') return false;
    return this.isSupervisorOfUserAnywhere(actor.id, target.id);
  }
}
