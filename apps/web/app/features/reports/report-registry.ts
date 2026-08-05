/**
 * Report registry — single source of truth for the centralized Reports module
 * (Admin → Reports). Adding a report is one entry here plus (if the data is
 * new) one backend procedure. The catalog page renders cards from this list;
 * each report route resolves its config by slug.
 *
 * Access: the whole module is admin-level (SUPER_ADMIN / ADMIN / SUPPORT). The
 * route loaders enforce it server-side via `requireRole`; there is no
 * per-category gating in v1.
 *
 * Column definitions (which fields a report can show / defaults) are attached
 * per report as they are built out. The catalog only needs the metadata below.
 */

export type ReportCategoryGroup = 'Performance' | 'Operations' | 'Finance' | 'Marketing';

export interface ReportColumnDef {
  /** Stable key sent to the backend / used for CSV headers. */
  key: string;
  /** Human label shown in the column picker and table header. */
  label: string;
  /** Cell alignment in the on-screen table. Numbers/money right-align. */
  align?: 'left' | 'right' | 'center';
  /** Rendering hint: money → NairaPrice, percent → `%` suffix, etc. */
  format?: 'text' | 'number' | 'money' | 'percent';
}

export interface ReportDef {
  /** URL slug: /admin/reports/<slug>. Kebab-case, stable. */
  slug: string;
  /** Card + page title. */
  title: string;
  /** One-line description (no em dashes — CLAUDE.md UI rule). */
  description: string;
  /** Grouping for the catalog layout. */
  group: ReportCategoryGroup;
  /**
   * Whether this report is fully wired to a data source yet. Catalog cards for
   * not-yet-wired reports render disabled with a "Coming soon" hint so the hub
   * ships navigable in Phase A before every category is implemented.
   */
  status: 'live' | 'planned';
  /**
   * Column catalogue for the report shell. Present once the report is wired
   * (Phase B/C). Absent while the report is still 'planned'.
   */
  columns?: ReportColumnDef[];
  /** Default-visible column keys (subset of `columns`). */
  defaultColumns?: string[];
}

/**
 * The 13 report categories from the CEO brief. Order controls catalog display.
 * `status` starts as 'planned' for everything except the two Phase B flagships,
 * which flip to 'live' when their data + shell wiring lands.
 */
