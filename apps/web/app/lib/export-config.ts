import type { ExportDatePreset, ExportReportKey } from '@yannis/shared/validators';

export type ExportColumnOption = { key: string; label: string };

export type ExportConfig = {
  reportKey: ExportReportKey;
  title: string;
  description: string;
  columns: ExportColumnOption[];
  defaultColumns: string[];
};

export const EXPORT_CONFIGS: Record<ExportReportKey, ExportConfig> = {
  cs_orders: {
    reportKey: 'cs_orders',
    title: 'Export CS Orders',
    description: 'Choose columns and date range for CS orders export.',
    columns: [
      { key: 'id', label: 'Order ID' },
      { key: 'customer', label: 'Customer' },
      { key: 'assignedCs', label: 'Assigned closer' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'amount', label: 'Amount' },
      { key: 'created', label: 'Created' },
    ],
    defaultColumns: ['id', 'customer', 'assignedCs', 'status', 'amount', 'created'],
  },
  cs_team: {
    reportKey: 'cs_team',
    title: 'Export CS Team',
    description: 'Choose columns and date range for the CS Team Analysis export. Date range scopes the leaderboard counts (assigned / delivered / confirmed / calls).',
    columns: [
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
    ],
    defaultColumns: ['name', 'branches', 'pending', 'capacity', 'assigned', 'delivered', 'confirmed', 'confirmationRate', 'deliveryRate'],
  },
  marketing_team: {
    reportKey: 'marketing_team',
    title: 'Export Marketing Team',
    description: 'Choose columns and date range for the Marketing Team Analysis export. Date range scopes the leaderboard metrics (orders, ROAS, CPA).',
    columns: [
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
    ],
    defaultColumns: ['name', 'branches', 'totalReceived', 'totalSpend', 'balance', 'totalOrders', 'deliveredOrders', 'cpa', 'trueRoas'],
  },
  marketing_orders: {
    reportKey: 'marketing_orders',
    title: 'Export Marketing Orders',
    description: 'Choose columns and date range for marketing orders export.',
    columns: [
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
    ],
    defaultColumns: ['id', 'customer', 'mediaBuyer', 'status', 'amount', 'created'],
  },
  disbursements: {
    reportKey: 'disbursements',
    title: 'Export Disbursements',
    description: 'Choose columns and date range for disbursements export.',
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'sender', label: 'Sender' },
      { key: 'receiver', label: 'Receiver' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'receipt', label: 'Receipt URL' },
      { key: 'date', label: 'Sent Date' },
      { key: 'verifiedAt', label: 'Verified Date' },
    ],
    defaultColumns: ['id', 'sender', 'receiver', 'amount', 'status', 'date'],
  },
  inventory: {
    reportKey: 'inventory',
    title: 'Export Inventory',
    description: 'Choose columns and date range for inventory export.',
    columns: [
      { key: 'product', label: 'Product' },
      { key: 'location', label: 'Location' },
      { key: 'stock', label: 'Stock Count' },
      { key: 'reserved', label: 'Reserved' },
      { key: 'available', label: 'Available' },
      { key: 'status', label: 'Status' },
      { key: 'updated', label: 'Last Updated' },
    ],
    defaultColumns: ['product', 'location', 'stock', 'reserved', 'available', 'status'],
  },
  finance_invoices: {
    reportKey: 'finance_invoices',
    title: 'Export Invoices',
    description: 'Choose columns and date range for invoices export.',
    columns: [
      { key: 'reference', label: 'Reference' },
      { key: 'orderId', label: 'Order ID' },
      { key: 'amount', label: 'Amount' },
      { key: 'status', label: 'Status' },
      { key: 'dueDate', label: 'Due Date' },
    ],
    defaultColumns: ['reference', 'orderId', 'amount', 'status', 'dueDate'],
  },
};

export const EXPORT_DATE_PRESET_OPTIONS: Array<{ value: ExportDatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'all_time', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

