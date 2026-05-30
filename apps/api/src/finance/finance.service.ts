import { Injectable, Inject, Logger } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, gte, lte, count, sum, sql, inArray, isNotNull, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { db as schema } from '@yannis/shared';
import type {
  UpdateInvoiceStatusInput,
  ListInvoicesInput,
  ProfitReportInput,
  ProfitByShipmentInput,
  ProductProfitBreakdownRow,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  ListApprovalRequestsInput,
  SetBudgetInput,
} from '@yannis/shared';
import { DRIZZLE, PG_CLIENT } from '../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { withActor } from '../common/db/with-actor';
import { nigeriaDayStart, nigeriaDayEnd } from '../common/utils/date-range';

@Injectable()
export class FinanceService {
  private readonly logger = new Logger(FinanceService.name);
  /**
   * Whether the materialized-view init has succeeded in THIS process. False on boot and after
   * any refresh failure that looks like a missing view, so the next refresh attempt re-runs
   * init and self-heals fresh deployments without anyone touching the admin endpoint.
   */
  private mvInitVerified = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PG_CLIENT) private readonly pgClient: ReturnType<typeof postgres>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Ensure init has run, then await a synchronous REFRESH MATERIALIZED VIEW across all 4
   * finance views. Used by the user-triggered `dashboard.refreshExecutiveData` mutation.
   *
   * No automatic / cron-based refresh exists — the user clicks Refresh on the page when
   * they want fresher numbers, this method runs to completion, and the page revalidator
   * picks up the new snapshot on its next read.
   */
  async refreshMaterializedViewsForUser() {
    if (!this.mvInitVerified) {
      try {
        await this.initMaterializedViews();
        this.mvInitVerified = true;
      } catch (err) {
        this.logger.error(`mv_init failed: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    }

    const startedAt = Date.now();
    const results = await this.refreshMaterializedViews();
    const failures = Object.entries(results).filter(([, ok]) => ok !== true);

    if (failures.length > 0) {
      // A failure usually means a view was dropped manually — retry init next time.
      this.mvInitVerified = false;
      this.logger.warn(
        `mv_refresh_user partial_failure count=${failures.length} views=${failures.map(([n]) => n).join(',')}`,
      );
    } else {
      this.logger.log(
        `mv_refresh_user success count=${Object.keys(results).length} took=${Date.now() - startedAt}ms`,
      );
    }

    return results;
  }

  // ============================================
  // Invoices
  // ============================================

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

  /**
   * Fetch the invoice tied to an order, if one was auto-generated on CONFIRMED.
   * Returns null when no invoice exists yet — callers (CS / Logistics order detail
   * pages) should render a placeholder rather than treating null as an error.
   */
  async getInvoiceByOrderId(orderId: string) {
    const rows = await this.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.orderId, orderId))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(1);

    if (!rows[0]) return null;

    // `markedPaid` — true when the order is on a delivery remittance whose
    // status has been confirmed `RECEIVED`. Drives the "MARKED AS PAID"
    // rubber-stamp on the invoice preview + PDF (web). Done via a single LEFT
    // JOIN so the typical "no remittance yet" path stays free.
    const remittanceLink = await this.db
      .select({ status: schema.deliveryRemittances.status })
      .from(schema.deliveryRemittanceOrders)
      .innerJoin(
        schema.deliveryRemittances,
        eq(schema.deliveryRemittanceOrders.deliveryRemittanceId, schema.deliveryRemittances.id),
      )
      .where(eq(schema.deliveryRemittanceOrders.orderId, orderId))
      .limit(1);
    const markedPaid = remittanceLink[0]?.status === 'RECEIVED';

    return {
      ...rows[0],
      referenceFormatted: this.formatReference(rows[0].referenceNumber),
      markedPaid,
    };
  }

  /**
   * Idempotently create a draft invoice for a confirmed order if it doesn't exist yet.
   * Used as an ops escape-hatch when auto-invoice failed on CONFIRM (best-effort) or
   * for older orders created before auto-invoice existed.
   */
  async ensureInvoiceForOrder(params: {
    order: {
      id: string;
      confirmedAt: string | Date | null;
      customerName: string;
      customerAddress: string | null;
      orderItems: Array<{ quantity: number; unitPrice: string; productName: string | null; productId: string }>;
    };
    actorId: string;
  }) {
    const existing = await this.getInvoiceByOrderId(params.order.id);
    if (existing) return existing;

    if (!params.order.confirmedAt) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invoice can only be generated after the order is confirmed',
      });
    }

    if (!params.order.orderItems || params.order.orderItems.length === 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Order has no items; cannot generate invoice',
      });
    }

    const lineItems = params.order.orderItems.map((it) => ({
      description: `${it.productName ?? 'Product'}`,
      quantity: it.quantity,
      unitPrice: String(it.unitPrice),
    }));

    // unitPrice is the offer/line total — sum directly
    const totalAmount = params.order.orderItems.reduce(
      (sum, it) => sum + Number(it.unitPrice),
      0,
    );

    return withActor(this.db, { id: params.actorId }, async (tx) => {
      const [row] = await tx
        .insert(schema.invoices)
        .values({
          orderId: params.order.id,
          recipientInfo: {
            name: params.order.customerName,
            address: params.order.customerAddress ?? undefined,
          },
          lineItems,
          taxRate: null,
          totalAmount: totalAmount.toFixed(2),
          dueDate: null,
          status: 'DRAFT',
        })
        .returning();

      if (!row) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create invoice' });
      }

      return {
        ...row,
        referenceFormatted: this.formatReference(row.referenceNumber),
      };
    });
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
      this.db
        .select({
          id: schema.invoices.id,
          referenceNumber: schema.invoices.referenceNumber,
          orderId: schema.invoices.orderId,
          totalAmount: schema.invoices.totalAmount,
          taxRate: schema.invoices.taxRate,
          status: schema.invoices.status,
          dueDate: schema.invoices.dueDate,
          createdAt: schema.invoices.createdAt,
          validFrom: schema.invoices.validFrom,
          validTo: schema.invoices.validTo,
          modifiedBy: schema.invoices.modifiedBy,
        })
        .from(schema.invoices)
        .where(whereClause)
        .orderBy(desc(schema.invoices.createdAt))
        .limit(input.limit)
        .offset(offset),
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
      // P&L follows the CS servicing branch — the branch that actually worked
      // and delivered the order (migration 0150). `orders.branch_id` is the
      // marketing attribution branch and is reported on Marketing surfaces.
      orderConditions.push(eq(schema.orders.servicingBranchId, input.branchId));
    }
    if (input.mediaBuyerId) {
      // Optional MB filter — narrows revenue (delivered orders attributed to MB)
      // AND ad spend (logs by MB) so the report shows that buyer's funnel slice.
      orderConditions.push(eq(schema.orders.mediaBuyerId, input.mediaBuyerId));
    }
    // REMITTED is post-delivery — same physical delivery, just remittance
    // received. Excluding it dropped revenue for any order the accountant
    // had already marked received within the window.
    orderConditions.push(inArray(schema.orders.status, ['DELIVERED', 'REMITTED']));
    const orderWhere = and(...orderConditions);

    // ── 2. Ad spend date range (only APPROVED counts toward profit) ───────────────────────────
    const adSpendConditions = [eq(schema.adSpendLogs.status, 'APPROVED')];
    if (input.startDate) {
      adSpendConditions.push(gte(schema.adSpendLogs.spendDate, new Date(input.startDate)));
    }
    if (input.endDate) {
      adSpendConditions.push(lte(schema.adSpendLogs.spendDate, new Date(input.endDate)));
    }
    if (input.mediaBuyerId) {
      adSpendConditions.push(eq(schema.adSpendLogs.mediaBuyerId, input.mediaBuyerId));
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

    let byProduct: ProductProfitBreakdownRow[] | undefined;
    if (
      input.groupBy === 'product' &&
      input.includeProductBreakdown === true &&
      orderWhere &&
      adSpendWhere
    ) {
      byProduct = await this.computeProductProfitBreakdown(orderWhere, adSpendWhere, {
        revenue,
        commission,
        fulfillmentCost,
        operationalLoss,
      });
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
      byProduct,
    };
  }

  /**
   * Per-product contribution for delivered orders in the report window: line revenue + allocated
   * order-level landed/delivery, product ad spend, and proportional commission / fulfillment / ops.
   */
  private async computeProductProfitBreakdown(
    orderWhere: SQL,
    adSpendWhere: SQL,
    pools: {
      revenue: number;
      commission: number;
      fulfillmentCost: number;
      operationalLoss: number;
    },
  ): Promise<ProductProfitBreakdownRow[]> {
    const lineRows = await this.db
      .select({
        orderId: schema.orderItems.orderId,
        productId: schema.orderItems.productId,
        productName: schema.products.name,
        quantity: schema.orderItems.quantity,
        unitPrice: schema.orderItems.unitPrice,
        orderLanded: schema.orders.landedCost,
        orderDelivery: schema.orders.deliveryFee,
      })
      .from(schema.orderItems)
      .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
      .innerJoin(schema.products, eq(schema.orderItems.productId, schema.products.id))
      .where(orderWhere);

    if (lineRows.length === 0) {
      return [];
    }

    type LineEntry = { productId: string; productName: string; lineRev: number };
    type OrderAgg = { lines: LineEntry[]; landed: number; delivery: number };
    const byOrder = new Map<string, OrderAgg>();

    for (const row of lineRows) {
      // unitPrice is the offer/line total — use directly
      const lineRev = Number(row.unitPrice);
      let agg = byOrder.get(row.orderId);
      if (!agg) {
        agg = {
          lines: [],
          landed: Number(row.orderLanded ?? 0),
          delivery: Number(row.orderDelivery ?? 0),
        };
        byOrder.set(row.orderId, agg);
      }
      agg.lines.push({
        productId: row.productId,
        productName: row.productName,
        lineRev,
      });
    }

    type Prod = { name: string; revenue: number; landed: number; delivery: number; orderIds: Set<string> };
    const productMap = new Map<string, Prod>();

    const ensureProd = (id: string, name: string): Prod => {
      let p = productMap.get(id);
      if (!p) {
        p = { name, revenue: 0, landed: 0, delivery: 0, orderIds: new Set() };
        productMap.set(id, p);
      }
      return p;
    };

    for (const [orderId, agg] of byOrder) {
      const sumLines = agg.lines.reduce((s, l) => s + l.lineRev, 0);
      const n = agg.lines.length;
      for (const line of agg.lines) {
        const share = sumLines > 0 ? line.lineRev / sumLines : n > 0 ? 1 / n : 0;
        const p = ensureProd(line.productId, line.productName);
        p.revenue += line.lineRev;
        p.landed += agg.landed * share;
        p.delivery += agg.delivery * share;
        p.orderIds.add(orderId);
      }
    }

    const adRows = await this.db
      .select({
        productId: schema.adSpendLogs.productId,
        total: sum(schema.adSpendLogs.spendAmount),
      })
      .from(schema.adSpendLogs)
      .where(adSpendWhere)
      .groupBy(schema.adSpendLogs.productId);

    const adByProduct = new Map<string, number>();
    for (const r of adRows) {
      if (r.productId) adByProduct.set(r.productId, Number(r.total ?? 0));
    }

    const revTotal = pools.revenue;
    const rows: ProductProfitBreakdownRow[] = [];

    for (const [productId, p] of productMap) {
      const share = revTotal > 0 ? p.revenue / revTotal : 0;
      const allocComm = pools.commission * share;
      const allocFulfill = pools.fulfillmentCost * share;
      const allocOps = pools.operationalLoss * share;
      const productAd = adByProduct.get(productId) ?? 0;
      const contribution =
        p.revenue - p.landed - p.delivery - productAd - allocComm - allocFulfill - allocOps;
      const marginPct = p.revenue > 0 ? (contribution / p.revenue) * 100 : 0;
      rows.push({
        productId,
        productName: p.name,
        revenue: p.revenue,
        landedCost: p.landed,
        deliveryFee: p.delivery,
        adSpend: productAd,
        allocatedCommission: allocComm,
        allocatedFulfillment: allocFulfill,
        allocatedOperationalLoss: allocOps,
        contribution,
        marginPct,
        orderCount: p.orderIds.size,
      });
    }

    rows.sort((a, b) => b.contribution - a.contribution);
    return rows;
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

    const approverPayload = {
      type: 'finance:approval_required' as const,
      title: 'Approval request pending',
      body: `A ${input.type} approval request for ${input.amount} requires your review.`,
      data: { requestId: request.id, type: input.type, amount: input.amount },
    };
    this.notifications.enqueueCreateForRole('FINANCE_OFFICER', approverPayload);
    this.notifications.enqueueCreateForRole(
      'SUPER_ADMIN',
      {
        ...approverPayload,
        body: `A ${input.type} approval request for ${input.amount} requires review.`,
      },
    );

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

  /**
   * List all budgets together with their approved/committed/remaining totals so the
   * finance overview can render utilization without N+1 lookups.
   */
  async listBudgetsWithUtilization() {
    const budgets = await this.db
      .select()
      .from(schema.budgets)
      .orderBy(desc(schema.budgets.createdAt));

    if (budgets.length === 0) return [];

    const usageRows = await this.db
      .select({
        budgetId: schema.approvalRequests.budgetId,
        status: schema.approvalRequests.status,
        total: sum(schema.approvalRequests.amount),
      })
      .from(schema.approvalRequests)
      .where(
        and(
          isNotNull(schema.approvalRequests.budgetId),
          inArray(
            schema.approvalRequests.status,
            ['APPROVED', 'PENDING'] as const,
          ),
        ),
      )
      .groupBy(schema.approvalRequests.budgetId, schema.approvalRequests.status);

    const usageMap = new Map<string, { approved: number; committed: number }>();
    for (const row of usageRows) {
      if (!row.budgetId) continue;
      const existing = usageMap.get(row.budgetId) ?? { approved: 0, committed: 0 };
      const value = parseFloat(row.total ?? '0');
      if (row.status === 'APPROVED') existing.approved = value;
      else if (row.status === 'PENDING') existing.committed = value;
      usageMap.set(row.budgetId, existing);
    }

    const now = Date.now();
    return budgets.map((b) => {
      const usage = usageMap.get(b.id) ?? { approved: 0, committed: 0 };
      const total = parseFloat(b.totalBudget ?? '0');
      const remaining = total - usage.approved - usage.committed;
      const utilizationPct = total > 0 ? ((usage.approved + usage.committed) / total) * 100 : 0;
      const start = b.periodStart ? new Date(b.periodStart).getTime() : null;
      const end = b.periodEnd ? new Date(b.periodEnd).getTime() : null;
      const isActive = (start === null || start <= now) && (end === null || end >= now);
      return {
        ...b,
        approved: usage.approved,
        committed: usage.committed,
        remaining,
        total,
        utilizationPct,
        isActive,
      };
    });
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
      if (startDate) fulfillmentConditions.push(gte(schema.stockTransfers.verifiedAt, nigeriaDayStart(startDate)));
      if (endDate) fulfillmentConditions.push(lte(schema.stockTransfers.verifiedAt, nigeriaDayEnd(endDate)));
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
        // Exclude DELETED and legacy CANCELLED from pipeline counts —
        // both are "removed" orders (CEO directive 2026-05-23).
        if (row.status === 'DELETED' || row.status === 'CANCELLED') continue;
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

  /**
   * Per-shipment unit economics (CEO directive 2026-05-08): "what did it cost
   * to bring this shipment in, and what did we make selling it?"
   *
   * Cost side is exact:
   *  - factoryCost × receivedQty per line
   *  - allocatedLandingCost (per-line slice of shipments.totalLandingCost)
   *
   * Sold side is FIFO-deterministic at the *aggregate* level: each shipment
   * line links to a `stock_batches` row whose `quantity − remaining_quantity`
   * tells us how many units from THAT specific batch have been delivered.
   * We can't yet pin which exact orders consumed those units (no
   * `order_items.batch_id` link), so revenue is approximated as
   * `unitsSold × avgDeliveredPrice` where `avgDeliveredPrice` is the
   * average per-unit revenue across that product's recent delivered orders.
   * The UI labels this clearly so finance reads it as an estimate, not a
   * line-item P&L.
   */
  async getProfitByShipment(input: ProfitByShipmentInput) {
    const [shipment] = await this.db
      .select({
        id: schema.shipments.id,
        referenceNumber: schema.shipments.referenceNumber,
        label: schema.shipments.label,
        status: schema.shipments.status,
        supplierName: schema.shipments.supplierName,
        supplierReference: schema.shipments.supplierReference,
        totalLandingCost: schema.shipments.totalLandingCost,
        arrivedAt: schema.shipments.arrivedAt,
        verifiedAt: schema.shipments.verifiedAt,
        createdAt: schema.shipments.createdAt,
      })
      .from(schema.shipments)
      .where(eq(schema.shipments.id, input.shipmentId))
      .limit(1);

    if (!shipment) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Shipment not found' });
    }

    const lineRows = await this.db
      .select({
        id: schema.shipmentLines.id,
        productId: schema.shipmentLines.productId,
        productName: schema.products.name,
        expectedQuantity: schema.shipmentLines.expectedQuantity,
        receivedQuantity: schema.shipmentLines.receivedQuantity,
        factoryCost: schema.shipmentLines.factoryCost,
        allocatedLandingCost: schema.shipmentLines.allocatedLandingCost,
        batchId: schema.shipmentLines.batchId,
        batchQuantity: schema.stockBatches.quantity,
        batchRemainingQuantity: schema.stockBatches.remainingQuantity,
        baseSalePrice: schema.products.baseSalePrice,
      })
      .from(schema.shipmentLines)
      .leftJoin(schema.products, eq(schema.shipmentLines.productId, schema.products.id))
      .leftJoin(schema.stockBatches, eq(schema.shipmentLines.batchId, schema.stockBatches.id))
      .where(eq(schema.shipmentLines.shipmentId, input.shipmentId));

    // Average per-unit delivered price by product — anchors the revenue
    // estimate. We bound the lookup to the last 90 days so a defunct promo
    // from a year ago doesn't skew an active product.
    const productIds = lineRows
      .map((l) => l.productId)
      .filter((id): id is string => !!id);
    let avgPriceByProduct = new Map<string, number>();
    if (productIds.length > 0) {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const priceRows = await this.db
        .select({
          productId: schema.orderItems.productId,
          avg: sql<string>`AVG((${schema.orderItems.unitPrice})::numeric)`.as('avg'),
        })
        .from(schema.orderItems)
        .innerJoin(schema.orders, eq(schema.orderItems.orderId, schema.orders.id))
        .where(
          and(
            inArray(schema.orderItems.productId, productIds),
            inArray(schema.orders.status, ['DELIVERED', 'REMITTED']),
            gte(schema.orders.deliveredAt, ninetyDaysAgo),
          ),
        )
        .groupBy(schema.orderItems.productId);
      avgPriceByProduct = new Map(
        priceRows.map((r) => [r.productId, Number(r.avg ?? 0)]),
      );
    }

    type ShipmentProfitLine = {
      lineId: string;
      productId: string | null;
      productName: string | null;
      expectedQuantity: number;
      receivedQuantity: number;
      factoryCost: number;
      allocatedLandingCost: number;
      totalCostIn: number;
      unitsSold: number;
      unitsRemaining: number;
      avgUnitPrice: number;
      estimatedRevenue: number;
      estimatedProfit: number;
    };

    const linesOut: ShipmentProfitLine[] = lineRows.map((l) => {
      const received = l.receivedQuantity ?? 0;
      const factoryCost = Number(l.factoryCost ?? 0);
      const landing = Number(l.allocatedLandingCost ?? 0);
      const totalCostIn = factoryCost * received + landing;
      const batchQty = l.batchQuantity ?? 0;
      const batchRemaining = l.batchRemainingQuantity ?? 0;
      const unitsSold = Math.max(0, batchQty - batchRemaining);
      const avgUnitPrice = l.productId
        ? (avgPriceByProduct.get(l.productId) ?? Number(l.baseSalePrice ?? 0))
        : 0;
      const estimatedRevenue = unitsSold * avgUnitPrice;
      const perUnitCost = received > 0 ? totalCostIn / received : 0;
      const soldCost = perUnitCost * unitsSold;
      const estimatedProfit = estimatedRevenue - soldCost;
      return {
        lineId: l.id,
        productId: l.productId ?? null,
        productName: l.productName ?? null,
        expectedQuantity: l.expectedQuantity,
        receivedQuantity: received,
        factoryCost,
        allocatedLandingCost: landing,
        totalCostIn,
        unitsSold,
        unitsRemaining: batchRemaining,
        avgUnitPrice,
        estimatedRevenue,
        estimatedProfit,
      };
    });

    const totals = linesOut.reduce(
      (acc, l) => ({
        receivedQuantity: acc.receivedQuantity + l.receivedQuantity,
        factoryCostTotal: acc.factoryCostTotal + l.factoryCost * l.receivedQuantity,
        landingCostTotal: acc.landingCostTotal + l.allocatedLandingCost,
        totalCostIn: acc.totalCostIn + l.totalCostIn,
        unitsSold: acc.unitsSold + l.unitsSold,
        unitsRemaining: acc.unitsRemaining + l.unitsRemaining,
        estimatedRevenue: acc.estimatedRevenue + l.estimatedRevenue,
        estimatedProfit: acc.estimatedProfit + l.estimatedProfit,
      }),
      {
        receivedQuantity: 0,
        factoryCostTotal: 0,
        landingCostTotal: 0,
        totalCostIn: 0,
        unitsSold: 0,
        unitsRemaining: 0,
        estimatedRevenue: 0,
        estimatedProfit: 0,
      },
    );

    return {
      shipment: {
        id: shipment.id,
        referenceNumber: shipment.referenceNumber,
        label: shipment.label,
        status: shipment.status,
        supplierName: shipment.supplierName,
        supplierReference: shipment.supplierReference,
        totalLandingCost: Number(shipment.totalLandingCost ?? 0),
        arrivedAt: shipment.arrivedAt,
        verifiedAt: shipment.verifiedAt,
        createdAt: shipment.createdAt,
      },
      lines: linesOut,
      totals,
      /**
       * Revenue + profit are *estimates* — see service docstring. UI must
       * render the "estimated" label so finance reads it as a planning
       * number, not a closed P&L.
       */
      revenueIsEstimated: true,
    };
  }
}
