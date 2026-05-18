/**
 * Lazy wrapper around `OrdersChartView`. The underlying component pulls in `recharts`,
 * which is a sizeable dependency. Most users land on `/admin/orders` or
 * `/admin/marketing/orders` and never click "View data in chart" — so loading
 * recharts up-front is pure waste.
 *
 * This wrapper:
 *   • Defers the chart-view module via `React.lazy` so its code is split into a
 *     separate JS bundle that only downloads when a chart is actually rendered.
 *   • Exposes the same prop shape as the underlying component so existing callsites
 *     swap their import line and nothing else.
 *   • Renders a small spinner while the chunk is fetched.
 *
 * Usage: replace
 *   import { OrdersChartView } from '~/components/ui/orders-chart-view';
 * with
 *   import { OrdersChartView } from '~/components/ui/orders-chart-view-lazy';
 */

import { Suspense, lazy } from 'react';
import type { ComponentProps } from 'react';
import { Spinner } from '~/components/ui/spinner';

const OrdersChartViewImpl = lazy(() =>
  import('~/components/ui/orders-chart-view').then((m) => ({ default: m.OrdersChartView })),
);

type Props = ComponentProps<typeof OrdersChartViewImpl>;

export function OrdersChartView(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-app-fg-muted">
          <Spinner size="md" />
          <span className="ml-3">Loading chart…</span>
        </div>
      }
    >
      <OrdersChartViewImpl {...props} />
    </Suspense>
  );
}