export const REPORTS: ReportDef[] = [
  {
    slug: 'product-performance',
    title: 'Product Performance',
    description: 'Every product side by side: orders, confirmation and delivery rates, CPA, revenue, ad spend, and profit.',
    group: 'Performance',
    status: 'live',
    columns: [
      { key: 'productName', label: 'Product', align: 'left', format: 'text' },
      { key: 'totalOrders', label: 'Total Orders', align: 'right', format: 'number' },
      { key: 'ordersConfirmed', label: 'Confirmed (OC)', align: 'right', format: 'number' },
      { key: 'confirmationRate', label: 'Confirmation Rate', align: 'right', format: 'percent' },
      { key: 'deliveredOrders', label: 'Delivered', align: 'right', format: 'number' },
      { key: 'deliveryRate', label: 'Delivery Rate', align: 'right', format: 'percent' },
      { key: 'avgCpa', label: 'Avg CPA', align: 'right', format: 'money' },
      { key: 'revenue', label: 'Revenue', align: 'right', format: 'money' },
      { key: 'adSpend', label: 'Ad Spend', align: 'right', format: 'money' },
      { key: 'profit', label: 'Profit', align: 'right', format: 'money' },
      { key: 'returns', label: 'Returns', align: 'right', format: 'number' },
      { key: 'carryOver', label: 'Carry-over', align: 'right', format: 'number' },
    ],
    defaultColumns: [
      'productName',
      'totalOrders',
      'ordersConfirmed',
      'confirmationRate',
      'deliveredOrders',
      'deliveryRate',
      'avgCpa',
      'revenue',
      'adSpend',
      'profit',
    ],
  },
  {
    slug: 'customer-acquisition-funnel',
    title: 'Customer Acquisition & Order Funnel',
    description: 'Leads through delivery: created, confirmed, delivered, returned, with conversion rates for the period.',
    group: 'Marketing',
    status: 'live',
    columns: [
      { key: 'stage', label: 'Stage', align: 'left', format: 'text' },
      { key: 'count', label: 'Count', align: 'right', format: 'number' },
      { key: 'conversionFromPrevious', label: 'Conversion from previous', align: 'right', format: 'percent' },
      { key: 'conversionFromCreated', label: 'Conversion from created', align: 'right', format: 'percent' },
    ],
    defaultColumns: ['stage', 'count', 'conversionFromPrevious', 'conversionFromCreated'],
  },
  {
    slug: 'staff-performance',
    title: 'Staff Performance',
    description: 'Per-staff earnings across the period: base, bonus, deductions, and total payout.',
    group: 'Performance',
    status: 'live',
    columns: [
      { key: 'staffName', label: 'Staff', align: 'left', format: 'text' },
      { key: 'role', label: 'Role', align: 'left', format: 'text' },
      { key: 'payoutCount', label: 'Payout Lines', align: 'right', format: 'number' },
      { key: 'baseSalary', label: 'Base Salary', align: 'right', format: 'money' },
      { key: 'performanceBonus', label: 'Bonus', align: 'right', format: 'money' },
      { key: 'deductions', label: 'Deductions', align: 'right', format: 'money' },
      { key: 'totalPayout', label: 'Total Payout', align: 'right', format: 'money' },
    ],
    defaultColumns: ['staffName', 'role', 'payoutCount', 'baseSalary', 'performanceBonus', 'deductions', 'totalPayout'],
  },
  {
    slug: 'media-buyer-performance',
    title: 'Media Buyer Performance',
    description: 'Per media buyer: orders, ROAS, CPA, confirmation and delivery rates.',
    group: 'Performance',
    status: 'live',
    columns: [
      { key: 'name', label: 'Media Buyer', align: 'left', format: 'text' },
      { key: 'totalOrders', label: 'Total Orders', align: 'right', format: 'number' },
      { key: 'deliveredOrders', label: 'Delivered', align: 'right', format: 'number' },
      { key: 'deliveredRevenue', label: 'Delivered Revenue', align: 'right', format: 'money' },
      { key: 'confirmationRate', label: 'Confirmation Rate', align: 'right', format: 'percent' },
      { key: 'deliveryRate', label: 'Delivery Rate', align: 'right', format: 'percent' },
      { key: 'cpa', label: 'CPA', align: 'right', format: 'money' },
      { key: 'trueRoas', label: 'True ROAS', align: 'right', format: 'number' },
    ],
    defaultColumns: ['name', 'totalOrders', 'deliveredOrders', 'deliveredRevenue', 'confirmationRate', 'deliveryRate', 'cpa', 'trueRoas'],
  },
  {
    slug: 'cs-performance',
    title: 'Customer Service Performance',
    description: 'Per closer: assigned, confirmed, delivered, calls, confirmation and delivery rates.',
    group: 'Performance',
    status: 'live',
    columns: [
      { key: 'name', label: 'Closer', align: 'left', format: 'text' },
      { key: 'ordersEngaged', label: 'Assigned', align: 'right', format: 'number' },
      { key: 'ordersConfirmed', label: 'Confirmed', align: 'right', format: 'number' },
      { key: 'ordersDelivered', label: 'Delivered', align: 'right', format: 'number' },
      { key: 'ordersCancelled', label: 'Cancelled', align: 'right', format: 'number' },
      { key: 'callsMade', label: 'Calls', align: 'right', format: 'number' },
      { key: 'confirmationRate', label: 'Confirmation Rate', align: 'right', format: 'percent' },
      { key: 'deliveryRate', label: 'Delivery Rate', align: 'right', format: 'percent' },
      { key: 'avgCallSeconds', label: 'Avg Call (s)', align: 'right', format: 'number' },
    ],
    defaultColumns: ['name', 'ordersEngaged', 'ordersConfirmed', 'ordersDelivered', 'callsMade', 'confirmationRate', 'deliveryRate'],
  },
  {
    slug: 'logistics-manager-performance',
    title: 'Logistics Manager Performance',
    description: 'Per provider: delivery rate, delinquency, remitted versus pending.',
    group: 'Performance',
    status: 'live',
    columns: [
      { key: 'providerName', label: 'Provider', align: 'left', format: 'text' },
      { key: 'status', label: 'Status', align: 'left', format: 'text' },
      { key: 'locationCount', label: 'Locations', align: 'right', format: 'number' },
      { key: 'totalAssigned', label: 'Assigned', align: 'right', format: 'number' },
      { key: 'delivered', label: 'Delivered', align: 'right', format: 'number' },
      { key: 'returned', label: 'Returned', align: 'right', format: 'number' },
      { key: 'inTransit', label: 'In Transit', align: 'right', format: 'number' },
      { key: 'dispatched', label: 'Dispatched', align: 'right', format: 'number' },
      { key: 'deliveryRate', label: 'Delivery Rate', align: 'right', format: 'percent' },
      { key: 'delinquencyRate', label: 'Delinquency Rate', align: 'right', format: 'percent' },
      { key: 'unitsDelivered', label: 'Units Delivered', align: 'right', format: 'number' },
      { key: 'remittedAmount', label: 'Cash Remitted', align: 'right', format: 'money' },
      { key: 'pendingRemittanceAmount', label: 'Pending Remittance', align: 'right', format: 'money' },
      { key: 'availableStock', label: 'Available Stock', align: 'right', format: 'number' },
    ],
    defaultColumns: ['providerName', 'status', 'totalAssigned', 'delivered', 'returned', 'deliveryRate', 'delinquencyRate', 'remittedAmount', 'pendingRemittanceAmount'],
  },
  {
    slug: 'delivery-agent-performance',
    title: 'Delivery Agent Performance',
    description: 'Per delivery location: assigned, delivered, returned, and delivery rate.',
    group: 'Performance',
    status: 'live',
    columns: [
      { key: 'locationName', label: 'Location', align: 'left', format: 'text' },
      { key: 'providerName', label: 'Provider', align: 'left', format: 'text' },
      { key: 'status', label: 'Status', align: 'left', format: 'text' },
      { key: 'totalAssigned', label: 'Assigned', align: 'right', format: 'number' },
      { key: 'delivered', label: 'Delivered', align: 'right', format: 'number' },
      { key: 'returned', label: 'Returned', align: 'right', format: 'number' },
      { key: 'inTransit', label: 'In Transit', align: 'right', format: 'number' },
      { key: 'dispatched', label: 'Dispatched', align: 'right', format: 'number' },
      { key: 'deliveryRate', label: 'Delivery Rate', align: 'right', format: 'percent' },
      { key: 'delinquencyRate', label: 'Delinquency Rate', align: 'right', format: 'percent' },
      { key: 'unitsDelivered', label: 'Units Delivered', align: 'right', format: 'number' },
      { key: 'remittedAmount', label: 'Cash Remitted', align: 'right', format: 'money' },
      { key: 'pendingRemittanceAmount', label: 'Pending Remittance', align: 'right', format: 'money' },
    ],
    defaultColumns: ['locationName', 'providerName', 'totalAssigned', 'delivered', 'returned', 'deliveryRate', 'remittedAmount', 'pendingRemittanceAmount'],
  },
  {
    slug: 'payroll',
    title: 'Payroll Reports',
    description: 'Payroll register across paid and in-flight batches for the period.',
    group: 'Finance',
    status: 'live',
    columns: [
      { key: 'staffName', label: 'Staff', align: 'left', format: 'text' },
      { key: 'role', label: 'Role', align: 'left', format: 'text' },
      { key: 'periodStart', label: 'Period Start', align: 'left', format: 'text' },
      { key: 'periodEnd', label: 'Period End', align: 'left', format: 'text' },
      { key: 'baseSalary', label: 'Base Salary', align: 'right', format: 'money' },
      { key: 'performanceBonus', label: 'Bonus', align: 'right', format: 'money' },
      { key: 'addOns', label: 'Add-Ons', align: 'right', format: 'money' },
      { key: 'deductions', label: 'Deductions', align: 'right', format: 'money' },
      { key: 'totalPayout', label: 'Total Payout', align: 'right', format: 'money' },
      { key: 'status', label: 'Status', align: 'left', format: 'text' },
    ],
    defaultColumns: ['staffName', 'role', 'periodStart', 'periodEnd', 'baseSalary', 'performanceBonus', 'deductions', 'totalPayout', 'status'],
  },
  {
    slug: 'orders',
    title: 'Order Reports',
    description: 'Order funnel for the period: how many orders sit at each lifecycle status.',
    group: 'Operations',
    status: 'live',
    columns: [
      { key: 'status', label: 'Status', align: 'left', format: 'text' },
      { key: 'count', label: 'Orders', align: 'right', format: 'number' },
    ],
    defaultColumns: ['status', 'count'],
  },
  {
    slug: 'order-category',
    title: 'Order Category Report',
    description: 'Orders grouped by product with totals, confirmed, delivered, returned, and rates.',
    group: 'Operations',
    status: 'live',
    columns: [
      { key: 'productName', label: 'Product', align: 'left', format: 'text' },
      { key: 'totalOrders', label: 'Total Orders', align: 'right', format: 'number' },
      { key: 'confirmedOrders', label: 'Confirmed', align: 'right', format: 'number' },
      { key: 'deliveredOrders', label: 'Delivered', align: 'right', format: 'number' },
      { key: 'returnedOrders', label: 'Returned', align: 'right', format: 'number' },
      { key: 'confirmationRate', label: 'Confirmation Rate', align: 'right', format: 'percent' },
      { key: 'deliveryRate', label: 'Delivery Rate', align: 'right', format: 'percent' },
    ],
    defaultColumns: ['productName', 'totalOrders', 'confirmedOrders', 'deliveredOrders', 'returnedOrders', 'confirmationRate', 'deliveryRate'],
  },
  {
    slug: 'product-stock',
    title: 'Product Stock Reports',
    description: 'Current stock by product across all locations: on hand, reserved, and available.',
    group: 'Operations',
    status: 'live',
    columns: [
      { key: 'productName', label: 'Product', align: 'left', format: 'text' },
      { key: 'stockCount', label: 'On Hand', align: 'right', format: 'number' },
      { key: 'reservedCount', label: 'Reserved', align: 'right', format: 'number' },
      { key: 'availableCount', label: 'Available', align: 'right', format: 'number' },
      { key: 'locationCount', label: 'Locations', align: 'right', format: 'number' },
    ],
    defaultColumns: ['productName', 'stockCount', 'reservedCount', 'availableCount', 'locationCount'],
  },
  {
    slug: 'finance',
    title: 'Finance Reports',
    description: 'Revenue, costs, and profit for the period, matching the finance dashboard.',
    group: 'Finance',
    status: 'live',
    columns: [
      { key: 'revenue', label: 'Revenue', align: 'right', format: 'money' },
      { key: 'landedCogs', label: 'Landed COGS', align: 'right', format: 'money' },
      { key: 'deliveryFees', label: 'Delivery Fees', align: 'right', format: 'money' },
      { key: 'adSpend', label: 'Ad Spend', align: 'right', format: 'money' },
      { key: 'commission', label: 'Commission', align: 'right', format: 'money' },
      { key: 'operationalLoss', label: 'Operational Loss', align: 'right', format: 'money' },
      { key: 'trueProfit', label: 'True Profit', align: 'right', format: 'money' },
      { key: 'marginPct', label: 'Margin', align: 'right', format: 'percent' },
      { key: 'deliveredOrders', label: 'Delivered Orders', align: 'right', format: 'number' },
    ],
    defaultColumns: ['revenue', 'landedCogs', 'adSpend', 'trueProfit', 'marginPct', 'deliveredOrders'],
  },
  {
    slug: 'marketing',
    title: 'Marketing Reports',
    description: 'Marketing overview metrics: spend, ROAS, CPA, and delivered revenue.',
    group: 'Marketing',
    status: 'live',
    columns: [
      { key: 'totalOrders', label: 'Total Orders', align: 'right', format: 'number' },
      { key: 'confirmedOrders', label: 'Confirmed', align: 'right', format: 'number' },
      { key: 'deliveredOrders', label: 'Delivered', align: 'right', format: 'number' },
      { key: 'deliveredRevenue', label: 'Delivered Revenue', align: 'right', format: 'money' },
      { key: 'approvedAdSpend', label: 'Approved Ad Spend', align: 'right', format: 'money' },
      { key: 'pendingAdSpend', label: 'Pending Ad Spend', align: 'right', format: 'money' },
      { key: 'cpa', label: 'CPA', align: 'right', format: 'money' },
      { key: 'trueRoas', label: 'True ROAS', align: 'right', format: 'number' },
      { key: 'confirmationRate', label: 'Confirmation Rate', align: 'right', format: 'percent' },
      { key: 'deliveryRate', label: 'Delivery Rate', align: 'right', format: 'percent' },
    ],
    defaultColumns: ['totalOrders', 'confirmedOrders', 'deliveredOrders', 'deliveredRevenue', 'approvedAdSpend', 'cpa', 'trueRoas', 'confirmationRate', 'deliveryRate'],
  },
];

/** Catalog display order for the grouped sections. */
export const REPORT_GROUP_ORDER: ReportCategoryGroup[] = [
  'Performance',
  'Marketing',
  'Operations',
  'Finance',
];

export function getReportBySlug(slug: string): ReportDef | undefined {
  return REPORTS.find((r) => r.slug === slug);
}
