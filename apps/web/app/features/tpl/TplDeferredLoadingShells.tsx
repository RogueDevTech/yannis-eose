import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { StatCard } from '~/components/ui/card';
import {
  CompactTable,
} from '~/components/ui/compact-table';
import { shellPulsePlaceholderRows, StatValuePulse } from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { logisticsOrdersShellColumns } from '~/features/logistics/LogisticsDeferredLoadingShells';

/** Reuse admin inventory overview chrome for TPL stock hub. */
export { InventoryOverviewLoadingShell as TplInventoryLoadingShell } from '~/features/inventory/InventoryDeferredLoadingShells';

/** 3PL dashboard home — greeting row, KPI grid, recent orders strip. */
export function TplDashboardLoadingShell({
  filters,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title={<span className="inline-block h-7 w-56 max-w-full rounded-md bg-app-hover animate-pulse align-middle" aria-hidden />}
        mobileInlineActions
        description="Your location's stock and deliveries."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Dashboard tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="TPL dashboard date range"
            desktop={
              <>
                <PageRefreshButton />
                <div className="flex min-h-[2rem] items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
              </>
            }
            sheet={() => (
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  triggerLayout="blockCenter"
                />
              </div>
            )}
          />
        }
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Agent assigned" value="" loading accent="brand" />
        <StatCard label="In Transit" value="" loading accent="brand" />
        <StatCard label="Delivered" value="" loading accent="success" />
        <StatCard label="Returns Queue" value="" loading accent="brand" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Dispatched" value="" loading accent="brand" />
        <StatCard label="Stock Transfers" value="" loading accent="brand" />
        <StatCard label="Total Orders" value="" loading accent="brand" />
      </div>
      <div className="card p-4 space-y-3">
        <div className="h-5 w-40 rounded bg-app-hover animate-pulse" aria-hidden />
        {[1, 2, 3, 4].map((row) => (
          <div key={row} className="flex gap-3 border-b border-app-border/60 pb-3">
            <div className="h-4 flex-1 rounded bg-app-hover animate-pulse" aria-hidden />
            <div className="h-4 w-20 rounded bg-app-hover animate-pulse" aria-hidden />
          </div>
        ))}
      </div>
    </div>
  );
}

/** TPL orders list — matches Logistics orders density + TPL copy. */
export function TplOrdersLoadingShell({
  filters,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const rows = shellPulsePlaceholderRows('tpl_orders', 8);
  const cols = logisticsOrdersShellColumns();
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Orders"
        description="Use View to open an order at your hub, or Resolve order on a confirmed row for the fast path (delivery date, receipt, and handoff)."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Orders tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Orders toolbar"
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <PageRefreshButton />
              </>
            }
            sheet={
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  periodAllTime={filters.periodAllTime}
                  triggerLayout="blockCenter"
                />
              </div>
            }
          />
        }
      />
      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total Orders', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Awaiting logistics assignment', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Agent assigned', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Dispatched', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'In transit', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Delivered', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div className="h-10 w-full max-w-md rounded-lg border border-app-border bg-app-hover animate-pulse" aria-hidden />
      <CompactTable<{ id: string }>
        columns={cols}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

export function TplNotificationsLoadingShell() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader title="Notifications" description="Alerts and updates for your hub." actions={<PageRefreshButton />} />
      <div className="flex gap-2">
        <div className="h-9 w-28 rounded-lg bg-app-hover animate-pulse" aria-hidden />
        <div className="h-9 w-36 rounded-lg bg-app-hover animate-pulse" aria-hidden />
      </div>
      <div className="card divide-y divide-app-border">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="p-4 flex gap-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-app-hover animate-pulse" aria-hidden />
            <div className="flex-1 space-y-2">
              <div className="h-4 max-w-md w-full rounded bg-app-hover animate-pulse" aria-hidden />
              <div className="h-3 max-w-lg w-full rounded bg-app-hover/80 animate-pulse" aria-hidden />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TplSettingsLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader title="Settings" description="Profile, appearance, and notifications." actions={<PageRefreshButton />} />
      <div className="card p-4 space-y-4 max-w-xl">
        <div className="h-4 w-32 rounded bg-app-hover animate-pulse" aria-hidden />
        <div className="h-10 w-full rounded-md border border-app-border bg-app-hover animate-pulse" aria-hidden />
        <div className="h-10 w-full rounded-md border border-app-border bg-app-hover animate-pulse" aria-hidden />
        <div className="h-9 w-28 rounded-md bg-app-hover animate-pulse" aria-hidden />
      </div>
      <div className="h-48 w-full max-w-2xl rounded-lg border border-app-border bg-app-hover/50 animate-pulse" aria-hidden />
    </div>
  );
}

export function TplRemitLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="h-8 w-32 rounded-md bg-app-hover animate-pulse" aria-hidden />
        <PageRefreshButton />
      </div>
      <div className="h-64 w-full rounded-lg border border-app-border bg-app-hover/40 animate-pulse" aria-hidden />
      <div className="h-48 w-full rounded-lg border border-app-border bg-app-hover/40 animate-pulse" aria-hidden />
      <div className="card p-0 overflow-x-auto">
        <div className="min-w-[640px] p-3 space-y-2">
          {[1, 2, 3, 4].map((row) => (
            <div key={row} className="grid grid-cols-6 gap-2 py-2 border-b border-app-border/60">
              {[1, 2, 3, 4, 5, 6].map((col) => (
                <div key={col} className="h-3 rounded bg-app-hover animate-pulse" aria-hidden />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
