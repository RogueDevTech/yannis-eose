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
};

export function getCompareMetricOptions(source: string): CompareMetricOption[] {
  return COMPARE_METRIC_OPTIONS[source] ?? [];
}
