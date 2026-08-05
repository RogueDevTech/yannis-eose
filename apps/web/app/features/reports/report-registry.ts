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
    description: 'Per-staff output and performance metrics across the selected period.',
    group: 'Performance',
    status: 'planned',
  },
  {
    slug: 'media-buyer-performance',
    title: 'Media Buyer Performance',
    description: 'Per media buyer: orders, ROAS, CPA, confirmation and delivery rates.',
    group: 'Performance',
    status: 'planned',
  },
  {
    slug: 'cs-performance',
    title: 'Customer Service Performance',
    description: 'Per closer: assigned, confirmed, delivered, calls, confirmation and delivery rates.',
    group: 'Performance',
    status: 'planned',
  },
  {
    slug: 'logistics-manager-performance',
    title: 'Logistics Manager Performance',
    description: 'Per provider and location: delivery rate, delinquency, remitted versus pending.',
    group: 'Performance',
    status: 'planned',
  },
  {
    slug: 'delivery-agent-performance',
    title: 'Delivery Agent Performance',
    description: 'Per delivery agent: assigned, delivered, returned, and delivery rate.',
    group: 'Performance',
    status: 'planned',
  },
  {
    slug: 'payroll',
    title: 'Payroll Reports',
    description: 'Payroll register across paid and in-flight batches for the period.',
    group: 'Finance',
    status: 'planned',
  },
  {
    slug: 'orders',
    title: 'Order Reports',
    description: 'Orders across the funnel with status, amount, product, and timestamps.',
    group: 'Operations',
    status: 'planned',
  },
  {
    slug: 'order-category',
    title: 'Order Category Report',
    description: 'Orders grouped by category with totals and status breakdown.',
    group: 'Operations',
    status: 'planned',
  },
  {
    slug: 'product-stock',
    title: 'Product Stock Reports',
    description: 'Current stock levels by product and location.',
    group: 'Operations',
    status: 'planned',
  },
  {
    slug: 'finance',
    title: 'Finance Reports',
    description: 'Revenue, costs, and profit for the period, matching the finance dashboard.',
    group: 'Finance',
    status: 'planned',
  },
  {
    slug: 'marketing',
    title: 'Marketing Reports',
    description: 'Marketing overview metrics: spend, ROAS, CPA, and delivered revenue.',
    group: 'Marketing',
    status: 'planned',
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
