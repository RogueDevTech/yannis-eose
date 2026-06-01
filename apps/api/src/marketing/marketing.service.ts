import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import {
  eq,
  ne,
  and,
  desc,
  gte,
  lte,
  gt,
  count,
  sum,
  inArray,
  or,
  ilike,
  getTableColumns,
  isNull,
  sql,
  exists,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema, canonicalPermissionCode } from '@yannis/shared';
import type {
  CreateFundingInput,
  VerifyFundingInput,
  ListFundingInput,
  FundingStatusCountsInput,
  FundingRequestStatusCountsInput,
  CreateAdSpendInput,
  CreateAdSpendBatchInput,
  ListAdSpendInput,
  ListAdSpendGroupedInput,
  AdSpendStatusCountsInput,
  PreviewAdSpendIntervalInput,
  CampaignOrderTotalForBatchInput,
  UpdateAdSpendInput,
  LogDailyAdSpendInput,
  CreateOfferTemplateInput,
  UpdateOfferTemplateInput,
  ListOfferTemplatesInput,
  CreateOfferGroupInput,
  UpdateOfferGroupInput,
  ListOfferGroupsInput,
  ClearLegacyOfferTemplatesInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor } from '../common/db/with-actor';
import { branchScopeCondition } from '../common/db/branch-scope-condition';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';
import { trimmedSearchLooksLikeUuid } from '../common/utils/uuid-search';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { SettingsService } from '../settings/settings.service';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel, canViewAllBranches } from '../common/authz';
import { hasFinanceAccess } from '../common/utils/strip-finance-fields';
import {
  appendOrdersAggregateScopeConditions,
  type OrdersAggregateSupervisorScope,
} from '../orders/orders.service';

/** Default profitability config when `MARKETING_PROFITABILITY` system setting is unset. */
const DEFAULT_PROFITABILITY_TARGET_ROAS = 3;
const DEFAULT_PROFITABILITY_GREEN_THRESHOLD = 2.5;
export const MARKETING_PROFITABILITY_KEY = 'MARKETING_PROFITABILITY';

/** Drizzle transaction client (same as `withActor` callback `tx`). */
type MarketingFundingTx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

export type ProfitabilityConfig = {
  /** True-ROAS multiple where the profitability score caps at 1.0 (default 3). */
  targetRoas: number;
  /** True-ROAS multiple at/above which the leaderboard pill is green (default 2.5). */
  greenThreshold: number;
};

