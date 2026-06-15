import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { Button } from '~/components/ui/button';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { MobileDateFilterRow } from '~/components/ui/mobile-date-filter-row';
import { shellPulsePlaceholderRows, StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { FormSelect } from '~/components/ui/form-select';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { SearchInput } from '~/components/ui/search-input';
import { StatusBadge } from '~/components/ui/status-badge';
import { Tabs } from '~/components/ui/tabs';
import { TableActionButton } from '~/components/ui/table-action-button';
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
      key: 'availableStock',
      header: 'Available stock',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
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
      key: 'unitsDelivered',
      header: 'Units delivered',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
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
      key: 'actions',
      header: '',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

/** Remittances list placeholder — mirrors `RemittancesAdminPage` `unifiedColumnsWithActions`
 *  column-for-column so the layout doesn't shift when real data lands. */
const LOGISTICS_REMITTANCES_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'product', header: 'Product', render: () => <TableCellTextPulse className="w-[10rem]" /> },
  {
    key: 'route',
    header: 'From → To',
    minWidth: 'min-w-[200px]',
    render: () => <TableCellTextPulse className="w-[14rem]" />,
  },
  { key: 'sender', header: 'Sent by', render: () => <TableCellTextPulse className="w-[8rem]" /> },
  {
    key: 'qty',
    header: 'Qty',
    align: 'right',
    nowrap: true,
    render: () => (
      <span className="inline-flex w-full justify-end">
        <TableCellTextPulse className="w-[3rem]" />
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[5.5rem]" />,
  },
  {
    key: 'created',
    header: 'Created',
    nowrap: true,
    render: () => <TableCellTextPulse className="w-[8rem]" />,
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    tight: true,
    mobileShowLabel: false,
    minWidth: 'min-w-[200px]',
    render: () => (
      <div className="inline-flex flex-nowrap items-center justify-end gap-1.5">
        <TableActionButton variant="danger" disabled>Not received</TableActionButton>
        <TableActionButton variant="primary" disabled>Receive</TableActionButton>
      </div>
    ),
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
            sheetTitle="Actions"
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
      <OverviewStatStrip
        mobileGrid
        showScrollControls={false}
        items={[
          { label: 'Logistics companies', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Locations', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />

      <Tabs
        value="locations"
        onChange={() => {}}
        tabs={[
          { value: 'locations', label: 'Locations' },
          { value: 'providers', label: 'Companies' },
        ]}
      />
      {/* Search + filter row — mirrors the live partners search + location filters */}
      <div className="flex flex-wrap items-end gap-2">
        <span
          className="block h-9 w-full flex-1 min-w-0 md:min-w-[12rem] md:max-w-md animate-pulse rounded-md border border-app-border bg-app-hover"
          aria-hidden
        />
        <SearchableSelect
          value=""
          onChange={() => {}}
          placeholder="All companies"
          searchPlaceholder="Search companies..."
          options={[{ value: '', label: 'All companies' }]}
          wrapperClassName="w-40 sm:w-48"
        />
        <SearchableSelect
          value=""
          onChange={() => {}}
          placeholder="All states"
          searchPlaceholder="Search states..."
          options={[{ value: '', label: 'All states' }]}
          wrapperClassName="w-36 sm:w-44"
        />
      </div>

      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            {/* Row 1: name + status */}
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-32 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-14 rounded-full bg-app-hover animate-pulse" />
            </div>
            {/* Row 2: company + units */}
            <div className="flex items-center gap-2 text-xs">
              <div className="h-3 w-24 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
            </div>
            {/* Row 3: address */}
            <div className="h-3 w-36 rounded bg-app-hover animate-pulse" />
          </div>
        ))}
      </div>

      {/* Desktop skeleton table */}
      <div className="hidden md:block overflow-hidden rounded-lg border border-app-border">
        <table className="w-full text-sm">
          <thead className="border-b border-app-border bg-app-elevated">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide">Location</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide">Address</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide">Logistics company</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-fg-muted uppercase tracking-wide">Total stock</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-fg-muted uppercase tracking-wide">Alert threshold</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-app-fg-muted uppercase tracking-wide">Status</th>
              <th className="px-3 py-2 w-px" />
            </tr>
          </thead>
          <tbody className="divide-y divide-app-border">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <tr key={i}>
                <td className="px-3 py-2.5"><span className="block h-4 w-28 rounded bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5"><span className="block h-4 w-36 rounded bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5"><span className="block h-4 w-24 rounded bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5"><span className="block h-4 w-12 rounded bg-app-hover animate-pulse ml-auto" /></td>
                <td className="px-3 py-2.5"><span className="block h-4 w-16 rounded bg-app-hover animate-pulse ml-auto" /></td>
                <td className="px-3 py-2.5"><span className="block h-5 w-14 rounded-full bg-app-hover animate-pulse" /></td>
                <td className="px-3 py-2.5"><span className="block h-6 w-12 rounded bg-app-hover animate-pulse ml-auto" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Stock transfer confirmations — mirrors `RemittancesAdminPage` chrome (top-spacing,
 *  mobile sheet filters, mobile-only search, desktop-only filter card, mobile cards). */
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

  // Status dropdown options — match the loaded page's FormSelect-with-counts shape,
  // but counts pulse since real totals haven't arrived.
  const statusFilterOptions = useMemo(
    () => [
      { value: '', label: 'All' },
      { value: 'IN_TRANSIT', label: 'Pending' },
      { value: 'RECEIVED', label: 'Received' },
      { value: 'DISPUTED', label: 'Disputed' },
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

  const hasNonSearchFilters = !!(statusValue || locationId || sender || minQty || maxQty);

  // Mobile filter sheet body — mirrors `RemittancesAdminPage.mobileFiltersBody`.
  const mobileFilterBoxClass =
    'flex h-12 w-full items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5';
  const mobileFilterSelectClass = '!bg-transparent !border-transparent !text-center';
  const mobileFiltersBody = (
    <div className="space-y-2">
      <div className={mobileFilterBoxClass}>
        <FormSelect
          id="remit-shell-filter-status-mobile"
          value={statusValue}
          onChange={(e) => setFilterParam('status', e.target.value)}
          options={statusFilterOptions}
          controlSize="sm"
          openAs="modal"
          wrapperClassName="w-full"
          className={mobileFilterSelectClass}
        />
      </div>
      <SearchableSelect
        id="remit-shell-filter-location-mobile"
        placeholder="All locations"
        value={locationId}
        onChange={(v) => setFilterParam('locationId', v)}
        options={locationOptions}
        controlSize="sm"
        wrapperClassName="w-full"
      />
      <SearchableSelect
        id="remit-shell-filter-sender-mobile"
        placeholder="All senders"
        value={sender}
        onChange={(v) => setFilterParam('sender', v)}
        options={senderOptions}
        controlSize="sm"
        wrapperClassName="w-full"
      />
      <div className="grid grid-cols-2 gap-2">
        <div className={mobileFilterBoxClass}>
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-full"
            placeholder="Min qty"
            value={minQty}
            onChange={(e) => setFilterParam('minQty', e.target.value)}
          />
        </div>
        <div className={mobileFilterBoxClass}>
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-full"
            placeholder="Max qty"
            value={maxQty}
            onChange={(e) => setFilterParam('maxQty', e.target.value)}
          />
        </div>
      </div>
      {hasNonSearchFilters && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-12 w-full justify-center"
          onClick={clearAllFilters}
        >
          Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Stock Transfer Confirmations"
        mobileInlineActions
        description="Confirm incoming stock transfers."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel="Transfer confirmation toolbar"
            filters={mobileFiltersBody}
            filtersBadgeCount={hasNonSearchFilters ? 1 : 0}
            sheetCloseLabel="Done"
            desktop={
              <div className="flex items-center gap-2">
                <PageRefreshButton />
                <DateFilterBar startDate={startDate} endDate={endDate} periodAllTime={periodAllTime} chrome="pill" />
              </div>
            }
          />
        }
      />

      <MobileDateFilterRow startDate={startDate} endDate={endDate} periodAllTime={periodAllTime} />

      <OverviewStatStrip
        mobileGrid
        items={[
          { label: 'Total transfers', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Pending', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Received', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Disputed', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Qty sent', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Qty received', value: <StatValuePulse className="min-w-[2.5rem]" /> },
        ]}
      />

      {/* Mobile-only search — matches loaded page's md:hidden search form. */}
      <form
        className="w-full md:hidden"
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
            if (value === '') setFilterParam('search', '');
          }}
          withSubmitButton
        />
      </form>

      {/* Desktop-only filter card — mirrors loaded `hidden md:block card p-4`. */}
      <div className="hidden md:block card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="w-64"
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
                if (value === '') setFilterParam('search', '');
              }}
              withSubmitButton
            />
          </form>
          <FormSelect
            controlSize="sm"
            wrapperClassName="w-44"
            value={statusValue}
            onChange={(e) => setFilterParam('status', e.target.value)}
            options={statusFilterOptions}
          />
          <SearchableSelect
            controlSize="sm"
            wrapperClassName="w-52"
            placeholder="All locations"
            value={locationId}
            onChange={(v) => setFilterParam('locationId', v)}
            options={locationOptions}
          />
          <SearchableSelect
            controlSize="sm"
            wrapperClassName="w-48"
            placeholder="All senders"
            value={sender}
            onChange={(v) => setFilterParam('sender', v)}
            options={senderOptions}
          />
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-28"
            placeholder="Min qty"
            value={minQty}
            onChange={(e) => setFilterParam('minQty', e.target.value)}
          />
          <TextInput
            type="number"
            min={0}
            controlSize="sm"
            wrapperClassName="w-28"
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
        renderMobileCard={() => (
          <div className="-mx-3 -my-2.5 block w-[calc(100%+1.5rem)] px-3 py-2.5 space-y-1.5">
            {/* Row 1: Product + qty + status */}
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1">
                <TableCellTextPulse className="w-[10rem]" />
              </span>
              <span className="h-5 w-16 rounded-full bg-app-hover animate-pulse shrink-0" aria-hidden />
            </div>
            {/* Row 2: Route + date */}
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1">
                <TableCellTextPulse className="w-[12rem]" />
              </span>
              <span className="shrink-0">
                <TableCellTextPulse className="w-[5rem]" />
              </span>
            </div>
          </div>
        )}
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
            <DateFilterBar
                startDate={dateFilters.startDate}
                endDate={dateFilters.endDate}
                periodAllTime={dateFilters.periodAllTime} chrome="pill" />
            <PageRefreshButton />
          </>
        }
      />
      <OverviewStatStrip
        mobileGrid
        showScrollControls={false}
        items={[
          { label: 'Active providers', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Total assigned', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivered', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Delivery rate', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Delinquency rate', value: <StatValuePulse className="min-w-[3rem]" /> },
        ]}
      />
      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-32 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-app-hover animate-pulse" />
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="h-3 w-20 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-16 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-12 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <CompactTable<{ id: string }>
          columns={logisticsTeamShellColumns()}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
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
  const pageTitle = variant === 'logistics' ? 'Partner Transfers' : 'Stock Transfers';
  const pageDescription =
    variant === 'logistics'
      ? 'Request stock moves between logistics locations.'
      : 'Move stock between locations and track receipt.';
  const initiateCta = variant === 'logistics' ? '+ Request transfer' : '+ Record transfer';

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title={pageTitle}
        mobileInlineActions
        description={pageDescription}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Actions"
            triggerAriaLabel={`${pageTitle} toolbar and date range`}
            desktop={
              <>
                <PageRefreshButton />
                <DateFilterBar
                    startDate={filters.periodAllTime ? '' : filters.startDate}
                    endDate={filters.periodAllTime ? '' : filters.endDate}
                    periodAllTime={filters.periodAllTime} chrome="pill" />
                <Button variant="primary" size="sm" disabled>
                  {initiateCta}
                </Button>
              </>
            }
            sheet={
              <Button variant="primary" size="sm" className="h-12 w-full justify-center" disabled>
                {initiateCta}
              </Button>
            }
          />
        }
      />

      <MobileDateFilterRow
        startDate={filters.periodAllTime ? '' : filters.startDate}
        endDate={filters.periodAllTime ? '' : filters.endDate}
        periodAllTime={filters.periodAllTime}
      />

      <OverviewStatStrip
        mobileGrid
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
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <SearchableSelect
            id="transfer-shell-from"
            label="From location"
            value=""
            onChange={() => {}}
            placeholder="All locations"
            searchPlaceholder="Search locations..."
            options={[{ value: '', label: 'All locations' }]}
          />
          <SearchableSelect
            id="transfer-shell-to"
            label="To location"
            value=""
            onChange={() => {}}
            placeholder="All locations"
            searchPlaceholder="Search locations..."
            options={[{ value: '', label: 'All locations' }]}
          />
          <SearchableSelect
            id="transfer-shell-product"
            label="Product"
            value=""
            onChange={() => {}}
            placeholder="All products"
            searchPlaceholder="Search products..."
            options={[{ value: '', label: 'All products' }]}
          />
        </div>
      </div>

      {/* Mobile skeleton cards */}
      <div className="md:hidden space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card px-3 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-28 rounded bg-app-hover animate-pulse" />
              <div className="h-5 w-16 rounded-full bg-app-hover animate-pulse" />
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="h-3 w-32 rounded bg-app-hover animate-pulse" />
              <div className="h-3 w-10 rounded bg-app-hover animate-pulse" />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table — mirrors the real page (no outer card wrapper). */}
      <div className="hidden md:block">
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
    </div>
  );
}

export function TransfersLoadingShell({ filters }: { filters: TransfersShellDateFilters }) {
  return <TransfersWorkspaceLoadingShell filters={filters} variant="stock" />;
}

export function LogisticsTransfersLoadingShell({ filters }: { filters: TransfersShellDateFilters }) {
  return <TransfersWorkspaceLoadingShell filters={filters} variant="logistics" />;
}
