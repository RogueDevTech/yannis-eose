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

const FINANCE_OVERVIEW_STRIP = [
  { label: 'Revenue', value: <StatValuePulse className="min-w-[3.5rem]" /> },
  { label: 'True Profit', value: <StatValuePulse className="min-w-[3.5rem]" /> },
  { label: 'Net Margin', value: <StatValuePulse className="min-w-[2.5rem]" /> },
  { label: 'Total Costs', value: <StatValuePulse className="min-w-[3.5rem]" /> },
  { label: 'AOV', value: <StatValuePulse className="min-w-[3rem]" /> },
  { label: 'Cost / Order', value: <StatValuePulse className="min-w-[3rem]" /> },
  { label: 'Profit / Order', value: <StatValuePulse className="min-w-[3rem]" /> },
];

function FinanceOverviewPulseRailShell() {
  const tiles = [
    { title: 'Awaiting cash batch', subtitle: 'Delivered orders not on a remittance' },
    { title: 'Pending remittance batches', subtitle: 'Batches still SENT' },
    { title: 'Disputed remittances', subtitle: 'Needs attention' },
    { title: 'Payroll awaiting Finance', subtitle: 'Batches in PENDING_FINANCE' },
    { title: 'Approval inbox', subtitle: 'Funding requests pending' },
  ];
  return (
    <Card>
      <CardHeader
        title="Cash & close queue"
        description="Live operational signals — not filtered by the profit date range above."
      />
      <CardBody className="-mt-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
      <OverviewStatStrip items={FINANCE_OVERVIEW_STRIP} />
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="card p-4 space-y-2 animate-pulse">
            <div className="h-4 w-24 rounded bg-app-hover" aria-hidden />
            <div className="h-8 w-20 rounded bg-app-hover" aria-hidden />
          </div>
        ))}
      </div>
      <div className="card p-4 space-y-3 animate-pulse">
        <div className="h-6 w-48 rounded bg-app-hover" aria-hidden />
        <div className="h-64 rounded-lg bg-app-hover" aria-hidden />
      </div>
      <FinanceOverviewPulseRailShell />
    </div>
  );
}

/** Finance → Disbursements — header, date, tab strip, table pulse. */
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
  const rows = shellPulsePlaceholderRows('fin_disb', DISBURSEMENTS_SHELL_ROWS);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Disbursements"
        description="Send funding to the Head of Marketing and approve funding requests from the marketing team."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Disbursements tools"
            sheetSubtitle={<span>Date range</span>}
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
      <OverviewStatStrip
        items={[
          { label: 'Total disbursed', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Pending', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Pending Requests', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Received', value: <StatValuePulse className="min-w-[3rem]" /> },
          { label: 'Disputed', value: <StatValuePulse className="min-w-[3rem]" /> },
        ]}
      />
      <Tabs
        variant="underline"
        value="disbursements"
        onChange={() => {}}
        tabs={[
          { value: 'disbursements', label: 'Disbursements' },
          { value: 'requests', label: 'Funding requests' },
          { value: 'balances', label: 'Recipient balances' },
        ]}
      />
      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-app-border flex gap-2 flex-wrap">
          <div className="h-9 flex-1 min-w-[8rem] max-w-xs rounded-lg bg-app-hover animate-pulse" aria-hidden />
          <div className="h-9 w-36 rounded-lg bg-app-hover animate-pulse" aria-hidden />
        </div>
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

/** Cash remittances list — filters + dual panels pulse. */
export function DeliveryRemittancesLoadingShell({
  filters,
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
}) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Cash Remittances"
        description="Use Remittances for batches you already recorded, or Awaiting remittance to pick delivered orders and record cash against one logistics location."
        actions={<PageRefreshButton />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-h-[2rem] items-center rounded-md border border-app-border bg-app-hover py-1 pl-2.5 pr-2">
          <DateFilterBar
            startDate={filters.startDate}
            endDate={filters.endDate}
            periodAllTime={filters.periodAllTime}
          />
        </div>
        <div className="h-9 w-32 rounded-lg bg-app-hover animate-pulse" aria-hidden />
        <div className="h-9 w-40 rounded-lg bg-app-hover animate-pulse" aria-hidden />
      </div>
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
        value="ALL"
        onChange={() => {}}
        tabs={[
          { value: 'ALL', label: 'All' },
          { value: 'SENT', label: 'Pending' },
          { value: 'RECEIVED', label: 'Received' },
          { value: 'DISPUTED', label: 'Disputed' },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4 space-y-2 min-h-[240px] animate-pulse">
          <div className="h-5 w-40 rounded bg-app-hover" aria-hidden />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded bg-app-hover/80" aria-hidden />
          ))}
        </div>
        <div className="card p-4 space-y-2 min-h-[240px] animate-pulse">
          <div className="h-5 w-48 rounded bg-app-hover" aria-hidden />
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded bg-app-hover/80" aria-hidden />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Cash remittance detail — breadcrumb row + detail card pulse. */
export function DeliveryRemittanceDetailLoadingShell({ remittanceId }: { remittanceId: string }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-app-fg-muted">
        <div className="h-4 w-32 rounded bg-app-hover animate-pulse" aria-hidden />
        <span>/</span>
        <div
          className="h-4 w-48 rounded bg-app-hover animate-pulse"
          aria-hidden
          title={remittanceId}
        />
      </div>
      <div className="card p-6 space-y-4 animate-pulse">
        <div className="h-8 w-64 rounded bg-app-hover" aria-hidden />
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-24 rounded bg-app-hover" aria-hidden />
              <div className="h-5 w-full rounded bg-app-hover" aria-hidden />
            </div>
          ))}
        </div>
        <div className="h-40 rounded-lg bg-app-hover" aria-hidden />
      </div>
    </div>
  );
}

/** Finance payout — filter pills + batch list pulse. */
export function FinancePayoutLoadingShell({
  status,
}: {
  status: '' | 'PENDING_FINANCE' | 'PAID';
}) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Payout"
        description="Review monthly payroll batches pending finance disbursement and export payout documents."
        actions={<PageRefreshButton />}
      />
      <OverviewStatStrip
        items={[
          { label: 'Pending finance', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Paid', value: <StatValuePulse className="min-w-[3.5rem]" /> },
          { label: 'Batches', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <div
          className={`h-9 w-24 rounded-full animate-pulse ${status === '' ? 'bg-brand-500/30' : 'bg-app-hover'}`}
          aria-hidden
        />
        <div
          className={`h-9 w-40 rounded-full animate-pulse ${status === 'PENDING_FINANCE' ? 'bg-brand-500/30' : 'bg-app-hover'}`}
          aria-hidden
        />
        <div
          className={`h-9 w-20 rounded-full animate-pulse ${status === 'PAID' ? 'bg-brand-500/30' : 'bg-app-hover'}`}
          aria-hidden
        />
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
