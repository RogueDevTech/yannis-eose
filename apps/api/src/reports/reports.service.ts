import { Injectable } from '@nestjs/common';
import { TRPCError } from '@trpc/server';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import {
  listFundingSchema,
  listInventorySchema,
  listInvoicesSchema,
  listOrdersSchema,
} from '@yannis/shared';
import type { ExportReportInput, ExportDateRange } from '@yannis/shared';
import { OrdersService } from '../orders/orders.service';
import { MarketingService } from '../marketing/marketing.service';
import { InventoryService } from '../inventory/inventory.service';
import { FinanceService } from '../finance/finance.service';
import { isAdminLevel } from '../common/authz';

type CsvRow = Record<string, string | number | boolean | null | undefined>;

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
  // this_month default
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { startDate: start.toISOString().split('T')[0] ?? '', endDate };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly marketingService: MarketingService,
    private readonly inventoryService: InventoryService,
    private readonly financeService: FinanceService,
  ) {}

  async exportCsv(input: ExportReportInput, user: SessionUser, currentBranchId: string | null): Promise<{ filename: string; csvContent: string }> {
    const date = todayISODate();
    switch (input.reportKey) {
      case 'cs_orders':
        return this.exportCsOrders(input as Extract<ExportReportInput, { reportKey: 'cs_orders' }>, user, currentBranchId, date);
      case 'marketing_orders':
        return this.exportMarketingOrders(input as Extract<ExportReportInput, { reportKey: 'marketing_orders' }>, user, currentBranchId, date);
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

  private ensurePermission(user: SessionUser, permission: string): void {
    if (isAdminLevel(user)) return;
    if ((user.permissions ?? []).includes(permission)) return;
    throw new TRPCError({ code: 'FORBIDDEN', message: `Missing ${permission}` });
  }

  private async exportCsOrders(input: Extract<ExportReportInput, { reportKey: 'cs_orders' }>, user: SessionUser, currentBranchId: string | null, date: string) {
    this.ensurePermission(user, 'orders.read');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const listInput = listOrdersSchema.parse({
      page: 1,
      limit: 1000,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...(input.filters?.status ? { status: input.filters.status } : {}),
      ...(input.filters?.search ? { search: input.filters.search } : {}),
      ...(input.filters?.assignedCsId ? { assignedCsId: input.filters.assignedCsId } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    const result = await this.ordersService.list(listInput, currentBranchId);
    const rows = (result.orders ?? []).map((o) => ({
      id: o.id,
      customer: o.customerName,
      assignedCs: o.assignedCsName ?? '—',
      phone: o.customerPhoneDisplay ?? '',
      status: o.status,
      amount: o.totalAmount ?? '',
      created: new Date(o.createdAt).toLocaleDateString(),
    }));
    const columns = [
      { key: 'id', label: 'Order ID' },
      { key: 'customer', label: 'Customer' },
      { key: 'assignedCs', label: 'Assigned closer' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `cs-orders-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  private async exportMarketingOrders(input: Extract<ExportReportInput, { reportKey: 'marketing_orders' }>, user: SessionUser, currentBranchId: string | null, date: string) {
    this.ensurePermission(user, 'marketing.orders');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const listInput = listOrdersSchema.parse({
      page: 1,
      limit: 1000,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      ...(input.filters?.status ? { status: input.filters.status } : {}),
      ...(input.filters?.search ? { search: input.filters.search } : {}),
      ...(input.filters?.mediaBuyerId ? { mediaBuyerId: input.filters.mediaBuyerId } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    const result = await this.ordersService.list(listInput, currentBranchId);
    const rows = (result.orders ?? []).map((o) => ({
      id: o.id,
      customer: o.customerName,
      mediaBuyer: o.mediaBuyerName ?? '—',
      status: o.status,
      amount: o.totalAmount ?? '',
      created: new Date(o.createdAt).toLocaleDateString(),
    }));
    const columns = [
      { key: 'id', label: 'Order ID' },
      { key: 'customer', label: 'Customer' },
      { key: 'mediaBuyer', label: 'Media Buyer' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'created', label: 'Created' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `marketing-orders-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  private async exportDisbursements(input: Extract<ExportReportInput, { reportKey: 'disbursements' }>, user: SessionUser, currentBranchId: string | null, date: string) {
    this.ensurePermission(user, 'finance.disburse');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const fundingInput = listFundingSchema.parse({
      page: 1,
      limit: 1000,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(input.filters?.status ? { status: input.filters.status } : {}),
      ...(input.filters?.receiverId ? { receiverId: input.filters.receiverId } : {}),
      ...(input.filters?.search ? { search: input.filters.search } : {}),
    });
    const result = await this.marketingService.listFunding(fundingInput, currentBranchId);
    const rows = (result.records ?? []).map((f) => ({
      id: f.id,
      sender: f.senderName ?? f.senderId,
      receiver: f.receiverName ?? f.receiverId,
      amount: f.amount,
      status: f.status,
      receipt: f.receiptUrl ?? '',
      date: new Date(f.sentAt).toLocaleDateString(),
      verifiedAt: f.verifiedAt ? new Date(f.verifiedAt).toLocaleDateString() : '',
    }));
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
    return { filename: `disbursements-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  private async exportInventory(input: Extract<ExportReportInput, { reportKey: 'inventory' }>, user: SessionUser, date: string) {
    this.ensurePermission(user, 'inventory.read');
    if (!isAdminLevel(user) && user.role !== 'STOCK_MANAGER') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Inventory export is restricted to admin-level and stock manager' });
    }
    const levelsInput = listInventorySchema.parse({
      page: 1,
      limit: 1000,
      sortBy: input.filters?.sort ? 'available' : 'updatedAt',
      sortOrder: input.filters?.sort === 'lowestAvailable' ? 'asc' : 'desc',
      ...(input.filters?.productId ? { productId: input.filters.productId } : {}),
      ...(input.filters?.locationId ? { locationId: input.filters.locationId } : {}),
      ...(input.filters?.search ? { search: input.filters.search } : {}),
    });
    const levels = await this.inventoryService.listLevels(levelsInput);
    const rows = (levels.levels ?? []).map((inv) => ({
      product: inv.productId,
      location: inv.locationId,
      stock: inv.stockCount,
      reserved: inv.reservedCount,
      available: Number(inv.stockCount) - Number(inv.reservedCount),
      status: inv.status,
      updated: new Date(inv.updatedAt).toLocaleDateString(),
    }));
    const columns = [
      { key: 'product', label: 'Product' },
      { key: 'location', label: 'Location' },
      { key: 'stock', label: 'Stock Count' },
      { key: 'reserved', label: 'Reserved' },
      { key: 'available', label: 'Available' },
      { key: 'status', label: 'Status' },
      { key: 'updated', label: 'Last Updated' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `inventory-${date}.csv`, csvContent: toCsv(rows, columns) };
  }

  private async exportFinanceInvoices(input: Extract<ExportReportInput, { reportKey: 'finance_invoices' }>, user: SessionUser, date: string) {
    this.ensurePermission(user, 'finance.read');
    const { startDate, endDate } = resolveDateRange(input.dateRange);
    const invoicesInput = listInvoicesSchema.parse({
      page: 1,
      limit: 1000,
      ...(input.filters?.status ? { status: input.filters.status } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    });
    const list = await this.financeService.listInvoices(invoicesInput);
    const rows = (list.invoices ?? []).map((inv) => ({
      reference: inv.referenceFormatted ?? `INV-${inv.referenceNumber}`,
      orderId: inv.orderId ?? '',
      amount: inv.totalAmount,
      status: inv.status,
      dueDate: inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '',
    }));
    const columns = [
      { key: 'reference', label: 'Reference' },
      { key: 'orderId', label: 'Order ID' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'dueDate', label: 'Due Date' },
    ].filter((c) => input.columns.includes(c.key as (typeof input.columns)[number]));
    return { filename: `invoices-${date}.csv`, csvContent: toCsv(rows, columns) };
  }
}

