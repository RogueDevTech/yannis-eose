import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, gte, lte, count, sum, sql, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type {
  CreateInvoiceInput,
  UpdateInvoiceStatusInput,
  ListInvoicesInput,
  ProfitReportInput,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  ListApprovalRequestsInput,
  SetBudgetInput,
} from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor } from '../common/db/with-actor';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Refresh the finance materialized views every 15 minutes so the CEO Executive dashboard
   * (which reads from them via `getFastProfitReport`) doesn't drift out of sync with live
   * orders / payouts / ad spend. CEO requested live numbers — 15 min is a good balance between
   * freshness and CPU: REFRESH CONCURRENTLY is cheap on small datasets and scales linearly.
   */
  @Cron('0 */15 * * * *')
  async refreshMaterializedViewsCron() {
    try {
      const results = await this.refreshMaterializedViews();
      const failures = Object.entries(results).filter(([, ok]) => ok !== true);
      if (failures.length > 0) {
        this.logger.warn(`mv_refresh_cron partial_failure count=${failures.length} views=${failures.map(([n]) => n).join(',')}`);
      } else {
        this.logger.log(`mv_refresh_cron success count=${Object.keys(results).length}`);
      }
    } catch (err) {
      this.logger.error(`mv_refresh_cron error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ============================================
  // Invoices
  // ============================================

  async createInvoice(input: CreateInvoiceInput, actorId: string) {
    // Calculate total from line items + tax
    const subtotal = input.lineItems.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    const taxRate = input.taxRate ?? 0;
    const totalAmount = subtotal * (1 + taxRate);

    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.invoices)
        .values({
          orderId: input.orderId ?? null,
          recipientInfo: input.recipientInfo,
          lineItems: input.lineItems,
          taxRate: input.taxRate != null ? String(input.taxRate) : null,
          totalAmount: totalAmount.toFixed(2),
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          status: 'DRAFT',
        })
        .returning();

      const invoice = rows[0];
      if (!invoice) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create invoice' });
      }

      return {
        ...invoice,
        referenceFormatted: this.formatReference(invoice.referenceNumber),
      };
    });
  }

  async updateInvoiceStatus(input: UpdateInvoiceStatusInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .update(schema.invoices)
        .set({ status: input.status })
        .where(eq(schema.invoices.id, input.invoiceId))
        .returning();

      if (!rows[0]) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
      }

      return {
        ...rows[0],
        referenceFormatted: this.formatReference(rows[0].referenceNumber),
      };
    });
  }

  async getInvoiceById(invoiceId: string) {
    const rows = await this.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId))
      .limit(1);

    if (!rows[0]) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
    }

    return {
      ...rows[0],
      referenceFormatted: this.formatReference(rows[0].referenceNumber),
    };
  }

  async listInvoices(input: ListInvoicesInput) {
    const conditions = [];
    if (input.status) {
      conditions.push(eq(schema.invoices.status, input.status));
    }
    if (input.startDate) {
      conditions.push(gte(schema.invoices.createdAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      conditions.push(lte(schema.invoices.createdAt, new Date(input.endDate)));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [invoices, totalRows] = await Promise.all([
      this.db.select().from(schema.invoices).where(whereClause)
        .orderBy(desc(schema.invoices.createdAt))
        .limit(input.limit).offset(offset),
      this.db.select({ count: count() }).from(schema.invoices).where(whereClause),
    ]);

    return {
      invoices: invoices.map((inv) => ({
        ...inv,
        referenceFormatted: this.formatReference(inv.referenceNumber),
      })),
      pagination: { page: input.page, limit: input.limit, total: totalRows[0]?.count ?? 0 },
    };
  }

  async getInvoiceSummary() {
    const statusCounts = await this.db
      .select({ status: schema.invoices.status, count: count(), total: sum(schema.invoices.totalAmount) })
      .from(schema.invoices)
      .groupBy(schema.invoices.status);

    const summary: Record<string, { count: number; total: string }> = {};
    for (const row of statusCounts) {
      summary[row.status] = { count: row.count, total: row.total ?? '0' };
    }
    return summary;
  }

  // ============================================
  // Profit Reports
  // ============================================

  async getProfitReport(input: ProfitReportInput) {
    // ── 1. Revenue from delivered orders ──────────────────
    const orderConditions = [];
    if (input.startDate) {
      orderConditions.push(gte(schema.orders.deliveredAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      orderConditions.push(lte(schema.orders.deliveredAt, new Date(input.endDate)));
    }
    if (input.branchId) {
      orderConditions.push(eq(schema.orders.branchId, input.branchId));
    }
    orderConditions.push(eq(schema.orders.status, 'DELIVERED'));
    const orderWhere = and(...orderConditions);

    // ── 2. Ad spend date range (only APPROVED counts toward profit) ───────────────────────────
    const adSpendConditions = [eq(schema.adSpendLogs.status, 'APPROVED')];
    if (input.startDate) {
      adSpendConditions.push(gte(schema.adSpendLogs.spendDate, new Date(input.startDate)));
    }
    if (input.endDate) {
      adSpendConditions.push(lte(schema.adSpendLogs.spendDate, new Date(input.endDate)));
    }
    const adSpendWhere = and(...adSpendConditions);

    // ── 3. Commission — approved/paid payouts overlapping period ──
    const commissionConditions = [
      inArray(schema.payoutRecords.status, ['APPROVED', 'PAID']),
    ];
    if (input.startDate) {
      // Payout period must overlap: periodEnd >= startDate
      commissionConditions.push(gte(schema.payoutRecords.periodEnd, new Date(input.startDate)));
    }
    if (input.endDate) {
      // Payout period must overlap: periodStart <= endDate
      commissionConditions.push(lte(schema.payoutRecords.periodStart, new Date(input.endDate)));
    }
    const commissionWhere = and(...commissionConditions);

    // ── 4. Fulfillment cost — verified/disputed transfers ──
    const transferConditions = [
      inArray(schema.stockTransfers.transferStatus, ['RECEIVED', 'DISPUTED']),
    ];
    if (input.startDate) {
      transferConditions.push(gte(schema.stockTransfers.verifiedAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      transferConditions.push(lte(schema.stockTransfers.verifiedAt, new Date(input.endDate)));
    }
    const transferWhere = and(...transferConditions);

    // ── 5. Operational loss — write-offs + shrinkage ──────
    const writeOffConditions = [
      eq(schema.stockMovements.movementType, 'WRITE_OFF'),
    ];
    if (input.startDate) {
      writeOffConditions.push(gte(schema.stockMovements.createdAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      writeOffConditions.push(lte(schema.stockMovements.createdAt, new Date(input.endDate)));
    }
    const writeOffWhere = and(...writeOffConditions);

    // Shrinkage from disputed transfers (same date range as fulfillment)
    const shrinkageConditions = [
      eq(schema.stockTransfers.transferStatus, 'DISPUTED'),
    ];
    if (input.startDate) {
      shrinkageConditions.push(gte(schema.stockTransfers.verifiedAt, new Date(input.startDate)));
    }
    if (input.endDate) {
      shrinkageConditions.push(lte(schema.stockTransfers.verifiedAt, new Date(input.endDate)));
    }
    const shrinkageWhere = and(...shrinkageConditions);

    // ── Run all queries in parallel ──────────────────────
    const [
      revenueRows,
      adSpendRows,
      commissionRows,
      fulfillmentRows,
      writeOffRows,
      shrinkageRows,
    ] = await Promise.all([
      // Revenue + COGS + delivery fee from delivered orders
      this.db
        .select({
          totalRevenue: sum(schema.orders.totalAmount),
          totalLandedCost: sum(schema.orders.landedCost),
          totalDeliveryFee: sum(schema.orders.deliveryFee),
          orderCount: count(),
        })
        .from(schema.orders)
        .where(orderWhere),

      // Total ad spend
      this.db
        .select({ total: sum(schema.adSpendLogs.spendAmount) })
        .from(schema.adSpendLogs)
        .where(adSpendWhere),

      // Total commission (approved + paid payouts)
      this.db
        .select({ total: sum(schema.payoutRecords.totalPayout) })
        .from(schema.payoutRecords)
        .where(commissionWhere),

      // Total fulfillment cost (transfer costs)
      this.db
        .select({ total: sum(schema.stockTransfers.transferCost) })
        .from(schema.stockTransfers)
        .where(transferWhere),

      // Write-off loss: quantity × avg batch cost per product
      // Join write-off movements with stock batches to get cost
      this.db
        .select({
          totalLoss: sql<string>`COALESCE(SUM(
            ${schema.stockMovements.quantity} * (
              SELECT COALESCE(
                AVG(CAST(${schema.stockBatches.totalLandedCost} AS numeric) / NULLIF(${schema.stockBatches.quantity}, 0)),
                0
              )
              FROM ${schema.stockBatches}
              WHERE ${schema.stockBatches.productId} = ${schema.stockMovements.productId}
            )
          ), 0)`,
        })
        .from(schema.stockMovements)
        .where(writeOffWhere),

      // Shrinkage loss: (sent - received) × avg batch cost per product
      this.db
        .select({
          totalLoss: sql<string>`COALESCE(SUM(
            (${schema.stockTransfers.quantitySent} - COALESCE(${schema.stockTransfers.quantityReceived}, 0)) * (
              SELECT COALESCE(
                AVG(CAST(${schema.stockBatches.totalLandedCost} AS numeric) / NULLIF(${schema.stockBatches.quantity}, 0)),
                0
              )
              FROM ${schema.stockBatches}
              WHERE ${schema.stockBatches.productId} = ${schema.stockTransfers.productId}
            )
          ), 0)`,
        })
        .from(schema.stockTransfers)
        .where(shrinkageWhere),
    ]);

    // ── Parse results ────────────────────────────────────
    const revenue = Number(revenueRows[0]?.totalRevenue ?? 0);
    const landedCost = Number(revenueRows[0]?.totalLandedCost ?? 0);
    const deliveryFee = Number(revenueRows[0]?.totalDeliveryFee ?? 0);
    const adSpend = Number(adSpendRows[0]?.total ?? 0);
    const commission = Number(commissionRows[0]?.total ?? 0);
    const fulfillmentCost = Number(fulfillmentRows[0]?.total ?? 0);
    const writeOffLoss = Number(writeOffRows[0]?.totalLoss ?? 0);
    const shrinkageLoss = Number(shrinkageRows[0]?.totalLoss ?? 0);
    const operationalLoss = writeOffLoss + shrinkageLoss;
    const orderCount = revenueRows[0]?.orderCount ?? 0;

    // True Profit = Revenue - ALL 6 cost layers
    const trueProfit = revenue - landedCost - deliveryFee - adSpend - commission - fulfillmentCost - operationalLoss;

    return {
      revenue,
      landedCost,
      deliveryFee,
      adSpend,
      commission,
      fulfillmentCost,
      operationalLoss,
      trueProfit,
      orderCount,
      margin: revenue > 0 ? (trueProfit / revenue) * 100 : 0,
    };
  }

  async getFinancialOverview() {
    // Summary across all time
    const [profitData, invoiceSummary] = await Promise.all([
      this.getProfitReport({ groupBy: 'product' }),
      this.getInvoiceSummary(),
    ]);

    return {
      ...profitData,
      invoices: invoiceSummary,
    };
  }

  // ============================================
  // Approval Requests
  // ============================================

  async createApprovalRequest(input: CreateApprovalRequestInput, actorId: string) {
    const request = await withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.approvalRequests)
        .values({
          type: input.type,
          requesterId: actorId,
          amount: String(input.amount),
          description: input.description,
          budgetId: input.budgetId ?? null,
        })
        .returning();

      const inserted = rows[0];
      if (!inserted) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create approval request' });
      }
      return inserted;
    });

    // Notify Finance Officers and SuperAdmin
    this.notifications
      .createForRole('FINANCE_OFFICER', {
        type: 'finance:approval_required',
        title: 'Approval request pending',
        body: `A ${input.type} approval request for ${input.amount} requires your review.`,
        data: { requestId: request.id, type: input.type, amount: input.amount },
      })
      .catch(() => {});
    this.notifications
      .createForRole('SUPER_ADMIN', {
        type: 'finance:approval_required',
        title: 'Approval request pending',
        body: `A ${input.type} approval request for ${input.amount} requires review.`,
        data: { requestId: request.id, type: input.type, amount: input.amount },
      })
      .catch(() => {});

    return request;
  }

  async processApproval(input: ProcessApprovalInput, actorId: string) {
    const { updated, request } = await withActor(this.db, { id: actorId }, async (tx) => {
      // Get the existing request
      const existing = await tx
        .select()
        .from(schema.approvalRequests)
        .where(eq(schema.approvalRequests.id, input.requestId))
        .limit(1);

      const found = existing[0];
      if (!found) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Approval request not found' });
      }
      if (found.status !== 'PENDING' && found.status !== 'QUERIED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Request already processed' });
      }
      // Self-approval prevention
      if (found.requesterId === actorId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot approve/reject your own request' });
      }

      const updateFields: Record<string, unknown> = {
        status: input.action,
        approverId: actorId,
        approvalReason: input.reason,
        updatedAt: new Date(),
      };
      if (input.action === 'APPROVED' || input.action === 'REJECTED') {
        updateFields['approvedAt'] = new Date();
      }

      const rows = await tx
        .update(schema.approvalRequests)
        .set(updateFields)
        .where(eq(schema.approvalRequests.id, input.requestId))
        .returning();

      const result = rows[0];
      if (!result) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to process approval' });
      }
      return { updated: result, request: found };
    });

    // Notify requester of outcome (outside the transaction)
    if (input.action === 'APPROVED' || input.action === 'REJECTED') {
      this.notifications
        .create({
          userId: request.requesterId,
          type: 'finance:approval_processed',
          title: `Approval request ${input.action.toLowerCase()}`,
          body:
            input.action === 'APPROVED'
              ? 'Your approval request has been approved.'
              : 'Your approval request has been rejected.',
          data: { requestId: request.id, action: input.action },
        })
        .catch(() => {});
    }

    return updated;
  }

  /**
   * Count of approval requests currently in PENDING state. Used by the lightweight admin
   * landing KPI — a single indexed count, intentionally cheap.
   */
  async countPendingApprovalRequests(): Promise<number> {
    const [row] = await this.db
      .select({ count: count() })
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.status, 'PENDING'));
    return row?.count ?? 0;
  }

  async listApprovalRequests(input: ListApprovalRequestsInput) {
    const conditions = [];
    if (input.status) {
      conditions.push(eq(schema.approvalRequests.status, input.status));
    }
    if (input.approverId) {
      conditions.push(eq(schema.approvalRequests.approverId, input.approverId));
    }
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (input.page - 1) * input.limit;

    const [requests, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.approvalRequests)
        .where(whereClause)
        .orderBy(desc(schema.approvalRequests.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.approvalRequests)
        .where(whereClause),
    ]);

    return {
      requests,
      pagination: {
        page: input.page,
        limit: input.limit,
        total: totalRows[0]?.count ?? 0,
      },
    };
  }

  // ============================================
  // Budgets
  // ============================================

  async setBudget(input: SetBudgetInput, actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const rows = await tx
        .insert(schema.budgets)
        .values({
          name: input.name,
          departmentOrCampaign: input.departmentOrCampaign,
          totalBudget: String(input.totalBudget),
          periodStart: new Date(input.periodStart),
          periodEnd: new Date(input.periodEnd),
          createdBy: actorId,
        })
        .returning();

      const budget = rows[0];
      if (!budget) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create budget' });
      }

      return budget;
    });
  }

  async listBudgets() {
    return this.db
      .select()
      .from(schema.budgets)
      .orderBy(desc(schema.budgets.createdAt));
  }

  async getBudgetUtilization(budgetId: string) {
    const budgetRows = await this.db
      .select()
      .from(schema.budgets)
      .where(eq(schema.budgets.id, budgetId))
      .limit(1);

    const budget = budgetRows[0];
    if (!budget) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Budget not found' });
    }

    const [approvedRows, committedRows] = await Promise.all([
      this.db
        .select({ total: sum(schema.approvalRequests.amount) })
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.budgetId, budgetId),
            eq(schema.approvalRequests.status, 'APPROVED'),
          ),
        ),
      this.db
        .select({ total: sum(schema.approvalRequests.amount) })
        .from(schema.approvalRequests)
        .where(
          and(
            eq(schema.approvalRequests.budgetId, budgetId),
            eq(schema.approvalRequests.status, 'PENDING'),
          ),
        ),
    ]);

    const approved = parseFloat(approvedRows[0]?.total ?? '0');
    const committed = parseFloat(committedRows[0]?.total ?? '0');
    const total = parseFloat(budget.totalBudget ?? '0');

    return {
      budget,
      approved,
      committed,
      remaining: total - approved - committed,
      total,
    };
  }

  // ============================================
  // Materialized Views
  // ============================================

  /**
   * Initialize materialized views for report performance.
   * Creates views if they don't exist. Safe to call multiple times.
   */
  async initMaterializedViews() {
    const { MV_PROFIT_SUMMARY, MV_AD_SPEND_SUMMARY, MV_ORDER_PIPELINE, MV_COMMISSION_SUMMARY, MV_INDEXES } = await import('./materialized-views');

    try {
      await this.pgClient.unsafe(MV_PROFIT_SUMMARY);
      await this.pgClient.unsafe(MV_AD_SPEND_SUMMARY);
      await this.pgClient.unsafe(MV_ORDER_PIPELINE);
      await this.pgClient.unsafe(MV_COMMISSION_SUMMARY);

      for (const idx of MV_INDEXES) {
        await this.pgClient.unsafe(idx);
      }
    } catch (err) {
      // Views may already exist — not an error
      console.warn('[Finance] Materialized view init:', (err as Error).message);
    }
  }

  /**
   * Refresh all materialized views. Called after data changes
   * (order delivery, cost update, etc.) or on a schedule.
   */
  async refreshMaterializedViews() {
    const { MV_REFRESH_COMMANDS } = await import('./materialized-views');

    const results: Record<string, boolean> = {};

    for (const [name, cmd] of Object.entries(MV_REFRESH_COMMANDS)) {
      try {
        await this.pgClient.unsafe(cmd);
        results[name] = true;
      } catch (err) {
        console.warn(`[Finance] MV refresh ${name} failed:`, (err as Error).message);
        results[name] = false;
      }
    }

    return results;
  }

  /**
   * Fast profit report using materialized views.
   * Falls back to full query if views don't exist.
   */
  async getFastProfitReport(startDate?: string, endDate?: string) {
    try {
      let profitRows: Array<Record<string, unknown>>;
      if (startDate && endDate) {
        profitRows = await this.pgClient.unsafe(
          `SELECT
            COALESCE(SUM(revenue), 0) AS revenue,
            COALESCE(SUM(landed_cost), 0) AS landed_cost,
            COALESCE(SUM(delivery_fee), 0) AS delivery_fee,
            COALESCE(SUM(order_count), 0) AS order_count
          FROM mv_profit_summary
          WHERE delivery_date >= $1 AND delivery_date <= $2`,
          [startDate, endDate],
        );
      } else {
        profitRows = await this.pgClient.unsafe(
          `SELECT
            COALESCE(SUM(revenue), 0) AS revenue,
            COALESCE(SUM(landed_cost), 0) AS landed_cost,
            COALESCE(SUM(delivery_fee), 0) AS delivery_fee,
            COALESCE(SUM(order_count), 0) AS order_count
          FROM mv_profit_summary`,
        );
      }

      const fulfillmentConditions = [
        inArray(schema.stockTransfers.transferStatus, ['RECEIVED', 'DISPUTED']),
      ];
      if (startDate) fulfillmentConditions.push(gte(schema.stockTransfers.verifiedAt, new Date(startDate)));
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        fulfillmentConditions.push(lte(schema.stockTransfers.verifiedAt, end));
      }
      const fulfillmentWhere = and(...fulfillmentConditions);

      // Get ad spend, commission, pipeline from MVs; fulfillment from direct sum (lightweight, no correlated subquery)
      const [adSpendRows, commissionRows, pipelineRows, fulfillmentRows] = await Promise.all([
        this.pgClient.unsafe(
          startDate && endDate
            ? `SELECT COALESCE(SUM(total_spend), 0) AS total FROM mv_ad_spend_summary WHERE spend_date >= $1 AND spend_date <= $2`
            : `SELECT COALESCE(SUM(total_spend), 0) AS total FROM mv_ad_spend_summary`,
          startDate && endDate ? [startDate, endDate] : [],
        ),
        // mv_commission_summary buckets payouts by DATE_TRUNC('month', period_start); filter by
        // the month range derived from the user's date filter so a request for "April 2026" does
        // not return the all-time total (which produced the inflated numbers on the CEO dashboard).
        this.pgClient.unsafe(
          startDate && endDate
            ? `SELECT COALESCE(SUM(total_commission), 0) AS total
               FROM mv_commission_summary
               WHERE period_month >= DATE_TRUNC('month', $1::date)
                 AND period_month <= DATE_TRUNC('month', $2::date)`
            : `SELECT COALESCE(SUM(total_commission), 0) AS total FROM mv_commission_summary`,
          startDate && endDate ? [startDate, endDate] : [],
        ),
        this.pgClient.unsafe(
          `SELECT status, order_count, total_amount FROM mv_order_pipeline`,
        ),
        this.db
          .select({ total: sum(schema.stockTransfers.transferCost) })
          .from(schema.stockTransfers)
          .where(fulfillmentWhere),
      ]);

      const revenue = Number(profitRows[0]?.revenue ?? 0);
      const landedCost = Number(profitRows[0]?.landed_cost ?? 0);
      const deliveryFee = Number(profitRows[0]?.delivery_fee ?? 0);
      const adSpend = Number(adSpendRows[0]?.total ?? 0);
      const commission = Number(commissionRows[0]?.total ?? 0);
      const orderCount = Number(profitRows[0]?.order_count ?? 0);
      const fulfillmentCost = Number(fulfillmentRows[0]?.total ?? 0);
      const operationalLoss = 0; // Full report uses correlated subqueries for write-off/shrinkage; keep 0 in fast path

      const trueProfit = revenue - landedCost - deliveryFee - adSpend - commission - fulfillmentCost - operationalLoss;

      const statusCounts: Record<string, number> = {};
      for (const row of pipelineRows) {
        statusCounts[row.status as string] = Number(row.order_count ?? 0);
      }

      return {
        revenue,
        landedCost,
        deliveryFee,
        adSpend,
        commission,
        fulfillmentCost,
        operationalLoss,
        trueProfit,
        orderCount,
        margin: revenue > 0 ? (trueProfit / revenue) * 100 : 0,
        statusCounts,
        source: 'materialized_view' as const,
      };
    } catch {
      // Materialized views don't exist — fall back to full query
      const report = await this.getProfitReport({ groupBy: 'product' });
      return { ...report, statusCounts: {}, source: 'direct_query' as const };
    }
  }

  // ============================================
  // Overdue Auto-Flagging
  // ============================================

  /**
   * Scan all SENT invoices whose dueDate is in the past.
   * Auto-update their status to OVERDUE with actor = 'SYSTEM'.
   * Returns the count of invoices flagged.
   */
  async flagOverdueInvoices(actorId: string) {
    return withActor(this.db, { id: actorId }, async (tx) => {
      const now = new Date();
      const overdueRows = await tx
        .update(schema.invoices)
        .set({ status: 'OVERDUE' })
        .where(
          and(
            eq(schema.invoices.status, 'SENT'),
            lte(schema.invoices.dueDate, now),
          ),
        )
        .returning();

      return {
        flaggedCount: overdueRows.length,
        flaggedIds: overdueRows.map((inv) => inv.id),
      };
    });
  }

  // ============================================
  // Private helpers
  // ============================================

  private formatReference(refNumber: number): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${String(refNumber).padStart(4, '0')}`;
  }
}
