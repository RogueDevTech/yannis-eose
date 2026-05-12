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
        mobileInlineActions
        description="Review and record cash remittances."
        actions={
          <PageHeaderMobileTools
            sheetTitle="Cash remittances tools"
            sheetSubtitle={<span>Date range, export, and pick orders</span>}
            triggerAriaLabel="Cash remittances toolbar and date range"
            desktop={<PageRefreshButton />}
            sheet={
              <>
                <div className="h-9 w-full rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" aria-hidden />
                <div className="h-9 w-full rounded-md bg-app-border/55 dark:bg-app-border/45 animate-pulse" aria-hidden />
              </>
            }
          />
        }
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
    { key: 'orderId', header: 'Order ID', render: () => <TableCellTextPulse className="w-[7rem]" /> },
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
    { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5.5rem]" /> },
    {
      key: 'delivered',
      header: 'Delivered',
      nowrap: true,
      render: () => <TableCellTextPulse className="w-[9rem]" />,
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
      <div className="rounded-xl border border-app-border bg-app-elevated p-0 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-app-border">
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
          withCard={false}
          className="min-w-[720px]"
          emptyTitle="Loading…"
          emptyDescription=""
        />
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
