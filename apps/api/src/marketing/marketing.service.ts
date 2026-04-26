import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, ne, and, desc, gte, lte, count, sum, inArray, or, ilike, getTableColumns, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type {
  CreateFundingInput,
  VerifyFundingInput,
  ListFundingInput,
  FundingStatusCountsInput,
  FundingRequestStatusCountsInput,
  CreateAdSpendInput,
  ListAdSpendInput,
  AdSpendStatusCountsInput,
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

@Injectable()
export class MarketingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async getBranchUserIds(branchId?: string | null): Promise<string[] | null> {
    if (!branchId) return null;
    const rows = await this.db
      .select({ userId: schema.userBranches.userId })
      .from(schema.userBranches)
      .where(eq(schema.userBranches.branchId, branchId));
    return rows.map((row) => row.userId);
  }

  private async getBranchCampaignIds(branchId?: string | null): Promise<string[] | null> {
    if (!branchId) return null;
    const rows = await this.db
      .select({ id: schema.campaigns.id })
      .from(schema.campaigns)
      .where(eq(schema.campaigns.branchId, branchId));
    return rows.map((row) => row.id);
  }

  // ============================================
  // Marketing Funding
  // ============================================

  async createFunding(input: CreateFundingInput, senderId: string) {
    const funding = await withActor(this.db, { id: senderId }, async (tx) => {
      // Validate sender → receiver flow: SA/FO → HoM (tier 1), HoM → Media Buyer (tier 2)
      const [sender, receiver] = await Promise.all([
        tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, senderId)).limit(1),
        tx.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, input.receiverId)).limit(1),
      ]);
      const receiverRole = receiver[0]?.role;
      const senderRole = sender[0]?.role;
      if (!receiverRole || !senderRole) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Sender or receiver not found' });
      }
      if (receiverRole === 'HEAD_OF_MARKETING') {
        if (senderRole !== 'SUPER_ADMIN' && senderRole !== 'ADMIN' && senderRole !== 'FINANCE_OFFICER') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Super Admin or Finance Officer can disburse to Head of Marketing' });
        }
      } else if (receiverRole === 'MEDIA_BUYER') {
        if (senderRole !== 'HEAD_OF_MARKETING') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Marketing can disburse to Media Buyers' });
        }
      } else {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Receiver must be Head of Marketing or Media Buyer' });
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
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && branchUserIds.length === 0) {
      return {
        records: [],
        pagination: { page: input.page, limit: input.limit, total: 0 },
      };
    }
    if (branchUserIds) {
      conditions.push(inArray(schema.marketingFunding.receiverId, branchUserIds));
    }
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
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && branchUserIds.length === 0) {
      return { SENT: 0, COMPLETED: 0, DISPUTED: 0, ALL: 0 };
    }
    if (branchUserIds) {
      conditions.push(inArray(schema.marketingFunding.receiverId, branchUserIds));
    }
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
    user: { id: string; role: string },
    branchId?: string | null,
  ) {
    const conditions: SQL[] = [];

    // Direction filters — `requesterId` ("My Requests" view) and `excludeSelfAsRequester`
    // ("MB Requests" inbox view, HoM-side) are mutually exclusive in practice; if both
    // are set the explicit `requesterId` wins.
    if (input.requesterId) {
      conditions.push(eq(schema.marketingFundingRequests.requesterId, input.requesterId));
    } else if (input.excludeSelfAsRequester) {
      conditions.push(ne(schema.marketingFundingRequests.requesterId, user.id));
    } else if (user.role === 'MEDIA_BUYER') {
      // Default MB visibility: own requests only.
      conditions.push(eq(schema.marketingFundingRequests.requesterId, user.id));
    }
    if (input.startDate) {
      conditions.push(gte(schema.marketingFundingRequests.createdAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      const end = new Date(input.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(schema.marketingFundingRequests.createdAt, end));
    }
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && branchUserIds.length === 0) {
      return { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
    }
    if (branchUserIds) {
      conditions.push(inArray(schema.marketingFundingRequests.requesterId, branchUserIds));
    }
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
  async listFundingBalances(caller: { id: string; role: string }, branchId?: string | null): Promise<
    Array<{ userId: string; name: string; role: string; totalReceived: string; totalSpend: string; balance: string }>
  > {
    const isHoM = caller.role === 'HEAD_OF_MARKETING';
    const recipientUserIds: string[] = [];

    if (isHoM) {
      recipientUserIds.push(caller.id);
      const mediaBuyers = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.role, 'MEDIA_BUYER'));
      for (const u of mediaBuyers) {
        if (u.id !== caller.id) recipientUserIds.push(u.id);
      }
    } else {
      const recipients = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.role, ['HEAD_OF_MARKETING', 'MEDIA_BUYER']));
      recipientUserIds.push(...recipients.map((r) => r.id));
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
    if ((caller.role === 'SUPER_ADMIN' || caller.role === 'ADMIN') || caller.role === 'FINANCE_OFFICER') {
      return this.getFundingBalance(userId, branchId);
    }
    if (caller.role === 'HEAD_OF_MARKETING' && targetRole === 'MEDIA_BUYER') {
      return this.getFundingBalance(userId, branchId);
    }
    const perms = caller.permissions ?? [];
    if (perms.includes('users.read')) {
      return this.getFundingBalance(userId, branchId);
    }

    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view this user\'s funding balance' });
  }

  /**
   * Media Buyer or Head of Marketing requests funds. Persists the request.
   * Media Buyer → notifies Head of Marketing. Head of Marketing → notifies SuperAdmin + Finance Officer.
   */
  async requestFunding(
    amount: number,
    reason: string,
    requesterId: string,
    requesterRole: 'MEDIA_BUYER' | 'HEAD_OF_MARKETING',
    branchId?: string | null,
  ) {
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && !branchUserIds.includes(requesterId)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Requester is not in the active branch' });
    }

    const { request, requester } = await withActor(this.db, { id: requesterId }, async (tx) => {
      const rows = await tx
        .insert(schema.marketingFundingRequests)
        .values({
          requesterId,
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

    if (requesterRole === 'HEAD_OF_MARKETING') {
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
    const branchUserIds = await this.getBranchUserIds(branchId);
    if (branchUserIds && branchUserIds.length === 0) {
      return {
        records: [],
        pagination: { page: input.page, limit: input.limit, total: 0 },
      };
    }
    if (branchUserIds) {
      conditions.push(inArray(schema.marketingFundingRequests.requesterId, branchUserIds));
    }
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
   * Head of Marketing (or SuperAdmin) approves a funding request: money sent manually, then receipt attached.
   * Notifies the Media Buyer so they can preview the receipt.
   */
  async approveFundingRequest(
    requestId: string,
    receiptUrl: string,
    approverId: string,
  ) {
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

    const updated = await withActor(this.db, { id: approverId }, async (tx) => {
      const [row] = await tx
        .update(schema.marketingFundingRequests)
        .set({
          status: 'APPROVED',
          receiptUrl,
          resolvedAt: new Date(),
          resolvedBy: approverId,
        })
        .where(eq(schema.marketingFundingRequests.id, requestId))
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update funding request' });
      }
      return row;
    });

    const amount = Number(existing.amount);
    const body = `Your funding request of ₦${amount.toLocaleString()} was approved. You can view the receipt in Marketing → Funding.`;
    await this.notifications
      .create({
        userId: existing.requesterId,
        type: 'funding:approved',
        title: 'Funding request approved',
        body,
        data: {
          requestId: updated.id,
          receiptUrl: updated.receiptUrl,
          amount: amount,
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
    rejectorId: string,
  ) {
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
      const rows = await tx
        .insert(schema.adSpendLogs)
        .values({
          mediaBuyerId,
          productId: input.productId ?? '',
          campaignId: input.campaignId ?? '',
          spendAmount: String(input.spendAmount),
          screenshotUrl: input.screenshotUrl,
          spendDate: new Date(input.spendDate),
        })
        .returning();

      const spend = rows[0];
      if (!spend) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to log ad spend' });
      }
      return spend;
    });
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

    return {
      records,
      totalSpend: totalSpendRows[0]?.total ?? '0',
      pagination: { page: input.page, limit: input.limit, total: Number(totalRows[0]?.count ?? 0) },
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
      return { PENDING: 0, APPROVED: 0, ALL: 0 };
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

    const out = { PENDING: 0, APPROVED: 0, ALL: 0 };
    for (const r of rows) {
      const n = Number(r.c);
      if (r.status === 'PENDING') out.PENDING = n;
      else if (r.status === 'APPROVED') out.APPROVED = n;
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

    const leaderboard = await Promise.all(
      eligibleBuyers.map(async (buyer) => {
        const metrics = await this.getPerformanceMetrics(
          buyer.id,
          period,
          startDate,
          endDate,
          branchId,
        );
        return {
          mediaBuyerId: buyer.id,
          name: buyer.name,
          email: buyer.email,
          ...metrics,
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
      offers: Array<{ label: string; qty: number; price: string }>;
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
        const productOffers = (p.offers ?? []) as Array<{ label: string; qty: number; price: string }>;
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
