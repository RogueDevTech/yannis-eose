import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, ne, and, desc, gte, lte, gt, count, sum, inArray, or, ilike, getTableColumns, isNull, sql, exists, type SQL } from 'drizzle-orm';
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
  UpdateAdSpendInput,
  CreateOfferTemplateInput,
  UpdateOfferTemplateInput,
  ListOfferTemplatesInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsInput,
} from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor } from '../common/db/with-actor';
import { BranchTeamsService } from '../branches/branch-teams.service';
import { SettingsService } from '../settings/settings.service';

/** Default profitability config when `MARKETING_PROFITABILITY` system setting is unset. */
const DEFAULT_PROFITABILITY_TARGET_ROAS = 3;
const DEFAULT_PROFITABILITY_GREEN_THRESHOLD = 2.5;
export const MARKETING_PROFITABILITY_KEY = 'MARKETING_PROFITABILITY';

/** Drizzle transaction client (same as `withActor` callback `tx`). */
type MarketingFundingTx = Parameters<Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]>[0];

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
    const rows = await this.db
      .select({ userId: schema.userBranches.userId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.branchId, branchId));
    return rows.map((row) => row.userId);
  }

  /**
   * Strict same-branch guard for funding mutations (Pillar 4: Absolute Accountability,
   * multi-branch isolation). `otherUserId` must be a member of `currentBranchId`.
   * The actor must be too, except admin-class users who only need the session branch
   * selected (they are not required to have a `user_branches` row).
   *
   * Bypass: admin-class or org-wide Head of Marketing with `currentBranchId == null` skips
   * same-branch membership — ledger pairing is enforced by `assertLedgerTransferAllowed` after load.
   *
   * Other actors with no active branch are rejected.
   */
  private async assertSameBranchOrAdmin(
    actor: { id: string; role: string; permissions?: string[] },
    otherUserId: string,
    currentBranchId: string | null,
  ): Promise<void> {
    const perms = (actor.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const has = (code: string) =>
      actor.role === 'SUPER_ADMIN' || perms.includes(canonicalPermissionCode(code));
    const isOrgWide =
      actor.role === 'SUPER_ADMIN' ||
      has('branches.manage') ||
      has('marketing.scope.global');

    if (currentBranchId === null) {
      if (isOrgWide) return;
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'No active branch — switch to a branch before initiating a funding transfer',
      });
    }

    const memberships = await this.db
      .select({ userId: schema.userBranches.userId })
      .from(schema.userBranches)
      .where(
        and(
          eq(schema.userBranches.branchId, currentBranchId),
          inArray(schema.userBranches.userId, [actor.id, otherUserId]),
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
        message: 'Recipient is not a member of your active branch',
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
   * ledger rows (SENT, COMPLETED, DISPUTED) minus APPROVED ad spend (branch-scoped when branchId is set).
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
            eq(schema.adSpendLogs.status, 'APPROVED'),
            branchCampaignIds ? inArray(schema.adSpendLogs.campaignId, branchCampaignIds) : undefined,
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
  }): Promise<{
    orderCount: number;
    priorSpendDate: string | null;
    windowStartExclusive: string | null;
    indicativeCpa: number | null;
  }> {
    const branchCampaignIds = await this.getBranchCampaignIds(params.branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return { orderCount: 0, priorSpendDate: null, windowStartExclusive: null, indicativeCpa: null };
    }
    if (branchCampaignIds && !branchCampaignIds.includes(params.campaignId)) {
      return { orderCount: 0, priorSpendDate: null, windowStartExclusive: null, indicativeCpa: null };
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
    let windowStartExclusive: Date | null = null;
    if (priorSpend) {
      const y = priorSpend.getUTCFullYear();
      const m = priorSpend.getUTCMonth();
      const d = priorSpend.getUTCDate();
      windowStartExclusive = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
    }

    const now = new Date();
    const hasProductLine = exists(
      this.db
        .select({ id: schema.orderItems.id })
        .from(schema.orderItems)
        .where(
          and(eq(schema.orderItems.orderId, schema.orders.id), eq(schema.orderItems.productId, params.productId)),
        ),
    );

    const orderConditions: SQL[] = [
      eq(schema.orders.mediaBuyerId, params.mediaBuyerId),
      eq(schema.orders.campaignId, params.campaignId),
      hasProductLine,
      lte(schema.orders.createdAt, now),
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
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Receiver must be Head of Marketing or Media Buyer' });
  }

  // ============================================
  // Marketing Funding
  // ============================================

  async createFunding(
    input: CreateFundingInput,
    actor: { id: string; role: string },
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
        tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, senderId)).limit(1),
        tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, input.receiverId)).limit(1),
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
        const disbursable = await this.computeMarketingDisbursableInTx(tx, senderId, currentBranchId);
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
    this.notifications
      .create({
        userId: input.receiverId,
        type: 'funding:sent',
        title: 'Funding received',
        body: `You have received funding. Please mark as Received or Not Received.`,
        data: { fundingId: funding.id, amount: input.amount },
      })
      .catch(() => {});

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
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the receiver can verify this funding' });
      }

      if (found.status !== 'SENT') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Funding has already been verified' });
      }

      if (input.action === 'DISPUTED' && (!input.disputeReason || input.disputeReason.length < 10)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Dispute requires a reason with at least 10 characters' });
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
      this.notifications
        .createForRole('SUPER_ADMIN', {
          type: 'funding:disputed',
          title: 'Funding disputed',
          body: `A Media Buyer marked funding as Not Received. Requires resolution.`,
          data: { fundingId: funding.id, amount: funding.amount },
        })
        .catch(() => {});
      this.notifications
        .createForRole('HEAD_OF_MARKETING', {
          type: 'funding:disputed',
          title: 'Funding disputed',
          body: `A Media Buyer marked funding as Not Received. Requires resolution.`,
          data: { fundingId: funding.id, amount: funding.amount },
        })
        .catch(() => {});
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
    if (input.senderId) {
      conditions.push(eq(schema.marketingFunding.senderId, input.senderId));
    }
    if (input.startDate) {
      conditions.push(gte(schema.marketingFunding.sentAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.marketingFunding.sentAt, end));
    }
    // Ledger rows have no branch_id. Do not filter by active-branch membership here — it
    // drifted from `fundingByDirectionSummary` (actor + period only) and hid rows when the
    // viewer's session branch did not match their `user_branches` row or cross-branch data.
    void branchId;
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      const searchOr = or(
        ilike(fundingSender.name, `%${searchTrimmed}%`),
        ilike(fundingReceiver.name, `%${searchTrimmed}%`),
        ilike(schema.marketingFunding.id, `%${searchTrimmed}%`),
      );
      if (searchOr) conditions.push(searchOr);
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
      conditions.push(gte(schema.marketingFunding.sentAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.marketingFunding.sentAt, end));
    }
    void branchId;
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      const searchOr = or(
        ilike(fundingSender.name, `%${searchTrimmed}%`),
        ilike(fundingReceiver.name, `%${searchTrimmed}%`),
        ilike(schema.marketingFunding.id, `%${searchTrimmed}%`),
      );
      if (searchOr) conditions.push(searchOr);
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
    user: { id: string; role: string; permissions?: string[] },
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
      userPerms.includes(canonicalPermissionCode('marketing.funding.approve'));
    if (input.requesterId) {
      conditions.push(eq(schema.marketingFundingRequests.requesterId, input.requesterId));
    } else if (input.excludeSelfAsRequester) {
      conditions.push(ne(schema.marketingFundingRequests.requesterId, user.id));
    } else if (!canApproveFunding) {
      // Default visibility for non-approvers: own requests only.
      conditions.push(eq(schema.marketingFundingRequests.requesterId, user.id));
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
      conditions.push(gte(schema.marketingFundingRequests.createdAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.marketingFundingRequests.createdAt, end));
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

  async getFundingSummary(branchId?: string | null) {
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && branchUserIds.length === 0) {
      return {
        totalSent: '0',
        totalCompleted: '0',
        totalDisputed: '0',
      };
    }
    const branchScope = branchUserIds
      ? inArray(schema.marketingFunding.receiverId, branchUserIds)
      : undefined;

    const totalSent = await this.db
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(and(eq(schema.marketingFunding.status, 'SENT'), branchScope));

    const totalCompleted = await this.db
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(and(eq(schema.marketingFunding.status, 'COMPLETED'), branchScope));

    const totalDisputed = await this.db
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(and(eq(schema.marketingFunding.status, 'DISPUTED'), branchScope));

    return {
      totalSent: totalSent[0]?.total ?? '0',
      totalCompleted: totalCompleted[0]?.total ?? '0',
      totalDisputed: totalDisputed[0]?.total ?? '0',
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
      dateConditions.push(gte(schema.marketingFunding.sentAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      dateConditions.push(lte(schema.marketingFunding.sentAt, end));
    }

    // Total received (any status) — gives the headline number HoMs/MBs see.
    const incomingWhere = and(
      eq(schema.marketingFunding.receiverId, actorId),
      ...dateConditions,
    );
    const outgoingWhere = and(
      eq(schema.marketingFunding.senderId, actorId),
      ...dateConditions,
    );

    const [received, distributed, pendingReceiveRow, disputedReceiveRow, disputedSendRow] = await Promise.all([
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
        .where(and(eq(schema.marketingFunding.receiverId, actorId), eq(schema.marketingFunding.status, 'SENT'))),
      this.db
        .select({ c: count() })
        .from(schema.marketingFunding)
        .where(and(eq(schema.marketingFunding.receiverId, actorId), eq(schema.marketingFunding.status, 'DISPUTED'))),
      this.db
        .select({ c: count() })
        .from(schema.marketingFunding)
        .where(and(eq(schema.marketingFunding.senderId, actorId), eq(schema.marketingFunding.status, 'DISPUTED'))),
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
   * Funding balance for one user: COMPLETED funding received minus APPROVED ad spend.
   * Used for Media Buyers and Head of Marketing (HoM has no ad spend).
   */
  async getFundingBalance(
    userId: string,
    branchId?: string | null,
  ): Promise<{ totalReceived: string; totalSpend: string; balance: string }> {
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return { totalReceived: '0', totalSpend: '0', balance: '0' };
    }

    const [receivedRow] = await this.db
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(
        and(
          eq(schema.marketingFunding.receiverId, userId),
          eq(schema.marketingFunding.status, 'COMPLETED'),
        ),
      );

    const [spendRow] = await this.db
      .select({ total: sum(schema.adSpendLogs.spendAmount) })
      .from(schema.adSpendLogs)
      .where(
        and(
          eq(schema.adSpendLogs.mediaBuyerId, userId),
          eq(schema.adSpendLogs.status, 'APPROVED'),
          branchCampaignIds ? inArray(schema.adSpendLogs.campaignId, branchCampaignIds) : undefined,
        ),
      );

    const totalReceived = receivedRow?.total ?? '0';
    const totalSpend = spendRow?.total ?? '0';
    const received = Number(totalReceived);
    const spend = Number(totalSpend);
    const balance = String(Math.max(0, received - spend));

    return { totalReceived, totalSpend, balance };
  }

  /**
   * List funding balances for recipient users. Scoped by caller role:
   * - HEAD_OF_MARKETING: self + all Media Buyers
   * - SUPER_ADMIN / FINANCE_OFFICER: all Head of Marketing + all Media Buyers
   */
  async listFundingBalances(
    caller: { id: string; role: string; permissions?: string[] },
    branchId?: string | null,
  ): Promise<
    Array<{ userId: string; name: string; role: string; totalReceived: string; totalSpend: string; balance: string }>
  > {
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
        .where(inArray(schema.users.role, ['HEAD_OF_MARKETING', 'MEDIA_BUYER']));
      recipientUserIds.push(...recipients.map((r) => r.id));
    } else {
      // Non-global viewer (e.g. HoM without scope.global, or branch-scoped marketing reader)
      // sees themselves plus all Media Buyers (they fund MBs).
      recipientUserIds.push(caller.id);
      const mediaBuyers = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.role, 'MEDIA_BUYER'));
      for (const u of mediaBuyers) {
        if (u.id !== caller.id) recipientUserIds.push(u.id);
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

    const [fundingByReceiver, spendByMediaBuyer, userRows] = await Promise.all([
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
          mediaBuyerId: schema.adSpendLogs.mediaBuyerId,
          total: sum(schema.adSpendLogs.spendAmount),
        })
        .from(schema.adSpendLogs)
        .where(
          and(
            inArray(schema.adSpendLogs.mediaBuyerId, recipientUserIds),
            eq(schema.adSpendLogs.status, 'APPROVED'),
            branchCampaignIds ? inArray(schema.adSpendLogs.campaignId, branchCampaignIds) : undefined,
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
    const spendMap = new Map<string, string>();
    for (const s of spendByMediaBuyer) {
      spendMap.set(s.mediaBuyerId, s.total ?? '0');
    }

    const result: Array<{ userId: string; name: string; role: string; totalReceived: string; totalSpend: string; balance: string }> = [];
    for (const u of userRows) {
      const totalReceived = receivedMap.get(u.id) ?? '0';
      const totalSpend = spendMap.get(u.id) ?? '0';
      const balance = String(Math.max(0, Number(totalReceived) - Number(totalSpend)));
      result.push({
        userId: u.id,
        name: u.name,
        role: u.role,
        totalReceived,
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
  ): Promise<{ totalReceived: string; totalSpend: string; balance: string }> {
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

    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view this user\'s funding balance' });
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
  ): Promise<
    Array<{ id: string; name: string; role: string; isFinance: boolean; isPreferred: boolean; branchId: string | null }>
  > {
    const allowedRoles: Array<'FINANCE_OFFICER' | 'HEAD_OF_MARKETING'> =
      requesterRole === 'MEDIA_BUYER'
        ? ['FINANCE_OFFICER', 'HEAD_OF_MARKETING']
        : ['FINANCE_OFFICER'];

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
        and(
          eq(schema.users.status, 'ACTIVE' as const),
          inArray(schema.users.role, allowedRoles),
        ),
      );

    return rows
      .filter((r) => {
        // HoM target only valid for MB requesters; branch must match. Finance
        // is org-wide and always available regardless of branch.
        if (r.role === 'FINANCE_OFFICER') return true;
        if (requesterRole !== 'MEDIA_BUYER') return false;
        if (r.role !== 'HEAD_OF_MARKETING') return false;
        if (!branchId) return true;
        return r.primaryBranchId === branchId;
      })
      .map((r) => {
        const isFinance = r.role === 'FINANCE_OFFICER';
        const isHoM = r.role === 'HEAD_OF_MARKETING';
        // MB → HoM in their branch is the preferred / preselected default.
        // HoM → first Finance Officer is preferred.
        const isPreferred =
          requesterRole === 'MEDIA_BUYER'
            ? isHoM
            : isFinance;
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          isFinance,
          isPreferred,
          branchId: r.primaryBranchId ?? null,
        };
      })
      .sort((a, b) => {
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
    //   MB → HEAD_OF_MARKETING in the same branch, or any FINANCE_OFFICER / Finance hat (org-wide)
    //   HoM → any FINANCE_OFFICER / Finance hat (org-wide)
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
      const requesterIsMb = requesterRole === 'MEDIA_BUYER';
      if (!targetIsFinance && !(requesterIsMb && targetIsHoM)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: requesterIsMb
            ? 'Funding requests must be sent to a Head of Marketing or Finance Officer'
            : 'Funding requests must be sent to a Finance Officer',
        });
      }
      // Branch check for HoM targets only — Finance is org-wide.
      if (targetIsHoM && branchId) {
        if (target.primaryBranchId && target.primaryBranchId !== branchId) {
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create funding request' });
      }

      const [foundRequester] = await tx
        .select({ name: schema.users.name })
        .from(schema.users)
        .where(eq(schema.users.id, requesterId))
        .limit(1);

      return { request: inserted, requester: foundRequester };
    });

    const name = requester?.name ?? (requesterRole === 'HEAD_OF_MARKETING' ? 'Head of Marketing' : 'A Media Buyer');
    const bodySuffix = reason.trim() ? ` Reason: ${reason}` : '';
    const body = `${name} requested ₦${Number(amount).toLocaleString()}.${bodySuffix}`;

    if (validatedTargetUserId) {
      // Targeted notification — only the chosen recipient is notified.
      await this.notifications
        .create({
          userId: validatedTargetUserId,
          type: 'funding:request',
          title: 'Funding request',
          body,
          data: { requesterId, amount, reason: reason || null, requestId: request.id },
        })
        .catch(() => {});
    } else if (requesterRole === 'HEAD_OF_MARKETING') {
      const bodyWithAction = `${body} Disburse via Finance → Disbursements.`;
      await this.notifications
        .createForRole('SUPER_ADMIN', {
          type: 'funding:request',
          title: 'Funding request',
          body: bodyWithAction,
          data: { requesterId, amount, reason: reason || null, requestId: request.id },
        })
        .catch(() => {});
      await this.notifications
        .createForRole('FINANCE_OFFICER', {
          type: 'funding:request',
          title: 'Funding request',
          body: bodyWithAction,
          data: { requesterId, amount, reason: reason || null, requestId: request.id },
        })
        .catch(() => {});
    } else {
      await this.notifications
        .createForRole('HEAD_OF_MARKETING', {
          type: 'funding:request',
          title: 'Funding request',
          body,
          data: { requesterId, amount, reason: reason || null, requestId: request.id },
        })
        .catch(() => {});
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
      conditions.push(gte(schema.marketingFundingRequests.createdAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.marketingFundingRequests.createdAt, end));
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
    receiptUrl: string,
    actor: { id: string; role: string },
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
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Approved amount must be a positive number' });
    }
    if (sentCents > requestedCents) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Approved amount cannot exceed the requested amount',
      });
    }

    // Migration 0106 — only the request's targeted recipient (or admin-class)
    // can approve. Legacy NULL-target rows fall back to the historical role
    // gate (already enforced via the `marketing.funding.approve` permission).
    const isAdminClass = actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN';
    if (existing.targetUserId && existing.targetUserId !== actor.id && !isAdminClass) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the recipient of this funding request can approve it',
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
        tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, approverId)).limit(1),
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
      this.assertLedgerTransferAllowed(senderRole, receiverRole, { viaFundingRequest: true });

      if (senderRole === 'HEAD_OF_MARKETING' && receiverRole === 'MEDIA_BUYER') {
        const disbursable = await this.computeMarketingDisbursableInTx(tx, approverId, currentBranchId);
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update funding request' });
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create funding ledger row' });
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
    await this.notifications
      .create({
        userId: existing.requesterId,
        type: 'funding:approved',
        title: 'Funding request approved',
        body,
        data: {
          requestId: updated.id,
          receiptUrl: updated.receiptUrl,
          amount: sentAmount,
        },
      })
      .catch(() => {});

    return updated;
  }

  /**
   * Head of Marketing (or SuperAdmin) rejects a funding request. Notifies the Media Buyer.
   */
  async rejectFundingRequest(
    requestId: string,
    _reason: string | undefined,
    rejector: { id: string; role: string } | string,
  ) {
    const rejectorId = typeof rejector === 'string' ? rejector : rejector.id;
    const rejectorRole = typeof rejector === 'string' ? null : rejector.role;
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

    // Migration 0106 — only the request's targeted recipient (or admin-class)
    // can reject. Legacy NULL-target rows skip this gate (relies on the
    // `marketing.funding.approve` permission).
    const isAdminClass = rejectorRole === 'SUPER_ADMIN' || rejectorRole === 'ADMIN';
    if (existing.targetUserId && existing.targetUserId !== rejectorId && !isAdminClass) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only the recipient of this funding request can reject it',
      });
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update funding request' });
      }
      return row;
    });

    const amount = Number(existing.amount);
    await this.notifications
      .create({
        userId: existing.requesterId,
        type: 'funding:rejected',
        title: 'Funding request not approved',
        body: `Your funding request of ₦${amount.toLocaleString()} was not approved.`,
        data: { requestId: updated.id, amount },
      })
      .catch(() => {});

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
        ? (await transferQuery
            .where(eq(schema.marketingFunding.sourceFundingRequestId, input.requestId))
            .limit(1))[0]
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
      ? (await requestQuery.where(eq(schema.marketingFundingRequests.id, input.requestId)).limit(1))[0]
      : transferRow?.sourceFundingRequestId
        ? (await requestQuery
            .where(eq(schema.marketingFundingRequests.id, transferRow.sourceFundingRequestId))
            .limit(1))[0]
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

  async createAdSpend(
    input: CreateAdSpendInput,
    mediaBuyerId: string,
    branchId?: string | null,
  ) {
    return withActor(this.db, { id: mediaBuyerId }, async (tx) => {
      if (branchId) {
        const [campaign] = await tx
          .select({ id: schema.campaigns.id })
          .from(schema.campaigns)
          .where(and(eq(schema.campaigns.id, input.campaignId ?? ''), eq(schema.campaigns.branchId, branchId)))
          .limit(1);
        if (!campaign) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Campaign is not in your active branch' });
        }
      }

      // Screenshot is mandatory — enforced by Zod schema. status defaults to PENDING in DB.
      const platform = input.platform ?? 'FACEBOOK';
      const rows = await tx
        .insert(schema.adSpendLogs)
        .values({
          mediaBuyerId,
          productId: input.productId ?? '',
          campaignId: input.campaignId ?? '',
          spendAmount: sql`${String(input.spendAmount)}::numeric`,
          screenshotUrl: input.screenshotUrl,
          spendDate: new Date(input.spendDate),
          platform,
          platformCustomLabel:
            platform === 'OTHER' && input.platformCustomLabel ? input.platformCustomLabel : null,
          adUrl: input.adUrl ?? null,
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
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one expense line' });
    }
    // Branch fence: every campaign in the batch must belong to the actor's active branch.
    if (branchId) {
      const campaignIds = Array.from(new Set(input.lines.map((l) => l.campaignId)));
      const validCampaigns = await this.db
        .select({ id: schema.campaigns.id })
        .from(schema.campaigns)
        .where(
          and(
            inArray(schema.campaigns.id, campaignIds),
            eq(schema.campaigns.branchId, branchId),
          ),
        );
      if (validCampaigns.length !== campaignIds.length) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'One or more campaigns are not in your active branch',
        });
      }
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
              campaignId: line.campaignId,
              spendAmount: sql`${String(line.spendAmount)}::numeric`,
              screenshotUrl: line.screenshotUrl,
              spendDate: spendDateAt,
              platform,
              platformCustomLabel:
                platform === 'OTHER' && line.platformCustomLabel ? line.platformCustomLabel : null,
              adUrl: line.adUrl ?? null,
            };
          }),
        )
        .returning();
    });

    if (inserted.length !== input.lines.length) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log ad spend batch' });
    }

    // One notification per batch — not per line. HoM should never wake up to
    // 12 push pings because someone logged a busy day.
    const total = input.lines.reduce((acc, l) => acc + l.spendAmount, 0);

    // Personalize the body with the submitter's name + campaign(s) so HoM
    // can scan and triage at a glance instead of clicking through. Falls
    // back to "A Media Buyer" / no campaign when lookups fail (notifications
    // must never block the write).
    const uniqueCampaignIds = [...new Set(input.lines.map((l) => l.campaignId).filter((id): id is string => !!id))];
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
    const lineWord = input.lines.length === 1 ? 'line' : 'lines';

    this.notifications
      .createForRole('HEAD_OF_MARKETING', {
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
      })
      .catch(() => {});

    return { count: inserted.length, total: String(total) };
  }

  /** Head of Marketing / SuperAdmin: approve a PENDING ad spend entry. */
  async approveAdSpend(adSpendId: string, approverId: string) {
    const [existing] = await this.db
      .select()
      .from(schema.adSpendLogs)
      .where(eq(schema.adSpendLogs.id, adSpendId))
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ad spend record not found' });
    }
    if (existing.status !== 'PENDING') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only PENDING ad spend can be approved' });
    }

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

  /** Head of Marketing / SuperAdmin / Admin: reject a PENDING ad spend entry. */
  async rejectAdSpend(adSpendId: string, reason: string | undefined, rejectorId: string) {
    const [existing] = await this.db
      .select()
      .from(schema.adSpendLogs)
      .where(eq(schema.adSpendLogs.id, adSpendId))
      .limit(1);

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Ad spend record not found' });
    }
    if (existing.status !== 'PENDING') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only PENDING ad spend can be rejected' });
    }

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
    if (existing.status !== 'PENDING' && existing.status !== 'REJECTED') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only PENDING or REJECTED ad spend can be edited' });
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
        .where(and(eq(schema.campaigns.id, nextCampaignId), eq(schema.campaigns.branchId, branchId)))
        .limit(1);
      if (!campaign) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Campaign is not in your active branch' });
      }
    }

    const clearingRejection = existing.status === 'REJECTED';

    return withActor(this.db, { id: actor.id }, async (tx) => {
      const [row] = await tx
        .update(schema.adSpendLogs)
        .set({
          productId: nextProductId,
          campaignId: nextCampaignId,
          spendAmount: String(input.spendAmount),
          screenshotUrl: input.screenshotUrl,
          spendDate: new Date(input.spendDate),
          ...(clearingRejection
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
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update ad spend' });
      }
      return row;
    });
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
        .where(and(eq(schema.campaigns.id, input.campaignId), eq(schema.campaigns.branchId, branchId)))
        .limit(1);
      if (!campaign) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Campaign is not in your active branch' });
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
    });
  }

  async listAdSpend(input: ListAdSpendInput, branchId?: string | null) {
    const buyer = alias(schema.users, 'ad_spend_list_buyer');
    const prod = alias(schema.products, 'ad_spend_list_product');
    const camp = alias(schema.campaigns, 'ad_spend_list_campaign');

    const conditions: SQL[] = [];
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerId));
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
    if (input.startDate) {
      conditions.push(gte(schema.adSpendLogs.spendDate, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.adSpendLogs.spendDate, end));
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
      conditions.push(inArray(schema.adSpendLogs.campaignId, branchCampaignIds));
    }
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      const searchOr = or(
        ilike(buyer.name, `%${searchTrimmed}%`),
        ilike(prod.name, `%${searchTrimmed}%`),
        ilike(camp.name, `%${searchTrimmed}%`),
        ilike(schema.adSpendLogs.id, `%${searchTrimmed}%`),
        ilike(schema.adSpendLogs.platformCustomLabel, `%${searchTrimmed}%`),
      );
      if (searchOr) conditions.push(searchOr);
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

    // One snapshot query per row (limit ≤ 100). Batched SQL could reduce round-trips later.
    const enriched = await Promise.all(
      records.map(async (r) => {
        const spendYmd = this.spendDateToYmd(r.spendDate);
        const snap = await this.getAdSpendIntervalSnapshot({
          mediaBuyerId: r.mediaBuyerId,
          campaignId: r.campaignId,
          productId: r.productId,
          spendDate: spendYmd,
          spendAmount: Number(r.spendAmount),
          branchId,
        });
        return { ...r, orderCount: snap.orderCount, indicativeCpa: snap.indicativeCpa };
      }),
    );

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
    if (input.productId) {
      conditions.push(eq(schema.adSpendLogs.productId, input.productId));
    }
    if (input.campaignId) {
      conditions.push(eq(schema.adSpendLogs.campaignId, input.campaignId));
    }
    if (input.status) {
      conditions.push(eq(schema.adSpendLogs.status, input.status));
    }
    if (input.startDate) {
      conditions.push(gte(schema.adSpendLogs.spendDate, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.adSpendLogs.spendDate, end));
    }
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return {
        groups: [],
        pagination: { page, limit, total: 0 },
      };
    }
    if (branchCampaignIds) {
      conditions.push(inArray(schema.adSpendLogs.campaignId, branchCampaignIds));
    }
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      const searchOr = or(
        ilike(buyer.name, `%${searchTrimmed}%`),
        ilike(prod.name, `%${searchTrimmed}%`),
        ilike(camp.name, `%${searchTrimmed}%`),
        ilike(schema.adSpendLogs.id, `%${searchTrimmed}%`),
        ilike(schema.adSpendLogs.platformCustomLabel, `%${searchTrimmed}%`),
      );
      if (searchOr) conditions.push(searchOr);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const records = await this.db
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
      .where(whereClause)
      .orderBy(desc(schema.adSpendLogs.spendDate));

    type Line = (typeof records)[number];
    const byKey = new Map<
      string,
      {
        spendDate: string;
        mediaBuyerId: string;
        mediaBuyerName: string | null;
        lines: Line[];
      }
    >();
    for (const row of records) {
      const ymd = this.spendDateToYmd(row.spendDate);
      const key = `${ymd}::${row.mediaBuyerId}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.lines.push(row);
      } else {
        byKey.set(key, {
          spendDate: ymd,
          mediaBuyerId: row.mediaBuyerId,
          mediaBuyerName: row.mediaBuyerName,
          lines: [row],
        });
      }
    }

    const allGroups = Array.from(byKey.values()).map((g) => {
      const totalAmount = g.lines.reduce((acc, l) => acc + Number(l.spendAmount), 0);
      const statuses = new Set(g.lines.map((l) => l.status));
      let rolledStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | 'MIXED';
      if (statuses.has('PENDING')) rolledStatus = 'PENDING';
      else if (statuses.size === 1 && statuses.has('APPROVED')) rolledStatus = 'APPROVED';
      else if (statuses.size === 1 && statuses.has('REJECTED')) rolledStatus = 'REJECTED';
      else rolledStatus = 'MIXED';
      return {
        spendDate: g.spendDate,
        mediaBuyerId: g.mediaBuyerId,
        mediaBuyerName: g.mediaBuyerName,
        lineCount: g.lines.length,
        totalAmount: String(totalAmount),
        rolledStatus,
        lines: g.lines,
      };
    });

    allGroups.sort((a, b) => {
      if (a.spendDate !== b.spendDate) return a.spendDate < b.spendDate ? 1 : -1;
      return (a.mediaBuyerName ?? '').localeCompare(b.mediaBuyerName ?? '');
    });

    const total = allGroups.length;
    const start = (page - 1) * limit;
    const groups = allGroups.slice(start, start + limit);

    return {
      groups,
      pagination: { page, limit, total },
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
    if (input.productId) {
      conditions.push(eq(schema.adSpendLogs.productId, input.productId));
    }
    if (input.campaignId) {
      conditions.push(eq(schema.adSpendLogs.campaignId, input.campaignId));
    }
    if (input.startDate) {
      conditions.push(gte(schema.adSpendLogs.spendDate, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.adSpendLogs.spendDate, end));
    }
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    }
    if (branchCampaignIds) {
      conditions.push(inArray(schema.adSpendLogs.campaignId, branchCampaignIds));
    }
    const searchTrimmed = input.search?.trim();
    if (searchTrimmed) {
      const searchOr = or(
        ilike(buyer.name, `%${searchTrimmed}%`),
        ilike(prod.name, `%${searchTrimmed}%`),
        ilike(camp.name, `%${searchTrimmed}%`),
        ilike(schema.adSpendLogs.id, `%${searchTrimmed}%`),
      );
      if (searchOr) conditions.push(searchOr);
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
  ) {
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (startDate && endDate) {
      periodStart = new Date(startDate);
      periodEnd = new Date(endDate);
      periodEnd.setHours(23, 59, 59, 999);
    } else if (period === 'this_month') {
      periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    }

    const spendConditions: Parameters<typeof and>[0][] = [eq(schema.adSpendLogs.status, 'APPROVED')];
    const branchCampaignIds = await this.getBranchCampaignIds(branchId);
    if (branchCampaignIds && branchCampaignIds.length === 0) {
      return {
        totalSpend: 0,
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
    if (mediaBuyerId) spendConditions.push(eq(schema.adSpendLogs.mediaBuyerId, mediaBuyerId));
    if (branchCampaignIds) spendConditions.push(inArray(schema.adSpendLogs.campaignId, branchCampaignIds));
    if (periodStart) spendConditions.push(gte(schema.adSpendLogs.spendDate, periodStart));
    if (periodEnd) spendConditions.push(lte(schema.adSpendLogs.spendDate, periodEnd));
    const spendWhere = and(...spendConditions);

    const orderConditions: Parameters<typeof and>[0][] = [];
    if (mediaBuyerId) orderConditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
    if (branchId && !mediaBuyerId) orderConditions.push(eq(schema.orders.branchId, branchId));
    if (periodStart) orderConditions.push(gte(schema.orders.createdAt, periodStart));
    if (periodEnd) orderConditions.push(lte(schema.orders.createdAt, periodEnd));
    const orderWhere = orderConditions.length > 0 ? and(...orderConditions) : (mediaBuyerId ? eq(schema.orders.mediaBuyerId, mediaBuyerId) : undefined);

    const deliveredConditions: Parameters<typeof and>[0][] = [eq(schema.orders.status, 'DELIVERED')];
    if (mediaBuyerId) deliveredConditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
    if (branchId && !mediaBuyerId) deliveredConditions.push(eq(schema.orders.branchId, branchId));
    if (periodStart) deliveredConditions.push(gte(schema.orders.deliveredAt, periodStart));
    if (periodEnd) deliveredConditions.push(lte(schema.orders.deliveredAt, periodEnd));
    const deliveredWhere = and(...deliveredConditions);

    // Orders that CS have scheduled (reached CONFIRMED or beyond)
    const confirmedStatuses = [
      'CONFIRMED',
      'ALLOCATED',
      'DISPATCHED',
      'IN_TRANSIT',
      'DELIVERED',
      'PARTIALLY_DELIVERED',
      'RETURNED',
      'RESTOCKED',
      'WRITTEN_OFF',
      'COMPLETED',
    ] as const;
    const confirmedConditions: Parameters<typeof and>[0][] = [inArray(schema.orders.status, [...confirmedStatuses])];
    if (mediaBuyerId) confirmedConditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
    if (branchId && !mediaBuyerId) confirmedConditions.push(eq(schema.orders.branchId, branchId));
    if (periodStart) confirmedConditions.push(gte(schema.orders.createdAt, periodStart));
    if (periodEnd) confirmedConditions.push(lte(schema.orders.createdAt, periodEnd));
    const confirmedWhere = and(...confirmedConditions);

    const [
      totalSpendRows,
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
        .select({ count: count() })
        .from(schema.orders)
        .where(orderWhere),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(deliveredWhere),
      this.db
        .select({ total: sum(schema.orders.totalAmount) })
        .from(schema.orders)
        .where(deliveredWhere),
      this.db
        .select({ count: count() })
        .from(schema.orders)
        .where(confirmedWhere),
    ]);

    const totalSpend = Number(totalSpendRows[0]?.total ?? 0);
    const totalOrders = totalOrdersRows[0]?.count ?? 0;
    const deliveredOrders = deliveredOrdersRows[0]?.count ?? 0;
    const deliveredRevenue = Number(deliveredRevenueRows[0]?.total ?? 0);
    const confirmedOrders = confirmedOrdersRows[0]?.count ?? 0;
    const confirmationRate = totalOrders > 0 ? (confirmedOrders / totalOrders) * 100 : 0;

    return {
      totalSpend,
      totalOrders,
      deliveredOrders,
      deliveredRevenue,
      confirmedOrders,
      confirmationRate,
      cpa: totalOrders > 0 ? totalSpend / totalOrders : 0,
      trueRoas: totalSpend > 0 ? deliveredRevenue / totalSpend : 0,
      deliveryRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0,
    };
  }

  // ============================================
  // Media Buyer Leaderboard & CPA Alerts
  // ============================================

  async getMediaBuyerLeaderboard(
    period: 'this_month' | 'all_time' = 'this_month',
    startDate?: string,
    endDate?: string,
    branchId?: string | null,
  ) {
    // Include ALL active media buyers so the leaderboard is always populated,
    // not just those who have approved ad spend in the period.
    const allBuyers = await this.db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.role, 'MEDIA_BUYER'),
          eq(schema.users.status, 'ACTIVE'),
        ),
      );

    const branchUserIds = await this.getBranchUserIds(branchId);
    const eligibleBuyers = branchUserIds
      ? allBuyers.filter((buyer) => branchUserIds.includes(buyer.id))
      : allBuyers;

    const profitability = await this.getProfitabilityConfig();
    const leaderboard = await Promise.all(
      eligibleBuyers.map(async (buyer) => {
        const metrics = await this.getPerformanceMetrics(
          buyer.id,
          period,
          startDate,
          endDate,
          branchId,
        );
        const profitabilityScore =
          metrics.totalSpend > 0
            ? Math.min(1, metrics.trueRoas / profitability.targetRoas)
            : null;
        return {
          mediaBuyerId: buyer.id,
          name: buyer.name,
          email: buyer.email,
          ...metrics,
          profitabilityScore,
        };
      }),
    );

    // Sort by True ROAS descending, then by confirmation rate descending (tiebreaker)
    leaderboard.sort((a, b) => {
      if (b.trueRoas !== a.trueRoas) return b.trueRoas - a.trueRoas;
      return b.confirmationRate - a.confirmationRate;
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
    const alerts = leaderboard.filter(
      (buyer) => buyer.cpa > cpaThreshold && buyer.totalOrders > 0,
    );

    // Emit alerts and notify SuperAdmin + Head of Marketing for each high-CPA buyer
    for (const buyer of alerts) {
      this.events.emitToRoom('admin', 'marketing:high-cpa', {
        mediaBuyerId: buyer.mediaBuyerId,
        name: buyer.name,
        cpa: buyer.cpa,
        threshold: cpaThreshold,
      });
      this.notifications
        .createForRole('SUPER_ADMIN', {
          type: 'marketing:high_cpa',
          title: 'High CPA warning',
          body: `${buyer.name} has CPA ${buyer.cpa.toFixed(2)} (threshold: ${cpaThreshold}).`,
          data: { mediaBuyerId: buyer.mediaBuyerId, cpa: buyer.cpa, threshold: cpaThreshold },
        })
        .catch(() => {});
      this.notifications
        .createForRole('HEAD_OF_MARKETING', {
          type: 'marketing:high_cpa',
          title: 'High CPA warning',
          body: `${buyer.name} has CPA ${buyer.cpa.toFixed(2)} (threshold: ${cpaThreshold}).`,
          data: { mediaBuyerId: buyer.mediaBuyerId, cpa: buyer.cpa, threshold: cpaThreshold },
        })
        .catch(() => {});
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
      page?: number;
      limit?: number;
    },
    branchId?: string | null,
  ) {
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions: SQL[] = [];
    const callerPerms = (caller.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasCallerPerm = (code: string) =>
      caller.role === 'SUPER_ADMIN' || callerPerms.includes(canonicalPermissionCode(code));

    if (hasCallerPerm('marketing.scope.global')) {
      // Org-wide marketing scope (HoM, admin) → optionally narrow to a branch.
      if (branchId) conditions.push(eq(schema.crossFunnelAttempts.branchId, branchId));
    } else if (hasCallerPerm('marketing.read')) {
      // Branch-scoped marketing reader: only their own rows (MB) — broader marketing.read
      // without org-wide does NOT bleed into other MBs' funnels (Pillar 4).
      conditions.push(eq(schema.crossFunnelAttempts.mediaBuyerId, caller.id));
    } else {
      return { rows: [], total: 0, page, limit, totalPages: 0 };
    }

    if (input.startDate) {
      conditions.push(gte(schema.crossFunnelAttempts.attemptedAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.crossFunnelAttempts.attemptedAt, new Date(input.endDate)));
    }
    if (input.productId) {
      conditions.push(eq(schema.crossFunnelAttempts.productId, input.productId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [{ value: total } = { value: 0 }] = await this.db
      .select({ value: count() })
      .from(schema.crossFunnelAttempts)
      .where(whereClause);

    const productAlias = alias(schema.products, 'cfa_product');
    const winnerAlias = alias(schema.users, 'cfa_winner');
    const ownerAlias = alias(schema.users, 'cfa_owner');

    const rows = await this.db
      .select({
        id: schema.crossFunnelAttempts.id,
        customerName: schema.crossFunnelAttempts.customerName,
        attemptedAt: schema.crossFunnelAttempts.attemptedAt,
        productId: schema.crossFunnelAttempts.productId,
        productName: productAlias.name,
        mediaBuyerId: schema.crossFunnelAttempts.mediaBuyerId,
        mediaBuyerName: ownerAlias.name,
        campaignId: schema.crossFunnelAttempts.campaignId,
        originalOrderId: schema.crossFunnelAttempts.originalOrderId,
        originalMediaBuyerName: winnerAlias.name,
      })
      .from(schema.crossFunnelAttempts)
      .leftJoin(productAlias, eq(schema.crossFunnelAttempts.productId, productAlias.id))
      .leftJoin(
        winnerAlias,
        eq(schema.crossFunnelAttempts.originalMediaBuyerId, winnerAlias.id),
      )
      .leftJoin(ownerAlias, eq(schema.crossFunnelAttempts.mediaBuyerId, ownerAlias.id))
      .where(whereClause)
      .orderBy(desc(schema.crossFunnelAttempts.attemptedAt))
      .limit(limit)
      .offset(offset);

    return {
      rows,
      total: Number(total),
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(Number(total) / limit)),
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
  ) {
    const conditions: SQL[] = [];
    const callerPerms = (caller.permissions ?? []).map((p) => canonicalPermissionCode(p));
    const hasCallerPerm = (code: string) =>
      caller.role === 'SUPER_ADMIN' || callerPerms.includes(canonicalPermissionCode(code));

    if (hasCallerPerm('marketing.scope.global')) {
      if (branchId) conditions.push(eq(schema.crossFunnelAttempts.branchId, branchId));
    } else if (hasCallerPerm('marketing.read')) {
      conditions.push(eq(schema.crossFunnelAttempts.mediaBuyerId, caller.id));
    } else {
      return { totalAttempts: 0, uniqueCustomers: 0, perProduct: [] };
    }

    if (input.startDate) {
      conditions.push(gte(schema.crossFunnelAttempts.attemptedAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.crossFunnelAttempts.attemptedAt, new Date(input.endDate)));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totals = { totalAttempts: 0, uniqueCustomers: 0 }] = await this.db
      .select({
        totalAttempts: count(),
        uniqueCustomers: sql<number>`COUNT(DISTINCT ${schema.crossFunnelAttempts.customerPhoneHash})`,
      })
      .from(schema.crossFunnelAttempts)
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
          variants: input.variants ?? null,
          createdBy,
          status: 'ACTIVE',
        })
        .returning();

      const template = rows[0];
      if (!template) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create offer template' });
      }
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
      if (input.variants !== undefined) updateData['variants'] = input.variants;
      if (input.status !== undefined) updateData['status'] = input.status;

      const updated = await tx
        .update(schema.offerTemplates)
        .set(updateData)
        .where(eq(schema.offerTemplates.id, input.id))
        .returning();

      return updated[0];
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

    const [templates, totalRows] = await Promise.all([
      this.db.select().from(schema.offerTemplates).where(whereClause)
        .orderBy(desc(schema.offerTemplates.createdAt))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.offerTemplates).where(whereClause),
    ]);

    return {
      templates,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  // ============================================
  // Campaigns
  // ============================================

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

      const rows = await tx
        .insert(schema.campaigns)
        .values({
          mediaBuyerId,
          name: input.name,
          productIds: input.productIds,
          deploymentType: input.deploymentType,
          formConfig: input.formConfig ?? null,
          status: 'ACTIVE',
          branchId: branchId ?? null,
        })
        .returning();

      const campaign = rows[0];
      if (!campaign) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create campaign' });
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
      if (input.status !== undefined) updateData['status'] = input.status;

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
      .where(and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.status, 'ACTIVE'),
      ))
      .limit(1);

    const campaign = campaignRows[0];
    if (!campaign) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found or inactive' });
    }

    // Load products directly from productIds
    const products: Array<{
      id: string;
      name: string;
      price: string;
      offers: Array<{ label: string; qty: number; price: string; imageUrls?: string[] }>;
    }> = [];

    const pIds = (campaign.productIds ?? []) as string[];
    for (const pid of pIds) {
      const pRows = await this.db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          baseSalePrice: schema.products.baseSalePrice,
          offers: schema.products.offers,
        })
        .from(schema.products)
        .where(eq(schema.products.id, pid))
        .limit(1);

      const p = pRows[0];
      if (p) {
        const productOffers = (p.offers ?? []) as Array<{
          label: string;
          qty: number;
          price: string;
          imageUrls?: string[];
        }>;
        products.push({
          id: p.id,
          name: p.name,
          price: p.baseSalePrice,
          offers: productOffers.length > 0 ? productOffers : [{ label: 'Standard', qty: 1, price: p.baseSalePrice }],
        });
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
    }
    if (input.status) {
      conditions.push(eq(schema.campaigns.status, input.status));
    }
    if (branchId) {
      conditions.push(eq(schema.campaigns.branchId, branchId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [campaigns, totalRows] = await Promise.all([
      this.db.select().from(schema.campaigns).where(whereClause)
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.campaigns).where(whereClause),
    ]);

    const mediaBuyerIds = [...new Set(campaigns.map((c) => c.mediaBuyerId).filter(Boolean))] as string[];
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
        mediaBuyerName: c.mediaBuyerId ? mediaBuyerNames.get(c.mediaBuyerId) ?? null : null,
      })),
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }
}
