import { useCallback } from 'react';
import { Link, useSearchParams } from '@remix-run/react';
import { useLoaderRefetchBusy } from '~/hooks/use-loader-refetch-busy';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { CompactTable, type CompactTableColumn } from '~/components/ui/compact-table';
import { DescriptionList } from '~/components/ui/description-list';
import { EmptyState } from '~/components/ui/empty-state';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { StatusBadge } from '~/components/ui/status-badge';
import { Tabs } from '~/components/ui/tabs';
import { TableLoadingOverlay } from '~/components/ui/table-loading-overlay';
import {
  deliveryRateColorClass,
  delinquencyRateColorClass,
} from '~/lib/rate-color';
import { formatActivityDescription } from '~/lib/format-activity';
import type { HistoryEntry } from '~/features/orders/types';
import type { Location } from './types';
import type { LogisticsProviderDetailRecord, LogisticsProviderRow } from './team-types';

function formatNaira(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  if (!Number.isFinite(n) || n === 0) return '₦0';
  return `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
}

function providerInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-NG', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-NG', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function periodSummary(
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean },
  periodAllTime: boolean,
): string {
  if (periodAllTime || dateFilters.periodAllTime) return 'All time';
  const a = new Date(`${dateFilters.startDate}T12:00:00`);
  const b = new Date(`${dateFilters.endDate}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'Selected period';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${a.toLocaleDateString('en-NG', opts)} – ${b.toLocaleDateString('en-NG', opts)}`;
}

function activityRowKey(entry: HistoryEntry, index: number): string {
  return `${entry.id}-${entry.validFrom}-${index}`;
}

export interface LogisticsProviderDetailPageProps {
  provider: LogisticsProviderDetailRecord;
  locations: Location[];
  performance: LogisticsProviderRow | null;
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
  periodAllTime: boolean;
  backHref: string;
  providerActivity: HistoryEntry[];
  providerActivityTotal: number;
  actorNamesById: Record<string, string>;
}

export function LogisticsProviderDetailPage({
  provider,
  locations,
  performance,
  dateFilters,
  periodAllTime,
  backHref,
  providerActivity,
  providerActivityTotal,
  actorNamesById,
}: LogisticsProviderDetailPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'activity' ? 'activity' : 'overview';
  const loaderRefetchBusy = useLoaderRefetchBusy({ samePathnameOnly: true }).busy;

  const setTab = useCallback(
    (value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value === 'overview') {
        next.delete('tab');
      } else {
        next.set('tab', 'activity');
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const periodLabel = periodSummary(dateFilters, periodAllTime);

  const locationColumns: CompactTableColumn<Location>[] = [
    {
      key: 'name',
      header: 'Location',
      minWidth: 'min-w-[8rem]',
      render: (loc) => <span className="font-medium text-app-fg">{loc.name}</span>,
    },
    {
      key: 'address',
      header: 'Address',
      minWidth: 'min-w-[12rem]',
      render: (loc) => <span className="text-sm text-app-fg line-clamp-2">{loc.address}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      tight: true,
      render: (loc) => <StatusBadge status={loc.status} />,
    },
    {
      key: 'dispatch',
      header: 'Dispatch',
      tight: true,
      render: (loc) => (loc.dispatchLocked ? <span className="text-warning-600 text-xs">Locked</span> : '—'),
    },
  ];

  const rateCardJson =
    provider.rateCard != null && typeof provider.rateCard === 'object'
      ? JSON.stringify(provider.rateCard, null, 2)
      : null;

  return (
    <div className="space-y-6 w-full min-w-0">
      <Breadcrumb
        className="mb-1"
        items={[
          { label: 'Logistics', to: '/admin/logistics/partners' },
          { label: 'Team analysis', to: backHref },
          { label: provider.name },
        ]}
      />

      <PageHeader
        title={provider.name}
        backTo="/admin/logistics/partners"
        mobileInlineActions
        description="View logistics company details and performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Provider toolbar"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={periodAllTime} chrome="pill" />
              </div>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={dateFilters.startDate}
        endDate={dateFilters.endDate}
        periodAllTime={periodAllTime}
      />

      <div className="flex gap-3 sm:gap-6 items-start">
        <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center shrink-0 border border-app-border">
          <span className="text-lg sm:text-2xl font-bold text-brand-600 dark:text-brand-400">
            {providerInitials(provider.name)}
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={provider.status} />
            <span className="text-sm text-app-fg-muted">
              {provider.locationCount} location{provider.locationCount === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-app-fg-muted">
            Period: <span className="text-app-fg font-medium">{periodLabel}</span>
          </p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Overview' },
          {
            value: 'activity',
            label: 'Activity',
            badge:
              providerActivityTotal > 0 ? (
                <span className="rounded-full bg-app-hover px-1.5 py-0.5 text-micro font-semibold text-app-fg-muted tabular-nums">
                  {providerActivityTotal}
                </span>
              ) : undefined,
          },
        ]}
      />

      <TableLoadingOverlay show={loaderRefetchBusy} minHeightClassName="min-h-[16rem]">
        {activeTab === 'overview' ? (
          <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Company" />
              <CardBody className="pt-0">
                <DescriptionList
                  divided
                  layout="grid"
                  mobileColumns={2}
                  items={[
                    { label: 'Name', value: provider.name },
                    { label: 'Status', value: <StatusBadge status={provider.status} /> },
                    {
                      label: 'Contact',
                      value: provider.contactInfo?.trim() ? provider.contactInfo : '—',
                    },
                    {
                      label: 'Coverage area',
                      value: provider.coverageArea?.trim() ? provider.coverageArea : '—',
                    },
                    { label: 'Created', value: formatDate(provider.createdAt) },
                    { label: 'Last updated', value: formatDate(provider.updatedAt) },
                  ]}
                />
                {rateCardJson ? (
                  <div className="mt-4 pt-4 border-t border-app-border">
                    <p className="text-xs font-medium text-app-fg-muted mb-2">Rate card (reference)</p>
                    <pre className="text-xs font-mono bg-app-hover rounded-md p-3 overflow-x-auto max-h-48 text-app-fg">
                      {rateCardJson}
                    </pre>
                  </div>
                ) : null}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Performance"
                description="Orders assigned in this period."
              />
              <CardBody className="pt-0">
                {performance ? (
                  (() => {
                    const stats = [
                      { label: 'Assigned', value: String(performance.totalAssigned), cls: 'text-app-fg' },
                      { label: 'Delivered', value: String(performance.delivered), cls: 'text-success-600 dark:text-success-400' },
                      { label: 'Delivery rate', value: performance.totalAssigned > 0 ? `${Math.round(performance.deliveryRate)}%` : '—', cls: deliveryRateColorClass(performance.deliveryRate) },
                      { label: 'Delinquency', value: performance.totalAssigned > 0 ? `${Math.round(performance.delinquencyRate)}%` : '—', cls: delinquencyRateColorClass(performance.delinquencyRate) },
                      { label: 'Returned', value: String(performance.returned), cls: 'text-app-fg-muted' },
                      { label: 'Remitted', value: formatNaira(performance.remittedAmount), cls: 'text-success-600 dark:text-success-400' },
                      { label: 'Pending', value: formatNaira(performance.pendingRemittanceAmount), cls: 'text-warning-600 dark:text-warning-400' },
                      { label: 'Disputed', value: formatNaira(performance.disputedRemittanceAmount), cls: 'text-danger-600 dark:text-danger-400' },
                    ];
                    const tile = 'rounded-lg bg-app-hover px-2.5 py-2 text-center';
                    return (
                      <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
                        {stats.map((s) => (
                          <div key={s.label} className={tile}>
                            <p className="text-micro font-semibold uppercase tracking-wide text-app-fg-muted truncate">{s.label}</p>
                            <p className={`mt-0.5 text-base md:text-lg font-bold tabular-nums ${s.cls}`}>{s.value}</p>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                ) : (
                  <p className="text-sm text-app-fg-muted">
                    No metrics for this date range yet.
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Locations"
              actions={
                <Link
                  to="/admin/logistics/partners"
                  className="btn-secondary btn-sm inline-flex items-center justify-center text-xs sm:text-sm"
                >
                  <span className="hidden sm:inline">Manage on Partners page</span>
                  <span className="sm:hidden">Manage</span>
                </Link>
              }
            />
            <CardBody className="pt-0">
              {locations.length === 0 ? (
                <p className="text-sm text-app-fg-muted">No locations recorded for this company yet.</p>
              ) : (
                <CompactTable<Location>
                  columns={locationColumns}
                  rows={locations}
                  rowKey={(loc) => loc.id}
                  emptyTitle="No locations"
                  emptyDescription="Add a warehouse or hub from the Partners page."
                />
              )}
            </CardBody>
          </Card>
          </>
        ) : (
        <Card>
          <CardHeader
            title="Activity"
            description="Audit history for this company."
          />
          <CardBody className="pt-0">
            {providerActivity.length === 0 ? (
              <EmptyState
                title="No activity yet"
                description="Changes from Partners appear here after save."
              />
            ) : (
              <ul className="divide-y divide-app-border border border-app-border rounded-lg overflow-hidden">
                {providerActivity.map((entry, index) => {
                  const actorLabel = entry.changedBy
                    ? actorNamesById[entry.changedBy] ?? 'Unknown user'
                    : 'System';
                  return (
                    <li key={activityRowKey(entry, index)} className="px-4 py-3 bg-app-elevated">
                      <p className="text-sm text-app-fg">
                        {formatActivityDescription({
                          action: entry.action,
                          tableName: entry.tableName,
                          data: entry.data,
                        })}
                      </p>
                      <p className="text-xs text-app-fg-muted mt-1">
                        {formatDateTime(entry.validFrom)}
                        <span className="text-app-border"> · </span>
                        {actorLabel}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            {providerActivityTotal > providerActivity.length ? (
              <p className="text-xs text-app-fg-muted mt-3">
                Showing the {providerActivity.length} most recent versions of {providerActivityTotal} total.
              </p>
            ) : null}
          </CardBody>
        </Card>
        )}
      </TableLoadingOverlay>
    </div>
  );
}
