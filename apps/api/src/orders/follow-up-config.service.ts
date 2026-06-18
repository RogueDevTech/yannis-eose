import { Injectable, Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, gte, inArray, isNull, lte, ne, sql, asc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, SYSTEM_ACTOR_ID } from '@yannis/shared';
import type {
  CreateFollowUpRuleInput,
  UpdateFollowUpRuleInput,
  ListFollowUpOrdersInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import { branchScopeCondition } from '../common/db/branch-scope-condition';
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
    // Delay 45s after boot, then run sync (CART_ABANDONMENT rules are skipped — see cart-orders module).
    setTimeout(() => {
      this.runSync('cron').catch((err) =>
        this.logger.error(`Boot sync failed: ${err instanceof Error ? err.message : err}`),
      );
    }, 45_000);
  }

  // ── Cron ───────────────────────────────────────────────────────────

  @Cron('0 0 */2 * * *', { timeZone: 'Africa/Lagos' })
  async handleMidnightSync() {
    try {
      const result = await this.runSync('cron');
      this.logger.log(`Follow-up sync complete: ${result.totalPulled} orders pulled`);
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
        sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`,
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
        sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`,
      ));
    return rows.map((r) => r.branchId);
  }

  // ── Rule CRUD ──────────────────────────────────────────────────────

  async listRules(enabledOnly?: boolean, effectiveBranchIds?: string[] | null) {
    // Always exclude CART_ABANDONMENT rules — cart orders have their own pipeline.
    const conditions = [ne(schema.followUpRules.sourceStatus, 'CART_ABANDONMENT')];
    if (enabledOnly) conditions.push(eq(schema.followUpRules.enabled, true));
    let rules = await this.db
      .select()
      .from(schema.followUpRules)
      .where(and(...conditions))
      .orderBy(desc(schema.followUpRules.priority), asc(schema.followUpRules.createdAt));

    // When group-scoped, only show rules that target/source branches in the active group
    // (or rules with no branch constraint — "All branches").
    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
      const branchSet = new Set(effectiveBranchIds);
      rules = rules.filter((r) => {
        const sourceOk = !r.sourceBranchId || branchSet.has(r.sourceBranchId);
        const targetOk = !r.targetBranchId || branchSet.has(r.targetBranchId);
        return sourceOk && targetOk;
      });
    }

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
          ageThresholdHours: input.ageThresholdHours ?? null,
          maxAgeDays: input.maxAgeDays ?? null,
          ageRelativeTo: input.ageRelativeTo ?? 'STATUS_TIMESTAMP',
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
      if (input.ageThresholdHours !== undefined) set.ageThresholdHours = input.ageThresholdHours;
      if (input.maxAgeDays !== undefined) set.maxAgeDays = input.maxAgeDays;
      if (input.ageRelativeTo !== undefined) set.ageRelativeTo = input.ageRelativeTo;
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

        // CART_ABANDONMENT rules are no longer processed by follow-up sync.
        // Cart orders now have their own standalone page + pipeline.
        if (rule.sourceStatus === 'CART_ABANDONMENT') {
          ruleResults.push({ ruleId: rule.id, ruleName: rule.name, pulled: 0 });
          continue;
        }
        const pulled = await this.pullOrdersForRule(rule, actorId);
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

  /** Compute the age cutoff from hours (preferred) or days. */
  private static ageCutoff(hours: number | null | undefined, days: number): Date {
    const cutoff = new Date();
    if (hours != null) {
      cutoff.setTime(cutoff.getTime() - hours * 60 * 60 * 1000);
    } else {
      cutoff.setDate(cutoff.getDate() - days);
    }
    return cutoff;
  }

  /** Map source status to the timestamp column that records when the order entered that status. */
  private static statusTimestampCol(sourceStatus: string) {
    switch (sourceStatus) {
      case 'CONFIRMED': return schema.orders.confirmedAt;
      case 'AGENT_ASSIGNED': return schema.orders.allocatedAt;
      case 'DISPATCHED': return schema.orders.dispatchedAt;
      case 'DELIVERED': return schema.orders.deliveredAt;
      default: return null; // pre-confirmation statuses have no dedicated ts — use createdAt
    }
  }

  private async pullOrdersForRule(rule: typeof schema.followUpRules.$inferSelect, _actorId?: string): Promise<number> {
    const minCutoff = FollowUpConfigService.ageCutoff(rule.ageThresholdHours, rule.ageThresholdDays);

    // Determine which timestamp to measure age from, based on rule.ageRelativeTo:
    //   STATUS_TIMESTAMP (default) — confirmedAt/allocatedAt/etc, fallback to createdAt
    //   CREATED_AT — always order creation date
    //   PREFERRED_DELIVERY_DATE — scheduled delivery date (text → timestamptz cast)
    const relativeTo = rule.ageRelativeTo ?? 'STATUS_TIMESTAMP';
    let ageExpr: ReturnType<typeof sql>;
    if (relativeTo === 'PREFERRED_DELIVERY_DATE') {
      // preferred_delivery_date is a text column — cast to date, fallback to createdAt
      ageExpr = sql`COALESCE(${schema.orders.preferredDeliveryDate}::date, ${schema.orders.createdAt}::date)`;
    } else if (relativeTo === 'CREATED_AT') {
      ageExpr = sql`${schema.orders.createdAt}`;
    } else {
      // STATUS_TIMESTAMP — use the status-specific column, fallback to createdAt
      const statusTsCol = FollowUpConfigService.statusTimestampCol(rule.sourceStatus);
      ageExpr = statusTsCol
        ? sql`COALESCE(${statusTsCol}, ${schema.orders.createdAt})`
        : sql`${schema.orders.createdAt}`;
    }

    // Find matching orders not yet pulled
    const conditions = [
      sql`${schema.orders.status} = ${rule.sourceStatus}`,
      sql`${ageExpr} <= ${minCutoff.toISOString()}::timestamptz`,
      eq(schema.orders.frozenForFollowUp, false),
      eq(schema.orders.isFollowUp, false),
      isNull(schema.orders.deletedAt),
    ];

    // Optional upper age bound — only match orders newer than maxAgeDays
    if (rule.maxAgeDays) {
      const maxCutoff = new Date();
      maxCutoff.setDate(maxCutoff.getDate() - rule.maxAgeDays);
      conditions.push(sql`${ageExpr} >= ${maxCutoff.toISOString()}::timestamptz`);
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

    // When the rule specifies a target but it's excluded, skip entirely —
    // never scatter follow-ups to unintended branches.
    if (activeBranches.length === 0 && rule.targetBranchId) {
      this.logger.warn(`pullOrdersForRule: target branch ${rule.targetBranchId} is excluded — skipping ${matchingOrders.length} orders`);
      return 0;
    }

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
      // CART_ABANDONMENT rules are no longer processed — cart orders have their own pipeline.
      if (rule.sourceStatus === 'CART_ABANDONMENT') {
        results.push({ ruleId: rule.id, ruleName: rule.name, eligible: 0 });
        continue;
      }
      {
        const minCutoff = FollowUpConfigService.ageCutoff(rule.ageThresholdHours, rule.ageThresholdDays);
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

  async pullAbandonedCarts(rule: typeof schema.followUpRules.$inferSelect): Promise<number> {
    const cutoff = FollowUpConfigService.ageCutoff(rule.ageThresholdHours, rule.ageThresholdDays);

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

    // Respect the rule's target branch — same logic as pullOrdersForRule.
    // When rule has a specific target, all carts go there. When null,
    // round-robin across active CS branches.
    const cartExcludedIds = await this.getExcludedIds();
    let activeBranches: string[] = [];
    if (rule.targetBranchId) {
      activeBranches = cartExcludedIds.has(rule.targetBranchId) ? [] : [rule.targetBranchId];
    } else {
      activeBranches = (await this.getActiveCsBranchIds())
        .filter((id) => !cartExcludedIds.has(id));
    }

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
              followUpRuleId: rule.id,
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
  async listFollowUpBranches(input: { startDate?: string; endDate?: string; branchId?: string; effectiveBranchIds?: string[] | null }) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.followUpOrders.deletedAt)];
    {
      const bCond = branchScopeCondition(schema.followUpOrders.servicingBranchId, input.branchId, input.effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    }
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

  async listFollowUpOrders(input: ListFollowUpOrdersInput, branchId?: string | null, effectiveBranchIds?: string[] | null) {
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
    {
      const bCond = branchScopeCondition(schema.followUpOrders.servicingBranchId, branchId ?? input.branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
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

  async getFollowUpOrderStatusCounts(branchId?: string | null, assignedCsId?: string | null, startDate?: string, endDate?: string, effectiveBranchIds?: string[] | null) {
    const conditions: Parameters<typeof and>[0][] = [isNull(schema.followUpOrders.deletedAt)];
    if (assignedCsId) conditions.push(eq(schema.followUpOrders.assignedCsId, assignedCsId));
    if (branchId) {
      conditions.push(eq(schema.followUpOrders.servicingBranchId, branchId));
    } else if (effectiveBranchIds?.length) {
      conditions.push(inArray(schema.followUpOrders.servicingBranchId, effectiveBranchIds));
    }
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
    if (branchId) {
      deletedConditions.push(eq(schema.followUpOrders.servicingBranchId, branchId));
    } else if (effectiveBranchIds?.length) {
      deletedConditions.push(inArray(schema.followUpOrders.servicingBranchId, effectiveBranchIds));
    }
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
  async getFollowUpDashboardCounts(opts?: { assignedCsId?: string; branchId?: string | null; effectiveBranchIds?: string[] | null; startDate?: string; endDate?: string }) {
    const eIdsKey = opts?.effectiveBranchIds?.join(',') ?? '';
    const cacheKey = `cache:followup:dashboard_counts:${opts?.assignedCsId ?? 'all'}:${opts?.branchId ?? 'all'}:${eIdsKey}:${opts?.startDate ?? ''}:${opts?.endDate ?? ''}`;
    return this.cache.getOrSet(cacheKey, 30, async () => {
      const conditions: Parameters<typeof and>[0][] = [isNull(schema.followUpOrders.deletedAt)];
      if (opts?.assignedCsId) conditions.push(eq(schema.followUpOrders.assignedCsId, opts.assignedCsId));
      if (opts?.branchId) {
        conditions.push(eq(schema.followUpOrders.servicingBranchId, opts.branchId));
      } else if (opts?.effectiveBranchIds?.length) {
        conditions.push(inArray(schema.followUpOrders.servicingBranchId, opts.effectiveBranchIds));
      }
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

    // Persist logistics fields from metadata (mirrors regular order transitions)
    const logisticsUpdates: Record<string, unknown> = {};
    if (metadata?.logisticsLocationId) logisticsUpdates.logisticsLocationId = metadata.logisticsLocationId;
    if (metadata?.logisticsProviderId) logisticsUpdates.logisticsProviderId = metadata.logisticsProviderId;
    if (metadata?.riderId) logisticsUpdates.riderId = metadata.riderId;
    if (metadata?.preferredDeliveryDate) logisticsUpdates.preferredDeliveryDate = metadata.preferredDeliveryDate;
    if (metadata?.deliveryNote) logisticsUpdates.deliveryNotes = metadata.deliveryNote;
    if (metadata?.deliveryProofUrl) logisticsUpdates.deliveryProofUrl = metadata.deliveryProofUrl;

    await withActor(this.db, actor, async (tx) => {
      await tx
        .update(schema.followUpOrders)
        .set({ status: newStatus, ...timestampUpdates, ...logisticsUpdates })
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

      // Build a descriptive timeline message
      let description = note;
      if (!description) {
        const logisticsLocationId = metadata?.logisticsLocationId as string | undefined;
        let locationLabel: string | undefined;
        if (logisticsLocationId) {
          const [locRow] = await tx
            .select({ name: schema.logisticsLocations.name, providerName: schema.logisticsProviders.name })
            .from(schema.logisticsLocations)
            .innerJoin(schema.logisticsProviders, eq(schema.logisticsLocations.providerId, schema.logisticsProviders.id))
            .where(eq(schema.logisticsLocations.id, logisticsLocationId))
            .limit(1);
          locationLabel = locRow ? (locRow.providerName ? `${locRow.name} (${locRow.providerName})` : locRow.name) : undefined;
        }
        const isReassignment = order.status === 'AGENT_ASSIGNED' && newStatus === 'AGENT_ASSIGNED';
        switch (newStatus) {
          case 'CS_ASSIGNED': description = 'Order assigned to closer.'; break;
          case 'CS_ENGAGED': description = 'CS started customer engagement.'; break;
          case 'CONFIRMED': description = 'Order confirmed.'; break;
          case 'AGENT_ASSIGNED':
            description = isReassignment
              ? `Reassigned to logistics${locationLabel ? ` at ${locationLabel}` : ''}.`
              : `Order assigned to logistics${locationLabel ? ` at ${locationLabel}` : ''}.`;
            break;
          case 'DISPATCHED': description = 'Order dispatched to rider.'; break;
          case 'IN_TRANSIT': description = 'Order in transit.'; break;
          case 'DELIVERED': description = 'Order marked delivered.'; break;
          case 'DELETED': description = 'Order deleted.'; break;
          default: description = `Status changed to ${newStatus.replace(/_/g, ' ').toLowerCase()}.`;
        }
      }

      await tx.insert(schema.followUpOrderTimelineEvents).values({
        followUpOrderId: orderId,
        eventType,
        actorId: actor.id,
        actorName: actor.name,
        description,
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

    const graduatedOrderId = await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
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

      return graduated?.id ?? null;
    });

    this.logger.log(`Follow-up order ${followUpOrderId} graduated to orders table`);

    // Auto-generate invoice for the graduated order (same logic as CONFIRMED trigger).
    if (graduatedOrderId) {
      try {
        const items = await this.db
          .select({
            quantity: schema.orderItems.quantity,
            unitPrice: schema.orderItems.unitPrice,
            offerLabel: schema.orderItems.offerLabel,
            productName: schema.products.name,
          })
          .from(schema.orderItems)
          .leftJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
          .where(eq(schema.orderItems.orderId, graduatedOrderId));

        if (items.length > 0) {
          const lineItems = items.map((it) => ({
            description: `${it.productName ?? 'Product'}${it.offerLabel ? ` (${it.offerLabel})` : ''}`,
            quantity: it.quantity,
            unitPrice: String(it.unitPrice),
          }));
          const totalAmount = items.reduce((sum, it) => sum + Number(it.unitPrice), 0);

          await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
            await tx.insert(schema.invoices).values({
              orderId: graduatedOrderId,
              recipientInfo: {
                name: fuOrder.customerName,
                address: fuOrder.customerAddress ?? undefined,
              },
              lineItems,
              taxRate: null,
              totalAmount: totalAmount.toFixed(2),
              dueDate: null,
              status: 'DRAFT',
            });
          });
        }
      } catch (err) {
        this.logger.warn(`Auto-invoice for graduated follow-up ${graduatedOrderId} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
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
      .where(and(
        eq(schema.branches.status, 'ACTIVE'),
        sql`(${schema.branches.groupId} IS NULL OR ${schema.branches.groupId} IN (SELECT id FROM branch_groups WHERE status = 'ACTIVE'))`,
      )))
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
        description: `Transferred to ${branch.name} by ${actor.name ?? 'unknown'}.`,
        metadata: { targetBranchId, targetBranchName: branch.name, previousBranchId: order.servicingBranchId },
        branchId: targetBranchId,
      });
    });

    return { success: true };
  }

  /**
   * Bulk-transfer follow-up orders to a different branch. One DB transaction
   * per order (so partial success is possible). Emits `bulk:progress` via
   * WebSocket so the client can show a live progress bar.
   */
  async bulkTransferFollowUpOrders(
    orderIds: string[],
    targetBranchId: string,
    actor: SessionUser,
    /** Socket event key the client listens on — lets the same emitter serve multiple bulk actions. */
    progressEvent = 'bulk:progress',
  ) {
    // Validate target branch once
    const [branch] = await this.db
      .select({ id: schema.branches.id, name: schema.branches.name })
      .from(schema.branches)
      .where(eq(schema.branches.id, targetBranchId))
      .limit(1);
    if (!branch) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Target branch not found' });

    // Fetch all orders in one query
    const orders = await this.db
      .select({
        id: schema.followUpOrders.id,
        servicingBranchId: schema.followUpOrders.servicingBranchId,
        status: schema.followUpOrders.status,
      })
      .from(schema.followUpOrders)
      .where(and(inArray(schema.followUpOrders.id, orderIds), isNull(schema.followUpOrders.deletedAt)));
    const orderMap = new Map(orders.map((o) => [o.id, o]));

    const total = orderIds.length;
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];

    const emitProgress = (status: 'running' | 'complete' | 'error') => {
      this.events.emitToUser(actor.id, progressEvent, {
        label: 'Moving orders to branch',
        total,
        completed: succeeded,
        failed,
        status,
        errors: errors.length > 0 ? errors.slice(-5) : undefined,
      });
    };

    emitProgress('running');

    for (const orderId of orderIds) {
      const order = orderMap.get(orderId);
      if (!order) {
        failed++;
        errors.push('Order not found');
        emitProgress('running');
        continue;
      }
      if (order.servicingBranchId === targetBranchId) {
        failed++;
        errors.push('Order is already in this branch');
        emitProgress('running');
        continue;
      }
      try {
        await withActor(this.db, actor, async (tx) => {
          await tx
            .update(schema.followUpOrders)
            .set({
              servicingBranchId: targetBranchId,
              assignedCsId: null,
              status: order.status === 'CS_ASSIGNED' ? 'UNPROCESSED' : order.status,
              updatedAt: new Date(),
            })
            .where(eq(schema.followUpOrders.id, orderId));
          await tx.insert(schema.followUpOrderTimelineEvents).values({
            followUpOrderId: orderId,
            eventType: 'ORDER_MANUALLY_ASSIGNED',
            actorId: actor.id,
            actorName: actor.name,
            description: `Transferred to ${branch.name} by ${actor.name ?? 'unknown'}.`,
            metadata: { targetBranchId, targetBranchName: branch.name, previousBranchId: order.servicingBranchId },
            branchId: targetBranchId,
          });
        });
        succeeded++;
      } catch {
        failed++;
        errors.push(`Failed to transfer order`);
      }
      emitProgress('running');
    }

    const finalStatus = failed === total ? 'error' : 'complete';
    emitProgress(finalStatus);

    return { succeeded, failed, total };
  }

  /**
   * Bulk-transition follow-up orders to a new status with per-item WebSocket
   * progress. Mirrors `transitionFollowUpOrderStatus` but avoids N parallel
   * HTTP requests from the client. Returns succeeded IDs so the router can
   * handle side-effects (invoice generation) in bulk.
   */
  async bulkTransitionFollowUpOrders(
    orderIds: string[],
    newStatus: string,
    actor: SessionUser,
    note?: string,
    metadata?: Record<string, unknown>,
  ) {
    const total = orderIds.length;
    let succeeded = 0;
    let failed = 0;
    const errors: string[] = [];
    const succeededIds: string[] = [];
    const label = 'Transitioning orders';

    const emitProgress = (status: 'running' | 'complete' | 'error') => {
      this.events.emitToUser(actor.id, 'bulk:progress', {
        label, total, completed: succeeded, failed, status,
        errors: errors.length > 0 ? errors.slice(-5) : undefined,
      });
    };

    emitProgress('running');

    for (const orderId of orderIds) {
      try {
        await this.transitionFollowUpOrderStatus(orderId, newStatus, actor, note, metadata);
        succeeded++;
        succeededIds.push(orderId);
      } catch (err) {
        failed++;
        errors.push(err instanceof Error ? err.message : 'Failed to transition order');
      }
      emitProgress('running');
    }

    const finalStatus = failed === total ? 'error' : 'complete';
    emitProgress(finalStatus);

    return { succeeded, failed, total, succeededIds };
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
