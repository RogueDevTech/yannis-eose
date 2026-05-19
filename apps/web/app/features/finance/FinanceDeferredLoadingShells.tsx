import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from '@remix-run/react';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import { shellPulsePlaceholderRows, StatValuePulse, TableCellTextPulse } from '~/components/ui/deferred-skeletons';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import { Breadcrumb } from '~/components/ui/breadcrumb';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { SearchInput } from '~/components/ui/search-input';
import { SearchableSelect } from '~/components/ui/searchable-select';
import { ToolbarFiltersCollapsible } from '~/components/ui/toolbar-filters-collapsible';
import { TableActionButton } from '~/components/ui/table-action-button';

function CashRemittanceSectionShell() {
  const tiles = [
    { title: 'Total delivered', subtitle: 'All orders' },
    { title: 'Remitted', subtitle: 'Batches received' },
    { title: 'Awaiting batch', subtitle: 'Not on a remittance' },
    { title: 'Pending batches', subtitle: 'Batches SENT' },
    { title: 'Disputed', subtitle: 'Needs attention' },
  ];
  return (
    <Card>
      <CardHeader
        title="Cash remittance"
        description="Delivered orders and remittance status."
      />
      <CardBody className="-mt-2 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {tiles.map((t) => (
            <div
              key={t.title}
              className="rounded-lg border border-app-border bg-app-hover/60 p-3 animate-pulse space-y-2"
              aria-hidden
            >
              <p className="text-xs font-medium text-app-fg-muted">{t.title}</p>
              <div className="h-7 w-24 rounded-md bg-app-hover" />
              <p className="text-xs text-app-fg-muted">{t.subtitle}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {['By product', 'By location'].map((label) => (
            <div key={label}>
              <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wide mb-2">{label}</p>
              <div className="space-y-1.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-md border border-app-border bg-app-hover/40 px-3 py-2 animate-pulse space-y-1.5" aria-hidden>
                    <div className="h-3 w-32 rounded bg-app-hover" />
                    <div className="h-1.5 w-full rounded-full bg-app-hover" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function PayrollSectionShell() {
  const tiles = [
    { title: 'Payroll awaiting Finance', subtitle: 'Batches in PENDING_FINANCE' },
    { title: 'Approval inbox', subtitle: 'Funding requests pending' },
  ];
  return (
    <Card>
      <CardHeader
        title="Payroll"
        description="Payroll batches and approval requests awaiting finance action."
      />
      <CardBody className="-mt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tiles.map((t) => (
            <div
              key={t.title}
              className="rounded-lg border border-app-border bg-app-hover/60 p-3 animate-pulse space-y-2"
              aria-hidden
            >
              <p className="text-xs font-medium text-app-fg-muted">{t.title}</p>
              <div className="h-7 w-24 rounded-md bg-app-hover" />
              <p className="text-xs text-app-fg-muted">{t.subtitle}</p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

function DisbursementSectionShell() {
  const tiles = [
    { title: 'Total disbursed', subtitle: 'All funding transfers' },
    { title: 'Pending', subtitle: 'Awaiting confirmation' },
    { title: 'Received', subtitle: 'Confirmed by recipient' },
    { title: 'Disputed', subtitle: 'Needs resolution' },
  ];
  return (
    <Card>
      <CardHeader
        title="Disbursements"
        description="Money disbursed to Head of Marketing for ad spend."
      />
      <CardBody className="-mt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.title}
              className="rounded-lg border border-app-border bg-app-hover/60 p-3 animate-pulse space-y-2"
              aria-hidden
            >
              <p className="text-xs font-medium text-app-fg-muted">{t.title}</p>
              <div className="h-7 w-24 rounded-md bg-app-hover" />
              <p className="text-xs text-app-fg-muted">{t.subtitle}</p>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

const DISBURSEMENTS_SHELL_ROWS = 6;

function disbursementsShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'when', header: 'When', render: () => <TableCellTextPulse className="w-[9rem]" /> },
    { key: 'from', header: 'From', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    { key: 'to', header: 'To', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[5rem]" />
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

/** Finance overview — matches FinancePage chrome. */
export function FinanceOverviewLoadingShell({
  filters,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Finance"
        mobileInlineActions
        description="Cash remittance, disbursements, and payroll."
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
      <Tabs
        variant="underline"
        value="remittance"
        onChange={() => {}}
        tabs={[
          { value: 'remittance', label: 'Cash remittance' },
          { value: 'disbursements', label: 'Disbursements' },
          { value: 'payroll', label: 'Payroll' },
        ]}
      />
      <CashRemittanceSectionShell />
    </div>
  );
}

type DisbMainTab = 'disbursements' | 'requests' | 'balances';

function disbMainTabFromSp(sp: URLSearchParams): DisbMainTab {
  const t = sp.get('tab');
  if (t === 'requests' || t === 'balances') return t;
  return 'disbursements';
}

const DISB_STATUS_OPTIONS = ['ALL', 'SENT', 'COMPLETED', 'DISPUTED'] as const;
const DISB_STATUS_LABELS: Record<string, string> = {
  ALL: 'All',
  SENT: 'Pending',
  COMPLETED: 'Received',
  DISPUTED: 'Disputed',
};

/** Finance → Disbursements — URL-driven tabs + filter row; stats + table pulse. */
export function FinanceDisbursementsLoadingShell({
  filters,
}: {
  filters: {
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
    status: string;
    receiver: string;
    search: string;
    balancesSearch: string;
    balancesRole: string;
    balancesStatus: string;
  };
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const mainTab = useMemo(() => disbMainTabFromSp(searchParams), [searchParams]);
  const [searchQuery, setSearchQuery] = useState(() => filters.search);
  const [balancesSearchQuery, setBalancesSearchQuery] = useState(() => filters.balancesSearch);

  useEffect(() => {
    setSearchQuery(filters.search);
  }, [filters.search]);
  useEffect(() => {
    setBalancesSearchQuery(filters.balancesSearch);
  }, [filters.balancesSearch]);

  const selectedStatus =
    filters.status && DISB_STATUS_OPTIONS.includes(filters.status as (typeof DISB_STATUS_OPTIONS)[number])
      ? filters.status
      : 'ALL';
  const selectedReceiver = filters.receiver || 'ALL';
  const receiverOptions = useMemo(() => {
    const base = [{ value: 'ALL', label: 'All recipients' }];
    if (selectedReceiver !== 'ALL') {
      base.push({ value: selectedReceiver, label: 'Selected recipient' });
    }
    return base;
  }, [selectedReceiver]);

  const balancesRoleFilter = filters.balancesRole || 'ALL';
  const balancesStatusFilter = filters.balancesStatus || 'ALL';

  const setMainTab = useCallback(
    (tab: DisbMainTab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'disbursements') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleStatusChange = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (!v || v === 'ALL') next.delete('status');
      else next.set('status', v);
      return next;
    });
  };

  const handleReceiverChange = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      if (!v || v === 'ALL') next.delete('receiver');
      else next.set('receiver', v);
      return next;
    });
  };

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', '1');
      const q = searchQuery.trim();
      if (q) next.set('search', q);
      else next.delete('search');
      return next;
    });
  };

  const handleBalancesSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('balancesPage', '1');
      const q = balancesSearchQuery.trim();
      if (q) next.set('balancesSearch', q);
      else next.delete('balancesSearch');
      return next;
    });
  };

  const handleBalancesRoleChange = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('balancesPage', '1');
      if (!v || v === 'ALL') next.delete('balancesRole');
      else next.set('balancesRole', v);
      return next;
    });
  };

  const handleBalancesStatusChange = (v: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('balancesPage', '1');
      if (!v || v === 'ALL') next.delete('balancesStatus');
      else next.set('balancesStatus', v);
      return next;
    });
  };

  const rows = shellPulsePlaceholderRows('fin_disb', DISBURSEMENTS_SHELL_ROWS);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Disbursements"
        mobileInlineActions
        description="Send and track marketing disbursements."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Disbursements tools"
            sheetSubtitle={<span>Date range and actions</span>}
            triggerAriaLabel="Disbursements toolbar"
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
                <Button type="button" variant="secondary" size="sm" disabled>
                  Generate report
                </Button>
                <Button type="button" variant="primary" size="sm" disabled>
                  + New disbursement
                </Button>
              </>
            }
            sheet={() => (
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" className="w-full justify-center" disabled>
                  Generate report
                </Button>
                <Button type="button" variant="primary" size="sm" className="w-full justify-center" disabled>
                  + New disbursement
                </Button>
              </>
            )}
          />
        }
      />
      <OverviewStatStrip
        items={[
          { label: 'Total disbursed', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Pending', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Pending Requests', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Received', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Disputed', value: <StatValuePulse className="min-w-[3rem]" /> },
        ]}
      />
      <div className="card p-0">
        <div className="px-4 pt-2">
          <Tabs
            variant="underline"
            value={mainTab}
            onChange={(v) => setMainTab(v as DisbMainTab)}
            tabs={[
              { value: 'disbursements', label: 'Disbursements' },
              { value: 'requests', label: 'Funding requests' },
              { value: 'balances', label: 'Recipient balances' },
            ]}
          />
        </div>
      </div>

      {mainTab === 'disbursements' ? (
        <div className="card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form onSubmit={handleSearchSubmit} className="flex min-w-0 flex-1 gap-2">
              <SearchInput
                type="search"
                value={searchQuery}
                onChange={(v) => setSearchQuery(v)}
                placeholder="Search by sender, receiver, or ID…"
                controlSize="sm"
                clearable
                withSubmitButton
                wrapperClassName="min-w-0 flex-1"
                aria-label="Search disbursements"
              />
            </form>
            <FormSelect
              id="disbursement-status-filter-shell"
              value={selectedStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              options={DISB_STATUS_OPTIONS.map((s) => ({ value: s, label: DISB_STATUS_LABELS[s] ?? s }))}
              controlSize="sm"
              wrapperClassName="w-full sm:w-44"
              aria-label="Filter by status"
            />
            <SearchableSelect
              id="disbursement-recipient-filter-shell"
              value={selectedReceiver}
              onChange={handleReceiverChange}
              options={receiverOptions}
              controlSize="sm"
              wrapperClassName="w-full min-w-0 sm:w-52"
              searchPlaceholder="Search recipients…"
              placeholder="All recipients"
            />
          </div>
        </div>
      ) : null}

      {mainTab === 'balances' ? (
        <div className="card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form onSubmit={handleBalancesSearchSubmit} className="flex min-w-0 flex-1 gap-2">
              <SearchInput
                type="search"
                value={balancesSearchQuery}
                onChange={(v) => setBalancesSearchQuery(v)}
                placeholder="Search recipient name…"
                controlSize="sm"
                clearable
                withSubmitButton
                wrapperClassName="min-w-0 flex-1"
                aria-label="Search recipient balances"
              />
            </form>
            <FormSelect
              id="balances-role-filter-shell"
              value={balancesRoleFilter}
              onChange={(e) => handleBalancesRoleChange(e.target.value)}
              options={[
                { value: 'ALL', label: 'All roles' },
                { value: 'HEAD_OF_MARKETING', label: 'Head of Marketing' },
                { value: 'MEDIA_BUYER', label: 'Media Buyer' },
              ]}
              controlSize="sm"
              wrapperClassName="w-full sm:w-52"
              aria-label="Filter balances by role"
            />
            <FormSelect
              id="balances-status-filter-shell"
              value={balancesStatusFilter}
              onChange={(e) => handleBalancesStatusChange(e.target.value)}
              options={[
                { value: 'ALL', label: 'All balances' },
                { value: 'POSITIVE', label: 'Positive' },
                { value: 'ZERO', label: 'Zero' },
                { value: 'NEGATIVE', label: 'Negative' },
              ]}
              controlSize="sm"
              wrapperClassName="w-full sm:w-48"
              aria-label="Filter by balance status"
            />
          </div>
        </div>
      ) : null}

      <div className="list-panel">
        <CompactTable<{ id: string }>
          withCard={false}
          columns={disbursementsShellColumns()}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}

