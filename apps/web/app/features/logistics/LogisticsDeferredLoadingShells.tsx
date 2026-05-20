import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { shellPulsePlaceholderRows, StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { FilterPills } from '~/components/ui/filter-pills';
import { FormSelect } from '~/components/ui/form-select';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchInput } from '~/components/ui/search-input';
import { Tabs } from '~/components/ui/tabs';
import { TextInput } from '~/components/ui/text-input';
import type { TransfersShellDateFilters } from '~/lib/transfers-shell-filters';

export function logisticsOrdersShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'orderId', header: 'Order ID', render: () => <TableCellTextPulse className="w-[7rem]" /> },
    { key: 'customer', header: 'Customer', render: () => <TableCellTextPulse className="w-[10rem]" /> },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[6rem]" /> },
    {
      key: 'deliveryDate',
      header: 'Delivery Date',
      nowrap: true,
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    { key: 'company', header: 'Company', render: () => <TableCellTextPulse className="w-[12rem]" /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      tight: true,
      headerClassName: 'text-right',
      mobileShowLabel: false,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

function logisticsTeamShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'provider', header: 'Provider', render: () => <TableCellTextPulse className="w-[12rem]" /> },
    {
      key: 'locations',
      header: 'Locations',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[2rem]" />
        </span>
      ),
    },
    {
      key: 'assigned',
      header: 'Assigned',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[2.5rem]" />
        </span>
      ),
    },
    {
      key: 'delivered',
      header: 'Delivered',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[2.5rem]" />
        </span>
      ),
    },
    {
      key: 'deliveryRate',
      header: 'Delivery rate',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'delinquencyRate',
      header: 'Delinquency rate',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'returned',
      header: 'Returned',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[2.5rem]" />
        </span>
      ),
    },
    {
      key: 'statusMix',
      header: 'Order status split',
      minWidth: 'min-w-[180px]',
      render: () => <TableCellTextPulse className="w-[10rem]" />,
    },
    {
      key: 'actions',
      header: '',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

/** Remittances list placeholder — not aligned 1:1 with `RemittancesAdminPage` columns. */
const LOGISTICS_REMITTANCES_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'ref', header: 'Reference', render: () => <TableCellTextPulse className="w-[9rem]" /> },
  { key: 'from', header: 'From', render: () => <TableCellTextPulse className="w-[8rem]" /> },
  { key: 'to', header: 'To', render: () => <TableCellTextPulse className="w-[8rem]" /> },
  {
    key: 'qty',
    header: 'Qty',
    align: 'right',
    render: () => (
      <span className="inline-flex w-full justify-end">
        <TableCellTextPulse className="w-[3rem]" />
      </span>
    ),
  },
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[6rem]" /> },
  {
    key: 'actions',
    header: '',
    align: 'right',
    tight: true,
    render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
  },
];

function transfersWorkspaceTableShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    {
      key: 'product',
      header: 'Product',
      render: () => <TableCellTextPulse className="w-[10rem]" />,
      minWidth: 'min-w-[140px]',
    },
    {
      key: 'route',
      header: 'From → To',
      render: () => <TableCellTextPulse className="w-[14rem]" />,
      minWidth: 'min-w-[160px]',
    },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'recorded',
      header: 'Recorded',
      hideOnMobile: true,
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[6rem]" /> },
    {
      key: 'actions',
      header: '',
      mobileShowLabel: false,
      align: 'right',
      tight: true,
      render: () => (
        <div className="inline-flex items-center justify-end gap-1.5">
          <CompactTableActionButton disabled>View</CompactTableActionButton>
          <CompactTableActionButton tone="danger" disabled>
            Cancel
          </CompactTableActionButton>
        </div>
      ),
    },
  ];
}

function TransferFilterValueShell({ widthClassName }: { widthClassName: string }) {
  return <div className={`h-3 rounded bg-app-hover animate-pulse ${widthClassName}`} aria-hidden />;
}