@Injectable()
export class MarketingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
    private readonly branchTeams: BranchTeamsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Reads the org-wide profitability config from `system_settings`. SuperAdmin sets it on
   * Settings → System; cached in Redis 5min by `SettingsService`. Returns sensible defaults
   * (target=3x, green threshold=2.5x — CEO directive 2026-05-03) when unset or malformed.
   */
  async getProfitabilityConfig(): Promise<ProfitabilityConfig> {
    const raw = await this.settings.get(MARKETING_PROFITABILITY_KEY).catch(() => null);
    const target = Number((raw as Record<string, unknown> | null)?.targetRoas);
    const threshold = Number((raw as Record<string, unknown> | null)?.greenThreshold);
    return {
      targetRoas:
        Number.isFinite(target) && target > 0 ? target : DEFAULT_PROFITABILITY_TARGET_ROAS,
      greenThreshold:
        Number.isFinite(threshold) && threshold > 0
          ? threshold
          : DEFAULT_PROFITABILITY_GREEN_THRESHOLD,
    };
  }

  private async getBranchUserIds(branchId?: string | null): Promise<string[] | null> {
    if (!branchId) return null;
    // Include users from both the junction table (userBranches) AND those whose
    // primaryBranchId matches. Some users may have a primaryBranchId set without
    // a corresponding userBranches row — querying both sources prevents them from
    // vanishing when the viewer switches to that branch individually.
    const [junctionRows, primaryRows] = await Promise.all([
      this.db
        .select({ userId: schema.userBranches.userId })
        .from(schema.userBranches)
        .where(eq(schema.userBranches.branchId, branchId)),
      this.db
        .select({ userId: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.primaryBranchId, branchId)),
    ]);
    const ids = new Set(junctionRows.map((r) => r.userId));
    for (const r of primaryRows) ids.add(r.userId);
    return [...ids];
  }

  /**
   * Same-branch guard for funding mutations (Pillar 4: Absolute Accountability,
   * multi-branch isolation).
   *
   * Branch-scoped actors (MEDIA_BUYER, CS_CLOSER, BRANCH_ADMIN, branch-only
   * HEAD_OF_MARKETING) must be members of `currentBranchId` themselves.
   *
   * Company-wide actors (SUPER_ADMIN, ADMIN, FINANCE_OFFICER + finance hat,
   * HR_MANAGER, org-wide Heads, anyone with a `*.scope.global` permission)
   * skip the actor-membership check — they act on any branch's data. Ledger
   * pairing is still enforced by `assertLedgerTransferAllowed` after load.
   *
   * Receiver membership: when a branch is in play (`currentBranchId !== null`),
   * the receiver must still belong to it so the ledger row stays attributable.
   */
  private async assertSameBranchOrAdmin(
    actor: { id: string; role: string; permissions?: string[]; scopeOrgWideHead?: boolean },
    otherUserId: string,
    currentBranchId: string | null,
  ): Promise<void> {
    const isOrgWide = canViewAllBranches(actor);

    if (currentBranchId === null) {
      if (isOrgWide) return;
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No active branch — switch to a branch before initiating a funding transfer',
      });
    }

    const idsToCheck = isOrgWide ? [otherUserId] : [actor.id, otherUserId];
    const memberships = await this.db
      .select({ userId: schema.userBranches.userId })
      .from(schema.userBranches)
      .where(
        and(
          eq(schema.userBranches.branchId, currentBranchId),
          inArray(schema.userBranches.userId, idsToCheck),
        ),
      );

    const memberSet = new Set(memberships.map((m) => m.userId));
    if (!isOrgWide && !memberSet.has(actor.id)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not a member of the active branch',
      });
    }
    if (!memberSet.has(otherUserId)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Recipient is not a member of the active branch',
      });
    }
  }

  private async getBranchCampaignIds(branchId?: string | null): Promise<string[] | null> {
    if (!branchId) return null;
    const rows = await this.db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.branchId, branchId));
    return rows.map((row) => row.id);
  }

  /**
   * HoM / marketing-supervisor disbursable pool: COMPLETED funding received minus all outbound
   * ledger rows (SENT, COMPLETED, DISPUTED) minus non-REJECTED ad spend (branch-scoped when branchId is set).
   * Run inside the same transaction as the outbound insert so checks align with concurrent sends.
   */
  private async computeMarketingDisbursableInTx(
    tx: MarketingFundingTx,
    userId: string,
    branchId: string | null,
  ): Promise<number> {
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);

    const [inRow] = await tx
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(
        and(
          eq(schema.marketingFunding.receiverId, userId),
          eq(schema.marketingFunding.status, 'COMPLETED'),
        ),
      );

    const [outRow] = await tx
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(
        and(
          eq(schema.marketingFunding.senderId, userId),
          inArray(schema.marketingFunding.status, ['SENT', 'COMPLETED', 'DISPUTED']),
        ),
      );

    let spendTotalStr = '0';
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      spendTotalStr = '0';
    } else {
      const [spendRow] = await tx
        .select({ total: sum(schema.adSpendLogs.spendAmount) })
        .from(schema.adSpendLogs)
        .where(
          and(
            eq(schema.adSpendLogs.mediaBuyerId, userId),
            ne(schema.adSpendLogs.status, 'REJECTED'),
            branchCampaignIds
              ? inArray(schema.adSpendLogs.campaignId, branchCampaignIds)
              : undefined,
          ),
        );
      spendTotalStr = spendRow?.total ?? '0';
    }

    const received = Number(inRow?.total ?? '0');
    const outgoing = Number(outRow?.total ?? '0');
    const spend = Number(spendTotalStr);
    return Math.max(0, received - outgoing - spend);
  }

  private assertSufficientMarketingDisbursable(disbursable: number, transferAmount: number): void {
    const d = Math.round(disbursable * 100);
    const t = Math.round(transferAmount * 100);
    if (d < t) {
      const fmt = (n: number) =>
        n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Insufficient marketing funding balance to send ₦${fmt(transferAmount)}. Disbursable: ₦${fmt(disbursable)}.`,
      });
    }
  }

  private spendDateToYmd(spendDate: Date | string): string {
    if (typeof spendDate === 'string') {
      return spendDate.length >= 10 ? spendDate.slice(0, 10) : spendDate;
    }
    const y = spendDate.getUTCFullYear();
    const m = String(spendDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(spendDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private adSpendLineSnapshotKey(
    mediaBuyerId: string,
    campaignId: string,
    productId: string,
    spendYmd: string,
  ): string {
    return `${mediaBuyerId}|${campaignId}|${productId}|${spendYmd}`;
  }

  private orderIntervalCountGroupKey(parts: {
    mediaBuyerId: string;
    campaignId: string;
    productId: string;
    branchId?: string | null;
    windowStartExclusiveMs: number | null;
  }): string {
    return `${parts.mediaBuyerId}|${parts.campaignId}|${parts.productId}|${parts.branchId ?? ''}|${parts.windowStartExclusiveMs ?? 'null'}`;
  }

  private windowExclusiveFromApprovedPrior(priorSpend: Date | null | undefined): Date | null {
    if (!priorSpend) return null;
    const y = priorSpend.getUTCFullYear();
    const m = priorSpend.getUTCMonth();
    const d = priorSpend.getUTCDate();
    return new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
  }

  private async countOrdersInAdSpendIntervalWindow(params: {
    mediaBuyerId: string;
    campaignId: string;
    productId: string;
    windowStartExclusive: Date | null;
    branchId?: string | null;
  }): Promise<number> {
    const now = new Date();
    const hasProductLine = exists(
      this.db
        .select({ id: schema.orderItems.id })
        .from(schema.orderItems)
        .where(
          and(
            eq(schema.orderItems.orderId, schema.orders.id),
            eq(schema.orderItems.productId, params.productId),
          ),
        ),
    );
    const orderConditions: SQL[] = [
      eq(schema.orders.mediaBuyerId, params.mediaBuyerId),
      eq(schema.orders.campaignId, params.campaignId),
      hasProductLine,
      lte(schema.orders.createdAt, now),
      sql`${schema.orders.status} != 'DELETED'`,
      eq(schema.orders.isFollowUp, false),
    ];
    if (params.windowStartExclusive) {
      orderConditions.push(gt(schema.orders.createdAt, params.windowStartExclusive));
    }
    if (params.branchId) {
      orderConditions.push(eq(schema.orders.branchId, params.branchId));
    }
    const [countRow] = await this.db
      .select({ c: count() })
      .from(schema.orders)
      .where(and(...orderConditions));
    return Number(countRow?.c ?? 0);
  }

  private async batchFetchAdSpendPriorSpendDates(
    keys: Array<{ mediaBuyerId: string; campaignId: string; productId: string; spendYmd: string }>,
  ): Promise<Map<string, Date | null>> {
    const out = new Map<string, Date | null>();
    if (keys.length === 0) return out;

    const dedup = new Map<string, (typeof keys)[number]>();
    for (const k of keys) {
      const sk = this.adSpendLineSnapshotKey(k.mediaBuyerId, k.campaignId, k.productId, k.spendYmd);
      dedup.set(sk, k);
    }
    const unique = [...dedup.values()];
    const chunkSize = 40;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const chunk = unique.slice(i, i + chunkSize);
      const valuesSql = sql.join(
        chunk.map(
          (k) =>
            sql`(${k.mediaBuyerId}::uuid, ${k.campaignId}::uuid, ${k.productId}::uuid, ${k.spendYmd}::date)`,
        ),
        sql`, `,
      );
      const rows = await this.db.execute<{
        media_buyer_id: string;
        campaign_id: string;
        product_id: string;
        spend_day: string;
        prior_spend_date: Date | string | null;
      }>(sql`
        SELECT
          k.mb AS media_buyer_id,
          k.campaign AS campaign_id,
          k.product AS product_id,
          k.spend_day::text AS spend_day,
          prior.spend_date AS prior_spend_date
        FROM (
          VALUES ${valuesSql}
        ) AS k(mb, campaign, product, spend_day)
        LEFT JOIN LATERAL (
          SELECT spend_date
          FROM ad_spend_logs
          WHERE media_buyer_id = k.mb
            AND campaign_id = k.campaign
            AND product_id = k.product
            AND status = 'APPROVED'
            AND spend_date::date < k.spend_day
          ORDER BY spend_date DESC, created_at DESC
          LIMIT 1
        ) prior ON true
      `);
      const list = Array.from(
        rows as unknown as Iterable<{
          media_buyer_id: string;
          campaign_id: string;
          product_id: string;
          spend_day: string;
          prior_spend_date: Date | string | null;
        }>,
      );
      for (const r of list) {
        const sk = this.adSpendLineSnapshotKey(
          r.media_buyer_id,
          r.campaign_id,
          r.product_id,
          r.spend_day,
        );
        const p = r.prior_spend_date;
        out.set(sk, p == null ? null : p instanceof Date ? p : new Date(p));
      }
    }
    return out;
  }

  private async batchAdSpendIntervalSnapshots(
    rows: Array<{
      mediaBuyerId: string;
      campaignId: string;
      productId: string;
      spendYmd: string;
      spendAmount: number;
    }>,
    branchCampaignIds: string[] | null,
    branchId?: string | null,
  ): Promise<
    Map<
      string,
      {
        orderCount: number;
        priorSpendDate: string | null;
        windowStartExclusive: string | null;
        indicativeCpa: number | null;
      }
    >
  > {
    const zeroSnap = () => ({
      orderCount: 0,
      priorSpendDate: null as string | null,
      windowStartExclusive: null as string | null,
      indicativeCpa: null as number | null,
    });
    const out = new Map<
      string,
      {
        orderCount: number;
        priorSpendDate: string | null;
        windowStartExclusive: string | null;
        indicativeCpa: number | null;
      }
    >();
    if (rows.length === 0) return out;

    if (branchCampaignIds && branchCampaignIds.length === 0) {
      for (const r of rows) {
        const k = this.adSpendLineSnapshotKey(
          r.mediaBuyerId,
          r.campaignId,
          r.productId,
          r.spendYmd,
        );
        out.set(k, zeroSnap());
      }
      return out;
    }

    const priorFetch: typeof rows = [];
    for (const r of rows) {
      const k = this.adSpendLineSnapshotKey(r.mediaBuyerId, r.campaignId, r.productId, r.spendYmd);
      if (branchCampaignIds && !branchCampaignIds.includes(r.campaignId)) {
        out.set(k, zeroSnap());
        continue;
      }
      priorFetch.push(r);
    }

    const priors = await this.batchFetchAdSpendPriorSpendDates(
      priorFetch.map((r) => ({
        mediaBuyerId: r.mediaBuyerId,
        campaignId: r.campaignId,
        productId: r.productId,
        spendYmd: r.spendYmd,
      })),
    );

    const countJobs = new Map<
      string,
      {
        mediaBuyerId: string;
        campaignId: string;
        productId: string;
        windowStartExclusive: Date | null;
        branchId?: string | null;
      }
    >();

    for (const r of priorFetch) {
      const k = this.adSpendLineSnapshotKey(r.mediaBuyerId, r.campaignId, r.productId, r.spendYmd);
      const priorDate = priors.get(k) ?? null;
      const win = this.windowExclusiveFromApprovedPrior(priorDate);
      const gk = this.orderIntervalCountGroupKey({
        mediaBuyerId: r.mediaBuyerId,
        campaignId: r.campaignId,
        productId: r.productId,
        branchId,
        windowStartExclusiveMs: win ? win.getTime() : null,
      });
      if (!countJobs.has(gk)) {
        countJobs.set(gk, {
          mediaBuyerId: r.mediaBuyerId,
          campaignId: r.campaignId,
          productId: r.productId,
          windowStartExclusive: win,
          branchId,
        });
      }
    }

    const countResults = new Map<string, number>();
    await Promise.all(
      [...countJobs.entries()].map(async ([gk, job]) => {
        const c = await this.countOrdersInAdSpendIntervalWindow(job);
        countResults.set(gk, c);
      }),
    );

    for (const r of rows) {
      const k = this.adSpendLineSnapshotKey(r.mediaBuyerId, r.campaignId, r.productId, r.spendYmd);
      if (out.has(k)) continue;

      const priorDate = priors.get(k) ?? null;
      const win = this.windowExclusiveFromApprovedPrior(priorDate);
      const gk = this.orderIntervalCountGroupKey({
        mediaBuyerId: r.mediaBuyerId,
        campaignId: r.campaignId,
        productId: r.productId,
        branchId,
        windowStartExclusiveMs: win ? win.getTime() : null,
      });
      const orderCount = countResults.get(gk) ?? 0;
      const spendAmt = r.spendAmount;
      const indicativeCpa =
        spendAmt !== undefined && spendAmt > 0 ? spendAmt / Math.max(orderCount, 1) : null;
      const priorSpendDate =
        priorDate != null
          ? `${priorDate.getUTCFullYear()}-${String(priorDate.getUTCMonth() + 1).padStart(2, '0')}-${String(priorDate.getUTCDate()).padStart(2, '0')}`
          : null;

      out.set(k, {
        orderCount,
        priorSpendDate,
        windowStartExclusive: win ? win.toISOString() : null,
        indicativeCpa,
      });
    }

    return out;
  }

  /**
   * Orders (all statuses) for buyer + campaign + product since the UTC calendar day after the
   * latest APPROVED prior spend strictly before `spendDate`, through now. Indicative CPA =
   * spendAmount / count. Same semantics as the Log Ad Spend preview.
   * When `branchCampaignIds` would exclude the campaign, returns zeros (list enrichment).
   * Callers that need a hard error (wrong campaign in branch) should validate before calling.
   */
  private async getAdSpendIntervalSnapshot(params: {
    mediaBuyerId: string;
    campaignId: string;
    productId: string;
    spendDate: string;
    spendAmount: number;
    branchId?: string | null;
    /** When supplied, avoids re-querying campaigns for the branch (list / batch paths). */
    branchCampaignIds?: string[] | null;
  }): Promise<{
    orderCount: number;
    priorSpendDate: string | null;
    windowStartExclusive: string | null;
    indicativeCpa: number | null;
  }> {
    const branchCampaignIds =
      params.branchCampaignIds !== undefined
        ? params.branchCampaignIds
        : await this.getBranchCampaignIds(params.branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return {
        orderCount: 0,
        priorSpendDate: null,
        windowStartExclusive: null,
        indicativeCpa: null,
      };
    }
    if (branchCampaignIds && !branchCampaignIds.includes(params.campaignId)) {
      return {
        orderCount: 0,
        priorSpendDate: null,
        windowStartExclusive: null,
        indicativeCpa: null,
      };
    }

    const priorDateLt = sql`${schema.adSpendLogs.spendDate}::date < ${params.spendDate}::date`;

    const [prior] = await this.db
      .select({
        spendDate: schema.adSpendLogs.spendDate,
      })
      .from(schema.adSpendLogs)
      .where(
        and(
          eq(schema.adSpendLogs.mediaBuyerId, params.mediaBuyerId),
          eq(schema.adSpendLogs.campaignId, params.campaignId),
          eq(schema.adSpendLogs.productId, params.productId),
          eq(schema.adSpendLogs.status, 'APPROVED'),
          priorDateLt,
        ),
      )
      .orderBy(desc(schema.adSpendLogs.spendDate), desc(schema.adSpendLogs.createdAt))
      .limit(1);

    const priorSpend = prior?.spendDate;
    const windowStartExclusive = this.windowExclusiveFromApprovedPrior(priorSpend);
    const orderCount = await this.countOrdersInAdSpendIntervalWindow({
      mediaBuyerId: params.mediaBuyerId,
      campaignId: params.campaignId,
      productId: params.productId,
      windowStartExclusive,
      branchId: params.branchId,
    });
    const spendAmt = params.spendAmount;
    const indicativeCpa =
      spendAmt !== undefined && spendAmt > 0 ? spendAmt / Math.max(orderCount, 1) : null;

    const priorSpendDate =
      priorSpend != null
        ? `${priorSpend.getUTCFullYear()}-${String(priorSpend.getUTCMonth() + 1).padStart(2, '0')}-${String(priorSpend.getUTCDate()).padStart(2, '0')}`
        : null;

    return {
      orderCount,
      priorSpendDate,
      windowStartExclusive: windowStartExclusive ? windowStartExclusive.toISOString() : null,
      indicativeCpa,
    };
  }

  /**
   * Campaign-level order count for the Add Expense batch flow (CEO directive
   * 2026-05-08). Unlike `getAdSpendIntervalSnapshot` (which is keyed on
   * campaign × product), this aggregates orders across all products in the
   * campaign so the Media Buyer sees one number to split.
   *
   * Window: orders created AFTER the most recent APPROVED ad spend on this
   * campaign (any product) by this MB, up through `spendDate`. When no prior
   * APPROVED spend exists, the window starts at the campaign's birth.
   */
  private async getCampaignOrderTotalSnapshot(params: {
    mediaBuyerId: string;
    campaignId: string;
    spendDate: string;
    branchId?: string | null;
  }): Promise<{
    orderCount: number;
    priorSpendDate: string | null;
    windowStartExclusive: string | null;
  }> {
    const branchCampaignIds = await this.getBranchCampaignIds(params.branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return { orderCount: 0, priorSpendDate: null, windowStartExclusive: null };
    }
    if (branchCampaignIds && !branchCampaignIds.includes(params.campaignId)) {
      return { orderCount: 0, priorSpendDate: null, windowStartExclusive: null };
    }

    const priorDateLt = sql`${schema.adSpendLogs.spendDate}::date < ${params.spendDate}::date`;

    const [prior] = await this.db
      .select({ spendDate: schema.adSpendLogs.spendDate })
      .from(schema.adSpendLogs)
      .where(
        and(
          eq(schema.adSpendLogs.mediaBuyerId, params.mediaBuyerId),
          eq(schema.adSpendLogs.campaignId, params.campaignId),
          eq(schema.adSpendLogs.status, 'APPROVED'),
          priorDateLt,
        ),
      )
      .orderBy(desc(schema.adSpendLogs.spendDate), desc(schema.adSpendLogs.createdAt))
      .limit(1);

    const priorSpend = prior?.spendDate;
    let windowStartExclusive: Date | null = null;
    if (priorSpend) {
      const y = priorSpend.getUTCFullYear();
      const m = priorSpend.getUTCMonth();
      const d = priorSpend.getUTCDate();
      windowStartExclusive = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
    }

    const now = new Date();
    const orderConditions: SQL[] = [
      eq(schema.orders.mediaBuyerId, params.mediaBuyerId),
      eq(schema.orders.campaignId, params.campaignId),
      lte(schema.orders.createdAt, now),
      sql`${schema.orders.status} != 'DELETED'`,
    ];
    if (windowStartExclusive) {
      orderConditions.push(gt(schema.orders.createdAt, windowStartExclusive));
    }
    if (params.branchId) {
      orderConditions.push(eq(schema.orders.branchId, params.branchId));
    }

    const [countRow] = await this.db
      .select({ c: count() })
      .from(schema.orders)
      .where(and(...orderConditions));

    const orderCount = Number(countRow?.c ?? 0);

    const priorSpendDate =
      priorSpend != null
        ? `${priorSpend.getUTCFullYear()}-${String(priorSpend.getUTCMonth() + 1).padStart(2, '0')}-${String(priorSpend.getUTCDate()).padStart(2, '0')}`
        : null;

    return {
      orderCount,
      priorSpendDate,
      windowStartExclusive: windowStartExclusive ? windowStartExclusive.toISOString() : null,
    };
  }

  /** All-status order count for a media buyer on a single UTC calendar day (branch-scoped when `branchId` is set). */
  /**
   * Count orders per (mediaBuyerId, UTC-day) for many pairs in a single grouped
   * query — replaces N separate COUNT round-trips. Returns a map keyed
   * `${spendDateYmd}::${mediaBuyerId}`; a pair with no orders is simply absent
   * (callers default to 0). The query range spans min..max requested day, so it
   * may aggregate a few buyer×day combos that weren't asked for — harmless,
   * those keys just aren't looked up.
   */
  private async countOrdersForMediaBuyersOnUtcDays(params: {
    pairs: Array<{ mediaBuyerId: string; spendDateYmd: string }>;
    branchId?: string | null;
  }): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const pairs = params.pairs.filter((p) => p.mediaBuyerId && p.spendDateYmd);
    if (pairs.length === 0) return result;

    const mediaBuyerIds = [...new Set(pairs.map((p) => p.mediaBuyerId))];
    const sortedDays = [...pairs.map((p) => p.spendDateYmd)].sort();
    const rangeStart = new Date(`${sortedDays[0]}T00:00:00.000Z`);
    const rangeEnd = new Date(`${sortedDays[sortedDays.length - 1]}T23:59:59.999Z`);

    const dayExpr = sql<string>`to_char(${schema.orders.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
    const conditions: SQL[] = [
      inArray(schema.orders.mediaBuyerId, mediaBuyerIds),
      gte(schema.orders.createdAt, rangeStart),
      lte(schema.orders.createdAt, rangeEnd),
      sql`${schema.orders.status} != 'DELETED'`,
    ];
    if (params.branchId) {
      conditions.push(eq(schema.orders.branchId, params.branchId));
    }

    const rows = await this.db
      .select({ mediaBuyerId: schema.orders.mediaBuyerId, day: dayExpr, c: count() })
      .from(schema.orders)
      .where(and(...conditions))
      .groupBy(schema.orders.mediaBuyerId, dayExpr);

    for (const row of rows) {
      result.set(`${row.day}::${row.mediaBuyerId}`, Number(row.c ?? 0));
    }
    return result;
  }

  /**
   * Validates who may appear as sender/receiver on marketing_funding.
   * `viaFundingRequest`: when true, Finance/SuperAdmin/Admin may fund a Media Buyer
   * (approve-with-receipt path); `createFunding` uses false and keeps HoM-only → MB.
   */
  private assertLedgerTransferAllowed(
    senderRole: string,
    receiverRole: string,
    opts?: { viaFundingRequest?: boolean; marketingSupervisorToMb?: boolean },
  ): void {
    const adminFinance = ['SUPER_ADMIN', 'ADMIN', 'FINANCE_OFFICER'];
    if (receiverRole === 'HEAD_OF_MARKETING') {
      if (!adminFinance.includes(senderRole)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only Super Admin, Admin, or Finance Officer can disburse to Head of Marketing',
        });
      }
      return;
    }
    if (receiverRole === 'MEDIA_BUYER') {
      if (senderRole === 'HEAD_OF_MARKETING') {
        return;
      }
      if (opts?.marketingSupervisorToMb) {
        return;
      }
      if (opts?.viaFundingRequest && adminFinance.includes(senderRole)) {
        return;
      }
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: opts?.viaFundingRequest
          ? 'Only Head of Marketing, Super Admin, Admin, or Finance Officer can approve funding to a Media Buyer'
          : 'Only Head of Marketing or a branch marketing supervisor may disburse to Media Buyers',
      });
    }
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Receiver must be Head of Marketing or Media Buyer',
    });
  }

  // ============================================
  // Marketing Funding
  // ============================================

  async createFunding(
    input: CreateFundingInput,
    actor: {
      id: string;
      role: string;
      permissions?: string[];
      scopeOrgWideHead?: boolean;
    },
    currentBranchId: string | null,
  ) {
    // Branch isolation: receiver must be on `currentBranchId`; sender must be too unless
    // admin-class (session branch is enough — no `user_branches` row required). Global NULL
    // branch = admin cross-branch path.
    await this.assertSameBranchOrAdmin(actor, input.receiverId, currentBranchId);

    const senderId = actor.id;
    let marketingSupervisorToMb = false;
    if (currentBranchId) {
      marketingSupervisorToMb = await this.branchTeams.isMarketingSupervisorOf(
        senderId,
        input.receiverId,
        currentBranchId,
      );
    }

    const funding = await withActor(this.db, { id: senderId }, async (tx) => {
      const [sender, receiver] = await Promise.all([
        tx
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, senderId))
          .limit(1),
        tx
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, input.receiverId))
          .limit(1),
      ]);
      const receiverRole = receiver[0]?.role;
      const senderRole = sender[0]?.role;
      if (!receiverRole || !senderRole) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sender or receiver not found' });
      }
      this.assertLedgerTransferAllowed(senderRole, receiverRole, {
        viaFundingRequest: false,
        marketingSupervisorToMb,
      });

      if (
        receiverRole === 'MEDIA_BUYER' &&
        (senderRole === 'HEAD_OF_MARKETING' || marketingSupervisorToMb)
      ) {
        const disbursable = await this.computeMarketingDisbursableInTx(
          tx,
          senderId,
          currentBranchId,
        );
        this.assertSufficientMarketingDisbursable(disbursable, input.amount);
      }

      const rows = await tx
        .insert(schema.marketingFunding)
        .values({
          senderId,
          receiverId: input.receiverId,
          amount: String(input.amount),
          receiptUrl: input.receiptUrl,
          status: 'SENT',
        })
        .returning();

      const inserted = rows[0];
      if (!inserted) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create funding' });
      }
      return inserted;
    });

    // Notify the receiver (real-time + persistent)
    this.events.emitToUser(input.receiverId, 'funding:received', {
      fundingId: funding.id,
      amount: input.amount,
    });
    this.notifications.enqueueCreate({
      userId: input.receiverId,
      type: 'funding:sent',
      title: 'Funding received',
      body: `You have received funding. Please mark as Received or Not Received.`,
      data: { fundingId: funding.id, amount: input.amount },
    });

    return funding;
  }

  async verifyFunding(input: VerifyFundingInput, receiverId: string) {
    const { funding, updated } = await withActor(this.db, { id: receiverId }, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.marketingFunding)
        .where(eq(schema.marketingFunding.id, input.fundingId))
        .limit(1);

      const found = rows[0];
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Funding record not found' });
      }

      if (found.receiverId !== receiverId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the receiver can verify this funding',
        });
      }

      if (found.status !== 'SENT') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Funding has already been verified' });
      }

      if (
        input.action === 'DISPUTED' &&
        (!input.disputeReason || input.disputeReason.length < 10)
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Dispute requires a reason with at least 10 characters',
        });
      }

      const updatedRows = await tx
        .update(schema.marketingFunding)
        .set({
          status: input.action,
          verifiedAt: new Date(),
        })
        .where(eq(schema.marketingFunding.id, input.fundingId))
        .returning();

      return { funding: found, updated: updatedRows };
    });

    if (input.action === 'DISPUTED') {
      // Alert SuperAdmin and Head of Marketing (real-time + persistent)
      this.events.emitToRoom('admin', 'funding:disputed', {
        fundingId: funding.id,
        amount: funding.amount,
        reason: input.disputeReason,
      });
      const disputedPayload = {
        type: 'funding:disputed' as const,
        title: 'Funding disputed',
        body: `A Media Buyer marked funding as Not Received. Requires resolution.`,
        data: { fundingId: funding.id, amount: funding.amount },
      };
      this.notifications.enqueueCreateForRole('SUPER_ADMIN', disputedPayload);
      this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', disputedPayload);
    }

    return updated[0];
  }

  async listFunding(input: ListFundingInput, branchId?: string | null) {
    const fundingSender = alias(schema.users, 'funding_sender');
    const fundingReceiver = alias(schema.users, 'funding_receiver');

    const conditions: SQL[] = [];
    if (input.status) {
      conditions.push(eq(schema.marketingFunding.status, input.status));
    }
    if (input.receiverId) {
      conditions.push(eq(schema.marketingFunding.receiverId, input.receiverId));
    }
    if (input.receiverRole) {
      const roleReceiverIds = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.role, input.receiverRole as typeof schema.users.role.enumValues[number]));
      if (roleReceiverIds.length === 0) {
        return { records: [], pagination: { total: 0, page: input.page, limit: input.limit, totalPages: 0 } };
      }
      conditions.push(inArray(schema.marketingFunding.receiverId, roleReceiverIds.map((r) => r.id)));
    }
    if (input.senderId) {
      conditions.push(eq(schema.marketingFunding.senderId, input.senderId));
    }
    if (input.startDate) {
      conditions.push(gte(schema.marketingFunding.sentAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.marketingFunding.sentAt, nigeriaDayEnd(input.endDate)));
    }
    // Ledger rows have no branch_id. Do not filter by active-branch membership here — it
    // drifted from `fundingByDirectionSummary` (actor + period only) and hid rows when the
    // viewer's session branch did not match their `user_branches` row or cross-branch data.
    void branchId;
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      if (trimmedSearchLooksLikeUuid(searchTrimmed)) {
        conditions.push(eq(schema.marketingFunding.id, searchTrimmed));
      } else {
        const searchOr = or(
          ilike(fundingSender.name, `%${searchTrimmed}%`),
          ilike(fundingReceiver.name, `%${searchTrimmed}%`),
        );
        if (searchOr) conditions.push(searchOr);
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const baseFrom = this.db
      .select({
        ...getTableColumns(schema.marketingFunding),
        senderName: fundingSender.name,
        receiverName: fundingReceiver.name,
      })
      .from(schema.marketingFunding)
      .leftJoin(fundingSender, eq(schema.marketingFunding.senderId, fundingSender.id))
      .leftJoin(fundingReceiver, eq(schema.marketingFunding.receiverId, fundingReceiver.id))
      .where(whereClause);

    const [records, totalRows] = await Promise.all([
      baseFrom.orderBy(desc(schema.marketingFunding.sentAt)).limit(input.limit).offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.marketingFunding)
        .leftJoin(fundingSender, eq(schema.marketingFunding.senderId, fundingSender.id))
        .leftJoin(fundingReceiver, eq(schema.marketingFunding.receiverId, fundingReceiver.id))
        .where(whereClause),
    ]);

    const total = Number(totalRows[0]?.count ?? 0);

    return {
      records,
      pagination: { page: input.page, limit: input.limit, total },
    };
  }

  async fundingStatusCounts(input: FundingStatusCountsInput, branchId?: string | null) {
    const fundingSender = alias(schema.users, 'funding_status_sender');
    const fundingReceiver = alias(schema.users, 'funding_status_receiver');

    const conditions: SQL[] = [];
    if (input.receiverId) {
      conditions.push(eq(schema.marketingFunding.receiverId, input.receiverId));
    }
    // Direction filter — used by the "Distributing" section to count outgoing-only transfers
    // (HoM disbursing to MBs). Mutually compatible with `receiverId` (both can constrain).
    if (input.senderId) {
      conditions.push(eq(schema.marketingFunding.senderId, input.senderId));
    }
    if (input.startDate) {
      conditions.push(gte(schema.marketingFunding.sentAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.marketingFunding.sentAt, nigeriaDayEnd(input.endDate)));
    }
    void branchId;
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      if (trimmedSearchLooksLikeUuid(searchTrimmed)) {
        conditions.push(eq(schema.marketingFunding.id, searchTrimmed));
      } else {
        const searchOr = or(
          ilike(fundingSender.name, `%${searchTrimmed}%`),
          ilike(fundingReceiver.name, `%${searchTrimmed}%`),
        );
        if (searchOr) conditions.push(searchOr);
      }
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        status: schema.marketingFunding.status,
        c: count(),
      })
      .from(schema.marketingFunding)
      .leftJoin(fundingSender, eq(schema.marketingFunding.senderId, fundingSender.id))
      .leftJoin(fundingReceiver, eq(schema.marketingFunding.receiverId, fundingReceiver.id))
      .where(whereClause)
      .groupBy(schema.marketingFunding.status);

    const out = { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
    for (const r of rows) {
      const n = Number(r.c);
      if (r.status === 'SENT') out.SENT = n;
      else if (r.status === 'COMPLETED') out.COMPLETED = n;
      else if (r.status === 'DISPUTED') out.DISPUTED = n;
      out.ALL += n;
    }
    return out;
  }

  async fundingRequestStatusCounts(
    input: FundingRequestStatusCountsInput,
    user: {
      id: string;
      role: string;
      permissions?: string[];
      isMarketingTeamSupervisorOnActiveBranch?: boolean;
    },
    branchId?: string | null,
  ) {
    const conditions: SQL[] = [];

    // Direction filters — `requesterId` ("My Requests" view) and `excludeSelfAsRequester`
    // ("MB Requests" inbox view, HoM-side) are mutually exclusive in practice; if both
    // are set the explicit `requesterId` wins. Anyone without funding-approve capability
    // sees only their own requests by default.
    const userPerms = (user.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const canApproveFunding =
      user.role === 'SUPER_ADMIN' ||
      userPerms.includes(canonicalPermissionCode('marketing.funding.approve')) ||
      // Finance disburses against pending funding requests via
      // /admin/finance/disbursements — they need to see every request, not
      // just their own, even though the catalog reserves the legacy
      // `marketing.funding.approve` code for HoM (2026-05-05).
      userPerms.includes(canonicalPermissionCode('finance.disburse')) ||
      hasFinanceAccess(user);
    // Marketing-team supervisors don't hold `marketing.funding.approve` but
    // they DO act as the approver of inbox requests (CEO directive 2026-05-11).
    // Bypass the "own requests only" default so the inbox-pin from the
    // tRPC layer (`targetUserId = ctx.user.id`) drives the counts.
    const isMarketingSupervisor = user.isMarketingTeamSupervisorOnActiveBranch === true;
    if (input.requesterId) {
      conditions.push(eq(schema.marketingFundingRequests.requesterId, input.requesterId));
    } else if (input.excludeSelfAsRequester) {
      conditions.push(ne(schema.marketingFundingRequests.requesterId, user.id));
    } else if (!canApproveFunding && !isMarketingSupervisor) {
      // Default visibility for non-approvers (and non-supervisors): own requests only.
      conditions.push(eq(schema.marketingFundingRequests.requesterId, user.id));
    }
    if (input.requesterRole) {
      // Mirror listFundingRequests — subquery keeps it join-free so the count
      // query stays a plain aggregate over marketing_funding_requests.
      conditions.push(
        inArray(
          schema.marketingFundingRequests.requesterId,
          this.db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.role, input.requesterRole)),
        ),
      );
    }
    // Migration 0106 — caller-supplied targetUserId (their inbox); legacy NULL-target
    // rows are included so pre-migration broadcasts remain visible to their historical
    // audience.
    if (input.targetUserId) {
      conditions.push(
        or(
          eq(schema.marketingFundingRequests.targetUserId, input.targetUserId),
          isNull(schema.marketingFundingRequests.targetUserId),
        ) as SQL,
      );
    }
    if (input.startDate) {
      conditions.push(gte(schema.marketingFundingRequests.createdAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.marketingFundingRequests.createdAt, nigeriaDayEnd(input.endDate)));
    }
    void branchId;
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        status: schema.marketingFundingRequests.status,
        c: count(),
      })
      .from(schema.marketingFundingRequests)
      .where(whereClause)
      .groupBy(schema.marketingFundingRequests.status);

    const out = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    for (const r of rows) {
      const n = Number(r.c);
      if (r.status === 'PENDING') out.PENDING = n;
      else if (r.status === 'APPROVED') out.APPROVED = n;
      else if (r.status === 'REJECTED') out.REJECTED = n;
      out.ALL += n;
    }
    return out;
  }

  async getFundingSummary(
    branchId?: string | null,
    opts?: { restrictToReceiverIds?: string[] },
  ) {
    const emptyFundingSummary = {
      totalSent: '0', totalCompleted: '0', totalDisputed: '0',
      sentCount: 0, completedCount: 0, disputedCount: 0,
    };
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && branchUserIds.length === 0) {
      return emptyFundingSummary;
    }

    const restrict = opts?.restrictToReceiverIds;
    let receiverScope: SQL | undefined;
    if (branchUserIds && restrict?.length) {
      const intersect = branchUserIds.filter((id) => restrict.includes(id));
      if (intersect.length === 0) {
        return emptyFundingSummary;
      }
      receiverScope = inArray(schema.marketingFunding.receiverId, intersect);
    } else if (branchUserIds) {
      receiverScope = inArray(schema.marketingFunding.receiverId, branchUserIds);
    } else if (restrict?.length) {
      receiverScope = inArray(schema.marketingFunding.receiverId, restrict);
    }

    const rows = await this.db
      .select({
        totalSent: sql<string>`COALESCE(SUM(CASE WHEN ${schema.marketingFunding.status} = 'SENT' THEN ${schema.marketingFunding.amount} ELSE 0 END), 0)::text`,
        totalCompleted: sql<string>`COALESCE(SUM(CASE WHEN ${schema.marketingFunding.status} = 'COMPLETED' THEN ${schema.marketingFunding.amount} ELSE 0 END), 0)::text`,
        totalDisputed: sql<string>`COALESCE(SUM(CASE WHEN ${schema.marketingFunding.status} = 'DISPUTED' THEN ${schema.marketingFunding.amount} ELSE 0 END), 0)::text`,
        sentCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.marketingFunding.status} = 'SENT')::int`,
        completedCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.marketingFunding.status} = 'COMPLETED')::int`,
        disputedCount: sql<number>`COUNT(*) FILTER (WHERE ${schema.marketingFunding.status} = 'DISPUTED')::int`,
      })
      .from(schema.marketingFunding)
      .where(receiverScope);

    const r = rows[0];
    return {
      totalSent: r?.totalSent ?? '0',
      totalCompleted: r?.totalCompleted ?? '0',
      totalDisputed: r?.totalDisputed ?? '0',
      sentCount: r?.sentCount ?? 0,
      completedCount: r?.completedCount ?? 0,
      disputedCount: r?.disputedCount ?? 0,
    };
  }

  /**
   * Per-actor directional summary used by the Funding page top strip. Returns the totals
   * the actor cares about most: how much they've received in the period and (for HoM) how
   * much they've distributed. Pending mark-received and disputed counts are surfaced as
   * action signals so the UI can highlight items needing attention without a separate fetch.
   *
   * Period filter applies to `sent_at` (when the transfer was initiated). Branch scoping
   * does NOT apply — this is keyed entirely on the actor's own id (received TO them or
   * sent BY them), so cross-branch admin behaviour is irrelevant.
   */
  async fundingByDirectionSummary(
    actorId: string,
    input: { startDate?: string; endDate?: string },
  ) {
    const dateConditions: SQL[] = [];
    if (input.startDate) {
      dateConditions.push(gte(schema.marketingFunding.sentAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      dateConditions.push(lte(schema.marketingFunding.sentAt, nigeriaDayEnd(input.endDate)));
    }

    // Total received (any status) — gives the headline number HoMs/MBs see.
    const incomingWhere = and(eq(schema.marketingFunding.receiverId, actorId), ...dateConditions);
    const outgoingWhere = and(eq(schema.marketingFunding.senderId, actorId), ...dateConditions);

    const [received, distributed, pendingReceiveRow, disputedReceiveRow, disputedSendRow] =
      await Promise.all([
        this.db
          .select({ total: sum(schema.marketingFunding.amount) })
          .from(schema.marketingFunding)
          .where(incomingWhere),
        this.db
          .select({ total: sum(schema.marketingFunding.amount) })
          .from(schema.marketingFunding)
          .where(outgoingWhere),
        this.db
          .select({ c: count() })
          .from(schema.marketingFunding)
          .where(
            and(
              eq(schema.marketingFunding.receiverId, actorId),
              eq(schema.marketingFunding.status, 'SENT'),
            ),
          ),
        this.db
          .select({ c: count() })
          .from(schema.marketingFunding)
          .where(
            and(
              eq(schema.marketingFunding.receiverId, actorId),
              eq(schema.marketingFunding.status, 'DISPUTED'),
            ),
          ),
        this.db
          .select({ c: count() })
          .from(schema.marketingFunding)
          .where(
            and(
              eq(schema.marketingFunding.senderId, actorId),
              eq(schema.marketingFunding.status, 'DISPUTED'),
            ),
          ),
      ]);

    return {
      totalReceived: received[0]?.total ?? '0',
      totalDistributed: distributed[0]?.total ?? '0',
      pendingMarkReceived: Number(pendingReceiveRow[0]?.c ?? 0),
      disputedAsReceiver: Number(disputedReceiveRow[0]?.c ?? 0),
      disputedAsSender: Number(disputedSendRow[0]?.c ?? 0),
    };
  }

  /**
   * Funding balance for one user: COMPLETED received − COMPLETED distributed − non-REJECTED ad spend.
   * Expenses deduct immediately on creation (PENDING + APPROVED both count); only REJECTED
   * entries are excluded — effectively "returned" to the balance.
   */
  async getFundingBalance(
    userId: string,
    branchId?: string | null,
  ): Promise<{ totalReceived: string; totalDistributed: string; totalSpend: string; balance: string }> {
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return { totalReceived: '0', totalDistributed: '0', totalSpend: '0', balance: '0' };
    }

    const [receivedRow, distributedRow, spendRow] = await Promise.all([
      this.db
        .select({ total: sum(schema.marketingFunding.amount) })
        .from(schema.marketingFunding)
        .where(
          and(
            eq(schema.marketingFunding.receiverId, userId),
            eq(schema.marketingFunding.status, 'COMPLETED'),
          ),
        )
        .then((r) => r[0]),
      this.db
        .select({ total: sum(schema.marketingFunding.amount) })
        .from(schema.marketingFunding)
        .where(
          and(
            eq(schema.marketingFunding.senderId, userId),
            eq(schema.marketingFunding.status, 'COMPLETED'),
          ),
        )
        .then((r) => r[0]),
      this.db
        .select({ total: sum(schema.adSpendLogs.spendAmount) })
        .from(schema.adSpendLogs)
        .where(
          and(
            eq(schema.adSpendLogs.mediaBuyerId, userId),
            ne(schema.adSpendLogs.status, 'REJECTED'),
            branchCampaignIds ? inArray(schema.adSpendLogs.campaignId, branchCampaignIds) : undefined,
          ),
        )
        .then((r) => r[0]),
    ]);

    const totalReceived = receivedRow?.total ?? '0';
    const totalDistributed = distributedRow?.total ?? '0';
    const totalSpend = spendRow?.total ?? '0';
    const balance = String(
      Math.max(0, Number(totalReceived) - Number(totalDistributed) - Number(totalSpend)),
    );

    return { totalReceived, totalDistributed, totalSpend, balance };
  }

  /**
   * List funding balances for recipient users. Scoped by caller role:
   * - HEAD_OF_MARKETING: self + all Media Buyers
   * - SUPER_ADMIN / FINANCE_OFFICER: all Head of Marketing + all Media Buyers
   */
  async listFundingBalances(
    caller: { id: string; role: string; permissions?: string[] },
    branchId?: string | null,
    opts?: { activeOnly?: boolean },
  ): Promise<
    Array<{
      userId: string;
      name: string;
      role: string;
      totalReceived: string;
      totalDistributed: string;
      totalSpend: string;
      balance: string;
    }>
  > {
    // `activeOnly` drops DEACTIVATED / ARCHIVED accounts so the Team Analysis
    // roster matches `getMediaBuyerLeaderboard` (ACTIVE-only). Without it a
    // deactivated MB shows as a half-empty ghost row — funding ₦0 but dashes
    // for every metric. Finance/report callers leave it off so a deactivated
    // recipient with a real outstanding balance still surfaces.
    const activeOnly = opts?.activeOnly === true;
    const callerPerms = (caller.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasGlobalView =
      caller.role === 'SUPER_ADMIN' ||
      callerPerms.includes(canonicalPermissionCode('finance.read')) ||
      callerPerms.includes(canonicalPermissionCode('marketing.scope.global'));
    const recipientUserIds: string[] = [];

    if (hasGlobalView) {
      const recipients = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          activeOnly
            ? and(
                inArray(schema.users.role, ['HEAD_OF_MARKETING', 'MEDIA_BUYER']),
                eq(schema.users.status, 'ACTIVE'),
              )
            : inArray(schema.users.role, ['HEAD_OF_MARKETING', 'MEDIA_BUYER']),
        );
      recipientUserIds.push(...recipients.map((r) => r.id));
    } else {
      // Non-global viewer (e.g. HoM without scope.global, or branch-scoped marketing reader)
      // sees themselves plus all Media Buyers (they fund MBs).
      recipientUserIds.push(caller.id);
      const mediaBuyers = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          activeOnly
            ? and(eq(schema.users.role, 'MEDIA_BUYER'), eq(schema.users.status, 'ACTIVE'))
            : eq(schema.users.role, 'MEDIA_BUYER'),
        );
      for (const u of mediaBuyers) {
        if (u.id !== caller.id) recipientUserIds.push(u.id);
      }
    }

    const holdsTeamOverview =
      caller.role === 'HEAD_OF_MARKETING' ||
      callerPerms.includes(canonicalPermissionCode('marketing.teamOverview'));
    if (!hasGlobalView && branchId && !holdsTeamOverview && !isAdminLevel({ role: caller.role })) {
      const supervisedMb = await this.branchTeams.listSupervisedUserIds(caller.id, branchId, 'MARKETING');
      if (supervisedMb.length > 0) {
        const keep = new Set<string>([caller.id, ...supervisedMb]);
        const narrowed = recipientUserIds.filter((id) => keep.has(id));
        recipientUserIds.length = 0;
        recipientUserIds.push(...narrowed);
      }
    }

    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds) {
      const allowed = new Set(branchUserIds);
      const filtered = recipientUserIds.filter((id) => allowed.has(id));
      recipientUserIds.length = 0;
      recipientUserIds.push(...filtered);
    }

    if (recipientUserIds.length === 0) {
      return [];
    }

    const branchCampaignIds = await this.getBranchCampaignIds(branchId);

    const [fundingByReceiver, fundingBySender, spendByMediaBuyer, userRows] = await Promise.all([
      this.db
        .select({
          receiverId: schema.marketingFunding.receiverId,
          total: sum(schema.marketingFunding.amount),
        })
        .from(schema.marketingFunding)
        .where(
          and(
            inArray(schema.marketingFunding.receiverId, recipientUserIds),
            eq(schema.marketingFunding.status, 'COMPLETED'),
          ),
        )
        .groupBy(schema.marketingFunding.receiverId),
      this.db
        .select({
          senderId: schema.marketingFunding.senderId,
          total: sum(schema.marketingFunding.amount),
        })
        .from(schema.marketingFunding)
        .where(
          and(
            inArray(schema.marketingFunding.senderId, recipientUserIds),
            eq(schema.marketingFunding.status, 'COMPLETED'),
          ),
        )
        .groupBy(schema.marketingFunding.senderId),
      this.db
        .select({
          mediaBuyerId: schema.adSpendLogs.mediaBuyerId,
          total: sum(schema.adSpendLogs.spendAmount),
        })
        .from(schema.adSpendLogs)
        .where(
          and(
            inArray(schema.adSpendLogs.mediaBuyerId, recipientUserIds),
            ne(schema.adSpendLogs.status, 'REJECTED'),
            branchCampaignIds
              ? inArray(schema.adSpendLogs.campaignId, branchCampaignIds)
              : undefined,
          ),
        )
        .groupBy(schema.adSpendLogs.mediaBuyerId),
      this.db
        .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role })
        .from(schema.users)
        .where(inArray(schema.users.id, recipientUserIds)),
    ]);

    const receivedMap = new Map<string, string>();
    for (const r of fundingByReceiver) {
      receivedMap.set(r.receiverId, r.total ?? '0');
    }
    const distributedMap = new Map<string, string>();
    for (const r of fundingBySender) {
      distributedMap.set(r.senderId, r.total ?? '0');
    }
    const spendMap = new Map<string, string>();
    for (const s of spendByMediaBuyer) {
      spendMap.set(s.mediaBuyerId, s.total ?? '0');
    }

    const result: Array<{
      userId: string;
      name: string;
      role: string;
      totalReceived: string;
      totalDistributed: string;
      totalSpend: string;
      balance: string;
    }> = [];
    for (const u of userRows) {
      const totalReceived = receivedMap.get(u.id) ?? '0';
      const totalDistributed = distributedMap.get(u.id) ?? '0';
      const totalSpend = spendMap.get(u.id) ?? '0';
      const balance = String(
        Math.max(0, Number(totalReceived) - Number(totalDistributed) - Number(totalSpend)),
      );
      result.push({
        userId: u.id,
        name: u.name,
        role: u.role,
        totalReceived,
        totalDistributed,
        totalSpend,
        balance,
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get funding balance for a user with caller authorization.
   * Allowed: own balance; HoM viewing MB; SA/FO viewing any; users.read viewing HoM/MB.
   */
  async getFundingBalanceWithAuth(
    userId: string,
    caller: { id: string; role: string; permissions?: string[] },
    branchId?: string | null,
  ): Promise<{ totalReceived: string; totalDistributed: string; totalSpend: string; balance: string }> {
    const [target] = await this.db
      .select({ role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!target) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    const targetRole = target.role;
    const isRecipient = targetRole === 'HEAD_OF_MARKETING' || targetRole === 'MEDIA_BUYER';
    if (!isRecipient) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Funding balance is only available for Head of Marketing or Media Buyer',
      });
    }

    if (caller.id === userId) {
      return this.getFundingBalance(userId, branchId);
    }
    const balancePerms = (caller.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasBalancePerm = (code: string) =>
      caller.role === 'SUPER_ADMIN' || balancePerms.includes(canonicalPermissionCode(code));
    // Anyone with finance read, marketing org-wide scope, or general user-read can view a
    // recipient's funding balance. HoM-can-view-MB is captured by `marketing.scope.global`.
    if (
      hasBalancePerm('finance.read') ||
      hasBalancePerm('marketing.scope.global') ||
      hasBalancePerm('users.read')
    ) {
      return this.getFundingBalance(userId, branchId);
    }

    throw new TRPCError({
      code: 'FORBIDDEN',
      message: "You do not have permission to view this user's funding balance",
    });
  }

  /**
   * Media Buyer or Head of Marketing requests funds. Persists the request.
   * Media Buyer → notifies Head of Marketing. Head of Marketing → notifies SuperAdmin + Finance Officer.
   */
  /**
   * List recipient candidates for a funding request (Migration 0106). Returned
   * in the order the UI should preselect them — for MBs, the HoM in their
   * branch comes first; for HoMs, the first FINANCE_OFFICER.
   *
   * The Finance "hat" pattern was retired in migration 0101, so Finance is
   * identified solely by `role === 'FINANCE_OFFICER'`.
   */
  async listFundingRequestRecipients(
    requesterRole: 'MEDIA_BUYER' | 'HEAD_OF_MARKETING',
    branchId: string | null | undefined,
    /**
     * MB requester id — when supplied alongside a `branchId`, the picker also
     * surfaces the requester's marketing-team supervisor(s) on that branch
     * and marks the supervisor as the preselected default. Falls back to the
     * legacy "HoM is the default" behavior when no supervisor exists.
     */
    requesterId?: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      role: string;
      isFinance: boolean;
      /** True when this row is the requester's marketing-team supervisor on
       *  the active branch — drives the "Team supervisor" UI label and is
       *  given highest sort/preselect priority. */
      isSupervisor: boolean;
      isPreferred: boolean;
      branchId: string | null;
    }>
  > {
    // A normal Media Buyer requests funding from their team supervisor or Head
    // of Marketing — never directly from a Finance Officer. Finance disburses
    // to HoMs only; the HoM then funds their Media Buyers.
    const allowedRoles: Array<'FINANCE_OFFICER' | 'HEAD_OF_MARKETING' | 'MEDIA_BUYER' | 'SUPER_ADMIN' | 'ADMIN'> =
      requesterRole === 'MEDIA_BUYER'
        ? ['HEAD_OF_MARKETING', 'MEDIA_BUYER']
        : ['FINANCE_OFFICER', 'SUPER_ADMIN', 'ADMIN'];

    // Resolve the requester's marketing supervisors on this branch. When
    // present, they become the preferred recipients; HoM stays in the list
    // as a secondary option.
    const supervisorIdsSet = new Set<string>();
    if (requesterRole === 'MEDIA_BUYER' && requesterId && branchId) {
      const ids = await this.branchTeams.listSupervisorIdsForUser(
        requesterId,
        branchId,
        'MARKETING',
      );
      for (const id of ids) supervisorIdsSet.add(id);
    }

    // Resolve the set of user-ids that belong to the requester's branch via
    // both `user_branches` (multi-branch assignments) AND `primaryBranchId`.
    // This ensures a HoM assigned to Lagos + Remote appears for Remote MBs
    // even when their primary branch is Lagos.
    const branchUserIds = branchId ? await this.getBranchUserIds(branchId) : null;
    const branchUserIdSet = branchUserIds ? new Set(branchUserIds) : null;

    const rows = await this.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
        primaryBranchId: schema.users.primaryBranchId,
        status: schema.users.status,
      })
      .from(schema.users)
      .where(
        and(eq(schema.users.status, 'ACTIVE' as const), inArray(schema.users.role, allowedRoles)),
      );

    const hasSupervisor = supervisorIdsSet.size > 0;

    return rows
      .filter((r) => {
        // Finance / SuperAdmin / Admin are valid recipients for HoM requesters
        // only — a normal Media Buyer cannot request funding directly from them.
        if (r.role === 'FINANCE_OFFICER' || r.role === 'SUPER_ADMIN') {
          return requesterRole !== 'MEDIA_BUYER';
        }
        if (requesterRole !== 'MEDIA_BUYER') return false;
        // Marketing-team supervisor on this branch — the new preferred path.
        if (r.role === 'MEDIA_BUYER') return supervisorIdsSet.has(r.id);
        // HoM target — branch must match (via user_branches OR primaryBranchId).
        if (r.role !== 'HEAD_OF_MARKETING') return false;
        if (!branchUserIdSet) return true;
        return branchUserIdSet.has(r.id);
      })
      .map((r) => {
        const isFinance = r.role === 'FINANCE_OFFICER' || r.role === 'SUPER_ADMIN';
        const isHoM = r.role === 'HEAD_OF_MARKETING';
        const isSupervisor = supervisorIdsSet.has(r.id);
        // Preferred / preselected order:
        //   MB requester w/ supervisor → supervisor wins
        //   MB requester w/o supervisor → HoM (legacy)
        //   HoM requester → first Finance Officer
        const isPreferred =
          requesterRole === 'MEDIA_BUYER'
            ? hasSupervisor
              ? isSupervisor
              : isHoM
            : isFinance;
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          isFinance,
          isSupervisor,
          isPreferred,
          branchId: r.primaryBranchId ?? null,
        };
      })
      .sort((a, b) => {
        // Supervisors first, then other preferred, then alphabetical.
        if (a.isSupervisor && !b.isSupervisor) return -1;
        if (!a.isSupervisor && b.isSupervisor) return 1;
        if (a.isPreferred && !b.isPreferred) return -1;
        if (!a.isPreferred && b.isPreferred) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  async requestFunding(
    amount: number,
    reason: string,
    requesterId: string,
    requesterRole: 'MEDIA_BUYER' | 'HEAD_OF_MARKETING',
    branchId?: string | null,
    targetUserId?: string,
  ) {
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && !branchUserIds.includes(requesterId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Requester is not in the active branch' });
    }

    // ── Validate the target recipient (CEO directive 2026-05-03 / migration 0106) ──
    // Allowed targets per requester role:
    //   MB → their marketing-team supervisor, or HEAD_OF_MARKETING in the same
    //        branch. A normal Media Buyer can NOT request from Finance directly.
    //   HoM → any FINANCE_OFFICER (org-wide)
    // When `targetUserId` is omitted we fall back to the legacy broadcast flow
    // (HoM-by-role for MB; Finance + SuperAdmin for HoM) — keeps older clients
    // working until they ship the new dropdown.
    let validatedTargetUserId: string | null = null;
    if (targetUserId) {
      const [target] = await this.db
        .select({
          id: schema.users.id,
          role: schema.users.role,
          primaryBranchId: schema.users.primaryBranchId,
        })
        .from(schema.users)
        .where(eq(schema.users.id, targetUserId))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recipient not found' });
      }
      const targetIsFinance = target.role === 'FINANCE_OFFICER';
      const targetIsHoM = target.role === 'HEAD_OF_MARKETING';
      const targetIsMediaBuyer = target.role === 'MEDIA_BUYER';
      const requesterIsMb = requesterRole === 'MEDIA_BUYER';
      // MB → another MEDIA_BUYER is allowed when that MB is the requester's
      // marketing-team supervisor on the same branch (CEO directive 2026-05-11
      // — supervisors are the new default funding-approval recipient for MBs
      // on supervised teams).
      let targetIsSupervisor = false;
      if (requesterIsMb && targetIsMediaBuyer && branchId) {
        targetIsSupervisor = await this.branchTeams.isMarketingSupervisorOf(
          target.id,
          requesterId,
          branchId,
        );
      }
      // Finance / Admin / SuperAdmin are valid targets for HoM requesters;
      // a normal Media Buyer must route through their supervisor / Head of Marketing.
      const targetIsAdminLevel = ['SUPER_ADMIN', 'ADMIN'].includes(target.role);
      const nonMbTargetAllowed = !requesterIsMb && (targetIsFinance || targetIsAdminLevel);
      const mbMarketingTargetAllowed =
        requesterIsMb && (targetIsHoM || targetIsSupervisor);
      if (!nonMbTargetAllowed && !mbMarketingTargetAllowed) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: requesterIsMb
            ? 'Funding requests must be sent to your team supervisor or Head of Marketing'
            : 'Funding requests must be sent to a Finance Officer, Admin, or Super Admin',
        });
      }
      // Branch check for HoM targets only — Finance is org-wide; the supervisor
      // path already enforced same-branch via `isMarketingSupervisorOf`.
      // Check both `user_branches` and `primaryBranchId` so a HoM assigned to
      // multiple branches is reachable from any of them.
      if (targetIsHoM && branchId) {
        if (branchUserIds && !branchUserIds.includes(target.id)) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Recipient is not in your branch',
          });
        }
      }
      validatedTargetUserId = target.id;
    }

    const { request, requester } = await withActor(this.db, { id: requesterId }, async (tx) => {
      const rows = await tx
        .insert(schema.marketingFundingRequests)
        .values({
          requesterId,
          targetUserId: validatedTargetUserId ?? undefined,
          amount: String(amount),
          reason: reason.trim() || null,
          status: 'PENDING',
        })
        .returning();

      const inserted = rows[0];
      if (!inserted) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create funding request',
        });
      }

      const [foundRequester] = await tx
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, requesterId))
        .limit(1);

      return { request: inserted, requester: foundRequester };
    });

    const name =
      requester?.name ??
      (requesterRole === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : 'A Media Buyer');
    const bodySuffix = reason.trim() ? ` Reason: ${reason}` : '';
    const body = `${name} requested ₦${Number(amount).toLocaleString()}.${bodySuffix}`;

    if (validatedTargetUserId) {
      this.notifications.enqueueCreate({
        userId: validatedTargetUserId,
        type: 'funding:request',
        title: 'Funding request',
        body,
        data: { requesterId, amount, reason: reason || null, requestId: request.id },
      });
    } else if (requesterRole === 'HEAD_OF_MARKETING') {
      const bodyWithAction = `${body} Disburse via Finance → Disbursements.`;
      const payload = {
        type: 'funding:request' as const,
        title: 'Funding request',
        body: bodyWithAction,
        data: { requesterId, amount, reason: reason || null, requestId: request.id },
      };
      this.notifications.enqueueCreateForRole('SUPER_ADMIN', payload);
      this.notifications.enqueueCreateForRole('FINANCE_OFFICER', payload);
    } else {
      this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
        type: 'funding:request',
        title: 'Funding request',
        body,
        data: { requesterId, amount, reason: reason || null, requestId: request.id },
      });
    }

    return request;
  }

  /**
   * List funding requests. Media Buyer: only their own. HoM/Admin: can filter by requesterId or get all.
   */
  async listFundingRequests(
    input: {
      requesterId?: string;
      /** Caller id used when `excludeSelfAsRequester` is set (HoM's "MB Requests" inbox). */
      callerId?: string;
      excludeSelfAsRequester?: boolean;
      /** Migration 0106 — list only requests targeted at this user. When set together with
       *  `requesterId`, both apply (caller's own outbound requests will not match unless they
       *  targeted themselves, which the create flow disallows). */
      targetUserId?: string;
      /** When true, also include legacy NULL-target rows in the result set. Used by the
       *  inbox view so pre-migration broadcasts remain visible to their historical audience. */
      includeLegacyNullTarget?: boolean;
      /** Restrict to requests whose requester holds this role (Finance Disbursements
       *  page pins this to HEAD_OF_MARKETING). */
      requesterRole?: 'HEAD_OF_MARKETING' | 'MEDIA_BUYER';
      startDate?: string;
      endDate?: string;
      status?: 'PENDING' | 'APPROVED' | 'REJECTED';
      search?: string;
      page: number;
      limit: number;
    },
    branchId?: string | null,
  ) {
    const conditions = [];
    if (input.requesterId) {
      conditions.push(eq(schema.marketingFundingRequests.requesterId, input.requesterId));
    } else if (input.excludeSelfAsRequester && input.callerId) {
      conditions.push(ne(schema.marketingFundingRequests.requesterId, input.callerId));
    }
    if (input.requesterRole) {
      // Subquery keeps this a single condition that works uniformly across the
      // rows query and the count query (neither needs an extra join).
      conditions.push(
        inArray(
          schema.marketingFundingRequests.requesterId,
          this.db
            .select({ id: schema.users.id })
            .from(schema.users)
            .where(eq(schema.users.role, input.requesterRole)),
        ),
      );
    }
    if (input.targetUserId) {
      conditions.push(
        input.includeLegacyNullTarget
          ? (or(
              eq(schema.marketingFundingRequests.targetUserId, input.targetUserId),
              isNull(schema.marketingFundingRequests.targetUserId),
            ) as SQL)
          : eq(schema.marketingFundingRequests.targetUserId, input.targetUserId),
      );
    }
    if (input.startDate) {
      conditions.push(gte(schema.marketingFundingRequests.createdAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.marketingFundingRequests.createdAt, nigeriaDayEnd(input.endDate)));
    }
    if (input.status) {
      conditions.push(eq(schema.marketingFundingRequests.status, input.status));
    }
    if (input.search) {
      const term = `%${input.search}%`;
      conditions.push(
        or(
          ilike(schema.users.name, term),
          ilike(schema.marketingFundingRequests.reason, term),
        ) as SQL,
      );
    }
    void branchId;
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: schema.marketingFundingRequests.id,
          requesterId: schema.marketingFundingRequests.requesterId,
          amount: schema.marketingFundingRequests.amount,
          reason: schema.marketingFundingRequests.reason,
          status: schema.marketingFundingRequests.status,
          receiptUrl: schema.marketingFundingRequests.receiptUrl,
          createdAt: schema.marketingFundingRequests.createdAt,
          resolvedAt: schema.marketingFundingRequests.resolvedAt,
          resolvedBy: schema.marketingFundingRequests.resolvedBy,
          requesterName: schema.users.name,
        })
        .from(schema.marketingFundingRequests)
        .leftJoin(schema.users, eq(schema.marketingFundingRequests.requesterId, schema.users.id))
        .where(whereClause)
        .orderBy(desc(schema.marketingFundingRequests.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.marketingFundingRequests).where(whereClause),
    ]);

    return {
      records: rows,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  /**
   * Head of Marketing (or SuperAdmin / Finance) approves a funding request: money sent manually, receipt attached.
   * Updates the request and inserts a matching `marketing_funding` ledger row (SENT) so totals / Transfers / balance
   * stay aligned with My Requests. Notifies the requester; emits `funding:received` for live lists (no duplicate
   * `funding:sent` push — `funding:approved` remains the primary in-app notification).
   *
   * `sentAmount` may be less than the requested amount (e.g. partial disbursement); it is stamped on the request
   * row and ledger. HoM→MB approvals require sufficient disbursable marketing wallet (Finance/Admin→MB skips).
   */
  async approveFundingRequest(
    requestId: string,
    sentAmount: number,
    receiptUrl: string | undefined,
    actor: {
      id: string;
      role: string;
      permissions?: string[];
      scopeOrgWideHead?: boolean;
    },
    currentBranchId: string | null,
  ) {
    const approverId = actor.id;
    const [existing] = await this.db
      .select()
      .from(schema.marketingFundingRequests)
      .where(eq(schema.marketingFundingRequests.id, requestId))
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Funding request not found' });
    }
    if (existing.status !== 'PENDING') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });
    }

    const requestedAmount = Number(existing.amount);
    const sentCents = Math.round(sentAmount * 100);
    const requestedCents = Math.round(requestedAmount * 100);
    if (!Number.isFinite(sentAmount) || sentCents <= 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Approved amount must be a positive number',
      });
    }
    if (sentCents > requestedCents) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Approved amount cannot exceed the requested amount',
      });
    }

    // Migration 0106 — only the request's targeted recipient (or admin / finance)
    // can approve. Finance bypasses too: `/admin/finance/disbursements` legitimately
    // disburses any pending request as part of the company-wide finance flow.
    const canBypassRecipientGate = isAdminLevel(actor) || hasFinanceAccess(actor);
    const actorPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasApprovePerm =
      actorPerms.includes(canonicalPermissionCode('marketing.funding.approve')) ||
      actorPerms.includes(canonicalPermissionCode('finance.disburse'));
    if (existing.targetUserId) {
      // Targeted request — only the recipient, admin, or finance can approve.
      if (existing.targetUserId !== actor.id && !canBypassRecipientGate) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the recipient of this funding request can approve it',
        });
      }
    } else if (!canBypassRecipientGate && !hasApprovePerm) {
      // Legacy NULL-target rows — require explicit permission.
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Missing required permission to approve funding requests',
      });
    }

    // Branch isolation: requester must be on `currentBranchId`; approver must be too unless
    // admin-class (session branch only). Global NULL = admin cross-branch approvals.
    await this.assertSameBranchOrAdmin(actor, existing.requesterId, currentBranchId);

    const [ledgerDup] = await this.db
      .select({ id: schema.marketingFunding.id })
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.sourceFundingRequestId, requestId))
      .limit(1);
    if (ledgerDup) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'This funding request already has a ledger transfer',
      });
    }

    const { updated, ledger } = await withActor(this.db, { id: approverId }, async (tx) => {
      const [sender, receiver] = await Promise.all([
        tx
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, approverId))
          .limit(1),
        tx
          .select({ role: schema.users.role })
          .from(schema.users)
          .where(eq(schema.users.id, existing.requesterId))
          .limit(1),
      ]);
      const receiverRole = receiver[0]?.role;
      const senderRole = sender[0]?.role;
      if (!receiverRole || !senderRole) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sender or receiver not found' });
      }
      // If the approver is the targeted recipient of this request, they already
      // passed the recipient gate — skip the role-pair validation so supervisors
      // and targeted recipients can approve without needing a specific role.
      const isTargetedRecipient = existing.targetUserId === approverId;
      if (!isTargetedRecipient) {
        this.assertLedgerTransferAllowed(senderRole, receiverRole, { viaFundingRequest: true });
      }

      if (senderRole === 'HEAD_OF_MARKETING' && receiverRole === 'MEDIA_BUYER') {
        const disbursable = await this.computeMarketingDisbursableInTx(
          tx,
          approverId,
          currentBranchId,
        );
        this.assertSufficientMarketingDisbursable(disbursable, sentAmount);
      }

      const [row] = await tx
        .update(schema.marketingFundingRequests)
        .set({
          status: 'APPROVED',
          amount: String(sentAmount),
          receiptUrl,
          resolvedAt: new Date(),
          resolvedBy: approverId,
        })
        .where(eq(schema.marketingFundingRequests.id, requestId))
        .returning();

      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update funding request',
        });
      }

      const [inserted] = await tx
        .insert(schema.marketingFunding)
        .values({
          senderId: approverId,
          receiverId: existing.requesterId,
          amount: String(sentAmount),
          receiptUrl,
          status: 'SENT',
          sourceFundingRequestId: requestId,
        })
        .returning();

      if (!inserted) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create funding ledger row',
        });
      }

      return { updated: row, ledger: inserted };
    });

    this.events.emitToUser(existing.requesterId, 'funding:received', {
      fundingId: ledger.id,
      amount: sentAmount,
    });

    const nf = (n: number) => n.toLocaleString('en-NG');
    const body =
      sentCents < requestedCents
        ? `Your funding request (₦${nf(requestedAmount)}) was approved for ₦${nf(sentAmount)}. You can view the receipt in Marketing → Funding.`
        : `Your funding request of ₦${nf(sentAmount)} was approved. You can view the receipt in Marketing → Funding.`;
    this.notifications.enqueueCreate({
      userId: existing.requesterId,
      type: 'funding:approved',
      title: 'Funding request approved',
      body,
      data: {
        requestId: updated.id,
        receiptUrl: updated.receiptUrl,
        amount: sentAmount,
      },
    });

    return updated;
  }

  /**
   * Head of Marketing (or SuperAdmin) rejects a funding request. Notifies the Media Buyer.
   */
  async rejectFundingRequest(
    requestId: string,
    _reason: string | undefined,
    rejector:
      | {
          id: string;
          role: string;
          permissions?: string[];
          scopeOrgWideHead?: boolean;
        }
      | string,
  ) {
    const rejectorId = typeof rejector === 'string' ? rejector : rejector.id;
    const rejectorObj =
      typeof rejector === 'string' ? null : rejector;
    const [existing] = await this.db
      .select()
      .from(schema.marketingFundingRequests)
      .where(eq(schema.marketingFundingRequests.id, requestId))
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Funding request not found' });
    }
    if (existing.status !== 'PENDING') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request is not pending' });
    }

    // Migration 0106 — only the request's targeted recipient (or admin / finance)
    // can reject. Finance bypasses too — `/admin/finance/disbursements` rejects
    // pending requests as part of the company-wide finance inbox flow.
    const canBypassRecipientGate =
      rejectorObj !== null && (isAdminLevel(rejectorObj) || hasFinanceAccess(rejectorObj));
    if (existing.targetUserId) {
      if (existing.targetUserId !== rejectorId && !canBypassRecipientGate) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the recipient of this funding request can reject it',
        });
      }
    } else if (!canBypassRecipientGate) {
      // Legacy NULL-target rows — require explicit permission.
      const rejPerms = rejectorObj ? (rejectorObj.permissions ?? []).map((p: string) => canonicalPermissionCode(p)) : [];
      const hasRejectPerm =
        rejPerms.includes(canonicalPermissionCode('marketing.funding.approve')) ||
        rejPerms.includes(canonicalPermissionCode('finance.disburse'));
      if (!hasRejectPerm) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Missing required permission to reject funding requests',
        });
      }
    }

    const updated = await withActor(this.db, { id: rejectorId }, async (tx) => {
      const [row] = await tx
        .update(schema.marketingFundingRequests)
        .set({
          status: 'REJECTED',
          resolvedAt: new Date(),
          resolvedBy: rejectorId,
        })
        .where(eq(schema.marketingFundingRequests.id, requestId))
        .returning();

      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update funding request',
        });
      }
      return row;
    });

    const amount = Number(existing.amount);
    this.notifications.enqueueCreate({
      userId: existing.requesterId,
      type: 'funding:rejected',
      title: 'Funding request not approved',
      body: `Your funding request of ₦${amount.toLocaleString()} was not approved.`,
      data: { requestId: updated.id, amount },
    });

    return updated;
  }

  /**
   * Build the chronological "back-and-forth" timeline for a funding request and its
   * resulting transfer. Pass either a `requestId` or a `transferId`; the method walks
   * the `source_funding_request_id` link to fetch the other side and stitches both into
   * one event list:
   *   - Requested  (request.created_at + requester)
   *   - Approved   (request.resolved_at + resolver)        — when status === 'APPROVED'
   *   - Rejected   (request.resolved_at + resolver)        — when status === 'REJECTED'
   *   - Sent       (transfer.sent_at + sender)
   *   - Received   (transfer.verified_at + receiver)       — when status === 'COMPLETED'
   *   - Disputed   (transfer.verified_at OR sent_at + receiver)  — when status === 'DISPUTED'
   *
   * Permission gate: actor must be a party (requester / target / sender / receiver) OR
   * admin-class / Finance hat (`hasFinanceAccess`).
   */
  async getFundingFlow(
    input: { transferId?: string; requestId?: string },
    actor: { id: string; role: string; permissions?: string[] },
  ) {
    if (!input.transferId && !input.requestId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Provide either transferId or requestId',
      });
    }

    // Resolve transfer (with sender + receiver names) — by id or via request linkage.
    const transferSender = alias(schema.users, 'flow_transfer_sender');
    const transferReceiver = alias(schema.users, 'flow_transfer_receiver');
    const transferQuery = this.db
      .select({
        id: schema.marketingFunding.id,
        senderId: schema.marketingFunding.senderId,
        senderName: transferSender.name,
        senderRole: transferSender.role,
        receiverId: schema.marketingFunding.receiverId,
        receiverName: transferReceiver.name,
        receiverRole: transferReceiver.role,
        amount: schema.marketingFunding.amount,
        status: schema.marketingFunding.status,
        sentAt: schema.marketingFunding.sentAt,
        verifiedAt: schema.marketingFunding.verifiedAt,
        sourceFundingRequestId: schema.marketingFunding.sourceFundingRequestId,
        receiptUrl: schema.marketingFunding.receiptUrl,
      })
      .from(schema.marketingFunding)
      .leftJoin(transferSender, eq(schema.marketingFunding.senderId, transferSender.id))
      .leftJoin(transferReceiver, eq(schema.marketingFunding.receiverId, transferReceiver.id));

    const transferRow = input.transferId
      ? (await transferQuery.where(eq(schema.marketingFunding.id, input.transferId)).limit(1))[0]
      : input.requestId
        ? (
            await transferQuery
              .where(eq(schema.marketingFunding.sourceFundingRequestId, input.requestId))
              .limit(1)
          )[0]
        : undefined;

    // Resolve request (with requester + resolver names) — by id, or by transfer link.
    const requester = alias(schema.users, 'flow_request_requester');
    const resolver = alias(schema.users, 'flow_request_resolver');
    const requestQuery = this.db
      .select({
        id: schema.marketingFundingRequests.id,
        requesterId: schema.marketingFundingRequests.requesterId,
        requesterName: requester.name,
        requesterRole: requester.role,
        targetUserId: schema.marketingFundingRequests.targetUserId,
        amount: schema.marketingFundingRequests.amount,
        reason: schema.marketingFundingRequests.reason,
        status: schema.marketingFundingRequests.status,
        createdAt: schema.marketingFundingRequests.createdAt,
        resolvedAt: schema.marketingFundingRequests.resolvedAt,
        resolvedBy: schema.marketingFundingRequests.resolvedBy,
        resolvedByName: resolver.name,
        resolvedByRole: resolver.role,
      })
      .from(schema.marketingFundingRequests)
      .leftJoin(requester, eq(schema.marketingFundingRequests.requesterId, requester.id))
      .leftJoin(resolver, eq(schema.marketingFundingRequests.resolvedBy, resolver.id));

    const requestRow = input.requestId
      ? (
          await requestQuery.where(eq(schema.marketingFundingRequests.id, input.requestId)).limit(1)
        )[0]
      : transferRow?.sourceFundingRequestId
        ? (
            await requestQuery
              .where(eq(schema.marketingFundingRequests.id, transferRow.sourceFundingRequestId))
              .limit(1)
          )[0]
        : undefined;

    if (!requestRow && !transferRow) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Funding flow not found' });
    }

    // Permission gate (permission-first per CLAUDE.md / RBAC matrix):
    //   • SuperAdmin: only role allowed to bypass — short-circuit since their `permissions`
    //     array is intentionally empty (they short-circuit at `permissionProcedure`).
    //   • Parties to the flow (requester / target / sender / receiver) always see their own
    //     row — no extra permission needed since the data identifies them as the audience.
    //   • Anyone holding `marketing.funding.approve` (HoM / Finance / Admin templates) can
    //     view every funding flow in their scope — they're the people who'd be approving
    //     or reviewing it anyway.
    //   • Finance-hat (`finance.costView`) sees every flow for audit.
    // No other role checks — ADMIN goes through `marketing.funding.approve` like everyone else.
    if (actor.role !== 'SUPER_ADMIN') {
      const perms = actor.permissions ?? [];
      const canViewAllFlows =
        perms.includes('marketing.funding.approve') || perms.includes('finance.costView');
      const isParty =
        (transferRow &&
          (transferRow.senderId === actor.id || transferRow.receiverId === actor.id)) ||
        (requestRow &&
          (requestRow.requesterId === actor.id || requestRow.targetUserId === actor.id));
      if (!canViewAllFlows && !isParty) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this funding flow',
        });
      }
    }

    type FlowEvent = {
      kind: 'requested' | 'approved' | 'rejected' | 'sent' | 'received' | 'disputed';
      at: string;
      actorId: string | null;
      actorName: string | null;
      actorRole: string | null;
      note: string | null;
    };
    const events: FlowEvent[] = [];

    if (requestRow) {
      events.push({
        kind: 'requested',
        at: requestRow.createdAt.toISOString(),
        actorId: requestRow.requesterId,
        actorName: requestRow.requesterName ?? null,
        actorRole: requestRow.requesterRole ?? null,
        note: requestRow.reason ?? null,
      });
      if (requestRow.status === 'APPROVED' && requestRow.resolvedAt) {
        events.push({
          kind: 'approved',
          at: requestRow.resolvedAt.toISOString(),
          actorId: requestRow.resolvedBy ?? null,
          actorName: requestRow.resolvedByName ?? null,
          actorRole: requestRow.resolvedByRole ?? null,
          note: null,
        });
      } else if (requestRow.status === 'REJECTED' && requestRow.resolvedAt) {
        events.push({
          kind: 'rejected',
          at: requestRow.resolvedAt.toISOString(),
          actorId: requestRow.resolvedBy ?? null,
          actorName: requestRow.resolvedByName ?? null,
          actorRole: requestRow.resolvedByRole ?? null,
          note: null,
        });
      }
    }

    if (transferRow) {
      events.push({
        kind: 'sent',
        at: transferRow.sentAt.toISOString(),
        actorId: transferRow.senderId,
        actorName: transferRow.senderName ?? null,
        actorRole: transferRow.senderRole ?? null,
        note: transferRow.receiptUrl ? 'Receipt uploaded' : null,
      });
      if (transferRow.status === 'COMPLETED') {
        events.push({
          kind: 'received',
          at: (transferRow.verifiedAt ?? transferRow.sentAt).toISOString(),
          actorId: transferRow.receiverId,
          actorName: transferRow.receiverName ?? null,
          actorRole: transferRow.receiverRole ?? null,
          note: null,
        });
      } else if (transferRow.status === 'DISPUTED') {
        events.push({
          kind: 'disputed',
          at: (transferRow.verifiedAt ?? transferRow.sentAt).toISOString(),
          actorId: transferRow.receiverId,
          actorName: transferRow.receiverName ?? null,
          actorRole: transferRow.receiverRole ?? null,
          note: null,
        });
      }
    }

    events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    return {
      request: requestRow
        ? {
            id: requestRow.id,
            status: requestRow.status,
            amount: requestRow.amount,
            requesterId: requestRow.requesterId,
            requesterName: requestRow.requesterName ?? null,
            reason: requestRow.reason ?? null,
            createdAt: requestRow.createdAt.toISOString(),
            resolvedAt: requestRow.resolvedAt ? requestRow.resolvedAt.toISOString() : null,
          }
        : null,
      transfer: transferRow
        ? {
            id: transferRow.id,
            status: transferRow.status,
            amount: transferRow.amount,
            senderId: transferRow.senderId,
            senderName: transferRow.senderName ?? null,
            receiverId: transferRow.receiverId,
            receiverName: transferRow.receiverName ?? null,
            sentAt: transferRow.sentAt.toISOString(),
            verifiedAt: transferRow.verifiedAt ? transferRow.verifiedAt.toISOString() : null,
            receiptUrl: transferRow.receiptUrl ?? null,
            sourceFundingRequestId: transferRow.sourceFundingRequestId ?? null,
          }
        : null,
      events,
    };
  }

  // ============================================
  // Ad Spend Logs
  // ============================================

  async createAdSpend(input: CreateAdSpendInput, mediaBuyerId: string, branchId?: string | null) {
    return withActor(this.db, { id: mediaBuyerId }, async (tx) => {
      if (branchId && input.campaignId) {
        const [campaign] = await tx
          .select({ id: schema.campaigns.id })
          .from(schema.campaigns)
          .where(
            and(
              eq(schema.campaigns.id, input.campaignId),
              eq(schema.campaigns.branchId, branchId),
            ),
          )
          .limit(1);
        if (!campaign) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Campaign is not in your active branch',
          });
        }
      }

      // Screenshot is optional per CEO 2026-05 — empty string preserves the
      // column's NOT NULL constraint without a schema migration. status
      // defaults to PENDING in DB.
      const platform = input.platform ?? 'FACEBOOK';
      const category = input.category ?? 'AD_SPEND';
      const rows = await tx
        .insert(schema.adSpendLogs)
        .values({
          mediaBuyerId,
          productId: input.productId || null,
          campaignId: input.campaignId || null,
          spendAmount: sql`${String(input.spendAmount)}::numeric`,
          screenshotUrl: input.screenshotUrl ?? '',
          spendDate: new Date(input.spendDate),
          platform,
          platformCustomLabel:
            platform === 'OTHER' && input.platformCustomLabel ? input.platformCustomLabel : null,
          adUrl: input.adUrl ?? null,
          category,
          description: input.description ?? null,
        })
        .returning();

      const spend = rows[0];
      if (!spend) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log ad spend' });
      }
      return spend;
    });
  }

  /**
   * Multi-line "Add Expense" submission. Writes N ad_spend_logs rows in a single
   * `withActor` transaction, all sharing the same `spend_date`. HoM gets ONE
   * notification for the whole batch (not N).
   */
  async createAdSpendBatch(
    input: CreateAdSpendBatchInput,
    mediaBuyerId: string,
    branchId?: string | null,
  ) {
    if (input.lines.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one ad' });
    }
    // Branch fence: the single campaign must belong to the actor's active branch.
    if (branchId) {
      const [validCampaign] = await this.db
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .where(
          and(eq(schema.campaigns.id, input.campaignId), eq(schema.campaigns.branchId, branchId)),
        )
        .limit(1);
      if (!validCampaign) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Campaign is not in your active branch',
        });
      }
    }

    // CEO directive 2026-05-08: Media Buyer manually splits the campaign's
    // actual order count across the lines they're logging. Sum must equal the
    // system-computed count for (campaign, MB, spendDate window) — otherwise
    // we can't trust the per-line CPA.
    const snapshot = await this.getCampaignOrderTotalSnapshot({
      mediaBuyerId,
      campaignId: input.campaignId,
      spendDate: input.spendDate,
      branchId,
    });
    const totalSplit = input.lines.reduce(
      (acc, l) => acc + (Number.isFinite(l.attributedOrderCount) ? l.attributedOrderCount : 0),
      0,
    );
    if (totalSplit !== snapshot.orderCount) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Order split must total ${snapshot.orderCount} (the form's order count). Currently splits to ${totalSplit}.`,
      });
    }

    const spendDateAt = new Date(input.spendDate);
    const inserted = await withActor(this.db, { id: mediaBuyerId }, async (tx) => {
      return tx
        .insert(schema.adSpendLogs)
        .values(
          input.lines.map((line) => {
            const platform = line.platform ?? 'FACEBOOK';
            return {
              mediaBuyerId,
              productId: line.productId,
              campaignId: input.campaignId,
              spendAmount: sql`${String(line.spendAmount)}::numeric`,
              // Schema flips screenshot to optional (CEO 2026-05-10) but the
              // ad_spend_logs.screenshot_url column is still NOT NULL — coerce
              // missing values to '' so existing rows stay readable.
              screenshotUrl: line.screenshotUrl ?? '',
              spendDate: spendDateAt,
              platform,
              platformCustomLabel:
                platform === 'OTHER' && line.platformCustomLabel ? line.platformCustomLabel : null,
              adUrl: line.adUrl ?? null,
              attributedOrderCount: line.attributedOrderCount,
              category: line.category ?? 'AD_SPEND',
              description: line.description ?? null,
            };
          }),
        )
        .returning();
    });

    if (inserted.length !== input.lines.length) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to log ad spend batch',
      });
    }

    // One notification per batch — not per line. HoM should never wake up to
    // 12 push pings because someone logged a busy day.
    const total = input.lines.reduce((acc, l) => acc + l.spendAmount, 0);

    // Personalize the body with the submitter's name + campaign(s) so HoM
    // can scan and triage at a glance instead of clicking through. Falls
    // back to "A Media Buyer" / no campaign when lookups fail (notifications
    // must never block the write).
    const uniqueCampaignIds = [input.campaignId];
    const [mbRow, campaignRows] = await Promise.all([
      this.db
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, mediaBuyerId))
        .limit(1)
        .catch(() => []),
      uniqueCampaignIds.length > 0
        ? this.db
            .select({ name: schema.campaigns.name })
            .from(schema.campaigns)
            .where(inArray(schema.campaigns.id, uniqueCampaignIds))
            .catch(() => [])
        : Promise.resolve([]),
    ]);
    const mbName = mbRow[0]?.name?.trim() || 'A Media Buyer';
    const campaignNames = campaignRows.map((c) => c.name).filter(Boolean);
    const campaignSegment =
      campaignNames.length === 1
        ? ` on ${campaignNames[0]}`
        : campaignNames.length > 1
          ? ` across ${campaignNames.length} campaigns`
          : '';
    // Friendly date — "May 3, 2026" reads better than "2026-05-03". Parse the
    // YMD as local-date components so we don't shift across timezones.
    let dateLabel = input.spendDate;
    const parts = input.spendDate.split('-').map((p) => parseInt(p, 10));
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      const [y, m, d] = parts as [number, number, number];
      dateLabel = new Date(y, m - 1, d).toLocaleDateString('en-NG', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    const lineWord = input.lines.length === 1 ? 'ad' : 'ads';

    this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', {
      type: 'marketing:ad_spend_submitted',
      title: `${mbName} logged ad spend`,
      body: `${input.lines.length} ${lineWord} · ₦${total.toLocaleString()}${campaignSegment} · ${dateLabel}`,
      data: {
        mediaBuyerId,
        mediaBuyerName: mbName,
        spendDate: input.spendDate,
        count: input.lines.length,
        totalAmount: total,
        campaignIds: uniqueCampaignIds,
        campaignNames,
      },
    });

    return { count: inserted.length, total: String(total) };
  }

  private async assertMayApproveOrRejectAdSpend(
    actor: SessionUser,
    mediaBuyerId: string,
    campaignBranchId: string | null,
  ): Promise<void> {
    const perms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    if (perms.includes(canonicalPermissionCode('marketing.adSpend.approve'))) {
      return;
    }
    const sessionBranch = actor.currentBranchId ?? null;
    if (!sessionBranch || !campaignBranchId || sessionBranch !== campaignBranchId) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot moderate ad spend for this record.',
      });
    }
    const ok = await this.branchTeams.isMarketingSupervisorOf(actor.id, mediaBuyerId, sessionBranch);
    if (!ok) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot moderate ad spend for this record.',
      });
    }
  }

  /** Head of Marketing / SuperAdmin / branch marketing supervisor (supervisee rows only). */
  async approveAdSpend(adSpendId: string, actor: SessionUser) {
    const approverId = actor.id;
    // LEFT JOIN: new-flow rows have campaignId=NULL so innerJoin would miss them.
    const [joined] = await this.db
      .select({
        row: schema.adSpendLogs,
        campaignBranchId: schema.campaigns.branchId,
      })
      .from(schema.adSpendLogs)
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.adSpendLogs.campaignId))
      .where(eq(schema.adSpendLogs.id, adSpendId))
      .limit(1);

    if (!joined) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ad spend record not found' });
    }
    const existing = joined.row;
    if (existing.status !== 'PENDING') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only PENDING ad spend can be approved',
      });
    }

    // For new-flow (daily) rows without a campaign, derive branch from the MB's primary branch.
    let branchId = joined.campaignBranchId ?? null;
    if (!branchId) {
      const [mbRow] = await this.db
        .select({ primaryBranchId: schema.users.primaryBranchId })
        .from(schema.users)
        .where(eq(schema.users.id, existing.mediaBuyerId))
        .limit(1);
      branchId = mbRow?.primaryBranchId ?? null;
    }

    await this.assertMayApproveOrRejectAdSpend(actor, existing.mediaBuyerId, branchId);

    const updated = await withActor(this.db, { id: approverId }, async (tx) => {
      const [row] = await tx
        .update(schema.adSpendLogs)
        .set({
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: approverId,
          rejectionReason: null,
          rejectedAt: null,
          rejectedBy: null,
        })
        .where(eq(schema.adSpendLogs.id, adSpendId))
        .returning();
      return row;
    });

    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve ad spend' });
    }
    return updated;
  }

  /** Same gate as {@link approveAdSpend}. */
  async rejectAdSpend(adSpendId: string, reason: string | undefined, actor: SessionUser) {
    const rejectorId = actor.id;
    const [joined] = await this.db
      .select({
        row: schema.adSpendLogs,
        campaignBranchId: schema.campaigns.branchId,
      })
      .from(schema.adSpendLogs)
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.adSpendLogs.campaignId))
      .where(eq(schema.adSpendLogs.id, adSpendId))
      .limit(1);

    if (!joined) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ad spend record not found' });
    }
    const existing = joined.row;
    if (existing.status !== 'PENDING') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Only PENDING ad spend can be rejected',
      });
    }

    let branchId = joined.campaignBranchId ?? null;
    if (!branchId) {
      const [mbRow] = await this.db
        .select({ primaryBranchId: schema.users.primaryBranchId })
        .from(schema.users)
        .where(eq(schema.users.id, existing.mediaBuyerId))
        .limit(1);
      branchId = mbRow?.primaryBranchId ?? null;
    }

    await this.assertMayApproveOrRejectAdSpend(actor, existing.mediaBuyerId, branchId);

    const updated = await withActor(this.db, { id: rejectorId }, async (tx) => {
      const [row] = await tx
        .update(schema.adSpendLogs)
        .set({
          status: 'REJECTED',
          rejectionReason: reason?.trim() ? reason.trim() : null,
          rejectedAt: new Date(),
          rejectedBy: rejectorId,
          approvedAt: null,
          approvedBy: null,
        })
        .where(eq(schema.adSpendLogs.id, adSpendId))
        .returning();
      return row;
    });

    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to reject ad spend' });
    }
    return updated;
  }

  /**
   * Media Buyer (own rows) or Head of Marketing / admin-class: update PENDING or REJECTED log.
   * Resubmit from REJECTED clears rejection metadata and sets status back to PENDING.
   */
  async updateAdSpend(
    input: UpdateAdSpendInput,
    actor: { id: string; role: string; permissions?: string[] },
    branchId?: string | null,
  ) {
    const [existing] = await this.db
      .select()
      .from(schema.adSpendLogs)
      .where(eq(schema.adSpendLogs.id, input.adSpendId))
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ad spend record not found' });
    }

    // New daily-flow rows (productId IS NULL) allow editing even when APPROVED
    // (edit-after-lock → flips to PENDING for re-approval).
    const isDailyFlow = existing.productId === null;
    const allowedStatuses = isDailyFlow
      ? ['PENDING', 'REJECTED', 'APPROVED']
      : ['PENDING', 'REJECTED'];
    if (!allowedStatuses.includes(existing.status)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: isDailyFlow
          ? 'Cannot edit this ad spend record'
          : 'Only PENDING or REJECTED ad spend can be edited',
      });
    }

    const adSpendPerms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasSpendPerm = (code: string) =>
      actor.role === 'SUPER_ADMIN' || adSpendPerms.includes(canonicalPermissionCode(code));
    // Caller may update if they can submit ad spend (their own) or approve it (anyone's).
    const canSubmit = hasSpendPerm('marketing.adSpend');
    const canApprove = hasSpendPerm('marketing.adSpend.approve');
    if (!canSubmit && !canApprove) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to update ad spend' });
    }
    // Submitter without approve capability can only edit their own rows.
    if (!canApprove && existing.mediaBuyerId !== actor.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only edit your own ad spend' });
    }

    const nextCampaignId = input.campaignId ?? existing.campaignId;
    const nextProductId = input.productId ?? existing.productId;

    // Skip campaign/branch validation for daily-flow rows (no campaign).
    if (nextCampaignId) {
      const branchCampaignIds = await this.getBranchCampaignIds(branchId);
      if (branchCampaignIds && branchCampaignIds.length === 0) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'No campaigns in your active branch' });
      }
      if (branchCampaignIds && !branchCampaignIds.includes(nextCampaignId)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Campaign is not in your active branch' });
      }

      if (branchId) {
        const [campaign] = await this.db
          .select({ id: schema.campaigns.id })
          .from(schema.campaigns)
          .where(
            and(eq(schema.campaigns.id, nextCampaignId), eq(schema.campaigns.branchId, branchId)),
          )
          .limit(1);
        if (!campaign) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Campaign is not in your active branch',
          });
        }
      }
    }

    const needsStatusReset = existing.status === 'REJECTED' || existing.status === 'APPROVED';

    // For daily-flow updates, refresh the order count snapshot.
    let orderCountSnapshot: number | undefined;
    if (isDailyFlow) {
      const spendDateStr = input.spendDate ?? existing.spendDate.toISOString().slice(0, 10);
      orderCountSnapshot = await this.getOrderCountForDate(existing.mediaBuyerId, spendDateStr, branchId);
    }

    return withActor(this.db, { id: actor.id }, async (tx) => {
      const [row] = await tx
        .update(schema.adSpendLogs)
        .set({
          productId: nextProductId,
          campaignId: nextCampaignId,
          spendAmount: String(input.spendAmount),
          screenshotUrl: input.screenshotUrl,
          spendDate: input.spendDate ? new Date(input.spendDate) : existing.spendDate,
          ...(orderCountSnapshot !== undefined ? { orderCountSnapshot } : {}),
          ...(needsStatusReset
            ? {
                status: 'PENDING' as const,
                rejectionReason: null,
                rejectedAt: null,
                rejectedBy: null,
                approvedAt: null,
                approvedBy: null,
              }
            : {}),
        })
        .where(eq(schema.adSpendLogs.id, input.adSpendId))
        .returning();

      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update ad spend',
        });
      }
      return row;
    });
  }

  // ── Daily Ad Spend (Simplified Flow — 2026-05) ─────────────────────────────

  /** Count non-DELETED orders created on a single Nigeria-timezone day for this MB. */
  async getOrderCountForDate(
    mediaBuyerId: string,
    spendDate: string,
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
  ): Promise<number> {
    const dayStart = nigeriaDayStart(spendDate);
    const dayEnd = nigeriaDayEnd(spendDate);
    const conditions: SQL[] = [
      eq(schema.orders.mediaBuyerId, mediaBuyerId),
      sql`${schema.orders.status} != 'DELETED'`,
      gte(schema.orders.createdAt, dayStart),
      lte(schema.orders.createdAt, dayEnd),
    ];
    const bCond = branchScopeCondition(schema.orders.branchId, branchId, effectiveBranchIds);
    if (bCond) conditions.push(bCond);
    const [row] = await this.db.select({ c: count() }).from(schema.orders).where(and(...conditions));
    return Number(row?.c ?? 0);
  }

  /**
   * Returns order count + any existing daily-flow record for (MB, date).
   * Used by the frontend form to show order count and detect upsert vs create.
   */
  async getOrderCountForAdSpendDate(
    spendDate: string,
    mediaBuyerId: string,
    branchId?: string | null,
  ): Promise<{
    orderCount: number;
    existingRecord: { id: string; spendAmount: string; status: string; orderCountSnapshot: number | null } | null;
  }> {
    const orderCount = await this.getOrderCountForDate(mediaBuyerId, spendDate, branchId);
    const dayStart = nigeriaDayStart(spendDate);
    const dayEnd = nigeriaDayEnd(spendDate);
    const [existing] = await this.db
      .select({
        id: schema.adSpendLogs.id,
        spendAmount: schema.adSpendLogs.spendAmount,
        status: schema.adSpendLogs.status,
        orderCountSnapshot: schema.adSpendLogs.orderCountSnapshot,
      })
      .from(schema.adSpendLogs)
      .where(
        and(
          eq(schema.adSpendLogs.mediaBuyerId, mediaBuyerId),
          gte(schema.adSpendLogs.spendDate, dayStart),
          lte(schema.adSpendLogs.spendDate, dayEnd),
          isNull(schema.adSpendLogs.productId),
        ),
      )
      .limit(1);
    return { orderCount, existingRecord: existing ?? null };
  }

  /**
   * Simplified daily ad spend upsert.
   * - No existing record: creates a new PENDING row.
   * - Existing PENDING/REJECTED: updates spend + refreshes order count snapshot.
   * - Existing APPROVED: flips to PENDING (edit-after-lock), updates spend + snapshot.
   */
  async logDailyAdSpend(
    input: LogDailyAdSpendInput,
    actor: SessionUser,
    branchId?: string | null,
  ) {
    const mediaBuyerId = actor.id;
    const orderCount = await this.getOrderCountForDate(mediaBuyerId, input.spendDate, branchId);

    const dayStart = nigeriaDayStart(input.spendDate);
    const dayEnd = nigeriaDayEnd(input.spendDate);
    const [existing] = await this.db
      .select()
      .from(schema.adSpendLogs)
      .where(
        and(
          eq(schema.adSpendLogs.mediaBuyerId, mediaBuyerId),
          gte(schema.adSpendLogs.spendDate, dayStart),
          lte(schema.adSpendLogs.spendDate, dayEnd),
          isNull(schema.adSpendLogs.productId),
        ),
      )
      .limit(1);

    const cpa = orderCount > 0 ? Number(input.spendAmount) / orderCount : null;

    if (existing) {
      const wasApproved = existing.status === 'APPROVED';
      const wasRejected = existing.status === 'REJECTED';
      const row = await withActor(this.db, actor, async (tx) => {
        const [updated] = await tx
          .update(schema.adSpendLogs)
          .set({
            spendAmount: sql`${String(input.spendAmount)}::numeric`,
            orderCountSnapshot: orderCount,
            ...(wasApproved || wasRejected
              ? {
                  status: 'PENDING' as const,
                  approvedAt: null,
                  approvedBy: null,
                  rejectionReason: null,
                  rejectedAt: null,
                  rejectedBy: null,
                }
              : {}),
          })
          .where(eq(schema.adSpendLogs.id, existing.id))
          .returning();
        return updated;
      });

      if (wasApproved) {
        void this.notifyAdSpendReApprovalNeeded(actor, input.spendDate, branchId);
      }

      return { record: row!, orderCount, cpa, isUpdate: true };
    }

    // Insert new record
    const row = await withActor(this.db, actor, async (tx) => {
      const [inserted] = await tx
        .insert(schema.adSpendLogs)
        .values({
          mediaBuyerId,
          productId: null,
          campaignId: null,
          spendAmount: sql`${String(input.spendAmount)}::numeric`,
          screenshotUrl: null,
          spendDate: new Date(input.spendDate),
          platform: 'FACEBOOK',
          orderCountSnapshot: orderCount,
        })
        .returning();
      return inserted;
    });

    void this.notifyAdSpendSubmitted(actor, input.spendDate, input.spendAmount, branchId);

    return { record: row!, orderCount, cpa, isUpdate: false };
  }

  /** Notify HoM + branch supervisors that an MB submitted new daily spend. */
  private async notifyAdSpendSubmitted(
    actor: SessionUser,
    spendDate: string,
    spendAmount: number,
    branchId?: string | null,
  ): Promise<void> {
    const recipientIds = await this.getAdSpendApproverIds(actor.id, branchId);
    const formatted = new Date(spendDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
    for (const userId of recipientIds) {
      this.notifications.enqueueCreate({
        userId,
        type: 'marketing:ad_spend_submitted',
        title: 'Ad spend logged',
        body: `${actor.name ?? 'A media buyer'} logged ₦${Math.round(spendAmount).toLocaleString('en-NG')} spend for ${formatted}.`,
        data: { mediaBuyerId: actor.id },
      });
    }
  }

  /** Notify HoM + branch supervisors that an approved spend was edited (needs re-approval). */
  private async notifyAdSpendReApprovalNeeded(
    actor: SessionUser,
    spendDate: string,
    branchId?: string | null,
  ): Promise<void> {
    const recipientIds = await this.getAdSpendApproverIds(actor.id, branchId);
    const formatted = new Date(spendDate).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
    for (const userId of recipientIds) {
      this.notifications.enqueueCreate({
        userId,
        type: 'marketing:ad_spend_submitted',
        title: 'Ad spend edited — re-approval needed',
        body: `${actor.name ?? 'A media buyer'} updated approved spend for ${formatted}. Review under Ads Expense.`,
        data: { mediaBuyerId: actor.id },
      });
    }
  }

  /** Resolve approver user IDs for ad spend notifications (HoM + branch marketing supervisors). */
  private async getAdSpendApproverIds(excludeUserId: string, branchId?: string | null): Promise<string[]> {
    const ids = new Set<string>();
    const [admins, heads] = await Promise.all([
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.status, 'ACTIVE'), inArray(schema.users.role, ['SUPER_ADMIN', 'ADMIN']))),
      this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.status, 'ACTIVE'),
            eq(schema.users.role, 'HEAD_OF_MARKETING'),
            ...(branchId ? [eq(schema.users.primaryBranchId, branchId)] : []),
          ),
        ),
    ]);
    for (const r of [...admins, ...heads]) {
      if (r.id !== excludeUserId) ids.add(r.id);
    }
    return [...ids];
  }

  /**
   * Read-only preview for the Log Ad Spend form: orders (all statuses) for this buyer +
   * campaign + product with created_at after the UTC calendar day of the latest APPROVED
   * prior spend (strictly before spendDate), through now. Indicative CPA = spendAmount / count.
   */
  async previewAdSpendInterval(
    input: PreviewAdSpendIntervalInput,
    mediaBuyerId: string,
    branchId?: string | null,
  ) {
    if (branchId) {
      const [campaign] = await this.db
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .where(
          and(eq(schema.campaigns.id, input.campaignId), eq(schema.campaigns.branchId, branchId)),
        )
        .limit(1);
      if (!campaign) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Campaign is not in your active branch',
        });
      }
    }

    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return {
        orderCount: 0,
        priorSpendDate: null as string | null,
        windowStartExclusive: null as string | null,
        indicativeCpa: null as number | null,
      };
    }
    if (branchCampaignIds && !branchCampaignIds.includes(input.campaignId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Campaign is not in your active branch' });
    }

    return this.getAdSpendIntervalSnapshot({
      mediaBuyerId,
      campaignId: input.campaignId,
      productId: input.productId,
      spendDate: input.spendDate,
      spendAmount: input.spendAmount ?? 0,
      branchId,
      branchCampaignIds,
    });
  }

  /**
   * Public counterpart of `getCampaignOrderTotalSnapshot` — used by the new
   * Add Expense modal so the Media Buyer can see the campaign's actual order
   * count and split it across the lines they're logging.
   */
  async getCampaignOrderTotalForBatch(
    input: CampaignOrderTotalForBatchInput,
    mediaBuyerId: string,
    branchId?: string | null,
  ) {
    if (branchId) {
      const [campaign] = await this.db
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .where(
          and(eq(schema.campaigns.id, input.campaignId), eq(schema.campaigns.branchId, branchId)),
        )
        .limit(1);
      if (!campaign) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Campaign is not in your active branch',
        });
      }
    }

    return this.getCampaignOrderTotalSnapshot({
      mediaBuyerId,
      campaignId: input.campaignId,
      spendDate: input.spendDate,
      branchId,
    });
  }

  /**
   * All distinct mediaBuyerId values present in ad_spend_logs, optionally
   * scoped to a branch's campaigns (+ daily-flow NULL-campaign rows).
   * Used to backfill the filter dropdown with MBs no longer in the branch.
   */
  async distinctAdSpendMediaBuyerIds(branchId?: string | null): Promise<string[]> {
    const conditions: SQL[] = [];
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) return [];
    if (branchCampaignIds) {
      const branchOrDaily = or(
        inArray(schema.adSpendLogs.campaignId, branchCampaignIds),
        isNull(schema.adSpendLogs.campaignId),
      );
      if (branchOrDaily) conditions.push(branchOrDaily);
    }
    const rows = await this.db
      .selectDistinct({ mediaBuyerId: schema.adSpendLogs.mediaBuyerId })
      .from(schema.adSpendLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
    return rows.map((r) => r.mediaBuyerId);
  }

  async listAdSpend(input: ListAdSpendInput, branchId?: string | null) {
    const buyer = alias(schema.users, 'ad_spend_list_buyer');
    const prod = alias(schema.products, 'ad_spend_list_product');
    const camp = alias(schema.campaigns, 'ad_spend_list_campaign');

    const conditions: SQL[] = [];
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerId));
    }
    if (input.mediaBuyerIds && input.mediaBuyerIds.length > 0) {
      conditions.push(inArray(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerIds));
    } else if (input.mediaBuyerIds && input.mediaBuyerIds.length === 0) {
      return {
        records: [],
        totalSpend: '0',
        pagination: { page: input.page, limit: input.limit, total: 0 },
      };
    }
    if (input.productId) {
      conditions.push(eq(schema.adSpendLogs.productId, input.productId));
    }
    if (input.campaignId) {
      conditions.push(eq(schema.adSpendLogs.campaignId, input.campaignId));
    }
    if (input.status) {
      conditions.push(eq(schema.adSpendLogs.status, input.status));
    }
    if (input.category) {
      conditions.push(eq(schema.adSpendLogs.category, input.category));
    }
    if (input.startDate) {
      conditions.push(gte(schema.adSpendLogs.spendDate, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.adSpendLogs.spendDate, nigeriaDayEnd(input.endDate)));
    }
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return {
        records: [],
        totalSpend: '0',
        pagination: { page: input.page, limit: input.limit, total: 0 },
      };
    }
    if (branchCampaignIds) {
      // Daily-flow rows have campaignId=NULL — include them alongside branch-scoped legacy rows.
      const branchOrDaily = or(
        inArray(schema.adSpendLogs.campaignId, branchCampaignIds),
        isNull(schema.adSpendLogs.campaignId),
      );
      if (branchOrDaily) conditions.push(branchOrDaily);
    }
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      if (trimmedSearchLooksLikeUuid(searchTrimmed)) {
        conditions.push(eq(schema.adSpendLogs.id, searchTrimmed));
      } else {
        const searchOr = or(
          ilike(buyer.name, `%${searchTrimmed}%`),
          ilike(prod.name, `%${searchTrimmed}%`),
          ilike(camp.name, `%${searchTrimmed}%`),
          ilike(schema.adSpendLogs.platformCustomLabel, `%${searchTrimmed}%`),
        );
        if (searchOr) conditions.push(searchOr);
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [records, totalRows, totalSpendRows] = await Promise.all([
      this.db
        .select({ ...getTableColumns(schema.adSpendLogs) })
        .from(schema.adSpendLogs)
        .leftJoin(buyer, eq(schema.adSpendLogs.mediaBuyerId, buyer.id))
        .leftJoin(prod, eq(schema.adSpendLogs.productId, prod.id))
        .leftJoin(camp, eq(schema.adSpendLogs.campaignId, camp.id))
        .where(whereClause)
        .orderBy(desc(schema.adSpendLogs.spendDate))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.adSpendLogs)
        .leftJoin(buyer, eq(schema.adSpendLogs.mediaBuyerId, buyer.id))
        .leftJoin(prod, eq(schema.adSpendLogs.productId, prod.id))
        .leftJoin(camp, eq(schema.adSpendLogs.campaignId, camp.id))
        .where(whereClause),
      this.db
        .select({ total: sum(schema.adSpendLogs.spendAmount) })
        .from(schema.adSpendLogs)
        .leftJoin(buyer, eq(schema.adSpendLogs.mediaBuyerId, buyer.id))
        .leftJoin(prod, eq(schema.adSpendLogs.productId, prod.id))
        .leftJoin(camp, eq(schema.adSpendLogs.campaignId, camp.id))
        .where(whereClause),
    ]);

    // Only enrich legacy rows (campaignId + productId set) with interval snapshots.
    // Daily-flow rows (productId IS NULL) already carry orderCountSnapshot.
    const legacyRecords = records.filter((r) => r.campaignId && r.productId);
    const snapshotKeys = legacyRecords.map((r) => ({
      mediaBuyerId: r.mediaBuyerId,
      campaignId: r.campaignId!,
      productId: r.productId!,
      spendYmd: this.spendDateToYmd(r.spendDate),
      spendAmount: Number(r.spendAmount),
    }));
    const snapshotMap = legacyRecords.length > 0
      ? await this.batchAdSpendIntervalSnapshots(snapshotKeys, branchCampaignIds, branchId)
      : new Map<string, { orderCount: number; indicativeCpa: number | null }>();
    const enriched = records.map((r) => {
      // Daily-flow rows use the frozen snapshot from the row itself.
      if (!r.campaignId || !r.productId) {
        const oc = r.orderCountSnapshot ?? 0;
        const spend = Number(r.spendAmount);
        return {
          ...r,
          orderCount: oc,
          indicativeCpa: oc > 0 ? spend / oc : null,
        };
      }
      const spendYmd = this.spendDateToYmd(r.spendDate);
      const sk = this.adSpendLineSnapshotKey(r.mediaBuyerId, r.campaignId, r.productId, spendYmd);
      const snap = snapshotMap.get(sk) ?? {
        orderCount: 0,
        indicativeCpa: null,
      };
      return { ...r, orderCount: snap.orderCount, indicativeCpa: snap.indicativeCpa };
    });

    return {
      records: enriched,
      totalSpend: totalSpendRows[0]?.total ?? '0',
      pagination: { page: input.page, limit: input.limit, total: Number(totalRows[0]?.count ?? 0) },
    };
  }

  /**
   * Returns ad spend records grouped by `(spend_date, media_buyer_id)` for the
   * accordion UI on /admin/marketing/ad-spend. Each group rolls up to a single
   * accordion row showing total + line count + status.
   *
   * Rolled-up status semantics:
   *  - 'APPROVED' if every line is APPROVED
   *  - 'REJECTED' if every line is REJECTED
   *  - 'MIXED'    if both APPROVED and REJECTED appear and no PENDING
   *  - 'PENDING'  if any line is PENDING
   */
  async listAdSpendGrouped(input: ListAdSpendGroupedInput, branchId?: string | null) {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(50, Math.max(1, input.limit ?? 20));

    const buyer = alias(schema.users, 'ad_spend_grouped_buyer');
    const prod = alias(schema.products, 'ad_spend_grouped_product');
    const camp = alias(schema.campaigns, 'ad_spend_grouped_campaign');

    const conditions: SQL[] = [];
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerId));
    }
    if (input.mediaBuyerIds && input.mediaBuyerIds.length > 0) {
      conditions.push(inArray(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerIds));
    } else if (input.mediaBuyerIds && input.mediaBuyerIds.length === 0) {
      return {
        groups: [],
        pagination: { page, limit, total: 0 },
      };
    }
    if (input.productId) {
      conditions.push(eq(schema.adSpendLogs.productId, input.productId));
    }
    if (input.campaignId) {
      conditions.push(eq(schema.adSpendLogs.campaignId, input.campaignId));
    }
    if (input.status) {
      conditions.push(eq(schema.adSpendLogs.status, input.status));
    }
    if (input.category) {
      conditions.push(eq(schema.adSpendLogs.category, input.category));
    }
    if (input.startDate) {
      conditions.push(gte(schema.adSpendLogs.spendDate, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.adSpendLogs.spendDate, nigeriaDayEnd(input.endDate)));
    }
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return {
        groups: [],
        pagination: { page, limit, total: 0 },
      };
    }
    if (branchCampaignIds) {
      const branchOrDaily = or(
        inArray(schema.adSpendLogs.campaignId, branchCampaignIds),
        isNull(schema.adSpendLogs.campaignId),
      );
      if (branchOrDaily) conditions.push(branchOrDaily);
    }
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      if (trimmedSearchLooksLikeUuid(searchTrimmed)) {
        conditions.push(eq(schema.adSpendLogs.id, searchTrimmed));
      } else {
        const searchOr = or(
          ilike(buyer.name, `%${searchTrimmed}%`),
          ilike(prod.name, `%${searchTrimmed}%`),
          ilike(camp.name, `%${searchTrimmed}%`),
          ilike(schema.adSpendLogs.platformCustomLabel, `%${searchTrimmed}%`),
        );
        if (searchOr) conditions.push(searchOr);
      }
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const spendDayUtc = sql`(${schema.adSpendLogs.spendDate} AT TIME ZONE 'UTC')::date`;

    const groupedFrom = this.db
      .select({
        spendDay: sql<string>`${spendDayUtc}`.mapWith(String),
        mediaBuyerId: schema.adSpendLogs.mediaBuyerId,
      })
      .from(schema.adSpendLogs)
      .leftJoin(buyer, eq(schema.adSpendLogs.mediaBuyerId, buyer.id))
      .leftJoin(prod, eq(schema.adSpendLogs.productId, prod.id))
      .leftJoin(camp, eq(schema.adSpendLogs.campaignId, camp.id))
      .where(whereClause)
      .groupBy(spendDayUtc, schema.adSpendLogs.mediaBuyerId)
      .as('ad_spend_group_keys');

    const [totalRow] = await this.db.select({ c: count() }).from(groupedFrom);
    const total = Number(totalRow?.c ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageSafe = Math.min(Math.max(1, page), totalPages);
    const start = (pageSafe - 1) * limit;

    const pageGroupRows = await this.db
      .select({
        spendDay: sql<string>`${spendDayUtc}`.mapWith(String),
        mediaBuyerId: schema.adSpendLogs.mediaBuyerId,
        mediaBuyerName: sql<string>`MAX(${buyer.name})`.mapWith(String),
        lineCount: count(),
        totalAmount: sum(schema.adSpendLogs.spendAmount),
        pendingLines:
          sql<number>`COALESCE(SUM(CASE WHEN ${schema.adSpendLogs.status} = 'PENDING' THEN 1 ELSE 0 END), 0)::int`.mapWith(
            Number,
          ),
        approvedLines:
          sql<number>`COALESCE(SUM(CASE WHEN ${schema.adSpendLogs.status} = 'APPROVED' THEN 1 ELSE 0 END), 0)::int`.mapWith(
            Number,
          ),
        rejectedLines:
          sql<number>`COALESCE(SUM(CASE WHEN ${schema.adSpendLogs.status} = 'REJECTED' THEN 1 ELSE 0 END), 0)::int`.mapWith(
            Number,
          ),
      })
      .from(schema.adSpendLogs)
      .leftJoin(buyer, eq(schema.adSpendLogs.mediaBuyerId, buyer.id))
      .leftJoin(prod, eq(schema.adSpendLogs.productId, prod.id))
      .leftJoin(camp, eq(schema.adSpendLogs.campaignId, camp.id))
      .where(whereClause)
      .groupBy(spendDayUtc, schema.adSpendLogs.mediaBuyerId)
      .orderBy(desc(spendDayUtc), sql`MAX(${buyer.name})`)
      .limit(limit)
      .offset(start);

    if (pageGroupRows.length === 0) {
      return {
        groups: [],
        pagination: { page: pageSafe, limit, total },
      };
    }

    const tupleOrParts = pageGroupRows.map((g) =>
      and(
        eq(schema.adSpendLogs.mediaBuyerId, g.mediaBuyerId),
        sql`${spendDayUtc} = ${g.spendDay}::date`,
      ),
    );
    const tupleOr: SQL | undefined =
      tupleOrParts.length === 0
        ? undefined
        : tupleOrParts.length === 1
          ? tupleOrParts[0]
          : or(...(tupleOrParts as [SQL, ...SQL[]]));
    const lineWhere =
      tupleOr == null ? whereClause : whereClause ? and(whereClause, tupleOr) : tupleOr;

    type LineRow = {
      id: string;
      mediaBuyerId: string;
      mediaBuyerName: string | null;
      productId: string;
      productName: string | null;
      campaignId: string;
      campaignName: string | null;
      spendAmount: string;
      screenshotUrl: string;
      adUrl: string | null;
      platform: string;
      platformCustomLabel: string | null;
      spendDate: Date;
      status: string;
      rejectionReason: string | null;
      approvedAt: Date | null;
      rejectedAt: Date | null;
      createdAt: Date;
    };

    const lineRows = await this.db
      .select({
        id: schema.adSpendLogs.id,
        mediaBuyerId: schema.adSpendLogs.mediaBuyerId,
        mediaBuyerName: buyer.name,
        productId: schema.adSpendLogs.productId,
        productName: prod.name,
        campaignId: schema.adSpendLogs.campaignId,
        campaignName: camp.name,
        spendAmount: schema.adSpendLogs.spendAmount,
        screenshotUrl: schema.adSpendLogs.screenshotUrl,
        adUrl: schema.adSpendLogs.adUrl,
        platform: schema.adSpendLogs.platform,
        platformCustomLabel: schema.adSpendLogs.platformCustomLabel,
        spendDate: schema.adSpendLogs.spendDate,
        status: schema.adSpendLogs.status,
        rejectionReason: schema.adSpendLogs.rejectionReason,
        approvedAt: schema.adSpendLogs.approvedAt,
        rejectedAt: schema.adSpendLogs.rejectedAt,
        createdAt: schema.adSpendLogs.createdAt,
      })
      .from(schema.adSpendLogs)
      .leftJoin(buyer, eq(schema.adSpendLogs.mediaBuyerId, buyer.id))
      .leftJoin(prod, eq(schema.adSpendLogs.productId, prod.id))
      .leftJoin(camp, eq(schema.adSpendLogs.campaignId, camp.id))
      .where(lineWhere)
      .orderBy(desc(schema.adSpendLogs.spendDate));

    const linesByGroup = new Map<string, LineRow[]>();
    for (const row of lineRows) {
      const ymd = this.spendDateToYmd(row.spendDate);
      const gk = `${ymd}::${row.mediaBuyerId}`;
      const arr = linesByGroup.get(gk) ?? [];
      arr.push(row as LineRow);
      linesByGroup.set(gk, arr);
    }

    // Only legacy rows (with campaignId + productId) need interval snapshot enrichment.
    const snapshotInputs: Array<{
      mediaBuyerId: string;
      campaignId: string;
      productId: string;
      spendYmd: string;
      spendAmount: number;
    }> = [];
    for (const row of lineRows) {
      if (row.campaignId && row.productId) {
        snapshotInputs.push({
          mediaBuyerId: row.mediaBuyerId,
          campaignId: row.campaignId,
          productId: row.productId,
          spendYmd: this.spendDateToYmd(row.spendDate),
          spendAmount: Number(row.spendAmount),
        });
      }
    }
    const snapshotMap = snapshotInputs.length > 0 ? await this.batchAdSpendIntervalSnapshots(
      snapshotInputs,
      branchCampaignIds,
      branchId,
    ) : new Map<string, { orderCount: number; indicativeCpa: number | null }>();

    // One grouped query for every (mediaBuyerId, UTC-day) pair on the page
    // instead of N COUNT round-trips. Keyed `${spendDay}::${mediaBuyerId}`.
    const overallCounts = await this.countOrdersForMediaBuyersOnUtcDays({
      pairs: pageGroupRows.map((g) => ({
        mediaBuyerId: g.mediaBuyerId,
        spendDateYmd: g.spendDay,
      })),
      branchId,
    });

    const groups = pageGroupRows.map((g) => {
      let rolledStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MIXED';
      if (g.pendingLines > 0) rolledStatus = 'PENDING';
      else if (g.approvedLines === g.lineCount) rolledStatus = 'APPROVED';
      else if (g.rejectedLines === g.lineCount) rolledStatus = 'REJECTED';
      else rolledStatus = 'MIXED';

      const gKey = `${g.spendDay}::${g.mediaBuyerId}`;
      const rawLines = linesByGroup.get(gKey) ?? [];
      const overallOrderCount = overallCounts.get(gKey) ?? 0;
      const totalAmt = Number(g.totalAmount);
      const overallCpa = overallOrderCount > 0 ? totalAmt / overallOrderCount : null;

      const lines = rawLines.map((line) => {
        // Daily-flow rows use frozen snapshot; legacy rows use interval calc.
        if (!line.campaignId || !line.productId) {
          const oc = (line as { orderCountSnapshot?: number | null }).orderCountSnapshot ?? 0;
          const spend = Number(line.spendAmount);
          return {
            ...line,
            orderCount: oc,
            indicativeCpa: oc > 0 ? spend / oc : null,
          } as typeof line & { orderCount: number; indicativeCpa: number | null };
        }
        const spendYmd = this.spendDateToYmd(line.spendDate);
        const sk = this.adSpendLineSnapshotKey(
          line.mediaBuyerId,
          line.campaignId,
          line.productId,
          spendYmd,
        );
        const snap = snapshotMap.get(sk) ?? { orderCount: 0, indicativeCpa: null };
        return {
          ...line,
          spendDate: spendYmd,
          approvedAt:
            line.approvedAt == null
              ? null
              : line.approvedAt instanceof Date
                ? line.approvedAt.toISOString()
                : line.approvedAt,
          rejectedAt:
            line.rejectedAt == null
              ? null
              : line.rejectedAt instanceof Date
                ? line.rejectedAt.toISOString()
                : line.rejectedAt,
          createdAt: line.createdAt instanceof Date ? line.createdAt.toISOString() : line.createdAt,
          orderCount: snap.orderCount,
          indicativeCpa: snap.indicativeCpa,
        };
      });

      return {
        spendDate: g.spendDay,
        mediaBuyerId: g.mediaBuyerId,
        mediaBuyerName: g.mediaBuyerName,
        lineCount: g.lineCount,
        totalAmount: String(g.totalAmount ?? '0'),
        rolledStatus,
        overallOrderCount,
        overallCpa,
        lines,
      };
    });

    return {
      groups,
      pagination: { page: pageSafe, limit, total },
    };
  }

  async adSpendStatusCounts(input: AdSpendStatusCountsInput, branchId?: string | null) {
    const buyer = alias(schema.users, 'ad_spend_cnt_buyer');
    const prod = alias(schema.products, 'ad_spend_cnt_product');
    const camp = alias(schema.campaigns, 'ad_spend_cnt_campaign');

    const conditions: SQL[] = [];
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerId));
    }
    if (input.mediaBuyerIds && input.mediaBuyerIds.length > 0) {
      conditions.push(inArray(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerIds));
    } else if (input.mediaBuyerIds && input.mediaBuyerIds.length === 0) {
      return { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    }
    if (input.productId) {
      conditions.push(eq(schema.adSpendLogs.productId, input.productId));
    }
    if (input.campaignId) {
      conditions.push(eq(schema.adSpendLogs.campaignId, input.campaignId));
    }
    if (input.category) {
      conditions.push(eq(schema.adSpendLogs.category, input.category));
    }
    if (input.startDate) {
      conditions.push(gte(schema.adSpendLogs.spendDate, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.adSpendLogs.spendDate, nigeriaDayEnd(input.endDate)));
    }
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    }
    if (branchCampaignIds) {
      const branchOrDaily = or(
        inArray(schema.adSpendLogs.campaignId, branchCampaignIds),
        isNull(schema.adSpendLogs.campaignId),
      );
      if (branchOrDaily) conditions.push(branchOrDaily);
    }
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      if (trimmedSearchLooksLikeUuid(searchTrimmed)) {
        conditions.push(eq(schema.adSpendLogs.id, searchTrimmed));
      } else {
        const searchOr = or(
          ilike(buyer.name, `%${searchTrimmed}%`),
          ilike(prod.name, `%${searchTrimmed}%`),
          ilike(camp.name, `%${searchTrimmed}%`),
        );
        if (searchOr) conditions.push(searchOr);
      }
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await this.db
      .select({
        status: schema.adSpendLogs.status,
        c: count(),
      })
      .from(schema.adSpendLogs)
      .leftJoin(buyer, eq(schema.adSpendLogs.mediaBuyerId, buyer.id))
      .leftJoin(prod, eq(schema.adSpendLogs.productId, prod.id))
      .leftJoin(camp, eq(schema.adSpendLogs.campaignId, camp.id))
      .where(whereClause)
      .groupBy(schema.adSpendLogs.status);

    const out = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    for (const r of rows) {
      const n = Number(r.c);
      if (r.status === 'PENDING') out.PENDING = n;
      else if (r.status === 'APPROVED') out.APPROVED = n;
      else if (r.status === 'REJECTED') out.REJECTED = n;
      out.ALL += n;
    }
    return out;
  }

  async getPerformanceMetrics(
    mediaBuyerId?: string,
    period: 'this_month' | 'all_time' = 'this_month',
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    assignedCsId?: string,
    supervisorScope?: OrdersAggregateSupervisorScope,
    effectiveBranchIds?: string[] | null,
  ) {
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (startDate && endDate) {
      periodStart = nigeriaDayStart(startDate);
      periodEnd = nigeriaDayEnd(endDate);
    } else if (period === 'this_month') {
      periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }

    const spendConditions: Parameters<typeof and>[0][] = [
      eq(schema.adSpendLogs.status, 'APPROVED'),
      // Only AD_SPEND rows count toward CPA/ROAS — other categories (recruitment,
      // WhatsApp, UGC) deduct from balance but don't affect performance metrics.
      eq(schema.adSpendLogs.category, 'AD_SPEND'),
    ];
    // Same scope but for PENDING spend (stat strip breakdown).
    const pendingSpendConditions: Parameters<typeof and>[0][] = [
      eq(schema.adSpendLogs.status, 'PENDING'),
      eq(schema.adSpendLogs.category, 'AD_SPEND'),
    ];
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return {
        totalSpend: 0,
        pendingSpend: 0,
        approvedSpend: 0,
        totalOrders: 0,
        deliveredOrders: 0,
        deliveredRevenue: 0,
        confirmedOrders: 0,
        confirmationRate: 0,
        cpa: 0,
        trueRoas: 0,
        deliveryRate: 0,
      };
    }
    // Helper: push the same scope condition into both spend arrays.
    const pushSpendScope = (cond: Parameters<typeof and>[0]) => {
      spendConditions.push(cond);
      pendingSpendConditions.push(cond);
    };
    if (mediaBuyerId) pushSpendScope(eq(schema.adSpendLogs.mediaBuyerId, mediaBuyerId));
    if (branchCampaignIds) {
      const branchOrDailySpend = or(
        inArray(schema.adSpendLogs.campaignId, branchCampaignIds),
        isNull(schema.adSpendLogs.campaignId),
      );
      if (branchOrDailySpend) pushSpendScope(branchOrDailySpend);
    }
    if (
      supervisorScope &&
      !mediaBuyerId &&
      supervisorScope.mediaBuyerIds &&
      supervisorScope.mediaBuyerIds.length > 0
    ) {
      pushSpendScope(inArray(schema.adSpendLogs.mediaBuyerId, supervisorScope.mediaBuyerIds));
    }
    if (periodStart) {
      pushSpendScope(gte(schema.adSpendLogs.spendDate, periodStart));
    }
    if (periodEnd) {
      pushSpendScope(lte(schema.adSpendLogs.spendDate, periodEnd));
    }
    const spendWhere = and(...spendConditions);
    const pendingSpendWhere = and(...pendingSpendConditions);

    /** Same ownership semantics as `orders.list` / `getStatusCounts` (supervisor OR replaces single-ID filters). */
    const appendMetricsOrderScope = (conditions: Parameters<typeof and>[0][]) => {
      if (supervisorScope) {
        appendOrdersAggregateScopeConditions(conditions, { supervisorScope });
      } else {
        if (mediaBuyerId) conditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
        if (assignedCsId) conditions.push(eq(schema.orders.assignedCsId, assignedCsId));
      }
      // Branch-scope the orders side whenever a branch is in play — matches the
      // spend side above (which filters by `branchCampaignIds` regardless of
      // mediaBuyerId). Callers that want an org-wide result for one buyer (the
      // team-analysis drill) already pass `branchId = null`, so a non-null
      // branchId here always means "scope to this branch" — including for a
      // Media Buyer viewing their own metrics after switching branches.
      const bCond = branchScopeCondition(schema.orders.branchId, branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    };

    const orderConditions: Parameters<typeof and>[0][] = [
      // Exclude DELETED orders (editorial) from all marketing metrics.
      // CART is a synthetic frontend status — never exists in the orders table.
      sql`${schema.orders.status} != 'DELETED'`,
      eq(schema.orders.isFollowUp, false),
    ];
    appendMetricsOrderScope(orderConditions);
    if (periodStart) orderConditions.push(gte(schema.orders.createdAt, periodStart));
    if (periodEnd) orderConditions.push(lte(schema.orders.createdAt, periodEnd));
    const orderWhere =
      orderConditions.length > 0
        ? and(...orderConditions)
        : mediaBuyerId
          ? eq(schema.orders.mediaBuyerId, mediaBuyerId)
          : assignedCsId
            ? eq(schema.orders.assignedCsId, assignedCsId)
            : undefined;

    const deliveredConditions: Parameters<typeof and>[0][] = [
      inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
      eq(schema.orders.isFollowUp, false),
    ];
    appendMetricsOrderScope(deliveredConditions);
    // Cohort semantics: count orders **created** in period that have since
    // reached DELIVERED/REMITTED. Using `deliveredAt` here while
    // `confirmedOrders` below uses `createdAt` produced delivery rates > 100%
    // when orders from a prior period got delivered in the current one.
    if (periodStart) deliveredConditions.push(gte(schema.orders.createdAt, periodStart));
    if (periodEnd) deliveredConditions.push(lte(schema.orders.createdAt, periodEnd));
    const deliveredWhere = and(...deliveredConditions);

    // Orders that CS have scheduled (reached CONFIRMED or beyond)
    const confirmedStatuses = [
      'CONFIRMED',
      'AGENT_ASSIGNED',
      'DISPATCHED',
      'IN_TRANSIT',
      'DELIVERED',
      'PARTIALLY_DELIVERED',
      'RETURNED',
      'RESTOCKED',
      'WRITTEN_OFF',
      'REMITTED',
    ] as const;
    const confirmedConditions: Parameters<typeof and>[0][] = [
      inArray(schema.orders.status, [...confirmedStatuses]),
      eq(schema.orders.isFollowUp, false),
    ];
    appendMetricsOrderScope(confirmedConditions);
    if (periodStart) confirmedConditions.push(gte(schema.orders.createdAt, periodStart));
    if (periodEnd) confirmedConditions.push(lte(schema.orders.createdAt, periodEnd));
    const confirmedWhere = and(...confirmedConditions);

    const [
      totalSpendRows,
      pendingSpendRows,
      totalOrdersRows,
      deliveredOrdersRows,
      deliveredRevenueRows,
      confirmedOrdersRows,
    ] = await Promise.all([
      this.db
        .select({ total: sum(schema.adSpendLogs.spendAmount) })
        .from(schema.adSpendLogs)
        .where(spendWhere),
      this.db
        .select({ total: sum(schema.adSpendLogs.spendAmount) })
        .from(schema.adSpendLogs)
        .where(pendingSpendWhere),
      this.db.select({ count: count() }).from(schema.orders).where(orderWhere),
      this.db.select({ count: count() }).from(schema.orders).where(deliveredWhere),
      this.db
        .select({ total: sum(schema.orders.totalAmount) })
        .from(schema.orders)
        .where(deliveredWhere),
      this.db.select({ count: count() }).from(schema.orders).where(confirmedWhere),
    ]);

    const approvedSpend = Number(totalSpendRows[0]?.total ?? 0);
    const pendingSpend = Number(pendingSpendRows[0]?.total ?? 0);
    const totalSpend = approvedSpend + pendingSpend;
    const totalOrders = totalOrdersRows[0]?.count ?? 0;
    const deliveredOrders = deliveredOrdersRows[0]?.count ?? 0;
    const deliveredRevenue = Number(deliveredRevenueRows[0]?.total ?? 0);
    const confirmedOrders = confirmedOrdersRows[0]?.count ?? 0;
    const confirmationRate = totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : 0;

    return {
      totalSpend,
      pendingSpend,
      approvedSpend,
      totalOrders,
      deliveredOrders,
      deliveredRevenue,
      confirmedOrders,
      confirmationRate,
      cpa: totalOrders > 0 ? totalSpend / totalOrders : 0,
      trueRoas: totalSpend > 0 ? deliveredRevenue / totalSpend : 0,
      // DR = delivered cohort / total cohort (DELETED-excluded) — same
      // denominator as CR so the two read as a funnel: of every N orders
      // taken in period, X% reached confirmed-or-beyond and Y% delivered.
      // (The conditional rate delivered/confirmed lives on the CS Closer
      // leaderboard's `engaged` denominator, which is also total.)
      deliveryRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0,
    };
  }

  // ============================================
  // Media Buyer Leaderboard & CPA Alerts
  // ============================================

  /**
   * Order statuses that count as "confirmed or beyond" — orders the Sales team has
   * scheduled (got past CS_ENGAGED). Used for the confirmation-rate KPI.
   */
  private static readonly CONFIRMED_OR_BEYOND_STATUSES = [
    'CONFIRMED',
    'AGENT_ASSIGNED',
    'DISPATCHED',
    'IN_TRANSIT',
    'DELIVERED',
    'PARTIALLY_DELIVERED',
    'RETURNED',
    'RESTOCKED',
    'WRITTEN_OFF',
    'REMITTED',
  ] as const;

  /** Derive ratio metrics (CPA, true ROAS, delivery/confirmation rate) from raw counts. */
  private deriveBuyerMetrics(raw: {
    totalSpend: number;
    totalOrders: number;
    deliveredOrders: number;
    deliveredRevenue: number;
    confirmedOrders: number;
  }) {
    const { totalSpend, totalOrders, deliveredOrders, deliveredRevenue, confirmedOrders } = raw;
    return {
      totalSpend,
      totalOrders,
      deliveredOrders,
      deliveredRevenue,
      confirmedOrders,
      confirmationRate: totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : 0,
      cpa: totalOrders > 0 ? totalSpend / totalOrders : 0,
      trueRoas: totalSpend > 0 ? deliveredRevenue / totalSpend : 0,
      // DR = delivered / total — same funnel denominator as CR (see
      // getPerformanceMetrics for full rationale).
      deliveryRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0,
    };
  }

  /**
   * Batched performance metrics for many media buyers in a single round-trip.
   * Replaces the N+1 fanout in `getMediaBuyerLeaderboard` (was 5 queries × N
   * buyers; now 2 grouped queries regardless of N). Use this whenever you need
   * metrics for a list of buyers; `getPerformanceMetrics(buyerId)` stays for
   * single-buyer call sites.
   *
   * Returns a Map keyed by `buyerId`. Every buyer in `buyerIds` gets an entry;
   * buyers with zero spend AND zero orders return zero metrics so the caller
   * doesn't have to special-case "buyer not in result".
   *
   * Date scoping mirrors `getPerformanceMetrics`:
   *   - `total_spend` filtered by `spend_date` (in WHERE for index selectivity)
   *   - `total_orders` / `confirmed_orders` filtered by `created_at` (FILTER clause)
   *   - `delivered_orders` / `delivered_revenue` filtered by `delivered_at` (FILTER clause)
   * Two date columns on the same table → FILTER clauses instead of split queries.
   */
  async getPerformanceMetricsBatched(
    buyerIds: string[],
    period: 'this_month' | 'all_time' = 'this_month',
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
  ): Promise<Map<string, ReturnType<MarketingService['deriveBuyerMetrics']>>> {
    if (buyerIds.length === 0) return new Map();

    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (startDate && endDate) {
      periodStart = nigeriaDayStart(startDate);
      periodEnd = nigeriaDayEnd(endDate);
    } else if (period === 'this_month') {
      periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }

    // If the branch has no campaigns, no buyer can have spend on branch campaigns —
    // mirror the early-return semantics of the single-buyer version.
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      const zero = this.deriveBuyerMetrics({
        totalSpend: 0,
        totalOrders: 0,
        deliveredOrders: 0,
        deliveredRevenue: 0,
        confirmedOrders: 0,
      });
      return new Map(buyerIds.map((id) => [id, zero]));
    }

    // Spend conditions (date in WHERE — single index path on `spend_date`).
    // Only AD_SPEND category rows feed into CPA/ROAS (other categories deduct from balance only).
    const spendConditions: SQL[] = [
      eq(schema.adSpendLogs.status, 'APPROVED'),
      eq(schema.adSpendLogs.category, 'AD_SPEND'),
      inArray(schema.adSpendLogs.mediaBuyerId, buyerIds),
    ];
    if (branchCampaignIds) {
      const branchOrDailySpend = or(
        inArray(schema.adSpendLogs.campaignId, branchCampaignIds),
        isNull(schema.adSpendLogs.campaignId),
      );
      if (branchOrDailySpend) spendConditions.push(branchOrDailySpend);
    }
    if (periodStart) spendConditions.push(gte(schema.adSpendLogs.spendDate, periodStart));
    if (periodEnd) spendConditions.push(lte(schema.adSpendLogs.spendDate, periodEnd));

    // Per-metric date conditions for the orders FILTER clauses. Note: the spread
    // expression returns `SQL` not `SQL | undefined`, but `and(...empty)` returns
    // undefined — `?? sql\`true\`` keeps the FILTER tautologically valid when no
    // date scope is provided (period === 'all_time' with no explicit dates).
    // Both confirmed and delivered counts filter by `createdAt` so DR stays
    // ≤ 100% (no cross-period leakage when an old order delivers in this one).
    const inCreatedPeriod: SQL[] = [];
    if (periodStart) inCreatedPeriod.push(gte(schema.orders.createdAt, periodStart));
    if (periodEnd) inCreatedPeriod.push(lte(schema.orders.createdAt, periodEnd));

    const isDelivered = inArray(schema.orders.status, ['DELIVERED', 'REMITTED']);
    const isConfirmedOrBeyond = inArray(schema.orders.status, [
      ...MarketingService.CONFIRMED_OR_BEYOND_STATUSES,
    ]);

    const totalOrdersFilter =
      inCreatedPeriod.length > 0 ? (and(...inCreatedPeriod) ?? sql`true`) : sql`true`;
    const confirmedOrdersFilter =
      inCreatedPeriod.length > 0
        ? (and(isConfirmedOrBeyond, ...inCreatedPeriod) ?? isConfirmedOrBeyond)
        : isConfirmedOrBeyond;
    const deliveredFilter =
      inCreatedPeriod.length > 0
        ? (and(isDelivered, ...inCreatedPeriod) ?? isDelivered)
        : isDelivered;

    const [spendRows, orderRows] = await Promise.all([
      this.db
        .select({
          mediaBuyerId: schema.adSpendLogs.mediaBuyerId,
          totalSpend: sum(schema.adSpendLogs.spendAmount).mapWith(Number),
        })
        .from(schema.adSpendLogs)
        .where(and(...spendConditions))
        .groupBy(schema.adSpendLogs.mediaBuyerId),
      this.db
        .select({
          mediaBuyerId: schema.orders.mediaBuyerId,
          totalOrders: sql<number>`count(*) FILTER (WHERE ${totalOrdersFilter})`.mapWith(Number),
          confirmedOrders: sql<number>`count(*) FILTER (WHERE ${confirmedOrdersFilter})`.mapWith(
            Number,
          ),
          deliveredOrders: sql<number>`count(*) FILTER (WHERE ${deliveredFilter})`.mapWith(Number),
          deliveredRevenue:
            sql<number>`coalesce(sum(${schema.orders.totalAmount}) FILTER (WHERE ${deliveredFilter}), 0)`.mapWith(
              Number,
            ),
        })
        .from(schema.orders)
        .where(
          and(
            inArray(schema.orders.mediaBuyerId, buyerIds),
            sql`${schema.orders.status} != 'DELETED'`,
            eq(schema.orders.isFollowUp, false),
            branchId ? eq(schema.orders.branchId, branchId) : undefined,
          ),
        )
        .groupBy(schema.orders.mediaBuyerId),
    ]);

    const spendByBuyer = new Map<string, number>(
      spendRows
        .filter((row): row is typeof row & { mediaBuyerId: string } => row.mediaBuyerId != null)
        .map((row) => [row.mediaBuyerId, Number(row.totalSpend ?? 0)]),
    );
    const orderByBuyer = new Map(
      orderRows
        .filter((row): row is typeof row & { mediaBuyerId: string } => row.mediaBuyerId != null)
        .map((row) => [row.mediaBuyerId, row]),
    );

    const result = new Map<string, ReturnType<MarketingService['deriveBuyerMetrics']>>();
    for (const buyerId of buyerIds) {
      const spend = spendByBuyer.get(buyerId) ?? 0;
      const orderRow = orderByBuyer.get(buyerId);
      result.set(
        buyerId,
        this.deriveBuyerMetrics({
          totalSpend: spend,
          totalOrders: Number(orderRow?.totalOrders ?? 0),
          deliveredOrders: Number(orderRow?.deliveredOrders ?? 0),
          deliveredRevenue: Number(orderRow?.deliveredRevenue ?? 0),
          confirmedOrders: Number(orderRow?.confirmedOrders ?? 0),
        }),
      );
    }
    return result;
  }

  async getMediaBuyerLeaderboard(
    period: 'this_month' | 'all_time' = 'this_month',
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
    restrictToMediaBuyerIds?: string[],
  ) {
    // Include ALL active media buyers so the leaderboard is always populated,
    // not just those who have approved ad spend in the period.
    const allBuyers = await this.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.role, 'MEDIA_BUYER'), eq(schema.users.status, 'ACTIVE')));

    const branchUserIds = await this.getBranchUserIds(branchId);
    let eligibleBuyers = branchUserIds
      ? allBuyers.filter((buyer) => branchUserIds.includes(buyer.id))
      : allBuyers;
    if (restrictToMediaBuyerIds && restrictToMediaBuyerIds.length > 0) {
      const allow = new Set(restrictToMediaBuyerIds);
      eligibleBuyers = eligibleBuyers.filter((b) => allow.has(b.id));
    }

    if (eligibleBuyers.length === 0) return [];

    const [profitability, metricsByBuyer] = await Promise.all([
      this.getProfitabilityConfig(),
      this.getPerformanceMetricsBatched(
        eligibleBuyers.map((b) => b.id),
        period,
        startDate,
        endDate,
        branchId,
      ),
    ]);

    const leaderboard = eligibleBuyers.map((buyer) => {
      const metrics =
        metricsByBuyer.get(buyer.id) ??
        this.deriveBuyerMetrics({
          totalSpend: 0,
          totalOrders: 0,
          deliveredOrders: 0,
          deliveredRevenue: 0,
          confirmedOrders: 0,
        });
      const profitabilityScore =
        metrics.totalSpend > 0 ? Math.min(1, metrics.trueRoas / profitability.targetRoas) : null;
      return {
        mediaBuyerId: buyer.id,
        name: buyer.name,
        email: buyer.email,
        ...metrics,
        profitabilityScore,
      };
    });

    // Sort by True ROAS descending. Tiebreakers in order:
    //   1. deliveredRevenue (real revenue beats no revenue)
    //   2. deliveredOrders  (real deliveries beat zero)
    //   3. totalOrders      (volume — beats a single-sample buyer)
    //   4. confirmationRate (only after volume — keeps a buyer with 7/23
    //      ahead of one with 1/1 when everyone else is tied)
    //   5. name             (deterministic order so the list is stable)
    //
    // Why the layered tiebreaker: most periods start with everyone at
    // trueRoas = 0 (no ad spend logged yet), so the primary sort produces
    // ties for the entire roster. The previous code used confirmationRate
    // alone, which let a buyer with 1 confirmed / 1 order (100%) beat a
    // buyer with 7 confirmed / 23 orders (30%) — the small-sample problem.
    // Revenue + delivered count + volume put real performance ahead of a
    // statistical fluke before rate even enters the picture.
    leaderboard.sort((a, b) => {
      if (b.trueRoas !== a.trueRoas) return b.trueRoas - a.trueRoas;
      if (b.deliveredRevenue !== a.deliveredRevenue) return b.deliveredRevenue - a.deliveredRevenue;
      if (b.deliveredOrders !== a.deliveredOrders) return b.deliveredOrders - a.deliveredOrders;
      if (b.totalOrders !== a.totalOrders) return b.totalOrders - a.totalOrders;
      if (b.confirmationRate !== a.confirmationRate) return b.confirmationRate - a.confirmationRate;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });

    return leaderboard;
  }

  async checkHighCpaAlerts(cpaThreshold: number, branchId?: string | null) {
    const leaderboard = await this.getMediaBuyerLeaderboard(
      'this_month',
      undefined,
      undefined,
      branchId,
    );
    const alerts = leaderboard.filter((buyer) => buyer.cpa > cpaThreshold && buyer.totalOrders > 0);

    // Emit alerts and notify SuperAdmin + Head of Marketing for each high-CPA buyer
    for (const buyer of alerts) {
      this.events.emitToRoom('admin', 'marketing:high-cpa', {
        mediaBuyerId: buyer.mediaBuyerId,
        name: buyer.name,
        cpa: buyer.cpa,
        threshold: cpaThreshold,
      });
      const highCpaPayload = {
        type: 'marketing:high_cpa' as const,
        title: 'High CPA warning',
        body: `${buyer.name} has CPA ${buyer.cpa.toFixed(2)} (threshold: ${cpaThreshold}).`,
        data: { mediaBuyerId: buyer.mediaBuyerId, cpa: buyer.cpa, threshold: cpaThreshold },
      };
      this.notifications.enqueueCreateForRole('SUPER_ADMIN', highCpaPayload);
      this.notifications.enqueueCreateForRole('HEAD_OF_MARKETING', highCpaPayload);
    }

    return alerts;
  }

  // ============================================
  // Cross-Funnel Attempts (per-MB visibility, never CS)
  // ============================================

  /**
   * List cross-funnel attempts the actor is allowed to see.
   * - MEDIA_BUYER: their own attempts (where they were the runner-up MB)
   * - HEAD_OF_MARKETING: every MB on their currentBranchId
   * - admin-class: all (optionally filtered by branchId)
   *
   * Never includes data CS or non-marketing staff would see — call sites should
   * only mount this in the marketing module.
   */
  async listMyCrossFunnelAttempts(
    caller: { id: string; role: string; permissions?: string[] },
    input: {
      startDate?: string;
      endDate?: string;
      productId?: string;
      campaignId?: string;
      mediaBuyerId?: string;
      search?: string;
      duplicateType?: string;
      page?: number;
      limit?: number;
    },
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
  ) {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    const callerPerms = (caller.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasCallerPerm = (code: string) =>
      caller.role === 'SUPER_ADMIN' || callerPerms.includes(canonicalPermissionCode(code));

    if (hasCallerPerm('marketing.scope.global')) {
      // Explicit org-wide marketing scope → optionally narrow to a branch.
      const bCond = branchScopeCondition(schema.crossFunnelAttempts.branchId, branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    } else if (caller.role === 'HEAD_OF_MARKETING') {
      // Branch-scoped HoM sees every Media Buyer's attempts on the active branch.
      const bCond = branchScopeCondition(schema.crossFunnelAttempts.branchId, branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    } else if (hasCallerPerm('marketing.read')) {
      // Branch-scoped marketing reader: only their own rows (MB) — broader marketing.read
      // without org-wide does NOT bleed into other MBs' funnels (Pillar 4).
      conditions.push(eq(schema.crossFunnelAttempts.mediaBuyerId, caller.id));
    } else {
      return { rows: [], total: 0, page, limit, totalPages: 0 };
    }

    if (input.startDate) {
      conditions.push(gte(schema.crossFunnelAttempts.attemptedAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.crossFunnelAttempts.attemptedAt, nigeriaDayEnd(input.endDate)));
    }
    if (input.productId) {
      conditions.push(eq(schema.crossFunnelAttempts.productId, input.productId));
    }
    if (input.campaignId) {
      conditions.push(eq(schema.crossFunnelAttempts.campaignId, input.campaignId));
    }
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.crossFunnelAttempts.mediaBuyerId, input.mediaBuyerId));
    }
    if (input.search) {
      const q = `%${input.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          ilike(schema.crossFunnelAttempts.customerName, q),
          ilike(schema.crossFunnelAttempts.customerPhoneHash, q),
          sql`${schema.crossFunnelAttempts.customerPhone} ILIKE ${q}`,
        )!,
      );
    }
    // Duplicate type filter — campaign match takes priority (forms are 1:1 with MBs).
    // Same campaign = resubmission regardless of MB; cross-funnel requires different campaign + different MB.
    const typeConditions: SQL[] = [];
    if (input.duplicateType === 'resubmission') {
      typeConditions.push(
        sql`${schema.crossFunnelAttempts.campaignId} IS NOT DISTINCT FROM ${schema.orders.campaignId}`,
      );
    } else if (input.duplicateType === 'same-mb') {
      typeConditions.push(
        sql`${schema.crossFunnelAttempts.campaignId} IS DISTINCT FROM ${schema.orders.campaignId}`,
        sql`${schema.crossFunnelAttempts.mediaBuyerId} = ${schema.crossFunnelAttempts.originalMediaBuyerId}`,
      );
    } else if (input.duplicateType === 'cross-funnel') {
      typeConditions.push(
        sql`${schema.crossFunnelAttempts.campaignId} IS DISTINCT FROM ${schema.orders.campaignId}`,
        or(
          sql`${schema.crossFunnelAttempts.mediaBuyerId} != ${schema.crossFunnelAttempts.originalMediaBuyerId}`,
          isNull(schema.crossFunnelAttempts.originalMediaBuyerId),
        )!,
      );
    }

    const allConditions = [...conditions, ...typeConditions];
    const whereClause = allConditions.length > 0 ? and(...allConditions) : undefined;

    // Count query — needs the orders join for type classification (campaign comparison).
    const [{ value: total } = { value: 0 }] = await this.db
      .select({ value: count() })
      .from(schema.crossFunnelAttempts)
      .leftJoin(schema.orders, eq(schema.crossFunnelAttempts.originalOrderId, schema.orders.id))
      .where(whereClause);
    const totalCount = Number(total);

    const productAlias = alias(schema.products, 'cfa_product');
    const winnerAlias = alias(schema.users, 'cfa_winner');
    const ownerAlias = alias(schema.users, 'cfa_owner');

    const campaignAlias = alias(schema.campaigns, 'cfa_campaign');
    const originalCampaignAlias = alias(schema.campaigns, 'cfa_orig_campaign');

    const rows = await this.db
      .select({
        id: schema.crossFunnelAttempts.id,
        customerName: schema.crossFunnelAttempts.customerName,
        customerPhone: schema.crossFunnelAttempts.customerPhone,
        attemptedAt: schema.crossFunnelAttempts.attemptedAt,
        productId: schema.crossFunnelAttempts.productId,
        productName: productAlias.name,
        mediaBuyerId: schema.crossFunnelAttempts.mediaBuyerId,
        mediaBuyerName: ownerAlias.name,
        campaignId: schema.crossFunnelAttempts.campaignId,
        campaignName: campaignAlias.name,
        originalOrderId: schema.crossFunnelAttempts.originalOrderId,
        originalMediaBuyerId: schema.crossFunnelAttempts.originalMediaBuyerId,
        originalMediaBuyerName: winnerAlias.name,
        originalCampaignId: schema.orders.campaignId,
        originalCampaignName: originalCampaignAlias.name,
        originalOrderStatus: schema.orders.status,
        originalOrderAmount: schema.orders.totalAmount,
        originalOrderNumber: schema.orders.orderNumber,
        originalOrderCreatedAt: schema.orders.createdAt,
      })
      .from(schema.crossFunnelAttempts)
      .leftJoin(productAlias, eq(schema.crossFunnelAttempts.productId, productAlias.id))
      .leftJoin(winnerAlias, eq(schema.crossFunnelAttempts.originalMediaBuyerId, winnerAlias.id))
      .leftJoin(ownerAlias, eq(schema.crossFunnelAttempts.mediaBuyerId, ownerAlias.id))
      .leftJoin(schema.orders, eq(schema.crossFunnelAttempts.originalOrderId, schema.orders.id))
      .leftJoin(campaignAlias, eq(schema.crossFunnelAttempts.campaignId, campaignAlias.id))
      .leftJoin(originalCampaignAlias, eq(schema.orders.campaignId, originalCampaignAlias.id))
      .where(whereClause)
      .orderBy(desc(schema.crossFunnelAttempts.attemptedAt))
      .limit(limit)
      .offset(offset);

    return {
      rows,
      total: totalCount,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(totalCount / limit)),
    };
  }

  /**
   * Aggregate cross-funnel attempt stats for the actor's view (count, per-product
   * breakdown). Same scoping rules as listMyCrossFunnelAttempts.
   */
  async crossFunnelStats(
    caller: { id: string; role: string; permissions?: string[] },
    input: { startDate?: string; endDate?: string },
    branchId?: string | null,
    effectiveBranchIds?: string[] | null,
  ) {
    const conditions: SQL[] = [];
    const callerPerms = (caller.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasCallerPerm = (code: string) =>
      caller.role === 'SUPER_ADMIN' || callerPerms.includes(canonicalPermissionCode(code));

    if (hasCallerPerm('marketing.scope.global')) {
      const bCond = branchScopeCondition(schema.crossFunnelAttempts.branchId, branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    } else if (caller.role === 'HEAD_OF_MARKETING') {
      const bCond = branchScopeCondition(schema.crossFunnelAttempts.branchId, branchId, effectiveBranchIds);
      if (bCond) conditions.push(bCond);
    } else if (hasCallerPerm('marketing.read')) {
      conditions.push(eq(schema.crossFunnelAttempts.mediaBuyerId, caller.id));
    } else {
      return { totalAttempts: 0, uniqueCustomers: 0, perProduct: [] };
    }

    if (input.startDate) {
      conditions.push(gte(schema.crossFunnelAttempts.attemptedAt, nigeriaDayStart(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.crossFunnelAttempts.attemptedAt, nigeriaDayEnd(input.endDate)));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total + unique + per-type breakdown in one query using CASE.
    // Type logic: campaign match takes priority (forms are 1:1 with MBs).
    //   same campaign = resubmission (regardless of MB attribution)
    //   different campaign + same MB = same-mb
    //   different campaign + different MB = cross-funnel
    const [totals = { totalAttempts: 0, uniqueCustomers: 0, resubmissions: 0, sameMb: 0, crossFunnel: 0 }] = await this.db
      .select({
        totalAttempts: count(),
        uniqueCustomers: sql<number>`COUNT(DISTINCT ${schema.crossFunnelAttempts.customerPhoneHash})`,
        resubmissions: sql<number>`COUNT(*) FILTER (WHERE ${schema.crossFunnelAttempts.campaignId} IS NOT DISTINCT FROM ${schema.orders.campaignId})`,
        sameMb: sql<number>`COUNT(*) FILTER (WHERE ${schema.crossFunnelAttempts.campaignId} IS DISTINCT FROM ${schema.orders.campaignId} AND ${schema.crossFunnelAttempts.mediaBuyerId} = ${schema.crossFunnelAttempts.originalMediaBuyerId})`,
        crossFunnel: sql<number>`COUNT(*) FILTER (WHERE ${schema.crossFunnelAttempts.campaignId} IS DISTINCT FROM ${schema.orders.campaignId} AND (${schema.crossFunnelAttempts.mediaBuyerId} != ${schema.crossFunnelAttempts.originalMediaBuyerId} OR ${schema.crossFunnelAttempts.originalMediaBuyerId} IS NULL))`,
      })
      .from(schema.crossFunnelAttempts)
      .leftJoin(schema.orders, eq(schema.crossFunnelAttempts.originalOrderId, schema.orders.id))
      .where(whereClause);

    const productAlias = alias(schema.products, 'cfa_product');
    const perProduct = await this.db
      .select({
        productId: schema.crossFunnelAttempts.productId,
        productName: productAlias.name,
        attempts: count(),
      })
      .from(schema.crossFunnelAttempts)
      .leftJoin(productAlias, eq(schema.crossFunnelAttempts.productId, productAlias.id))
      .where(whereClause)
      .groupBy(schema.crossFunnelAttempts.productId, productAlias.name)
      .orderBy(desc(count()));

    return {
      totalAttempts: Number(totals.totalAttempts),
      uniqueCustomers: Number(totals.uniqueCustomers),
      resubmissions: Number(totals.resubmissions),
      sameMb: Number(totals.sameMb),
      crossFunnel: Number(totals.crossFunnel),
      perProduct: perProduct.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        attempts: Number(row.attempts),
      })),
    };
  }

  // ============================================
  // Offer Templates
  // ============================================

  private async syncProductBaseSalePriceFromTemplates(
    tx: MarketingFundingTx,
    productId: string,
  ): Promise<void> {
    const [row] = await tx
      .select({
        minP: sql<string>`min(${schema.offerTemplates.price}::numeric)`,
      })
      .from(schema.offerTemplates)
      .where(
        and(
          eq(schema.offerTemplates.productId, productId),
          eq(schema.offerTemplates.status, 'ACTIVE'),
        ),
      );
    if (row?.minP == null || row.minP === '') return;
    await tx
      .update(schema.products)
      .set({ baseSalePrice: sql`${row.minP}::numeric`, updatedAt: new Date() })
      .where(eq(schema.products.id, productId));
  }

  private async assertCampaignOfferTemplatesAllowed(
    tx: MarketingFundingTx,
    productId: string,
    selectedIds: string[] | undefined | null,
  ): Promise<void> {
    const ids = selectedIds?.filter(Boolean) ?? [];
    if (ids.length === 0) return;
    const rows = await tx
      .select({ id: schema.offerTemplates.id })
      .from(schema.offerTemplates)
      .where(
        and(
          inArray(schema.offerTemplates.id, ids),
          eq(schema.offerTemplates.productId, productId),
          eq(schema.offerTemplates.status, 'ACTIVE'),
        ),
      );
    if (rows.length !== ids.length) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'One or more selected offer tiers are invalid for this product.',
      });
    }
  }

  async createOfferTemplate(input: CreateOfferTemplateInput, createdBy: string) {
    return withActor(this.db, { id: createdBy }, async (tx) => {
      // Verify product exists
      const productRows = await tx
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, input.productId))
        .limit(1);

      if (productRows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }

      const rows = await tx
        .insert(schema.offerTemplates)
        .values({
          productId: input.productId,
          name: input.name,
          price: String(input.price),
          quantity: input.quantity ?? 1,
          imageUrls: input.imageUrls ?? [],
          variants: input.variants ?? null,
          createdBy,
          status: 'ACTIVE',
        })
        .returning();

      const template = rows[0];
      if (!template) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create offer template',
        });
      }
      await this.syncProductBaseSalePriceFromTemplates(tx, input.productId);
      return template;
    });
  }

  async updateOfferTemplate(input: UpdateOfferTemplateInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.offerTemplates)
        .where(eq(schema.offerTemplates.id, input.id))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Offer template not found' });
      }

      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData['name'] = input.name;
      if (input.price !== undefined) updateData['price'] = String(input.price);
      if (input.quantity !== undefined) updateData['quantity'] = input.quantity;
      if (input.imageUrls !== undefined) updateData['imageUrls'] = input.imageUrls;
      if (input.variants !== undefined) updateData['variants'] = input.variants;
      if (input.status !== undefined) updateData['status'] = input.status;

      const updated = await tx
        .update(schema.offerTemplates)
        .set(updateData)
        .where(eq(schema.offerTemplates.id, input.id))
        .returning();

      const row = updated[0];
      if (row) {
        await this.syncProductBaseSalePriceFromTemplates(tx, row.productId);
      }
      return row;
    });
  }

  /**
   * Archive every ACTIVE / INACTIVE offer tier for a product so ops can rebuild tiers (qty, images,
   * form `selectedOfferTemplateIds`) without editing rows one-by-one. Clears stale tier IDs from
   * campaign `form_config` and legacy `offer_template_id` when they pointed at archived tiers.
   * Catalog list price is only recomputed when at least one ACTIVE tier remains (otherwise unchanged).
   */
  async archiveAllOfferTemplatesForProduct(
    productId: string,
    actorId: string,
  ): Promise<{ archivedCount: number }> {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const [productRow] = await tx
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1);

      if (!productRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      }

      const tierRows = await tx
        .select({ id: schema.offerTemplates.id })
        .from(schema.offerTemplates)
        .where(
          and(
            eq(schema.offerTemplates.productId, productId),
            inArray(schema.offerTemplates.status, ['ACTIVE', 'INACTIVE']),
          ),
        );

      const archivedIds = new Set(tierRows.map((r) => r.id));
      if (archivedIds.size === 0) {
        return { archivedCount: 0 };
      }

      const productIdsContains = sql`${schema.campaigns.productIds}::jsonb @> ${JSON.stringify([productId])}::jsonb`;

      const campaignRows = await tx
        .select({
          id: schema.campaigns.id,
          formConfig: schema.campaigns.formConfig,
          offerTemplateId: schema.campaigns.offerTemplateId,
        })
        .from(schema.campaigns)
        .where(and(isNull(schema.campaigns.validTo), productIdsContains));

      for (const c of campaignRows) {
        const fc = { ...((c.formConfig as Record<string, unknown> | null) ?? {}) };
        let dirtyForm = false;

        const sel = fc['selectedOfferTemplateIds'];
        if (Array.isArray(sel)) {
          const filtered = sel.filter(
            (x): x is string => typeof x === 'string' && !archivedIds.has(x),
          );
          if (filtered.length !== sel.length) {
            dirtyForm = true;
            if (filtered.length === 0) delete fc['selectedOfferTemplateIds'];
            else fc['selectedOfferTemplateIds'] = filtered;
          }
        }

        const clearLegacyFk = c.offerTemplateId != null && archivedIds.has(c.offerTemplateId);

        if (!dirtyForm && !clearLegacyFk) continue;

        const setPayload: Record<string, unknown> = { updatedAt: new Date() };
        if (dirtyForm) setPayload['formConfig'] = fc;
        if (clearLegacyFk) setPayload['offerTemplateId'] = null;

        await tx.update(schema.campaigns).set(setPayload).where(eq(schema.campaigns.id, c.id));
      }

      await tx
        .update(schema.offerTemplates)
        .set({ status: 'ARCHIVED', updatedAt: new Date() })
        .where(
          and(
            eq(schema.offerTemplates.productId, productId),
            inArray(schema.offerTemplates.status, ['ACTIVE', 'INACTIVE']),
          ),
        );

      await this.syncProductBaseSalePriceFromTemplates(tx, productId);

      return { archivedCount: archivedIds.size };
    });
  }

  async getOfferTemplate(id: string) {
    const rows = await this.db
      .select()
      .from(schema.offerTemplates)
      .where(eq(schema.offerTemplates.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Offer template not found' });
    }
    return rows[0];
  }

  async listOfferTemplates(input: ListOfferTemplatesInput) {
    const conditions = [];
    if (input.productId) {
      conditions.push(eq(schema.offerTemplates.productId, input.productId));
    }
    if (input.status) {
      conditions.push(eq(schema.offerTemplates.status, input.status));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const baseFrom = this.db
      .select({
        ...getTableColumns(schema.offerTemplates),
        productName: schema.products.name,
      })
      .from(schema.offerTemplates)
      .innerJoin(schema.products, eq(schema.offerTemplates.productId, schema.products.id));

    const countBase = this.db
      .select({ count: count() })
      .from(schema.offerTemplates)
      .innerJoin(schema.products, eq(schema.offerTemplates.productId, schema.products.id));

    const [templates, totalRows] = await Promise.all([
      (whereClause ? baseFrom.where(whereClause) : baseFrom)
        .orderBy(desc(schema.offerTemplates.createdAt))
        .limit(input.limit)
        .offset(offset),
      whereClause ? countBase.where(whereClause) : countBase,
    ]);

    return {
      templates,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  // ============================================
  // Offer Groups
  // ============================================

  private assertOfferGroupItemsSingleProduct(items: Array<{ productId: string }>): string {
    if (items.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one offer item.' });
    }
    const pid = items[0]!.productId;
    for (const it of items) {
      if (it.productId !== pid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'All items in an offer must use the same catalog product (single-SKU Edge forms).',
        });
      }
    }
    return pid;
  }

  private async assertOfferItemImageInProductGallery(
    tx: MarketingFundingTx,
    productId: string,
    imageUrl: string | undefined,
  ): Promise<void> {
    if (!imageUrl) return;
    const [p] = await tx
      .select({ gallery: schema.products.galleryImageUrls })
      .from(schema.products)
      .where(eq(schema.products.id, productId))
      .limit(1);
    if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    const gallery = Array.isArray(p.gallery)
      ? p.gallery.filter((x): x is string => typeof x === 'string')
      : [];
    if (!gallery.includes(imageUrl)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Selected image must be from the product gallery.',
      });
    }
  }

  async createOfferGroup(input: CreateOfferGroupInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const productId = this.assertOfferGroupItemsSingleProduct(input.items);

      // Reject duplicate names (case-insensitive, against non-archived rows).
      // Pre-check inside the transaction so rapid double/triple clicks return a
      // friendly CONFLICT instead of letting the unique index surface as
      // INTERNAL_SERVER_ERROR. Migration 0122 enforces this at the DB level too.
      const conflict = await tx
        .select({ id: schema.offerGroups.id, name: schema.offerGroups.name })
        .from(schema.offerGroups)
        .where(
          and(
            ne(schema.offerGroups.status, 'ARCHIVED'),
            sql`lower(${schema.offerGroups.name}) = lower(${input.name})`,
          ),
        )
        .limit(1);
      if (conflict[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `An offer named "${conflict[0].name}" already exists. Pick a different name.`,
        });
      }

      // Verify product exists once (and validate all chosen images are from gallery).
      const [p] = await tx
        .select({
          id: schema.products.id,
          gallery: schema.products.galleryImageUrls,
          baseSalePrice: schema.products.baseSalePrice,
        })
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1);
      if (!p) throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
      const gallery = Array.isArray(p.gallery)
        ? p.gallery.filter((x): x is string => typeof x === 'string')
        : [];
      const inheritedUnitPrice = p.baseSalePrice != null ? Number(p.baseSalePrice) : NaN;

      for (const it of input.items) {
        const img = typeof it.imageUrl === 'string' ? it.imageUrl : undefined;
        if (img && !gallery.includes(img)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Selected image must be from the product gallery.',
          });
        }
      }

      const [group] = await tx
        .insert(schema.offerGroups)
        .values({
          name: input.name,
          createdBy: actorId,
          status: 'ACTIVE',
        })
        .returning();
      if (!group)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create offer' });

      const itemValues = input.items.map((it, idx) => ({
        offerGroupId: group.id,
        productId: it.productId,
        label: it.label,
        quantity: it.quantity ?? 1,
        // Use the submitted price when provided (allows discounts); fall back
        // to unit price × qty when price is 0 or missing.
        price: it.price > 0
          ? sql`${String(it.price)}::numeric`
          : Number.isFinite(inheritedUnitPrice)
            ? sql`${String(inheritedUnitPrice * (it.quantity ?? 1))}::numeric`
            : sql`0::numeric`,
        imageUrl: it.imageUrl ?? null,
        sortOrder: it.sortOrder ?? idx,
        status: 'ACTIVE' as const,
      }));

      const items = await tx.insert(schema.offerGroupItems).values(itemValues).returning();

      return { group, items };
    });
  }

  async updateOfferGroup(input: UpdateOfferGroupInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.offerGroups)
        .where(eq(schema.offerGroups.id, input.id))
        .limit(1);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Offer not found' });

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updateData['name'] = input.name;
      if (input.status !== undefined) updateData['status'] = input.status;

      let updatedGroup = existing;
      if (Object.keys(updateData).length > 1) {
        const [row] = await tx
          .update(schema.offerGroups)
          .set(updateData)
          .where(eq(schema.offerGroups.id, input.id))
          .returning();
        if (row) updatedGroup = row;
      }

      if (input.items) {
        const productId = this.assertOfferGroupItemsSingleProduct(input.items);
        const [priceRow] = await tx
          .select({ baseSalePrice: schema.products.baseSalePrice })
          .from(schema.products)
          .where(eq(schema.products.id, productId))
          .limit(1);
        const inheritedUnitPrice =
          priceRow?.baseSalePrice != null ? Number(priceRow.baseSalePrice) : NaN;
        // Validate images against product gallery.
        for (const it of input.items) {
          await this.assertOfferItemImageInProductGallery(tx, productId, it.imageUrl);
        }

        await tx
          .delete(schema.offerGroupItems)
          .where(eq(schema.offerGroupItems.offerGroupId, input.id));

        const itemValues = input.items.map((it, idx) => ({
          offerGroupId: input.id,
          productId: it.productId,
          label: it.label,
          quantity: it.quantity ?? 1,
          // Use the submitted price when provided (allows discounts); fall back
          // to unit price × qty when price is 0 or missing.
          price: it.price > 0
            ? sql`${String(it.price)}::numeric`
            : Number.isFinite(inheritedUnitPrice)
              ? sql`${String(inheritedUnitPrice * (it.quantity ?? 1))}::numeric`
              : sql`0::numeric`,
          imageUrl: it.imageUrl ?? null,
          sortOrder: it.sortOrder ?? idx,
          status: 'ACTIVE' as const,
        }));
        await tx.insert(schema.offerGroupItems).values(itemValues);
      }

      const items = await tx
        .select({
          ...getTableColumns(schema.offerGroupItems),
          productName: schema.products.name,
        })
        .from(schema.offerGroupItems)
        .innerJoin(schema.products, eq(schema.offerGroupItems.productId, schema.products.id))
        .where(
          and(
            eq(schema.offerGroupItems.offerGroupId, input.id),
            eq(schema.offerGroupItems.status, 'ACTIVE'),
          ),
        )
        .orderBy(schema.offerGroupItems.sortOrder);

      return { group: updatedGroup, items };
    });
  }

  async getOfferGroup(id: string) {
    const [group] = await this.db
      .select()
      .from(schema.offerGroups)
      .where(eq(schema.offerGroups.id, id))
      .limit(1);
    if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Offer not found' });

    const items = await this.db
      .select({
        ...getTableColumns(schema.offerGroupItems),
        productName: schema.products.name,
      })
      .from(schema.offerGroupItems)
      .innerJoin(schema.products, eq(schema.offerGroupItems.productId, schema.products.id))
      .where(
        and(
          eq(schema.offerGroupItems.offerGroupId, id),
          eq(schema.offerGroupItems.status, 'ACTIVE'),
        ),
      )
      .orderBy(schema.offerGroupItems.sortOrder);

    return { group, items };
  }

  async listOfferGroups(input: ListOfferGroupsInput) {
    const conditions = [];
    if (input.status) conditions.push(eq(schema.offerGroups.status, input.status));
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const base = this.db.select().from(schema.offerGroups);
    const countBase = this.db.select({ count: count() }).from(schema.offerGroups);

    const [groups, totalRows] = await Promise.all([
      (whereClause ? base.where(whereClause) : base)
        .orderBy(desc(schema.offerGroups.createdAt))
        .limit(input.limit)
        .offset(offset),
      whereClause ? countBase.where(whereClause) : countBase,
    ]);

    const ids = groups.map((g) => g.id);
    const items =
      ids.length === 0
        ? []
        : await this.db
            .select({
              ...getTableColumns(schema.offerGroupItems),
              productName: schema.products.name,
            })
            .from(schema.offerGroupItems)
            .innerJoin(schema.products, eq(schema.offerGroupItems.productId, schema.products.id))
            .where(
              and(
                inArray(schema.offerGroupItems.offerGroupId, ids),
                eq(schema.offerGroupItems.status, 'ACTIVE'),
              ),
            )
            .orderBy(schema.offerGroupItems.offerGroupId, schema.offerGroupItems.sortOrder);

    const itemsByGroup = new Map<string, typeof items>();
    for (const it of items) {
      const arr = itemsByGroup.get(it.offerGroupId) ?? [];
      arr.push(it);
      itemsByGroup.set(it.offerGroupId, arr);
    }

    return {
      groups: groups.map((g) => ({ ...g, items: itemsByGroup.get(g.id) ?? [] })),
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async clearLegacyOfferTemplates(
    input: ClearLegacyOfferTemplatesInput,
    actorId: string,
  ): Promise<{ archivedCount: number; detachedCampaigns: number }> {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const tierRows = await tx
        .select({ id: schema.offerTemplates.id })
        .from(schema.offerTemplates)
        .where(inArray(schema.offerTemplates.status, ['ACTIVE', 'INACTIVE']));
      const archivedIds = new Set(tierRows.map((r) => r.id));

      let detachedCampaigns = 0;
      if (input.detachCampaigns !== false) {
        const campaignRows = await tx
          .select({
            id: schema.campaigns.id,
            formConfig: schema.campaigns.formConfig,
            offerTemplateId: schema.campaigns.offerTemplateId,
          })
          .from(schema.campaigns)
          .where(
            and(
              isNull(schema.campaigns.validTo),
              or(
                sql`${schema.campaigns.offerTemplateId} IS NOT NULL`,
                sql`${schema.campaigns.formConfig}::jsonb ? 'selectedOfferTemplateIds'`,
              ),
            ),
          );

        for (const c of campaignRows) {
          const fc = { ...((c.formConfig as Record<string, unknown> | null) ?? {}) };
          let dirtyForm = false;

          if ('selectedOfferTemplateIds' in fc) {
            dirtyForm = true;
            delete fc['selectedOfferTemplateIds'];
          }

          const clearLegacyFk = c.offerTemplateId != null;
          if (!dirtyForm && !clearLegacyFk) continue;

          const setPayload: Record<string, unknown> = { updatedAt: new Date() };
          if (dirtyForm) setPayload['formConfig'] = fc;
          if (clearLegacyFk) setPayload['offerTemplateId'] = null;

          await tx.update(schema.campaigns).set(setPayload).where(eq(schema.campaigns.id, c.id));
          detachedCampaigns += 1;
        }
      }

      if (archivedIds.size > 0) {
        await tx
          .update(schema.offerTemplates)
          .set({ status: 'ARCHIVED', updatedAt: new Date() })
          .where(inArray(schema.offerTemplates.id, [...archivedIds]));
      }

      return { archivedCount: archivedIds.size, detachedCampaigns };
    });
  }

  // ============================================
  // Campaigns
  // ============================================

  /** Ordered distinct product ids from active offer lines (first appearance by sort_order). */
  private async deriveProductIdsFromOfferGroup(
    tx: PostgresJsDatabase<typeof schema>,
    offerGroupId: string,
  ): Promise<string[]> {
    const rows = await tx
      .select({
        productId: schema.offerGroupItems.productId,
        sortOrder: schema.offerGroupItems.sortOrder,
      })
      .from(schema.offerGroupItems)
      .where(
        and(
          eq(schema.offerGroupItems.offerGroupId, offerGroupId),
          eq(schema.offerGroupItems.status, 'ACTIVE'),
        ),
      )
      .orderBy(schema.offerGroupItems.sortOrder);

    if (rows.length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Selected offer has no active items.' });
    }

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of rows) {
      const id = row.productId;
      if (!seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    return ordered;
  }

  async createCampaign(input: CreateCampaignInput, mediaBuyerId: string, branchId?: string | null) {
    return withActor(this.db, { id: mediaBuyerId }, async (tx) => {
      // Form names are unique org-wide, case-insensitive. Pre-check so callers
      // get a friendly CONFLICT instead of a Postgres unique-violation surfacing
      // as an INTERNAL_SERVER_ERROR.
      const conflict = await tx
        .select({ id: schema.campaigns.id, name: schema.campaigns.name })
        .from(schema.campaigns)
        .where(
          and(
            isNull(schema.campaigns.validTo),
            sql`lower(${schema.campaigns.name}) = lower(${input.name})`,
          ),
        )
        .limit(1);
      if (conflict[0]) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A form named "${conflict[0].name}" already exists. Pick a different name.`,
        });
      }

      let productIdsToStore: string[];
      if (input.offerGroupId) {
        productIdsToStore = await this.deriveProductIdsFromOfferGroup(tx, input.offerGroupId);
      } else {
        const raw = input.productIds;
        if (!raw || raw.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Provide offerGroupId or at least one product id.',
          });
        }
        productIdsToStore = raw;
        await this.assertCampaignOfferTemplatesAllowed(
          tx,
          productIdsToStore[0]!,
          input.formConfig?.selectedOfferTemplateIds,
        );
      }

      const rows = await tx
        .insert(schema.campaigns)
        .values({
          mediaBuyerId,
          name: input.name,
          productIds: productIdsToStore,
          offerGroupId: input.offerGroupId ?? null,
          deploymentType: input.deploymentType,
          formConfig: input.formConfig ?? null,
          status: 'ACTIVE',
          branchId: branchId ?? null,
        })
        .returning();

      const campaign = rows[0];
      if (!campaign) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create campaign',
        });
      }
      return campaign;
    });
  }

  async updateCampaign(input: UpdateCampaignInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const existing = await tx
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, input.id))
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
      }

      // Pre-check name uniqueness when renaming, excluding the row being edited.
      if (input.name !== undefined && input.name !== existing[0]!.name) {
        const conflict = await tx
          .select({ id: schema.campaigns.id, name: schema.campaigns.name })
          .from(schema.campaigns)
          .where(
            and(
              isNull(schema.campaigns.validTo),
              ne(schema.campaigns.id, input.id),
              sql`lower(${schema.campaigns.name}) = lower(${input.name})`,
            ),
          )
          .limit(1);
        if (conflict[0]) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `A form named "${conflict[0].name}" already exists. Pick a different name.`,
          });
        }
      }

      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData['name'] = input.name;
      if (input.formConfig !== undefined) updateData['formConfig'] = input.formConfig;
      if (input.offerGroupId !== undefined) {
        updateData['offerGroupId'] = input.offerGroupId;
        if (input.offerGroupId !== null) {
          updateData['productIds'] = await this.deriveProductIdsFromOfferGroup(
            tx,
            input.offerGroupId,
          );
        }
      }
      if (input.status !== undefined) updateData['status'] = input.status;

      // Form transfer (migration 0150): when a parked/deactivated form is
      // reactivated, re-stamp its branch to the owner's current primary branch
      // so the form follows the media buyer to whichever branch they now
      // belong to. A form removed from a branch (its owner left) parks as
      // DEACTIVATED and resurfaces under the owner's new branch; activating it
      // there makes it a form of that branch.
      if (input.status === 'ACTIVE' && existing[0]!.status !== 'ACTIVE') {
        const [owner] = await tx
          .select({ primaryBranchId: schema.users.primaryBranchId })
          .from(schema.users)
          .where(eq(schema.users.id, existing[0]!.mediaBuyerId))
          .limit(1);
        if (owner?.primaryBranchId && owner.primaryBranchId !== existing[0]!.branchId) {
          updateData['branchId'] = owner.primaryBranchId;
        }
      }

      if (input.formConfig !== undefined) {
        const prevRow = existing[0]!;
        const prev = (prevRow.formConfig as Record<string, unknown> | null) ?? {};
        const merged = { ...prev, ...input.formConfig };
        const pid = ((prevRow.productIds ?? []) as string[])[0];
        const effectiveOfferGroupId =
          input.offerGroupId !== undefined ? input.offerGroupId : prevRow.offerGroupId;
        if (pid && effectiveOfferGroupId == null) {
          await this.assertCampaignOfferTemplatesAllowed(
            tx,
            pid,
            merged.selectedOfferTemplateIds as string[] | undefined,
          );
        }
      }

      const updated = await tx
        .update(schema.campaigns)
        .set(updateData)
        .where(eq(schema.campaigns.id, input.id))
        .returning();

      return updated[0];
    });
  }

  async getCampaign(id: string) {
    const rows = await this.db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
    }
    return rows[0];
  }

  /**
   * Get public campaign config for the Edge Worker form rendering.
   * Returns campaign with resolved product info from offer template.
   * No auth required — called by the Cloudflare Edge Worker.
   */
  async getPublicCampaign(campaignId: string) {
    const campaignRows = await this.db
      .select()
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.status, 'ACTIVE')))
      .limit(1);

    const campaign = campaignRows[0];
    if (!campaign) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found or inactive' });
    }

    type PublicProduct = {
      id: string;
      name: string;
      price: string;
      galleryImageUrls?: string[];
      offers: Array<{ label: string; qty: number; price: string; imageUrls?: string[] }>;
    };
    const products: PublicProduct[] = [];

    const pIds = (campaign.productIds ?? []) as string[];

    const formConfigRaw = campaign.formConfig as Record<string, unknown> | null;
    const selectedIdsRaw = formConfigRaw?.selectedOfferTemplateIds;
    const selectedSet =
      Array.isArray(selectedIdsRaw) && selectedIdsRaw.length > 0
        ? new Set(selectedIdsRaw.filter((x): x is string => typeof x === 'string'))
        : null;

    const parseGallery = (raw: unknown): string[] => {
      if (!Array.isArray(raw)) return [];
      return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
    };

    if (campaign.offerGroupId) {
      const itemRows = await this.db
        .select({
          productId: schema.offerGroupItems.productId,
          label: schema.offerGroupItems.label,
          quantity: schema.offerGroupItems.quantity,
          price: schema.offerGroupItems.price,
          imageUrl: schema.offerGroupItems.imageUrl,
          sortOrder: schema.offerGroupItems.sortOrder,
        })
        .from(schema.offerGroupItems)
        .where(
          and(
            eq(schema.offerGroupItems.offerGroupId, campaign.offerGroupId),
            eq(schema.offerGroupItems.status, 'ACTIVE'),
          ),
        )
        .orderBy(schema.offerGroupItems.sortOrder);

      const orderedProductIds: string[] = [];
      const seenId = new Set<string>();
      for (const row of itemRows) {
        if (!seenId.has(row.productId)) {
          seenId.add(row.productId);
          orderedProductIds.push(row.productId);
        }
      }

      // Batch-load every product in one query instead of one SELECT per id —
      // the loop below still walks `orderedProductIds` so output order is kept.
      const productRows =
        orderedProductIds.length > 0
          ? await this.db
              .select({
                id: schema.products.id,
                name: schema.products.name,
                baseSalePrice: schema.products.baseSalePrice,
                galleryImageUrls: schema.products.galleryImageUrls,
              })
              .from(schema.products)
              .where(inArray(schema.products.id, orderedProductIds))
          : [];
      const productById = new Map(productRows.map((p) => [p.id, p]));

      for (const productId of orderedProductIds) {
        const p = productById.get(productId);
        if (!p) {
          continue;
        }

        const galleryImageUrls = parseGallery(p.galleryImageUrls);
        const itemsForProduct = itemRows.filter((r) => r.productId === productId);
        const offerList = itemsForProduct.map((it) => ({
          label: it.label,
          qty: it.quantity ?? 1,
          price: String(it.price),
          imageUrls:
            typeof it.imageUrl === 'string' && it.imageUrl.length > 0
              ? [it.imageUrl]
              : galleryImageUrls.length > 0
                ? galleryImageUrls
                : undefined,
        }));

        products.push({
          id: p.id,
          name: p.name,
          price: String(p.baseSalePrice),
          galleryImageUrls: galleryImageUrls.length > 0 ? galleryImageUrls : undefined,
          offers: offerList,
        });
      }
    } else {
      const pid = pIds.length > 0 ? pIds[0] : null;

      if (pid) {
        const pRows = await this.db
          .select({
            id: schema.products.id,
            name: schema.products.name,
            baseSalePrice: schema.products.baseSalePrice,
            offers: schema.products.offers,
            galleryImageUrls: schema.products.galleryImageUrls,
          })
          .from(schema.products)
          .where(eq(schema.products.id, pid))
          .limit(1);

        const p = pRows[0];
        if (p) {
          const galleryImageUrls = parseGallery(p.galleryImageUrls);

          let offerList: Array<{
            label: string;
            qty: number;
            price: string;
            imageUrls?: string[];
          }> = [];

          const templateConditions = [
            eq(schema.offerTemplates.productId, p.id),
            eq(schema.offerTemplates.status, 'ACTIVE'),
          ];
          if (selectedSet && selectedSet.size > 0) {
            templateConditions.push(inArray(schema.offerTemplates.id, [...selectedSet]));
          }

          const templateRows = await this.db
            .select({
              name: schema.offerTemplates.name,
              price: schema.offerTemplates.price,
              quantity: schema.offerTemplates.quantity,
              imageUrls: schema.offerTemplates.imageUrls,
            })
            .from(schema.offerTemplates)
            .where(and(...templateConditions));

          offerList = templateRows.map((t) => ({
            label: t.name,
            qty: t.quantity ?? 1,
            price: String(t.price),
            imageUrls:
              parseGallery(t.imageUrls).length > 0
                ? parseGallery(t.imageUrls)
                : galleryImageUrls.length > 0
                  ? galleryImageUrls
                  : undefined,
          }));

          if (offerList.length === 0) {
            const legacy = (p.offers ?? []) as Array<{
              label: string;
              qty: number;
              price: string;
              imageUrls?: string[];
            }>;
            offerList =
              legacy.length > 0
                ? legacy.map((o) => ({
                    label: o.label,
                    qty: o.qty,
                    price: typeof o.price === 'string' ? o.price : String(o.price),
                    imageUrls:
                      o.imageUrls ?? (galleryImageUrls.length ? galleryImageUrls : undefined),
                  }))
                : [
                    {
                      label: 'Standard',
                      qty: 1,
                      price: String(p.baseSalePrice),
                      imageUrls: galleryImageUrls.length ? galleryImageUrls : undefined,
                    },
                  ];
          }

          products.push({
            id: p.id,
            name: p.name,
            price: String(p.baseSalePrice),
            galleryImageUrls: galleryImageUrls.length > 0 ? galleryImageUrls : undefined,
            offers: offerList,
          });
        }
      }
    }

    return {
      id: campaign.id,
      name: campaign.name,
      mediaBuyerId: campaign.mediaBuyerId,
      deploymentType: campaign.deploymentType,
      products,
      formConfig: campaign.formConfig as {
        heading?: string;
        subtitle?: string;
        buttonText?: string;
        accentColor?: string;
        successMessage?: string;
        successCallbackUrl?: string;
        showDeliveryAddress?: boolean;
        showDeliveryNotes?: boolean;
        showDeliveryState?: boolean;
        showGender?: boolean;
        showPreferredDeliveryDate?: boolean;
        deliveryStateOptions?: string[];
        preferredDeliveryDateOptions?: string[];
      } | null,
    };
  }

  async listCampaigns(input: ListCampaignsInput, branchId?: string | null) {
    const conditions = [];
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.campaigns.mediaBuyerId, input.mediaBuyerId));
    } else if (input.mediaBuyerIds && input.mediaBuyerIds.length > 0) {
      // Supervisor-scoped: any MB in the set (their team + themselves).
      conditions.push(inArray(schema.campaigns.mediaBuyerId, input.mediaBuyerIds));
    }
    if (input.status) {
      conditions.push(eq(schema.campaigns.status, input.status));
    }
    if (branchId) {
      // A branch's form list shows forms attributed to it, PLUS "parked" forms
      // (migration 0150): when a media buyer is moved to this branch, their
      // forms from the old branch are DEACTIVATED but still carry the old
      // branch_id. They resurface here — under the owner's new primary branch —
      // so the MB can reactivate them (which re-stamps branch_id; see
      // updateCampaign). The branch_id only moves on reactivation.
      conditions.push(
        or(
          eq(schema.campaigns.branchId, branchId),
          and(
            eq(schema.campaigns.status, 'DEACTIVATED'),
            ne(schema.campaigns.branchId, branchId),
            inArray(
              schema.campaigns.mediaBuyerId,
              this.db
                .select({ id: schema.users.id })
                .from(schema.users)
                .where(eq(schema.users.primaryBranchId, branchId)),
            ),
          ),
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [campaigns, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.campaigns)
        .where(whereClause)
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.campaigns).where(whereClause),
    ]);

    const mediaBuyerIds = [
      ...new Set(campaigns.map((c) => c.mediaBuyerId).filter(Boolean)),
    ] as string[];
    const mediaBuyerNames: Map<string, string> = new Map();
    if (mediaBuyerIds.length > 0) {
      const users = await this.db
        .select({ id: schema.users.id, name: schema.users.name })
        .from(schema.users)
        .where(inArray(schema.users.id, mediaBuyerIds));
      users.forEach((u) => mediaBuyerNames.set(u.id, u.name));
    }

    return {
      campaigns: campaigns.map((c) => ({
        ...c,
        mediaBuyerName: c.mediaBuyerId ? (mediaBuyerNames.get(c.mediaBuyerId) ?? null) : null,
      })),
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }
}