const DELIVERY_REMITTANCES_LIST_SHELL_ROWS = 8;
const DELIVERY_REMITTANCES_ELIGIBLE_SHELL_ROWS = 8;

function deliveryRemittancesListShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'id', header: 'ID', tight: true, render: () => <TableCellTextPulse className="w-[4.5rem]" /> },
    { key: 'location', header: 'Location', render: () => <TableCellTextPulse className="w-[14rem]" /> },
    { key: 'sentBy', header: 'Sent by', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    {
      key: 'orderCount',
      header: 'Orders',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[2rem]" />
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Batch total',
      align: 'right',
      nowrap: true,
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[5.5rem]" />
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5.5rem]" /> },
    { key: 'sentAt', header: 'Sent at', nowrap: true, render: () => <TableCellTextPulse className="w-[7rem]" /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: () => <CompactTableActionButton disabled>Review</CompactTableActionButton>,
    },
  ];
}

function deliveryRemittanceEligibleShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'invoice', header: 'Invoice', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    { key: 'billTo', header: 'Bill to', render: () => <TableCellTextPulse className="w-[12rem]" /> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      nowrap: true,
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[5rem]" />
        </span>
      ),
    },
    { key: 'location', header: 'Location', render: () => <TableCellTextPulse className="w-[12rem]" /> },
    { key: 'delivered', header: 'Delivered', nowrap: true, render: () => <TableCellTextPulse className="w-[9rem]" /> },
    {
      key: 'invoiceActions',
      header: '',
      align: 'right',
      nowrap: true,
      render: () => (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <TableActionButton variant="primary" disabled className="opacity-60">
            View Invoice
          </TableActionButton>
          <TableActionButton variant="neutral" disabled className="opacity-60">
            Download
          </TableActionButton>
        </div>
      ),
    },
  ];
}

