import { Inject, Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { db as schema } from '@yannis/shared';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import {
  listFundingSchema,
  listInventorySchema,
  listInvoicesSchema,
  listOrdersSchema,
} from '@yannis/shared';
import type { ExportReportInput, ExportDateRange, ListOrdersInput } from '@yannis/shared';
import { DRIZZLE } from '../database/database.module';
import { OrdersService } from '../orders/orders.service';
import { MarketingService } from '../marketing/marketing.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinanceService } from '../finance/finance.service';
import { UsersService } from '../users/users.service';
import { LogisticsService } from '../logistics/logistics.service';

type CsvRow = Record<string, string | number | boolean | null | undefined>;

const EXPORT_PAGE_LIMIT = 100;
const EXPORT_MAX_PAGES = 50;

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Force text format for long digit strings (phone numbers) so Excel
  // doesn't mangle them into scientific notation like 2.34707E+12.
  if (/^\+?\d{7,}$/.test(str.trim())) {
    return `="${str.trim()}"`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(data: CsvRow[], columns: Array<{ key: string; label: string }>): string {
  const header = columns.map((c) => escapeField(c.label)).join(',');
  const rows = data.map((row) => columns.map((c) => escapeField(row[c.key])).join(','));
  return [header, ...rows].join('\n');
}

function todayISODate() {
  return new Date().toISOString().split('T')[0] ?? '';
}

function resolveDateRange(dateRange?: ExportDateRange): { startDate?: string; endDate?: string } {
  const preset = dateRange?.preset ?? 'this_month';
  if (preset === 'all_time') return {};
  const now = new Date();
  const endDate = todayISODate();
  if (preset === 'custom') {
    return {
      ...(dateRange?.startDate ? { startDate: dateRange.startDate } : {}),
      ...(dateRange?.endDate ? { endDate: dateRange.endDate } : {}),
    };
  }
  if (preset === 'today') return { startDate: endDate, endDate };
  if (preset === 'last_7_days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { startDate: start.toISOString().split('T')[0] ?? '', endDate };
  }
  if (preset === 'last_30_days') {
    const start = new Date(now);
    start.setDate(now.getDate() - 29);
    return { startDate: start.toISOString().split('T')[0] ?? '', endDate };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startDate: start.toISOString().split('T')[0] ?? '', endDate };
}

type OrderExportFilterDates = {
  startDate?: string;
  endDate?: string;
  periodAllTime?: boolean;
};

function resolveOrderListDates(
  dateRange: ExportDateRange | undefined,
  filters: OrderExportFilterDates | undefined,
): { startDate?: string; endDate?: string } {
  if (filters?.periodAllTime) return {};
  if (filters?.startDate || filters?.endDate) {
    return {
      ...(filters.startDate ? { startDate: filters.startDate } : {}),
      ...(filters.endDate ? { endDate: filters.endDate } : {}),
    };
  }
  return resolveDateRange(dateRange);
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly ordersService: OrdersService,
    private readonly marketingService: MarketingService,
    private readonly inventoryService: InventoryService,
    private readonly financeService: FinanceService,
    private readonly usersService: UsersService,
    private readonly logisticsService: LogisticsService,
  ) {}

  /** Batch-resolve product IDs → names. */
  private async resolveProductNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.products)
      .where(inArray(schema.products.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** Batch-resolve location IDs → names. */
  private async resolveLocationNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: schema.logisticsLocations.id, name: schema.logisticsLocations.name })
      .from(schema.logisticsLocations)
      .where(inArray(schema.logisticsLocations.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async exportCsv(input: ExportReportInput, user: SessionUser, currentBranchId: string | null, effectiveBranchIds?: string[] | null): Promise<{ filename: string; csvContent: string }> {
    const date = todayISODate();
    switch (input.reportKey) {
      case 'cs_orders':
        return this.exportCsOrders(input as Extract<ExportReportInput, { reportKey: 'cs_orders' }>, user, currentBranchId, date, effectiveBranchIds);
      case 'cs_team':
        return this.exportCsTeam(input as Extract<ExportReportInput, { reportKey: 'cs_team' }>, user, currentBranchId, date, effectiveBranchIds);
      case 'marketing_orders':
        return this.exportMarketingOrders(input as Extract<ExportReportInput, { reportKey: 'marketing_orders' }>, user, currentBranchId, date, effectiveBranchIds);
      case 'marketing_team':
        return this.exportMarketingTeam(input as Extract<ExportReportInput, { reportKey: 'marketing_team' }>, user, currentBranchId, date, effectiveBranchIds);
      case 'cross_funnel':
        return this.exportCrossFunnel(input as Extract<ExportReportInput, { reportKey: 'cross_funnel' }>, user, currentBranchId, date, effectiveBranchIds);
      case 'disbursements':
        return this.exportDisbursements(input as Extract<ExportReportInput, { reportKey: 'disbursements' }>, user, currentBranchId, date);
      case 'inventory':
        return this.exportInventory(input as Extract<ExportReportInput, { reportKey: 'inventory' }>, user, date);
      case 'finance_invoices':
        return this.exportFinanceInvoices(input as Extract<ExportReportInput, { reportKey: 'finance_invoices' }>, user, date, effectiveBranchIds);
      case 'logistics_locations':
        return this.exportLogisticsLocations(input as Extract<ExportReportInput, { reportKey: 'logistics_locations' }>, user, date);
      case 'logistics_partners':
        return this.exportLogisticsPartners(input as Extract<ExportReportInput, { reportKey: 'logistics_partners' }>, user, currentBranchId, date, effectiveBranchIds);
      default:
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unsupported report key' });
    }
  }

  /**
   * Two-key export gate: the user must (a) be able to read the underlying data
   * AND (b) hold the per-domain export code. This prevents granting `orders.export`
   * to a user who can't read CS-team data and having them download it via the
   * cs_team report. SuperAdmin still bypasses everything.
   */
  private ensureExportPermission(user: SessionUser, readPermission: string, exportPermission: string): void {
    if (user.role === 'SUPER_ADMIN') return;
    const have = user.permissions ?? [];
    if (!have.includes(readPermission)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Missing ${readPermission}` });
    }
    if (!have.includes(exportPermission)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing ${exportPermission} — ask an admin to grant export access.`,
      });
    }
  }

  private async collectOrdersPages(
    base: Omit<ListOrdersInput, 'page' | 'limit'>,
    branchId: string | null,
    effectiveBranchIds?: string[] | null,
  ): Promise<Awaited<ReturnType<OrdersService['list']>>['orders']> {
    const all: Awaited<ReturnType<OrdersService['list']>>['orders'] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const listInput = listOrdersSchema.parse({
        ...base,
        page,
        limit: EXPORT_PAGE_LIMIT,
        sortBy: base.sortBy ?? 'createdAt',
        sortOrder: base.sortOrder ?? 'desc',
      });
      const result = await this.ordersService.list(listInput, branchId, { effectiveBranchIds });
      const batch = result.orders ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) return all;
    }
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Export is limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} orders. Narrow your filters and try again.`,
    });
  }

  private async exportCsOrders(input: Extract<ExportReportInput, { reportKey: 'cs_orders' }>, user: SessionUser, currentBranchId: string | null, date: string, effectiveBranchIds?: string[] | null) {
    this.ensureExportPermission(user, 'orders.read', 'orders.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    const orders = await this.collectOrdersPages(
      {
        sortBy: 'createdAt',
        sortOrder: 'desc',
        ...(input.filters?.status ? { status: input.filters.status as ListOrdersInput['status'] } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
        ...(input.filters?.assignedCsId ? { assignedCsId: input.filters.assignedCsId } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
      currentBranchId,
      effectiveBranchIds,
    );
    const rows = orders.map((o) => ({
      id: o.id,
      customer: o.customerName,
      assignedCs: o.assignedCsName ?? '—',
      phone: o.customerPhoneDisplay ?? '',
      status: o.status,
      amount: o.totalAmount ?? '',
      product: o.productLines || o.primaryProductName || '—',
      quantity: o.itemCount ?? 0,
      address: o.deliveryAddress ?? '—',
      created: new Date(o.createdAt).toLocaleDateString(),
    }));
    const filteredRows = rows.filter((row) => {
      if (typeof input.filters?.minAmount === 'number' && Number(row.amount ?? 0) < input.filters.minAmount) return false;
      return true;
    });
    const columns = [
      { key: 'id', label: 'Order ID' },
      { key: 'customer', label: 'Customer' },
      { key: 'assignedCs', label: 'Assigned closer' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'product', label: 'Product' },
      { key: 'quantity', label: 'Quantity' },
      { key: 'address', label: 'Delivery Address' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `cs-orders-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportCsTeam(
    input: Extract<ExportReportInput, { reportKey: 'cs_team' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'cs.teamOverview', 'orders.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    const period: 'this_month' | 'all_time' =
      input.filters?.periodAllTime || (!startDate && !endDate && input.dateRange?.preset === 'all_time')
        ? 'all_time'
        : 'this_month';

    const [team, workloads, leaderboard, inactive] = await Promise.all([
      this.usersService.listCSTeam(currentBranchId, effectiveBranchIds),
      this.ordersService.getCSCloserWorkloads(currentBranchId, effectiveBranchIds),
      this.ordersService.getCSCloserLeaderboard(period, startDate, endDate, currentBranchId, effectiveBranchIds),
      this.ordersService.getInactiveAgents(10, currentBranchId, effectiveBranchIds),
    ]);

    const workloadById = new Map(workloads.map((w) => [w.agentId, w]));
    const leaderboardById = new Map(leaderboard.map((l) => [l.agentId, l]));
    const idleSet = new Set(inactive.map((a) => a.agentId));

    const closersOnly = team.filter((m) => m.role === 'CS_CLOSER');

    const rows = closersOnly.map((m) => {
      const wl = workloadById.get(m.id);
      const lb = leaderboardById.get(m.id);
      const branches = (m.branchMemberships ?? [])
        .map((b) => (b.isPrimary ? `${b.branchName}*` : b.branchName))
        .join(' / ');
      return {
        name: m.name,
        role: m.role === 'CS_CLOSER' ? 'Closer' : m.role.replace(/_/g, ' '),
        branches: branches || '—',
        pending: wl?.pendingCount ?? 0,
        capacity: wl?.capacity ?? 0,
        assigned: lb?.ordersEngaged ?? 0,
        delivered: lb?.ordersDelivered ?? 0,
        confirmed: lb?.ordersConfirmed ?? 0,
        cancelled: lb?.ordersCancelled ?? 0,
        callsMade: lb?.callsMade ?? 0,
        confirmationRate: lb ? `${lb.confirmationRate.toFixed(2)}%` : '—',
        deliveryRate: lb ? `${lb.deliveryRate.toFixed(2)}%` : '—',
        avgCallSeconds: lb ? Math.round(lb.avgCallDurationSeconds) : 0,
        lastActiveAt: wl?.lastActionAt ? new Date(wl.lastActionAt).toLocaleString() : '—',
        idle: idleSet.has(m.id) ? 'Yes' : 'No',
      };
    });
    const filteredRows = rows.filter((row) => {
      if (typeof input.filters?.minRate === 'number') {
        const parsed = Number.parseFloat(String(row.confirmationRate).replace('%', ''));
        if (!Number.isFinite(parsed) || parsed < input.filters.minRate) return false;
      }
      return true;
    });

    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'branches', label: 'Branches' },
      { key: 'pending', label: 'Pending now' },
      { key: 'capacity', label: 'Capacity' },
      { key: 'assigned', label: 'Assigned (period)' },
      { key: 'delivered', label: 'Delivered (period)' },
      { key: 'confirmed', label: 'Confirmed (period)' },
      { key: 'cancelled', label: 'Cancelled (period)' },
      { key: 'callsMade', label: 'Calls (period)' },
      { key: 'confirmationRate', label: 'Confirmation %' },
      { key: 'deliveryRate', label: 'Delivery %' },
      { key: 'avgCallSeconds', label: 'Avg call (s)' },
      { key: 'lastActiveAt', label: 'Last active' },
      { key: 'idle', label: 'Idle' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));

    return { filename: `cs-team-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportMarketingTeam(
    input: Extract<ExportReportInput, { reportKey: 'marketing_team' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'marketing.teamOverview', 'marketing.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    const period: 'this_month' | 'all_time' =
      input.filters?.periodAllTime || (!startDate && !endDate && input.dateRange?.preset === 'all_time')
        ? 'all_time'
        : 'this_month';

    const [balances, leaderboard] = await Promise.all([
      this.marketingService.listFundingBalances(user, currentBranchId, undefined, effectiveBranchIds),
      this.marketingService.getMediaBuyerLeaderboard(period, startDate, endDate, currentBranchId, undefined, effectiveBranchIds),
    ]);

    // Leaderboard only includes Media Buyers — Heads of Marketing won't have a row.
    // Balances include both. Merge by userId so the export reflects the page.
    const lbById = new Map(leaderboard.map((l) => [l.mediaBuyerId, l]));

    const rows = balances.map((b) => {
      const lb = lbById.get(b.userId);
      return {
        name: b.name,
        role: b.role === 'MEDIA_BUYER' ? 'Media Buyer' : b.role.replace(/_/g, ' '),
        branches: '—', // listFundingBalances doesn't include branch memberships; left blank for now
        totalReceived: b.totalReceived,
        totalSpend: b.totalSpend,
        balance: b.balance,
        totalOrders: lb?.totalOrders ?? 0,
        deliveredOrders: lb?.deliveredOrders ?? 0,
        deliveredRevenue: lb?.deliveredRevenue ?? 0,
        confirmationRate: lb ? `${lb.confirmationRate.toFixed(2)}%` : '—',
        deliveryRate: lb ? `${lb.deliveryRate.toFixed(2)}%` : '—',
        cpa: lb ? lb.cpa.toFixed(2) : '—',
        trueRoas: lb ? `${lb.trueRoas.toFixed(2)}x` : '—',
      };
    });
    const filteredRows = rows.filter((row) => {
      if (input.filters?.role) {
        const normalizedRole = input.filters.role === 'MEDIA_BUYER' ? 'Media Buyer' : 'HEAD OF MARKETING';
        if (String(row.role) !== normalizedRole) return false;
      }
      if (typeof input.filters?.minAmount === 'number' && Number(row.balance) < input.filters.minAmount) return false;
      if (typeof input.filters?.maxAmount === 'number') {
        const parsedRoas = Number.parseFloat(String(row.trueRoas).replace('x', ''));
        if (!Number.isFinite(parsedRoas) || parsedRoas < input.filters.maxAmount) return false;
      }
      return true;
    });

    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'role', label: 'Role' },
      { key: 'branches', label: 'Branches' },
      { key: 'totalReceived', label: 'Total received' },
      { key: 'totalSpend', label: 'Total ad spend' },
      { key: 'balance', label: 'Balance' },
      { key: 'totalOrders', label: 'Total orders (period)' },
      { key: 'deliveredOrders', label: 'Delivered orders (period)' },
      { key: 'deliveredRevenue', label: 'Delivered revenue (period)' },
      { key: 'confirmationRate', label: 'Confirmation %' },
      { key: 'deliveryRate', label: 'Delivery %' },
      { key: 'cpa', label: 'CPA' },
      { key: 'trueRoas', label: 'True ROAS' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));

    return { filename: `marketing-team-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportMarketingOrders(
    input: Extract<ExportReportInput, { reportKey: 'marketing_orders' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'marketing.orders', 'orders.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    const orders = await this.collectOrdersPages(
      {
        sortBy: 'createdAt',
        sortOrder: 'desc',
        ...(input.filters?.status ? { status: input.filters.status as ListOrdersInput['status'] } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
        ...(input.filters?.mediaBuyerId ? { mediaBuyerId: input.filters.mediaBuyerId } : {}),
        ...(input.filters?.assignedCsId ? { assignedCsId: input.filters.assignedCsId } : {}),
        ...(input.filters?.productId ? { productId: input.filters.productId } : {}),
        ...(input.filters?.campaignId ? { campaignId: input.filters.campaignId } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
      currentBranchId,
      effectiveBranchIds,
    );

    const ids = orders.map((o) => o.id);
    const enrich = await this.ordersService.getMarketingExportEnrichment(ids);

    const rows = orders.map((o) => {
      const ex = enrich.get(o.id);
      return {
        id: o.id,
        customer: o.customerName,
        mediaBuyer: o.mediaBuyerName ?? '—',
        assignedCs: o.assignedCsName ?? '—',
        product: ex?.productLines ?? '—',
        campaign: ex?.campaignName ?? '—',
        branch: ex?.branchName ?? '—',
        status: o.status,
        amount: o.totalAmount ?? '',
        created: new Date(o.createdAt).toLocaleDateString(),
      };
    });
    const filteredRows = rows.filter((row) => {
      if (typeof input.filters?.minAmount === 'number' && Number(row.amount ?? 0) < input.filters.minAmount) return false;
      return true;
    });
    const columns = [
      { key: 'id', label: 'Order ID' },
      { key: 'customer', label: 'Customer' },
      { key: 'mediaBuyer', label: 'Media Buyer' },
      { key: 'assignedCs', label: 'Assigned CS' },
      { key: 'product', label: 'Products (lines)' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'branch', label: 'Branch' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `marketing-orders-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportCrossFunnel(
    input: Extract<ExportReportInput, { reportKey: 'cross_funnel' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'marketing.read', 'marketing.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);

    const allRows: Array<{
      customerName: string;
      duplicateType: string;
      mediaBuyer: string;
      originalMediaBuyer: string;
      product: string;
      campaign: string;
      originalCampaign: string;
      originalOrderId: string;
      originalOrderStatus: string;
      originalOrderAmount: string;
      attemptedAt: string;
      originalOrderCreatedAt: string;
    }> = [];

    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const result = await this.marketingService.listMyCrossFunnelAttempts(
        user,
        {
          page,
          limit: EXPORT_PAGE_LIMIT,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(input.filters?.productId ? { productId: input.filters.productId } : {}),
          ...(input.filters?.campaignId ? { campaignId: input.filters.campaignId } : {}),
          ...(input.filters?.mediaBuyerId ? { mediaBuyerId: input.filters.mediaBuyerId } : {}),
          ...(input.filters?.search ? { search: input.filters.search } : {}),
          ...(input.filters?.duplicateType ? { duplicateType: input.filters.duplicateType } : {}),
        },
        currentBranchId,
        effectiveBranchIds,
      );
      const batch = result.rows ?? [];

      for (const r of batch) {
        // Determine duplicate type using same logic as the frontend
        let duplicateType = 'Cross-funnel';
        if (r.campaignId && r.originalCampaignId && r.campaignId === r.originalCampaignId) {
          duplicateType = 'Resubmission';
        } else if (r.originalMediaBuyerId && r.mediaBuyerId === r.originalMediaBuyerId) {
          duplicateType = 'Same MB';
        }

        allRows.push({
          customerName: r.customerName ?? '',
          duplicateType,
          mediaBuyer: r.mediaBuyerName ?? '—',
          originalMediaBuyer: r.originalMediaBuyerName ?? '—',
          product: r.productName ?? '—',
          campaign: r.campaignName ?? '—',
          originalCampaign: r.originalCampaignName ?? '—',
          originalOrderId: r.originalOrderId ?? '—',
          originalOrderStatus: r.originalOrderStatus ?? '—',
          originalOrderAmount: r.originalOrderAmount ? String(r.originalOrderAmount) : '—',
          attemptedAt: r.attemptedAt ? new Date(r.attemptedAt).toLocaleString() : '—',
          originalOrderCreatedAt: r.originalOrderCreatedAt ? new Date(r.originalOrderCreatedAt).toLocaleString() : '—',
        });
      }

      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Export is limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows. Narrow your filters and try again.`,
        });
      }
    }

    const columns = [
      { key: 'customerName', label: 'Customer' },
      { key: 'duplicateType', label: 'Duplicate Type' },
      { key: 'mediaBuyer', label: 'Media Buyer (attempt)' },
      { key: 'originalMediaBuyer', label: 'Media Buyer (original)' },
      { key: 'product', label: 'Product' },
      { key: 'campaign', label: 'Form (attempt)' },
      { key: 'originalCampaign', label: 'Form (original)' },
      { key: 'originalOrderId', label: 'Original Order ID' },
      { key: 'originalOrderStatus', label: 'Original Status' },
      { key: 'originalOrderAmount', label: 'Original Amount' },
      { key: 'attemptedAt', label: 'Attempted At' },
      { key: 'originalOrderCreatedAt', label: 'Original Order Date' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));

    return { filename: `cross-funnel-duplicates-${date}.csv`, csvContent: toCsv(allRows, columns) };
  }

  private async exportDisbursements(input: Extract<ExportReportInput, { reportKey: 'disbursements' }>, user: SessionUser, currentBranchId: string | null, date: string) {
    this.ensureExportPermission(user, 'finance.disburse', 'finance.export');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const all: Array<Awaited<ReturnType<MarketingService['listFunding']>>['records'][number]> = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const fundingInput = listFundingSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(input.filters?.receiverId ? { receiverId: input.filters.receiverId } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
      });
      const result = await this.marketingService.listFunding(fundingInput, currentBranchId);
      const batch = result.records ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Export is limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows. Narrow your filters and try again.`,
        });
      }
    }
    const rows = all.map((f) => ({
      id: f.id,
      sender: f.senderName ?? f.senderId,
      receiver: f.receiverName ?? f.receiverId,
      amount: f.amount,
      status: f.status,
      receipt: f.receiptUrl ?? '',
      date: new Date(f.sentAt).toLocaleDateString(),
      verifiedAt: f.verifiedAt ? new Date(f.verifiedAt).toLocaleDateString() : '',
    }));
    const filteredRows = rows.filter((row) => {
      if (typeof input.filters?.minAmount === 'number' && Number(row.amount ?? 0) < input.filters.minAmount) return false;
      if (typeof input.filters?.maxAmount === 'number' && Number(row.amount ?? 0) > input.filters.maxAmount) return false;
      return true;
    });
    const columns = [
      { key: 'id', label: 'ID' },
      { key: 'sender', label: 'Sender' },
      { key: 'receiver', label: 'Receiver' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'receipt', label: 'Receipt URL' },
      { key: 'date', label: 'Sent Date' },
      { key: 'verifiedAt', label: 'Verified Date' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `disbursements-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportInventory(input: Extract<ExportReportInput, { reportKey: 'inventory' }>, user: SessionUser, date: string) {
    this.ensureExportPermission(user, 'inventory.read', 'inventory.export');
    if (user.role !== 'SUPER_ADMIN' && !(user.permissions ?? []).includes('inventory.intake')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Inventory export requires inventory.intake permission' });
    }
    const all: Awaited<ReturnType<InventoryService['listLevels']>>['levels'] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const levelsInput = listInventorySchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        sortBy: input.filters?.sort ? 'available' : 'updatedAt',
        sortOrder: input.filters?.sort === 'lowestAvailable' ? 'asc' : 'desc',
        ...(input.filters?.productId ? { productId: input.filters.productId } : {}),
        ...(input.filters?.locationId ? { locationId: input.filters.locationId } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
      });
      const levels = await this.inventoryService.listLevels(levelsInput);
      const batch = levels.levels ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Export is limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows. Narrow your filters and try again.`,
        });
      }
    }
    const productIds = [...new Set(all.map((inv) => inv.productId))];
    const locationIds = [...new Set(all.map((inv) => inv.locationId))];
    const [productNames, locationNames] = await Promise.all([
      this.resolveProductNames(productIds),
      this.resolveLocationNames(locationIds),
    ]);
    const rows = all.map((inv) => ({
      product: productNames.get(inv.productId) ?? inv.productId,
      location: locationNames.get(inv.locationId) ?? inv.locationId,
      stock: inv.stockCount,
      reserved: inv.reservedCount,
      available: Number(inv.stockCount) - Number(inv.reservedCount),
      status: inv.status,
      updated: new Date(inv.updatedAt).toLocaleDateString(),
    }));
    const filteredRows = rows.filter((row) => {
      if (input.filters?.status && row.status !== input.filters.status) return false;
      if (typeof input.filters?.maxAvailable === 'number' && row.available > input.filters.maxAvailable) return false;
      return true;
    });
    const columns = [
      { key: 'product', label: 'Product' },
      { key: 'location', label: 'Location' },
      { key: 'stock', label: 'Stock Count' },
      { key: 'reserved', label: 'Reserved' },
      { key: 'available', label: 'Available' },
      { key: 'status', label: 'Status' },
      { key: 'updated', label: 'Last Updated' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `inventory-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportFinanceInvoices(input: Extract<ExportReportInput, { reportKey: 'finance_invoices' }>, user: SessionUser, date: string, effectiveBranchIds?: string[] | null) {
    this.ensureExportPermission(user, 'finance.read', 'finance.export');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const all: Awaited<ReturnType<FinanceService['listInvoices']>>['invoices'] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const invoicesInput = listInvoicesSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      const list = await this.financeService.listInvoices(invoicesInput, effectiveBranchIds);
      const batch = list.invoices ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Export is limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows. Narrow your filters and try again.`,
        });
      }
    }
    const rows = all.map((inv) => ({
      reference: inv.referenceFormatted ?? `INV-${inv.referenceNumber}`,
      orderId: inv.orderId ?? '',
      amount: inv.totalAmount,
      status: inv.status,
      dueDate: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '',
    }));
    const filteredRows = rows.filter((row) => {
      if (typeof input.filters?.minAmount === 'number' && Number(row.amount ?? 0) < input.filters.minAmount) return false;
      if (typeof input.filters?.maxAmount === 'number' && Number(row.amount ?? 0) > input.filters.maxAmount) return false;
      return true;
    });
    const columns = [
      { key: 'reference', label: 'Reference' },
      { key: 'orderId', label: 'Order ID' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'dueDate', label: 'Due Date' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `invoices-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportLogisticsLocations(
    input: Extract<ExportReportInput, { reportKey: 'logistics_locations' }>,
    user: SessionUser,
    date: string,
  ) {
    this.ensureExportPermission(user, 'logistics.providers.view', 'logistics.export');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const effectiveStart = startDate ?? '2020-01-01';

    // Per-location performance (orders, stock, remittance)
    const performance = await this.logisticsService.getLogisticsLocationPerformance(
      effectiveStart,
      endDate,
    );

    // Enrich with location detail (address, whatsapp) and provider contact info
    const locationDetails = await this.db
      .select({
        id: schema.logisticsLocations.id,
        address: schema.logisticsLocations.address,
        whatsappGroupLink: schema.logisticsLocations.whatsappGroupLink,
        contactInfo: schema.logisticsProviders.contactInfo,
        coverageArea: schema.logisticsProviders.coverageArea,
      })
      .from(schema.logisticsLocations)
      .innerJoin(schema.logisticsProviders, eq(schema.logisticsProviders.id, schema.logisticsLocations.providerId));
    const detailMap = new Map(locationDetails.map((d) => [d.id, d]));

    let data = performance;
    if (input.filters?.providerId) {
      data = data.filter((l) => l.providerId === input.filters!.providerId);
    }
    if (input.filters?.status) {
      data = data.filter((l) => l.status === input.filters!.status);
    }

    const rows = data.map((l) => {
      const detail = detailMap.get(l.locationId);
      return {
        locationName: l.locationName,
        providerName: l.providerName ?? '',
        contactInfo: detail?.contactInfo ?? '',
        address: detail?.address ?? '',
        whatsappGroupLink: detail?.whatsappGroupLink ?? '',
        coverageArea: detail?.coverageArea ?? '',
        status: l.status,
        totalAssigned: l.totalAssigned,
        delivered: l.delivered,
        inTransit: l.inTransit,
        dispatched: l.dispatched,
        returned: l.returned,
        deliveryRate: `${l.deliveryRate.toFixed(2)}%`,
        delinquencyRate: `${l.delinquencyRate.toFixed(2)}%`,
        remittedAmount: l.remittedAmount,
        pendingRemittanceAmount: l.pendingRemittanceAmount,
        unitsDelivered: l.unitsDelivered,
        availableStock: l.availableStock,
        reservedStock: l.reservedStock,
        stockReceived: l.stockReceived,
        stockSold: l.stockSold,
        stockTransferredOut: l.stockTransferredOut,
        stockAdjusted: l.stockAdjusted,
      };
    });

    const columns = [
      { key: 'locationName', label: 'Location' },
      { key: 'providerName', label: 'Company' },
      { key: 'contactInfo', label: 'Phone / Contact' },
      { key: 'address', label: 'Address' },
      { key: 'whatsappGroupLink', label: 'WhatsApp Group' },
      { key: 'coverageArea', label: 'Coverage Area' },
      { key: 'status', label: 'Status' },
      { key: 'totalAssigned', label: 'Orders Assigned' },
      { key: 'delivered', label: 'Delivered' },
      { key: 'inTransit', label: 'In Transit' },
      { key: 'dispatched', label: 'Dispatched' },
      { key: 'returned', label: 'Returned' },
      { key: 'deliveryRate', label: 'Delivery %' },
      { key: 'delinquencyRate', label: 'Delinquency %' },
      { key: 'remittedAmount', label: 'Cash Remitted (₦)' },
      { key: 'pendingRemittanceAmount', label: 'Pending Remittance (₦)' },
      { key: 'unitsDelivered', label: 'Units Delivered' },
      { key: 'availableStock', label: 'Available Stock' },
      { key: 'reservedStock', label: 'Reserved Stock' },
      { key: 'stockReceived', label: 'Stock Received' },
      { key: 'stockSold', label: 'Stock Sold' },
      { key: 'stockTransferredOut', label: 'Transferred Out' },
      { key: 'stockAdjusted', label: 'Reconciled' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));

    return { filename: `logistics-locations-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  private async exportLogisticsPartners(
    input: Extract<ExportReportInput, { reportKey: 'logistics_partners' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'logistics.providers.view', 'logistics.export');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    // "All time" resolves to no dates, but the performance method defaults to
    // month-to-date when no range is given. Pass an epoch start to override.
    const effectiveStart = startDate ?? '2020-01-01';
    const performance = await this.logisticsService.getLogisticsProviderPerformance(
      effectiveStart,
      endDate,
      currentBranchId,
      effectiveBranchIds,
      input.filters?.productId,
      true, // includeInactive — export should list all providers
    );

    let data = performance;
    if (input.filters?.providerId) {
      data = data.filter((p) => p.providerId === input.filters!.providerId);
    }
    if (input.filters?.status) {
      data = data.filter((p) => p.status === input.filters!.status);
    }

    // Fetch location names per provider for the "Locations" column
    const providerIds = data.map((p) => p.providerId);
    const locationRows = providerIds.length > 0
      ? await this.db
          .select({
            providerId: schema.logisticsLocations.providerId,
            name: schema.logisticsLocations.name,
          })
          .from(schema.logisticsLocations)
          .where(inArray(schema.logisticsLocations.providerId, providerIds))
      : [];
    const locationNamesByProvider = new Map<string, string[]>();
    for (const row of locationRows) {
      if (!row.providerId) continue;
      const list = locationNamesByProvider.get(row.providerId) ?? [];
      list.push(row.name);
      locationNamesByProvider.set(row.providerId, list);
    }

    const rows = data.map((p) => ({
      providerName: p.providerName,
      contactInfo: p.contactInfo,
      coverageArea: p.coverageArea,
      status: p.status,
      locations: (locationNamesByProvider.get(p.providerId) ?? []).join(', '),
      totalAssigned: p.totalAssigned,
      delivered: p.delivered,
      inTransit: p.inTransit,
      dispatched: p.dispatched,
      returned: p.returned,
      deliveryRate: `${p.deliveryRate.toFixed(2)}%`,
      delinquencyRate: `${p.delinquencyRate.toFixed(2)}%`,
      remittedAmount: p.remittedAmount,
      pendingRemittanceAmount: p.pendingRemittanceAmount,
      unitsDelivered: p.unitsDelivered,
      availableStock: p.availableStock,
      reservedStock: p.reservedStock,
      stockReceived: p.stockReceived,
      stockSold: p.stockSold,
      stockTransferredOut: p.stockTransferredOut,
      stockAdjusted: p.stockAdjusted,
    }));

    const columns = [
      { key: 'providerName', label: 'Company' },
      { key: 'contactInfo', label: 'Phone / Contact' },
      { key: 'coverageArea', label: 'Coverage Area' },
      { key: 'status', label: 'Status' },
      { key: 'locations', label: 'Locations' },
      { key: 'totalAssigned', label: 'Orders Assigned' },
      { key: 'delivered', label: 'Delivered' },
      { key: 'inTransit', label: 'In Transit' },
      { key: 'dispatched', label: 'Dispatched' },
      { key: 'returned', label: 'Returned' },
      { key: 'deliveryRate', label: 'Delivery %' },
      { key: 'delinquencyRate', label: 'Delinquency %' },
      { key: 'remittedAmount', label: 'Cash Remitted (₦)' },
      { key: 'pendingRemittanceAmount', label: 'Pending Remittance (₦)' },
      { key: 'unitsDelivered', label: 'Units Delivered' },
      { key: 'availableStock', label: 'Available Stock' },
      { key: 'reservedStock', label: 'Reserved Stock' },
      { key: 'stockReceived', label: 'Stock Received' },
      { key: 'stockSold', label: 'Stock Sold' },
      { key: 'stockTransferredOut', label: 'Transferred Out' },
      { key: 'stockAdjusted', label: 'Reconciled' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));

    return { filename: `logistics-partners-${date}.csv`, csvContent: toCsv(rows, columns) };
  }
}
