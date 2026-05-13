import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from '@remix-run/react';
import { BranchScopedLink } from '~/components/ui/branch-scoped-link';
import { Button } from '~/components/ui/button';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { FormSelect } from '~/components/ui/form-select';
import { LeaderboardTrophy } from '~/components/ui/leaderboard-trophy';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { SearchInput } from '~/components/ui/search-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { Tabs } from '~/components/ui/tabs';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';

const AD_SPEND_STATUS_TAB_OPTIONS = [
  { value: 'ALL', label: 'All entries' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

function AdSpendViewToggleShell({ fullWidth = false }: { fullWidth?: boolean }) {
  const shellClass = fullWidth
    ? 'flex w-full overflow-hidden rounded-md border border-app-border'
    : 'inline-flex overflow-hidden rounded-md border border-app-border';
  const buttonBase = 'px-3 py-1 text-xs font-medium transition-colors';

  return (
    <div role="tablist" aria-label="Expense view mode" className={shellClass}>
      <button
        type="button"
        role="tab"
        aria-selected="true"
        disabled
        className={[buttonBase, fullWidth ? 'flex-1 text-center' : '', 'bg-brand-500 text-white opacity-85'].join(' ')}
      >
        Daily
      </button>
      <button
        type="button"
        role="tab"
        aria-selected="false"
        disabled
        className={[
          buttonBase,
          'border-l border-app-border bg-app-canvas text-app-fg-muted opacity-70',
          fullWidth ? 'flex-1 text-center' : '',
        ].join(' ')}
      >
        Detailed
      </button>
    </div>
  );
}

const TEAM_SORT_BY_OPTIONS_SHELL = [
  { value: 'name', label: 'Name' },
  { value: 'balance', label: 'Balance' },
  { value: 'received', label: 'Received' },
  { value: 'spent', label: 'Ad spend' },
  { value: 'cpa', label: 'CPA' },
  { value: 'profitability', label: 'Profitability' },
  { value: 'confirm', label: 'Confirm %' },
  { value: 'delivery', label: 'Delivery %' },
];

const FUNDING_ENTRY_TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'request', label: 'Requests' },
];

const FUNDING_ENTRY_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'SENT', label: 'Sent' },
  { value: 'COMPLETED', label: 'Received' },
  { value: 'DISPUTED', label: 'Disputed' },
  { value: 'PENDING', label: 'Pending request' },
  { value: 'APPROVED', label: 'Approved request' },
  { value: 'REJECTED', label: 'Rejected request' },
];

function fundingMetricsShellStatItems(canDistribute: boolean) {
  const items: { label: string; value: ReactNode }[] = [
    { label: 'Current balance', value: <StatValuePulse className="min-w-[4rem]" /> },
    { label: 'Total Received', value: <StatValuePulse className="min-w-[4rem]" /> },
  ];
  if (canDistribute) {
    items.push({ label: 'Total Distributed', value: <StatValuePulse className="min-w-[4rem]" /> });
  }
  items.push({ label: 'Pending Mark-Received', value: <StatValuePulse className="min-w-[2.5rem]" /> });
  if (canDistribute) {
    items.push({ label: 'Pending Requests', value: <StatValuePulse className="min-w-[2rem]" /> });
    items.push({ label: 'My Pending Asks', value: <StatValuePulse className="min-w-[2rem]" /> });
  } else {
    items.push({ label: 'Pending Requests', value: <StatValuePulse className="min-w-[2rem]" /> });
  }
  items.push({ label: 'Disputed', value: <StatValuePulse className="min-w-[2rem]" /> });
  return items;
}

const FUNDING_SHELL_ROWS = 6;
function fundingLedgerShellPlaceholderRows(): { id: string }[] {
  return Array.from({ length: FUNDING_SHELL_ROWS }, (_, i) => ({ id: `__funding_shell_${i}` }));
}
const FUNDING_LEDGER_SHELL_ROW_DATA = fundingLedgerShellPlaceholderRows();

function fundingLedgerShellTableColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'type', header: 'Type', render: () => <TableCellTextPulse className="w-[4.5rem]" /> },
    { key: 'from', header: 'From', render: () => <TableCellTextPulse className="w-[8rem] max-w-[min(12rem,100%)]" /> },
    { key: 'to', header: 'To', render: () => <TableCellTextPulse className="w-[8rem] max-w-[min(12rem,100%)]" /> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[4.5rem]" />
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
    { key: 'date', header: 'Date', nowrap: true, render: () => <TableCellTextPulse className="w-[9rem]" /> },
    {
      key: 'actions',
      header: '',
      mobileLabel: 'Actions',
      align: 'right',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

const MARKETING_TEAM_SHELL_ROWS = 8;
function marketingTeamShellPlaceholderRows(): { userId: string }[] {
  return Array.from({ length: MARKETING_TEAM_SHELL_ROWS }, (_, i) => ({
    userId: `__marketing_team_shell_${i}`,
  }));
}
const MARKETING_TEAM_SHELL_ROW_DATA = marketingTeamShellPlaceholderRows();

function marketingTeamLoadingShellTableColumns(): CompactTableColumn<{ userId: string }>[] {
  const num = () => (
    <span className="inline-flex w-full justify-end">
      <TableCellTextPulse className="w-[4rem]" />
    </span>
  );
  return [
    {
      key: 'member',
      header: 'Member',
      render: () => (
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-border/80 dark:bg-app-border/65 animate-pulse"
            aria-hidden
          />
          <TableCellTextPulse className="w-[10rem] max-w-[min(14rem,100%)]" />
        </div>
      ),
    },
    { key: 'balance', header: 'Balance', align: 'right', nowrap: true, render: num },
    { key: 'received', header: 'Received', align: 'right', nowrap: true, render: num },
    { key: 'spent', header: 'Spent', align: 'right', nowrap: true, render: num },
    { key: 'cpa', header: 'CPA', align: 'right', nowrap: true, render: num },
    { key: 'profitability', header: 'Profitability', align: 'right', nowrap: true, render: num },
    { key: 'confirm', header: 'Confirm %', align: 'right', nowrap: true, render: num },
    { key: 'delivery', header: 'Delivery %', align: 'right', nowrap: true, render: num },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      tight: true,
      nowrap: true,
      minWidth: 'min-w-[12rem]',
      mobileShowLabel: false,
      render: () => (
        <div className="inline-flex shrink-0 flex-nowrap items-center justify-end gap-1.5">
          <CompactTableActionButton disabled tone="brand">
            View orders
          </CompactTableActionButton>
          <CompactTableActionButton disabled>View profile</CompactTableActionButton>
        </div>
      ),
    },
  ];
}

const CROSS_FUNNEL_SHELL_ROWS = 8;
function crossFunnelShellPlaceholderRows(): { id: string }[] {
  return Array.from({ length: CROSS_FUNNEL_SHELL_ROWS }, (_, i) => ({
    id: `__cross_funnel_shell_${i}`,
  }));
}
const CROSS_FUNNEL_SHELL_ROW_DATA = crossFunnelShellPlaceholderRows();

function crossFunnelLoadingShellTableColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'when', header: 'When', render: () => <TableCellTextPulse className="w-[9rem]" /> },
    { key: 'customer', header: 'Customer', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    { key: 'product', header: 'Product', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    { key: 'funnel', header: 'Your funnel', render: () => <TableCellTextPulse className="w-[7rem]" /> },
    { key: 'credited', header: 'Credited to', render: () => <TableCellTextPulse className="w-[7rem]" /> },
  ];
}