/** Cash remittances list — URL tabs + filters; stats pulse; tables show real headers + row pulses. */
export function DeliveryRemittancesLoadingShell({
  filters,
  canCreateRemittance = false,
}: {
  filters: {
    status: string;
    location: string;
    sentBy: string;
    startDate: string;
    endDate: string;
    periodAllTime: boolean;
    eligibleQ: string;
  };
  /** Mirrors loaded page — hides Confirm remittance when the actor cannot create. */
  canCreateRemittance?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const viewTab = searchParams.get('tab') === 'remittances' ? 'remittances' : 'eligible';
  const [eligibleDraft, setEligibleDraft] = useState(() => filters.eligibleQ);

  useEffect(() => {
    setEligibleDraft(filters.eligibleQ);
  }, [filters.eligibleQ]);

  const setViewTab = useCallback(
    (tab: 'remittances' | 'eligible') => {
      setSearchParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.set('page', '1');
          if (tab === 'remittances') next.set('tab', 'remittances');
          else next.delete('tab');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleLocationChange = useCallback(
    (locationId: string) => {
      setSearchParams((p) => {
        const next = new URLSearchParams(p);
        next.set('page', '1');
        next.set('eligiblePage', '1');
        if (!locationId) next.delete('location');
        else next.set('location', locationId);
        return next;
      });
    },
    [setSearchParams],
  );

  const handleSentByChange = useCallback(
    (userId: string) => {
      setSearchParams((p) => {
        const next = new URLSearchParams(p);
        next.set('page', '1');
        if (!userId) next.delete('sentBy');
        else next.set('sentBy', userId);
        return next;
      });
    },
    [setSearchParams],
  );

  const commitEligibleQ = useCallback(() => {
    const trimmed = eligibleDraft.trim();
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set('eligiblePage', '1');
      if (!trimmed) next.delete('q');
      else next.set('q', trimmed);
      return next;
    });
  }, [eligibleDraft, setSearchParams]);

  const locationPickOptions = useMemo(() => {
    const base = [{ value: '', label: 'All locations' }];
    if (filters.location) {
      base.push({ value: filters.location, label: 'Selected location' });
    }
    return base;
  }, [filters.location]);

  const sentByPickOptions = useMemo(() => {
    const base = [{ value: '', label: 'Sent by anyone' }];
    if (filters.sentBy) {
      base.push({ value: filters.sentBy, label: 'Selected accountant' });
    }
    return base;
  }, [filters.sentBy]);

  const remittanceToolbarBadge = (filters.location ? 1 : 0) + (filters.sentBy ? 1 : 0);

  const listShellRows = useMemo(
    () => shellPulsePlaceholderRows('dr-rem-list', DELIVERY_REMITTANCES_LIST_SHELL_ROWS),
    [],
  );
  const eligibleShellRows = useMemo(
    () => shellPulsePlaceholderRows('dr-rem-elig', DELIVERY_REMITTANCES_ELIGIBLE_SHELL_ROWS),
    [],
  );
  const listShellColumns = useMemo(() => deliveryRemittancesListShellColumns(), []);
  const eligibleShellColumns = useMemo(() => deliveryRemittanceEligibleShellColumns(), []);

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Cash Remittances"
        mobileInlineActions
        description="Review and record cash remittances."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Cash remittances tools"
            sheetSubtitle={<span>Date range, export, and pick orders</span>}
            triggerAriaLabel="Cash remittances toolbar and date range"
            desktop={
              <>
                <div className="flex min-h-[2rem] items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                  />
                </div>
                <PageRefreshButton />
                <Button type="button" variant="secondary" size="sm" disabled className="opacity-70">
                  Generate report
                </Button>
              </>
            }
            sheet={() => (
              <>
                <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                  <DateFilterBar
                    startDate={filters.startDate}
                    endDate={filters.endDate}
                    periodAllTime={filters.periodAllTime}
                    triggerLayout="blockCenter"
                  />
                </div>
                <Button type="button" variant="secondary" size="sm" className="w-full justify-center" disabled>
                  Generate report
                </Button>
              </>
            )}
          />
        }
      />

      <OverviewStatStrip
        items={[
          { label: 'Expected (awaiting)', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Total on batches', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Pending', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Received', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Disputed', value: <StatValuePulse className="min-w-[3rem]" /> },
        ]}
      />

      <Tabs
        variant="underline"
        value={viewTab}
        onChange={(v) => setViewTab(v as 'remittances' | 'eligible')}
        tabs={[
          { value: 'eligible', label: 'Awaiting remittance' },
          { value: 'remittances', label: 'Remitted' },
        ]}
      />

      {viewTab === 'remittances' ? (
        <>
          <div className="list-panel">
            <ToolbarFiltersCollapsible
              className="!border-0"
              hideMobileSheet
              badgeCount={remittanceToolbarBadge}
              sheetSubtitle={<span>Location and sent-by apply immediately</span>}
              desktopInlineFilters={
                <>
                  <SearchableSelect
                    id="delivery-remittance-location-filter-shell"
                    value={filters.location}
                    onChange={handleLocationChange}
                    wrapperClassName="w-full min-w-0 sm:w-52"
                    placeholder="All locations"
                    searchPlaceholder="Search locations…"
                    options={locationPickOptions}
                  />
                  <SearchableSelect
                    id="delivery-remittance-sent-by-filter-shell"
                    value={filters.sentBy}
                    onChange={handleSentByChange}
                    wrapperClassName="w-full min-w-0 sm:w-56"
                    placeholder="Sent by anyone"
                    searchPlaceholder="Search accountants…"
                    options={sentByPickOptions}
                  />
                </>
              }
              sheetFilterBody={
                <>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Location</span>
                    <SearchableSelect
                      id="delivery-remittance-location-filter-sheet-shell"
                      value={filters.location}
                      onChange={handleLocationChange}
                      wrapperClassName="w-full"
                      placeholder="All locations"
                      searchPlaceholder="Search locations…"
                      options={locationPickOptions}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-app-fg-muted">Sent by</span>
                    <SearchableSelect
                      id="delivery-remittance-sent-by-filter-sheet-shell"
                      value={filters.sentBy}
                      onChange={handleSentByChange}
                      wrapperClassName="w-full"
                      placeholder="Sent by anyone"
                      searchPlaceholder="Search accountants…"
                      options={sentByPickOptions}
                    />
                  </div>
                </>
              }
            />
          </div>
          {/* Pills skeleton — keeps the layout aligned with the loaded state,
              which renders <FilterPills /> for All/Pending/Received/Disputed. */}
          <div className="flex gap-1.5">
            {['All', 'Pending', 'Received', 'Disputed'].map((label) => (
              <div
                key={label}
                className="h-7 w-20 rounded-full border border-app-border bg-app-hover/40 animate-pulse"
              />
            ))}
          </div>
          <CompactTable<{ id: string }>
            caption="Cash remittance batches"
            columns={listShellColumns}
            rows={listShellRows}
            rowKey={(r) => r.id}
            emptyTitle="Loading remittances…"
            emptyDescription=""
            pagination={{
              page: 1,
              totalPages: 1,
              pageParam: 'page',
              showWhenSinglePage: true,
              summary: <span className="text-app-fg-muted">Loading…</span>,
            }}
          />
        </>
      ) : null}

      {viewTab === 'eligible' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <form
              className="min-w-0"
              onSubmit={(e) => {
                e.preventDefault();
                commitEligibleQ();
              }}
            >
              <SearchInput
                value={eligibleDraft}
                onChange={(v) => setEligibleDraft(v)}
                placeholder="Search customer, order ID, invoice ref, or bill-to name"
                controlSize="md"
                withSubmitButton
                wrapperClassName="w-full"
              />
            </form>
            <FormSelect
              id="eligible-remittance-location-shell"
              aria-label="Filter by logistics location"
              value={filters.location}
              onChange={(e) => handleLocationChange(e.target.value)}
              placeholder="All locations"
              options={locationPickOptions}
              controlSize="md"
              wrapperClassName="w-full"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-app-hover px-2.5 py-2 sm:px-3">
            <div className="text-xs text-app-fg-muted sm:text-sm">
              <span className="font-medium text-app-fg">0</span> selected
              <span className="text-app-fg-muted"> · </span>
              <span>Loading…</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <StatValuePulse className="min-w-[4rem]" />
              {canCreateRemittance ? (
                <Button type="button" variant="primary" size="sm" disabled className="opacity-70">
                  Confirm
                </Button>
              ) : null}
            </div>
          </div>

          <CompactTable<{ id: string }>
            caption="Delivered orders awaiting remittance"
            className="[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-[1] [&_thead]:bg-app-hover"
            columns={eligibleShellColumns}
            rows={eligibleShellRows}
            rowKey={(r) => r.id}
            emptyTitle="Loading orders…"
            emptyDescription=""
            pagination={{
              page: 1,
              totalPages: 1,
              pageParam: 'eligiblePage',
              showWhenSinglePage: true,
              summary: <span className="text-app-fg-muted">Loading…</span>,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Cash remittance detail — mirrors `DeliveryRemittanceDetailPage` 1:1 so static
 * chrome (breadcrumb, page title, section headings, table column headers, the
 * "Remittance total" label + helper) is visible immediately. Only the
 * data-dependent slots pulse — status badge, sent timestamp, batch ID,
 * location, recorded-by, marked-received, the total amount, and table rows.
 */
const REMITTANCE_ORDER_SHELL_ROWS = 4;

function remittanceOrderShellColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'customer', header: 'Customer', render: () => <TableCellTextPulse className="w-[10rem]" /> },
    { key: 'orderId', header: 'Order', render: () => <TableCellTextPulse className="w-[7rem]" /> },
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5.5rem]" /> },
    {
      key: 'delivered',
      header: 'Delivered',
      nowrap: true,
      render: () => <TableCellTextPulse className="w-[9rem]" />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[5rem]" />
        </span>
      ),
    },
    {
      key: 'invoice',
      header: 'Invoice',
      nowrap: true,
      render: () => <TableCellTextPulse className="w-[7rem]" />,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

export function DeliveryRemittanceDetailLoadingShell({ remittanceId }: { remittanceId: string }) {
  const orderRows = shellPulsePlaceholderRows('remittance-order', REMITTANCE_ORDER_SHELL_ROWS);
  const orderColumns = remittanceOrderShellColumns();

  return (
    <div className="space-y-5 w-full min-w-0" aria-busy="true" aria-live="polite">
      {/* Breadcrumb — first 2 crumbs static, current page is a pulse since the
          batch reference is dynamic. */}
      <Breadcrumb
        className="mb-1"
        items={[
          { label: 'Finance', to: '/admin/finance/overview' },
          { label: 'Cash remittances', to: '/admin/finance/delivery-remittances' },
          {
            label: (
              <span
                className="inline-block h-4 w-32 align-middle rounded bg-app-border/75 dark:bg-app-border/55 animate-pulse"
                title={remittanceId}
              />
            ) as unknown as string,
          },
        ]}
      />

      <PageHeader
        title="Cash remittance"
        mobileInlineActions
        description={
          (
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm text-app-fg-muted">
              <span className="inline-block h-4 w-36 rounded bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
              <span className="text-app-fg-muted">·</span>
              <span className="inline-block h-4 w-20 rounded bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
              <span className="text-app-fg-muted">·</span>
              <span className="inline-block h-4 w-16 rounded bg-app-border/65 dark:bg-app-border/55 animate-pulse" />
            </span>
          ) as unknown as string
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="Cash remittance tools"
            sheetSubtitle={<span>Refresh and navigation</span>}
            triggerAriaLabel="Cash remittance toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <span
                  className="inline-block h-8 w-28 rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse"
                  aria-hidden
                />
              </>
            }
            sheet={
              <span
                className="inline-block h-9 w-full rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse"
                aria-hidden
              />
            }
          />
        }
      />

      {/* Header card — status + metadata row (single row to mirror the real
          page), remittance total. Labels stay readable; values pulse. */}
      <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span
            className="inline-block h-6 w-20 rounded-full bg-app-border/65 dark:bg-app-border/55 animate-pulse"
            aria-hidden
          />
          <span className="text-app-fg-muted">
            <span>Sent </span>
            <TableCellTextPulse className="w-[10rem]" />
          </span>
          <span className="h-3 w-px bg-app-border" aria-hidden />
          <span className="text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Batch ID</span>{' '}
            <TableCellTextPulse className="w-[8rem]" />
          </span>
          <span className="h-3 w-px bg-app-border" aria-hidden />
          <span className="text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Location</span>{' '}
            <TableCellTextPulse className="w-[10rem]" />
          </span>
          <span className="h-3 w-px bg-app-border" aria-hidden />
          <span className="text-app-fg-muted">
            <span className="font-medium text-app-fg-muted/80">Recorded by</span>{' '}
            <TableCellTextPulse className="w-[7rem]" />
          </span>
        </div>
        <div className="pt-1 border-t border-app-border">
          <p className="text-xs font-medium text-brand-600 dark:text-brand-400 uppercase tracking-wider">
            Remittance total
          </p>
          <p className="mt-1">
            <span className="inline-block h-8 w-32 rounded-md bg-brand-100 dark:bg-brand-900/30 animate-pulse" aria-hidden />
          </p>
          <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">Sum of linked order(s)</p>
        </div>
      </div>

      {/* Receipts — heading visible, list slot pulses. */}
      <div className="rounded-xl border border-app-border bg-app-elevated p-5 shadow-sm space-y-3">
        <h2 className="text-base font-semibold text-app-fg">Receipts</h2>
        <div className="h-4 w-32 rounded bg-app-border/65 dark:bg-app-border/55 animate-pulse" aria-hidden />
      </div>

      {/* Orders in this batch — section heading + count pulse + table headers
          rendered, rows pulse. */}
      <div className="space-y-2">
        <div className="px-1">
          <h2 className="text-base font-semibold text-app-fg">Orders in this batch</h2>
          <p className="text-sm text-app-fg-muted mt-0.5">
            <span className="inline-block h-3.5 w-16 rounded bg-app-border/65 dark:bg-app-border/55 animate-pulse align-middle" aria-hidden />
            <span> linked order(s)</span>
          </p>
        </div>
        <CompactTable
          caption="Orders linked to this cash remittance"
          columns={orderColumns}
          rows={orderRows}
          rowKey={(o) => o.id}
          emptyTitle="Loading…"
          emptyDescription=""
        />
      </div>
    </div>
  );
}

/** Finance payout — URL-driven status pills; stats + batch cards pulse. */
export function FinancePayoutLoadingShell({
  status: _statusShell,
}: {
  status: '' | 'PENDING_FINANCE' | 'PAID';
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('status');
  const active: '' | 'PAID' | 'PENDING_FINANCE' =
    raw === 'PAID' || raw === 'PENDING_FINANCE' ? raw : '';

  const setFilter = (next: '' | 'PAID' | 'PENDING_FINANCE') => {
    setSearchParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (!next) n.delete('status');
        else n.set('status', next);
        return n;
      },
      { replace: true },
    );
  };

  const pillClass = (v: '' | 'PAID' | 'PENDING_FINANCE') =>
    [
      'rounded-full px-4 py-2 text-sm font-medium border transition-colors',
      active === v
        ? 'border-brand-500 bg-brand-500 text-white shadow-sm'
        : 'border-app-border bg-app-elevated text-app-fg hover:bg-app-hover',
    ].join(' ');

  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Payout"
        mobileInlineActions
        description="Review payroll payout batches."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Payout tools"
            sheetSubtitle={<span>Refresh and export</span>}
            triggerAriaLabel="Payout toolbar"
            desktop={
              <>
                <PageRefreshButton />
                <Button type="button" variant="secondary" size="sm" disabled>
                  Export payout document
                </Button>
              </>
            }
            sheet={<Button type="button" variant="secondary" size="sm" className="w-full justify-center" disabled>Export payout document</Button>}
          />
        }
      />
      <OverviewStatStrip
        items={[
          { label: 'Pending finance', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Paid', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Batches', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by payout status">
        <button type="button" className={pillClass('')} onClick={() => setFilter('')}>
          All
        </button>
        <button type="button" className={pillClass('PENDING_FINANCE')} onClick={() => setFilter('PENDING_FINANCE')}>
          Pending finance
        </button>
        <button type="button" className={pillClass('PAID')} onClick={() => setFilter('PAID')}>
          Paid
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card p-4 space-y-3 animate-pulse">
            <div className="h-5 w-full max-w-xs rounded bg-app-hover" aria-hidden />
            <div className="h-3 w-full rounded bg-app-hover" aria-hidden />
            <div className="h-8 w-24 rounded bg-app-hover" aria-hidden />
          </div>
        ))}
      </div>
    </div>
  );
}
