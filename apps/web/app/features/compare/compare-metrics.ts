/**
 * Client-safe metric catalog for the Compare picker.
 *
 * The full source registry (`compare-registry.ts`) imports `api.server` and so is
 * server-only — the client-side <CompareButton> picker can't import it. This
 * module carries ONLY the metric key + label per source (no fetchers, no server
 * deps), so the modal can render "which metrics to compare" checkboxes. Keep the
 * keys here in sync with the registry's metric keys for the same source.
 */

export interface CompareMetricOption {
  key: string;
  label: string;
}

export const COMPARE_METRIC_OPTIONS: Record<string, CompareMetricOption[]> = {
  'marketing-analytics': [
    { key: 'uniqueViews', label: 'Unique form views' },
    { key: 'allViews', label: 'All form views' },
    { key: 'avgTime', label: 'Avg time on form' },
    { key: 'conversion', label: 'Conversion' },
    { key: 'attribution', label: 'Attribution rate' },
    { key: 'formViews', label: 'Form views' },
    { key: 'startedCart', label: 'Started cart' },
    { key: 'ordered', label: 'Ordered' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'delivered', label: 'Delivered' },
  ],
  // Keys must match marketingOrdersSource.metrics in compare-registry.ts.
  'marketing-orders': [
    { key: 'totalOrders', label: 'Total orders' },
    { key: 'confirmedOrders', label: 'Confirmed' },
    { key: 'deliveredOrders', label: 'Delivered' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'cpa', label: 'CPA' },
    { key: 'trueRoas', label: 'True ROAS' },
    { key: 'deliveredRevenue', label: 'Delivered revenue' },
    { key: 'totalSpend', label: 'Ad spend' },
  ],
  // Keys must match salesOrdersSource.metrics in compare-registry.ts.
  'sales-orders': [
    { key: 'total', label: 'Total orders' },
    { key: 'unprocessed', label: 'Unprocessed' },
    { key: 'assigned', label: 'CS assigned' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'remitted', label: 'Remitted' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
  ],
  // Keys must match logisticsOrdersSource.metrics in compare-registry.ts.
  'logistics-orders': [
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'allocated', label: 'Allocated' },
    { key: 'dispatched', label: 'Dispatched' },
    { key: 'inTransit', label: 'In transit' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'remitted', label: 'Remitted' },
  ],
  // Keys must match marketingOverviewSource.metrics in compare-registry.ts.
  'marketing-overview': [
    { key: 'totalOrders', label: 'Total orders' },
    { key: 'confirmedOrders', label: 'Confirmed' },
    { key: 'deliveredOrders', label: 'Delivered' },
    { key: 'deliveredRevenue', label: 'Delivered revenue' },
    { key: 'totalSpend', label: 'Total ad spend' },
    { key: 'approvedSpend', label: 'Approved spend' },
    { key: 'otherExpenses', label: 'Other expenses' },
    { key: 'cpa', label: 'CPA' },
    { key: 'trueRoas', label: 'True ROAS' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'abandonedCarts', label: 'Abandoned carts' },
  ],
  // Keys must match marketingTeamSource.metrics in compare-registry.ts.
  'marketing-team': [
    { key: 'totalOrders', label: 'Total orders' },
    { key: 'confirmedOrders', label: 'Confirmed' },
    { key: 'deliveredOrders', label: 'Delivered' },
    { key: 'deliveredRevenue', label: 'Delivered revenue' },
    { key: 'totalSpend', label: 'Ad spend' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'activeMbs', label: 'Active media buyers' },
    { key: 'fundingSent', label: 'Funding sent' },
    { key: 'fundingCompleted', label: 'Funding completed' },
  ],
  // Keys must match marketingCrossFunnelSource.metrics in compare-registry.ts.
  'marketing-cross-funnel': [
    { key: 'totalAttempts', label: 'Total attempts' },
    { key: 'uniqueCustomers', label: 'Unique customers' },
    { key: 'resubmissions', label: 'Resubmissions' },
    { key: 'sameMb', label: 'Same media buyer' },
    { key: 'crossFunnel', label: 'Cross-funnel' },
  ],
  // Keys must match marketingExpensesSource.metrics in compare-registry.ts.
  'marketing-expenses': [
    { key: 'approvedSpend', label: 'Approved spend' },
    { key: 'pendingSpend', label: 'Pending spend' },
    { key: 'totalSpend', label: 'Total spend' },
    { key: 'approvedCount', label: 'Approved entries' },
    { key: 'pendingCount', label: 'Pending entries' },
  ],
  // Keys must match marketingLeaderboardSource.metrics in compare-registry.ts.
  'marketing-leaderboard': [
    { key: 'totalOrders', label: 'Total orders' },
    { key: 'confirmedOrders', label: 'Confirmed' },
    { key: 'deliveredOrders', label: 'Delivered' },
    { key: 'deliveredRevenue', label: 'Delivered revenue' },
    { key: 'totalSpend', label: 'Ad spend' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'mbCount', label: 'Media buyers' },
  ],
  // Keys must match salesTeamSource.metrics in compare-registry.ts.
  'sales-team': [
    { key: 'engaged', label: 'Orders engaged' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'callsMade', label: 'Calls made' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'closers', label: 'Active closers' },
  ],
  // Keys must match salesLeaderboardSource.metrics in compare-registry.ts.
  'sales-leaderboard': [
    { key: 'engaged', label: 'Orders engaged' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'callsMade', label: 'Calls made' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'closers', label: 'Closers' },
  ],
  // Keys must match logisticsTeamSource.metrics in compare-registry.ts.
  'logistics-team': [
    { key: 'assigned', label: 'Total assigned' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'unitsDelivered', label: 'Units delivered' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'remitted', label: 'Remitted amount' },
    { key: 'pending', label: 'Pending remittance' },
    { key: 'activeProviders', label: 'Active providers' },
  ],
  // Keys must match financeOverviewSource.metrics in compare-registry.ts.
  'finance-overview': [
    { key: 'totalRemitted', label: 'Total remitted' },
    { key: 'pendingRemittance', label: 'Pending remittance' },
    { key: 'deliveryFees', label: 'Delivery fees' },
    { key: 'fundingSent', label: 'Funding sent' },
    { key: 'fundingCompleted', label: 'Funding completed' },
    { key: 'fundingDisputed', label: 'Funding disputed' },
    { key: 'remittedCount', label: 'Remitted orders' },
    { key: 'pendingCount', label: 'Pending orders' },
  ],
  // Keys must match deliveryRemittancesSource.metrics in compare-registry.ts.
  'delivery-remittances': [
    { key: 'received', label: 'Remitted received' },
    { key: 'pending', label: 'Pending confirmation' },
    { key: 'delivered', label: 'Delivered value' },
    { key: 'deliveryFees', label: 'Delivery fees' },
    { key: 'receivedCount', label: 'Remitted orders' },
    { key: 'deliveredCount', label: 'Delivered orders' },
    { key: 'awaiting', label: 'Awaiting (period)' },
  ],
  // Keys must match disbursementsSource.metrics in compare-registry.ts.
  'disbursements': [
    { key: 'totalSent', label: 'Total sent' },
    { key: 'totalCompleted', label: 'Completed' },
    { key: 'totalDisputed', label: 'Disputed' },
    { key: 'sentCount', label: 'Sent count' },
    { key: 'completedCount', label: 'Completed count' },
    { key: 'disputedCount', label: 'Disputed count' },
  ],
  // Keys must match cartOrdersSource.metrics in compare-registry.ts.
  'cart-orders': [
    { key: 'total', label: 'Total cart orders' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'remitted', label: 'Remitted' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
  ],
  // Keys must match deliveredFollowUpSource.metrics in compare-registry.ts.
  'delivered-follow-up': [
    { key: 'total', label: 'Total orders' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'remitted', label: 'Remitted' },
  ],
  // Keys must match CEO_OVERVIEW_METRICS in compare-registry.ts (shared by both).
  'ceo-overview': [
    { key: 'revenue', label: 'Revenue' },
    { key: 'trueProfit', label: 'True profit' },
    { key: 'margin', label: 'Margin' },
    { key: 'totalOrders', label: 'Total orders' },
    { key: 'adSpend', label: 'Ad spend' },
    { key: 'landedCost', label: 'Landed cost' },
    { key: 'deliveryFee', label: 'Delivery fees' },
    { key: 'cpa', label: 'CPA' },
    { key: 'roas', label: 'True ROAS' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'activeStaff', label: 'Active staff' },
  ],
  'admin-overview': [
    { key: 'revenue', label: 'Revenue' },
    { key: 'trueProfit', label: 'True profit' },
    { key: 'margin', label: 'Margin' },
    { key: 'totalOrders', label: 'Total orders' },
    { key: 'adSpend', label: 'Ad spend' },
    { key: 'landedCost', label: 'Landed cost' },
    { key: 'deliveryFee', label: 'Delivery fees' },
    { key: 'cpa', label: 'CPA' },
    { key: 'roas', label: 'True ROAS' },
    { key: 'confirmationRate', label: 'Confirmation rate' },
    { key: 'deliveryRate', label: 'Delivery rate' },
    { key: 'activeStaff', label: 'Active staff' },
  ],
};

export function getCompareMetricOptions(source: string): CompareMetricOption[] {
  return COMPARE_METRIC_OPTIONS[source] ?? [];
}