/** Funding — static header, date filter, real (disabled) CTAs when allowed; metrics + ledger pulse. */
export function MarketingFundingLoadingShell({
  filters,
  canDistribute,
  isMediaBuyer,
  canRequestFunding,
  canSendFunding,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  canDistribute: boolean;
  isMediaBuyer: boolean;
  canRequestFunding: boolean;
  canSendFunding: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') ?? '');

  useEffect(() => {
    setSearchQuery(searchParams.get('search') ?? '');
  }, [searchParams]);

  const receivedTitle = isMediaBuyer ? 'Incoming Funding' : "Funds I've Received";
  const activeSection =
    !canDistribute ? 'received' : searchParams.get('section') === 'received' ? 'received' : 'distributing';

  const entryType = searchParams.get('entryType') ?? 'all';
  const entryStatus = searchParams.get('entryStatus') ?? '';

  const badgeCount = useMemo(() => {
    let n = 0;
    if (entryType !== 'all') n += 1;
    if (entryStatus !== '') n += 1;
    if (searchQuery.trim()) n += 1;
    return n;
  }, [entryType, entryStatus, searchQuery]);

  const navigateSection = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('section', v);
      next.set('tab', 'transfers');
      next.delete('page');
      return next;
    });
  };

  const setEntryType = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!v || v === 'all') next.delete('entryType');
      else next.set('entryType', v);
      return next;
    });
  };

  const setEntryStatus = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!v) next.delete('entryStatus');
      else next.set('entryStatus', v);
      return next;
    });
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      const q = searchQuery.trim();
      if (q) next.set('search', q);
      else next.delete('search');
      return next;
    });
  };

  const statItems = useMemo(() => fundingMetricsShellStatItems(canDistribute), [canDistribute]);
  const ledgerColumns = useMemo(() => fundingLedgerShellTableColumns(), []);

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Funding"
        mobileInlineActions
        description="Track funds received and sent."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Funding tools"
            sheetSubtitle={<span>Request, send, and date range</span>}
            triggerAriaLabel="Filters and funding actions"
            desktop={
              <>
                {canRequestFunding && (
                  <Button type="button" variant={canSendFunding ? 'secondary' : 'primary'} size="sm" disabled className="opacity-70">
                    + Request Funds
                  </Button>
                )}
                {canSendFunding && (
                  <Button type="button" variant="primary" size="sm" disabled className="opacity-70">
                    + Send Funding
                  </Button>
                )}
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2 md:min-h-[2rem] md:w-auto md:flex-row md:items-center md:justify-start md:py-1 md:pl-2.5 md:pr-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                {canRequestFunding && (
                  <Button type="button" variant="secondary" size="sm" className="w-full justify-center" disabled>
                    + Request Funds
                  </Button>
                )}
                {canSendFunding && (
                  <Button type="button" variant="primary" size="sm" className="w-full justify-center" disabled>
                    + Send Funding
                  </Button>
                )}
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <Button type="button" variant="ghost" size="sm" className="w-full" onClick={closeSheet}>
                  Done
                </Button>
              </>
            )}
          />
        }
      />

      <OverviewStatStrip items={statItems} />

      <div className="card scroll-mt-4 overflow-hidden p-0" id="funding-ledger">
        {canDistribute ? (
          <div className="px-4 pt-2">
            <Tabs
              variant="underline"
              value={activeSection}
              onChange={navigateSection}
              tabs={[
                { value: 'distributing', label: 'Funds I Distribute' },
                { value: 'received', label: receivedTitle },
              ]}
            />
          </div>
        ) : null}

        {!canDistribute ? (
          <div className="border-b border-app-border px-4 py-3">
            <h2 className="text-base font-semibold text-app-fg">{receivedTitle}</h2>
          </div>
        ) : null}

        <ToolbarFiltersCollapsible
          badgeCount={badgeCount}
          sheetSubtitle={<span>Type, status, and search apply immediately</span>}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                placeholder="Search ledger…"
                value={searchQuery}
                onChange={(val) => setSearchQuery(val)}
                wrapperClassName="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          }
          desktopInlineFilters={
            <>
              <FormSelect
                value={entryType}
                onChange={(e) => setEntryType(e.target.value)}
                options={FUNDING_ENTRY_TYPE_OPTIONS}
                wrapperClassName="w-auto min-w-[10rem]"
              />
              <FormSelect
                value={entryStatus}
                onChange={(e) => setEntryStatus(e.target.value)}
                options={FUNDING_ENTRY_STATUS_OPTIONS}
                wrapperClassName="w-auto min-w-[11rem]"
              />
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Entry type</span>
                <FormSelect
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value)}
                  options={FUNDING_ENTRY_TYPE_OPTIONS}
                  wrapperClassName="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Status</span>
                <FormSelect
                  value={entryStatus}
                  onChange={(e) => setEntryStatus(e.target.value)}
                  options={FUNDING_ENTRY_STATUS_OPTIONS}
                  wrapperClassName="w-full"
                />
              </div>
            </>
          }
        />

        <CompactTable<{ id: string }>
          withCard={false}
          columns={ledgerColumns}
          rows={FUNDING_LEDGER_SHELL_ROW_DATA}
          rowKey={(row) => row.id}
          emptyTitle="No entries match your filters"
          emptyDescription="Try adjusting type or status"
        />

        <div className="flex flex-col gap-3 border-t border-app-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 flex min-h-[1.25rem] items-center text-sm">
            <span
              className="inline-block h-4 w-48 max-w-[90vw] animate-pulse rounded-md bg-app-border/75 dark:bg-app-border/60 sm:w-64"
              aria-hidden
            />
          </p>
          <div className="flex shrink-0 items-center gap-2" aria-hidden>
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-28 animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Ad spend — header + filters; stat strip + accordion/table pulse. */
export function MarketingAdSpendLoadingShell({
  filters,
  viewMode,
  canApproveAdSpend,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  viewMode: 'media_buyer' | 'admin';
  canApproveAdSpend: boolean;
}) {
  const isMb = viewMode === 'media_buyer';
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') ?? '');

  useEffect(() => {
    setSearchQuery(searchParams.get('search') ?? '');
  }, [searchParams]);

  const selectedStatus = searchParams.get('status') || 'ALL';
  const selectedProductId = searchParams.get('productId') || 'ALL';
  const selectedCampaignId = searchParams.get('campaignId') || 'ALL';
  const selectedMediaBuyerId = searchParams.get('mediaBuyerId') || 'ALL';

  const productOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All products' }];
    if (selectedProductId !== 'ALL') {
      base.push({ value: selectedProductId, label: 'Selected product' });
    }
    return base;
  }, [selectedProductId]);

  const campaignOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All campaigns' }];
    if (selectedCampaignId !== 'ALL') {
      base.push({ value: selectedCampaignId, label: 'Selected campaign' });
    }
    return base;
  }, [selectedCampaignId]);

  const mediaBuyerOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All media buyers' }];
    if (!isMb && selectedMediaBuyerId !== 'ALL') {
      base.push({ value: selectedMediaBuyerId, label: 'Selected media buyer' });
    }
    return base;
  }, [isMb, selectedMediaBuyerId]);

  const badgeCount = useMemo(() => {
    let n = 0;
    if (selectedStatus !== 'ALL') n += 1;
    if (selectedProductId !== 'ALL') n += 1;
    if (selectedCampaignId !== 'ALL') n += 1;
    if (!isMb && selectedMediaBuyerId !== 'ALL') n += 1;
    return n;
  }, [selectedStatus, selectedProductId, selectedCampaignId, selectedMediaBuyerId, isMb]);

  const handleStatusChange = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      next.set('gpage', '1');
      if (!v || v === 'ALL') next.delete('status');
      else next.set('status', v);
      return next;
    });
  };

  const setProductId = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      next.set('gpage', '1');
      if (!v || v === 'ALL') next.delete('productId');
      else next.set('productId', v);
      return next;
    });
  };

  const setCampaignId = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      next.set('gpage', '1');
      if (!v || v === 'ALL') next.delete('campaignId');
      else next.set('campaignId', v);
      return next;
    });
  };

  const setMediaBuyerId = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      next.set('gpage', '1');
      if (!v || v === 'ALL') next.delete('mediaBuyerId');
      else next.set('mediaBuyerId', v);
      return next;
    });
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      next.set('gpage', '1');
      const q = searchQuery.trim();
      if (q) next.set('search', q);
      else next.delete('search');
      return next;
    });
  };

  const productDisabled = productOptions.length <= 1;
  const campaignDisabled = campaignOptions.length <= 1;
  const buyerDisabled = isMb || mediaBuyerOptions.length <= 1;

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Ads Expense"
        mobileInlineActions
        description="Log daily ad spend."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Ads Expense tools"
            sheetSubtitle={<span>Date range and new expense entry</span>}
            triggerAriaLabel="Date, add expense, and more"
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <BranchScopedLink
                  to="/admin/marketing/ad-spend/new"
                  actionLabel="adding ad spend"
                  className="btn-primary btn-sm inline-flex items-center justify-center shrink-0"
                >
                  + Add Expense
                </BranchScopedLink>
                <PageRefreshButton />
              </>
            }
            sheet={({ closeSheet }) => (
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <BranchScopedLink
                  to="/admin/marketing/ad-spend/new"
                  actionLabel="adding ad spend"
                  onClick={() => closeSheet()}
                  className="btn-primary btn-sm w-full justify-center inline-flex items-center"
                >
                  + Add Expense
                </BranchScopedLink>
              </>
            )}
          />
        }
      />

      {canApproveAdSpend ? (
        <div
          className="rounded-lg border border-app-border bg-app-hover/40 px-4 py-3 dark:bg-app-hover/25"
          aria-hidden
        >
          <div className="h-3 w-40 max-w-full rounded-md bg-app-border/80 dark:bg-app-border/65 animate-pulse" />
          <div className="mt-2 h-3 w-full max-w-xl rounded-md bg-app-border/70 dark:bg-app-border/55 animate-pulse" />
        </div>
      ) : null}

      <OverviewStatStrip
        items={[
          { label: 'Total spend', value: <StatValuePulse className="min-w-[5rem]" /> },
          { label: 'CPA', value: <StatValuePulse className="min-w-[4rem]" /> },
          {
            label: 'True ROAS',
            value: <StatValuePulse className="min-w-[3.5rem]" />,
          },
        ]}
      />

      <div className="card scroll-mt-4 overflow-hidden p-0">
        <div className="border-b border-app-border px-4 py-3">
          <Tabs value={selectedStatus} onChange={handleStatusChange} tabs={AD_SPEND_STATUS_TAB_OPTIONS} />
        </div>
        <ToolbarFiltersCollapsible
          badgeCount={badgeCount}
          sheetSubtitle={<span>Product, campaign, and buyer filters apply immediately</span>}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                placeholder="Search buyer, product, campaign, or entry ID..."
                value={searchQuery}
                onChange={(val) => setSearchQuery(val)}
                wrapperClassName="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          }
          desktopInlineFilters={
            <>
              <SearchableSelect
                id="marketing-adspend-shell-product"
                value={selectedProductId}
                onChange={setProductId}
                options={productOptions}
                disabled={productDisabled}
                wrapperClassName="w-full min-w-0 sm:w-auto sm:min-w-[12rem]"
                placeholder="All products"
                searchPlaceholder="Search products…"
              />
              <SearchableSelect
                id="marketing-adspend-shell-campaign"
                value={selectedCampaignId}
                onChange={setCampaignId}
                options={campaignOptions}
                disabled={campaignDisabled}
                wrapperClassName="w-full min-w-0 sm:w-auto sm:min-w-[12rem]"
                placeholder="All campaigns"
                searchPlaceholder="Search campaigns…"
              />
              {!isMb ? (
                <SearchableSelect
                  id="marketing-adspend-shell-buyer"
                  value={selectedMediaBuyerId}
                  onChange={setMediaBuyerId}
                  options={mediaBuyerOptions}
                  disabled={buyerDisabled}
                  wrapperClassName="w-full min-w-0 sm:w-auto sm:min-w-[12rem]"
                  placeholder="All media buyers"
                  searchPlaceholder="Search buyers…"
                />
              ) : null}
              <AdSpendViewToggleShell />
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">View</span>
                <AdSpendViewToggleShell fullWidth />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Product</span>
                <SearchableSelect
                  id="marketing-adspend-shell-product-sheet"
                  value={selectedProductId}
                  onChange={setProductId}
                  options={productOptions}
                  disabled={productDisabled}
                  wrapperClassName="w-full"
                  placeholder="All products"
                  searchPlaceholder="Search products…"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Campaign</span>
                <SearchableSelect
                  id="marketing-adspend-shell-campaign-sheet"
                  value={selectedCampaignId}
                  onChange={setCampaignId}
                  options={campaignOptions}
                  disabled={campaignDisabled}
                  wrapperClassName="w-full"
                  placeholder="All campaigns"
                  searchPlaceholder="Search campaigns…"
                />
              </div>
              {!isMb ? (
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-app-fg-muted">Media buyer</span>
                  <SearchableSelect
                    id="marketing-adspend-shell-buyer-sheet"
                    value={selectedMediaBuyerId}
                    onChange={setMediaBuyerId}
                    options={mediaBuyerOptions}
                    disabled={buyerDisabled}
                    wrapperClassName="w-full"
                    placeholder="All media buyers"
                    searchPlaceholder="Search buyers…"
                  />
                </div>
              ) : null}
            </>
          }
        />

        <div className="space-y-3 p-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border border-app-border bg-app-elevated p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <TableCellTextPulse className="w-[14rem] max-w-[min(90vw,100%)]" />
                <TableCellTextPulse className="w-[6rem]" />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[1, 2, 3, 4].map((line) => (
                  <div key={line} className="flex items-center justify-between gap-3 text-sm">
                    <TableCellTextPulse className="w-[5rem]" />
                    <TableCellTextPulse className="w-[8rem] max-w-[50%]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-app-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 flex min-h-[1.25rem] items-center text-sm">
            <span
              className="inline-block h-4 w-52 max-w-[90vw] animate-pulse rounded-md bg-app-border/75 dark:bg-app-border/60 sm:w-72"
              aria-hidden
            />
          </p>
          <div className="flex shrink-0 items-center gap-2" aria-hidden>
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-28 animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Team analysis — header, date, export (disabled), table pulse. */
export function MarketingTeamLoadingShell({
  dateFilters,
}: {
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const profitabilityConfig = { targetRoas: 3, greenThreshold: 2.5 };
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') ?? '');

  useEffect(() => {
    setSearchQuery(searchParams.get('q') ?? '');
  }, [searchParams]);

  const sortByFromLoader = searchParams.get('sortBy') ?? 'name';
  const sortDirFromLoader = searchParams.get('sortDir') ?? 'asc';

  const mergeListParams = (overrides: {
    q?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    page?: number;
  }) => {
    const params = new URLSearchParams(searchParams);
    if (overrides.q !== undefined) {
      const trimmed = overrides.q.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
    }
    if (overrides.sortBy !== undefined) params.set('sortBy', overrides.sortBy);
    if (overrides.sortDir !== undefined) params.set('sortDir', overrides.sortDir);
    if (overrides.page !== undefined) {
      if (overrides.page <= 1) params.delete('page');
      else params.set('page', String(overrides.page));
    }
    setSearchParams(params);
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    mergeListParams({ q: searchQuery, page: 1 });
  };

  const badgeCount = useMemo(() => {
    let n = 0;
    if (sortByFromLoader !== 'name') n += 1;
    if (sortDirFromLoader !== 'asc') n += 1;
    return n;
  }, [sortByFromLoader, sortDirFromLoader]);

  const teamCols = useMemo(() => marketingTeamLoadingShellTableColumns(), []);

  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Team Analysis"
        mobileInlineActions
        description="View media buyer performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Team analysis tools"
            sheetSubtitle={<span>Date range and export</span>}
            triggerAriaLabel="Team analysis toolbar and date range"
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" disabled className="opacity-70">
                  Generate report
                </Button>
                <PageRefreshButton />
              </>
            }
            sheet={
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" className="w-full justify-center" disabled>
                  Generate report
                </Button>
              </>
            }
          />
        }
      />

      <OverviewStatStrip
        showScrollControls={false}
        items={[
          { label: 'Total Sent', value: <StatValuePulse className="min-w-[5rem]" /> },
          { label: 'Completed', value: <StatValuePulse className="min-w-[5rem]" /> },
          { label: 'Disputed', value: <StatValuePulse className="min-w-[4rem]" /> },
        ]}
      />

      <div>
        <ToolbarFiltersCollapsible
          className="mb-4 !border-0 px-0 py-0"
          badgeCount={badgeCount}
          sheetSubtitle={<span>Sort options apply immediately</span>}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                placeholder="Search by name or role…"
                value={searchQuery}
                onChange={(v) => setSearchQuery(v)}
                wrapperClassName="min-w-0 flex-1"
                name="q"
                autoComplete="off"
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          }
          desktopInlineFilters={
            <>
              <FormSelect
                aria-label="Sort team list by"
                value={sortByFromLoader}
                onChange={(e) => {
                  const next = e.target.value;
                  const nextDir: 'asc' | 'desc' = next === 'name' ? 'asc' : 'desc';
                  mergeListParams({ sortBy: next, sortDir: nextDir, page: 1 });
                }}
                options={TEAM_SORT_BY_OPTIONS_SHELL}
                wrapperClassName="w-auto min-w-[11rem]"
              />
              <FormSelect
                aria-label="Sort order"
                value={sortDirFromLoader}
                onChange={(e) => mergeListParams({ sortDir: e.target.value as 'asc' | 'desc', page: 1 })}
                options={[
                  { value: 'asc', label: 'Ascending' },
                  { value: 'desc', label: 'Descending' },
                ]}
                wrapperClassName="w-auto min-w-[8rem]"
              />
            </>
          }
          sheetFilterBody={
            <>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Sort by</span>
                <FormSelect
                  aria-label="Sort team list by"
                  value={sortByFromLoader}
                  onChange={(e) => {
                    const next = e.target.value;
                    const nextDir: 'asc' | 'desc' = next === 'name' ? 'asc' : 'desc';
                    mergeListParams({ sortBy: next, sortDir: nextDir, page: 1 });
                  }}
                  options={TEAM_SORT_BY_OPTIONS_SHELL}
                  wrapperClassName="w-full"
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-app-fg-muted">Order</span>
                <FormSelect
                  aria-label="Sort order"
                  value={sortDirFromLoader}
                  onChange={(e) => mergeListParams({ sortDir: e.target.value as 'asc' | 'desc', page: 1 })}
                  options={[
                    { value: 'asc', label: 'Ascending' },
                    { value: 'desc', label: 'Descending' },
                  ]}
                  wrapperClassName="w-full"
                />
              </div>
            </>
          }
        />

        <div className="md:hidden grid grid-cols-1 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card space-y-3 p-4">
              <div className="flex items-center gap-2.5">
                <div
                  className="h-10 w-10 shrink-0 rounded-full bg-app-border/80 dark:bg-app-border/65 animate-pulse"
                  aria-hidden
                />
                <TableCellTextPulse className="min-w-0 flex-1 max-w-[12rem]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="flex flex-col gap-1">
                    <TableCellTextPulse className="w-16" />
                    <TableCellTextPulse className="w-full max-w-[7rem]" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="hidden md:block">
          <div className="card overflow-x-auto p-0">
            <CompactTable<{ userId: string }>
              withCard={false}
              columns={teamCols}
              rows={MARKETING_TEAM_SHELL_ROW_DATA}
              rowKey={(m) => m.userId}
              className="min-w-[960px]"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 flex min-h-[1.25rem] items-center text-sm">
            <span
              className="inline-block h-4 w-48 max-w-[90vw] animate-pulse rounded-md bg-app-border/75 dark:bg-app-border/60 sm:w-64"
              aria-hidden
            />
          </p>
          <div className="flex shrink-0 items-center gap-2" aria-hidden>
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-28 animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Leaderboard — matches MarketingLeaderboardPage chrome. */
export function MarketingLeaderboardLoadingShell({
  filters,
  leaderboardPeriod,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  leaderboardPeriod: 'this_month' | 'all_time';
}) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Marketing Leaderboard"
        mobileInlineActions
        description="Compare media buyer performance."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Leaderboard tools"
            sheetSubtitle={<span>Date range and refresh</span>}
            triggerAriaLabel="Leaderboard toolbar and date range"
            desktop={
              <>
                <div className="flex shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
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
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
              </>
            }
          />
        }
      />
      <div className="card p-0">
        <div className="space-y-3 px-3 py-3 md:space-y-4 md:px-4 md:py-4">
          {[1, 2, 3, 4, 5].map((rank) => {
            const isTopThree = rank <= 3;
            return (
              <div
                key={rank}
                className={`rounded-lg border border-app-border p-3 md:p-4 ${
                  isTopThree ? 'bg-app-hover' : 'bg-app-elevated'
                }`}
              >
                <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-app-hover font-mono text-sm font-medium text-app-fg-muted">
                      #{rank}
                    </span>
                    {isTopThree && <LeaderboardTrophy rank={rank as 1 | 2 | 3} />}
                    <div className="min-w-0 flex-1">
                      <TableCellTextPulse className="w-[10rem] max-w-[min(16rem,100%)]" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pl-10 md:block md:pl-0">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-app-hover px-2.5 py-1 text-xs font-bold text-app-fg md:px-3 md:py-1.5 md:text-sm">
                      <TableCellTextPulse className="w-[2.25rem]" />
                      <span>x ROAS</span>
                    </span>
                    <svg
                      className="h-4 w-4 shrink-0 text-app-fg-muted md:hidden"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                </div>
                <div className="mt-2.5 hidden border-t border-app-border pt-2.5 text-sm md:flex md:flex-wrap md:items-center md:gap-x-4 md:gap-y-1">
                  <TableCellTextPulse className="w-[6rem]" />
                  <TableCellTextPulse className="w-[5rem]" />
                  <TableCellTextPulse className="w-[5rem]" />
                  <TableCellTextPulse className="w-[5rem]" />
                  <TableCellTextPulse className="w-[6rem]" />
                  <TableCellTextPulse className="w-[5rem]" />
                  <TableCellTextPulse className="w-[5rem]" />
                  <TableCellTextPulse className="w-[5rem]" />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-app-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="m-0 flex min-h-[1.25rem] items-center text-xs text-app-fg-muted">
            <span
              className="inline-block h-3 w-44 max-w-[80vw] animate-pulse rounded-md bg-app-border/70 dark:bg-app-border/55"
              aria-hidden
            />
          </p>
          <div className="flex shrink-0 items-center gap-2" aria-hidden>
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-28 animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cross-funnel — PageHeader + DateFilterBar; stats + table pulse (secondary still streams inside page). */
export function MarketingCrossFunnelLoadingShell({
  filters,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean; productId: string };
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const productIdParam = searchParams.get('productId') || filters.productId || 'ALL';

  const productOptions = useMemo(() => {
    const base: { value: string; label: string }[] = [{ value: 'ALL', label: 'All products' }];
    if (productIdParam !== 'ALL') {
      base.push({ value: productIdParam, label: 'Selected product' });
    }
    return base;
  }, [productIdParam]);

  const setProductId = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('page', '1');
      if (!v || v === 'ALL') next.delete('productId');
      else next.set('productId', v);
      return next;
    });
  };

  const productDisabled = productOptions.length <= 1;
  const crossFunnelCols = useMemo(() => crossFunnelLoadingShellTableColumns(), []);

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Cross-funnel attempts"
        mobileInlineActions
        description="Review duplicate funnel attempts."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Cross-funnel tools"
            sheetSubtitle={<span>Date range and refresh</span>}
            triggerAriaLabel="Cross-funnel toolbar and date range"
            desktop={
              <>
                <div className="flex w-fit shrink-0 items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
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
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
              </>
            }
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Attempts', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Unique customers', value: <StatValuePulse className="min-w-[2rem]" /> },
          {
            label: 'Top product',
            value: <StatValuePulse className="min-w-[10rem] max-w-[14rem]" />,
            plainValue: true,
          },
        ]}
      />

      <Card>
        <CardHeader title="By product" />
        <CardBody>
          <ul className="divide-y divide-app-border">
            {[1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center justify-between gap-4 py-2">
                <TableCellTextPulse className="min-w-0 flex-1 max-w-[14rem]" />
                <TableCellTextPulse className="w-8 shrink-0" />
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <ToolbarFiltersCollapsible
        badgeCount={productIdParam !== 'ALL' ? 1 : 0}
        sheetSubtitle={<span>Product filter applies immediately</span>}
        searchRow={null}
        desktopInlineFilters={
          <SearchableSelect
            id="cross-funnel-shell-product"
            value={productIdParam}
            onChange={setProductId}
            options={productOptions}
            disabled={productDisabled}
            wrapperClassName="w-full min-w-0 sm:w-80"
            placeholder="All products"
            searchPlaceholder="Search products…"
          />
        }
        sheetFilterBody={
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-app-fg-muted">Product</span>
            <SearchableSelect
              id="cross-funnel-shell-product-sheet"
              value={productIdParam}
              onChange={setProductId}
              options={productOptions}
              disabled={productDisabled}
              wrapperClassName="w-full"
              placeholder="All products"
              searchPlaceholder="Search products…"
            />
          </div>
        }
      />

      <Card>
        <CardHeader title="Attempts" />
        <CardBody className="p-0">
          <CompactTable<{ id: string }>
            withCard={false}
            columns={crossFunnelCols}
            rows={CROSS_FUNNEL_SHELL_ROW_DATA}
            rowKey={(row) => row.id}
            emptyTitle="No cross-funnel attempts in this range"
            emptyDescription="Try widening the date range or clearing the product filter"
          />
          <div className="flex flex-col gap-3 border-t border-app-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 flex min-h-[1.25rem] items-center text-sm">
              <span
                className="inline-block h-4 w-48 max-w-[90vw] animate-pulse rounded-md bg-app-border/75 dark:bg-app-border/60 sm:w-64"
                aria-hidden
              />
            </p>
            <div className="flex shrink-0 items-center gap-2" aria-hidden>
              <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
              <span className="inline-block h-8 w-28 animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
              <span className="inline-block h-8 w-[4.5rem] animate-pulse rounded-lg bg-app-border/65 dark:bg-app-border/55" />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** Forms hub — tabs + header; list cards pulse. */
export function MarketingFormsLoadingShell({
  isMediaBuyer,
}: {
  isMediaBuyer: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tabValue: 'all' | 'mine' = isMediaBuyer || tabParam === 'mine' ? 'mine' : 'all';

  const onTabChange = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (v === 'all') next.delete('tab');
      else next.set('tab', 'mine');
      return next;
    });
  };

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Forms"
        mobileInlineActions
        description={isMediaBuyer ? 'Manage your campaign forms.' : 'Manage campaign forms.'}
        actions={
          <PageHeaderMobileTools
            sheetTitle="Forms"
            sheetSubtitle={<span>Refresh and create</span>}
            triggerAriaLabel="Forms toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button type="button" variant="primary" size="sm" disabled className="opacity-70">
                  + New Form
                </Button>
              </>
            }
            sheet={
              <Button type="button" variant="primary" size="sm" className="w-full justify-center" disabled>
                + New Form
              </Button>
            }
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Total Forms', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Active Forms', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />

      <Tabs
        value={tabValue}
        onChange={onTabChange}
        tabs={
          isMediaBuyer
            ? [{ value: 'mine', label: 'My forms' }]
            : [
                { value: 'all', label: 'All forms' },
                { value: 'mine', label: 'My forms' },
              ]
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <TableCellTextPulse className="!h-5 w-full max-w-xs" />
            <TableCellTextPulse className="w-full max-w-md" />
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="inline-block h-8 w-24 rounded-md bg-app-border/80 dark:bg-app-border/65 animate-pulse" aria-hidden />
              <span className="inline-block h-8 w-28 rounded-md bg-app-border/80 dark:bg-app-border/65 animate-pulse" aria-hidden />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const MARKETING_ORDERS_SHELL_ROWS = 8;

const MARKETING_ORDERS_SHELL_ROW_DATA = Array.from(
  { length: MARKETING_ORDERS_SHELL_ROWS },
  (_, i) => ({ id: `__marketing_orders_shell_${i}` }),
);

function marketingOrdersShellTableColumns(
  showMediaBuyerColumn: boolean,
): CompactTableColumn<{ id: string }>[] {
  const cols: CompactTableColumn<{ id: string }>[] = [
    { key: 'id', header: 'Order ID', render: () => <TableCellTextPulse className="w-[7rem]" /> },
    {
      key: 'customer',
      header: 'Customer',
      render: () => <TableCellTextPulse className="w-[9rem] max-w-[min(14rem,100%)]" />,
    },
  ];
  if (showMediaBuyerColumn) {
    cols.push({
      key: 'mediaBuyer',
      header: 'Media buyer',
      render: () => <TableCellTextPulse className="w-[7rem]" />,
    });
  }
  cols.push(
    {
      key: 'product',
      header: 'Product',
      render: () => <TableCellTextPulse className="w-[10rem] max-w-[min(16rem,100%)]" />,
    },
    {
      key: 'campaign',
      header: 'Form',
      render: () => <TableCellTextPulse className="w-[8rem]" />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      headerClassName: 'text-right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[4.5rem]" />
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: () => <TableCellTextPulse className="w-[5.5rem]" />,
    },
    {
      key: 'created',
      header: 'Created',
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      headerClassName: 'text-center',
      tight: true,
      mobileShowLabel: false,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  );
  return cols;
}

const MARKETING_ORDERS_SHELL_STATUS_OPTIONS = STATUS_OPTIONS.map((status) => ({
  value: status,
  label: status === 'ALL' ? 'All Statuses' : formatStatus(status),
}));

/**
 * Marketing orders list — PageHeader + stat strip + table pulse. Mirrors `MarketingOrdersPage`
 * chrome so the cross-route transition shell shows real labels (Total / Unprocessed / Confirmed /
 * Delivered / Delivery Rate / CPA + table headers Order ID / Customer / Product / Form / Amount /
 * Status / Created) on the same tick as the click.
 */
export function MarketingOrdersLoadingShell({
  filters,
  isMediaBuyer,
  showMediaBuyerColumn = false,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  isMediaBuyer: boolean;
  showMediaBuyerColumn?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') ?? '');
  const [selectedStatus, setSelectedStatus] = useState(() => searchParams.get('status') || 'ALL');

  useEffect(() => {
    setSearchQuery(searchParams.get('search') ?? '');
    setSelectedStatus(searchParams.get('status') || 'ALL');
  }, [searchParams]);

  const applyListParams = useCallback(
    (overrides: { page?: number; status?: string; search?: string }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (overrides.page !== undefined) {
            if (overrides.page <= 1) next.delete('page');
            else next.set('page', String(overrides.page));
          }
          if (overrides.status !== undefined) {
            if (overrides.status === 'ALL' || !overrides.status) next.delete('status');
            else next.set('status', overrides.status);
          }
          if (overrides.search !== undefined) {
            const t = overrides.search.trim();
            if (t) next.set('search', t);
            else next.delete('search');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const ordersToolbarFilterBadge = useMemo(() => {
    let n = 0;
    if (selectedStatus !== 'ALL') n += 1;
    const mb = searchParams.get('mediaBuyerId') || 'ALL';
    if (showMediaBuyerColumn && mb !== 'ALL') n += 1;
    if ((searchParams.get('productId') || '').length > 0) n += 1;
    if ((searchParams.get('campaignId') || '').length > 0) n += 1;
    return n;
  }, [selectedStatus, showMediaBuyerColumn, searchParams]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    applyListParams({ search: searchQuery, page: 1 });
  };

  const handleStatusChange = (v: string) => {
    setSelectedStatus(v);
    applyListParams({ status: v, page: 1 });
  };

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title={isMediaBuyer ? 'My Orders' : 'Marketing Orders'}
        mobileInlineActions
        description={
          isMediaBuyer
            ? 'Track your campaign orders.'
            : 'View orders by media buyer.'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Marketing orders tools"
            sheetSubtitle={<span>Date range, chart toggle, and export</span>}
            triggerAriaLabel="Orders toolbar and date range"
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" disabled>
                  View data in chart
                </Button>
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
        items={[
          { label: 'Total', value: <StatValuePulse className="min-w-[2.25rem]" /> },
          { label: 'Unprocessed', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Confirmed', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Delivered', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Delivery Rate', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'CPA', value: <StatValuePulse className="min-w-[4rem]" /> },
        ]}
      />

      <div className="card p-0 overflow-hidden">
        <ToolbarFiltersCollapsible
          className="!border-0"
          badgeCount={ordersToolbarFilterBadge}
          sheetSubtitle={<span>Status and search apply immediately</span>}
          searchRow={
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 gap-2 md:min-w-0 md:flex-1">
              <SearchInput
                placeholder="Search by customer or order ID..."
                value={searchQuery}
                onChange={(val) => {
                  setSearchQuery(val);
                  if (val === '' && (searchParams.get('search') ?? '').length > 0) {
                    applyListParams({ search: '', page: 1 });
                  }
                }}
                wrapperClassName="min-w-0 flex-1"
              />
              <Button type="submit" variant="secondary" size="sm">
                Search
              </Button>
            </form>
          }
          desktopInlineFilters={
            <>
              <FormSelect
                value={selectedStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
                options={MARKETING_ORDERS_SHELL_STATUS_OPTIONS}
                wrapperClassName="w-auto min-w-[11rem]"
              />
              {showMediaBuyerColumn ? (
                <div
                  className="h-9 w-full min-w-0 rounded-md border border-app-border bg-app-hover/90 animate-pulse sm:w-56"
                  aria-hidden
                />
              ) : null}
            </>
          }
          sheetFilterBody={
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-app-fg-muted">Status</span>
              <FormSelect
                value={selectedStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
                options={MARKETING_ORDERS_SHELL_STATUS_OPTIONS}
                wrapperClassName="w-full"
              />
            </div>
          }
        />
      </div>

      <CompactTable<{ id: string }>
        rows={MARKETING_ORDERS_SHELL_ROW_DATA}
        rowKey={(r) => r.id}
        columns={marketingOrdersShellTableColumns(showMediaBuyerColumn)}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}
