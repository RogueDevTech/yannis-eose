import type { ReactNode } from 'react';
import { DateFilterBar } from '~/components/ui/date-filter-bar';
import {
  CompactTable,
  CompactTableActionButton,
  type CompactTableColumn,
} from '~/components/ui/compact-table';
import {
  shellPulsePlaceholderRows,
  StatValuePulse,
  TableCellTextPulse,
} from '~/components/ui/deferred-skeletons';
import { LiveIndicator } from '~/components/ui/live-indicator';
import { OverviewStatStrip } from '~/components/ui/overview-stat-strip';
import { PageHeader } from '~/components/ui/page-header';
import { PageHeaderMobileTools } from '~/components/ui/page-header-mobile-tools';
import { PageRefreshButton } from '~/components/ui/page-refresh-button';
import { Tabs } from '~/components/ui/tabs';
import type { Order } from '~/features/orders/types';
import { STATUS_OPTIONS, formatStatus } from '~/features/shared/order-status';

const CS_ORDER_STAT_KEYS = STATUS_OPTIONS.filter((s) => s !== 'ALL');

export function csOrdersStatPulseStripItems(): { label: string; value: ReactNode }[] {
  return [
    { label: 'Total', value: <StatValuePulse className="min-w-[2.25rem]" /> },
    ...CS_ORDER_STAT_KEYS.map((status) => ({
      label: formatStatus(status),
      value: <StatValuePulse className="min-w-[2rem]" />,
    })),
  ];
}

const CS_ORDERS_SHELL_ROWS = 8;

function csOrdersShellPlaceholderRows(): Order[] {
  return Array.from({ length: CS_ORDERS_SHELL_ROWS }, (_, i) => ({
    id: `__cs_orders_shell_${i}`,
    customerName: '',
    customerPhoneDisplay: '',
    status: 'UNPROCESSED',
    totalAmount: null,
    createdAt: '1970-01-01T00:00:00.000Z',
    assignedCsId: null,
  }));
}

const CS_ORDERS_SHELL_ROW_DATA = csOrdersShellPlaceholderRows();

function csOrdersShellTableColumns(
  showCSAgentColumn: boolean,
  showCampaignColumn: boolean,
): CompactTableColumn<Order>[] {
  const cols: CompactTableColumn<Order>[] = [
    {
      key: 'orderId',
      header: 'Order ID',
      render: () => <TableCellTextPulse className="w-[7rem]" />,
    },
    {
      key: 'customer',
      header: 'Customer',
      render: () => <TableCellTextPulse className="w-[9rem] max-w-[min(14rem,100%)]" />,
    },
  ];
  if (showCSAgentColumn) {
    cols.push({
      key: 'closer',
      header: 'Assigned closer',
      render: () => <TableCellTextPulse className="w-[8rem]" />,
    });
  }
  cols.push({
    key: 'product',
    header: 'Product',
    render: () => <TableCellTextPulse className="w-[10rem] max-w-[min(16rem,100%)]" />,
  });
  if (showCampaignColumn) {
    cols.push({
      key: 'campaign',
      header: 'Form',
      render: () => <TableCellTextPulse className="w-[8rem]" />,
    });
  }
  cols.push(
    {
      key: 'status',
      header: 'Status',
      render: () => <TableCellTextPulse className="w-[5.5rem]" />,
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

const CST_TEAM_SHELL_ROWS = 8;

function csTeamShellTableColumns(): CompactTableColumn<{ id: string }>[] {
  return [
    { key: 'member', header: 'Member', render: () => <TableCellTextPulse className="w-[10rem]" /> },
    { key: 'workload', header: 'Workload', render: () => <TableCellTextPulse className="w-[6rem]" /> },
    { key: 'activity', header: 'Activity', render: () => <TableCellTextPulse className="w-[8rem]" /> },
    {
      key: 'assigned',
      header: 'Assigned',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'delivered',
      header: 'Delivered',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'confirmed',
      header: 'Confirmed',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3rem]" />
        </span>
      ),
    },
    {
      key: 'confRate',
      header: 'Conf. rate',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3.5rem]" />
        </span>
      ),
    },
    {
      key: 'deliveryRate',
      header: 'Delivery rate',
      align: 'right',
      render: () => (
        <span className="inline-flex w-full justify-end">
          <TableCellTextPulse className="w-[3.5rem]" />
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'center',
      tight: true,
      render: () => <CompactTableActionButton disabled>View</CompactTableActionButton>,
    },
  ];
}

