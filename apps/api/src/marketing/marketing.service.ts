import { Injectable, Inject } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, gte, lte, count, sum, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type {
  CreateFundingInput,
  VerifyFundingInput,
  ListFundingInput,
  CreateAdSpendInput,
  ListAdSpendInput,
  CreateOfferTemplateInput,
  UpdateOfferTemplateInput,
  ListOfferTemplatesInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsInput,
} from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { EventsService } from '../events/events.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class MarketingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly events: EventsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ============================================
  // Marketing Funding
  // ============================================

  async createFunding(input: CreateFundingInput, senderId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${senderId}, true)`;

    // Validate sender → receiver flow: SA/FO → HoM (tier 1), HoM → Media Buyer (tier 2)
    const [sender, receiver] = await Promise.all([
      this.db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, senderId)).limit(1),
      this.db.select({ role: schema.users.role }).from(schema.users).where(eq(schema.users.id, input.receiverId)).limit(1),
    ]);
    const receiverRole = receiver[0]?.role;
    const senderRole = sender[0]?.role;
    if (!receiverRole || !senderRole) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Sender or receiver not found' });
    }
    if (receiverRole === 'HEAD_OF_MARKETING') {
      if (senderRole !== 'SUPER_ADMIN' && senderRole !== 'FINANCE_OFFICER') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Super Admin or Finance Officer can disburse to Head of Marketing' });
      }
    } else if (receiverRole === 'MEDIA_BUYER') {
      if (senderRole !== 'HEAD_OF_MARKETING') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Head of Marketing can disburse to Media Buyers' });
      }
    } else {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Receiver must be Head of Marketing or Media Buyer' });
    }

    const rows = await this.db
      .insert(schema.marketingFunding)
      .values({
        senderId,
        receiverId: input.receiverId,
        amount: String(input.amount),
        receiptUrl: input.receiptUrl,
        status: 'SENT',
      })
      .returning();

    const funding = rows[0];
    if (!funding) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create funding' });
    }

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
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${receiverId}, true)`;

    const rows = await this.db
      .select()
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.id, input.fundingId))
      .limit(1);

    const funding = rows[0];
    if (!funding) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Funding record not found' });
    }

    if (funding.receiverId !== receiverId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the receiver can verify this funding' });
    }

    if (funding.status !== 'SENT') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Funding has already been verified' });
    }

    if (input.action === 'DISPUTED' && (!input.disputeReason || input.disputeReason.length < 10)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Dispute requires a reason with at least 10 characters' });
    }

    const updated = await this.db
      .update(schema.marketingFunding)
      .set({
        status: input.action,
        verifiedAt: new Date(),
      })
      .where(eq(schema.marketingFunding.id, input.fundingId))
      .returning();

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

  async listFunding(input: ListFundingInput) {
    const conditions = [];
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
      conditions.push(lte(schema.marketingFunding.sentAt, new Date(input.endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [records, totalRows] = await Promise.all([
      this.db.select().from(schema.marketingFunding).where(whereClause)
        .orderBy(desc(schema.marketingFunding.sentAt))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.marketingFunding).where(whereClause),
    ]);

    return {
      records,
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async getFundingSummary() {
    const totalSent = await this.db
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.status, 'SENT'));

    const totalCompleted = await this.db
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.status, 'COMPLETED'));

    const totalDisputed = await this.db
      .select({ total: sum(schema.marketingFunding.amount) })
      .from(schema.marketingFunding)
      .where(eq(schema.marketingFunding.status, 'DISPUTED'));

    return {
      totalSent: totalSent[0]?.total ?? '0',
      totalCompleted: totalCompleted[0]?.total ?? '0',
      totalDisputed: totalDisputed[0]?.total ?? '0',
    };
  }

  /**
   * Funding balance for one user: COMPLETED funding received minus APPROVED ad spend.
   * Used for Media Buyers and Head of Marketing (HoM has no ad spend).
   */
  async getFundingBalance(userId: string): Promise<{ totalReceived: string; totalSpend: string; balance: string }> {
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
  async listFundingBalances(caller: { id: string; role: string }): Promise<
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

    if (recipientUserIds.length === 0) {
      return [];
    }

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
      return this.getFundingBalance(userId);
    }
    if (caller.role === 'SUPER_ADMIN' || caller.role === 'FINANCE_OFFICER') {
      return this.getFundingBalance(userId);
    }
    if (caller.role === 'HEAD_OF_MARKETING' && targetRole === 'MEDIA_BUYER') {
      return this.getFundingBalance(userId);
    }
    const perms = caller.permissions ?? [];
    if (perms.includes('users.read')) {
      return this.getFundingBalance(userId);
    }

    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have permission to view this user\'s funding balance' });
  }

  /**
   * Media Buyer requests funds. Persists the request and notifies Head of Marketing only.
   */
  async requestFunding(amount: number, reason: string, requesterId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${requesterId}, true)`;

    const rows = await this.db
      .insert(schema.marketingFundingRequests)
      .values({
        requesterId,
        amount: String(amount),
        reason: reason.trim() || null,
        status: 'PENDING',
      })
      .returning();

    const request = rows[0];
    if (!request) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create funding request' });
    }

    const [requester] = await this.db
      .select({ name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.id, requesterId))
      .limit(1);

    const name = requester?.name ?? 'A Media Buyer';
    const body = reason.trim()
      ? `${name} requested ₦${Number(amount).toLocaleString()}. Reason: ${reason}`
      : `${name} requested ₦${Number(amount).toLocaleString()}`;

    await this.notifications
      .createForRole('HEAD_OF_MARKETING', {
        type: 'funding:request',
        title: 'Funding request',
        body,
        data: { requesterId, amount, reason: reason || null, requestId: request.id },
      })
      .catch(() => {});

    return request;
  }

  /**
   * List funding requests. Media Buyer: only their own. HoM/Admin: can filter by requesterId or get all.
   */
  async listFundingRequests(input: { requesterId?: string; page: number; limit: number }) {
    const conditions = [];
    if (input.requesterId) {
      conditions.push(eq(schema.marketingFundingRequests.requesterId, input.requesterId));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [records, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.marketingFundingRequests)
        .where(whereClause)
        .orderBy(desc(schema.marketingFundingRequests.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db.select({ count: count() }).from(schema.marketingFundingRequests).where(whereClause),
    ]);

    return {
      records,
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

    await this.pgClient`SELECT set_config('yannis.current_user_id', ${approverId}, true)`;

    const [updated] = await this.db
      .update(schema.marketingFundingRequests)
      .set({
        status: 'APPROVED',
        receiptUrl,
        resolvedAt: new Date(),
        resolvedBy: approverId,
      })
      .where(eq(schema.marketingFundingRequests.id, requestId))
      .returning();

    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update funding request' });
    }

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

    await this.pgClient`SELECT set_config('yannis.current_user_id', ${rejectorId}, true)`;

    const [updated] = await this.db
      .update(schema.marketingFundingRequests)
      .set({
        status: 'REJECTED',
        resolvedAt: new Date(),
        resolvedBy: rejectorId,
      })
      .where(eq(schema.marketingFundingRequests.id, requestId))
      .returning();

    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update funding request' });
    }

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

  async createAdSpend(input: CreateAdSpendInput, mediaBuyerId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${mediaBuyerId}, true)`;

    // Screenshot is mandatory — enforced by Zod schema. status defaults to PENDING in DB.
    const rows = await this.db
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

    await this.pgClient`SELECT set_config('yannis.current_user_id', ${approverId}, true)`;

    const [updated] = await this.db
      .update(schema.adSpendLogs)
      .set({
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: approverId,
      })
      .where(eq(schema.adSpendLogs.id, adSpendId))
      .returning();

    if (!updated) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to approve ad spend' });
    }
    return updated;
  }

  async listAdSpend(input: ListAdSpendInput) {
    const conditions = [];
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
      conditions.push(lte(schema.adSpendLogs.spendDate, new Date(input.endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [records, totalRows, totalSpendRows] = await Promise.all([
      this.db.select().from(schema.adSpendLogs).where(whereClause)
        .orderBy(desc(schema.adSpendLogs.spendDate))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.adSpendLogs).where(whereClause),
      this.db.select({ total: sum(schema.adSpendLogs.spendAmount) })
        .from(schema.adSpendLogs).where(whereClause),
    ]);

    return {
      records,
      totalSpend: totalSpendRows[0]?.total ?? '0',
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async getPerformanceMetrics(
    mediaBuyerId?: string,
    period: 'this_month' | 'all_time' = 'this_month',
    startDate?: string,
    endDate?: string,
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
    if (mediaBuyerId) spendConditions.push(eq(schema.adSpendLogs.mediaBuyerId, mediaBuyerId));
    if (periodStart) spendConditions.push(gte(schema.adSpendLogs.spendDate, periodStart));
    if (periodEnd) spendConditions.push(lte(schema.adSpendLogs.spendDate, periodEnd));
    const spendWhere = and(...spendConditions);

    const orderConditions: Parameters<typeof and>[0][] = [];
    if (mediaBuyerId) orderConditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
    if (periodStart) orderConditions.push(gte(schema.orders.createdAt, periodStart));
    if (periodEnd) orderConditions.push(lte(schema.orders.createdAt, periodEnd));
    const orderWhere = orderConditions.length > 0 ? and(...orderConditions) : (mediaBuyerId ? eq(schema.orders.mediaBuyerId, mediaBuyerId) : undefined);

    const deliveredConditions: Parameters<typeof and>[0][] = [eq(schema.orders.status, 'DELIVERED')];
    if (mediaBuyerId) deliveredConditions.push(eq(schema.orders.mediaBuyerId, mediaBuyerId));
    if (periodStart) deliveredConditions.push(gte(schema.orders.deliveredAt, periodStart));
    if (periodEnd) deliveredConditions.push(lte(schema.orders.deliveredAt, periodEnd));
    const deliveredWhere = and(...deliveredConditions);

    const totalSpendRows = await this.db
      .select({ total: sum(schema.adSpendLogs.spendAmount) })
      .from(schema.adSpendLogs)
      .where(spendWhere);

    const totalOrdersRows = await this.db
      .select({ count: count() })
      .from(schema.orders)
      .where(orderWhere);

    const deliveredOrdersRows = await this.db
      .select({ count: count() })
      .from(schema.orders)
      .where(deliveredWhere);

    const deliveredRevenueRows = await this.db
      .select({ total: sum(schema.orders.totalAmount) })
      .from(schema.orders)
      .where(deliveredWhere);

    const totalSpend = Number(totalSpendRows[0]?.total ?? 0);
    const totalOrders = totalOrdersRows[0]?.count ?? 0;
    const deliveredOrders = deliveredOrdersRows[0]?.count ?? 0;
    const deliveredRevenue = Number(deliveredRevenueRows[0]?.total ?? 0);

    return {
      totalSpend,
      totalOrders,
      deliveredOrders,
      deliveredRevenue,
      cpa: totalOrders > 0 ? totalSpend / totalOrders : 0,
      trueRoas: totalSpend > 0 ? deliveredRevenue / totalSpend : 0,
      deliveryRate: totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0,
    };
  }

  // ============================================
  // Media Buyer Leaderboard & CPA Alerts
  // ============================================

  async getMediaBuyerLeaderboard(period: 'this_month' | 'all_time' = 'this_month', startDate?: string, endDate?: string) {
    const useCustomRange = startDate && endDate;
    const periodStart = useCustomRange
      ? new Date(startDate)
      : period === 'this_month'
        ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        : null;
    let periodEnd: Date | null = useCustomRange ? new Date(endDate) : null;
    if (periodEnd) periodEnd.setHours(23, 59, 59, 999);

    const buyersQuery = this.db
      .selectDistinct({ mediaBuyerId: schema.adSpendLogs.mediaBuyerId })
      .from(schema.adSpendLogs);
    const buyerWhereConditions: Parameters<typeof and>[0][] = [eq(schema.adSpendLogs.status, 'APPROVED')];
    if (periodStart && periodEnd) {
      buyerWhereConditions.push(gte(schema.adSpendLogs.spendDate, periodStart), lte(schema.adSpendLogs.spendDate, periodEnd));
    } else if (periodStart) {
      buyerWhereConditions.push(gte(schema.adSpendLogs.spendDate, periodStart));
    }
    const buyerWhere = and(...buyerWhereConditions);
    const buyers = await buyersQuery.where(buyerWhere);

    const leaderboard = await Promise.all(
      buyers.map(async (b) => {
        const metrics = await this.getPerformanceMetrics(b.mediaBuyerId, period, startDate, endDate);
        const userRows = await this.db
          .select({ name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, b.mediaBuyerId))
          .limit(1);
        return {
          mediaBuyerId: b.mediaBuyerId,
          name: userRows[0]?.name ?? 'Unknown',
          email: userRows[0]?.email ?? '',
          ...metrics,
        };
      }),
    );

    // Sort by True ROAS descending (best performer first)
    leaderboard.sort((a, b) => b.trueRoas - a.trueRoas);

    return leaderboard;
  }

  async checkHighCpaAlerts(cpaThreshold: number) {
    const leaderboard = await this.getMediaBuyerLeaderboard();
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
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${createdBy}, true)`;

    // Verify product exists
    const productRows = await this.db
      .select()
      .from(schema.products)
      .where(eq(schema.products.id, input.productId))
      .limit(1);

    if (productRows.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const rows = await this.db
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
  }

  async updateOfferTemplate(input: UpdateOfferTemplateInput, actorId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;

    const existing = await this.db
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

    const updated = await this.db
      .update(schema.offerTemplates)
      .set(updateData)
      .where(eq(schema.offerTemplates.id, input.id))
      .returning();

    return updated[0];
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

  async createCampaign(input: CreateCampaignInput, mediaBuyerId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${mediaBuyerId}, true)`;

    const rows = await this.db
      .insert(schema.campaigns)
      .values({
        mediaBuyerId,
        name: input.name,
        productIds: input.productIds,
        deploymentType: input.deploymentType,
        formConfig: input.formConfig ?? null,
        status: 'ACTIVE',
      })
      .returning();

    const campaign = rows[0];
    if (!campaign) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create campaign' });
    }
    return campaign;
  }

  async updateCampaign(input: UpdateCampaignInput, actorId: string) {
    await this.pgClient`SELECT set_config('yannis.current_user_id', ${actorId}, true)`;

    const existing = await this.db
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

    const updated = await this.db
      .update(schema.campaigns)
      .set(updateData)
      .where(eq(schema.campaigns.id, input.id))
      .returning();

    return updated[0];
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

  async listCampaigns(input: ListCampaignsInput) {
    const conditions = [];
    if (input.mediaBuyerId) {
      conditions.push(eq(schema.campaigns.mediaBuyerId, input.mediaBuyerId));
    }
    if (input.status) {
      conditions.push(eq(schema.campaigns.status, input.status));
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
    let mediaBuyerNames: Map<string, string> = new Map();
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
