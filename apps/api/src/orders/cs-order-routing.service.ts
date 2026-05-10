import { Injectable, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  CreateCsRoutingRuleInput,
  CsRoutingRelationshipMode,
  UpdateCsRoutingRuleInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import type { SessionUser } from '../common/decorators/current-user.decorator';

export type CsRoutingDispatchResolution = {
  servicingBranchId: string;
  /**
   * When non-null, auto-dispatch must only consider these CS_CLOSER ids (subset of servicing branch pool).
   * When null, no routing rule applied — use default servicing branch (order branch) with no id filter.
   */
  restrictToCloserIds: string[] | null;
  crossBranchServicing: boolean;
  /**
   * CS squad whose branch_team_settings control CS_DISPATCH_STRATEGY / CS_CLAIM_CAP for this order.
   * When routing targets the whole branch (no squad), this is the branch's default CS team (first created).
   */
  dispatchSettingsTeamId: string | null;
};

function assertRoutingBranchScope(actor: SessionUser, ownerBranchId: string): void {
  if (actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN') return;
  if (actor.role === 'HEAD_OF_CS') return;
  if (actor.role === 'BRANCH_ADMIN') {
    if (!actor.currentBranchId || actor.currentBranchId !== ownerBranchId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Branch admins may only manage CS routing for their active branch.',
      });
    }
    return;
  }
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to manage CS order routing' });
}

function pickWeightedIndex(orderId: string, weights: number[]): number {
  const total = weights.reduce((s, w) => s + Math.max(1, w), 0);
  if (total <= 0) return 0;
  const slot = stablePickUint32(orderId, total);
  let cursor = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = Math.max(1, weights[i] ?? 1);
    if (slot < cursor + w) return i;
    cursor += w;
  }
  return 0;
}

function stablePickUint32(seed: string, modulo: number): number {
  if (modulo <= 0) return 0;
  const buf = createHash('sha256').update(seed, 'utf8').digest();
  return buf.readUInt32BE(0) % modulo;
}

@Injectable()
export class CsOrderRoutingService {
  constructor(@Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>) {}

