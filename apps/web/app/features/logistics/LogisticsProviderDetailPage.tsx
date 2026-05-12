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
import { StatusBadge } from '~/components/ui/status-badge';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
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
        mobileInlineActions
        description="View logistics company details and performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Provider tools"
            sheetSubtitle={<span>Refresh and navigation</span>}
            triggerAriaLabel="Provider toolbar"
            desktop={
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={backHref}
                  className="btn-secondary btn-sm inline-flex items-center justify-center"
                >
                  ← Back to team analysis
                </Link>
                <PageRefreshButton />
              </div>
            }
            sheet={
              <Link to={backHref} className="btn-secondary btn-sm w-full justify-center">
                Back to team analysis
              </Link>
            }
          />
        }
      />

      <div className="flex flex-col sm:flex-row gap-6 items-start">
        <div className="w-20 h-20 rounded-2xl bg-brand-100 dark:bg-brand-900/40 flex items-center justify-center shrink-0 border border-app-border">
          <span className="text-2xl font-bold text-brand-600 dark:text-brand-400">
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
          <p className="text-sm text-app-fg-muted">
            Reporting period: <span className="text-app-fg font-medium">{periodLabel}</span>
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
                <span className="rounded-full bg-app-hover px-1.5 py-0.5 text-[10px] font-semibold text-app-fg-muted tabular-nums">
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
                  items={[
                    { label: 'Name', value: provider.name },
                    { label: 'Status', value: <StatusBadge status={provider.status} /> },
                    {
                      label: 'Contact',
                      value: provider.contactInfo?.trim() ? provider.contactInfo : '—',
                      fullWidth: true,
                    },
                    {
                      label: 'Coverage area',
                      value: provider.coverageArea?.trim() ? provider.coverageArea : '—',
                      fullWidth: true,
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
                description="Orders with an agent-assigned timestamp in this period (same rules as team analysis)."
              />
              <CardBody className="pt-0">
                {performance ? (
                  <OverviewStatStrip
                    embedded
                    showScrollControls={false}
                    items={[
                      { label: 'Assigned', value: performance.totalAssigned, valueClassName: 'text-app-fg' },
                      {
                        label: 'Delivered',
                        value: performance.delivered,
                        valueClassName: 'text-success-600 dark:text-success-400',
                      },
                      {
                        label: 'Delivery rate',
                        value: performance.totalAssigned > 0 ? `${Math.round(performance.deliveryRate)}%` : '—',
                        valueClassName: deliveryRateColorClass(performance.deliveryRate),
                      },
                      {
                        label: 'Delinquency rate',
                        value: performance.totalAssigned > 0 ? `${Math.round(performance.delinquencyRate)}%` : '—',
                        valueClassName: delinquencyRateColorClass(performance.delinquencyRate),
                      },
                      { label: 'Returned', value: performance.returned, valueClassName: 'text-app-fg-muted' },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-app-fg-muted">
                    No rolled-up metrics for this window (or data is still loading). Try another date range from team
                    analysis.
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
                  className="btn-secondary btn-sm inline-flex items-center justify-center"
                >
                  Manage on Partners page
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
            description="Audit history for this logistics company (name, status, contact, coverage, rate card). Edits to individual warehouses are tracked on each location’s record."
          />
          <CardBody className="pt-0">
            {providerActivity.length === 0 ? (
              <EmptyState
                title="No activity yet"
                description="Changes to this company from the Partners flow will appear here once saved."
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
