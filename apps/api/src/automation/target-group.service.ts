import { createHash } from 'node:crypto';
import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, desc, eq, isNull, notInArray, or, sql } from 'drizzle-orm';
import { db as schema, SYSTEM_ACTOR_ID, targetGroupFilterSchema, normalizePhoneForHash, type TargetGroupFilter } from '@yannis/shared';
import type {
  CreateTargetGroupInput,
  UpdateTargetGroupInput,
  ListTargetGroupsInput,
  ListTargetGroupMembersInput,
  ImportTargetGroupMemberInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { withActor } from '../common/db/with-actor';
import type { SessionUser } from '../common/decorators/current-user.decorator';

type Drizzle = PostgresJsDatabase<typeof schema>;

/** Max members materialized per group per sync run (safety bound). */
const MAX_PER_GROUP = 50_000;

/**
 * Target Groups — reusable named audiences with materialized membership.
 *
 * RULE groups auto-materialize members by matching a filter against the orders
 * table (grouped by customer_phone_hash — the customer identity). A 2-hourly cron
 * re-syncs so newly-qualifying customers "graduate" into the group. Membership is
 * idempotent (unique index + ON CONFLICT DO NOTHING). Raw phone is never stored on
 * the member row (Lead Fortress); identity is the phone hash + denormalized name/email.
 */
@Injectable()
export class TargetGroupService {
  private readonly logger = new Logger(TargetGroupService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Drizzle) {}

  // ── CRUD (company-scoped) ──────────────────────────────────

  async list(input: ListTargetGroupsInput, activeGroupId: string | null) {
    const conditions = [isNull(schema.targetGroups.validTo)];
    if (activeGroupId) {
      conditions.push(
        or(eq(schema.targetGroups.groupId, activeGroupId), isNull(schema.targetGroups.groupId))!,
      );
    }
    if (!input?.includeDisabled) conditions.push(eq(schema.targetGroups.enabled, true));

    const groups = await this.db
      .select()
      .from(schema.targetGroups)
      .where(and(...conditions))
      .orderBy(desc(schema.targetGroups.createdAt))
      .limit(200);

    // Attach live member counts in one grouped query.
    const counts = await this.db
      .select({
        targetGroupId: schema.targetGroupMembers.targetGroupId,
        count: sql<number>`count(*)`,
      })
      .from(schema.targetGroupMembers)
      .where(isNull(schema.targetGroupMembers.validTo))
      .groupBy(schema.targetGroupMembers.targetGroupId);
    const countByGroup = new Map(counts.map((c) => [c.targetGroupId, Number(c.count)]));

    return groups.map((g) => ({ ...g, memberCount: countByGroup.get(g.id) ?? 0 }));
  }

  private async requireGroup(groupId: string, activeGroupId: string | null) {
    const [g] = await this.db
      .select()
      .from(schema.targetGroups)
      .where(and(eq(schema.targetGroups.id, groupId), isNull(schema.targetGroups.validTo)))
      .limit(1);
    if (!g) throw new TRPCError({ code: 'NOT_FOUND', message: 'Target group not found' });
    if (activeGroupId && g.groupId && g.groupId !== activeGroupId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Target group belongs to another company.' });
    }
    return g;
  }

  async getById(groupId: string, activeGroupId: string | null) {
    return this.requireGroup(groupId, activeGroupId);
  }

  async create(input: CreateTargetGroupInput, actor: SessionUser, activeGroupId: string | null) {
    const created = await withActor(this.db, { id: actor.id }, async (tx) => {
      const rows = await tx
        .insert(schema.targetGroups)
        .values({
          groupId: activeGroupId ?? null,
          name: input.name,
          description: input.description ?? null,
          sourceKind: input.sourceKind,
          filter: input.filter ?? {},
          enabled: input.enabled,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create target group' });
      return row;
    });
    // Materialize immediately for RULE groups so the count is meaningful right away.
    if (created.sourceKind === 'RULE' && created.enabled) {
      await this.materializeGroup(created, actor.id).catch((err) =>
        this.logger.warn(`initial materialize failed for group ${created.id}: ${String(err)}`),
      );
    }
    return created;
  }

  async update(input: UpdateTargetGroupInput, actor: SessionUser, activeGroupId: string | null) {
    await this.requireGroup(input.groupId, activeGroupId);
    const updated = await withActor(this.db, { id: actor.id }, async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) set['name'] = input.name;
      if (input.description !== undefined) set['description'] = input.description;
      if (input.filter !== undefined) set['filter'] = input.filter;
      if (input.enabled !== undefined) set['enabled'] = input.enabled;
      const rows = await tx
        .update(schema.targetGroups)
        .set(set)
        .where(eq(schema.targetGroups.id, input.groupId))
        .returning();
      return rows[0]!;
    });
    // A changed filter can only ADD members here (Phase 1 never prunes) — re-materialize.
    if (updated.sourceKind === 'RULE' && updated.enabled) {
      await this.materializeGroup(updated, actor.id).catch((err) =>
        this.logger.warn(`re-materialize after update failed for group ${updated.id}: ${String(err)}`),
      );
    }
    return updated;
  }

  async archive(groupId: string, actor: SessionUser, activeGroupId: string | null) {
    await this.requireGroup(groupId, activeGroupId);
    return withActor(this.db, { id: actor.id }, async (tx) => {
      await tx
        .update(schema.targetGroups)
        .set({ validTo: new Date(), updatedAt: new Date() })
        .where(eq(schema.targetGroups.id, groupId));
      return { archived: true };
    });
  }

  async listMembers(input: ListTargetGroupMembersInput, activeGroupId: string | null) {
    await this.requireGroup(input.groupId, activeGroupId);
    const offset = (input.page - 1) * input.pageSize;
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      this.db
        .select({
          id: schema.targetGroupMembers.id,
          customerName: schema.targetGroupMembers.customerName,
          customerEmail: schema.targetGroupMembers.customerEmail,
          customerPhoneHash: schema.targetGroupMembers.customerPhoneHash,
          source: schema.targetGroupMembers.source,
          addedAt: schema.targetGroupMembers.addedAt,
        })
        .from(schema.targetGroupMembers)
        .where(
          and(
            eq(schema.targetGroupMembers.targetGroupId, input.groupId),
            isNull(schema.targetGroupMembers.validTo),
          ),
        )
        .orderBy(desc(schema.targetGroupMembers.addedAt))
        .limit(input.pageSize)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)` })
        .from(schema.targetGroupMembers)
        .where(
          and(
            eq(schema.targetGroupMembers.targetGroupId, input.groupId),
            isNull(schema.targetGroupMembers.validTo),
          ),
        ),
    ]);
    // NOTE: raw phone is never stored; only the hash + name/email leave here. The
    // hash is an opaque identity token, not a reversible phone — safe to return.
    return { members: rows, total: Number(total), page: input.page, pageSize: input.pageSize };
  }

  // ── Materialization ────────────────────────────────────────

  /** Build the WHERE + HAVING for a RULE group's filter over the orders table. */
  private buildMemberQuery(groupRow: typeof schema.targetGroups.$inferSelect) {
    const parsed = targetGroupFilterSchema.safeParse(groupRow.filter ?? {});
    const filter: TargetGroupFilter = parsed.success ? parsed.data : {};

    const where = [isNull(schema.orders.deletedAt)];
    if (filter.statuses?.length) {
      where.push(sql`${schema.orders.status} = ANY(${filter.statuses})`);
    }
    if (filter.branchIds?.length) {
      where.push(sql`${schema.orders.branchId} = ANY(${filter.branchIds})`);
    }
    if (filter.sinceDays != null) {
      where.push(sql`${schema.orders.createdAt} >= now() - (${filter.sinceDays} || ' days')::interval`);
    }
    if (filter.orderSource === 'edge-form') {
      where.push(sql`(${schema.orders.orderSource} IS NULL OR ${schema.orders.orderSource} = 'edge-form')`);
    } else if (filter.orderSource === 'offline') {
      where.push(sql`${schema.orders.orderSource} = 'offline'`);
    }

    const having: ReturnType<typeof sql>[] = [];
    if (filter.minOrders != null) having.push(sql`count(*) >= ${filter.minOrders}`);
    if (filter.maxOrders != null) having.push(sql`count(*) <= ${filter.maxOrders}`);

    return { where, having };
  }

  /** Distinct customers a RULE group currently yields (via the query builder). */
  private candidateQuery(groupRow: typeof schema.targetGroups.$inferSelect) {
    const { where, having } = this.buildMemberQuery(groupRow);
    let q = this.db
      .select({
        phoneHash: schema.orders.customerPhoneHash,
        name: sql<string | null>`max(${schema.orders.customerName})`,
        email: sql<string | null>`max(${schema.orders.customerEmail})`,
      })
      .from(schema.orders)
      .where(and(...where))
      .groupBy(schema.orders.customerPhoneHash)
      .$dynamic();
    if (having.length) q = q.having(and(...having));
    return q;
  }

  /** Distinct-customer count a RULE group would currently yield (for the tab). */
  async previewCount(groupRow: typeof schema.targetGroups.$inferSelect): Promise<number> {
    const rows = await this.candidateQuery(groupRow);
    return rows.length;
  }

  /**
   * Sync a RULE group's membership to its current filter: ADD newly-matching
   * customers (idempotent via ON CONFLICT) and PRUNE members who no longer match
   * (so e.g. a "1-2 orders" group drops a customer once they place a 3rd order).
   * Pruning ONLY touches RULE-sourced members — UPLOAD/MANUAL members are never
   * removed by sync. Returns counts of both.
   */
  private async materializeGroup(
    groupRow: typeof schema.targetGroups.$inferSelect,
    actorId: string,
  ): Promise<{ added: number; removed: number }> {
    if (groupRow.sourceKind !== 'RULE') return { added: 0, removed: 0 };

    // One row per distinct customer: pick a representative name/email (max()).
    const candidates = await this.candidateQuery(groupRow).limit(MAX_PER_GROUP);
    const matchingHashes = candidates.map((c) => c.phoneHash);

    let added = 0;
    let removed = 0;
    await withActor(this.db, { id: actorId }, async (tx) => {
      // 1. ADD — chunked insert, ON CONFLICT DO NOTHING keeps it idempotent.
      const CHUNK = 1000;
      for (let i = 0; i < candidates.length; i += CHUNK) {
        const slice = candidates.slice(i, i + CHUNK);
        const res = await tx
          .insert(schema.targetGroupMembers)
          .values(
            slice.map((c) => ({
              targetGroupId: groupRow.id,
              customerPhoneHash: c.phoneHash,
              customerName: c.name,
              customerEmail: c.email,
              source: 'RULE' as const,
            })),
          )
          .onConflictDoNothing()
          .returning({ id: schema.targetGroupMembers.id });
        added += res.length;
      }

      // 2. PRUNE — soft-delete RULE members no longer in the matching set. Only
      //    RULE-sourced rows; UPLOAD/MANUAL members are preserved. When the filter
      //    matches nobody, every RULE member is pruned.
      const pruneConds = [
        eq(schema.targetGroupMembers.targetGroupId, groupRow.id),
        eq(schema.targetGroupMembers.source, 'RULE'),
        isNull(schema.targetGroupMembers.validTo),
      ];
      if (matchingHashes.length > 0) {
        pruneConds.push(notInArray(schema.targetGroupMembers.customerPhoneHash, matchingHashes));
      }
      const pruned = await tx
        .update(schema.targetGroupMembers)
        .set({ validTo: new Date(), updatedAt: new Date() })
        .where(and(...pruneConds))
        .returning({ id: schema.targetGroupMembers.id });
      removed = pruned.length;
    });
    return { added, removed };
  }

  /** Manual "sync now" for one group. */
  async syncGroup(groupId: string, actor: SessionUser, activeGroupId: string | null) {
    const group = await this.requireGroup(groupId, activeGroupId);
    const { added, removed } = await this.materializeGroup(group, actor.id);
    return { added, removed };
  }

  // ── CSV/Excel member import ─────────────────────────────────

  /** SHA-256 of the normalized phone — MUST match OrdersService.hashPhone so an
   *  imported member lines up with the same customer's orders. Uses the shared
   *  country-aware normalizer so both sides stay in lockstep. */
  private hashPhone(phone: string): string {
    const digits = normalizePhoneForHash(phone);
    return createHash('sha256').update(`yannis:phone:${digits}`).digest('hex');
  }

  /** Synthetic identity for an email-only member (no phone to hash). Distinct
   *  namespace so it can never collide with a real phone hash. */
  private hashEmailIdentity(email: string): string {
    return createHash('sha256').update(`yannis:email:${email.trim().toLowerCase()}`).digest('hex');
  }

  /**
   * Import one member row (one POST per row, matching the ImportBulkData contract).
   * Raw phone is hashed and discarded — only the hash + name/email are stored
   * (Lead Fortress). Idempotent: re-importing the same person is a no-op.
   */
  async importMember(input: ImportTargetGroupMemberInput, actor: SessionUser, activeGroupId: string | null) {
    await this.requireGroup(input.groupId, activeGroupId);
    const phone = input.phone?.trim();
    const email = input.email?.trim() || null;
    // Identity: prefer the phone hash (aligns with orders); else an email-derived id.
    const phoneHash = phone ? this.hashPhone(phone) : email ? this.hashEmailIdentity(email) : null;
    if (!phoneHash) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Each member needs a phone or an email.' });
    }
    await withActor(this.db, { id: actor.id }, async (tx) => {
      await tx
        .insert(schema.targetGroupMembers)
        .values({
          targetGroupId: input.groupId,
          customerPhoneHash: phoneHash,
          customerName: input.name?.trim() || null,
          customerEmail: email,
          source: 'UPLOAD',
        })
        .onConflictDoNothing();
    });
    return { imported: true };
  }

  // ── Cron: re-sync all enabled RULE groups every 2 hours ─────
  @Cron('0 30 */2 * * *', { timeZone: 'Africa/Lagos' })
  async handleScheduledSync() {
    await this.runSync('cron').catch((err) =>
      this.logger.warn(`target-group cron sync failed: ${String(err)}`),
    );
  }

  async runSync(triggeredBy: 'cron' | 'manual'): Promise<{ totalAdded: number; totalRemoved: number }> {
    const groups = await this.db
      .select()
      .from(schema.targetGroups)
      .where(
        and(
          isNull(schema.targetGroups.validTo),
          eq(schema.targetGroups.enabled, true),
          eq(schema.targetGroups.sourceKind, 'RULE'),
        ),
      );

    let totalAdded = 0;
    let totalRemoved = 0;
    const results: Array<{ groupId: string; added: number; removed: number }> = [];
    for (const g of groups) {
      try {
        const { added, removed } = await this.materializeGroup(g, SYSTEM_ACTOR_ID);
        totalAdded += added;
        totalRemoved += removed;
        results.push({ groupId: g.id, added, removed });
      } catch (err) {
        this.logger.warn(`materialize failed for group ${g.id}: ${String(err)}`);
      }
    }

    await withActor(this.db, { id: SYSTEM_ACTOR_ID }, async (tx) => {
      await tx.insert(schema.targetGroupSyncLogs).values({
        triggeredBy,
        totalAdded,
        groupResults: results,
      });
    });

    return { totalAdded, totalRemoved };
  }
}
