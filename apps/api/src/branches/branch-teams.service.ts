import { Injectable, Inject } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
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
        members: byTeam.get(t.id) ?? [],
      }));
    });
  }

  async createTeam(
    branchId: string,
    department: BranchTeamDepartment,
    name: string | undefined,
    _actor: SessionUser,
  ) {
    return this.safeBranchTeamsWrite(async () => {
      const [row] = await this.db
        .insert(schema.branchTeams)
        .values({
          branchId,
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

  async addTeamMember(teamId: string, userId: string, isSupervisor: boolean, _actor: SessionUser) {
    await this.safeBranchTeamsWrite(async () => {
      const [team] = await this.db
        .select({ branchId: schema.branchTeams.branchId })
        .from(schema.branchTeams)
        .where(eq(schema.branchTeams.id, teamId))
        .limit(1);
      if (!team) throw new TRPCError({ code: 'NOT_FOUND', message: 'Team not found' });
      await this.assertUserBranchMember(userId, team.branchId);
      await this.db
        .insert(schema.branchTeamMembers)
        .values({ teamId, userId, isSupervisor })
        .onConflictDoUpdate({
          target: [schema.branchTeamMembers.teamId, schema.branchTeamMembers.userId],
          set: { isSupervisor },
        });
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

  /** Same team, CS department, actor is supervisor, supervisee is non-supervisor CS_AGENT. */
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
            eq(schema.users.role, 'CS_AGENT'),
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
        department === 'CS' ? eq(schema.users.role, 'CS_AGENT') : eq(schema.users.role, 'MEDIA_BUYER');

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
    if (target.role === 'CS_AGENT') {
      return this.isCsSupervisorOf(actor.id, target.id, branchId);
    }
    if (target.role === 'MEDIA_BUYER') {
      return this.isMarketingSupervisorOf(actor.id, target.id, branchId);
    }
    return false;
  }
}
