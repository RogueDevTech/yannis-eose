import { useMemo } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { FormField } from '~/components/ui/form-field';
import { formatNaira } from '~/lib/format-amount';
import { FinanceOverviewPulseRail } from './finance-overview-pulse';
import { FinanceProfitWaterfall } from './finance-profit-waterfall';
import type { FinanceOverviewLoaderData } from './types';

/**
 * Finance Overview is the *control center* for the finance role: filter the
 * picture by date+time / branch / media buyer, scan the headline numbers,
 * and jump into deep dives (per-shipment unit economics, ad-spend slice,
 * remittance lookup, payout run).
 */
export function FinancePage({ data }: { data: FinanceOverviewLoaderData }) {
  const { profit, pulse, filters, branches = [], mediaBuyers = [] } = data;
  const [searchParams, setSearchParams] = useSearchParams();

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

  const setFilter = (key: 'branchId' | 'mediaBuyerId', value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value) next.delete(key);
        else next.set(key, value);
        // Reset paging if any of these pages later add it.
        next.delete('page');
        return next;
      },
      { preventScrollReset: true },
    );
  };

  const branchOptions = useMemo(
    () => [
      { value: '', label: 'All branches' },
      ...branches.map((b) => ({ value: b.id, label: b.name })),
    ],
    [branches],
  );
  const mediaBuyerOptions = useMemo(
    () => [
      { value: '', label: 'All media buyers' },
      ...mediaBuyers.map((b) => ({ value: b.id, label: b.name })),
    ],
    [mediaBuyers],
  );

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.branchId) n += 1;
    if (filters.mediaBuyerId) n += 1;
    if (filters.startTime || filters.endTime) n += 1;
    return n;
  }, [filters.branchId, filters.mediaBuyerId, filters.startTime, filters.endTime]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance"
        mobileInlineActions
        description="See revenue, profit, and costs for the selected period."
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
                    startTime={filters.startTime ?? ''}
                    endTime={filters.endTime ?? ''}
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
                  startTime={filters.startTime ?? ''}
                  endTime={filters.endTime ?? ''}
                  periodAllTime={filters.periodAllTime ?? false}
                  triggerLayout="blockCenter"
                />
              </div>
            )}
          />
        }
      />

      {/* Dimensional filters — branch + media buyer. Empty value = "all". */}
      {(branches.length > 0 || mediaBuyers.length > 0) && (
        <div className="card !p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {branches.length > 0 && (
            <FormField label="Branch" htmlFor="finance-overview-branch">
              <SearchableSelect
                id="finance-overview-branch"
                value={filters.branchId ?? ''}
                onChange={(v) => setFilter('branchId', v)}
                options={branchOptions}
                placeholder="All branches"
                searchPlaceholder="Search branches..."
              />
            </FormField>
          )}
          {mediaBuyers.length > 0 && (
            <FormField label="Media buyer" htmlFor="finance-overview-mb">
              <SearchableSelect
                id="finance-overview-mb"
                value={filters.mediaBuyerId ?? ''}
                onChange={(v) => setFilter('mediaBuyerId', v)}
                options={mediaBuyerOptions}
                placeholder="All media buyers"
                searchPlaceholder="Search buyers..."
              />
            </FormField>
          )}
          {activeFilterCount > 0 && (
            <p className="sm:col-span-2 text-xs text-app-fg-muted">
              {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} applied — figures
              below are scoped to this slice.{' '}
              <button
                type="button"
                className="text-brand-600 dark:text-brand-400 hover:underline"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete('branchId');
                  next.delete('mediaBuyerId');
                  next.delete('startTime');
                  next.delete('endTime');
                  setSearchParams(next, { preventScrollReset: true });
                }}
              >
                Clear filters
              </button>
            </p>
          )}
        </div>
      )}

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

      {/* Deep dives — entrypoints for the workflows finance actually does daily. */}
      <div>
        <h2 className="text-sm font-semibold text-app-fg uppercase tracking-wide mb-2">Deep dives</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <DeepDiveCard
            to="/admin/finance/profit-by-shipment"
            icon="📦"
            title="Profit by shipment"
            description="Review shipment cost and estimated revenue."
          />
          <DeepDiveCard
            to={
              filters.branchId
                ? `/admin/marketing/ad-spend?branchId=${filters.branchId}`
                : '/admin/marketing/ad-spend'
            }
            icon="📊"
            title="Ad spend slice"
            description="View ad spend by buyer and branch."
          />
          <DeepDiveCard
            to="/admin/finance/delivery-remittances"
            icon="💸"
            title="Cash remittances"
            description="Find remittances by date, partner, or status."
          />
          <DeepDiveCard
            to="/admin/finance/payout"
            icon="📑"
            title="Payout queue"
            description="Review payroll batches for disbursement."
          />
        </div>
      </div>
    </div>
  );
}

function DeepDiveCard({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className="card !p-4 flex flex-col gap-1.5 hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
    >
      <span className="text-2xl leading-none" aria-hidden>
        {icon}
      </span>
      <h3 className="text-sm font-semibold text-app-fg">{title}</h3>
      <p className="text-xs text-app-fg-muted leading-snug">{description}</p>
      <span className="mt-auto text-xs font-medium text-brand-600 dark:text-brand-400">Open →</span>
    </Link>
  );
}
