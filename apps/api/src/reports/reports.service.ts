import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import {
  listFundingSchema,
  listInventorySchema,
  listInvoicesSchema,
  listOrdersSchema,
} from '@yannis/shared';
import type { ExportReportInput, ExportDateRange, ListOrdersInput } from '@yannis/shared';
import { OrdersService } from '../orders/orders.service';
import { MarketingService } from '../marketing/marketing.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinanceService } from '../finance/finance.service';
import { UsersService } from '../users/users.service';

type CsvRow = Record<string, string | number | boolean | null | undefined>;

const EXPORT_PAGE_LIMIT = 100;
const EXPORT_MAX_PAGES = 50;

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
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
    private readonly ordersService: OrdersService,
    private readonly marketingService: MarketingService,
    private readonly inventoryService: InventoryService,
    private readonly financeService: FinanceService,
    private readonly usersService: UsersService,
  ) {}

  async exportCsv(input: ExportReportInput, user: SessionUser, currentBranchId: string | null): Promise<{ filename: string; csvContent: string }> {
    const date = todayISODate();
    switch (input.reportKey) {
      case 'cs_orders':
        return this.exportCsOrders(input as Extract<ExportReportInput, { reportKey: 'cs_orders' }>, user, currentBranchId, date);
      case 'cs_team':
        return this.exportCsTeam(input as Extract<ExportReportInput, { reportKey: 'cs_team' }>, user, currentBranchId, date);
      case 'marketing_orders':
        return this.exportMarketingOrders(input as Extract<ExportReportInput, { reportKey: 'marketing_orders' }>, user, currentBranchId, date);
      case 'marketing_team':
        return this.exportMarketingTeam(input as Extract<ExportReportInput, { reportKey: 'marketing_team' }>, user, currentBranchId, date);
      case 'disbursements':
        return this.exportDisbursements(input as Extract<ExportReportInput, { reportKey: 'disbursements' }>, user, currentBranchId, date);
      case 'inventory':
        return this.exportInventory(input as Extract<ExportReportInput, { reportKey: 'inventory' }>, user, date);
      case 'finance_invoices':
        return this.exportFinanceInvoices(input as Extract<ExportReportInput, { reportKey: 'finance_invoices' }>, user, date);
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
      const result = await this.ordersService.list(listInput, branchId);
      const batch = result.orders ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) return all;
    }
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Export is limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} orders. Narrow your filters and try again.`,
    });
  }

  private async exportCsOrders(input: Extract<ExportReportInput, { reportKey: 'cs_orders' }>, user: SessionUser, currentBranchId: string | null, date: string) {
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
    );
    const rows = orders.map((o) => ({
      id: o.id,
      customer: o.customerName,
      assignedCs: o.assignedCsName ?? '—',
      phone: o.customerPhoneDisplay ?? '',
      status: o.status,
      amount: o.totalAmount ?? '',
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
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `cs-orders-${date}.csv`, csvContent: toCsv(filteredRows, columns) };
  }

  private async exportCsTeam(
    input: Extract<ExportReportInput, { reportKey: 'cs_team' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
  ) {
    this.ensureExportPermission(user, 'cs.teamOverview', 'orders.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    const period: 'this_month' | 'all_time' =
      input.filters?.periodAllTime || (!startDate && !endDate && input.dateRange?.preset === 'all_time')
        ? 'all_time'
        : 'this_month';

    const [team, workloads, leaderboard, inactive] = await Promise.all([
      this.usersService.listCSTeam(),
      this.ordersService.getCSCloserWorkloads(currentBranchId),
      this.ordersService.getCSCloserLeaderboard(period, startDate, endDate),
      this.ordersService.getInactiveAgents(10),
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
  ) {
    this.ensureExportPermission(user, 'marketing.teamOverview', 'marketing.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    const period: 'this_month' | 'all_time' =
      input.filters?.periodAllTime || (!startDate && !endDate && input.dateRange?.preset === 'all_time')
        ? 'all_time'
        : 'this_month';

    const [balances, leaderboard] = await Promise.all([
      this.marketingService.listFundingBalances(user, currentBranchId),
      this.marketingService.getMediaBuyerLeaderboard(period, startDate, endDate, currentBranchId),
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

  private async exportDisbursements(input: Extract<ExportReportInput, { reportKey: 'disbursements' }>, user: SessionUser, currentBranchId: string | null, date: string) {
    this.ensureExportPermission(user, 'finance.disburse', 'finance.export');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const all: Awaited<ReturnType<MarketingService['listFunding']>>['records'] = [];
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
    const rows = all.map((inv) => ({
      product: inv.productId,
      location: inv.locationId,
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

  private async exportFinanceInvoices(input: Extract<ExportReportInput, { reportKey: 'finance_invoices' }>, user: SessionUser, date: string) {
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
      const list = await this.financeService.listInvoices(invoicesInput);
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
}