function TransfersStockFilterControlShell({
  label,
  widthClassName,
}: {
  label: string;
  widthClassName: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-app-fg">{label}</div>
      <div className="relative">
        <div className="flex h-9 items-center rounded-lg border border-app-border bg-app-canvas px-2.5 pr-7">
          <TransferFilterValueShell widthClassName={widthClassName} />
        </div>
        <span
          className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-app-fg-muted"
          aria-hidden
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-full w-full">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}

/** Logistics companies + locations hub. */
export function LogisticsPartnersLoadingShell() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Logistics"
        mobileInlineActions
        description="Manage logistics companies and locations."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Logistics tools"
            sheetSubtitle={<span>Refresh and add records</span>}
            triggerAriaLabel="Logistics toolbar"
            desktop={
              <div className="flex flex-wrap gap-2">
                <PageRefreshButton />
                <span className="h-8 w-36 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
                <span className="h-8 w-24 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
              </div>
            }
            sheet={
              <>
                <span className="h-9 w-full animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
                <span className="h-9 w-full animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
              </>
            }
          />
        }
      />
      <Tabs
        value="locations"
        onChange={() => {}}
        tabs={[
          { value: 'locations', label: 'Locations' },
          { value: 'providers', label: 'Companies' },
        ]}
      />
      {/* Search input placeholder — mirrors the live partners search */}
      <span
        className="block h-9 w-full max-w-md animate-pulse rounded-md border border-app-border bg-app-hover"
        aria-hidden
      />
      {/* Skeleton table matching the locations CompactTable columns */}
      <div className="overflow-hidden rounded-lg border border-app-border">
        <table className="w-full text-sm">
          <thead className="border-b border-app-border bg-app-elevated">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide">Location</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide hidden sm:table-cell">Address</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide hidden sm:table-cell">Logistics company</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-fg-muted uppercase tracking-wide hidden sm:table-cell">Total stock</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-fg-muted uppercase tracking-wide hidden sm:table-cell">Alert threshold</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide hidden sm:table-cell">Status</th>
              <th className="px-3 py-2 w-px" />
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <tr key={i}>
                <td className="px-3 py-2.5"><span className="block h-4 w-28 rounded bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5 hidden sm:table-cell"><span className="block h-4 w-36 rounded bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5 hidden sm:table-cell"><span className="block h-4 w-24 rounded bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5 hidden sm:table-cell"><span className="block h-4 w-12 rounded bg-app-hover animate-pulse ml-auto" /></td>
                <td className="px-3 py-2.5 hidden sm:table-cell"><span className="block h-4 w-16 rounded bg-app-hover animate-pulse ml-auto" /></td>
                <td className="px-3 py-2.5 hidden sm:table-cell"><span className="block h-5 w-14 rounded-full bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5"><span className="block h-6 w-12 rounded bg-app-hover animate-pulse ml-auto" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Stock transfer confirmations — URL-driven date + status pills + filter row; table pulse. */
export function LogisticsRemittancesLoadingShell() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rows = shellPulsePlaceholderRows('log_remit', 6);

  const periodAllTime = searchParams.get('period') === 'all_time';
  const startDate = searchParams.get('startDate') ?? '';
  const endDate = searchParams.get('endDate') ?? '';
  const rawStatus = searchParams.get('status') ?? '';
  const statusValue = ['IN_TRANSIT', 'RECEIVED', 'DISPUTED'].includes(rawStatus) ? rawStatus : '';
  const locationId = searchParams.get('locationId') ?? '';
  const search = searchParams.get('search') ?? '';
  const sender = searchParams.get('sender') ?? '';
  const minQty = searchParams.get('minQty') ?? '';
  const maxQty = searchParams.get('maxQty') ?? '';

  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const setFilterParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(searchParams);
      if (value.trim().length === 0) next.delete(key);
      else next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('locationId');
    next.delete('search');
    next.delete('sender');
    next.delete('minQty');
    next.delete('maxQty');
    next.delete('startDate');
    next.delete('endDate');
    next.delete('period');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const statusPillOptions = useMemo(
    () => [
      { value: '', label: 'All' },
      { value: 'IN_TRANSIT', label: 'Pending', dotColor: 'bg-warning-500' },
      { value: 'RECEIVED', label: 'Received', dotColor: 'bg-success-500' },
      { value: 'DISPUTED', label: 'Disputed', dotColor: 'bg-danger-500' },
    ],
    [],
  );

  const locationOptions = useMemo(() => {
    const base = [{ value: '', label: 'All locations' }];
    if (locationId) base.push({ value: locationId, label: 'Selected location' });
    return base;
  }, [locationId]);

  const senderOptions = useMemo(() => {
    const base = [{ value: '', label: 'All senders' }];
    if (sender) base.push({ value: sender, label: sender });
    return base;
  }, [sender]);

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Stock Transfer Confirmations"
        mobileInlineActions
        description="Confirm incoming stock transfers."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Transfer confirmation tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="Transfer confirmation toolbar"
            desktop={
              <div className="flex items-center gap-2">
                <div className="flex min-h-[2rem] shrink-0 items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
                  <DateFilterBar startDate={startDate} endDate={endDate} periodAllTime={periodAllTime} />
                </div>
                <PageRefreshButton />
              </div>
            }
            sheet={
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={startDate}
                  endDate={endDate}
                  periodAllTime={periodAllTime}
                  triggerLayout="blockCenter"
                />
              </div>
            }
          />
        }
      />
      <OverviewStatStrip
        items={[
          { label: 'Total transfers', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Pending', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Received', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Disputed', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Qty sent', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Qty received', value: <StatValuePulse className="min-w-[2.5rem]" /> },
        ]}
      />

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPills
            options={statusPillOptions}
            value={statusValue}
            onChange={(v) => setFilterParam('status', v)}
            size="sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="w-full sm:w-auto sm:min-w-[16rem]"
            onSubmit={(e) => {
              e.preventDefault();
              setFilterParam('search', searchDraft);
            }}
          >
            <SearchInput
              controlSize="sm"
              wrapperClassName="w-full"
              placeholder="Search by ID or product"
              value={searchDraft}
              onChange={(value) => {
                setSearchDraft(value);
                if (value.trim() === '') setFilterParam('search', '');
              }}
              withSubmitButton
            />
          </form>
          <FormSelect
            controlSize="sm"
            wrapperClassName="w-full sm:w-52"
            value={locationId}
            onChange={(e) => setFilterParam('locationId', e.target.value)}
            options={locationOptions}
          />
          <FormSelect
            controlSize="sm"
            wrapperClassName="w-full sm:w-48"
            value={sender}
            onChange={(e) => setFilterParam('sender', e.target.value)}
            options={senderOptions}
          />
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-full sm:w-28"
            placeholder="Min qty"
            value={minQty}
            onChange={(e) => setFilterParam('minQty', e.target.value)}
          />
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-full sm:w-28"
            placeholder="Max qty"
            value={maxQty}
            onChange={(e) => setFilterParam('maxQty', e.target.value)}
          />
          <Button type="button" variant="secondary" size="sm" onClick={clearAllFilters}>
            Clear all filters
          </Button>
        </div>
      </div>

      <CompactTable<{ id: string }>
        columns={LOGISTICS_REMITTANCES_SHELL_COLS}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** Logistics team provider rollup. */
export function LogisticsTeamLoadingShell({
  dateFilters,
}: {
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const rows = shellPulsePlaceholderRows('log_team', 8);
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Logistics team analysis"
        mobileInlineActions
        description="Provider performance for the selected period."
        actions={
          <>
            <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">
              <DateFilterBar
                startDate={dateFilters.startDate}
                endDate={dateFilters.endDate}
                periodAllTime={dateFilters.periodAllTime}
              />
            </div>
            <PageRefreshButton />
          </>
        }
      />
      <OverviewStatStrip
        showScrollControls={false}
        items={[
          { label: 'Active providers', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Total assigned', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivered', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivery rate', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Delinquency rate', value: <StatValuePulse className="min-w-[3rem]" /> },
        ]}
      />
      <CompactTable<{ id: string }>
        columns={logisticsTeamShellColumns()}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** Single provider detail — tabs + panels pulse. */
export function LogisticsProviderDetailLoadingShell() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-4 w-40 rounded bg-app-hover animate-pulse" aria-hidden />
      <div className="h-8 w-64 max-w-full rounded bg-app-hover animate-pulse" aria-hidden />
      <Tabs
        value="overview"
        onChange={() => {}}
        tabs={[
          { value: 'overview', label: 'Overview' },
          { value: 'activity', label: 'Activity' },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-4 rounded bg-app-hover animate-pulse" aria-hidden />
          ))}
        </div>
        <div className="card p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded bg-app-hover animate-pulse" aria-hidden />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Stock / partner transfers — mirrors `TransfersPage` chrome (stats, filters, columns). */
function TransfersWorkspaceLoadingShell({
  filters,
  variant,
}: {
  filters: TransfersShellDateFilters;
  variant: 'stock' | 'logistics';
}) {
  const rows = shellPulsePlaceholderRows(variant === 'logistics' ? 'xfer_partner' : 'xfer', 8);
  const pageTitle = variant === 'logistics' ? 'Partner stock transfers' : 'Stock transfers';
  const pageDescription =
    variant === 'logistics'
      ? 'Request stock moves from one logistics location to another (including between 3PL partners). Sent transfers stay In transit until the receiving location confirms receipt under Logistics → Stock Transfer Confirmations.'
      : 'Send stock between locations. Transfers stay on this list as In transit until the destination confirms receipt (Logistics → Stock Transfer Confirmations).';
  const initiateCta = variant === 'logistics' ? '+ Request transfer' : '+ Record transfer';

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title={pageTitle}
        mobileInlineActions
        description={pageDescription}
        actions={
          <PageHeaderMobileTools
            sheetTitle={`${pageTitle} — tools`}
            sheetSubtitle={<span>Date range and new transfer</span>}
            triggerAriaLabel={`${pageTitle} toolbar and date range`}
            desktop={
              <>
                <div className="flex min-h-[2rem] shrink-0 items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
                  <DateFilterBar
                    startDate={filters.periodAllTime ? '' : filters.startDate}
                    endDate={filters.periodAllTime ? '' : filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <Button variant="primary" size="sm" disabled>
                  {initiateCta}
                </Button>
                <PageRefreshButton />
              </>
            }
            sheet={
              <>
                <div className="flex min-h-[2.5rem] w-full flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.periodAllTime ? '' : filters.startDate}
                    endDate={filters.periodAllTime ? '' : filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <Button variant="primary" size="sm" className="w-full justify-center" disabled>
                  {initiateCta}
                </Button>
              </>
            }
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Transfer records', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Pending', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'In transit', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Received', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Disputed', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Cancelled', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Qty sent', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Qty received', value: <StatValuePulse className="min-w-[2.5rem]" /> },
        ]}
      />

      {/* Status tabs — always visible, mirrors the real page. */}
      <Tabs
        value=""
        onChange={() => {}}
        tabs={[
          { value: '', label: 'All' },
          { value: 'PENDING', label: 'Pending' },
          { value: 'IN_TRANSIT', label: 'In transit' },
          { value: 'RECEIVED', label: 'Received' },
          { value: 'DISPUTED', label: 'Disputed' },
          { value: 'CANCELLED', label: 'Cancelled' },
        ]}
      />

      {/* Desktop-only — on mobile the real page moves filters into the kebab. */}
      <div className="card space-y-3 p-3 sm:p-4 hidden md:block">
        {variant === 'stock' ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TransfersStockFilterControlShell label="From location" widthClassName="w-24" />
            <TransfersStockFilterControlShell label="To location" widthClassName="w-24" />
            <TransfersStockFilterControlShell label="Product" widthClassName="w-20" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['From location', 'To location', 'Product'] as const).map((label) => (
              <div key={label} className="space-y-1">
                <div className="text-xs font-medium text-app-fg">{label}</div>
                <div className="h-9 animate-pulse rounded-md border border-app-border bg-app-hover" aria-hidden />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bare table — mirrors the real page (no outer card wrapper). */}
      <CompactTable<{ id: string }>
        caption={pageTitle}
        columns={transfersWorkspaceTableShellColumns()}
        rows={rows}
        rowKey={(r) => r.id}
        emptyTitle="Loading…"
        emptyDescription=""
        withCard={false}
        className="overflow-hidden rounded-xl border border-app-border"
      />
    </div>
  );
}

export function TransfersLoadingShell({ filters }: { filters: TransfersShellDateFilters }) {
  return <TransfersWorkspaceLoadingShell filters={filters} variant="stock" />;
}

export function LogisticsTransfersLoadingShell({ filters }: { filters: TransfersShellDateFilters }) {
  return <TransfersWorkspaceLoadingShell filters={filters} variant="logistics" />;
}