  /** First CS squad on a branch — used for dispatch-setting inheritance when routing uses branch-wide pool. */
  async resolveDefaultCsTeamIdForBranch(branchId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: schema.branchTeams.id })
      .from(schema.branchTeams)
      .where(and(eq(schema.branchTeams.branchId, branchId), eq(schema.branchTeams.department, 'CS')))
      .orderBy(asc(schema.branchTeams.createdAt))
      .limit(1);
    return row?.id ?? null;
  }

  async getRelationshipMode(ownerBranchId: string): Promise<CsRoutingRelationshipMode> {
    const [row] = await this.db
      .select({ relationshipMode: schema.csOrderRoutingBranchSettings.relationshipMode })
      .from(schema.csOrderRoutingBranchSettings)
      .where(eq(schema.csOrderRoutingBranchSettings.ownerBranchId, ownerBranchId))
      .limit(1);
    return (row?.relationshipMode as CsRoutingRelationshipMode | undefined) ?? 'BRANCH_DEFAULT';
  }

  async setRelationshipMode(actor: SessionUser, ownerBranchId: string, mode: CsRoutingRelationshipMode) {
    assertRoutingBranchScope(actor, ownerBranchId);
    await this.db
      .insert(schema.csOrderRoutingBranchSettings)
      .values({
        ownerBranchId,
        relationshipMode: mode,
      })
      .onConflictDoUpdate({
        target: schema.csOrderRoutingBranchSettings.ownerBranchId,
        set: {
          relationshipMode: mode,
          updatedAt: new Date(),
        },
      });
    return { ok: true as const };
  }

  async listRules(ownerBranchId: string) {
    const mode = await this.getRelationshipMode(ownerBranchId);
    const productShape =
      mode === 'BRANCH_DEFAULT'
        ? isNull(schema.csOrderRoutingRules.productId)
        : isNotNull(schema.csOrderRoutingRules.productId);

    const rules = await this.db
      .select()
      .from(schema.csOrderRoutingRules)
      .where(and(eq(schema.csOrderRoutingRules.ownerBranchId, ownerBranchId), productShape))
      .orderBy(desc(schema.csOrderRoutingRules.priority), asc(schema.csOrderRoutingRules.createdAt));

    if (rules.length === 0) return [];

    const ruleIds = rules.map((r) => r.id);
    const targets = await this.db
      .select()
      .from(schema.csOrderRoutingRuleTargets)
      .where(inArray(schema.csOrderRoutingRuleTargets.ruleId, ruleIds));

    const byRule = new Map<string, typeof targets>();
    for (const t of targets) {
      const list = byRule.get(t.ruleId) ?? [];
      list.push(t);
      byRule.set(t.ruleId, list);
    }

    return rules.map((r) => ({
      ...r,
      targets: byRule.get(r.id) ?? [],
    }));
  }

  async createRule(actor: SessionUser, input: CreateCsRoutingRuleInput) {
    assertRoutingBranchScope(actor, input.ownerBranchId);

    await this.assertRuleProductMatchesRelationshipMode(input.ownerBranchId, input.productId ?? null);

    await this.assertRoutingTargets(input.targets);

    const strategy = input.strategy ?? 'EQUAL';
    if (strategy === 'WEIGHTED') {
      for (const t of input.targets) {
        if ((t.weight ?? 1) < 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'WEIGHTED strategy requires weight ≥ 1 per target' });
        }
      }
    }

    const [rule] = await this.db
      .insert(schema.csOrderRoutingRules)
      .values({
        ownerBranchId: input.ownerBranchId,
        productId: input.productId ?? null,
        priority: input.priority ?? 0,
        enabled: input.enabled ?? true,
        strategy,
      })
      .returning();

    if (!rule) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create routing rule' });
    }

    await this.db.insert(schema.csOrderRoutingRuleTargets).values(
      input.targets.map((t) => ({
        ruleId: rule.id,
        servicingBranchId: t.servicingBranchId,
        teamId: t.teamId ?? null,
        weight: t.weight ?? 1,
      })),
    );

    return rule;
  }

  async updateRule(actor: SessionUser, input: UpdateCsRoutingRuleInput) {
    const [existing] = await this.db
      .select()
      .from(schema.csOrderRoutingRules)
      .where(eq(schema.csOrderRoutingRules.id, input.ruleId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Routing rule not found' });

    assertRoutingBranchScope(actor, existing.ownerBranchId);

    const effectiveProductId =
      input.productId !== undefined ? input.productId : existing.productId;
    await this.assertRuleProductMatchesRelationshipMode(existing.ownerBranchId, effectiveProductId);

    if (input.targets?.length) {
      await this.assertRoutingTargets(input.targets);
    }

    const strategy = input.strategy ?? existing.strategy;
    if (strategy === 'WEIGHTED' && input.targets?.length) {
      for (const t of input.targets) {
        if ((t.weight ?? 1) < 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'WEIGHTED strategy requires weight ≥ 1 per target' });
        }
      }
    }

    await this.db
      .update(schema.csOrderRoutingRules)
      .set({
        ...(input.productId !== undefined ? { productId: input.productId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.csOrderRoutingRules.id, input.ruleId));

    if (input.targets?.length) {
      await this.db
        .delete(schema.csOrderRoutingRuleTargets)
        .where(eq(schema.csOrderRoutingRuleTargets.ruleId, input.ruleId));
      await this.db.insert(schema.csOrderRoutingRuleTargets).values(
        input.targets.map((t) => ({
          ruleId: input.ruleId,
          servicingBranchId: t.servicingBranchId,
          teamId: t.teamId ?? null,
          weight: t.weight ?? 1,
        })),
      );
    }

    const [row] = await this.db
      .select()
      .from(schema.csOrderRoutingRules)
      .where(eq(schema.csOrderRoutingRules.id, input.ruleId))
      .limit(1);
    return row ?? existing;
  }

  async deleteRule(actor: SessionUser, ruleId: string) {
    const [existing] = await this.db
      .select()
      .from(schema.csOrderRoutingRules)
      .where(eq(schema.csOrderRoutingRules.id, ruleId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Routing rule not found' });
    assertRoutingBranchScope(actor, existing.ownerBranchId);
    await this.db.delete(schema.csOrderRoutingRules).where(eq(schema.csOrderRoutingRules.id, ruleId));
    return { ok: true as const };
  }

  /**
   * Resolves which servicing branch supplies CS capacity and optional closer-id restriction
   * for auto-dispatch (load_balanced / performance).
   */
  async resolveRoutingForDispatch(
    orderBranchId: string | null | undefined,
    primaryProductId: string | null | undefined,
    orderId: string,
  ): Promise<CsRoutingDispatchResolution | null> {
    if (!orderBranchId) return null;

    const mode = await this.getRelationshipMode(orderBranchId);

    if (mode === 'PRODUCT_ALLOCATION' && !primaryProductId) {
      return {
        servicingBranchId: orderBranchId,
        restrictToCloserIds: null,
        crossBranchServicing: false,
        dispatchSettingsTeamId: await this.resolveDefaultCsTeamIdForBranch(orderBranchId),
      };
    }

    const productMatch =
      mode === 'BRANCH_DEFAULT'
        ? isNull(schema.csOrderRoutingRules.productId)
        : eq(schema.csOrderRoutingRules.productId, primaryProductId!);

    const [rule] = await this.db
      .select()
      .from(schema.csOrderRoutingRules)
      .where(
        and(
          eq(schema.csOrderRoutingRules.ownerBranchId, orderBranchId),
          eq(schema.csOrderRoutingRules.enabled, true),
          productMatch,
        ),
      )
      .orderBy(desc(schema.csOrderRoutingRules.priority), asc(schema.csOrderRoutingRules.createdAt))
      .limit(1);

    if (!rule) {
      return {
        servicingBranchId: orderBranchId,
        restrictToCloserIds: null,
        crossBranchServicing: false,
        dispatchSettingsTeamId: await this.resolveDefaultCsTeamIdForBranch(orderBranchId),
      };
    }

    const targets = await this.db
      .select()
      .from(schema.csOrderRoutingRuleTargets)
      .where(eq(schema.csOrderRoutingRuleTargets.ruleId, rule.id));

    if (targets.length === 0) {
      return {
        servicingBranchId: orderBranchId,
        restrictToCloserIds: [],
        crossBranchServicing: false,
        dispatchSettingsTeamId: await this.resolveDefaultCsTeamIdForBranch(orderBranchId),
      };
    }

    const weights = targets.map((t) => t.weight ?? 1);
    const idx =
      rule.strategy === 'WEIGHTED'
        ? pickWeightedIndex(orderId, weights)
        : stablePickUint32(orderId, targets.length);
    const chosen = targets[idx];
    if (!chosen) {
      return {
        servicingBranchId: orderBranchId,
        restrictToCloserIds: [],
        crossBranchServicing: false,
        dispatchSettingsTeamId: await this.resolveDefaultCsTeamIdForBranch(orderBranchId),
      };
    }

    const servicingBranchId = chosen.servicingBranchId;
    const crossBranchServicing = servicingBranchId !== orderBranchId;

    if (!chosen.teamId) {
      return {
        servicingBranchId,
        restrictToCloserIds: null,
        crossBranchServicing,
        dispatchSettingsTeamId: await this.resolveDefaultCsTeamIdForBranch(servicingBranchId),
      };
    }

    const members = await this.db
      .select({ userId: schema.branchTeamMembers.userId })
      .from(schema.branchTeamMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.branchTeamMembers.userId))
      .where(
        and(
          eq(schema.branchTeamMembers.teamId, chosen.teamId),
          eq(schema.users.role, 'CS_CLOSER'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    if (members.length === 0) {
      return {
        servicingBranchId,
        restrictToCloserIds: [],
        crossBranchServicing,
        dispatchSettingsTeamId: chosen.teamId,
      };
    }

    const memberIds = [...new Set(members.map((m) => m.userId))];
    const branchMembers = await this.db
      .select({ userId: schema.userBranches.userId })
      .from(schema.userBranches)
      .where(
        and(
          eq(schema.userBranches.branchId, servicingBranchId),
          inArray(schema.userBranches.userId, memberIds),
        ),
      );

    const allowed = new Set(branchMembers.map((b) => b.userId));
    const filtered = memberIds.filter((id) => allowed.has(id));

    return {
      servicingBranchId,
      restrictToCloserIds: filtered,
      crossBranchServicing,
      dispatchSettingsTeamId: chosen.teamId,
    };
  }

  private async assertRuleProductMatchesRelationshipMode(ownerBranchId: string, productId: string | null | undefined): Promise<void> {
    const mode = await this.getRelationshipMode(ownerBranchId);
    const pid = productId ?? null;
    if (mode === 'BRANCH_DEFAULT' && pid !== null) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Branch relationship mode only supports rules without a product — switch to Product allocation to route by SKU.',
      });
    }
    if (mode === 'PRODUCT_ALLOCATION' && pid === null) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Product allocation mode requires a product on each rule.',
      });
    }
  }

  private async assertRoutingTargets(
    targets: Array<{ servicingBranchId: string; teamId?: string | null }>,
  ): Promise<void> {
    if (targets.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'At least one routing target is required' });
    }

    const teamIds = targets.map((t) => t.teamId).filter((id): id is string => !!id);
    const teamRows =
      teamIds.length > 0
        ? await this.db
            .select({
              id: schema.branchTeams.id,
              department: schema.branchTeams.department,
              teamBranchId: schema.branchTeams.branchId,
            })
            .from(schema.branchTeams)
            .where(inArray(schema.branchTeams.id, teamIds))
        : [];

    const teamById = new Map(teamRows.map((r) => [r.id, r]));

    for (const t of targets) {
      if (!t.servicingBranchId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Each target requires servicingBranchId' });
      }
      if (!t.teamId) continue;

      const row = teamById.get(t.teamId);
      if (!row) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'One or more target teams were not found' });
      }
      if (row.department !== 'CS' || row.teamBranchId !== t.servicingBranchId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Team targets must be CS squads on the chosen servicing branch',
        });
      }
    }
  }
}