/** CS orders list — mirrors OrdersListPage chrome (date strip, live dot, stat labels, chart shell, table pulses). */
export function CSOrdersLoadingShell({
  filters,
  isCSAgent,
  liveEvents,
  showCSAgentColumn = false,
  showCampaignColumn = false,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  isCSAgent: boolean;
  liveEvents?: string[];
  showCSAgentColumn?: boolean;
  showCampaignColumn?: boolean;
}) {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title={isCSAgent ? 'My Orders' : 'CS Orders'}
        description={
          isCSAgent ? 'Your assigned orders and pipeline' : 'All customer orders for the CS team'
        }
        actions={
          <PageHeaderMobileTools
            sheetTitle="CS orders tools"
            sheetSubtitle={<span>Date range, chart, export</span>}
            triggerAriaLabel="CS orders toolbar"
            mobileLeading={
              liveEvents != null && liveEvents.length > 0 ? (
                <LiveIndicator isConnected={false} showGreen={false} />
              ) : null
            }
            desktop={
              <>
                {liveEvents != null && liveEvents.length > 0 && (
                  <LiveIndicator isConnected={false} showGreen={false} />
                )}
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
      <OverviewStatStrip items={csOrdersStatPulseStripItems()} />

      {isCSAgent ? (
        <div className="card animate-pulse space-y-3" aria-hidden>
          <div className="h-4 w-28 rounded bg-app-hover" />
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-app-hover shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-40 rounded bg-app-hover" />
              <div className="h-3 w-52 rounded bg-app-hover" />
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-app-hover" />
        </div>
      ) : null}

      <div className="h-10 w-full max-w-md rounded-lg border border-app-border bg-app-hover animate-pulse mb-2" aria-hidden />
      <CompactTable<Order>
        rows={CS_ORDERS_SHELL_ROW_DATA}
        rowKey={(o) => o.id}
        columns={csOrdersShellTableColumns(showCSAgentColumn, showCampaignColumn)}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** CS team analysis — date + stat strip + CompactTable pulse (matches CSTeamPage). */
export function CSTeamLoadingShell({
  dateFilters,
}: {
  dateFilters: { startDate: string; endDate: string; periodAllTime: boolean };
}) {
  const teamRows = shellPulsePlaceholderRows('cs_team', CST_TEAM_SHELL_ROWS);
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Team Analysis"
        description="Closer workload, activity, and assigned / delivered / confirmed counts for the selected period. View orders or profile per member."
        actions={
          <PageHeaderMobileTools
            sheetTitle="CS team tools"
            sheetSubtitle={<span>Date range</span>}
            triggerAriaLabel="CS team toolbar"
            desktop={
              <>
                <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1">
                  <DateFilterBar
                    startDate={dateFilters.startDate}
                    endDate={dateFilters.endDate}
                    periodAllTime={dateFilters.periodAllTime}
                  />
                </div>
                <PageRefreshButton />
              </>
            }
            sheet={
              <div className="flex w-full min-h-[2.5rem] flex-col items-center justify-center rounded-md border border-app-border bg-app-hover px-2.5 py-2">
                <DateFilterBar
                  startDate={dateFilters.startDate}
                  endDate={dateFilters.endDate}
                  periodAllTime={dateFilters.periodAllTime}
                  triggerLayout="blockCenter"
                />
              </div>
            }
          />
        }
      />
      <OverviewStatStrip
        items={[
          { label: 'Closers', value: <StatValuePulse className="min-w-[2rem]" /> },
          { label: 'Total pending', value: <StatValuePulse className="min-w-[2.5rem]" /> },
          { label: 'Idle', value: <StatValuePulse className="min-w-[2rem]" /> },
        ]}
      />
      <CompactTable<{ id: string }>
        rows={teamRows}
        rowKey={(r) => r.id}
        columns={csTeamShellTableColumns()}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}

/** CS leaderboard — date + ranked rows pulse. */
export function CSLeaderboardLoadingShell({
  filters,
  leaderboardPeriod,
}: {
  filters: { startDate: string; endDate: string; periodAllTime: boolean };
  leaderboardPeriod: 'this_month' | 'all_time';
}) {
  const periodLabel = leaderboardPeriod === 'all_time' ? 'all time' : 'this month';
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <PageHeader
        title="CS Leaderboard"
        description={`Closer performance ranked for ${periodLabel}.`}
        actions={
          <>
            <div className="flex items-center min-h-[2rem] rounded-md border border-app-border bg-app-hover pl-2.5 pr-2 py-1 shrink-0">
              <DateFilterBar
                startDate={filters.startDate}
                endDate={filters.endDate}
                periodAllTime={filters.periodAllTime}
              />
            </div>
            <PageRefreshButton />
          </>
        }
      />
      <div className="card p-0">
        <div className="px-4 py-3 border-b border-app-border space-y-2">
          <div className="h-5 w-56 rounded bg-app-hover animate-pulse" aria-hidden />
          <div className="h-3 w-72 rounded bg-app-hover animate-pulse" aria-hidden />
        </div>
        <div className="space-y-3 px-4 py-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="rounded-lg border border-app-border bg-app-elevated p-4 space-y-2 animate-pulse"
            >
              <div className="h-4 w-40 rounded bg-app-hover" aria-hidden />
              <div className="h-3 w-full max-w-md rounded bg-app-hover" aria-hidden />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const MSG_TEMPLATE_SHELL_COLS: CompactTableColumn<{ id: string }>[] = [
  { key: 'name', header: 'Name', render: () => <TableCellTextPulse className="w-[12rem]" /> },
  { key: 'channel', header: 'Channel', render: () => <TableCellTextPulse className="w-[5rem]" /> },
  {
    key: 'preview',
    header: 'Preview',
    render: () => <TableCellTextPulse className="w-[14rem] max-w-[min(20rem,100%)]" />,
  },
  { key: 'status', header: 'Status', render: () => <TableCellTextPulse className="w-[5rem]" /> },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    tight: true,
    render: () => (
      <span className="inline-flex gap-1">
        <CompactTableActionButton disabled>View</CompactTableActionButton>
        <CompactTableActionButton disabled>Edit</CompactTableActionButton>
      </span>
    ),
  },
];

/** Message templates — header + channel tabs + table pulse. */
export function CSMessageTemplatesLoadingShell() {
  const rows = shellPulsePlaceholderRows('msg_tpl', 6);
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <PageHeader
        title="Message Templates"
        description="SMS and WhatsApp templates for customer communication."
        actions={<PageRefreshButton />}
      />
      <Tabs
        value="SMS"
        onChange={() => {}}
        tabs={[
          { value: 'SMS', label: 'SMS' },
          { value: 'WHATSAPP', label: 'WhatsApp' },
        ]}
      />
      <CompactTable<{ id: string }>
        rows={rows}
        rowKey={(r) => r.id}
        columns={MSG_TEMPLATE_SHELL_COLS}
        emptyTitle="Loading…"
        emptyDescription=""
      />
    </div>
  );
}
