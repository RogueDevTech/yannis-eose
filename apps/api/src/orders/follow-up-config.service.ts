import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, inArray, isNull, lte, sql, asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, SYSTEM_ACTOR_ID } from '@yannis/shared';
import type {
  CreateFollowUpRuleInput,
  UpdateFollowUpRuleInput,
  ListFollowUpOrdersInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { CacheService } from '../common/cache/cache.service';
import { EventsService } from '../events/events.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { randomUUID } from 'node:crypto';

const MAX_PER_RULE = 10_000;
const SYNC_PROGRESS_KEY = 'cache:followup:sync_progress';
const SYNC_PROGRESS_TTL = 300; // 5 minutes

@Injectable()
export class FollowUpConfigService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FollowUpConfigService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly cache: CacheService,
    private readonly events: EventsService,
  ) {}

  async onApplicationBootstrap() {
    // Seed default rules + default group on first deploy (idempotent).
    await this.seedDefaultRules();
    await this.seedDefaultGroup();

    // Ensure all CS closers are in all active branches.
    await this.syncCloserBranchMemberships();

    // One-time fix: sync servicingBranchId for assigned follow-up orders
    // to match the closer's branch (pre-fix orders had stale round-robin branches).
    await this.syncAssignedOrderBranches();

    // Delay 45s after boot, then run sync (includes cart pull via CART_ABANDONMENT rules).
    setTimeout(() => {
      this.runSync('cron').catch((err) =>
        this.logger.error(`Boot sync failed: ${err instanceof Error ? err.message : err}`),
      );
    }, 45_000);
  }

  /**
   * CEO directive: auto-create default follow-up rules on deploy.
   * Idempotent — checks by name, only inserts rules that don't already exist.
   */
  private async seedDefaultRules() {
    const defaults = [
      {
        name: 'Unconfirmed orders older than 3 days',
        sourceStatus: 'CS_ENGAGED',
        ageThresholdDays: 3,
        maxAgeDays: null as number | null,
        priority: 10,
      },
      {
        name: 'Confirmed undelivered older than 7 days',
        sourceStatus: 'CONFIRMED',
        ageThresholdDays: 7,
        maxAgeDays: null as number | null,
        priority: 5,
      },
      {
        name: 'Cart abandonments older than 24 hours',
        sourceStatus: 'CART_ABANDONMENT',
        ageThresholdDays: 1,
        maxAgeDays: null as number | null,
        priority: 15,
      },
    ];

    const existing = await this.db
      .select({ name: schema.followUpRules.name })
      .from(schema.followUpRules);
    const existingNames = new Set(existing.map((r) => r.name));

    let seeded = 0;
    for (const rule of defaults) {
      if (existingNames.has(rule.name)) continue;
      try {
        await this.db.insert(schema.followUpRules).values({
          name: rule.name,
          sourceStatus: rule.sourceStatus,
          ageThresholdDays: rule.ageThresholdDays,
          maxAgeDays: rule.maxAgeDays,
          sourceBranchId: null,
          targetBranchId: null,
          targetGroupId: null,
          priority: rule.priority,
          enabled: true,
        });
        seeded++;
      } catch (err) {
        // Skip duplicate / constraint violations (e.g. overlap index)
        this.logger.warn(`Skipped seeding rule "${rule.name}": ${err instanceof Error ? err.message : err}`);
      }
    }

    if (seeded > 0) this.logger.log(`Seeded ${seeded} default follow-up rule(s)`);

    // One-time fix: rules created before "All branches" support had targetBranchId
    // set to the first branch. Clear it on ALL rules that pull from all branches
    // (sourceBranchId = NULL) so they default to round-robin.
    await this.db
      .update(schema.followUpRules)
      .set({ targetBranchId: null, targetGroupId: null })
      .where(
        and(
          isNull(schema.followUpRules.sourceBranchId),
          sql`${schema.followUpRules.targetBranchId} IS NOT NULL`,
          sql`${schema.followUpRules.targetGroupId} IS NULL`,
        ),
      );
  }

  /**
   * Seed a default "All CS Closers" follow-up group containing every CS_CLOSER user.
   * Idempotent — skips if a group with that name already exists.
   * On subsequent boots, syncs membership (adds new closers, removes departed ones).
   */
  private async seedDefaultGroup() {
    const DEFAULT_GROUP_NAME = 'All CS Closers';

    // Get all active CS closers
    const closers = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE')));
    if (closers.length === 0) return;

    const [existing] = await this.db
      .select({ id: schema.followUpGroups.id })
      .from(schema.followUpGroups)
      .where(eq(schema.followUpGroups.name, DEFAULT_GROUP_NAME))
      .limit(1);

    if (existing) {
      // Sync membership — add new closers, remove departed ones
      const currentMembers = await this.db
        .select({ userId: schema.followUpGroupMembers.userId })
        .from(schema.followUpGroupMembers)
        .where(eq(schema.followUpGroupMembers.groupId, existing.id));
      const currentIds = new Set(currentMembers.map((m) => m.userId));
      const targetIds = new Set(closers.map((c) => c.id));

      const toAdd = closers.filter((c) => !currentIds.has(c.id));
      const toRemove = currentMembers.filter((m) => !targetIds.has(m.userId));

      if (toAdd.length > 0) {
        await this.db.insert(schema.followUpGroupMembers).values(
          toAdd.map((c) => ({ groupId: existing.id, userId: c.id })),
        );
      }
      if (toRemove.length > 0) {
        await this.db
          .delete(schema.followUpGroupMembers)
          .where(and(
            eq(schema.followUpGroupMembers.groupId, existing.id),
            inArray(schema.followUpGroupMembers.userId, toRemove.map((m) => m.userId)),
          ));
      }
      if (toAdd.length > 0 || toRemove.length > 0) {
        this.logger.log(`Synced default group "${DEFAULT_GROUP_NAME}": +${toAdd.length} -${toRemove.length}`);
      }
      return;
    }

    // Create the group — need a creator ID (first SuperAdmin)
    const [sa] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.role, 'SUPER_ADMIN'))
      .limit(1);
    if (!sa) return;

    const [group] = await this.db.insert(schema.followUpGroups).values({
      name: DEFAULT_GROUP_NAME,
      createdById: sa.id,
    }).returning({ id: schema.followUpGroups.id });

    if (group && closers.length > 0) {
      await this.db.insert(schema.followUpGroupMembers).values(
        closers.map((c) => ({ groupId: group.id, userId: c.id })),
      );
    }
    this.logger.log(`Seeded default group "${DEFAULT_GROUP_NAME}" with ${closers.length} members`);
  }

  /**
   * Ensure all active CS_CLOSERs are members of every active branch.
   * Idempotent — only inserts missing memberships (unique index prevents dupes).
   * Runs on boot so newly created closers or branches are auto-linked.
   */
  private async syncCloserBranchMemberships() {
    try {
      const [closers, activeBranches, existingMemberships] = await Promise.all([
        this.db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(and(eq(schema.users.role, 'CS_CLOSER'), eq(schema.users.status, 'ACTIVE'))),
        this.db
          .select({ id: schema.branches.id })
          .from(schema.branches)
          .where(eq(schema.branches.status, 'ACTIVE')),
        this.db
          .select({ userId: schema.userBranches.userId, branchId: schema.userBranches.branchId })
          .from(schema.userBranches),
      ]);
      if (closers.length === 0 || activeBranches.length === 0) return;

      const existingSet = new Set(existingMemberships.map((m) => `${m.userId}:${m.branchId}`));
      const toInsert: Array<{ userId: string; branchId: string; isPrimary: boolean }> = [];

      for (const closer of closers) {
        for (const branch of activeBranches) {
          if (!existingSet.has(`${closer.id}:${branch.id}`)) {
            // First branch becomes primary if the closer has no existing memberships
            const hasPrimary = existingMemberships.some((m) => m.userId === closer.id);
            toInsert.push({
              userId: closer.id,
              branchId: branch.id,
              isPrimary: !hasPrimary && toInsert.filter((r) => r.userId === closer.id).length === 0,
            });
          }
        }
      }

      if (toInsert.length > 0) {
        // Insert in batches to avoid hitting query limits
        const BATCH = 500;
        for (let i = 0; i < toInsert.length; i += BATCH) {
          await this.db.insert(schema.userBranches).values(toInsert.slice(i, i + BATCH)).onConflictDoNothing();
        }
        this.logger.log(`Synced closer branch memberships: ${toInsert.length} new assignments across ${activeBranches.length} branches`);
      }
    } catch (err) {
      this.logger.warn(`syncCloserBranchMemberships failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * One-time fix: for follow-up orders that were assigned to a closer before
   * the branch-sync fix, update servicingBranchId to match the closer's branch.
   */
  private async syncAssignedOrderBranches() {
    try {
      // Find assigned follow-up orders and their closer's branch
      const assigned = await this.db
        .select({
          orderId: schema.followUpOrders.id,
          assignedCsId: schema.followUpOrders.assignedCsId,
          currentBranch: schema.followUpOrders.servicingBranchId,
          closerBranch: schema.userBranches.branchId,
        })
        .from(schema.followUpOrders)
        .innerJoin(schema.userBranches, eq(schema.userBranches.userId, schema.followUpOrders.assignedCsId))
        .where(and(
          isNull(schema.followUpOrders.deletedAt),
          sql`${schema.followUpOrders.assignedCsId} IS NOT NULL`,
        ));
      if (assigned.length === 0) return;

      // Only fix orders where branch doesn't match
      const mismatched = assigned.filter((r) => r.currentBranch !== r.closerBranch);
      if (mismatched.length === 0) return;

      // Group by target branch for batch updates
      const byBranch = new Map<string, string[]>();
      for (const r of mismatched) {
        if (!r.closerBranch) continue;
        const list = byBranch.get(r.closerBranch) ?? [];
        list.push(r.orderId);
        byBranch.set(r.closerBranch, list);
      }

      for (const [branchId, orderIds] of byBranch) {
        await this.db
          .update(schema.followUpOrders)
          .set({ servicingBranchId: branchId, updatedAt: new Date() })
          .where(inArray(schema.followUpOrders.id, orderIds));
      }

      this.logger.log(`Synced servicingBranchId for ${mismatched.length} assigned follow-up order(s)`);
    } catch (err) {
      this.logger.warn(`syncAssignedOrderBranches failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Cron ───────────────────────────────────────────────────────────

  @Cron('0 0 0 * * *', { timeZone: 'Africa/Lagos' })
  async handleMidnightSync() {
    try {
      const result = await this.runSync('cron');
      this.logger.log(`Midnight sync complete: ${result.totalPulled} orders pulled`);
    } catch (err) {
      this.logger.error(`Midnight sync failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Hourly cron removed — midnight + boot + manual sync is sufficient.

  /** Returns branches with an active CS department — for follow-up config dropdowns. */
  async listActiveCsBranches(): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({ id: schema.branches.id, name: schema.branches.name })
      .from(schema.branchDepartments)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.branchDepartments.branchId))
      .where(and(
        eq(schema.branchDepartments.department, 'CS'),
        eq(schema.branchDepartments.status, 'ACTIVE'),
        eq(schema.branches.status, 'ACTIVE'),
      ));
  }

  /** Returns branch IDs that have an active CS department — used for follow-up distribution. */
  private async getActiveCsBranchIds(): Promise<string[]> {
    const rows = await this.db
      .select({ branchId: schema.branchDepartments.branchId })
      .from(schema.branchDepartments)
      .innerJoin(schema.branches, eq(schema.branches.id, schema.branchDepartments.branchId))
      .where(and(
        eq(schema.branchDepartments.department, 'CS'),
        eq(schema.branchDepartments.status, 'ACTIVE'),
        eq(schema.branches.status, 'ACTIVE'),
      ));
    return rows.map((r) => r.branchId);
  }

  // ── Rule CRUD ──────────────────────────────────────────────────────

  async listRules(enabledOnly?: boolean) {
    const conditions = enabledOnly ? [eq(schema.followUpRules.enabled, true)] : [];
    const rules = await this.db
      .select()
      .from(schema.followUpRules)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.followUpRules.priority), asc(schema.followUpRules.createdAt));

    // Enrich with target names
    const branchIds = rules.map((r) => r.targetBranchId).filter(Boolean) as string[];
    const groupIds = rules.map((r) => r.targetGroupId).filter(Boolean) as string[];
    const sourceBranchIds = rules.map((r) => r.sourceBranchId).filter(Boolean) as string[];
    const allBranchIds = [...new Set([...branchIds, ...sourceBranchIds])];

    const [branchRows, groupRows] = await Promise.all([
      allBranchIds.length > 0
        ? this.db.select({ id: schema.branches.id, name: schema.branches.name }).from(schema.branches).where(inArray(schema.branches.id, allBranchIds))
        : Promise.resolve([]),
      groupIds.length > 0
        ? this.db.select({ id: schema.followUpGroups.id, name: schema.followUpGroups.name }).from(schema.followUpGroups).where(inArray(schema.followUpGroups.id, groupIds))
        : Promise.resolve([]),
    ]);

    const branchMap = new Map(branchRows.map((b) => [b.id, b.name]));
    const groupMap = new Map(groupRows.map((g) => [g.id, g.name]));

    return rules.map((r) => ({
      ...r,
      targetBranchName: r.targetBranchId ? (branchMap.get(r.targetBranchId) ?? null) : null,
      targetGroupName: r.targetGroupId ? (groupMap.get(r.targetGroupId) ?? null) : null,
      sourceBranchName: r.sourceBranchId ? (branchMap.get(r.sourceBranchId) ?? null) : null,
    }));
  }

  async createRule(actor: SessionUser, input: CreateFollowUpRuleInput) {
    return withActor(this.db, actor, async (tx) => {
      const [rule] = await tx
        .insert(schema.followUpRules)
        .values({
          name: input.name,
          sourceStatus: input.sourceStatus,
          ageThresholdDays: input.ageThresholdDays,
          maxAgeDays: input.maxAgeDays ?? null,
          sourceBranchId: input.sourceBranchId ?? null,
          targetBranchId: input.targetBranchId ?? null,
          targetGroupId: input.targetGroupId ?? null,
          priority: input.priority ?? 0,
          enabled: input.enabled ?? true,
        })
        .returning();
      return rule;
    });
  }

  async updateRule(actor: SessionUser, input: UpdateFollowUpRuleInput) {
    const [existing] = await this.db
      .select()
      .from(schema.followUpRules)
      .where(eq(schema.followUpRules.id, input.ruleId))
      .limit(1);
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });

    return withActor(this.db, actor, async (tx) => {
      const set: Record<string, unknown> = {};
      if (input.name !== undefined) set.name = input.name;
      if (input.sourceStatus !== undefined) set.sourceStatus = input.sourceStatus;
      if (input.ageThresholdDays !== undefined) set.ageThresholdDays = input.ageThresholdDays;
      if (input.maxAgeDays !== undefined) set.maxAgeDays = input.maxAgeDays;
      if (input.sourceBranchId !== undefined) set.sourceBranchId = input.sourceBranchId;
      if (input.targetBranchId !== undefined) set.targetBranchId = input.targetBranchId;
      if (input.targetGroupId !== undefined) set.targetGroupId = input.targetGroupId;
      if (input.priority !== undefined) set.priority = input.priority;
      if (input.enabled !== undefined) set.enabled = input.enabled;
      set.updatedAt = new Date();

      const [updated] = await tx
        .update(schema.followUpRules)
        .set(set)
        .where(eq(schema.followUpRules.id, input.ruleId))
        .returning();
      return updated;
    });
  }

  async deleteRule(actor: SessionUser, ruleId: string) {
    return withActor(this.db, actor, async (tx) => {
      await tx.delete(schema.followUpRules).where(eq(schema.followUpRules.id, ruleId));
    });
  }



  // ── Sync Engine ────────────────────────────────────────────────────

  /** Read excluded branch/group IDs from system settings. */
  private async getExcludedIds(): Promise<Set<string>> {
    try {
      const [row] = await this.db
        .select({ value: schema.systemSettings.value })
        .from(schema.systemSettings)
        .where(eq(schema.systemSettings.key, 'FOLLOW_UP_EXCLUDED_IDS'))
        .limit(1);
      if (row?.value) {
        // jsonb: value is already parsed. Handles { ids: [...] }, raw array, or string.
        const v = row.value as unknown;
        if (typeof v === 'object' && v !== null && 'ids' in v) {
          const ids = (v as { ids: unknown }).ids;
          if (Array.isArray(ids)) return new Set(ids as string[]);
        }
        if (Array.isArray(v)) return new Set(v as string[]);
        if (typeof v === 'string') return new Set(JSON.parse(v) as string[]);
      }
    } catch { /* ignore */ }
    return new Set();
  }

  /** Read current sync progress from Redis (survives page refresh). */
  async getSyncProgress(): Promise<unknown> {
    return this.cache.get(SYNC_PROGRESS_KEY);
  }

  async runSync(triggeredBy: 'cron' | 'manual', actorId?: string): Promise<{ totalPulled: number }> {
    let totalPulled = 0;
    const ruleResults: Array<{ ruleId: string; ruleName: string; pulled: number }> = [];
    const syncId = randomUUID();
    const startedAt = new Date().toISOString();

    const emitProgress = (patch: {
      currentRuleIndex: number;
      currentRuleName: string;
      currentRulePulled: number;
      status: 'running' | 'complete' | 'error';
      errorMessage?: string;
    }) => {
      const progress = {
        syncId,
        triggeredBy,
        startedAt,
        totalRules: 0, // updated below
        ...patch,
        totalPulledSoFar: totalPulled,
        ruleResults: ruleResults.map((r) => ({ ruleName: r.ruleName, pulled: r.pulled })),
      };
      // Store in Redis for page-refresh persistence
      void this.cache.set(SYNC_PROGRESS_KEY, progress, SYNC_PROGRESS_TTL).catch(() => {});
      // Emit via Socket.io for real-time updates
      this.events.emitFollowUpSyncProgress(progress);
    };

    try {
      const rules = await this.db
        .select()
        .from(schema.followUpRules)
        .where(eq(schema.followUpRules.enabled, true))
        .orderBy(desc(schema.followUpRules.priority), asc(schema.followUpRules.createdAt));

      // Emit start
      emitProgress({ currentRuleIndex: 0, currentRuleName: 'Starting...', currentRulePulled: 0, status: 'running' });
      // Patch totalRules now that we know it
      const totalRules = rules.length;

      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]!;
        // Emit "processing rule X"
        const progressBase = { currentRuleIndex: i + 1, currentRuleName: rule.name, currentRulePulled: 0, status: 'running' as const };
        emitProgress({ ...progressBase, totalPulledSoFar: totalPulled } as never);
        // Override totalRules in the stored progress
        void this.cache.set(SYNC_PROGRESS_KEY, {
          syncId, triggeredBy, startedAt, totalRules,
          ...progressBase, totalPulledSoFar: totalPulled,
          ruleResults: ruleResults.map((r) => ({ ruleName: r.ruleName, pulled: r.pulled })),
        }, SYNC_PROGRESS_TTL).catch(() => {});
        this.events.emitFollowUpSyncProgress({
          syncId, triggeredBy, startedAt, totalRules,
          ...progressBase, totalPulledSoFar: totalPulled,
          ruleResults: ruleResults.map((r) => ({ ruleName: r.ruleName, pulled: r.pulled })),
        });

        const pulled = rule.sourceStatus === 'CART_ABANDONMENT'
          ? await this.pullAbandonedCarts(rule.ageThresholdDays)
          : await this.pullOrdersForRule(rule, actorId);
        ruleResults.push({ ruleId: rule.id, ruleName: rule.name, pulled });
        totalPulled += pulled;

        // Emit rule-complete progress
        void this.cache.set(SYNC_PROGRESS_KEY, {
          syncId, triggeredBy, startedAt, totalRules,
          currentRuleIndex: i + 1, currentRuleName: rule.name, currentRulePulled: pulled,
          totalPulledSoFar: totalPulled, status: 'running',
          ruleResults: ruleResults.map((r) => ({ ruleName: r.ruleName, pulled: r.pulled })),
        }, SYNC_PROGRESS_TTL).catch(() => {});
        this.events.emitFollowUpSyncProgress({
          syncId, triggeredBy, startedAt, totalRules,
          currentRuleIndex: i + 1, currentRuleName: rule.name, currentRulePulled: pulled,
          totalPulledSoFar: totalPulled, status: 'running',
          ruleResults: ruleResults.map((r) => ({ ruleName: r.ruleName, pulled: r.pulled })),
        });
      }

      // Record sync log
      await this.db.insert(schema.followUpSyncLogs).values({
        triggeredBy,
        triggeredByUserId: actorId ?? null,
        finishedAt: new Date(),
        totalPulled,
        ruleResults,
      });
      if (totalPulled > 0) void this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});

      // Emit complete + clear Redis
      const completePayload = {
        syncId, triggeredBy, startedAt, totalRules: rules.length,
        currentRuleIndex: rules.length, currentRuleName: 'Complete',
        currentRulePulled: 0, totalPulledSoFar: totalPulled, status: 'complete' as const,
        ruleResults: ruleResults.map((r) => ({ ruleName: r.ruleName, pulled: r.pulled })),
      };
      this.events.emitFollowUpSyncProgress(completePayload);
      void this.cache.del(SYNC_PROGRESS_KEY).catch(() => {});
    } catch (err) {
      // Log error
      await this.db.insert(schema.followUpSyncLogs).values({
        triggeredBy,
        triggeredByUserId: actorId ?? null,
        finishedAt: new Date(),
        totalPulled,
        ruleResults,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      // Emit error + clear Redis
      this.events.emitFollowUpSyncProgress({
        syncId, triggeredBy, startedAt, totalRules: 0,
        currentRuleIndex: 0, currentRuleName: '', currentRulePulled: 0,
        totalPulledSoFar: totalPulled, status: 'error',
        ruleResults: ruleResults.map((r) => ({ ruleName: r.ruleName, pulled: r.pulled })),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      void this.cache.del(SYNC_PROGRESS_KEY).catch(() => {});
      throw err;
    }

    return { totalPulled };
  }

  private async pullOrdersForRule(rule: typeof schema.followUpRules.$inferSelect, _actorId?: string): Promise<number> {
    const minCutoff = new Date();
    minCutoff.setDate(minCutoff.getDate() - rule.ageThresholdDays);

    // Find matching orders not yet pulled
    const conditions = [
      sql`${schema.orders.status} = ${rule.sourceStatus}`,
      lte(schema.orders.createdAt, minCutoff),
      eq(schema.orders.frozenForFollowUp, false),
      eq(schema.orders.isFollowUp, false),
      isNull(schema.orders.deletedAt),
    ];

    // Optional upper age bound — only match orders newer than maxAgeDays
    if (rule.maxAgeDays) {
      const maxCutoff = new Date();
      maxCutoff.setDate(maxCutoff.getDate() - rule.maxAgeDays);
      conditions.push(gte(schema.orders.createdAt, maxCutoff));
    }

    if (rule.sourceBranchId) {
      conditions.push(eq(schema.orders.servicingBranchId, rule.sourceBranchId));
    }

    const matchingOrders = await this.db
      .select({
        id: schema.orders.id,
      })
      .from(schema.orders)
      .where(
        and(
          ...conditions,
          sql`${schema.orders.id} NOT IN (SELECT source_order_id FROM follow_up_orders WHERE source_order_id IS NOT NULL)`,
        ),
      )
      .limit(MAX_PER_RULE);

    if (matchingOrders.length === 0) return 0;

    const orderIds = matchingOrders.map((o) => o.id);

    // Fetch full order data + items for copying
    const [fullOrders, allItems] = await Promise.all([
      this.db.select().from(schema.orders).where(inArray(schema.orders.id, orderIds)),
      this.db.select().from(schema.orderItems).where(inArray(schema.orderItems.orderId, orderIds)),
    ]);

    const itemsByOrder = new Map<string, (typeof allItems)[number][]>();
    for (const item of allItems) {
      const list = itemsByOrder.get(item.orderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.orderId, list);
    }

    // Resolve target branch(es) for the follow-up orders.
    // When rule has a specific target branch, all orders go there.
    // When null, round-robin across all active branches for equal distribution.
    // Excluded branches (follow-up config toggle) are filtered out.
    const excludedIds = await this.getExcludedIds();
    let activeBranches: string[] = [];
    if (rule.targetBranchId) {
      activeBranches = excludedIds.has(rule.targetBranchId) ? [] : [rule.targetBranchId];
    } else {
      const csIds = await this.getActiveCsBranchIds();
      activeBranches = csIds.filter((id) => !excludedIds.has(id));
    }

    // Validate FK references: collect all user IDs referenced by source orders
    // and check which ones still exist. Null out invalid references to avoid FK violations.
    const referencedUserIds = [...new Set(
      fullOrders.flatMap((o) => [o.mediaBuyerId].filter(Boolean)),
    )] as string[];
    const referencedCampaignIds = [...new Set(
      fullOrders.map((o) => o.campaignId).filter(Boolean),
    )] as string[];
    const [validUserRows, validCampaignRows] = await Promise.all([
      referencedUserIds.length > 0
        ? this.db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, referencedUserIds))
        : Promise.resolve([]),
      referencedCampaignIds.length > 0
        ? this.db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(inArray(schema.campaigns.id, referencedCampaignIds))
        : Promise.resolve([]),
    ]);
    const validUserIds = new Set(validUserRows.map((u) => u.id));
    const validCampaignIds = new Set(validCampaignRows.map((c) => c.id));

    // Process each order individually — one bad order (trigger error, FK issue)
    // shouldn't block the rest of the batch.
    let succeeded = 0;
    for (let idx = 0; idx < fullOrders.length; idx++) {
      const orig = fullOrders[idx]!;
      try {
        const assignedBranch = activeBranches.length > 0
          ? activeBranches[idx % activeBranches.length]!
          : orig.servicingBranchId;
        const items = itemsByOrder.get(orig.id) ?? [];

        await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
          // Freeze source order
          await tx
            .update(schema.orders)
            .set({ frozenForFollowUp: true, updatedAt: new Date() })
            .where(eq(schema.orders.id, orig.id));

          // Create follow-up copy
          const [fuRow] = await tx
            .insert(schema.followUpOrders)
            .values({
              sourceOrderId: orig.id,
              followUpRuleId: rule.id,
              campaignId: orig.campaignId && validCampaignIds.has(orig.campaignId) ? orig.campaignId : null,
              mediaBuyerId: orig.mediaBuyerId && validUserIds.has(orig.mediaBuyerId) ? orig.mediaBuyerId : null,
              assignedCsId: null,
              logisticsProviderId: null,
              logisticsLocationId: null,
              riderId: null,
              status: 'UNPROCESSED' as const,
              items: orig.items,
              customerName: orig.customerName,
              customerPhoneHash: orig.customerPhoneHash,
              customerPhone: orig.customerPhone,
              customerAddress: orig.customerAddress,
              deliveryAddress: orig.deliveryAddress,
              totalAmount: orig.totalAmount,
              landedCost: orig.landedCost,
              deliveryFee: orig.deliveryFee,
              deliveryNotes: orig.deliveryNotes,
              deliveryState: orig.deliveryState,
              customerGender: orig.customerGender,
              preferredDeliveryDate: orig.preferredDeliveryDate,
              paymentMethod: orig.paymentMethod,
              customerEmail: orig.customerEmail,
              orderSource: 'follow-up',
              customFields: orig.customFields,
              branchId: orig.branchId,
              servicingBranchId: assignedBranch,
              cartId: orig.cartId,
            })
            .returning({ id: schema.followUpOrders.id });

          if (fuRow) {
            // Items
            if (items.length > 0) {
              await tx.insert(schema.followUpOrderItems).values(
                items.map((item) => ({
                  followUpOrderId: fuRow.id,
                  productId: item.productId,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  offerLabel: item.offerLabel,
                  batchId: item.batchId,
                })),
              );
            }

            // Timeline on source order
            await tx.insert(schema.orderTimelineEvents).values({
              orderId: orig.id,
              eventType: 'ORDER_ARCHIVED' as const,
              actorId: null,
              actorName: 'System',
              description: `Order frozen for follow-up (rule: ${rule.name}).`,
              metadata: { ruleId: rule.id, ruleName: rule.name },
              branchId: null,
            });

            // Timeline on follow-up order
            await tx.insert(schema.followUpOrderTimelineEvents).values({
              followUpOrderId: fuRow.id,
              eventType: 'ORDER_RECEIVED',
              actorId: null,
              actorName: 'System',
              description: `Follow-up order created from ${orig.orderNumber ? `YNS-${String(orig.orderNumber).padStart(5, '0')}` : 'original order'}.`,
              metadata: { sourceOrderId: orig.id, sourceOrderNumber: orig.orderNumber, ruleId: rule.id },
              branchId: assignedBranch,
            });
          }
        });
        succeeded++;
      } catch (err) {
        this.logger.warn(`Follow-up pull skipped order ${orig.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Follow-up orders live in the `follow_up_orders` table and are listed
    // via the Follow-Up Orders view (view=orders).  Batches are a CS-facing
    // construct backed by `follow_up_batch_items` → `orders` FK, so we do
    // NOT create an empty batch here — the orders aren't in the `orders`
    // table until they graduate on DELIVERED.

    if (succeeded < fullOrders.length) {
      this.logger.warn(`Rule "${rule.name}": pulled ${succeeded}/${fullOrders.length} orders (${fullOrders.length - succeeded} skipped)`);
    } else {
      this.logger.log(`Rule "${rule.name}": pulled ${succeeded} orders`);
    }
    return succeeded;
  }

  // ── Cart Abandonment Pull ──────────────────────────────────────────

  /**
   * Pull PENDING abandoned carts older than 24h into follow-up orders.
   * Preserves full MB attribution (mediaBuyerId, campaignId, orderSource='online').
   * Cart status → CONVERTED. Round-robin across active branches.
   */
  /**
   * Preview what a manual sync would pull — counts only, no mutations.
   * Used by the UI to show a confirmation modal before running the actual sync.
   */
  async dryRunSync(): Promise<Array<{ ruleId: string; ruleName: string; eligible: number }>> {
    const rules = await this.db
      .select()
      .from(schema.followUpRules)
      .where(eq(schema.followUpRules.enabled, true))
      .orderBy(desc(schema.followUpRules.priority), asc(schema.followUpRules.createdAt));

    const results: Array<{ ruleId: string; ruleName: string; eligible: number }> = [];

    for (const rule of rules) {
      if (rule.sourceStatus === 'CART_ABANDONMENT') {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - rule.ageThresholdDays);
        const [row] = await this.db
          .select({ count: count() })
          .from(schema.cartAbandonments)
          .where(
            and(
              inArray(schema.cartAbandonments.status, ['PENDING', 'ABANDONED']),
              lte(schema.cartAbandonments.createdAt, cutoff),
              sql`${schema.cartAbandonments.id} NOT IN (SELECT cart_id FROM follow_up_orders WHERE cart_id IS NOT NULL)`,
            ),
          );
        results.push({ ruleId: rule.id, ruleName: rule.name, eligible: Number(row?.count ?? 0) });
      } else {
        const minCutoff = new Date();
        minCutoff.setDate(minCutoff.getDate() - rule.ageThresholdDays);
        const conditions = [
          sql`${schema.orders.status} = ${rule.sourceStatus}`,
          lte(schema.orders.createdAt, minCutoff),
          eq(schema.orders.frozenForFollowUp, false),
          eq(schema.orders.isFollowUp, false),
          isNull(schema.orders.deletedAt),
        ];
        if (rule.maxAgeDays) {
          const maxCutoff = new Date();
          maxCutoff.setDate(maxCutoff.getDate() - rule.maxAgeDays);
          conditions.push(gte(schema.orders.createdAt, maxCutoff));
        }
        if (rule.sourceBranchId) {
          conditions.push(eq(schema.orders.servicingBranchId, rule.sourceBranchId));
        }
        const [row] = await this.db
          .select({ count: count() })
          .from(schema.orders)
          .where(and(...conditions));
        results.push({ ruleId: rule.id, ruleName: rule.name, eligible: Number(row?.count ?? 0) });
      }
    }

    return results;
  }

  async pullAbandonedCarts(ageThresholdDays = 1): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ageThresholdDays);

    const carts = await this.db
      .select()
      .from(schema.cartAbandonments)
      .where(
        and(
          // Include both PENDING and ABANDONED — markAbandoned cron may have
          // flipped status before follow-up sync ran. CONVERTED = already an order.
          inArray(schema.cartAbandonments.status, ['PENDING', 'ABANDONED']),
          lte(schema.cartAbandonments.createdAt, cutoff),
          // Not already pulled into follow-up
          sql`${schema.cartAbandonments.id} NOT IN (SELECT cart_id FROM follow_up_orders WHERE cart_id IS NOT NULL)`,
        ),
      )
      .limit(MAX_PER_RULE);

    if (carts.length === 0) return 0;

    // Get branches with active CS departments for round-robin distribution
    const cartExcludedIds = await this.getExcludedIds();
    const activeBranches = (await this.getActiveCsBranchIds())
      .filter((id) => !cartExcludedIds.has(id));

    // Resolve product prices for order total
    const productIds = [...new Set(carts.map((c) => c.productId))];
    const products = await this.db
      .select({ id: schema.products.id, name: schema.products.name, baseSalePrice: schema.products.baseSalePrice, offers: schema.products.offers })
      .from(schema.products)
      .where(inArray(schema.products.id, productIds));
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Validate mediaBuyerIds — drop invalid refs to avoid FK constraint failures
    const mbIds = [...new Set(carts.map((c) => c.mediaBuyerId).filter(Boolean))] as string[];
    const validMbIds = new Set(
      mbIds.length > 0
        ? (await this.db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, mbIds))).map((u) => u.id)
        : [],
    );

    let succeeded = 0;
    // Process each cart independently — one bad cart shouldn't kill the whole batch.
    for (let i = 0; i < carts.length; i++) {
      const cart = carts[i]!;
      try {
        const product = productMap.get(cart.productId);
        const qty = cart.quantity ?? 1;

        let unitPrice = product?.baseSalePrice ?? '0';
        if (cart.offerLabel && product?.offers) {
          const offers = product.offers as Array<{ label?: string; price?: string | number; qty?: number }>;
          const match = offers.find((o) => o.label === cart.offerLabel);
          if (match?.price != null) unitPrice = String(match.price);
        }

        const assignedBranch = activeBranches.length > 0
          ? activeBranches[i % activeBranches.length]!
          : null;

        // Null out invalid mediaBuyerId to avoid FK constraint violation
        const safeMbId = cart.mediaBuyerId && validMbIds.has(cart.mediaBuyerId) ? cart.mediaBuyerId : null;

        await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
          const [fuOrder] = await tx
            .insert(schema.followUpOrders)
            .values({
              sourceOrderId: null,
              followUpRuleId: null,
              campaignId: cart.campaignId,
              mediaBuyerId: safeMbId,
              assignedCsId: null,
              logisticsProviderId: null,
              logisticsLocationId: null,
              riderId: null,
              status: 'UNPROCESSED',
              items: null,
              customerName: cart.customerName || 'Unknown',
              customerPhoneHash: cart.customerPhoneHash,
              customerPhone: cart.customerPhone,
              customerAddress: cart.customerAddress,
              deliveryAddress: cart.deliveryAddress,
              totalAmount: sql`${unitPrice}::numeric`,
              landedCost: null,
              deliveryFee: null,
              deliveryNotes: cart.deliveryNotes,
              deliveryState: cart.deliveryState,
              customerGender: cart.customerGender,
              preferredDeliveryDate: cart.preferredDeliveryDate,
              paymentMethod: cart.paymentMethod,
              customerEmail: cart.customerEmail,
              orderSource: 'online',
              customFields: cart.customFieldValues,
              branchId: null,
              servicingBranchId: assignedBranch,
              cartId: cart.id,
            })
            .returning({ id: schema.followUpOrders.id });

          if (fuOrder) {
            await tx.insert(schema.followUpOrderItems).values({
              followUpOrderId: fuOrder.id,
              productId: cart.productId,
              quantity: qty,
              unitPrice,
              offerLabel: cart.offerLabel,
            });

            await tx.insert(schema.followUpOrderTimelineEvents).values({
              followUpOrderId: fuOrder.id,
              eventType: 'ORDER_RECEIVED',
              actorId: null,
              actorName: 'System',
              description: 'Order created from abandoned cart.',
              metadata: { cartId: cart.id, source: 'cart_abandonment' },
              branchId: assignedBranch,
            });
          }
        });
        succeeded++;
      } catch (err) {
        this.logger.warn(`Cart pull skipped cart ${cart.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    void this.cache.delPattern('cache:orders:aggregates:*').catch(() => {});
    this.logger.log(`Cart abandonment pull: ${succeeded}/${carts.length} carts converted`);
    return succeeded;
  }

  // ── Sync Logs ──────────────────────────────────────────────────────

  async listSyncLogs(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const [logs, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.followUpSyncLogs)
        .orderBy(desc(schema.followUpSyncLogs.startedAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.followUpSyncLogs),
    ]);
    return {
      logs,
      pagination: { page, limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  // ── Follow-Up Branches Summary ─────────────────────────────────────

  /**
   * Aggregate follow-up orders by servicingBranchId for the branch/group
   * overview page.  Returns one row per branch with funnel stats.
   */
  async listFollowUpBranches(input: { startDate?: string; endDate?: string; branchId?: string }) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.followUpOrders.deletedAt)];
    if (input.branchId) conditions.push(eq(schema.followUpOrders.servicingBranchId, input.branchId));
    if (input.startDate) conditions.push(gte(schema.followUpOrders.createdAt, new Date(input.startDate)));
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.followUpOrders.createdAt, end));
    }

    const confirmedStatuses = ['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED'];
    const deliveredStatuses = ['DELIVERED', 'REMITTED'];

    const rows = await this.db
      .select({
        branchId: schema.followUpOrders.servicingBranchId,
        totalOrders: sql<number>`count(*)::int`,
        unprocessed: sql<number>`count(*) filter (where ${schema.followUpOrders.status} = 'UNPROCESSED')::int`,
        assigned: sql<number>`count(*) filter (where ${schema.followUpOrders.status} in ('CS_ASSIGNED', 'CS_ENGAGED'))::int`,
        confirmed: sql<number>`count(*) filter (where ${schema.followUpOrders.status} in (${sql.join(confirmedStatuses.map((s) => sql`${s}`), sql`, `)}))::int`,
        delivered: sql<number>`count(*) filter (where ${schema.followUpOrders.status} in (${sql.join(deliveredStatuses.map((s) => sql`${s}`), sql`, `)}))::int`,
        deliveredRevenue: sql<string>`coalesce(sum(${schema.followUpOrders.totalAmount}) filter (where ${schema.followUpOrders.status} in (${sql.join(deliveredStatuses.map((s) => sql`${s}`), sql`, `)})), 0)::text`,
      })
      .from(schema.followUpOrders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(schema.followUpOrders.servicingBranchId);

    // Resolve branch names
    const branchIds = rows.map((r) => r.branchId).filter(Boolean) as string[];
    const branchNames = branchIds.length > 0
      ? new Map(
          (await this.db.select({ id: schema.branches.id, name: schema.branches.name }).from(schema.branches).where(inArray(schema.branches.id, branchIds)))
            .map((b) => [b.id, b.name]),
        )
      : new Map<string, string>();

    return rows
      .map((r) => ({
        branchId: r.branchId,
        branchName: r.branchId ? branchNames.get(r.branchId) ?? null : null,
        totalOrders: r.totalOrders,
        unprocessed: r.unprocessed,
        assigned: r.assigned,
        confirmed: r.confirmed,
        delivered: r.delivered,
        deliveredRevenue: r.deliveredRevenue,
        confirmationRate: r.totalOrders > 0 ? Math.round((r.confirmed / r.totalOrders) * 100) : 0,
        deliveryRate: r.totalOrders > 0 ? Math.round((r.delivered / r.totalOrders) * 100) : 0,
      }))
      .sort((a, b) => b.totalOrders - a.totalOrders);
  }

  // ── Follow-Up Order Lifecycle ──────────────────────────────────────

  async listFollowUpOrders(input: ListFollowUpOrdersInput, branchId?: string | null) {
    const conditions: Parameters<typeof and>[0][] = input.showDeleted
      ? [sql`${schema.followUpOrders.deletedAt} IS NOT NULL`]
      : [isNull(schema.followUpOrders.deletedAt)];

    if (input.status) conditions.push(eq(schema.followUpOrders.status, input.status));
    if (input.statuses && input.statuses.length > 0) {
      conditions.push(inArray(schema.followUpOrders.status, input.statuses));
    }
    if (input.assignedCsId) conditions.push(eq(schema.followUpOrders.assignedCsId, input.assignedCsId));
    if (input.unassignedOnly) conditions.push(isNull(schema.followUpOrders.assignedCsId));
    if (input.ruleId) conditions.push(eq(schema.followUpOrders.followUpRuleId, input.ruleId));
    if (input.search) {
      conditions.push(sql`${schema.followUpOrders.customerName} ILIKE ${'%' + input.search + '%'}`);
    }
    if (branchId) {
      conditions.push(eq(schema.followUpOrders.servicingBranchId, branchId));
    } else if (input.branchId) {
      conditions.push(eq(schema.followUpOrders.servicingBranchId, input.branchId));
    }
    if (input.startDate) conditions.push(gte(schema.followUpOrders.createdAt, new Date(input.startDate)));
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.followUpOrders.createdAt, end));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = ((input.page ?? 1) - 1) * (input.limit ?? 50);

    const orderDir = input.sortOrder === 'asc' ? asc : desc;
    const sortCol =
      input.sortBy === 'orderNumber'
        ? schema.followUpOrders.orderNumber
        : input.sortBy === 'status'
          ? schema.followUpOrders.status
          : schema.followUpOrders.createdAt;

    const [orders, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.followUpOrders)
        .where(whereClause)
        .orderBy(orderDir(sortCol))
        .limit(input.limit ?? 50)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.followUpOrders).where(whereClause),
    ]);

    // Enrich: user names (CS + MB), campaign names, order items + product names
    const orderIds = orders.map((o) => o.id);
    const userIds = [...new Set(
      orders.flatMap((o) => [o.assignedCsId, o.mediaBuyerId].filter(Boolean)),
    )] as string[];
    const campaignIds = [...new Set(orders.map((o) => o.campaignId).filter(Boolean))] as string[];

    const [userRows, campaignRows, itemRows] = await Promise.all([
      userIds.length > 0
        ? this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, userIds))
        : Promise.resolve([]),
      campaignIds.length > 0
        ? this.db.select({ id: schema.campaigns.id, name: schema.campaigns.name }).from(schema.campaigns).where(inArray(schema.campaigns.id, campaignIds as string[]))
        : Promise.resolve([]),
      orderIds.length > 0
        ? this.db
            .select({
              followUpOrderId: schema.followUpOrderItems.followUpOrderId,
              productId: schema.followUpOrderItems.productId,
              quantity: schema.followUpOrderItems.quantity,
              unitPrice: schema.followUpOrderItems.unitPrice,
              offerLabel: schema.followUpOrderItems.offerLabel,
              productName: schema.products.name,
            })
            .from(schema.followUpOrderItems)
            .innerJoin(schema.products, eq(schema.products.id, schema.followUpOrderItems.productId))
            .where(inArray(schema.followUpOrderItems.followUpOrderId, orderIds))
        : Promise.resolve([]),
    ]);

    const userMap = new Map(userRows.map((u) => [u.id, u.name]));
    const campaignMap = new Map(campaignRows.map((c) => [c.id, c.name]));
    const itemsByOrder = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.followUpOrderId) ?? [];
      list.push(item);
      itemsByOrder.set(item.followUpOrderId, list);
    }

    return {
      orders: orders.map((o) => {
        const items = itemsByOrder.get(o.id) ?? [];
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          customerName: o.customerName,
          status: o.status,
          assignedCsId: o.assignedCsId,
          assignedCsName: o.assignedCsId ? (userMap.get(o.assignedCsId) ?? null) : null,
          mediaBuyerId: o.mediaBuyerId,
          mediaBuyerName: o.mediaBuyerId ? (userMap.get(o.mediaBuyerId) ?? null) : null,
          campaignId: o.campaignId,
          campaignName: o.campaignId ? (campaignMap.get(o.campaignId) ?? null) : null,
          servicingBranchId: o.servicingBranchId,
          totalAmount: o.totalAmount,
          createdAt: o.createdAt,
          confirmedAt: o.confirmedAt,
          deliveredAt: o.deliveredAt,
          sourceOrderId: o.sourceOrderId,
          callbackScheduledAt: o.callbackScheduledAt,
          preferredDeliveryDate: o.preferredDeliveryDate,
          orderSource: o.orderSource,
          primaryProductName: items[0]?.productName ?? null,
          itemCount: items.length,
          items: items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            offerLabel: it.offerLabel,
          })),
        };
      }),
      pagination: {
        page: input.page ?? 1,
        limit: input.limit ?? 50,
        total: totalRows[0]?.count ?? 0,
      },
    };
  }

  async getFollowUpOrderStatusCounts(branchId?: string | null, assignedCsId?: string | null, startDate?: string, endDate?: string) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.followUpOrders.deletedAt)];
    if (assignedCsId) conditions.push(eq(schema.followUpOrders.assignedCsId, assignedCsId));
    if (branchId) conditions.push(eq(schema.followUpOrders.servicingBranchId, branchId));
    if (startDate) conditions.push(gte(schema.followUpOrders.createdAt, new Date(startDate)));
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.followUpOrders.createdAt, end));
    }

    const rows = await this.db
      .select({
        status: schema.followUpOrders.status,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(schema.followUpOrders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .groupBy(schema.followUpOrders.status);

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = row.count;

    // Separate deleted count (soft-deleted orders are excluded from the main query)
    const deletedConditions: Parameters<typeof and>[0][] = [sql`${schema.followUpOrders.deletedAt} IS NOT NULL`];
    if (branchId) deletedConditions.push(eq(schema.followUpOrders.servicingBranchId, branchId));
    if (assignedCsId) deletedConditions.push(eq(schema.followUpOrders.assignedCsId, assignedCsId));
    if (startDate) deletedConditions.push(gte(schema.followUpOrders.createdAt, new Date(startDate)));
    if (endDate) {
      const endDel = new Date(endDate);
      endDel.setHours(23, 59, 59, 999);
      deletedConditions.push(lte(schema.followUpOrders.createdAt, endDel));
    }
    const [deletedRow] = await this.db
      .select({ count: count() })
      .from(schema.followUpOrders)
      .where(and(...deletedConditions));
    counts['DELETED'] = Number(deletedRow?.count ?? 0);

    return counts;
  }

  /** Lightweight per-status counts for dashboard stat strips. */
  async getFollowUpDashboardCounts(opts?: { assignedCsId?: string; branchId?: string | null; startDate?: string; endDate?: string }) {
    const cacheKey = `cache:followup:dashboard_counts:${opts?.assignedCsId ?? 'all'}:${opts?.branchId ?? 'all'}:${opts?.startDate ?? ''}:${opts?.endDate ?? ''}`;
    return this.cache.getOrSet(cacheKey, 30, async () => {
      const conditions: Parameters<typeof and>[0][] = [isNull(schema.followUpOrders.deletedAt)];
      if (opts?.assignedCsId) conditions.push(eq(schema.followUpOrders.assignedCsId, opts.assignedCsId));
      if (opts?.branchId) conditions.push(eq(schema.followUpOrders.servicingBranchId, opts.branchId));
      if (opts?.startDate) conditions.push(gte(schema.followUpOrders.createdAt, new Date(opts.startDate)));
      if (opts?.endDate) {
        const end = new Date(opts.endDate);
        end.setHours(23, 59, 59, 999);
        conditions.push(lte(schema.followUpOrders.createdAt, end));
      }

      const rows = await this.db
        .select({
          status: schema.followUpOrders.status,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(schema.followUpOrders)
        .where(and(...conditions))
        .groupBy(schema.followUpOrders.status);

      const byStatus: Record<string, number> = {};
      for (const row of rows) byStatus[row.status] = row.count;
      return byStatus;
    });
  }

  async getFollowUpOrderDetail(id: string) {
    const [order] = await this.db
      .select()
      .from(schema.followUpOrders)
      .where(eq(schema.followUpOrders.id, id))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });

    const [items, timeline] = await Promise.all([
      this.db
        .select({
          id: schema.followUpOrderItems.id,
          followUpOrderId: schema.followUpOrderItems.followUpOrderId,
          productId: schema.followUpOrderItems.productId,
          quantity: schema.followUpOrderItems.quantity,
          unitPrice: schema.followUpOrderItems.unitPrice,
          offerLabel: schema.followUpOrderItems.offerLabel,
          productName: schema.products.name,
        })
        .from(schema.followUpOrderItems)
        .leftJoin(schema.products, eq(schema.products.id, schema.followUpOrderItems.productId))
        .where(eq(schema.followUpOrderItems.followUpOrderId, id)),
      this.db
        .select()
        .from(schema.followUpOrderTimelineEvents)
        .where(eq(schema.followUpOrderTimelineEvents.followUpOrderId, id))
        .orderBy(desc(schema.followUpOrderTimelineEvents.createdAt)),
    ]);

    // Enrich with names
    const userIds = [order.assignedCsId, order.mediaBuyerId, ...timeline.map((t) => t.actorId)].filter(Boolean) as string[];
    const uniqueUserIds = [...new Set(userIds)];
    const userRows = uniqueUserIds.length > 0
      ? await this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, uniqueUserIds))
      : [];
    const userMap = new Map(userRows.map((u) => [u.id, u.name]));

    return {
      ...order,
      assignedCsName: order.assignedCsId ? (userMap.get(order.assignedCsId) ?? null) : null,
      mediaBuyerName: order.mediaBuyerId ? (userMap.get(order.mediaBuyerId) ?? null) : null,
      items,
      timeline: timeline.map((t) => ({
        ...t,
        actorName: t.actorName ?? (t.actorId ? (userMap.get(t.actorId) ?? null) : null),
      })),
    };
  }

  async updateFollowUpOrder(
    orderId: string,
    updates: {
      customerName?: string;
      deliveryAddress?: string | null;
      deliveryState?: string | null;
      deliveryNotes?: string | null;
      customerEmail?: string | null;
      preferredDeliveryDate?: string | null;
    },
    actor: SessionUser,
  ) {
    const [order] = await this.db
      .select({ id: schema.followUpOrders.id })
      .from(schema.followUpOrders)
      .where(eq(schema.followUpOrders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });

    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.customerName !== undefined) setFields.customerName = updates.customerName;
    if (updates.deliveryAddress !== undefined) setFields.deliveryAddress = updates.deliveryAddress;
    if (updates.deliveryState !== undefined) setFields.deliveryState = updates.deliveryState;
    if (updates.deliveryNotes !== undefined) setFields.deliveryNotes = updates.deliveryNotes;
    if (updates.customerEmail !== undefined) setFields.customerEmail = updates.customerEmail;
    if (updates.preferredDeliveryDate !== undefined) setFields.preferredDeliveryDate = updates.preferredDeliveryDate;

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.followUpOrders)
        .set(setFields)
        .where(eq(schema.followUpOrders.id, orderId));

      await tx.insert(schema.followUpOrderTimelineEvents).values({
        followUpOrderId: orderId,
        eventType: 'ORDER_DETAILS_UPDATED',
        actorId: actor.id,
        actorName: actor.name,
        description: 'Order details updated.',
        metadata: { fields: Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined) },
        branchId: null,
      });
    });

    return { success: true };
  }

  async assignFollowUpOrder(orderId: string, closerId: string, actor: SessionUser, force = false) {
    // Check if the closer already worked the source order
    const [fuOrder] = await this.db
      .select({ sourceOrderId: schema.followUpOrders.sourceOrderId })
      .from(schema.followUpOrders)
      .where(eq(schema.followUpOrders.id, orderId))
      .limit(1);
    if (!fuOrder) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });

    if (fuOrder.sourceOrderId) {
      const [sourceOrder] = await this.db
        .select({ assignedCsId: schema.orders.assignedCsId })
        .from(schema.orders)
        .where(eq(schema.orders.id, fuOrder.sourceOrderId))
        .limit(1);

      if (sourceOrder?.assignedCsId === closerId && !force) {
        const closerName = (await this.db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, closerId)).limit(1))[0]?.name ?? 'Unknown';
        return {
          sameCloserWarning: true,
          originalCloserName: closerName,
          message: `${closerName} was the original closer on this order. Assign anyway?`,
        };
      }
    }

    // Resolve the closer's primary branch so the order moves to their branch
    const [closerBranch] = await this.db
      .select({ branchId: schema.userBranches.branchId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.userId, closerId))
      .limit(1);

    return withActor(this.db, actor, async (tx) => {
      const [updated] = await tx
        .update(schema.followUpOrders)
        .set({
          assignedCsId: closerId,
          status: 'CS_ASSIGNED',
          ...(closerBranch ? { servicingBranchId: closerBranch.branchId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.followUpOrders.id, orderId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });

      const closerName = (await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, closerId)).limit(1))[0]?.name ?? 'Unknown';
      await tx.insert(schema.followUpOrderTimelineEvents).values({
        followUpOrderId: orderId,
        eventType: 'ORDER_MANUALLY_ASSIGNED',
        actorId: actor.id,
        actorName: actor.name,
        description: `Assigned to ${closerName}.`,
        metadata: { closerId, closerName },
        branchId: updated.servicingBranchId,
      });

      return { success: true };
    });
  }

  async bulkAssignFollowUpOrders(orderIds: string[], closerIds: string[], actor: SessionUser) {
    // Batch: fetch all follow-up orders + their source orders in two queries
    const fuOrders = await this.db
      .select({
        id: schema.followUpOrders.id,
        sourceOrderId: schema.followUpOrders.sourceOrderId,
        servicingBranchId: schema.followUpOrders.servicingBranchId,
      })
      .from(schema.followUpOrders)
      .where(inArray(schema.followUpOrders.id, orderIds));

    const sourceIds = [...new Set(fuOrders.map((o) => o.sourceOrderId).filter(Boolean))] as string[];
    const sourceCloserMap = new Map<string, string | null>();
    if (sourceIds.length > 0) {
      const sourceRows = await this.db
        .select({ id: schema.orders.id, assignedCsId: schema.orders.assignedCsId })
        .from(schema.orders)
        .where(inArray(schema.orders.id, sourceIds));
      for (const s of sourceRows) sourceCloserMap.set(s.id, s.assignedCsId);
    }

    // Resolve closer names + branches in parallel
    const uniqueCloserIds = [...new Set(closerIds)];
    const [closerRows, closerBranchRows] = await Promise.all([
      this.db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, uniqueCloserIds)),
      this.db.select({ userId: schema.userBranches.userId, branchId: schema.userBranches.branchId }).from(schema.userBranches).where(inArray(schema.userBranches.userId, uniqueCloserIds)),
    ]);
    const closerNameMap = new Map(closerRows.map((u) => [u.id, u.name]));
    const closerBranchMap = new Map(closerBranchRows.map((r) => [r.userId, r.branchId]));

    // Build assignment plan
    const sameCloserSkipped: string[] = [];
    const assignments: Array<{ orderId: string; closerId: string; closerName: string; branchId: string | null }> = [];
    for (let i = 0; i < orderIds.length; i++) {
      const orderId = orderIds[i]!;
      const closerId = closerIds[i % closerIds.length]!;
      const fu = fuOrders.find((o) => o.id === orderId);
      if (!fu) continue;

      // Same-closer check
      const originalCloser = fu.sourceOrderId ? sourceCloserMap.get(fu.sourceOrderId) : null;
      if (originalCloser === closerId) {
        sameCloserSkipped.push(orderId);
        continue;
      }

      assignments.push({
        orderId,
        closerId,
        closerName: closerNameMap.get(closerId) ?? 'Unknown',
        branchId: fu.servicingBranchId,
      });
    }

    // Execute all assignments in a single transaction
    if (assignments.length > 0) {
      await withActor(this.db, actor, async (tx) => {
        // Bulk update all orders at once per closer
        const byCloser = new Map<string, string[]>();
        for (const a of assignments) {
          const list = byCloser.get(a.closerId) ?? [];
          list.push(a.orderId);
          byCloser.set(a.closerId, list);
        }
        for (const [closerId, ids] of byCloser) {
          const closerBranch = closerBranchMap.get(closerId);
          await tx
            .update(schema.followUpOrders)
            .set({
              assignedCsId: closerId,
              status: 'CS_ASSIGNED',
              ...(closerBranch ? { servicingBranchId: closerBranch } : {}),
              updatedAt: new Date(),
            })
            .where(inArray(schema.followUpOrders.id, ids));
        }

        // Bulk insert timeline events
        await tx.insert(schema.followUpOrderTimelineEvents).values(
          assignments.map((a) => ({
            followUpOrderId: a.orderId,
            eventType: 'ORDER_MANUALLY_ASSIGNED' as const,
            actorId: actor.id,
            actorName: actor.name,
            description: `Assigned to ${a.closerName}.`,
            metadata: { closerId: a.closerId, closerName: a.closerName },
            branchId: a.branchId,
          })),
        );
      });
    }

    return { assigned: assignments.length, total: orderIds.length, sameCloserSkipped };
  }

  async addFollowUpOrderComment(orderId: string, comment: string, actor: SessionUser) {
    const [order] = await this.db
      .select({ id: schema.followUpOrders.id, servicingBranchId: schema.followUpOrders.servicingBranchId })
      .from(schema.followUpOrders)
      .where(eq(schema.followUpOrders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });

    await this.db.insert(schema.followUpOrderTimelineEvents).values({
      followUpOrderId: orderId,
      eventType: 'CS_COMMENT',
      actorId: actor.id,
      actorName: actor.name,
      description: comment,
      branchId: order.servicingBranchId,
    });

    return { success: true };
  }

  async transitionFollowUpOrderStatus(
    orderId: string,
    newStatus: string,
    actor: SessionUser,
    note?: string,
    metadata?: Record<string, unknown>,
  ) {
    const [order] = await this.db
      .select()
      .from(schema.followUpOrders)
      .where(eq(schema.followUpOrders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });

    const timestampUpdates: Record<string, unknown> = { updatedAt: new Date() };
    if (newStatus === 'CONFIRMED') timestampUpdates.confirmedAt = new Date();
    if (newStatus === 'AGENT_ASSIGNED') timestampUpdates.allocatedAt = new Date();
    if (newStatus === 'DISPATCHED') timestampUpdates.dispatchedAt = new Date();
    if (newStatus === 'DELIVERED') timestampUpdates.deliveredAt = new Date();

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.followUpOrders)
        .set({ status: newStatus, ...timestampUpdates })
        .where(eq(schema.followUpOrders.id, orderId));

      // Map status to timeline event type
      const eventTypeMap: Record<string, string> = {
        CS_ASSIGNED: 'ORDER_MANUALLY_ASSIGNED',
        CS_ENGAGED: 'ORDER_VIEWED',
        CONFIRMED: 'ORDER_CONFIRMED',
        AGENT_ASSIGNED: 'ORDER_ALLOCATED',
        DISPATCHED: 'ORDER_DISPATCHED',
        IN_TRANSIT: 'ORDER_IN_TRANSIT',
        DELIVERED: 'ORDER_DELIVERED',
        REMITTED: 'ORDER_ARCHIVED',
        DELETED: 'ORDER_DELETED',
      };
      const eventType = eventTypeMap[newStatus] ?? 'ORDER_VIEWED';

      await tx.insert(schema.followUpOrderTimelineEvents).values({
        followUpOrderId: orderId,
        eventType,
        actorId: actor.id,
        actorName: actor.name,
        description: note ?? `Status changed to ${newStatus}.`,
        metadata: metadata ?? { previousStatus: order.status, newStatus },
        branchId: order.servicingBranchId,
      });
    });

    // Graduation: when DELIVERED, copy into orders table
    if (newStatus === 'DELIVERED') {
      await this.graduateToOrders(orderId);
    }

    return { success: true };
  }

  // ── Graduation ─────────────────────────────────────────────────────

  private async graduateToOrders(followUpOrderId: string) {
    const [fuOrder] = await this.db
      .select()
      .from(schema.followUpOrders)
      .where(eq(schema.followUpOrders.id, followUpOrderId))
      .limit(1);
    if (!fuOrder) return;

    const fuItems = await this.db
      .select()
      .from(schema.followUpOrderItems)
      .where(eq(schema.followUpOrderItems.followUpOrderId, followUpOrderId));

    // Cart-origin follow-ups (cartId set, no sourceOrderId) keep full MB attribution.
    // Stale-order follow-ups (sourceOrderId set) strip MB — the MB gets no credit
    // for orders that were already in the pipeline and stalled.
    const isCartOrigin = !fuOrder.sourceOrderId && !!fuOrder.cartId;

    // Resolve orderSource: cart-origin = 'online', stale-order = from source or 'follow-up'
    let resolvedOrderSource: string = 'follow-up';
    if (isCartOrigin) {
      resolvedOrderSource = 'online';
    } else if (fuOrder.sourceOrderId) {
      const [src] = await this.db
        .select({ orderSource: schema.orders.orderSource })
        .from(schema.orders)
        .where(eq(schema.orders.id, fuOrder.sourceOrderId))
        .limit(1);
      resolvedOrderSource = src?.orderSource ?? 'follow-up';
    }

    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      // Insert into orders table as a delivered follow-up order
      const [graduated] = await tx
        .insert(schema.orders)
        .values({
          // Cart-origin: preserve MB attribution. Stale-order: strip it.
          campaignId: isCartOrigin ? fuOrder.campaignId : null,
          mediaBuyerId: isCartOrigin ? fuOrder.mediaBuyerId : null,
          assignedCsId: fuOrder.assignedCsId,
          logisticsProviderId: fuOrder.logisticsProviderId,
          logisticsLocationId: fuOrder.logisticsLocationId,
          riderId: fuOrder.riderId,
          status: 'DELIVERED',
          items: fuOrder.items,
          customerName: fuOrder.customerName,
          customerPhoneHash: fuOrder.customerPhoneHash,
          customerPhone: fuOrder.customerPhone,
          customerAddress: fuOrder.customerAddress,
          deliveryAddress: fuOrder.deliveryAddress,
          totalAmount: fuOrder.totalAmount,
          landedCost: fuOrder.landedCost,
          deliveryFee: fuOrder.deliveryFee,
          deliveryNotes: fuOrder.deliveryNotes,
          deliveryState: fuOrder.deliveryState,
          customerGender: fuOrder.customerGender,
          preferredDeliveryDate: fuOrder.preferredDeliveryDate,
          paymentMethod: fuOrder.paymentMethod,
          paymentStatus: fuOrder.paymentStatus,
          paymentReference: fuOrder.paymentReference,
          paymentProvider: fuOrder.paymentProvider,
          customerEmail: fuOrder.customerEmail,
          orderSource: resolvedOrderSource,
          customFields: fuOrder.customFields,
          branchId: fuOrder.branchId,
          servicingBranchId: fuOrder.servicingBranchId,
          cartId: fuOrder.cartId,
          deliveryProofUrl: fuOrder.deliveryProofUrl,
          deliveryDiscountAmount: fuOrder.deliveryDiscountAmount,
          deliveryOtp: fuOrder.deliveryOtp,
          deliveryGpsLat: fuOrder.deliveryGpsLat,
          deliveryGpsLng: fuOrder.deliveryGpsLng,
          isFollowUp: true,
          followUpSourceOrderId: fuOrder.sourceOrderId,
          confirmedAt: fuOrder.confirmedAt,
          allocatedAt: fuOrder.allocatedAt,
          dispatchedAt: fuOrder.dispatchedAt,
          deliveredAt: fuOrder.deliveredAt,
        })
        .returning({ id: schema.orders.id });

      if (graduated && fuItems.length > 0) {
        await tx.insert(schema.orderItems).values(
          fuItems.map((item) => ({
            orderId: graduated.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            offerLabel: item.offerLabel,
            batchId: item.batchId,
          })),
        );
      }

      if (graduated) {
        // Copy the full follow-up journey timeline into the graduated order
        const fuTimeline = await tx
          .select()
          .from(schema.followUpOrderTimelineEvents)
          .where(eq(schema.followUpOrderTimelineEvents.followUpOrderId, followUpOrderId))
          .orderBy(asc(schema.followUpOrderTimelineEvents.createdAt));

        if (fuTimeline.length > 0) {
          await tx.insert(schema.orderTimelineEvents).values(
            fuTimeline.map((t) => ({
              orderId: graduated.id,
              eventType: t.eventType as (typeof schema.orderTimelineEvents.$inferInsert)['eventType'],
              actorId: t.actorId,
              actorName: t.actorName,
              description: t.description,
              metadata: t.metadata,
              branchId: t.branchId,
              createdAt: t.createdAt,
            })),
          );
        }

        // Final graduation event
        await tx.insert(schema.orderTimelineEvents).values({
          orderId: graduated.id,
          eventType: 'ORDER_DELIVERED' as const,
          actorId: null,
          actorName: 'System',
          description: `Order graduated from follow-up (YNS-${String(fuOrder.orderNumber).padStart(5, '0')}).`,
          metadata: { followUpOrderId, sourceOrderId: fuOrder.sourceOrderId },
          branchId: fuOrder.servicingBranchId,
        });
      }
    });

    this.logger.log(`Follow-up order ${followUpOrderId} graduated to orders table`);
  }

  // ── Transfer Follow-Up Order Between Branches ──────────────────────

  /**
   * Transfer a follow-up order to a different servicing branch.
   * HoCS / SuperAdmin / Admin only. Resets assignedCsId (new branch = new closer).
   */
  /**
   * Redistribute unprocessed follow-up orders from a deactivated branch to remaining active branches.
   * Only moves orders in UNPROCESSED/CS_ASSIGNED status (no work done yet).
   */
  async redistributeFromBranch(branchId: string): Promise<number> {
    const excludedIds = await this.getExcludedIds();
    // Get eligible target branches (active + not excluded)
    const targetBranches = (await this.db
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.status, 'ACTIVE')))
      .map((r) => r.id)
      .filter((id) => id !== branchId && !excludedIds.has(id));

    if (targetBranches.length === 0) {
      this.logger.warn(`redistributeFromBranch: no eligible target branches for ${branchId}`);
      return 0;
    }

    // Find unprocessed orders on the deactivated branch
    const orders = await this.db
      .select({ id: schema.followUpOrders.id })
      .from(schema.followUpOrders)
      .where(
        and(
          eq(schema.followUpOrders.servicingBranchId, branchId),
          inArray(schema.followUpOrders.status, ['UNPROCESSED', 'CS_ASSIGNED']),
          isNull(schema.followUpOrders.deletedAt),
        ),
      );

    if (orders.length === 0) return 0;

    // Round-robin redistribute
    for (let i = 0; i < orders.length; i++) {
      const targetBranch = targetBranches[i % targetBranches.length]!;
      await this.db
        .update(schema.followUpOrders)
        .set({
          servicingBranchId: targetBranch,
          assignedCsId: null, // Clear assignment — new branch = new closer
          updatedAt: new Date(),
        })
        .where(eq(schema.followUpOrders.id, orders[i]!.id));
    }

    this.logger.log(`Redistributed ${orders.length} follow-up orders from branch ${branchId} to ${targetBranches.length} branches`);
    return orders.length;
  }

  async transferFollowUpOrder(orderId: string, targetBranchId: string, actor: SessionUser) {
    const [order] = await this.db
      .select({ id: schema.followUpOrders.id, servicingBranchId: schema.followUpOrders.servicingBranchId, status: schema.followUpOrders.status })
      .from(schema.followUpOrders)
      .where(and(eq(schema.followUpOrders.id, orderId), isNull(schema.followUpOrders.deletedAt)))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Follow-up order not found' });

    // Validate target branch exists
    const [branch] = await this.db
      .select({ id: schema.branches.id, name: schema.branches.name })
      .from(schema.branches)
      .where(eq(schema.branches.id, targetBranchId))
      .limit(1);
    if (!branch) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Target branch not found' });

    if (order.servicingBranchId === targetBranchId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order is already in this branch' });
    }

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.followUpOrders)
        .set({
          servicingBranchId: targetBranchId,
          assignedCsId: null, // Reset — new branch means new closer
          status: order.status === 'CS_ASSIGNED' ? 'UNPROCESSED' : order.status,
          updatedAt: new Date(),
        })
        .where(eq(schema.followUpOrders.id, orderId));

      await tx.insert(schema.followUpOrderTimelineEvents).values({
        followUpOrderId: orderId,
        eventType: 'ORDER_MANUALLY_ASSIGNED',
        actorId: actor.id,
        actorName: actor.name,
        description: `Transferred to ${branch.name}.`,
        metadata: { targetBranchId, targetBranchName: branch.name, previousBranchId: order.servicingBranchId },
        branchId: targetBranchId,
      });
    });

    return { success: true };
  }

  // ── Unfreeze Order ─────────────────────────────────────────────────

  /**
   * Unfreeze a source order so CS can resume working on it.
   * Soft-deletes the follow-up copy (if still unworked) and clears the frozen flag.
   * HoCS / SuperAdmin / Admin only.
   */
  async unfreezeOrder(orderId: string, actor: SessionUser, reason?: string) {
    const [order] = await this.db
      .select({ id: schema.orders.id, frozenForFollowUp: schema.orders.frozenForFollowUp, orderNumber: schema.orders.orderNumber })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    if (!order) throw new TRPCError({ code: 'NOT_FOUND', message: 'Order not found' });
    if (!order.frozenForFollowUp) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Order is not frozen' });

    await withActor(this.db, actor, async (tx) => {
      // Unfreeze the source order
      await tx
        .update(schema.orders)
        .set({ frozenForFollowUp: false, updatedAt: new Date() })
        .where(eq(schema.orders.id, orderId));

      // Soft-delete ALL follow-up copies — the original is now the single source of truth.
      // Admin provided a reason via the confirmation modal; any work on the follow-up
      // is superseded by resuming the original order.
      await tx
        .update(schema.followUpOrders)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.followUpOrders.sourceOrderId, orderId),
            isNull(schema.followUpOrders.deletedAt),
          ),
        );

      // Timeline event
      await tx.insert(schema.orderTimelineEvents).values({
        orderId,
        eventType: 'ORDER_UNFROZEN',
        actorId: actor.id,
        actorName: actor.name,
        description: reason ? `Order unfrozen: ${reason}` : 'Order unfrozen — removed from follow-up. CS can resume.',
        metadata: { unfrozenBy: actor.id, ...(reason ? { reason } : {}) },
        branchId: null,
      });
    });

    return { success: true };
  }

  // ── Frozen Guard (used by OrdersService) ───────────────────────────

  static assertNotFrozen(order: { frozenForFollowUp?: boolean }): void {
    if (order.frozenForFollowUp) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'This order is frozen for follow-up. No further changes allowed.',
      });
    }
  }
}
