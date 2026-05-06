import { useMemo } from 'react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { formatNaira } from '~/lib/format-amount';
import { FinanceOverviewPulseRail } from './finance-overview-pulse';
import { FinanceProfitWaterfall } from './finance-profit-waterfall';
import type { FinanceOverviewLoaderData } from './types';

export function FinancePage({ data }: { data: FinanceOverviewLoaderData }) {
  const { profit, pulse, filters } = data;

  const totalCosts = useMemo(
    () =>
      profit.landedCost +
      profit.deliveryFee +
      profit.adSpend +
      profit.commission +
      profit.fulfillmentCost +
      profit.operationalLoss,
    [profit],
  );

  const perOrder = useMemo(() => {
    const n = profit.orderCount;
    if (n <= 0) return { aov: 0, costPerOrder: 0, profitPerOrder: 0 };
    return {
      aov: profit.revenue / n,
      costPerOrder: totalCosts / n,
      profitPerOrder: profit.trueProfit / n,
    };
  }, [profit, totalCosts]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        description="True profit for the selected period, product contribution, and a live cash-and-close queue. Use the sidebar for deep workflows."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Finance tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Finance toolbar and date range"
            desktop={
              <>
                <PageRefreshButton />
                <div className="flex min-h-[2rem] items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime ?? false}
                  />
                </div>
              </>
            }
            sheet={() => (
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime ?? false}
                  triggerLayout="blockCenter"
                />
              </div>
            )}
          />
        }
      />

      <OverviewStatStrip
        items={[
          {
            label: 'Revenue',
            value: formatNaira(Math.round(profit.revenue)),
            valueClassName: 'text-app-fg tabular-nums',
            title: `${profit.orderCount} delivered orders`,
          },
          {
            label: 'True Profit',
            value: formatNaira(Math.round(profit.trueProfit)),
            valueClassName:
              profit.trueProfit >= 0
                ? 'text-success-600 dark:text-success-400 tabular-nums'
                : 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'After all costs',
          },
          {
            label: 'Net Margin',
            value: <>{profit.margin.toFixed(1)}%</>,
            valueClassName:
              profit.margin >= 20
                ? 'text-success-600 dark:text-success-400 tabular-nums'
                : profit.margin > 0
                  ? 'text-warning-600 dark:text-warning-400 tabular-nums'
                  : 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'Profit / Revenue',
          },
          {
            label: 'Total Costs',
            value: formatNaira(Math.round(totalCosts)),
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'All cost layers',
          },
          {
            label: 'AOV',
            value: formatNaira(Math.round(perOrder.aov)),
            valueClassName: 'text-app-fg tabular-nums',
            title: 'Average order value',
          },
          {
            label: 'Cost / Order',
            value: formatNaira(Math.round(perOrder.costPerOrder)),
            valueClassName: 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'Total costs / orders',
          },
          {
            label: 'Profit / Order',
            value: formatNaira(Math.round(perOrder.profitPerOrder)),
            valueClassName:
              perOrder.profitPerOrder >= 0
                ? 'text-success-600 dark:text-success-400 tabular-nums'
                : 'text-danger-600 dark:text-danger-400 tabular-nums',
            title: 'True profit / orders',
          },
        ]}
      />

      <FinanceOverviewPulseRail pulse={pulse} />

      <div className="min-w-0">
        <FinanceProfitWaterfall profit={profit} />
      </div>
    </div>
  );
}
