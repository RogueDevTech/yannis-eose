import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { isAdminLevel } from '../common/authz';
import {
  listFundingSchema,
  listInventorySchema,
  listInvoicesSchema,
  listOrdersSchema,
  listCartOrdersSchema,
  listFollowUpOrdersSchema,
  listDeliveryRemittancesSchema,
  listPayoutsSchema,
  listFundingRequestsSchema,
  listUsersSchema,
  listExpensesSchema,
  listProductsSchema,
  listShipmentsSchema,
  listLocationsSchema,
  listProvidersSchema,
} from '@yannis/shared';
import type { ExportReportInput, ExportDateRange, ListOrdersInput } from '@yannis/shared';
import { OrdersService } from '../orders/orders.service';
import { FollowUpConfigService } from '../orders/follow-up-config.service';
import { MarketingService } from '../marketing/marketing.service';
import { InventoryService } from '../inventory/inventory.service';
import { ShipmentsService } from '../inventory/shipments.service';
import { FinanceService } from '../finance/finance.service';
import { ExpenseSubmissionService } from '../finance/expense-submission.service';
import { UsersService } from '../users/users.service';
import { LogisticsService } from '../logistics/logistics.service';
import { CartOrdersService } from '../cart-orders/cart-orders.service';
import { HrService } from '../hr/hr.service';
import { ProductsService } from '../products/products.service';

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
    private readonly followUpConfigService: FollowUpConfigService,
    private readonly marketingService: MarketingService,
    private readonly inventoryService: InventoryService,
    private readonly shipmentsService: ShipmentsService,
    private readonly financeService: FinanceService,
    private readonly expenseService: ExpenseSubmissionService,
    private readonly usersService: UsersService,
    private readonly logisticsService: LogisticsService,
    private readonly cartOrdersService: CartOrdersService,
    private readonly hrService: HrService,
    private readonly productsService: ProductsService,
  ) {}

  async exportCsv(input: ExportReportInput, user: SessionUser, currentBranchId: string | null, effectiveBranchIds?: string[] | null): Promise<{ filename: string; csvContent: string }> {
    const date = todayISODate();
    const eIds = effectiveBranchIds ?? null;
    switch (input.reportKey) {
      case 'cs_orders':
        return this.exportCsOrders(input as Extract<ExportReportInput, { reportKey: 'cs_orders' }>, user, currentBranchId, date, eIds);
      case 'cs_team':
        return this.exportCsTeam(input as Extract<ExportReportInput, { reportKey: 'cs_team' }>, user, currentBranchId, date, eIds);
      case 'marketing_orders':
        return this.exportMarketingOrders(input as Extract<ExportReportInput, { reportKey: 'marketing_orders' }>, user, currentBranchId, date, eIds);
      case 'marketing_team':
        return this.exportMarketingTeam(input as Extract<ExportReportInput, { reportKey: 'marketing_team' }>, user, currentBranchId, date, eIds);
      case 'disbursements':
        return this.exportDisbursements(input as Extract<ExportReportInput, { reportKey: 'disbursements' }>, user, currentBranchId, date, eIds);
      case 'inventory':
        return this.exportInventory(input as Extract<ExportReportInput, { reportKey: 'inventory' }>, user, date);
      case 'finance_invoices':
        return this.exportFinanceInvoices(input as Extract<ExportReportInput, { reportKey: 'finance_invoices' }>, user, date);
      case 'cross_funnel':
        return this.exportCrossFunnel(input as Extract<ExportReportInput, { reportKey: 'cross_funnel' }>, user, currentBranchId, date, eIds);
      case 'logistics_locations':
        return this.exportLogisticsLocations(input as Extract<ExportReportInput, { reportKey: 'logistics_locations' }>, user, date);
      case 'logistics_partners':
        return this.exportLogisticsPartners(input as Extract<ExportReportInput, { reportKey: 'logistics_partners' }>, user, date);
      case 'cart_orders':
        return this.exportCartOrders(input as Extract<ExportReportInput, { reportKey: 'cart_orders' }>, user, currentBranchId, date, eIds);
      case 'follow_up_orders':
        return this.exportFollowUpOrders(input as Extract<ExportReportInput, { reportKey: 'follow_up_orders' }>, user, currentBranchId, date, eIds);
      case 'delivery_remittances':
        return this.exportDeliveryRemittances(input as Extract<ExportReportInput, { reportKey: 'delivery_remittances' }>, user, currentBranchId, date);
      case 'payroll':
        return this.exportPayroll(input as Extract<ExportReportInput, { reportKey: 'payroll' }>, user, date);
      case 'funding_requests':
        return this.exportFundingRequests(input as Extract<ExportReportInput, { reportKey: 'funding_requests' }>, user, currentBranchId, date, eIds);
      case 'users':
        return this.exportUsers(input as Extract<ExportReportInput, { reportKey: 'users' }>, user, currentBranchId, date, eIds);
      case 'expenses':
        return this.exportExpenses(input as Extract<ExportReportInput, { reportKey: 'expenses' }>, user, date);
      case 'products':
        return this.exportProducts(input as Extract<ExportReportInput, { reportKey: 'products' }>, user, date);
      case 'shipments':
        return this.exportShipments(input as Extract<ExportReportInput, { reportKey: 'shipments' }>, user, date);
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
    if (isAdminLevel(user)) return;
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

  private async exportDisbursements(input: Extract<ExportReportInput, { reportKey: 'disbursements' }>, user: SessionUser, currentBranchId: string | null, date: string, effectiveBranchIds?: string[] | null) {
    this.ensureExportPermission(user, 'finance.disburse', 'finance.export');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
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
      const result = await this.marketingService.listFunding(fundingInput, currentBranchId, effectiveBranchIds);
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

  /* ── Cross-Funnel Duplicates ──────────────────────────────────── */

  private async exportCrossFunnel(
    input: Extract<ExportReportInput, { reportKey: 'cross_funnel' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'marketing.read', 'marketing.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
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
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((r) => ({
      customerName: r.customerName,
      duplicateType: r.duplicateType ?? '—',
      mediaBuyer: r.mediaBuyerName ?? '—',
      originalMediaBuyer: r.originalMediaBuyerName ?? '—',
      product: r.productName ?? '—',
      campaign: r.campaignName ?? '—',
      originalCampaign: r.originalCampaignName ?? '—',
      originalOrderId: r.originalOrderId ?? '',
      originalOrderStatus: r.originalOrderStatus ?? '—',
      originalOrderAmount: r.originalOrderAmount ?? '',
      attemptedAt: r.attemptedAt ? new Date(r.attemptedAt).toLocaleDateString() : '',
      originalOrderCreatedAt: r.originalOrderCreatedAt ? new Date(r.originalOrderCreatedAt).toLocaleDateString() : '',
    }));
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
    return { filename: `cross-funnel-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Logistics Locations ──────────────────────────────────────── */

  private async exportLogisticsLocations(
    input: Extract<ExportReportInput, { reportKey: 'logistics_locations' }>,
    user: SessionUser,
    date: string,
  ) {
    this.ensureExportPermission(user, 'logistics.providers.view', 'logistics.export');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listLocationsSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.providerId ? { providerId: input.filters.providerId } : {}),
        ...(input.filters?.status ? { status: input.filters.status } : {}),
      });
      const result = await this.logisticsService.listLocations(parsed);
      const batch = result.locations ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((loc) => ({
      locationName: loc.name,
      providerName: loc.providerName ?? '—',
      contactInfo: loc.contactInfo ? JSON.stringify(loc.contactInfo) : '',
      address: loc.address ?? '',
      whatsappGroupLink: loc.whatsappGroupLink ?? '',
      coverageArea: loc.coverageArea ? JSON.stringify(loc.coverageArea) : '',
      status: loc.status,
      totalAssigned: '',
      delivered: '',
      inTransit: '',
      dispatched: '',
      returned: '',
      deliveryRate: '',
      delinquencyRate: '',
      remittedAmount: '',
      pendingRemittanceAmount: '',
      unitsDelivered: '',
      availableStock: loc.totalStock ?? 0,
      reservedStock: '',
      stockReceived: '',
      stockSold: '',
      stockTransferredOut: '',
      stockAdjusted: '',
    }));
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

  /* ── Logistics Partners ───────────────────────────────────────── */

  private async exportLogisticsPartners(
    input: Extract<ExportReportInput, { reportKey: 'logistics_partners' }>,
    user: SessionUser,
    date: string,
  ) {
    this.ensureExportPermission(user, 'logistics.providers.view', 'logistics.export');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listProvidersSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
      });
      const result = await this.logisticsService.listProviders(parsed);
      const batch = result.providers ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((p) => ({
      providerName: p.name,
      contactInfo: p.contactInfo ? JSON.stringify(p.contactInfo) : '',
      coverageArea: p.coverageArea ? JSON.stringify(p.coverageArea) : '',
      status: p.status,
      locations: '',
      totalAssigned: '',
      delivered: '',
      inTransit: '',
      dispatched: '',
      returned: '',
      deliveryRate: '',
      delinquencyRate: '',
      remittedAmount: '',
      pendingRemittanceAmount: '',
      unitsDelivered: '',
      availableStock: '',
      reservedStock: '',
      stockReceived: '',
      stockSold: '',
      stockTransferredOut: '',
      stockAdjusted: '',
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

  /* ── Cart Orders ──────────────────────────────────────────────── */

  private async exportCartOrders(
    input: Extract<ExportReportInput, { reportKey: 'cart_orders' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'orders.read', 'orders.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listCartOrdersSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      const result = await this.cartOrdersService.list(parsed, currentBranchId, effectiveBranchIds);
      const batch = result.orders ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber ?? '',
      customer: o.customerName ?? '',
      phone: o.customerPhone ?? '',
      status: o.status,
      amount: o.totalAmount ?? '',
      product: (o.orderItems ?? []).map((i: { productName?: string }) => i.productName).filter(Boolean).join(', ') || '—',
      assignedCs: o.assignedCsName ?? '—',
      mediaBuyer: o.mediaBuyerName ?? '—',
      campaign: o.campaignName ?? '—',
      created: o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'id', label: 'Order ID' },
      { key: 'orderNumber', label: 'Order Number' },
      { key: 'customer', label: 'Customer' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'product', label: 'Product' },
      { key: 'assignedCs', label: 'Assigned CS' },
      { key: 'mediaBuyer', label: 'Media Buyer' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `cart-orders-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Follow-Up Orders ─────────────────────────────────────────── */

  private async exportFollowUpOrders(
    input: Extract<ExportReportInput, { reportKey: 'follow_up_orders' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'orders.read', 'orders.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listFollowUpOrdersSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      const result = await this.followUpConfigService.listFollowUpOrders(parsed, currentBranchId, effectiveBranchIds);
      const batch = result.orders ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber ?? '',
      customer: o.customerName ?? '',
      status: o.status,
      amount: o.totalAmount ?? '',
      product: o.primaryProductName ?? '—',
      assignedCs: o.assignedCsName ?? '—',
      mediaBuyer: o.mediaBuyerName ?? '—',
      campaign: o.campaignName ?? '—',
      source: o.orderSource ?? '—',
      created: o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '',
      deliveredAt: o.deliveredAt ? new Date(o.deliveredAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'id', label: 'Order ID' },
      { key: 'orderNumber', label: 'Order Number' },
      { key: 'customer', label: 'Customer' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'product', label: 'Product' },
      { key: 'assignedCs', label: 'Assigned CS' },
      { key: 'mediaBuyer', label: 'Media Buyer' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'source', label: 'Source' },
      { key: 'created', label: 'Created' },
      { key: 'deliveredAt', label: 'Delivered At' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `follow-up-orders-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Delivery Remittances ─────────────────────────────────────── */

  private async exportDeliveryRemittances(
    input: Extract<ExportReportInput, { reportKey: 'delivery_remittances' }>,
    user: SessionUser,
    _currentBranchId: string | null,
    date: string,
  ) {
    this.ensureExportPermission(user, 'logistics.providers.view', 'logistics.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listDeliveryRemittancesSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      const result = await this.logisticsService.listDeliveryRemittances(parsed, user);
      const batch = Array.isArray(result) ? result : (result as { remittances?: unknown[] }).remittances ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((r) => ({
      id: r.id,
      locationName: r.locationName ?? '—',
      providerName: r.providerName ?? '—',
      status: r.status,
      orderCount: r.orderSummary?.count ?? 0,
      orderAmount: r.orderSummary?.amount ?? 0,
      sentBy: r.sentByName ?? '—',
      sentAt: r.sentAt ? new Date(r.sentAt).toLocaleDateString() : '',
      created: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'id', label: 'ID' },
      { key: 'locationName', label: 'Location' },
      { key: 'providerName', label: 'Company' },
      { key: 'status', label: 'Status' },
      { key: 'orderCount', label: 'Order Count' },
      { key: 'orderAmount', label: 'Order Amount' },
      { key: 'sentBy', label: 'Sent By' },
      { key: 'sentAt', label: 'Sent At' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `delivery-remittances-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Payroll ──────────────────────────────────────────────────── */

  private async exportPayroll(
    input: Extract<ExportReportInput, { reportKey: 'payroll' }>,
    user: SessionUser,
    date: string,
  ) {
    this.ensureExportPermission(user, 'hr.payroll', 'hr.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listPayoutsSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(startDate ? { periodStart: startDate } : {}),
        ...(endDate ? { periodEnd: endDate } : {}),
      });
      const result = await this.hrService.listPayouts(parsed);
      const batch = result.payouts ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    // Enrich staff names
    const staffIds = [...new Set(all.map((p) => p.staffId).filter(Boolean))];
    const staffMap = new Map<string, string>();
    const roleMap = new Map<string, string>();
    if (staffIds.length > 0) {
      const usersResult = await this.usersService.list(listUsersSchema.parse({ page: 1, limit: 500, sortBy: 'name', sortOrder: 'asc' }), user, null);
      for (const u of usersResult.users ?? []) {
        staffMap.set(u.id, u.name);
        roleMap.set(u.id, u.role);
      }
    }
    const rows = all.map((p) => ({
      staffName: staffMap.get(p.staffId) ?? p.staffId,
      role: (roleMap.get(p.staffId) ?? '').replace(/_/g, ' '),
      periodStart: p.periodStart ? new Date(p.periodStart).toLocaleDateString() : '',
      periodEnd: p.periodEnd ? new Date(p.periodEnd).toLocaleDateString() : '',
      baseSalary: p.baseSalary ?? 0,
      performanceBonus: p.performanceBonus ?? 0,
      addOns: p.addOnsTotal ?? 0,
      deductions: p.deductionsTotal ?? 0,
      totalPayout: p.totalPayout ?? 0,
      status: p.status,
      created: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'staffName', label: 'Staff' },
      { key: 'role', label: 'Role' },
      { key: 'periodStart', label: 'Period Start' },
      { key: 'periodEnd', label: 'Period End' },
      { key: 'baseSalary', label: 'Base Salary' },
      { key: 'performanceBonus', label: 'Bonus' },
      { key: 'addOns', label: 'Add-Ons' },
      { key: 'deductions', label: 'Deductions' },
      { key: 'totalPayout', label: 'Total Payout' },
      { key: 'status', label: 'Status' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `payroll-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Funding Requests ─────────────────────────────────────────── */

  private async exportFundingRequests(
    input: Extract<ExportReportInput, { reportKey: 'funding_requests' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'marketing.read', 'marketing.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listFundingRequestsSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      const result = await this.marketingService.listFundingRequests(parsed, currentBranchId, effectiveBranchIds);
      const batch = result.records ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((r) => ({
      id: r.id,
      requester: r.requesterName ?? '—',
      targetUser: r.targetUserName ?? '—',
      amount: r.amount ?? 0,
      reason: r.reason ?? '',
      status: r.status,
      balanceAtRequest: r.balanceAtRequest ?? '',
      created: r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '',
      resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'id', label: 'ID' },
      { key: 'requester', label: 'Requester' },
      { key: 'targetUser', label: 'Target User' },
      { key: 'amount', label: 'Amount' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Status' },
      { key: 'balanceAtRequest', label: 'Balance at Request' },
      { key: 'created', label: 'Created' },
      { key: 'resolvedAt', label: 'Resolved At' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `funding-requests-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Users ────────────────────────────────────────────────────── */

  private async exportUsers(
    input: Extract<ExportReportInput, { reportKey: 'users' }>,
    user: SessionUser,
    currentBranchId: string | null,
    date: string,
    effectiveBranchIds?: string[] | null,
  ) {
    this.ensureExportPermission(user, 'hr.users', 'hr.export');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listUsersSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        sortBy: 'name',
        sortOrder: 'asc',
        ...(input.filters?.role ? { role: input.filters.role } : {}),
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
      });
      const result = await this.usersService.list(parsed, user, currentBranchId, effectiveBranchIds);
      const batch = result.users ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((u) => ({
      name: u.name,
      email: u.email ?? '',
      role: (u.role ?? '').replace(/_/g, ' '),
      status: u.status,
      branches: (u.branchMemberships ?? [])
        .map((b: { branchName?: string; isPrimary?: boolean }) => (b.isPrimary ? `${b.branchName}*` : b.branchName))
        .join(' / ') || '—',
      capacity: u.capacity ?? '',
      isSupervisor: u.isTeamSupervisor ? 'Yes' : 'No',
      created: u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'status', label: 'Status' },
      { key: 'branches', label: 'Branches' },
      { key: 'capacity', label: 'Capacity' },
      { key: 'isSupervisor', label: 'Supervisor' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `users-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Expenses ─────────────────────────────────────────────────── */

  private async exportExpenses(
    input: Extract<ExportReportInput, { reportKey: 'expenses' }>,
    user: SessionUser,
    date: string,
  ) {
    this.ensureExportPermission(user, 'finance.read', 'finance.export');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listExpensesSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
      });
      const result = await this.expenseService.listExpenses(parsed);
      const batch = result.expenses ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((e) => ({
      id: e.id,
      description: e.description ?? '',
      amount: e.amount ?? 0,
      status: e.status,
      submittedBy: e.submittedBy ?? '—',
      submittedAt: e.submittedAt ? new Date(e.submittedAt).toLocaleDateString() : '',
      approvedBy: e.approvedBy ?? '—',
      approvedAt: e.approvedAt ? new Date(e.approvedAt).toLocaleDateString() : '',
      created: e.createdAt ? new Date(e.createdAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'id', label: 'ID' },
      { key: 'description', label: 'Description' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'submittedBy', label: 'Submitted By' },
      { key: 'submittedAt', label: 'Submitted At' },
      { key: 'approvedBy', label: 'Approved By' },
      { key: 'approvedAt', label: 'Approved At' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `expenses-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Products ─────────────────────────────────────────────────── */

  private async exportProducts(
    input: Extract<ExportReportInput, { reportKey: 'products' }>,
    user: SessionUser,
    date: string,
  ) {
    this.ensureExportPermission(user, 'inventory.read', 'inventory.export');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listProductsSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        sortBy: 'name',
        sortOrder: 'asc',
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(input.filters?.search ? { search: input.filters.search } : {}),
        ...(input.filters?.categoryId ? { categoryId: input.filters.categoryId } : {}),
      });
      const result = await this.productsService.list(parsed, user.id, user.role);
      const batch = result.products ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((p) => ({
      name: p.name,
      category: p.categoryName ?? '—',
      baseSalePrice: p.baseSalePrice ?? 0,
      costPrice: p.costPrice ?? '—',
      totalStock: p.totalStock ?? 0,
      status: p.status,
      created: p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'category', label: 'Category' },
      { key: 'baseSalePrice', label: 'Base Sale Price' },
      { key: 'costPrice', label: 'Cost Price' },
      { key: 'totalStock', label: 'Total Stock' },
      { key: 'status', label: 'Status' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `products-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  /* ── Shipments ────────────────────────────────────────────────── */

  private async exportShipments(
    input: Extract<ExportReportInput, { reportKey: 'shipments' }>,
    user: SessionUser,
    date: string,
  ) {
    this.ensureExportPermission(user, 'inventory.read', 'inventory.export');
    const { startDate, endDate } = resolveOrderListDates(input.dateRange, input.filters);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = [];
    for (let page = 1; page <= EXPORT_MAX_PAGES; page++) {
      const parsed = listShipmentsSchema.parse({
        page,
        limit: EXPORT_PAGE_LIMIT,
        ...(input.filters?.status ? { status: input.filters.status } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      const result = await this.shipmentsService.listShipments(parsed, user, null);
      const batch = result.rows ?? [];
      all.push(...batch);
      if (batch.length < EXPORT_PAGE_LIMIT) break;
      if (page === EXPORT_MAX_PAGES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Export limited to ${EXPORT_MAX_PAGES * EXPORT_PAGE_LIMIT} rows.` });
      }
    }
    const rows = all.map((s) => ({
      reference: s.referenceLabel ?? `SHP-${s.referenceNumber}`,
      label: s.label ?? '',
      status: s.status,
      destination: s.destinationLocationName ?? '—',
      supplier: s.supplierName ?? '—',
      lineCount: s.lineCount ?? 0,
      totalExpected: s.totalExpected ?? 0,
      totalReceived: s.totalReceived ?? 0,
      landingCost: s.totalLandingCost ?? '',
      expectedArrival: s.expectedArrivalAt ? new Date(s.expectedArrivalAt).toLocaleDateString() : '',
      created: s.createdAt ? new Date(s.createdAt).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'reference', label: 'Reference' },
      { key: 'label', label: 'Label' },
      { key: 'status', label: 'Status' },
      { key: 'destination', label: 'Destination' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'lineCount', label: 'Line Items' },
      { key: 'totalExpected', label: 'Expected Units' },
      { key: 'totalReceived', label: 'Received Units' },
      { key: 'landingCost', label: 'Landing Cost' },
      { key: 'expectedArrival', label: 'Expected Arrival' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `shipments-${date}.csv`, csvContent: toCsv(rows, columns) };
  }
}
